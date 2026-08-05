const { randomUUID } = require('node:crypto');

const FAMILY_PORTIONS = 2 + 0.6 + 0.4;
const seasonFor = date => { const month = date.getMonth() + 1; return month >= 3 && month <= 5 ? 'Printemps' : month >= 6 && month <= 8 ? 'Été' : month >= 9 && month <= 11 ? 'Automne' : 'Hiver'; };
const dateKey = date => date.toISOString().slice(0, 10);
const inHoliday = (date, holidays = []) => holidays.some(item => date >= item.start && date <= item.end);
const eventsOn = (date, events = []) => events.filter(item => item.date === date);

function attendanceFor(date, meal, calendar = {}) {
  if (!calendar || !Object.keys(calendar).length) return { servings: FAMILY_PORTIONS, papaPresent: true, madamePresent: true, childrenPresent: true, canteen: false, centre: false, schoolHoliday: false, events: [] };
  const events = eventsOn(date, calendar.events); const types = new Set(events.map(item => item.type)); const weekday = new Date(`${date}T12:00:00`).getDay();
  const previous = new Date(`${date}T12:00:00`); previous.setDate(previous.getDate() - 1); const afterNight = meal === 'lunch' && eventsOn(dateKey(previous), calendar.events).some(item => item.type === 'night');
  const schoolHoliday = inHoliday(date, calendar.schoolHolidays); const schoolDay = weekday >= 1 && weekday <= 5 && !schoolHoliday;
  const centre = types.has('centre'); const leave = types.has('leave');
  let papa = 1;
  if (!leave && meal === 'lunch' && (types.has('morning') || types.has('return-morning'))) papa = 0;
  if (!leave && meal === 'dinner' && (types.has('afternoon') || types.has('return-afternoon'))) papa = 0;
  const canteen = meal === 'lunch' && schoolDay && [1, 2, 4, 5].includes(weekday);
  const childrenAway = meal === 'lunch' && (canteen || centre);
  const servings = papa + 1 + (childrenAway ? 0 : 1);
  return { servings, papaPresent: Boolean(papa), madamePresent: true, childrenPresent: !childrenAway, canteen, centre, afterNight, schoolHoliday, events: events.map(item => item.title) };
}

function datesBetween(start, end) { const dates = []; for (let d = new Date(`${start}T12:00:00`), last = new Date(`${end}T12:00:00`); d <= last; d.setDate(d.getDate() + 1)) dates.push(new Date(d)); return dates; }
const seasonsForRecipe = recipe => Array.isArray(recipe.seasons) && recipe.seasons.length ? recipe.seasons : recipe.season === 'Toute saison' ? ['Printemps', 'Été', 'Automne', 'Hiver'] : [recipe.season];
function score(recipe, { season, maxPrepMinutes, recent, index }) { const duration = Number(recipe.totalMinutes || recipe.prepMinutes || 999); const seasons = seasonsForRecipe(recipe); let value = seasons.includes(season) ? (seasons.length === 4 ? 15 : 50) : 0; if (Number.isFinite(maxPrepMinutes)) value += duration <= maxPrepMinutes ? 45 : -Math.min(120, duration - maxPrepMinutes); value -= (recent.get(recipe.id) || 0) * 60; value -= Math.abs((index % 7) - ((recipe.title || '').length % 7)); return value; }

function generatePlan(state, { startDate, endDate, soloMadame = [], busyDates = [], lunchMaxMinutes = 60, dinnerMaxMinutes = 45, busyMaxMinutes = 30 }) {
  const dates = datesBetween(startDate, endDate); if (!dates.length || dates.length > 62) throw new Error('La période doit contenir entre 1 et 62 jours.');
  const recipes = state.recipes.filter(recipe => recipe.ingredients?.length); if (!recipes.length) throw new Error('Aucune recette disponible.');
  const recent = new Map(); const meals = []; state.leftovers = (state.leftovers || []).filter(item => !['planned'].includes(item.status)); const available = state.leftovers.find(item => item.status === 'conserved' && item.remainingServings > 0 && recipes.some(recipe => recipe.id === item.recipeId)); let plannedLeftover = available ? { recipe: recipes.find(recipe => recipe.id === available.recipeId), remainingServings: available.remainingServings, record: available } : null;
  dates.forEach((date, dayIndex) => ['lunch', 'dinner'].forEach((meal, mealIndex) => {
    const key = dateKey(date); const attendance = attendanceFor(key, meal, state.calendar); const isSolo = soloMadame.includes(key) || attendance.servings === 1; const servings = isSolo ? 1 : attendance.servings; let recipe; let fromLeftover = false; let leftoverId = null;
    if (plannedLeftover && plannedLeftover.remainingServings >= servings && (isSolo || meal === 'lunch')) { recipe = plannedLeftover.recipe; plannedLeftover.remainingServings -= servings; plannedLeftover.record.remainingServings = plannedLeftover.remainingServings; plannedLeftover.record.status = plannedLeftover.remainingServings > 0 ? 'conserved' : 'planned'; fromLeftover = true; leftoverId = plannedLeftover.record.id; if (plannedLeftover.remainingServings <= 0) plannedLeftover = null; }
    if (!recipe) { const busy = busyDates.includes(key) || attendance.afterNight; const maxPrepMinutes = busy ? Number(busyMaxMinutes) : meal === 'lunch' ? Number(lunchMaxMinutes) : Number(dinnerMaxMinutes); const season = seasonFor(date); const seasonal = recipes.filter(item => seasonsForRecipe(item).includes(season)); const candidates = seasonal.length ? seasonal : recipes; const ranked = candidates.map((item, index) => ({ item, value: score(item, { season, maxPrepMinutes, recent, index: dayIndex * 2 + mealIndex + index }) })).sort((a, b) => b.value - a.value); recipe = ranked[0].item; recent.set(recipe.id, (recent.get(recipe.id) || 0) + 1); }
    const entry = { id: randomUUID(), date: key, meal, recipeId: recipe.id, servings, cookedServings: servings, attendance, isSoloMadame: isSolo, fromLeftover, leftoverId };
    if (!fromLeftover && !isSolo && recipe.leftoverFriendly !== false && (dayIndex + mealIndex) % 3 === 0) { const extraServings = Math.max(1, servings); entry.cookedServings += extraServings; const record = { id: randomUUID(), recipeId: recipe.id, sourceMealId: entry.id, sourceDate: key, initialServings: extraServings, remainingServings: extraServings, status: 'conserved', createdAt: new Date().toISOString() }; state.leftovers.push(record); plannedLeftover = { recipe, remainingServings: extraServings, record }; }
    meals.push(entry);
  }));
  state.plan = { startDate, endDate, meals, generatedAt: new Date().toISOString() }; return state.plan;
}

function scaledIngredients(recipe, servings) { const base = Number(recipe.servings) || FAMILY_PORTIONS; return recipe.ingredients.map(item => { const numeric = Number(String(item.quantity).replace(',', '.')); return { ...item, quantity: Number.isFinite(numeric) ? Math.round(numeric * servings / base * 100) / 100 : item.quantity }; }); }

function recalculatePlanShopping(state) {
  const manual = (state.shopping || []).filter(item => item.manual); const totals = new Map();
  for (const meal of state.plan?.meals || []) { if (meal.fromLeftover) continue; const recipe = state.recipes.find(item => item.id === meal.recipeId); if (!recipe) continue; for (const item of scaledIngredients(recipe, meal.cookedServings || meal.servings)) { const key = `${item.name}|${item.unit}`.toLocaleLowerCase('fr'); const amount = Number(item.quantity); const current = totals.get(key) || { name: item.name, unit: item.unit, quantity: Number.isFinite(amount) ? 0 : item.quantity }; if (Number.isFinite(amount) && typeof current.quantity === 'number') current.quantity += amount; totals.set(key, current); } }
  state.shopping = [...manual, ...[...totals.values()].map(item => ({ id: randomUUID(), ...item, label: [item.quantity, item.unit, item.name].filter(value => value !== '').join(' '), checked: false, manual: false }))]; return state.shopping;
}

module.exports = { FAMILY_PORTIONS, seasonFor, datesBetween, attendanceFor, generatePlan, recalculatePlanShopping, scaledIngredients, score, seasonsForRecipe };
