const test = require('node:test');
const assert = require('node:assert/strict');
const { attendanceFor } = require('../lib/planner');

const familySchedule = {
  children: [
    { id: 'child1', name: 'Léa', portion: 0.5, presenceMode: 'always', canteenDays: [1, 2, 4, 5], centreDays: [1, 2, 3, 4, 5] },
    { id: 'child2', name: 'Maël', portion: 0.7, presenceMode: 'always', canteenDays: [1, 2, 4, 5], centreDays: [1, 2, 3, 4, 5] }
  ],
  exceptions: [],
  specialDays: []
};

test('ne met pas les enfants au centre pendant les vacances sans événement Agenda', () => {
  const calendar = { events: [], schoolHolidays: [{ start: '2026-08-01', end: '2026-08-31' }] };
  const attendance = attendanceFor('2026-08-17', 'lunch', calendar, {}, familySchedule);
  assert.equal(attendance.servings, 3.2);
  assert.deepEqual(attendance.children.map(child => child.status), ['home', 'home']);
  assert.equal(attendance.centre, false);
});

test('met les enfants au centre lorsque Google Agenda contient Centre', () => {
  const calendar = { events: [{ date: '2026-08-17', title: 'Centre', type: 'centre' }], schoolHolidays: [{ start: '2026-08-01', end: '2026-08-31' }] };
  const attendance = attendanceFor('2026-08-17', 'lunch', calendar, {}, familySchedule);
  assert.equal(attendance.servings, 2);
  assert.deepEqual(attendance.children.map(child => child.status), ['centre', 'centre']);
  assert.equal(attendance.centre, true);
});
