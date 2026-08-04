const { randomUUID } = require('node:crypto');

const FAMILY_PORTIONS = 2 + 0.6 + 0.4;
const seasonFor = date => { const month = date.getMonth() + 1; return month >= 3 && month <= 5 ? 'Printemps' : month >= 6 && month <= 8 ? 'Été' : month >= 9 && month <= 11 ? 'Automne' : 'Hiver'; };
const dateKey = date => date.toISOString().slice(0, 10);
const inHoliday = (date, holidays = []) => holidays.some(item => date >= item.start && date <= item.end);
const eventsOn = (date, events = []) => events.filter(item => item.date === date);

function attendanceFor(date, meal, calendar = {}) {
  if (!calendar || !Object.keys(calendar).length) return { servings: FAMILY_PORTIONS, papaPresent: true, madamePresent: true, childrenPresent: true, canteen: false, centre: false, schoolHoliday: false, events: [] };
  const events = eventsOn(date, calendar.events); const types = new Set(events.map(item => item.type)); const weekday = new Date(`${date}T12:00:00`).getDay();
  const schoolHoliday = inHoliday(date, calendar.schoolHolidays); const schoolDay = weekday >= 1 && weekday <= 5 && !schoolHoliday;
  const centre = types.has('centre'); const leave = types.has('leave');
  let papa = 1;
  if (!leave && meal === 'lunch' && (types.has('morning') || types.has('return-morning') || types.has('night'))) papa = 0;
  if (!leave && meal === 'dinner' && (types.has('afternoon') || types.has('return-afternoon') || types.has('night'))) papa = 0;
  const canteen = meal === 'lunch' && schoolDay && [1, 2, 4, 5].includes(weekday);
  const childrenAway = meal === 'lunch' && (canteen || centre);
  const servings = papa + 1 + (childrenAway ? 0 : 1);
  return { servings, papaPresent: Boolean(papa), madamePresent: true, childrenPresent: !childrenAway, canteen, centre, schoolHoliday, events: events.map(item => item.title) };
}

function datesBetween(start, end) { const dates = []; for (let d = new Date(`${start}T12:00:00`), last = new Date(`${end}T12:00:00`); d <= last; d.setDate(d.getDate() + 1)) dates.push(new Date(d)); return dates; }
function score(recipe, { season, dinner, recent, index }) { let value = recipe.season === season ? 50 : recipe.season === 'Toute saison' ? 15 : 0; if (dinner && Number(recipe.totalMinutes || recipe.prepMinutes || 999) <= 30) value += 35; value -= (recent.get(recipe.id) || 0) * 60; value -= Math.abs((index % 7) - ((recipe.title || '').length % 7)); return value; }

function generatePlan(state, { startDate, endDate, soloMadame = [] }) {
  const dates = datesBetween(startDate, endDate); if (!dates.length || dates.length > 62) throw new Error('La période doit contenir entre 1 et 62 jours.');
  const recipes = state.recipes.filter(recipe => recipe.ingredients?.length); if (!recipes.length) throw new Error('Aucune recette disponible.');
  const recent = new Map(); const meals = []; let leftover = null;
  dates.forEach((date, dayIndex) => ['lunch', 'dinner'].forEach((meal, mealIndex) => {
    const key = dateKey(date); const attendance = attendanceFor(key, meal, state.calendar); const isSolo = soloMadame.includes(key) || attendance.servings === 1; let recipe; let fromLeftover = false;
    if (leftover && (isSolo || (meal === 'lunch' && dayIndex > 0))) { recipe = leftover.recipe; leftover.uses -= 1; fromLeftover = true; if (leftover.uses <= 0) leftover = null; }
    if (!recipe) { const ranked = recipes.map((item, index) => ({ item, value: score(item, { season: seasonFor(date), dinner: meal === 'dinner', recent, index: dayIndex * 2 + mealIndex + index }) })).sort((a, b) => b.value - a.value); recipe = ranked[0].item; recent.set(recipe.id, (recent.get(recipe.id) || 0) + 1); if (!isSolo && recipe.leftoverFriendly !== false && (dayIndex + mealIndex) % 3 === 0) leftover = { recipe, uses: 1 }; }
    meals.push({ id: randomUUID(), date: key, meal, recipeId: recipe.id, servings: isSolo ? 1 : attendance.servings, attendance, isSoloMadame: isSolo, fromLeftover });
  }));
  state.plan = { startDate, endDate, meals, generatedAt: new Date().toISOString() }; return state.plan;
}

function scaledIngredients(recipe, servings) { const base = Number(recipe.servings) || FAMILY_PORTIONS; return recipe.ingredients.map(item => { const numeric = Number(String(item.quantity).replace(',', '.')); return { ...item, quantity: Number.isFinite(numeric) ? Math.round(numeric * servings / base * 100) / 100 : item.quantity }; }); }

function recalculatePlanShopping(state) {
  const manual = (state.shopping || []).filter(item => item.manual); const totals = new Map();
  for (const meal of state.plan?.meals || []) { if (meal.fromLeftover) continue; const recipe = state.recipes.find(item => item.id === meal.recipeId); if (!recipe) continue; for (const item of scaledIngredients(recipe, meal.servings)) { const key = `${item.name}|${item.unit}`.toLocaleLowerCase('fr'); const amount = Number(item.quantity); const current = totals.get(key) || { name: item.name, unit: item.unit, quantity: Number.isFinite(amount) ? 0 : item.quantity }; if (Number.isFinite(amount) && typeof current.quantity === 'number') current.quantity += amount; totals.set(key, current); } }
  state.shopping = [...manual, ...[...totals.values()].map(item => ({ id: randomUUID(), ...item, label: [item.quantity, item.unit, item.name].filter(value => value !== '').join(' '), checked: false, manual: false }))]; return state.shopping;
}

module.exports = { FAMILY_PORTIONS, seasonFor, datesBetween, attendanceFor, generatePlan, recalculatePlanShopping, scaledIngredients };
