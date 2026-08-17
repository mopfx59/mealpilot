const fold = value => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('fr')
  .replace(/œ/g, 'oe')
  .replace(/æ/g, 'ae');

function recipeText(recipe) {
  // Do not feed the old category back into classification. A bad guess must
  // not keep a recipe trapped in the same category forever.
  return fold([recipe.title, recipe.description, ...(recipe.ingredients || []).map(item => item.name)].join(' '));
}

function inferCategory(recipe) {
  const title = fold(recipe.title);
  const value = recipeText(recipe);
  // The dish name is authoritative. Descriptions and ingredients are only
  // used later for broad protein-based fallbacks.
  if (/\b(tarte|tourte|flammekueche)\b/.test(title)) return 'Tartes salées';
  if (/\bquiche\b/.test(title)) return 'Quiches';
  if (/\b(gratin|tartiflette|raclette)\b/.test(title)) return 'Gratins';
  if (/\b(salade|taboule|coleslaw)\b/.test(title)) return 'Salades composées';
  if (/\b(lasagnes?|spaghettis?|tagliatelles?|raviolis?|gnocchis?|pates?|pasta|one pot)\b/.test(title)) return 'Pâtes';
  if (/\b(soupe|veloute|potage|bouillon)\b/.test(title)) return 'Soupes et veloutés';
  if (/\brisotto\b/.test(title)) return 'Risottos';
  if (/\b(curry|dahl|chili)\b/.test(title)) return 'Currys et plats épicés';
  if (/\b(carbonade|blanquette|bourguignon|pot[- ]?au[- ]?feu|potee|navarin|cassoulet|ragout|boeuf[- ]?carottes?|poulet basquaise|porc au cidre|lentilles? saucisses?)\b/.test(title)) return 'Plats mijotés';
  if (/\b(brochette|grillade)\b/.test(title)) return /poisson|saumon|thon|cabillaud|crevette/.test(value) ? 'Poissons et fruits de mer' : 'Viandes et volailles';
  if (/\b(ratatouille|legumes? farcis?|galettes? de legumes?)\b/.test(title)) return 'Plats végétariens';
  if (/\b(omelette|oeufs?|tofu)\b/.test(title)) return 'Plats végétariens';
  if (/\b(poisson|saumon|thon|cabillaud|colin|truite|sardine|crevette|moule)\b/.test(value)) return 'Poissons et fruits de mer';
  if (/\b(poulet|dinde|boeuf|porc|veau|agneau|jambon|saucisse|chorizo|canard)\b/.test(value)) return 'Viandes et volailles';
  if (/\b(omelette|oeuf|vegetarien|legumineuse|lentille|pois chiche|tofu)\b/.test(value)) return 'Plats végétariens';
  return 'Autres plats';
}

function inferSeasons(recipe, category = inferCategory(recipe)) {
  const value = recipeText(recipe);
  if (/\bpoulet basquaise\b/.test(fold(recipe.title))) return ['Printemps', 'Été'];
  const winterCategory = ['Plats mijotés', 'Gratins', 'Soupes et veloutés', 'Currys et plats épicés'].includes(category);
  const winterFood = /\b(potimarron|courge|butternut|poireau|chou|endive|navet|raclette|tartiflette|mont d'or|reblochon)\b/.test(value);
  if (winterCategory || winterFood) return ['Automne', 'Hiver'];
  if (category === 'Salades composées' || /\b(tomate|courgette|aubergine|poivron|asperge|peche|melon|fraise|grillade|brochette)\b/.test(value)) return ['Printemps', 'Été'];
  const coldWeather = /\b(puree|pommes? de terre|lentilles?|saucisses?|boeuf|veau|porc|agneau|canard|jambon|cordon bleu|creme|fromage fondu)\b/.test(value);
  return coldWeather ? ['Automne', 'Hiver'] : ['Printemps', 'Été'];
}

function classifyRecipe(recipe) {
  const category = inferCategory(recipe);
  const seasons = inferSeasons(recipe, category);
  return { category, seasons, season: seasons[0], seasonalGroup: seasons.includes('Hiver') ? 'Automne–Hiver' : 'Printemps–Été', classificationVersion: 4 };
}

module.exports = { inferCategory, inferSeasons, classifyRecipe };
