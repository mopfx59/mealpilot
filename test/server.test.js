const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function setup(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mealpilot-'));
  process.env.DATA_DIR = dataDir;
  const modulePath = require.resolve('../server'); delete require.cache[modulePath];
  const { server } = require('../server');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  return `http://127.0.0.1:${server.address().port}`;
}
const send = (base, url, method, body) => fetch(`${base}${url}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

test('fournit une base de recettes saisonnières structurées', async t => {
  const base = await setup(t); const response = await fetch(`${base}/api/state`); const state = await response.json();
  assert.equal(response.status, 200); assert.equal(state.recipes.length, 8); assert.equal(Object.keys(state.menu).length, 7);
  assert.deepEqual(new Set(state.recipes.map(recipe => recipe.season)), new Set(['Printemps', 'Été', 'Automne', 'Hiver']));
  assert.equal(typeof state.recipes[0].ingredients[0].name, 'string'); assert.ok(Object.hasOwn(state.recipes[0].ingredients[0], 'quantity'));
});

test('ajoute les recettes saisonnières aux données existantes sans doublon', async t => {
  const base = await setup(t);
  const dataFile = path.join(process.env.DATA_DIR, 'mealpilot.json');
  fs.writeFileSync(dataFile, JSON.stringify({ recipes: [{ id: 'legacy', title: 'Recette familiale', ingredients: ['2 carottes'], preparation: ['Cuire'], favorite: true }], menu: {}, shopping: [] }));
  let state = await (await fetch(`${base}/api/state`)).json();
  assert.equal(state.recipes.length, 9); assert.equal(state.recipes.find(recipe => recipe.id === 'legacy').personal, true);
  state = await (await fetch(`${base}/api/state`)).json(); assert.equal(state.recipes.length, 9);
});

test('gère le cycle de vie complet des recettes personnelles', async t => {
  const base = await setup(t);
  let response = await send(base, '/api/recipes', 'POST', { title: 'Soupe maison', season: 'Hiver', category: 'Soupe', ingredients: [{ name: 'carottes', quantity: 500, unit: 'g' }], preparation: ['Cuire', 'Mixer'] });
  assert.equal(response.status, 201); const recipe = await response.json(); assert.equal(recipe.personal, true);
  response = await send(base, `/api/recipes/${recipe.id}`, 'PUT', { ...recipe, title: 'Velouté maison', ingredients: [{ name: 'carottes', quantity: 600, unit: 'g' }] });
  assert.equal(response.status, 200); assert.equal((await response.json()).title, 'Velouté maison');
  response = await send(base, `/api/recipes/${recipe.id}/favorite`, 'PATCH'); assert.equal((await response.json()).favorite, true);
  response = await send(base, `/api/recipes/${recipe.id}`, 'DELETE'); assert.equal(response.status, 204);
});

test('recalcule et agrège automatiquement les courses à chaque remplacement', async t => {
  const base = await setup(t);
  let response = await send(base, '/api/recipes', 'POST', { title: 'Pâtes test', ingredients: [{ name: 'pâtes', quantity: 250, unit: 'g' }], preparation: ['Cuire'] }); const recipe = await response.json();
  response = await send(base, '/api/menu', 'PUT', { day: 'Lundi', meal: 'lunch', recipeId: recipe.id }); let payload = await response.json(); assert.equal(payload.shopping[0].label, '250 g pâtes');
  response = await send(base, '/api/menu', 'PUT', { day: 'Mardi', meal: 'dinner', recipeId: recipe.id }); payload = await response.json(); assert.equal(payload.shopping[0].label, '500 g pâtes');
  response = await send(base, '/api/menu', 'PUT', { day: 'Lundi', meal: 'lunch', recipeId: null }); payload = await response.json(); assert.equal(payload.shopping[0].label, '250 g pâtes');
});

test('supprime les courses à l’unité ou efface toute la liste', async t => {
  const base = await setup(t);
  let response = await send(base, '/api/shopping', 'POST', { label: 'Pommes' }); const first = await response.json();
  await send(base, '/api/shopping', 'POST', { label: 'Lait' });
  response = await send(base, `/api/shopping/${first.id}`, 'DELETE'); assert.equal(response.status, 204);
  let state = await (await fetch(`${base}/api/state`)).json(); assert.deepEqual(state.shopping.map(item => item.label), ['Lait']);
  response = await send(base, '/api/shopping', 'DELETE'); assert.equal(response.status, 204);
  state = await (await fetch(`${base}/api/state`)).json(); assert.equal(state.shopping.length, 0);
});

test('importe une sélection puis permet de supprimer toute recette définitivement', async t => {
  const base = await setup(t);
  const candidate = { title: 'Recette choisie', description: 'Selon mes goûts', source: 'Source test', sourceUrl: 'https://example.test/recette', ingredients: [{ name: 'courgettes', quantity: 2, unit: 'pièces' }], preparation: ['Cuire'], season: 'Été', category: 'Plat' };
  let response = await send(base, '/api/recipes/import', 'POST', { recipes: [candidate] }); assert.equal(response.status, 201); const imported = (await response.json()).recipes[0];
  let state = await (await fetch(`${base}/api/state`)).json(); state.plan = { startDate: '2026-08-04', endDate: '2026-08-04', meals: [{ id: 'meal-1', date: '2026-08-04', meal: 'lunch', recipeId: imported.id, servings: 3, fromLeftover: false }] }; fs.writeFileSync(path.join(process.env.DATA_DIR, 'mealpilot.json'), JSON.stringify(state));
  response = await send(base, `/api/recipes/${imported.id}`, 'DELETE'); assert.equal(response.status, 204);
  state = await (await fetch(`${base}/api/state`)).json(); assert.equal(state.recipes.some(recipe => recipe.title === candidate.title), false); assert.equal(state.plan.meals[0].recipeId, null);
  const seasonal = state.recipes.find(recipe => recipe.personal === false); response = await send(base, `/api/recipes/${seasonal.id}`, 'DELETE'); assert.equal(response.status, 204);
  state = await (await fetch(`${base}/api/state`)).json(); assert.equal(state.recipes.some(recipe => recipe.title === seasonal.title), false);
});
