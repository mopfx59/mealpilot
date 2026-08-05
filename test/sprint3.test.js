const test = require('node:test');
const assert = require('node:assert/strict');
const { jsonLdBlocks, findRecipes, normalizeRecipe, RecipeCollector, isRelevant, extractLinks, DEFAULT_PROVIDERS } = require('../lib/providers');
const { generatePlan, recalculatePlanShopping, FAMILY_PORTIONS } = require('../lib/planner');

const structured = `<script type="application/ld+json">{"@type":"Recipe","name":"Tarte aux courgettes","description":"Un gratin familial","recipeYield":"4 portions","prepTime":"PT10M","totalTime":"PT25M","image":"https://img.test/tarte.jpg","recipeIngredient":["2 courgettes","200 g farine"],"recipeInstructions":[{"text":"Cuire 20 minutes."}]}</script>`;

test('extrait tous les champs d’une recette JSON-LD avec attribution', () => {
  const raw = jsonLdBlocks(structured).flatMap(findRecipes)[0];
  const recipe = normalizeRecipe(raw, { name: 'Source test' }, 'https://example.test/recette');
  assert.equal(recipe.title, 'Tarte aux courgettes'); assert.equal(recipe.prepMinutes, 10); assert.equal(recipe.totalMinutes, 25); assert.equal(recipe.servings, 4); assert.equal(recipe.image, 'https://img.test/tarte.jpg'); assert.equal(recipe.preparation.length, 1); assert.match(recipe.attribution, /example\.test/); assert.equal(recipe.ingredients.length, 2); assert.ok(recipe.fingerprint); assert.equal(recipe.leftoverFriendly, true);
});

test('écarte les recettes hors sujet des résultats de recherche', () => {
  const salmon = { title: 'Wrap au saumon fumé', category: 'Entrée', ingredients: [{ name: 'saumon' }, { name: 'tortilla' }] };
  const chicken = { title: 'Wrap au poulet', category: 'Plat', ingredients: [{ name: 'poulet' }, { name: 'tortilla' }] };
  assert.equal(isRelevant(salmon, 'wrap au poulet'), false); assert.equal(isRelevant(chicken, 'wrap au poulet'), true);
});

for (const [key, path, expected] of [
  ['marmiton', '/recettes/recette_tarte_123.aspx', true],
  ['g750', '/tarte-aux-courgettes-r12345.htm', true],
  ['cuisineaz', '/recettes/tarte-aux-courgettes-123.aspx', true]
]) test(`utilise l’adaptateur dédié ${key}`, () => {
  const source = DEFAULT_PROVIDERS[key]; const html = `<a href="${path}">Tarte aux courgettes</a><a href="/article/autre">Autre</a>`;
  const pattern = key === 'marmiton' ? /\/recettes\/recette_/i : key === 'g750' ? /\.htm$/i : /\/recettes\/.+\.aspx$/i;
  assert.equal(extractLinks(html, source.searchUrl, source.hosts, 'tarte courgettes', pattern).length > 0, expected);
});

test('collecte TheMealDB via son adaptateur API et met la réponse en cache', async () => {
  let calls = 0; const meal = { idMeal: '1', strMeal: 'Poulet rôti', strIngredient1: 'poulet', strMeasure1: '1', strInstructions: 'Cuire', strMealThumb: 'https://img.test/poulet.jpg', strCategory: 'Plat' };
  const state = { providers: { themealdb: { ...DEFAULT_PROVIDERS.themealdb, minIntervalMs: 0 } }, providerStatus: {}, recipeCache: {} };
  const collector = new RecipeCollector({ fetchImpl: async () => ({ ok: true, text: async () => { calls++; return JSON.stringify({ meals: [meal] }); } }) });
  assert.equal((await collector.search('poulet', state, 1)).length, 1); assert.equal((await collector.search('poulet', state, 1)).length, 1); assert.equal(calls, 1);
});

test('met en cache recherches, robots et pages, puis déduplique', async () => {
  let calls = 0; const fetchImpl = async url => { calls++; return { ok: true, text: async () => url.endsWith('/robots.txt') ? 'User-agent: *\nDisallow:' : url.includes('/search') ? '<a href="/recette/une">Courgette</a><a href="/recette/deux">Courgette</a>' : structured }; };
  const state = { providers: { demo: { name: 'Demo', enabled: true, searchUrl: 'https://demo.test/search?q={query}', hosts: ['demo.test'], minIntervalMs: 0, timeoutMs: 1000 } }, providerStatus: {}, recipeCache: {} };
  const collector = new RecipeCollector({ fetchImpl }); const first = await collector.search('courgette', state, 2); const firstCalls = calls; const second = await collector.search('courgette', state, 2);
  assert.equal(first.length, 1); assert.equal(second.length, 1); assert.equal(calls, firstCalls); assert.ok(Object.keys(state.recipeCache).length >= 4);
});

test('respecte robots.txt', async () => {
  const state = { providers: { demo: { name: 'Demo', enabled: true, searchUrl: 'https://demo.test/recettes/search?q={query}', hosts: ['demo.test'], minIntervalMs: 0, timeoutMs: 1000 } }, providerStatus: {}, recipeCache: {} };
  const collector = new RecipeCollector({ fetchImpl: async url => ({ ok: true, text: async () => url.endsWith('/robots.txt') ? 'User-agent: *\nDisallow: /recettes' : '' }) });
  assert.equal((await collector.search('test', state)).length, 0); assert.match(state.providerStatus.demo.lastError, /robots/);
});

test('désactive durablement une source après trois échecs', async () => {
  let now = 1000; const state = { providers: { demo: { name: 'Demo', enabled: true, searchUrl: 'https://demo.test/search?q={query}', hosts: ['demo.test'], minIntervalMs: 0, timeoutMs: 10 } }, providerStatus: {}, recipeCache: {} };
  const collector = new RecipeCollector({ fetchImpl: async () => { throw new Error('indisponible'); }, now: () => now });
  await collector.search('a', state); await collector.search('b', state); await collector.search('c', state);
  assert.equal(state.providerStatus.demo.failures, 3); assert.equal(state.providerStatus.demo.autoDisabled, true); assert.equal(state.providers.demo.enabled, false);
});

test('applique le temps disponible et les journées chargées', () => {
  const recipes = [{ id: 'slow', title: 'Plat lent', season: 'Toute saison', totalMinutes: 90, servings: 3, leftoverFriendly: false, ingredients: [{ name: 'lent', quantity: 1 }] }, { id: 'quick', title: 'Plat rapide', season: 'Toute saison', totalMinutes: 20, servings: 3, leftoverFriendly: false, ingredients: [{ name: 'rapide', quantity: 1 }] }];
  const state = { recipes, shopping: [] }; const plan = generatePlan(state, { startDate: '2026-08-03', endDate: '2026-08-03', busyDates: ['2026-08-03'], busyMaxMinutes: 30 });
  assert.ok(plan.meals.every(meal => meal.recipeId === 'quick'));
});

test('exclut une recette d’hiver d’un menu généré en été', () => {
  const recipes = [{ id: 'carbonade', title: 'Carbonade flamande', season: 'Hiver', totalMinutes: 150, servings: 3, leftoverFriendly: true, ingredients: [{ name: 'bœuf', quantity: 500, unit: 'g' }] }, { id: 'summer', title: 'Ratatouille', season: 'Été', totalMinutes: 45, servings: 3, leftoverFriendly: true, ingredients: [{ name: 'courgette', quantity: 2, unit: 'pièces' }] }];
  const state = { recipes, leftovers: [], shopping: [] }; const plan = generatePlan(state, { startDate: '2026-08-10', endDate: '2026-08-10' });
  assert.ok(plan.meals.every(meal => meal.recipeId !== 'carbonade')); assert.ok(plan.meals.every(meal => meal.recipeId === 'summer'));
});

test('conserve les recettes Toute saison parmi les choix compatibles', () => {
  const recipes = [{ id: 'winter', title: 'Potée', season: 'Hiver', totalMinutes: 20, servings: 3, leftoverFriendly: false, ingredients: [{ name: 'chou', quantity: 1 }] }, { id: 'all', title: 'Omelette', season: 'Toute saison', totalMinutes: 15, servings: 3, leftoverFriendly: false, ingredients: [{ name: 'œufs', quantity: 6 }] }];
  const state = { recipes, leftovers: [], shopping: [] }; const plan = generatePlan(state, { startDate: '2026-08-10', endDate: '2026-08-10' });
  assert.ok(plan.meals.every(meal => meal.recipeId === 'all'));
});

test('planifie, quantifie et trace les restes puis évite un second achat', () => {
  const recipes = [{ id: 'summer', title: 'Gratin été', season: 'Été', totalMinutes: 20, servings: 4, leftoverFriendly: true, ingredients: [{ name: 'tomates', quantity: 4, unit: 'pièces' }] }];
  const state = { recipes, shopping: [], leftovers: [] }; const plan = generatePlan(state, { startDate: '2026-08-03', endDate: '2026-08-04', soloMadame: ['2026-08-04'] });
  assert.equal(plan.meals.length, 4); assert.equal(plan.meals[0].servings, FAMILY_PORTIONS); assert.ok(plan.meals[0].cookedServings > plan.meals[0].servings); assert.equal(plan.meals[2].servings, 1); assert.equal(plan.meals[2].fromLeftover, true); assert.equal(state.leftovers.length, 1); assert.equal(state.leftovers[0].sourceMealId, plan.meals[0].id); assert.ok(state.leftovers[0].initialServings > 0); recalculatePlanShopping(state); assert.equal(state.shopping.length, 1);
});

test('réutilise en priorité un reste conservé lors d’une nouvelle planification', () => {
  const recipes = [{ id: 'saved', title: 'Curry conservé', season: 'Toute saison', totalMinutes: 30, servings: 3, leftoverFriendly: true, ingredients: [{ name: 'riz', quantity: 300, unit: 'g' }] }, { id: 'new', title: 'Plat neuf', season: 'Toute saison', totalMinutes: 20, servings: 3, leftoverFriendly: false, ingredients: [{ name: 'pâtes', quantity: 300, unit: 'g' }] }];
  const leftover = { id: 'leftover-1', recipeId: 'saved', sourceMealId: 'old-meal', sourceDate: '2026-08-02', initialServings: 1, remainingServings: 1, status: 'conserved' };
  const state = { recipes, leftovers: [leftover], shopping: [] }; const plan = generatePlan(state, { startDate: '2026-08-03', endDate: '2026-08-03', soloMadame: ['2026-08-03'] });
  assert.equal(plan.meals[0].recipeId, 'saved'); assert.equal(plan.meals[0].fromLeftover, true); assert.equal(plan.meals[0].leftoverId, 'leftover-1'); assert.equal(state.leftovers[0].status, 'planned');
});
