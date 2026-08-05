const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyEvent, expandEvents, authorizationUrl, fetchEvents, fetchZoneBHolidays } = require('../lib/calendar');
const { attendanceFor, generatePlan } = require('../lib/planner');

test('reconnaît les libellés de travail, congés et centre', () => {
  assert.equal(classifyEvent('R Matin'), 'return-morning');
  assert.equal(classifyEvent('Après-midi'), 'afternoon');
  assert.equal(classifyEvent('R Après-midi'), 'return-afternoon');
  assert.equal(classifyEvent('Nuit'), 'night');
  assert.equal(classifyEvent('Congés'), 'leave');
  assert.equal(classifyEvent('Centre de loisirs'), 'centre');
  assert.equal(classifyEvent('Rendez-vous médecin'), 'appointment');
  assert.equal(classifyEvent('Soirée anniversaire'), 'busy-evening');
  assert.equal(classifyEvent('Absence'), 'absence');
});

test('déplie les événements Google sur leurs journées', () => {
  const events = expandEvents([{ id: '1', summary: 'Congés', start: { date: '2026-08-03' }, end: { date: '2026-08-06' } }]);
  assert.deepEqual(events.map(item => item.date), ['2026-08-03', '2026-08-04', '2026-08-05']);
});

test('applique cantine, vacances, centre et travail aux portions', () => {
  const calendar = { events: [{ date: '2026-09-07', title: 'Matin', type: 'morning' }], schoolHolidays: [] };
  assert.deepEqual(attendanceFor('2026-09-07', 'lunch', calendar), { servings: 1, papaPresent: false, madamePresent: true, childrenPresent: false, canteen: true, centre: false, afterNight: false, busy: false, busyReason: null, schoolHoliday: false, events: ['Matin'] });
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

test('détecte les rendez-vous aux heures des repas et les soirées chargées', () => {
  const calendar = { events: [{ date: '2026-08-12', title: 'Dentiste', type: 'appointment', startTime: '12:00', endTime: '13:00' }, { date: '2026-08-12', title: 'Concert', type: 'busy-evening' }], schoolHolidays: [] };
  assert.equal(attendanceFor('2026-08-12', 'lunch', calendar).busyReason, 'appointment');
  assert.equal(attendanceFor('2026-08-12', 'dinner', calendar).busyReason, 'busy-evening');
});

test('injecte les présences calculées dans le menu généré', () => {
  const state = { recipes: [{ id: 'r', title: 'Test', season: 'Toute saison', servings: 3, ingredients: [{ name: 'riz', quantity: 300, unit: 'g' }] }], calendar: { events: [], schoolHolidays: [] }, shopping: [] };
  const plan = generatePlan(state, { startDate: '2026-09-07', endDate: '2026-09-07' });
  assert.equal(plan.meals[0].servings, 2); assert.equal(plan.meals[0].attendance.canteen, true); assert.equal(plan.meals[1].servings, 3);
});

test('construit OAuth et lit les vacances zone B', async () => {
  const url = authorizationUrl('nonce', { GOOGLE_CLIENT_ID: 'client', GOOGLE_REDIRECT_URI: 'https://meal.test/api/calendar/callback' });
  assert.match(url, /calendar\.readonly/); assert.match(url, /state=nonce/);
  const holiday = { description: 'Vacances', start_date: '2026-07-04T00:00:00+00:00', end_date: '2026-09-01T00:00:00+00:00' }; const holidays = await fetchZoneBHolidays('2026-08-01', '2026-08-31', async () => ({ ok: true, json: async () => ({ results: [holiday, holiday] }) }));
  assert.deepEqual(holidays, [{ name: 'Vacances', start: '2026-07-04', end: '2026-09-01' }]);
});

test('importe et fusionne les événements de plusieurs agendas', async () => {
  const calendar = { accessToken: 'token', expiresAt: Date.now() + 3600000, calendarIds: ['travail', 'famille'] }; const calls = [];
  const events = await fetchEvents(calendar, '2026-08-01', '2026-08-02', async url => { calls.push(url); return { ok: true, json: async () => ({ items: [{ id: url.includes('travail') ? 't' : 'f', summary: 'RDV', start: { dateTime: '2026-08-01T12:00:00+02:00' }, end: { dateTime: '2026-08-01T13:00:00+02:00' } }] }) }; });
  assert.equal(calls.length, 2); assert.deepEqual(new Set(events.map(event => event.calendarId)), new Set(['travail', 'famille'])); assert.ok(events.every(event => event.type === 'appointment' && event.startTime === '12:00'));
});
