const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { DEFAULT_PROVIDERS, RecipeCollector, fingerprint } = require('./lib/providers');
const { generatePlan, recalculatePlanShopping } = require('./lib/planner');
const { googleConfig, authorizationUrl, tokenRequest, fetchCalendars, fetchEvents, fetchZoneBHolidays, createOAuthState } = require('./lib/calendar');

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'mealpilot.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const SEASONS = ['Printemps', 'Été', 'Automne', 'Hiver'];

const ingredient = (name, quantity = '', unit = '') => ({ name, quantity, unit });
const seasonalRecipes = () => [
  ['Risotto aux asperges', 'Printemps', 'Végétarien', 'Crémeux et lumineux, idéal au retour des beaux jours.', [ingredient('riz arborio', 300, 'g'), ingredient('asperges vertes', 500, 'g'), ingredient('bouillon de légumes', 1, 'L'), ingredient('parmesan', 80, 'g')], ['Préparer le bouillon et blanchir les asperges.', 'Nacrer le riz puis ajouter le bouillon progressivement.', 'Incorporer les asperges et le parmesan.']],
  ['Tarte petits pois et chèvre', 'Printemps', 'Végétarien', 'Une tarte familiale douce et fraîche.', [ingredient('pâte brisée', 1, 'pièce'), ingredient('petits pois', 300, 'g'), ingredient('fromage de chèvre', 150, 'g'), ingredient('œufs', 3, 'pièces')], ['Préchauffer le four à 190 °C.', 'Garnir la pâte avec les petits pois et le chèvre.', 'Verser les œufs battus et cuire 35 minutes.']],
  ['Ratatouille provençale', 'Été', 'Végétarien', 'Les légumes du soleil mijotés doucement.', [ingredient('courgettes', 2, 'pièces'), ingredient('aubergine', 1, 'pièce'), ingredient('poivrons', 2, 'pièces'), ingredient('tomates', 5, 'pièces')], ['Découper tous les légumes.', 'Faire revenir séparément les légumes.', 'Réunir, assaisonner et mijoter 30 minutes.']],
  ['Salade de poulet aux pêches', 'Été', 'Salade', 'Une assiette complète, fraîche et fruitée.', [ingredient('blancs de poulet', 4, 'pièces'), ingredient('pêches', 3, 'pièces'), ingredient('roquette', 150, 'g'), ingredient('amandes', 50, 'g')], ['Griller le poulet et les pêches.', 'Trancher le poulet.', 'Assembler avec la roquette et les amandes.']],
  ['Velouté de potimarron', 'Automne', 'Soupe', 'Réconfortant, simple et naturellement onctueux.', [ingredient('potimarron', 1, 'pièce'), ingredient('pommes de terre', 300, 'g'), ingredient('bouillon de légumes', 750, 'ml'), ingredient('crème', 10, 'cl')], ['Épépiner et couper le potimarron.', 'Cuire avec les pommes de terre dans le bouillon.', 'Mixer avec la crème et rectifier l’assaisonnement.']],
  ['Gratin de champignons', 'Automne', 'Végétarien', 'Un gratin généreux pour les soirées fraîches.', [ingredient('champignons', 600, 'g'), ingredient('pommes de terre', 800, 'g'), ingredient('crème', 25, 'cl'), ingredient('comté', 120, 'g')], ['Précuire les pommes de terre.', 'Poêler les champignons.', 'Monter le gratin et cuire 30 minutes à 190 °C.']],
  ['Bœuf-carottes', 'Hiver', 'Mijoté', 'Le grand classique familial qui se réchauffe très bien.', [ingredient('bœuf à braiser', 800, 'g'), ingredient('carottes', 1, 'kg'), ingredient('oignons', 2, 'pièces'), ingredient('bouillon de bœuf', 500, 'ml')], ['Faire dorer la viande.', 'Ajouter les légumes et le bouillon.', 'Couvrir et mijoter 2 heures à feu doux.']],
  ['Curry de pois chiches', 'Hiver', 'Végétarien', 'Épicé juste ce qu’il faut et prêt rapidement.', [ingredient('pois chiches', 500, 'g'), ingredient('lait de coco', 400, 'ml'), ingredient('tomates concassées', 400, 'g'), ingredient('riz', 300, 'g')], ['Faire revenir les épices.', 'Ajouter pois chiches, tomates et lait de coco.', 'Mijoter 20 minutes et servir avec le riz.']]
].map(([title, season, category, description, ingredients, preparation]) => ({ id: randomUUID(), title, season, category, description, ingredients, preparation, favorite: false, personal: false }));

const defaultState = () => ({ recipes: seasonalRecipes(), menu: Object.fromEntries(DAYS.map(day => [day, { lunch: null, dinner: null }])), plan: null, shopping: [], providers: structuredClone(DEFAULT_PROVIDERS), providerStatus: {}, recipeCache: {}, calendar: { connected: false, calendarId: 'primary', calendarName: 'Agenda principal', events: [], schoolHolidays: [], lastSyncAt: null } });

function parseLegacyIngredient(value) {
  if (value && typeof value === 'object') return { name: String(value.name || '').trim(), quantity: value.quantity ?? '', unit: String(value.unit || '').trim() };
  const text = String(value || '').trim();
  const match = text.match(/^([\d.,½¼¾]+)\s*([a-zA-ZÀ-ÿ]+)?\s+(?:de |d')?(.*)$/);
  return match ? ingredient(match[3], match[1].replace(',', '.'), match[2] || '') : ingredient(text);
}

function migrateState(state) {
  state.recipes ||= [];
  state.deletedRecipeTitles ||= [];
  const knownSeasonalTitles = new Set(state.recipes.filter(recipe => recipe.personal === false).map(recipe => recipe.title));
  for (const recipe of seasonalRecipes()) if (!knownSeasonalTitles.has(recipe.title) && !state.deletedRecipeTitles.includes(recipe.title)) state.recipes.push(recipe);
  state.menu ||= Object.fromEntries(DAYS.map(day => [day, { lunch: null, dinner: null }]));
  state.shopping ||= [];
  state.plan ||= null; state.providers ||= {}; for (const [key, provider] of Object.entries(DEFAULT_PROVIDERS)) state.providers[key] ||= structuredClone(provider); state.providerStatus ||= {}; state.recipeCache ||= {};
  state.calendar ||= {}; Object.assign(state.calendar, { connected: Boolean(state.calendar.refreshToken), calendarId: state.calendar.calendarId || 'primary', calendarName: state.calendar.calendarName || 'Agenda principal', events: state.calendar.events || [], schoolHolidays: state.calendar.schoolHolidays || [], lastSyncAt: state.calendar.lastSyncAt || null });
  for (const day of DAYS) state.menu[day] ||= { lunch: null, dinner: null };
  for (const recipe of state.recipes) {
    recipe.ingredients = (recipe.ingredients || []).map(parseLegacyIngredient).filter(item => item.name);
    recipe.preparation = (recipe.preparation || []).map(String).filter(Boolean);
    recipe.personal ??= true; recipe.season ||= 'Toute saison'; recipe.category ||= 'Autre'; recipe.favorite = Boolean(recipe.favorite);
  }
  if (state.plan?.meals) for (const meal of state.plan.meals) if (!state.recipes.some(recipe => recipe.id === meal.recipeId)) { meal.recipeId = null; meal.fromLeftover = false; }
  for (const item of state.shopping) { item.manual ??= true; item.name ||= item.label || ''; item.label ||= item.name; }
  return state;
}

function ensureState() { fs.mkdirSync(DATA_DIR, { recursive: true }); if (!fs.existsSync(DATA_FILE)) writeState(defaultState()); }
function readState() { ensureState(); const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); const before = JSON.stringify(raw); const state = migrateState(raw); if (JSON.stringify(state) !== before) writeState(state); return state; }
function writeState(state) { fs.mkdirSync(DATA_DIR, { recursive: true }); const temporary = `${DATA_FILE}.tmp`; fs.writeFileSync(temporary, JSON.stringify(state, null, 2)); fs.renameSync(temporary, DATA_FILE); }
function json(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(body === null ? '' : JSON.stringify(body)); }
function readBody(req) { return new Promise((resolve, reject) => { let data = ''; req.on('data', chunk => { data += chunk; if (data.length > 1_000_000) reject(new Error('Corps de requête trop volumineux')); }); req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error('JSON invalide')); } }); req.on('error', reject); }); }
function cleanList(value) { return Array.isArray(value) ? value.map(item => String(item).trim()).filter(Boolean) : []; }
function cleanIngredients(value) { return Array.isArray(value) ? value.map(parseLegacyIngredient).filter(item => item.name) : []; }
function ingredientLabel(item) { return [item.quantity, item.unit, item.name].filter(value => value !== '' && value !== null && value !== undefined).join(' '); }
function publicState(state) { const copy = structuredClone(state); if (copy.calendar) { delete copy.calendar.accessToken; delete copy.calendar.refreshToken; delete copy.calendar.oauthState; delete copy.calendar.expiresAt; copy.calendar.configured = Boolean(googleConfig().clientId && googleConfig().redirectUri); } return copy; }

function recalculateShopping(state) {
  const manual = state.shopping.filter(item => item.manual);
  const checkedKeys = new Set(state.shopping.filter(item => item.checked && !item.manual).map(item => `${item.name}|${item.unit}`.toLocaleLowerCase('fr')));
  const totals = new Map();
  for (const recipeId of Object.values(state.menu).flatMap(day => [day.lunch, day.dinner]).filter(Boolean)) {
    const recipe = state.recipes.find(item => item.id === recipeId); if (!recipe) continue;
    for (const item of recipe.ingredients) {
      const key = `${item.name}|${item.unit}`.toLocaleLowerCase('fr'); const numeric = Number(String(item.quantity).replace(',', '.'));
      if (!totals.has(key)) totals.set(key, { name: item.name, unit: item.unit, quantity: Number.isFinite(numeric) ? 0 : item.quantity, count: 0 });
      const total = totals.get(key); if (Number.isFinite(numeric) && typeof total.quantity === 'number') total.quantity += numeric; else total.count += 1;
    }
  }
  state.shopping = [...manual, ...[...totals.entries()].map(([key, item]) => { const quantity = typeof item.quantity === 'number' ? item.quantity : item.quantity || (item.count > 1 ? item.count : ''); return { id: randomUUID(), name: item.name, quantity, unit: item.unit, label: ingredientLabel({ ...item, quantity }), checked: checkedKeys.has(key), manual: false }; })];
}

function recipePayload(body, existing = {}) {
  return { ...existing, title: String(body.title || '').trim(), description: String(body.description || '').trim(), season: SEASONS.includes(body.season) ? body.season : 'Toute saison', category: String(body.category || 'Autre').trim(), ingredients: cleanIngredients(body.ingredients), preparation: cleanList(body.preparation), personal: existing.personal ?? true, favorite: existing.favorite ?? false };
}

async function api(req, res, pathname, url) {
  if (pathname === '/api/health' && req.method === 'GET') return json(res, 200, { status: 'ok' });
  if (pathname === '/api/state' && req.method === 'GET') return json(res, 200, publicState(readState()));
  const state = readState();
  if (pathname === '/api/calendar/auth' && req.method === 'GET') { state.calendar.oauthState = createOAuthState(); writeState(state); return json(res, 200, { url: authorizationUrl(state.calendar.oauthState) }); }
  if (pathname === '/api/calendar/callback' && req.method === 'GET') { if (!url.searchParams.get('code') || url.searchParams.get('state') !== state.calendar.oauthState) return json(res, 400, { error: 'Retour OAuth invalide.' }); const token = await tokenRequest({ code: url.searchParams.get('code'), redirect_uri: googleConfig().redirectUri, grant_type: 'authorization_code' }); state.calendar.accessToken = token.access_token; state.calendar.refreshToken = token.refresh_token || state.calendar.refreshToken; state.calendar.expiresAt = Date.now() + Number(token.expires_in || 3600) * 1000; state.calendar.connected = true; delete state.calendar.oauthState; writeState(state); res.writeHead(302, { Location: '/#calendar' }); return res.end(); }
  if (pathname === '/api/calendar/calendars' && req.method === 'GET') return json(res, 200, await fetchCalendars(state.calendar));
  if (pathname === '/api/calendar' && req.method === 'PATCH') { const body = await readBody(req); state.calendar.calendarId = String(body.calendarId || 'primary'); state.calendar.calendarName = String(body.calendarName || 'Agenda principal'); writeState(state); return json(res, 200, publicState(state).calendar); }
  if (pathname === '/api/calendar/sync' && req.method === 'POST') { const body = await readBody(req); const startDate = /^\d{4}-\d{2}-\d{2}$/.test(body.startDate) ? body.startDate : new Date().toISOString().slice(0, 10); const defaultEnd = new Date(`${startDate}T12:00:00`); defaultEnd.setDate(defaultEnd.getDate() + 61); const endDate = /^\d{4}-\d{2}-\d{2}$/.test(body.endDate) ? body.endDate : defaultEnd.toISOString().slice(0, 10); const [events, schoolHolidays] = await Promise.all([fetchEvents(state.calendar, startDate, endDate), fetchZoneBHolidays(startDate, endDate)]); state.calendar.events = events; state.calendar.schoolHolidays = schoolHolidays; state.calendar.lastSyncAt = new Date().toISOString(); writeState(state); return json(res, 200, publicState(state).calendar); }
  if (pathname === '/api/calendar/disconnect' && req.method === 'DELETE') { state.calendar = { connected: false, calendarId: 'primary', calendarName: 'Agenda principal', events: [], schoolHolidays: state.calendar.schoolHolidays || [], lastSyncAt: null }; writeState(state); return json(res, 204, null); }
  if (pathname === '/api/providers' && req.method === 'GET') return json(res, 200, { providers: state.providers, status: state.providerStatus });
  const providerMatch = pathname.match(/^\/api\/providers\/([^/]+)$/);
  if (providerMatch && req.method === 'PATCH') { const key = decodeURIComponent(providerMatch[1]); if (!state.providers[key]) return json(res, 404, { error: 'Fournisseur introuvable.' }); const body = await readBody(req); if (Object.hasOwn(body, 'enabled')) state.providers[key].enabled = Boolean(body.enabled); for (const setting of ['timeoutMs', 'minIntervalMs']) if (Number.isFinite(Number(body[setting]))) state.providers[key][setting] = Math.max(250, Number(body[setting])); writeState(state); return json(res, 200, state.providers[key]); }
  if (pathname === '/api/recipes/collect' && req.method === 'POST') { const body = await readBody(req); const query = String(body.query || '').trim(); if (!query) return json(res, 400, { error: 'Recherche requise.' }); const collector = new RecipeCollector(); const found = await collector.search(query, state, Math.min(12, Math.max(1, Number(body.limit) || 8))); const known = new Set(state.recipes.map(recipe => recipe.fingerprint || fingerprint(recipe))); const candidates = found.filter(recipe => !known.has(recipe.fingerprint)); writeState(state); return json(res, 200, { found: found.length, candidates, providerStatus: state.providerStatus }); }
  if (pathname === '/api/recipes/import' && req.method === 'POST') { const body = await readBody(req); const candidates = Array.isArray(body.recipes) ? body.recipes.slice(0, 12) : []; const known = new Set(state.recipes.map(recipe => recipe.fingerprint || fingerprint(recipe))); const added = []; for (const candidate of candidates) { const recipe = { ...candidate, id: randomUUID(), title: String(candidate.title || '').trim(), ingredients: cleanIngredients(candidate.ingredients), preparation: cleanList(candidate.preparation), personal: false, favorite: false }; recipe.fingerprint = fingerprint(recipe); if (recipe.title && recipe.ingredients.length && !known.has(recipe.fingerprint)) { known.add(recipe.fingerprint); state.recipes.push(recipe); added.push(recipe); } } writeState(state); return json(res, 201, { added: added.length, recipes: added }); }
  if (pathname === '/api/plan/generate' && req.method === 'POST') { const body = await readBody(req); if (!/^\d{4}-\d{2}-\d{2}$/.test(body.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(body.endDate)) return json(res, 400, { error: 'Période invalide.' }); try { const tasks = [fetchZoneBHolidays(body.startDate, body.endDate)]; if (state.calendar.refreshToken) tasks.push(fetchEvents(state.calendar, body.startDate, body.endDate)); const [holidays, events] = await Promise.all(tasks); state.calendar.schoolHolidays = holidays; if (events) state.calendar.events = events; state.calendar.lastSyncAt = new Date().toISOString(); delete state.calendar.syncError; } catch (error) { state.calendar.syncError = error.message; } const plan = generatePlan(state, body); recalculatePlanShopping(state); writeState(state); return json(res, 200, { plan, shopping: state.shopping, calendarWarning: state.calendar.syncError || null }); }
  const planMealMatch = pathname.match(/^\/api\/plan\/meals\/([^/]+)$/);
  if (planMealMatch && req.method === 'PATCH') { const meal = state.plan?.meals.find(item => item.id === decodeURIComponent(planMealMatch[1])); if (!meal) return json(res, 404, { error: 'Repas introuvable.' }); const body = await readBody(req); if (!state.recipes.some(item => item.id === body.recipeId)) return json(res, 400, { error: 'Recette invalide.' }); meal.recipeId = body.recipeId; meal.fromLeftover = false; recalculatePlanShopping(state); writeState(state); return json(res, 200, { meal, shopping: state.shopping }); }
  if (pathname === '/api/recipes' && req.method === 'POST') {
    const recipe = recipePayload(await readBody(req));
    if (!recipe.title || !recipe.ingredients.length || !recipe.preparation.length) return json(res, 400, { error: 'Titre, ingrédients et préparation sont requis.' });
    recipe.id = randomUUID(); state.recipes.push(recipe); writeState(state); return json(res, 201, recipe);
  }
  const favoriteMatch = pathname.match(/^\/api\/recipes\/([^/]+)\/favorite$/);
  if (favoriteMatch && req.method === 'PATCH') { const recipe = state.recipes.find(item => item.id === decodeURIComponent(favoriteMatch[1])); if (!recipe) return json(res, 404, { error: 'Recette introuvable.' }); recipe.favorite = !recipe.favorite; writeState(state); return json(res, 200, recipe); }
  const recipeMatch = pathname.match(/^\/api\/recipes\/([^/]+)$/);
  if (recipeMatch && req.method === 'PUT') { const index = state.recipes.findIndex(item => item.id === decodeURIComponent(recipeMatch[1])); if (index < 0) return json(res, 404, { error: 'Recette introuvable.' }); const recipe = recipePayload(await readBody(req), state.recipes[index]); if (!recipe.title || !recipe.ingredients.length || !recipe.preparation.length) return json(res, 400, { error: 'Titre, ingrédients et préparation sont requis.' }); recipe.fingerprint = fingerprint(recipe); state.recipes[index] = recipe; if (state.plan?.meals) recalculatePlanShopping(state); else recalculateShopping(state); writeState(state); return json(res, 200, recipe); }
  if (recipeMatch && req.method === 'DELETE') { const index = state.recipes.findIndex(item => item.id === decodeURIComponent(recipeMatch[1])); if (index < 0) return json(res, 404, { error: 'Recette introuvable.' }); const removed = state.recipes[index]; const id = removed.id; state.deletedRecipeTitles ||= []; if (!state.deletedRecipeTitles.includes(removed.title)) state.deletedRecipeTitles.push(removed.title); state.recipes.splice(index, 1); for (const meals of Object.values(state.menu)) { if (meals.lunch === id) meals.lunch = null; if (meals.dinner === id) meals.dinner = null; } if (state.plan?.meals) { for (const meal of state.plan.meals) if (meal.recipeId === id) { meal.recipeId = null; meal.fromLeftover = false; } recalculatePlanShopping(state); } else recalculateShopping(state); writeState(state); return json(res, 204, null); }
  if (pathname === '/api/menu' && req.method === 'PUT') { const body = await readBody(req); if (!DAYS.includes(body.day) || !['lunch', 'dinner'].includes(body.meal)) return json(res, 400, { error: 'Créneau invalide.' }); if (body.recipeId !== null && !state.recipes.some(item => item.id === body.recipeId)) return json(res, 400, { error: 'Recette invalide.' }); state.menu[body.day][body.meal] = body.recipeId; recalculateShopping(state); writeState(state); return json(res, 200, { menu: state.menu, shopping: state.shopping }); }
  if (pathname === '/api/shopping/from-menu' && req.method === 'POST') { recalculateShopping(state); writeState(state); return json(res, 200, state.shopping); }
  if (pathname === '/api/shopping' && req.method === 'DELETE') { state.shopping = []; writeState(state); return json(res, 204, null); }
  if (pathname === '/api/shopping' && req.method === 'POST') { const body = await readBody(req); const label = String(body.label || '').trim(); if (!label) return json(res, 400, { error: 'Article requis.' }); const item = { id: randomUUID(), name: label, label, quantity: '', unit: '', checked: false, manual: true }; state.shopping.push(item); writeState(state); return json(res, 201, item); }
  const shoppingMatch = pathname.match(/^\/api\/shopping\/([^/]+)$/);
  if (shoppingMatch && req.method === 'PATCH') { const item = state.shopping.find(entry => entry.id === decodeURIComponent(shoppingMatch[1])); if (!item) return json(res, 404, { error: 'Article introuvable.' }); const body = await readBody(req); if (Object.hasOwn(body, 'label')) { const label = String(body.label || '').trim(); if (!label) return json(res, 400, { error: 'Article requis.' }); item.label = label; item.name = label; item.manual = true; } else item.checked = !item.checked; writeState(state); return json(res, 200, item); }
  if (shoppingMatch && req.method === 'DELETE') { const index = state.shopping.findIndex(entry => entry.id === decodeURIComponent(shoppingMatch[1])); if (index < 0) return json(res, 404, { error: 'Article introuvable.' }); state.shopping.splice(index, 1); writeState(state); return json(res, 204, null); }
  return json(res, 404, { error: 'Route introuvable.' });
}

function staticFile(res, pathname) { const requested = pathname === '/' ? 'index.html' : pathname.slice(1); const file = path.resolve(PUBLIC_DIR, requested); if (!file.startsWith(`${path.resolve(PUBLIC_DIR)}${path.sep}`) && file !== path.join(PUBLIC_DIR, 'index.html')) return json(res, 403, { error: 'Accès refusé.' }); if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return json(res, 404, { error: 'Fichier introuvable.' }); const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' }; res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res); }
const server = http.createServer(async (req, res) => { const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); const pathname = url.pathname; try { if (pathname.startsWith('/api/')) await api(req, res, pathname, url); else staticFile(res, pathname); } catch (error) { console.error(error); json(res, 500, { error: error.message || 'Erreur interne.' }); } });
if (require.main === module) server.listen(PORT, '0.0.0.0', () => console.log(`MealPilot disponible sur le port ${PORT}`));
module.exports = { server, defaultState, DAYS, recalculateShopping };
