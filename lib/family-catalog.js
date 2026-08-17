const { randomUUID } = require('node:crypto');
const { classicRecipes } = require('./classics');
const { classifyRecipe } = require('./recipe-classification');

const CATALOG_SPRITE = '/assets/family-catalog-v2.png';
const positions = Array.from({ length: 20 }, (_, index) => `${(index % 5) * 25}% ${Math.floor(index / 5) * 33.333}%`);
const i = (name, quantity = '', unit = '') => ({ name, quantity, unit });
const entries = [
  ['Risotto aux asperges',25,[i('riz arborio',300,'g'),i('asperges vertes',500,'g'),i('bouillon de légumes',1,'L'),i('parmesan',80,'g')],['Blanchir les asperges.','Nacrer le riz puis ajouter progressivement le bouillon.','Ajouter les asperges et le parmesan.']],
  ['Ratatouille provençale',45,[i('courgettes',2,'pièces'),i('aubergine',1,'pièce'),i('poivrons',2,'pièces'),i('tomates',5,'pièces')],['Découper les légumes.','Les faire revenir avec un peu d’huile.','Assaisonner et mijoter 30 minutes.']],
  ['Salade de poulet aux pêches',25,[i('blancs de poulet',4,'pièces'),i('pêches',3,'pièces'),i('salade',1,'pièce'),i('amandes',50,'g')],['Griller le poulet.','Découper les pêches.','Assembler et assaisonner.']],
  ['Salade de pâtes au thon',25,[i('pâtes courtes',350,'g'),i('thon',280,'g'),i('tomates',4,'pièces'),i('maïs',150,'g'),i('œufs',4,'pièces')],['Cuire les pâtes et les œufs.','Laisser refroidir.','Mélanger tous les ingrédients et assaisonner.']],
  ['Taboulé au poulet',25,[i('semoule',300,'g'),i('poulet',500,'g'),i('tomates',4,'pièces'),i('concombre',1,'pièce'),i('citron',1,'pièce')],['Faire gonfler la semoule.','Cuire et découper le poulet.','Ajouter les légumes et le citron puis réserver au frais.']],
  ['Quiche courgettes et chèvre',45,[i('pâte brisée',1,'pièce'),i('courgettes',2,'pièces'),i('chèvre',150,'g'),i('œufs',3,'pièces'),i('crème',20,'cl')],['Poêler les courgettes.','Répartir sur la pâte avec le chèvre.','Verser les œufs battus avec la crème et cuire 35 minutes à 190 °C.']],
  ['Brochettes de poulet aux poivrons',30,[i('poulet',600,'g'),i('poivrons',3,'pièces'),i('oignon rouge',1,'pièce')],['Découper le poulet et les légumes.','Monter les brochettes.','Cuire 15 minutes en les retournant.']],
  ['Saumon au four et courgettes',30,[i('pavés de saumon',4,'pièces'),i('courgettes',3,'pièces'),i('citron',1,'pièce'),i('riz',300,'g')],['Déposer le saumon et les courgettes dans un plat.','Assaisonner et ajouter le citron.','Cuire 20 minutes à 190 °C et servir avec le riz.']],
  ['Wraps poulet crudités',20,[i('tortillas',8,'pièces'),i('poulet cuit',400,'g'),i('salade',1,'pièce'),i('tomates',3,'pièces'),i('fromage frais',150,'g')],['Tartiner les tortillas.','Ajouter poulet et crudités.','Rouler et servir.']],
  ['Pâtes aux légumes du soleil',25,[i('pâtes',400,'g'),i('courgette',1,'pièce'),i('poivron',1,'pièce'),i('tomates cerises',300,'g')],['Cuire les pâtes.','Poêler les légumes.','Mélanger et servir.']],
  ['Velouté de potimarron',40,[i('potimarron',1,'pièce'),i('pommes de terre',300,'g'),i('bouillon',750,'ml'),i('crème',10,'cl')],['Couper les légumes.','Cuire dans le bouillon.','Mixer avec la crème.']],
  ['Bœuf-carottes',120,[i('bœuf à braiser',800,'g'),i('carottes',1,'kg'),i('oignons',2,'pièces'),i('bouillon',500,'ml')],['Faire dorer la viande.','Ajouter légumes et bouillon.','Couvrir et mijoter 2 heures.']],
  ['Chili con carne familial',45,[i('bœuf haché',500,'g'),i('haricots rouges',500,'g'),i('tomates concassées',500,'g'),i('riz',300,'g')],['Faire revenir la viande.','Ajouter haricots et tomates.','Mijoter 30 minutes et servir avec le riz.']],
  ['Poulet à la moutarde',35,[i('filets de poulet',4,'pièces'),i('crème',25,'cl'),i('moutarde',2,'c. à soupe'),i('champignons',250,'g')],['Faire dorer le poulet.','Ajouter les champignons.','Verser crème et moutarde puis mijoter 15 minutes.']],
  ['Gratin de chou-fleur au jambon',45,[i('chou-fleur',1,'pièce'),i('jambon',4,'tranches'),i('béchamel',50,'cl'),i('fromage râpé',120,'g')],['Cuire le chou-fleur.','Ajouter le jambon et la béchamel.','Parsemer de fromage et gratiner 20 minutes.']],
  ['Sauté de porc aux carottes',70,[i('porc à sauté',800,'g'),i('carottes',6,'pièces'),i('oignons',2,'pièces'),i('bouillon',40,'cl')],['Faire dorer la viande.','Ajouter les légumes et le bouillon.','Couvrir et mijoter 50 minutes.']],
  ['Parmentier de poisson',55,[i('poisson blanc',600,'g'),i('pommes de terre',1,'kg'),i('lait',20,'cl'),i('fromage râpé',80,'g')],['Préparer une purée.','Cuire et émietter le poisson.','Couvrir de purée et gratiner 20 minutes.']],
  ['Curry de pois chiches',30,[i('pois chiches',500,'g'),i('lait de coco',400,'ml'),i('tomates concassées',400,'g'),i('riz',300,'g')],['Faire revenir les épices.','Ajouter pois chiches, tomates et lait de coco.','Mijoter 20 minutes et servir avec le riz.']]
];

function familyCatalog() {
  const additions = entries.map(([title,totalMinutes,ingredients,preparation], index) => ({ id: `family-${randomUUID()}`, title, description: 'Une recette familiale simple, avec des ingrédients courants.', totalMinutes, prepMinutes: Math.min(20,totalMinutes), servings: 4, ingredients, preparation, image: CATALOG_SPRITE, imagePosition: positions[index], imageSize: '500% 400%', source: 'Image et recette originales MealPilot', personal: false, favorite: false }));
  return [...classicRecipes(), ...additions].map(recipe => ({ ...recipe, ...classifyRecipe(recipe), meals: ['lunch','dinner'], express: recipe.totalMinutes <= 30, transportable: /salade|wrap|quiche|tarte/i.test(recipe.title), makeAhead: recipe.totalMinutes > 30, leftoverFriendly: !/salade|brochette|wrap/i.test(recipe.title) }));
}

module.exports = { familyCatalog, CATALOG_SPRITE };
