const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyEvent, expandEvents, authorizationUrl, fetchZoneBHolidays } = require('../lib/calendar');
const { attendanceFor, generatePlan } = require('../lib/planner');

test('reconnaît les libellés de travail, congés et centre', () => {
  assert.equal(classifyEvent('R Matin'), 'return-morning');
  assert.equal(classifyEvent('Après-midi'), 'afternoon');
  assert.equal(classifyEvent('R Après-midi'), 'return-afternoon');
  assert.equal(classifyEvent('Nuit'), 'night');
  assert.equal(classifyEvent('Congés'), 'leave');
  assert.equal(classifyEvent('Centre de loisirs'), 'centre');
});

test('déplie les événements Google sur leurs journées', () => {
  const events = expandEvents([{ id: '1', summary: 'Congés', start: { date: '2026-08-03' }, end: { date: '2026-08-06' } }]);
  assert.deepEqual(events.map(item => item.date), ['2026-08-03', '2026-08-04', '2026-08-05']);
});

test('applique cantine, vacances, centre et travail aux portions', () => {
  const calendar = { events: [{ date: '2026-09-07', title: 'Matin', type: 'morning' }], schoolHolidays: [] };
  assert.deepEqual(attendanceFor('2026-09-07', 'lunch', calendar), { servings: 1, papaPresent: false, madamePresent: true, childrenPresent: false, canteen: true, centre: false, afterNight: false, schoolHoliday: false, events: ['Matin'] });
  calendar.schoolHolidays = [{ start: '2026-09-01', end: '2026-09-10' }];
  assert.equal(attendanceFor('2026-09-07', 'lunch', calendar).servings, 2);
  calendar.events.push({ date: '2026-09-07', title: 'Congés', type: 'leave' }, { date: '2026-09-07', title: 'Centre', type: 'centre' });
  assert.equal(attendanceFor('2026-09-07', 'lunch', calendar).servings, 2);
});

test('une nuit conserve les portions et rend seulement le déjeuner suivant rapide', () => {
  const calendar = { events: [{ date: '2026-08-12', title: 'Nuit', type: 'night' }], schoolHolidays: [{ start: '2026-07-01', end: '2026-08-31' }] };
  assert.equal(attendanceFor('2026-08-12', 'lunch', calendar).servings, 3);
  assert.equal(attendanceFor('2026-08-12', 'dinner', calendar).servings, 3);
  assert.equal(attendanceFor('2026-08-13', 'lunch', calendar).servings, 3);
  assert.equal(attendanceFor('2026-08-13', 'lunch', calendar).afterNight, true);
  assert.equal(attendanceFor('2026-08-13', 'dinner', calendar).afterNight, false);
});

test('injecte les présences calculées dans le menu généré', () => {
  const state = { recipes: [{ id: 'r', title: 'Test', season: 'Toute saison', servings: 3, ingredients: [{ name: 'riz', quantity: 300, unit: 'g' }] }], calendar: { events: [], schoolHolidays: [] }, shopping: [] };
  const plan = generatePlan(state, { startDate: '2026-09-07', endDate: '2026-09-07' });
  assert.equal(plan.meals[0].servings, 2); assert.equal(plan.meals[0].attendance.canteen, true); assert.equal(plan.meals[1].servings, 3);
});

test('construit OAuth et lit les vacances zone B', async () => {
  const url = authorizationUrl('nonce', { GOOGLE_CLIENT_ID: 'client', GOOGLE_REDIRECT_URI: 'https://meal.test/api/calendar/callback' });
  assert.match(url, /calendar\.readonly/); assert.match(url, /state=nonce/);
  const holidays = await fetchZoneBHolidays('2026-08-01', '2026-08-31', async () => ({ ok: true, json: async () => ({ results: [{ description: 'Vacances', start_date: '2026-07-04T00:00:00+00:00', end_date: '2026-09-01T00:00:00+00:00' }] }) }));
  assert.deepEqual(holidays, [{ name: 'Vacances', start: '2026-07-04', end: '2026-09-01' }]);
});
