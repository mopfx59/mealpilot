const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function setup(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mealpilot-deleted-'));
  process.env.DATA_DIR = dataDir;
  const modulePath = require.resolve('../server'); delete require.cache[modulePath];
  const { server } = require('../server');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  return `http://127.0.0.1:${server.address().port}`;
}

const send = (base, url, method, body) => fetch(`${base}${url}`, {
  method,
  headers: { 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body)
});

test('une recette supprimée ne peut plus être réimportée automatiquement', async t => {
  const base = await setup(t);
  const candidate = { title: 'Gratin préféré', source: 'Source test', sourceUrl: 'https://example.test/gratin', ingredients: [{ name: 'pommes de terre', quantity: 1, unit: 'kg' }], preparation: ['Cuire au four'] };
  let response = await send(base, '/api/recipes/import', 'POST', { recipes: [candidate] });
  const imported = (await response.json()).recipes[0]; assert.ok(imported?.id);

  response = await send(base, `/api/recipes/${imported.id}`, 'DELETE');
  assert.equal(response.status, 204);

  response = await send(base, '/api/recipes/import', 'POST', { recipes: [{ ...candidate, title: '  GRATIN PREFERE  ' }] });
  const result = await response.json();
  assert.equal(result.added, 0);
  assert.deepEqual(result.recipes, []);
});
