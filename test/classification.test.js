const test = require('node:test');
const assert = require('node:assert/strict');
const { inferCategory, inferSeasons } = require('../lib/recipe-classification');
const { seasonFor } = require('../lib/planner');

test('classe automatiquement les grandes familles de recettes', () => {
  assert.equal(inferCategory({ title: 'Tarte aux courgettes' }), 'Tartes salées');
  assert.equal(inferCategory({ title: 'Bœuf bourguignon' }), 'Plats mijotés');
  assert.equal(inferCategory({ title: 'Gratin dauphinois' }), 'Gratins');
  assert.equal(inferCategory({ title: 'Salade de poulet et pâtes' }), 'Salades composées');
});

test('donne la priorité au nom du plat et ignore les anciennes catégories erronées', () => {
  assert.equal(inferCategory({ title: 'Bœuf-carottes', category: 'Soupes et veloutés', ingredients: [{ name: 'bouillon de bœuf' }] }), 'Plats mijotés');
  assert.equal(inferCategory({ title: 'Lasagnes au saumon', category: 'Soupes et veloutés', ingredients: [{ name: 'saumon' }] }), 'Pâtes');
  assert.equal(inferCategory({ title: 'Brochettes de poulet', category: 'Soupes et veloutés', ingredients: [{ name: 'poulet' }] }), 'Viandes et volailles');
  assert.equal(inferCategory({ title: 'Soupe de légumes', ingredients: [{ name: 'pâtes' }] }), 'Soupes et veloutés');
  assert.equal(inferCategory({ title: 'Salade de pâtes au thon', ingredients: [{ name: 'thon' }] }), 'Salades composées');
});

test('déduit automatiquement les saisons culinaires', () => {
  assert.deepEqual(inferSeasons({ title: 'Gratin dauphinois' }, 'Gratins'), ['Automne', 'Hiver']);
  assert.deepEqual(inferSeasons({ title: 'Salade tomates mozzarella' }, 'Salades composées'), ['Printemps', 'Été']);
});

test('applique la période hiver familiale du 10 octobre au 31 mars', () => {
  assert.equal(seasonFor(new Date('2026-10-09T12:00:00')), 'Été');
  assert.equal(seasonFor(new Date('2026-10-10T12:00:00')), 'Hiver');
  assert.equal(seasonFor(new Date('2027-03-31T12:00:00')), 'Hiver');
  assert.equal(seasonFor(new Date('2027-04-01T12:00:00')), 'Printemps');
});
