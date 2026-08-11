const fold = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr');

function recipeText(recipe) {
  return fold([recipe.title, recipe.category, recipe.description, ...(recipe.ingredients || []).map(item => item.name)].join(' '));
}

function inferCategory(recipe) {
  const value = recipeText(recipe);
  if (/\b(tarte|tourte|flammekueche)\b/.test(value)) return 'Tartes salées';
  if (/\b(quiche)\b/.test(value)) return 'Quiches';
  if (/\b(gratin|tartiflette|raclette)\b/.test(value)) return 'Gratins';
  if (/\b(mijote|carbonade|blanquette|bourguignon|pot[- ]?au[- ]?feu|potee|navarin|cassoulet|ragout|boeuf carottes)\b/.test(value)) return 'Plats mijotés';
  if (/\b(salade|taboule|coleslaw)\b/.test(value)) return 'Salades composées';
  if (/\b(soupe|veloute|potage|bouillon)\b/.test(value)) return 'Soupes et veloutés';
  if (/\b(risotto)\b/.test(value)) return 'Risottos';
  if (/\b(pates|spaghetti|tagliatelle|lasagne|ravioli|gnocchi)\b/.test(value)) return 'Pâtes';
  if (/\b(curry|dahl|chili)\b/.test(value)) return 'Currys et plats épicés';
  if (/\b(poisson|saumon|thon|cabillaud|colin|truite|sardine|crevette|moule)\b/.test(value)) return 'Poissons et fruits de mer';
  if (/\b(poulet|dinde|boeuf|porc|veau|agneau|jambon|saucisse|chorizo|canard)\b/.test(value)) return 'Viandes et volailles';
  if (/\b(omelette|oeuf|vegetarien|legumineuse|lentille|pois chiche|tofu)\b/.test(value)) return 'Plats végétariens';
  return 'Autres plats';
}

function inferSeasons(recipe, category = inferCategory(recipe)) {
  const value = recipeText(recipe);
  const winterCategory = ['Plats mijotés', 'Gratins', 'Soupes et veloutés'].includes(category);
  const winterFood = /\b(potimarron|courge|butternut|poireau|chou|endive|navet|raclette|tartiflette|mont d'or|reblochon)\b/.test(value);
  if (winterCategory || winterFood) return ['Hiver'];
  if (category === 'Salades composées' || /\b(tomate|courgette|aubergine|poivron|asperge|peche|melon|fraise|grillade|brochette)\b/.test(value)) return ['Printemps', 'Été'];
  return ['Printemps', 'Été'];
}

function classifyRecipe(recipe) {
  const category = inferCategory(recipe);
  const seasons = inferSeasons(recipe, category);
  return { category, seasons, season: seasons.length === 1 ? seasons[0] : seasons[0], classificationVersion: 1 };
}

module.exports = { inferCategory, inferSeasons, classifyRecipe };
