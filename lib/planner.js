const { randomUUID } = require('node:crypto');

const FAMILY_PORTIONS = 2 + 0.6 + 0.4;
const seasonFor = date => { const day = (date.getMonth() + 1) * 100 + date.getDate(); return day >= 320 && day <= 620 ? 'Printemps' : day >= 621 && day <= 921 ? 'Été' : day >= 922 && day <= 1220 ? 'Automne' : 'Hiver'; };
const dateKey = date => date.toISOString().slice(0, 10);
const inHoliday = (date, holidays = []) => holidays.some(item => date >= item.start && date <= item.end);
const eventsOn = (date, events = []) => events.filter(item => item.date === date);
const WORK_TYPES = new Set(['morning', 'return-morning', 'afternoon', 'return-afternoon', 'night', 'rest', 'leave']);
const DEFAULT_WORK_PREFERENCES = { morning: { meal: 'lunch', preference: 'transportable' }, 'return-morning': { meal: 'lunch', preference: 'express' }, afternoon: { meal: 'dinner', preference: 'makeAhead' }, 'return-afternoon': { meal: 'dinner', preference: 'express' }, night: { meal: 'dinner', preference: 'transportable' }, rest: { meal: '', preference: 'normal' }, leave: { meal: '', preference: 'normal' } };
const minutesFor = value => { const [hours, minutes] = String(value || '').split(':').map(Number); return Number.isFinite(hours) ? hours * 60 + (minutes || 0) : null; };
function eventMakesMealBusy(event, meal) { if (event.type === 'busy-evening') return meal === 'dinner'; if (event.type !== 'appointment') return false; const start = minutesFor(event.startTime); const end = minutesFor(event.endTime); if (start === null || end === null) return true; const [windowStart, windowEnd] = meal === 'lunch' ? [11 * 60, 14 * 60 + 30] : [17 * 60, 21 * 60 + 30]; return start < windowEnd && end > windowStart; }

function attendanceFor(date, meal, calendar = {}, workSchedule = {}) {
  if ((!calendar || !Object.keys(calendar).length) && !(workSchedule.entries || []).length) return { servings: FAMILY_PORTIONS, papaPresent: true, madamePresent: true, childrenPresent: true, canteen: false, centre: false, afterNight: false, busy: false, busyReason: null, workShift: null, shiftChanged: false, mealPreference: 'normal', schoolHoliday: false, events: [] };
  calendar ||= {}; calendar.events ||= []; calendar.schoolHolidays ||= [];
  const calendarEvents = eventsOn(date, calendar.events); const manual = (workSchedule.entries || []).find(entry => entry.date === date); const events = manual ? [...calendarEvents.filter(event => !WORK_TYPES.has(event.type)), { id: `manual-${date}`, date, title: workSchedule.shiftTypes?.[manual.type]?.label || manual.type, type: manual.type, manual: true }] : calendarEvents; const types = new Set(events.map(item => item.type)); const weekday = new Date(`${date}T12:00:00`).getDay();
  const previous = new Date(`${date}T12:00:00`); previous.setDate(previous.getDate() - 1); const previousKey = dateKey(previous); const previousManual = (workSchedule.entries || []).find(entry => entry.date === previousKey); const previousEvents = previousManual ? [...eventsOn(previousKey, calendar.events).filter(event => !WORK_TYPES.has(event.type)), { type: previousManual.type }] : eventsOn(previousKey, calendar.events); const afterNight = meal === 'lunch' && previousEvents.some(item => item.type === 'night');
  const schoolHoliday = inHoliday(date, calendar.schoolHolidays); const schoolDay = weekday >= 1 && weekday <= 5 && !schoolHoliday;
  const centre = types.has('centre'); const leave = types.has('leave');
  const busyEvent = events.find(event => eventMakesMealBusy(event, meal));
  const workEvent = events.find(event => WORK_TYPES.has(event.type)); const shiftDefinition = workEvent ? { ...(DEFAULT_WORK_PREFERENCES[workEvent.type] || {}), ...(workSchedule.shiftTypes?.[workEvent.type] || {}) } : null; const previousWork = previousEvents.find(event => WORK_TYPES.has(event.type))?.type || null; const shiftChanged = Boolean(workEvent && previousWork && previousWork !== workEvent.type); const manualPreference = manual?.preference && manual.preference !== 'auto' ? manual.preference : null; const mealPreference = shiftDefinition?.meal === meal ? (manualPreference || shiftDefinition.preference || 'normal') : shiftChanged && meal === 'dinner' ? 'makeAhead' : 'normal';
  let papa = 1;
  if (!leave && types.has('absence')) papa = 0;
  if (!leave && meal === 'lunch' && (types.has('morning') || types.has('return-morning'))) papa = 0;
  if (!leave && meal === 'dinner' && (types.has('afternoon') || types.has('return-afternoon'))) papa = 0;
  const canteen = meal === 'lunch' && schoolDay && [1, 2, 4, 5].includes(weekday);
  const childrenAway = meal === 'lunch' && (canteen || centre);
  const servings = papa + 1 + (childrenAway ? 0 : 1);
  return { servings, papaPresent: Boolean(papa), madamePresent: true, childrenPresent: !childrenAway, canteen, centre, afterNight, busy: Boolean(busyEvent), busyReason: busyEvent?.type || null, workShift: workEvent?.type || null, shiftChanged, mealPreference, schoolHoliday, events: events.map(item => item.title) };
}

function datesBetween(start, end) { const dates = []; for (let d = new Date(`${start}T12:00:00`), last = new Date(`${end}T12:00:00`); d <= last; d.setDate(d.getDate() + 1)) dates.push(new Date(d)); return dates; }
const seasonsForRecipe = recipe => Array.isArray(recipe.seasons) && recipe.seasons.length ? recipe.seasons : recipe.season === 'Toute saison' ? ['Printemps', 'Été', 'Automne', 'Hiver'] : [recipe.season];
const mealsForRecipe = recipe => Array.isArray(recipe.meals) && recipe.meals.length ? recipe.meals : ['lunch', 'dinner'];
function score(recipe, { season, recent, index }) { const seasons = seasonsForRecipe(recipe); let value = seasons.includes(season) ? (seasons.length === 4 ? 15 : 50) : 0; value -= (recent.get(recipe.id) || 0) * 60; value -= Math.abs((index % 7) - ((recipe.title || '').length % 7)); return value; }
function matchesPreference(recipe, preference) { return preference === 'express' ? recipe.express === true : preference === 'transportable' ? recipe.transportable === true : preference === 'makeAhead' ? recipe.makeAhead === true : true; }

function generatePlan(state, { startDate, endDate, soloMadame = [], expressDates = [] }) {
  const dates = datesBetween(startDate, endDate); if (!dates.length || dates.length > 62) throw new Error('La période doit contenir entre 1 et 62 jours.');
  const recipes = state.recipes.filter(recipe => recipe.ingredients?.length); if (!recipes.length) throw new Error('Aucune recette disponible.');
  const recent = new Map(); const meals = []; state.leftovers = (state.leftovers || []).filter(item => !['planned'].includes(item.status)); const available = state.leftovers.find(item => item.status === 'conserved' && item.remainingServings > 0 && recipes.some(recipe => recipe.id === item.recipeId)); let plannedLeftover = available ? { recipe: recipes.find(recipe => recipe.id === available.recipeId), remainingServings: available.remainingServings, record: available } : null;
  const nextLeftoverNeed = (recipe, currentDayIndex, currentMealIndex) => {
    for (let futureDayIndex = currentDayIndex; futureDayIndex < dates.length; futureDayIndex += 1) {
      for (let futureMealIndex = 0; futureMealIndex < 2; futureMealIndex += 1) {
        if (futureDayIndex === currentDayIndex && futureMealIndex <= currentMealIndex) continue;
        const futureMeal = futureMealIndex === 0 ? 'lunch' : 'dinner'; if (!mealsForRecipe(recipe).includes(futureMeal)) continue;
        const futureKey = dateKey(dates[futureDayIndex]); const futureAttendance = attendanceFor(futureKey, futureMeal, state.calendar, state.workSchedule); const futureSolo = soloMadame.includes(futureKey) || futureAttendance.servings === 1;
        if (futureSolo || futureMeal === 'lunch') return { servings: futureSolo ? 1 : futureAttendance.servings, date: futureKey, meal: futureMeal };
      }
    }
    return null;
  };
  dates.forEach((date, dayIndex) => ['lunch', 'dinner'].forEach((meal, mealIndex) => {
    const key = dateKey(date); const attendance = attendanceFor(key, meal, state.calendar, state.workSchedule); const isSolo = soloMadame.includes(key) || attendance.servings === 1; const servings = isSolo ? 1 : attendance.servings; let recipe; let fromLeftover = false; let leftoverId = null; let leftoverSourceDate = null;
    if (plannedLeftover && mealsForRecipe(plannedLeftover.recipe).includes(meal) && plannedLeftover.remainingServings >= servings && (isSolo || meal === 'lunch')) { recipe = plannedLeftover.recipe; plannedLeftover.remainingServings -= servings; plannedLeftover.record.remainingServings = plannedLeftover.remainingServings; plannedLeftover.record.status = plannedLeftover.remainingServings > 0 ? 'conserved' : 'planned'; fromLeftover = true; leftoverId = plannedLeftover.record.id; leftoverSourceDate = plannedLeftover.record.sourceDate; if (plannedLeftover.remainingServings <= 0) plannedLeftover = null; }
    const preference = attendance.mealPreference || 'normal'; const expressRequired = isSolo || expressDates.includes(key) || attendance.afterNight || attendance.busy || preference === 'express'; let expressSelected = false;
    if (!recipe) { const season = seasonFor(date); const mealRecipes = recipes.filter(item => mealsForRecipe(item).includes(meal)); if (!mealRecipes.length) throw new Error(`Aucune recette prévue pour le ${meal === 'lunch' ? 'déjeuner' : 'dîner'}.`); const seasonal = mealRecipes.filter(item => seasonsForRecipe(item).includes(season)); const compatible = seasonal.length ? seasonal : mealRecipes; const preferred = compatible.filter(item => matchesPreference(item, preference)); const express = compatible.filter(item => item.express === true); const candidates = preference !== 'normal' && preferred.length ? preferred : expressRequired && express.length ? express : compatible; expressSelected = expressRequired && candidates.some(item => item.express === true); const ranked = candidates.map((item, index) => ({ item, value: score(item, { season, recent, index: dayIndex * 2 + mealIndex + index }) })).sort((a, b) => b.value - a.value); recipe = ranked[0].item; recent.set(recipe.id, (recent.get(recipe.id) || 0) + 1); }
    expressSelected = expressRequired && recipe.express === true; const entry = { id: randomUUID(), date: key, meal, recipeId: recipe.id, servings, cookedServings: servings, attendance, isSoloMadame: isSolo, express: expressSelected, mealPreference: preference, fromLeftover, leftoverId, leftoverSourceDate };
    if (!fromLeftover && !plannedLeftover && !isSolo && recipe.leftoverFriendly !== false && (dayIndex + mealIndex) % 3 === 0) { const target = nextLeftoverNeed(recipe, dayIndex, mealIndex); if (target?.servings > 0) { entry.cookedServings += target.servings; entry.plannedLeftover = { servings: target.servings, targetDate: target.date, targetMeal: target.meal }; const record = { id: randomUUID(), recipeId: recipe.id, sourceMealId: entry.id, sourceDate: key, targetDate: target.date, targetMeal: target.meal, targetServings: target.servings, initialServings: target.servings, remainingServings: target.servings, status: 'conserved', createdAt: new Date().toISOString() }; state.leftovers.push(record); plannedLeftover = { recipe, remainingServings: target.servings, record }; } }
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

module.exports = { FAMILY_PORTIONS, seasonFor, datesBetween, attendanceFor, generatePlan, recalculatePlanShopping, scaledIngredients, score, seasonsForRecipe, mealsForRecipe };
