const { createHash, randomUUID } = require('node:crypto');

const DEFAULT_PROVIDERS = {
  marmiton: { adapter: 'marmiton', name: 'Marmiton', enabled: true, searchUrl: 'https://www.marmiton.org/recettes/recherche.aspx?aqt={query}', hosts: ['marmiton.org'], minIntervalMs: 1800, timeoutMs: 8000 },
  g750: { adapter: 'g750', name: '750g', enabled: true, searchUrl: 'https://www.750g.com/recherche.htm?search={query}', hosts: ['750g.com'], minIntervalMs: 1800, timeoutMs: 8000 },
  cuisineaz: { adapter: 'cuisineaz', name: 'CuisineAZ', enabled: true, searchUrl: 'https://www.cuisineaz.com/recettes/recherche_v2.aspx?recherche={query}', hosts: ['cuisineaz.com'], minIntervalMs: 1800, timeoutMs: 8000 },
  themealdb: { adapter: 'themealdb', name: 'TheMealDB', enabled: true, apiUrl: 'https://www.themealdb.com/api/json/v1/1/search.php?s={query}', hosts: ['themealdb.com'], minIntervalMs: 1000, timeoutMs: 8000 }
};

const CACHE_TTL_MS = 7 * 86400000;
const AUTO_DISABLE_FAILURES = 3;
const RECIPE_PATHS = { marmiton: /\/recettes\/recette_/i, g750: /\.htm$/i, cuisineaz: /\/recettes\/.+\.aspx$/i };

const decode = value => String(value || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const text = value => decode(String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
const list = value => Array.isArray(value) ? value : value == null ? [] : [value];
const durationMinutes = value => { const match = String(value || '').match(/PT(?:(\d+)H)?(?:(\d+)M)?/i); return match ? Number(match[1] || 0) * 60 + Number(match[2] || 0) : null; };
const canonical = value => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const fingerprint = recipe => createHash('sha256').update(`${canonical(recipe.title)}|${canonical(recipe.ingredients.map(i => i.name).join('|'))}`).digest('hex');
const SEARCH_STOP_WORDS = new Set(['a', 'au', 'aux', 'avec', 'de', 'des', 'du', 'en', 'et', 'la', 'le', 'les', 'recette', 'recettes', 'rapide', 'rapides']);
function searchTokens(query) { return canonical(query).split(' ').filter(token => token.length > 1 && !SEARCH_STOP_WORDS.has(token)); }
function isRelevant(recipe, query) { const tokens = searchTokens(query); if (!tokens.length) return true; const haystack = canonical(`${recipe.title} ${recipe.category} ${recipe.ingredients.map(item => item.name).join(' ')}`); return tokens.every(token => haystack.includes(token)); }

function jsonLdBlocks(html) {
  const blocks = []; const regex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi; let match;
  while ((match = regex.exec(html))) { try { blocks.push(JSON.parse(decode(match[1]).trim())); } catch {} }
  return blocks.flatMap(block => list(block?.['@graph'] || block));
}

function findRecipes(node) {
  if (!node || typeof node !== 'object') return [];
  const found = []; const type = list(node['@type']).map(String);
  if (type.includes('Recipe')) found.push(node);
  for (const value of Object.values(node)) if (value && typeof value === 'object') found.push(...findRecipes(value));
  return found;
}

function parseIngredient(value) {
  const raw = text(value); const match = raw.match(/^([\d.,/½¼¾]+)?\s*([a-zA-ZÀ-ÿ]+)?\s*(.*)$/);
  return { quantity: match?.[1]?.replace(',', '.') || '', unit: match?.[2] || '', name: match?.[3] || raw };
}

function normalizeRecipe(raw, source, sourceUrl) {
  const ingredients = list(raw.recipeIngredient || raw.ingredients).map(parseIngredient).filter(item => item.name);
  const instructions = list(raw.recipeInstructions).flatMap(step => typeof step === 'string' ? [text(step)] : step?.itemListElement ? list(step.itemListElement).map(item => text(item.text || item)) : [text(step?.text || step)]).filter(Boolean);
  const title = text(raw.name || raw.headline); if (!title || !ingredients.length) return null;
  const recipe = { id: randomUUID(), title, description: text(raw.description), ingredients, preparation: instructions, source: source.name, sourceUrl, attribution: `${source.name} — ${sourceUrl}`, image: typeof raw.image === 'string' ? raw.image : raw.image?.url || list(raw.image)[0]?.url || list(raw.image)[0] || '', servings: Number.parseFloat(String(raw.recipeYield || '').match(/[\d.,]+/)?.[0]?.replace(',', '.')) || null, prepMinutes: durationMinutes(raw.prepTime), totalMinutes: durationMinutes(raw.totalTime), category: text(raw.recipeCategory) || 'Autre', cuisine: text(raw.recipeCuisine), season: 'Toute saison', leftoverFriendly: inferLeftoverFriendly(raw), personal: false, favorite: false, collectedAt: new Date().toISOString() };
  recipe.fingerprint = fingerprint(recipe); return recipe;
}

function inferLeftoverFriendly(raw) {
  const value = canonical(`${raw.name || ''} ${raw.recipeCategory || ''} ${raw.description || ''}`);
  const fragile = ['salade', 'tartare', 'souffle', 'friture', 'oeuf poche'];
  const suitable = ['gratin', 'lasagne', 'curry', 'soupe', 'ragout', 'mijote', 'quiche', 'pates', 'riz', 'chili', 'parmentier'];
  if (fragile.some(word => value.includes(word))) return false;
  return suitable.some(word => value.includes(word)) || list(raw.recipeIngredient || raw.ingredients).length >= 4;
}

function extractLinks(html, baseUrl, hosts, query = '', recipePath = /recette/i) {
  const links = new Map(); const tokens = searchTokens(query); const regex = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi; let match;
  while ((match = regex.exec(html)) && links.size < 100) { try { const url = new URL(decode(match[1]), baseUrl); if (hosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`)) && recipePath.test(url.pathname)) { const label = canonical(`${text(match[2])} ${url.pathname}`); const score = tokens.reduce((total, token) => total + (label.includes(token) ? 1 : 0), 0); links.set(url.href, Math.max(score, links.get(url.href) || 0)); } } catch {} }
  return [...links.entries()].sort((a, b) => b[1] - a[1]).map(([url]) => url);
}

class RecipeCollector {
  constructor({ fetchImpl = fetch, now = Date.now } = {}) { this.fetch = fetchImpl; this.now = now; this.lastRequest = new Map(); }
  async request(url, source) {
    const elapsed = this.now() - (this.lastRequest.get(source.key) || 0); if (elapsed < source.minIntervalMs) await new Promise(resolve => setTimeout(resolve, source.minIntervalMs - elapsed));
    this.lastRequest.set(source.key, this.now()); const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), source.timeoutMs);
    try { const response = await this.fetch(url, { signal: controller.signal, headers: { 'user-agent': 'MealPilot/1.0 (private family recipe planner)', accept: 'text/html,application/xhtml+xml' } }); if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.text(); } finally { clearTimeout(timer); }
  }
  async cachedRequest(url, source, state, kind = 'text') {
    state.recipeCache ||= {}; const now = this.now(); const cached = state.recipeCache[url];
    if (cached && typeof cached.body === 'string' && now - cached.savedAt <= CACHE_TTL_MS) return cached.body;
    const body = await this.request(url, source); state.recipeCache[url] = { body, savedAt: now, kind }; return body;
  }
  async allowed(url, source, state) {
    const target = new URL(url); const robotsUrl = `${target.origin}/robots.txt`;
    let robots;
    try { robots = await this.cachedRequest(robotsUrl, source, state, 'robots'); } catch { return true; }
    const rules = String(robots).split(/\r?\n/); let applies = false;
    for (const raw of rules) { const line = raw.replace(/#.*$/, '').trim(); const [field, ...rest] = line.split(':'); const value = rest.join(':').trim(); if (/^user-agent$/i.test(field)) applies = value === '*' || /mealpilot/i.test(value); if (applies && /^disallow$/i.test(field) && value && target.pathname.startsWith(value)) return false; }
    return true;
  }
  async search(query, state, wanted = 6) {
    state.providerStatus ||= {}; state.recipeCache ||= {}; const results = []; const now = this.now();
    for (const [key, base] of Object.entries(state.providers || DEFAULT_PROVIDERS)) {
      if (!base.enabled || results.length >= wanted) continue; const source = { ...base, key }; const status = state.providerStatus[key] ||= { failures: 0 };
      try {
        if (source.apiUrl) {
          const apiUrl = source.apiUrl.replace('{query}', encodeURIComponent(query)); const payload = JSON.parse(await this.cachedRequest(apiUrl, source, state, 'api'));
          for (const meal of list(payload.meals)) { const ingredients = []; for (let i = 1; i <= 20; i++) { const name = text(meal[`strIngredient${i}`]); if (name) ingredients.push(parseIngredient(`${text(meal[`strMeasure${i}`])} ${name}`)); } const recipe = normalizeRecipe({ name: meal.strMeal, description: meal.strTags, recipeYield: 4, recipeIngredient: ingredients.map(item => [item.quantity, item.unit, item.name].filter(Boolean).join(' ')), recipeInstructions: String(meal.strInstructions || '').split(/\r?\n/).filter(Boolean), image: meal.strMealThumb, recipeCategory: meal.strCategory, recipeCuisine: meal.strArea }, source, meal.strSource || `https://www.themealdb.com/meal/${meal.idMeal}`); if (recipe && isRelevant(recipe, query) && !results.some(item => item.fingerprint === recipe.fingerprint)) results.push(recipe); if (results.length >= wanted) break; }
          status.failures = 0; status.lastSuccess = new Date(now).toISOString(); status.lastError = ''; continue;
        }
        const searchUrl = source.searchUrl.replace('{query}', encodeURIComponent(query)); if (!await this.allowed(searchUrl, source, state)) throw new Error('Collecte interdite par robots.txt');
        const searchHtml = await this.cachedRequest(searchUrl, source, state, 'search');
        const urls = extractLinks(searchHtml, searchUrl, source.hosts, query, RECIPE_PATHS[source.adapter] || /recette/i);
        for (const url of urls.slice(0, Math.max(2, wanted - results.length))) {
          if (!await this.allowed(url, source, state)) continue; const page = await this.cachedRequest(url, source, state, 'recipe');
          for (const raw of jsonLdBlocks(page).flatMap(findRecipes)) { const recipe = normalizeRecipe(raw, source, url); if (recipe && isRelevant(recipe, query) && !results.some(item => item.fingerprint === recipe.fingerprint)) results.push(recipe); if (results.length >= wanted) break; }
          if (results.length >= wanted) break;
        }
        status.failures = 0; status.lastSuccess = new Date(now).toISOString(); status.lastError = '';
      } catch (error) { status.failures += 1; status.lastError = error.name === 'AbortError' ? 'Délai dépassé' : error.message; status.lastFailure = new Date(now).toISOString(); if (status.failures >= AUTO_DISABLE_FAILURES) { state.providers[key].enabled = false; status.autoDisabled = true; status.disabledReason = status.lastError; status.disabledAt = new Date(now).toISOString(); } }
    }
    return results;
  }
}

module.exports = { DEFAULT_PROVIDERS, RecipeCollector, jsonLdBlocks, findRecipes, normalizeRecipe, fingerprint, canonical, searchTokens, isRelevant, extractLinks, inferLeftoverFriendly, CACHE_TTL_MS };
