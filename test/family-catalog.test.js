const test = require('node:test');
const assert = require('node:assert/strict');
const { familyCatalog } = require('../lib/family-catalog');

test('fournit un catalogue familial propre réparti entre les deux périodes', () => {
  const recipes = familyCatalog(); const titles = new Set(recipes.map(recipe => recipe.title));
  assert.ok(recipes.length >= 35); assert.equal(titles.size, recipes.length);
  assert.ok(recipes.every(recipe => recipe.ingredients.length >= 3 && recipe.preparation.length >= 3));
  assert.ok(recipes.every(recipe => recipe.seasonalGroup === 'Automne–Hiver' || recipe.seasonalGroup === 'Printemps–Été'));
  assert.ok(recipes.some(recipe => recipe.seasonalGroup === 'Automne–Hiver'));
  assert.ok(recipes.some(recipe => recipe.seasonalGroup === 'Printemps–Été'));
});
