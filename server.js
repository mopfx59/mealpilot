const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'mealpilot.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const defaultState = () => ({
  recipes: [
    { id: randomUUID(), title: 'Pâtes aux légumes', description: 'Un plat rapide, coloré et familial.', ingredients: ['300 g de pâtes', '1 courgette', '1 poivron', '400 g de tomates concassées', '1 oignon', 'Huile d\'olive'], preparation: ['Cuire les pâtes selon les indications du paquet.', 'Faire revenir l\'oignon et les légumes émincés.', 'Ajouter les tomates et mijoter 10 minutes.', 'Mélanger avec les pâtes et servir.'], favorite: true },
    { id: randomUUID(), title: 'Poulet rôti et pommes de terre', description: 'Le classique du dimanche, sans complication.', ingredients: ['1 poulet fermier', '800 g de pommes de terre', '2 gousses d\'ail', 'Thym', 'Huile d\'olive', 'Sel et poivre'], preparation: ['Préchauffer le four à 200 °C.', 'Disposer le poulet et les pommes de terre dans un plat.', 'Assaisonner avec ail, thym et huile.', 'Cuire 1 heure en arrosant à mi-cuisson.'], favorite: false },
    { id: randomUUID(), title: 'Salade de lentilles', description: 'Fraîche, complète et idéale à préparer en avance.', ingredients: ['250 g de lentilles vertes', '2 carottes', '1 échalote', '100 g de feta', 'Persil', 'Vinaigrette'], preparation: ['Cuire les lentilles et les laisser refroidir.', 'Couper les légumes et émietter la feta.', 'Mélanger tous les ingrédients avec la vinaigrette.'], favorite: false }
  ],
  menu: Object.fromEntries(DAYS.map(day => [day, { lunch: null, dinner: null }])),
  shopping: []
});

function ensureState() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) writeState(defaultState());
}

function readState() {
  ensureState();
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function writeState(state) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temporary = `${DATA_FILE}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(state, null, 2));
  fs.renameSync(temporary, DATA_FILE);
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 1_000_000) reject(new Error('Corps de requête trop volumineux'));
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error('JSON invalide')); }
    });
    req.on('error', reject);
  });
}

function cleanList(value) {
  return Array.isArray(value) ? value.map(item => String(item).trim()).filter(Boolean) : [];
}

async function api(req, res, pathname) {
  if (pathname === '/api/health' && req.method === 'GET') return json(res, 200, { status: 'ok' });
  if (pathname === '/api/state' && req.method === 'GET') return json(res, 200, readState());

  const state = readState();
  if (pathname === '/api/recipes' && req.method === 'POST') {
    const body = await readBody(req);
    const title = String(body.title || '').trim();
    const ingredients = cleanList(body.ingredients);
    const preparation = cleanList(body.preparation);
    if (!title || !ingredients.length || !preparation.length) return json(res, 400, { error: 'Titre, ingrédients et préparation sont requis.' });
    const recipe = { id: randomUUID(), title, description: String(body.description || '').trim(), ingredients, preparation, favorite: false };
    state.recipes.push(recipe); writeState(state); return json(res, 201, recipe);
  }

  const favoriteMatch = pathname.match(/^\/api\/recipes\/([^/]+)\/favorite$/);
  if (favoriteMatch && req.method === 'PATCH') {
    const recipe = state.recipes.find(item => item.id === decodeURIComponent(favoriteMatch[1]));
    if (!recipe) return json(res, 404, { error: 'Recette introuvable.' });
    recipe.favorite = !recipe.favorite; writeState(state); return json(res, 200, recipe);
  }

  if (pathname === '/api/menu' && req.method === 'PUT') {
    const body = await readBody(req);
    if (!DAYS.includes(body.day) || !['lunch', 'dinner'].includes(body.meal)) return json(res, 400, { error: 'Créneau invalide.' });
    if (body.recipeId !== null && !state.recipes.some(item => item.id === body.recipeId)) return json(res, 400, { error: 'Recette invalide.' });
    state.menu[body.day][body.meal] = body.recipeId; writeState(state); return json(res, 200, state.menu);
  }

  if (pathname === '/api/shopping/from-menu' && req.method === 'POST') {
    const selectedIds = new Set(Object.values(state.menu).flatMap(day => [day.lunch, day.dinner]).filter(Boolean));
    const existing = new Set(state.shopping.map(item => item.label.toLocaleLowerCase('fr')));
    for (const recipe of state.recipes.filter(item => selectedIds.has(item.id))) {
      for (const ingredient of recipe.ingredients) {
        if (!existing.has(ingredient.toLocaleLowerCase('fr'))) {
          state.shopping.push({ id: randomUUID(), label: ingredient, checked: false });
          existing.add(ingredient.toLocaleLowerCase('fr'));
        }
      }
    }
    writeState(state); return json(res, 200, state.shopping);
  }

  if (pathname === '/api/shopping' && req.method === 'POST') {
    const body = await readBody(req); const label = String(body.label || '').trim();
    if (!label) return json(res, 400, { error: 'Article requis.' });
    const item = { id: randomUUID(), label, checked: false }; state.shopping.push(item); writeState(state); return json(res, 201, item);
  }

  const shoppingMatch = pathname.match(/^\/api\/shopping\/([^/]+)$/);
  if (shoppingMatch && req.method === 'PATCH') {
    const item = state.shopping.find(entry => entry.id === decodeURIComponent(shoppingMatch[1]));
    if (!item) return json(res, 404, { error: 'Article introuvable.' });
    item.checked = !item.checked; writeState(state); return json(res, 200, item);
  }
  if (shoppingMatch && req.method === 'DELETE') {
    const index = state.shopping.findIndex(entry => entry.id === decodeURIComponent(shoppingMatch[1]));
    if (index < 0) return json(res, 404, { error: 'Article introuvable.' });
    state.shopping.splice(index, 1); writeState(state); return json(res, 204, null);
  }
  return json(res, 404, { error: 'Route introuvable.' });
}

function staticFile(res, pathname) {
  const requested = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = path.resolve(PUBLIC_DIR, requested);
  if (!file.startsWith(`${path.resolve(PUBLIC_DIR)}${path.sep}`) && file !== path.join(PUBLIC_DIR, 'index.html')) return json(res, 403, { error: 'Accès refusé.' });
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return json(res, 404, { error: 'Fichier introuvable.' });
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
  try {
    if (pathname.startsWith('/api/')) await api(req, res, pathname);
    else staticFile(res, pathname);
  } catch (error) {
    console.error(error); json(res, 500, { error: error.message || 'Erreur interne.' });
  }
});

if (require.main === module) server.listen(PORT, '0.0.0.0', () => console.log(`MealPilot disponible sur le port ${PORT}`));

module.exports = { server, defaultState, DAYS };
