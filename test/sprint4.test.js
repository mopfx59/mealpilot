const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyEvent, expandEvents, authorizationUrl, fetchEvents, fetchZoneBHolidays } = require('../lib/calendar');
const { attendanceFor, generatePlan, frenchPublicHoliday, ageOn, portionForAge } = require('../lib/planner');

test('reconnaît les libellés de travail, congés et centre', () => {
  assert.equal(classifyEvent('R Matin'), 'return-morning');
  assert.equal(classifyEvent('Après-midi'), 'afternoon');
  assert.equal(classifyEvent('R Après-midi'), 'return-afternoon');
  assert.equal(classifyEvent('Nuit'), 'night');
  assert.equal(classifyEvent('Congés'), 'leave');
  assert.equal(classifyEvent('Repos'), 'rest');
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
  const attendance=attendanceFor('2026-09-07', 'lunch', calendar); assert.equal(attendance.servings,1); assert.equal(attendance.papaPresent,false); assert.equal(attendance.canteen,true); assert.deepEqual(attendance.children.map(child=>child.status),['canteen','canteen']);
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

test('une correction EDF datée remplace le poste importé', () => {
  const calendar = { events: [{ date: '2026-08-05', title: 'Après-midi', type: 'afternoon' }], schoolHolidays: [] };
  const workSchedule = { shiftTypes: { rest: { label: 'Repos', meal: '', preference: 'normal' } }, entries: [{ date: '2026-08-05', type: 'rest', preference: 'auto' }] };
  const attendance = attendanceFor('2026-08-05', 'dinner', calendar, workSchedule);
  assert.equal(attendance.papaPresent, true); assert.equal(attendance.workShift, 'rest');
});

test('les postes EDF déterminent le type de repas et les changements de poste', () => {
  const calendar = { events: [{ date: '2026-08-04', title: 'Matin', type: 'morning' }, { date: '2026-08-05', title: 'Après-midi', type: 'afternoon' }], schoolHolidays: [] };
  const lunch = attendanceFor('2026-08-04', 'lunch', calendar);
  const dinner = attendanceFor('2026-08-05', 'dinner', calendar);
  assert.equal(lunch.mealPreference, 'transportable'); assert.equal(dinner.mealPreference, 'makeAhead'); assert.equal(dinner.shiftChanged, true);
});

test('une correction manuelle fonctionne même sans agenda Google', () => {
  const workSchedule = { shiftTypes: { morning: { label: 'Matin', meal: 'lunch', preference: 'transportable' } }, entries: [{ date: '2026-08-05', type: 'morning', preference: 'express' }] };
  const attendance = attendanceFor('2026-08-05', 'lunch', {}, workSchedule);
  assert.equal(attendance.papaPresent, false); assert.equal(attendance.mealPreference, 'express');
});

test('gère séparément la cantine et les portions des deux enfants', () => {
  const familySchedule={children:[{id:'child1',name:'Alice',portion:0.6,canteenDays:[1]},{id:'child2',name:'Tom',portion:0.4,canteenDays:[]}],exceptions:[],specialDays:[]};
  const attendance=attendanceFor('2026-09-07','lunch',{events:[],schoolHolidays:[]},{},familySchedule);
  assert.equal(attendance.servings,2.4); assert.deepEqual(attendance.children.map(child=>[child.name,child.status]),[['Alice','canteen'],['Tom','home']]);
});

test('une exception familiale remplace les habitudes pour chaque repas', () => {
  const familySchedule={children:[{id:'child1',name:'Alice',portion:0.6,canteenDays:[1]},{id:'child2',name:'Tom',portion:0.4,canteenDays:[1]}],exceptions:[{date:'2026-09-07',memberId:'child1',lunch:'home',dinner:'outside'}],specialDays:[]};
  assert.equal(attendanceFor('2026-09-07','lunch',{events:[],schoolHolidays:[]},{},familySchedule).servings,2.6);
  assert.equal(attendanceFor('2026-09-07','dinner',{events:[],schoolHolidays:[]},{},familySchedule).servings,2.4);
});

test('les jours fériés, ponts et fermetures neutralisent la cantine', () => {
  const base={children:[{id:'child1',name:'Alice',portion:0.6,canteenDays:[1,2,3,4,5]},{id:'child2',name:'Tom',portion:0.4,canteenDays:[1,2,3,4,5]}],exceptions:[],specialDays:[]};
  assert.equal(frenchPublicHoliday('2026-05-14'),'Ascension');
  assert.equal(attendanceFor('2026-05-14','lunch',{events:[],schoolHolidays:[]},{},base).servings,3);
  assert.equal(attendanceFor('2026-05-15','lunch',{events:[],schoolHolidays:[]},{},{...base,specialDays:[{date:'2026-05-15',type:'bridge'}]}).servings,3);
  assert.equal(attendanceFor('2026-09-08','lunch',{events:[],schoolHolidays:[]},{},{...base,specialDays:[{date:'2026-09-08',type:'canteenClosed'}]}).servings,3);
});

test('reconnaît un repas extérieur dans Google Agenda', () => {
  assert.equal(classifyEvent('Repas extérieur'),'outside');
  const attendance=attendanceFor('2026-09-08','dinner',{events:[{date:'2026-09-08',title:'Repas extérieur',type:'outside'}],schoolHolidays:[]});
  assert.equal(attendance.servings,2); assert.ok(attendance.children.every(child=>child.status==='outside'));
});

test('calcule automatiquement l’âge et la portion à la date du repas', () => {
  assert.equal(ageOn('2020-09-08','2026-09-07'),5); assert.equal(ageOn('2020-09-08','2026-09-08'),6);
  assert.equal(portionForAge(5),0.5); assert.equal(portionForAge(6),0.7); assert.equal(portionForAge(13),1);
  const familySchedule={children:[{id:'child1',name:'Alice',birthDate:'2020-09-08',portion:0.6,canteenDays:[]},{id:'child2',name:'Tom',birthDate:'2023-01-01',portion:0.4,canteenDays:[]}],exceptions:[],specialDays:[]};
  assert.equal(attendanceFor('2026-09-07','dinner',{events:[],schoolHolidays:[]},{},familySchedule).servings,3);
  assert.equal(attendanceFor('2026-09-08','dinner',{events:[],schoolHolidays:[]},{},familySchedule).servings,3.2);
});

test('ajoute Noé uniquement sur son week-end indiqué dans Google Agenda', () => {
  const familySchedule={children:[{id:'child1',name:'Alice',birthDate:'2020-01-01',presenceMode:'always',canteenDays:[]},{id:'child2',name:'Tom',birthDate:'2022-01-01',presenceMode:'always',canteenDays:[]},{id:'child3',name:'Noé',birthDate:'2018-01-01',presenceMode:'calendar',calendarKeyword:'Noé',canteenDays:[]}],exceptions:[],specialDays:[]};
  const calendar={events:[{date:'2026-09-05',title:'Week-end Noé',type:null}],schoolHolidays:[]};
  assert.equal(attendanceFor('2026-09-04','lunch',calendar,{},familySchedule).children[2].present,false);
  assert.equal(attendanceFor('2026-09-04','dinner',calendar,{},familySchedule).children[2].present,true);
  assert.equal(attendanceFor('2026-09-05','lunch',calendar,{},familySchedule).children[2].present,true);
  assert.equal(attendanceFor('2026-09-06','lunch',calendar,{},familySchedule).children[2].present,true);
  assert.equal(attendanceFor('2026-09-06','dinner',calendar,{},familySchedule).children[2].present,false);
  assert.equal(attendanceFor('2026-09-07','lunch',calendar,{},familySchedule).children[2].present,false);
});

test('suit Noé chaque jour couvert par son événement pendant les vacances', () => {
  const familySchedule={children:[{id:'child3',name:'Noé',birthDate:'2018-01-01',presenceMode:'calendar',calendarKeyword:'Noé',canteenDays:[]}],exceptions:[],specialDays:[]};
  const calendar={events:[{date:'2026-10-20',title:'Vacances Noé',type:null},{date:'2026-10-21',title:'Vacances Noé',type:null}],schoolHolidays:[{start:'2026-10-17',end:'2026-11-02'}]};
  assert.equal(attendanceFor('2026-10-20','dinner',calendar,{},familySchedule).children[0].present,true);
  assert.equal(attendanceFor('2026-10-21','lunch',calendar,{},familySchedule).children[0].present,true);
  assert.equal(attendanceFor('2026-10-22','lunch',calendar,{},familySchedule).children[0].present,false);
});

test('retire la portion de Papa lorsqu’il mange à la cantine EDF', () => {
  const calendar={events:[{date:'2026-09-08',title:'Après-midi',type:'afternoon'}],schoolHolidays:[]};
  const workSchedule={shiftTypes:{afternoon:{label:'Après-midi',meal:'dinner',preference:'workCanteen'}},entries:[]};
  const attendance=attendanceFor('2026-09-08','dinner',calendar,workSchedule);
  assert.equal(attendance.papaPresent,false); assert.equal(attendance.servings,2); assert.equal(attendance.mealPreference,'workCanteen');
});

test('un poste de nuit conserve le dîner familial et impose un déjeuner express au réveil', () => {
  const calendar={events:[{date:'2026-09-08',title:'Nuit',type:'night'}],schoolHolidays:[]};
  const workSchedule={shiftTypes:{night:{label:'Nuit',meal:'dinner',preference:'workCanteen'}},entries:[]};
  const dinner=attendanceFor('2026-09-08','dinner',calendar,workSchedule),lunch=attendanceFor('2026-09-09','lunch',calendar,workSchedule);
  assert.equal(dinner.papaPresent,true); assert.equal(dinner.servings,3); assert.equal(lunch.afterNight,true);
});
