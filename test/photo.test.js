const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function setup(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mealpilot-photo-'));
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
  body: JSON.stringify(body)
});

test('ajoute, sert puis retire une photo de recette', async t => {
  const base = await setup(t);
  const imageData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  let response = await send(base, '/api/recipes', 'POST', {
    title: 'Recette illustrée',
    seasons: ['Toute saison'],
    meals: ['lunch'],
    ingredients: [{ name: 'carottes', quantity: 2, unit: 'pièces' }],
    preparation: ['Cuire'],
    imageData
  });
  assert.equal(response.status, 201);
  const recipe = await response.json();
  assert.match(recipe.image, /^\/uploads\/[a-f0-9-]+\.png$/);

  response = await fetch(`${base}${recipe.image}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');

  response = await send(base, `/api/recipes/${recipe.id}`, 'PUT', { ...recipe, removeImage: true });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).image, '');
});
