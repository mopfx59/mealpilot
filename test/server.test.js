const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('le serveur expose son état et permet un parcours fonctionnel', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mealpilot-'));
  process.env.DATA_DIR = dataDir;
  const modulePath = require.resolve('../server'); delete require.cache[modulePath];
  const { server } = require('../server');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;

  let response = await fetch(`${base}/api/health`); assert.equal(response.status, 200);
  response = await fetch(`${base}/api/state`); const initial = await response.json(); assert.equal(initial.recipes.length, 3); assert.equal(Object.keys(initial.menu).length, 7);

  response = await fetch(`${base}/api/recipes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Soupe maison', ingredients: ['Carottes'], preparation: ['Mixer'] }) });
  assert.equal(response.status, 201); const recipe = await response.json();
  response = await fetch(`${base}/api/menu`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ day: 'Lundi', meal: 'lunch', recipeId: recipe.id }) }); assert.equal(response.status, 200);
  response = await fetch(`${base}/api/shopping/from-menu`, { method: 'POST' }); const shopping = await response.json(); assert.deepEqual(shopping.map(item => item.label), ['Carottes']);
});
