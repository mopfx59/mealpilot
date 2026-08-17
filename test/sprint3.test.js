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

test('prévisualise une recette depuis une URL en conservant sa source', async () => {
  const state = { recipeCache: {} }; const collector = new RecipeCollector({ fetchImpl: async url => ({ ok: true, text: async () => url.endsWith('/robots.txt') ? 'User-agent: *\nDisallow:' : structured }) });
  const recipe = await collector.importUrl('https://example.test/recette', state);
  assert.equal(recipe.title, 'Tarte aux courgettes'); assert.equal(recipe.source, 'example.test'); assert.equal(recipe.sourceUrl, 'https://example.test/recette'); assert.match(recipe.attribution, /example\.test/);
});

test('refuse les URL locales lors d’un import', async () => {
  const collector = new RecipeCollector({ fetchImpl: async () => { throw new Error('ne doit pas être appelé'); } });
  await assert.rejects(() => collector.importUrl('https://192.168.1.10/recette', { recipeCache: {} }), /locales|privées/);
});

test('désactive durablement une source après trois échecs', async () => {
  let now = 1000; const state = { providers: { demo: { name: 'Demo', enabled: true, searchUrl: 'https://demo.test/search?q={query}', hosts: ['demo.test'], minIntervalMs: 0, timeoutMs: 10 } }, providerStatus: {}, recipeCache: {} };
  const collector = new RecipeCollector({ fetchImpl: async () => { throw new Error('indisponible'); }, now: () => now });
  await collector.search('a', state); await collector.search('b', state); await collector.search('c', state);
  assert.equal(state.providerStatus.demo.failures, 3); assert.equal(state.providerStatus.demo.autoDisabled, true); assert.equal(state.providers.demo.enabled, false);
});

test('utilise les recettes Menu express aux dates demandées', () => {
  const recipes = [{ id: 'slow', title: 'Plat classique', season: 'Toute saison', express: false, servings: 3, leftoverFriendly: false, ingredients: [{ name: 'lent', quantity: 1 }] }, { id: 'quick', title: 'Plat express', season: 'Toute saison', express: true, servings: 3, leftoverFriendly: false, ingredients: [{ name: 'rapide', quantity: 1 }] }];
  const state = { recipes, shopping: [] }; const plan = generatePlan(state, { startDate: '2026-08-03', endDate: '2026-08-03', expressDates: ['2026-08-03'] });
  assert.ok(plan.meals.every(meal => meal.recipeId === 'quick'));
  assert.ok(plan.meals.every(meal => meal.express));
});

test('utilise une recette Menu express lorsque Madame est seule sans reste disponible', () => {
  const recipes = [{ id: 'classic', title: 'Plat classique', season: 'Toute saison', express: false, servings: 3, leftoverFriendly: false, ingredients: [{ name: 'lent', quantity: 1 }] }, { id: 'express', title: 'Omelette express', season: 'Toute saison', express: true, servings: 1, leftoverFriendly: false, ingredients: [{ name: 'œufs', quantity: 2 }] }];
  const plan = generatePlan({ recipes, leftovers: [], shopping: [] }, { startDate: '2026-08-03', endDate: '2026-08-03', soloMadame: ['2026-08-03'] });
  assert.ok(plan.meals.every(meal => meal.recipeId === 'express'));
  assert.ok(plan.meals.every(meal => meal.isSoloMadame && meal.express));
});

test('respecte les recettes prévues uniquement pour le déjeuner ou le dîner', () => {
  const recipes = [{ id: 'lunch-only', title: 'Poulet rôti', season: 'Toute saison', meals: ['lunch'], servings: 3, leftoverFriendly: false, ingredients: [{ name: 'poulet', quantity: 1 }] }, { id: 'dinner-only', title: 'Soupe du soir', season: 'Toute saison', meals: ['dinner'], servings: 3, leftoverFriendly: false, ingredients: [{ name: 'légumes', quantity: 4 }] }];
  const plan = generatePlan({ recipes, leftovers: [], shopping: [] }, { startDate: '2026-08-03', endDate: '2026-08-03' });
  assert.equal(plan.meals.find(meal => meal.meal === 'lunch').recipeId, 'lunch-only');
  assert.equal(plan.meals.find(meal => meal.meal === 'dinner').recipeId, 'dinner-only');
});

test('exclut une recette d’hiver d’un menu généré en été', () => {
  const recipes = [{ id: 'carbonade', title: 'Carbonade flamande', season: 'Hiver', totalMinutes: 150, servings: 3, leftoverFriendly: true, ingredients: [{ name: 'bœuf', quantity: 500, unit: 'g' }] }, { id: 'summer', title: 'Ratatouille', season: 'Été', totalMinutes: 45, servings: 3, leftoverFriendly: true, ingredients: [{ name: 'courgette', quantity: 2, unit: 'pièces' }] }];
  const state = { recipes, leftovers: [], shopping: [] }; const plan = generatePlan(state, { startDate: '2026-08-10', endDate: '2026-08-10' });
  assert.ok(plan.meals.every(meal => meal.recipeId !== 'carbonade')); assert.ok(plan.meals.every(meal => meal.recipeId === 'summer'));
});

test('considère septembre comme été jusqu’au 9 octobre', () => {
  const recipes = [{ id: 'carbonade', title: 'Carbonade flamande', seasons: ['Automne', 'Hiver'], meals: ['lunch'], servings: 3, leftoverFriendly: false, ingredients: [{ name: 'bœuf', quantity: 500 }] }, { id: 'summer', title: 'Poulet froid', seasons: ['Été'], meals: ['lunch'], servings: 3, leftoverFriendly: false, ingredients: [{ name: 'poulet', quantity: 1 }] }, { id: 'dinner', title: 'Salade du soir', seasons: ['Été', 'Automne'], meals: ['dinner'], servings: 3, leftoverFriendly: false, ingredients: [{ name: 'salade', quantity: 1 }] }];
  const summer = generatePlan({ recipes, leftovers: [], shopping: [] }, { startDate: '2026-09-02', endDate: '2026-09-02' });
  const lateSummer = generatePlan({ recipes, leftovers: [], shopping: [] }, { startDate: '2026-09-22', endDate: '2026-09-22' });
  assert.equal(summer.meals.find(meal => meal.meal === 'lunch').recipeId, 'summer');
  assert.equal(lateSummer.meals.find(meal => meal.meal === 'lunch').recipeId, 'summer');
});

test('conserve les recettes Toute saison parmi les choix compatibles', () => {
  const recipes = [{ id: 'winter', title: 'Potée', season: 'Hiver', totalMinutes: 20, servings: 3, leftoverFriendly: false, ingredients: [{ name: 'chou', quantity: 1 }] }, { id: 'all', title: 'Omelette', season: 'Toute saison', totalMinutes: 15, servings: 3, leftoverFriendly: false, ingredients: [{ name: 'œufs', quantity: 6 }] }];
  const state = { recipes, leftovers: [], shopping: [] }; const plan = generatePlan(state, { startDate: '2026-08-10', endDate: '2026-08-10' });
  assert.ok(plan.meals.every(meal => meal.recipeId === 'all'));
});

test('accepte une recette sur plusieurs saisons sans l’ouvrir aux autres', () => {
  const recipes = [{ id: 'carbonade', title: 'Carbonade flamande', season: 'Automne', seasons: ['Automne', 'Hiver'], totalMinutes: 150, servings: 3, leftoverFriendly: true, ingredients: [{ name: 'bœuf', quantity: 500, unit: 'g' }] }, { id: 'summer', title: 'Salade', season: 'Été', seasons: ['Printemps', 'Été'], totalMinutes: 15, servings: 3, leftoverFriendly: false, ingredients: [{ name: 'tomate', quantity: 4 }] }];
  const autumn = generatePlan({ recipes, leftovers: [], shopping: [] }, { startDate: '2026-10-10', endDate: '2026-10-10' }); const summer = generatePlan({ recipes, leftovers: [], shopping: [] }, { startDate: '2026-08-10', endDate: '2026-08-10' });
  assert.ok(autumn.meals.every(meal => meal.recipeId === 'carbonade')); assert.ok(summer.meals.every(meal => meal.recipeId === 'summer'));
});

test('planifie, quantifie et trace les restes puis évite un second achat', () => {
  const recipes = [{ id: 'summer', title: 'Gratin été', season: 'Été', totalMinutes: 20, servings: 4, leftoverFriendly: true, ingredients: [{ name: 'tomates', quantity: 4, unit: 'pièces' }] }];
  const state = { recipes, shopping: [], leftovers: [] }; const plan = generatePlan(state, { startDate: '2026-08-03', endDate: '2026-08-04', soloMadame: ['2026-08-04'] });
  assert.equal(plan.meals.length, 4); assert.equal(plan.meals[0].servings, FAMILY_PORTIONS); assert.equal(plan.meals[0].cookedServings, FAMILY_PORTIONS + 1); assert.equal(plan.meals[2].servings, 1); assert.equal(plan.meals[2].fromLeftover, true); assert.equal(state.leftovers.length, 1); assert.equal(state.leftovers[0].sourceMealId, plan.meals[0].id); assert.equal(state.leftovers[0].initialServings, 1); assert.equal(state.leftovers[0].remainingServings, 0); recalculatePlanShopping(state); assert.equal(state.shopping.length, 1);
});

test('calcule les restes selon les présences réelles du repas suivant', () => {
  const recipes = [{ id: 'ratatouille', title: 'Ratatouille', seasons: ['Été'], meals: ['lunch'], servings: 3, leftoverFriendly: true, ingredients: [{ name: 'courgettes', quantity: 2 }] }, { id: 'dinner', title: 'Salade', seasons: ['Été'], meals: ['dinner'], servings: 3, leftoverFriendly: false, ingredients: [{ name: 'salade', quantity: 1 }] }];
  const calendar = { events: [{ date: '2026-08-31', type: 'morning', title: 'Matin' }, { date: '2026-09-01', type: 'morning', title: 'Matin' }], schoolHolidays: [{ start: '2026-07-03', end: '2026-08-31' }] };
  const state = { recipes, calendar, leftovers: [], shopping: [] }; const plan = generatePlan(state, { startDate: '2026-08-31', endDate: '2026-09-01' });
  const mondayLunch = plan.meals.find(meal => meal.date === '2026-08-31' && meal.meal === 'lunch'); const tuesdayLunch = plan.meals.find(meal => meal.date === '2026-09-01' && meal.meal === 'lunch');
  assert.equal(mondayLunch.servings, 2); assert.equal(mondayLunch.cookedServings, 3); assert.deepEqual(mondayLunch.plannedLeftover, { servings: 1, targetDate: '2026-09-01', targetMeal: 'lunch' }); assert.equal(tuesdayLunch.servings, 1); assert.equal(tuesdayLunch.fromLeftover, true); assert.equal(tuesdayLunch.leftoverSourceDate, '2026-08-31'); assert.equal(state.leftovers[0].initialServings, 1); assert.equal(state.leftovers[0].remainingServings, 0);
});

test('réutilise en priorité un reste conservé lors d’une nouvelle planification', () => {
  const recipes = [{ id: 'saved', title: 'Curry conservé', season: 'Toute saison', totalMinutes: 30, servings: 3, leftoverFriendly: true, ingredients: [{ name: 'riz', quantity: 300, unit: 'g' }] }, { id: 'new', title: 'Plat neuf', season: 'Toute saison', totalMinutes: 20, servings: 3, leftoverFriendly: false, ingredients: [{ name: 'pâtes', quantity: 300, unit: 'g' }] }];
  const leftover = { id: 'leftover-1', recipeId: 'saved', sourceMealId: 'old-meal', sourceDate: '2026-08-02', initialServings: 1, remainingServings: 1, status: 'conserved' };
  const state = { recipes, leftovers: [leftover], shopping: [] }; const plan = generatePlan(state, { startDate: '2026-08-03', endDate: '2026-08-03', soloMadame: ['2026-08-03'] });
  assert.equal(plan.meals[0].recipeId, 'saved'); assert.equal(plan.meals[0].fromLeftover, true); assert.equal(plan.meals[0].leftoverId, 'leftover-1'); assert.equal(state.leftovers[0].status, 'planned');
});
