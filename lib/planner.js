const { randomUUID } = require('node:crypto');

const FAMILY_PORTIONS = 2 + 0.6 + 0.4;
const seasonFor = date => { const month = date.getMonth() + 1; return month >= 3 && month <= 5 ? 'Printemps' : month >= 6 && month <= 8 ? 'Été' : month >= 9 && month <= 11 ? 'Automne' : 'Hiver'; };
const dateKey = date => date.toISOString().slice(0, 10);

function datesBetween(start, end) { const dates = []; for (let d = new Date(`${start}T12:00:00`), last = new Date(`${end}T12:00:00`); d <= last; d.setDate(d.getDate() + 1)) dates.push(new Date(d)); return dates; }
function score(recipe, { season, dinner, recent, index }) { let value = recipe.season === season ? 50 : recipe.season === 'Toute saison' ? 15 : 0; if (dinner && Number(recipe.totalMinutes || recipe.prepMinutes || 999) <= 30) value += 35; value -= (recent.get(recipe.id) || 0) * 60; value -= Math.abs((index % 7) - ((recipe.title || '').length % 7)); return value; }

function generatePlan(state, { startDate, endDate, soloMadame = [] }) {
  const dates = datesBetween(startDate, endDate); if (!dates.length || dates.length > 62) throw new Error('La période doit contenir entre 1 et 62 jours.');
  const recipes = state.recipes.filter(recipe => recipe.ingredients?.length); if (!recipes.length) throw new Error('Aucune recette disponible.');
  const recent = new Map(); const meals = []; let leftover = null;
  dates.forEach((date, dayIndex) => ['lunch', 'dinner'].forEach((meal, mealIndex) => {
    const key = dateKey(date); const isSolo = soloMadame.includes(key); let recipe; let fromLeftover = false;
    if (leftover && (isSolo || (meal === 'lunch' && dayIndex > 0))) { recipe = leftover.recipe; leftover.uses -= 1; fromLeftover = true; if (leftover.uses <= 0) leftover = null; }
    if (!recipe) { const ranked = recipes.map((item, index) => ({ item, value: score(item, { season: seasonFor(date), dinner: meal === 'dinner', recent, index: dayIndex * 2 + mealIndex + index }) })).sort((a, b) => b.value - a.value); recipe = ranked[0].item; recent.set(recipe.id, (recent.get(recipe.id) || 0) + 1); if (!isSolo && recipe.leftoverFriendly !== false && (dayIndex + mealIndex) % 3 === 0) leftover = { recipe, uses: 1 }; }
    meals.push({ id: randomUUID(), date: key, meal, recipeId: recipe.id, servings: isSolo ? 1 : FAMILY_PORTIONS, isSoloMadame: isSolo, fromLeftover });
  }));
  state.plan = { startDate, endDate, meals, generatedAt: new Date().toISOString() }; return state.plan;
}

function scaledIngredients(recipe, servings) { const base = Number(recipe.servings) || FAMILY_PORTIONS; return recipe.ingredients.map(item => { const numeric = Number(String(item.quantity).replace(',', '.')); return { ...item, quantity: Number.isFinite(numeric) ? Math.round(numeric * servings / base * 100) / 100 : item.quantity }; }); }

function recalculatePlanShopping(state) {
  const manual = (state.shopping || []).filter(item => item.manual); const totals = new Map();
  for (const meal of state.plan?.meals || []) { if (meal.fromLeftover) continue; const recipe = state.recipes.find(item => item.id === meal.recipeId); if (!recipe) continue; for (const item of scaledIngredients(recipe, meal.servings)) { const key = `${item.name}|${item.unit}`.toLocaleLowerCase('fr'); const amount = Number(item.quantity); const current = totals.get(key) || { name: item.name, unit: item.unit, quantity: Number.isFinite(amount) ? 0 : item.quantity }; if (Number.isFinite(amount) && typeof current.quantity === 'number') current.quantity += amount; totals.set(key, current); } }
  state.shopping = [...manual, ...[...totals.values()].map(item => ({ id: randomUUID(), ...item, label: [item.quantity, item.unit, item.name].filter(value => value !== '').join(' '), checked: false, manual: false }))]; return state.shopping;
}

module.exports = { FAMILY_PORTIONS, seasonFor, datesBetween, generatePlan, recalculatePlanShopping, scaledIngredients };
