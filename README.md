# MealPilot

MealPilot est un planificateur de repas familial, responsive et auto-hébergé. Il permet d'organiser les repas du midi et du soir, de conserver ses recettes et de générer une liste de courses cochable.

## Sprint 4 — Agenda et présences

MealPilot peut lire un ou plusieurs agendas Google (OAuth 2.0, accès en lecture seule), reconnaître les événements `Matin`, `R Matin`, `Après-midi`, `R Après-midi`, `Nuit`, `Congés`, `Centre` et `Absence`, puis calculer les portions selon les personnes présentes. Les rendez-vous, événements horaires et soirées chargées (`Soirée`, `Restaurant`, `Anniversaire`, `Concert`, `Sortie`) déclenchent un menu express lorsque le repas est concerné. La synchronisation se fait depuis l’écran Agenda et automatiquement avant chaque génération de menu. La cantine est appliquée les lundi, mardi, jeudi et vendredi en période scolaire ; les vacances de la zone B sont récupérées depuis l’API officielle du ministère de l’Éducation nationale et dédupliquées.

L’éditeur de recettes utilise désormais des lignes structurées Quantité / Unité / Ingrédient, avec unités proposées, autocomplétion à partir du carnet, ajout et suppression de lignes.

Pour activer Google Calendar, créer un client OAuth « application Web » dans Google Cloud, activer l’API Google Calendar et définir dans l’environnement du conteneur :

```text
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://ADRESSE_DU_SERVEUR:8095/api/calendar/callback
```

La même URI doit être enregistrée comme URI de redirection autorisée dans Google Cloud. Les jetons, événements synchronisés et réglages sont conservés dans le volume persistant existant ; ils ne sont jamais renvoyés au navigateur.

## Sprint 3 — Collecte raisonnée et menus intelligents

MealPilot recherche automatiquement les recettes nécessaires, sans demander d'URL à l'utilisateur. Le collecteur utilise en priorité les blocs structurés `Recipe` en JSON-LD publiés par les pages et conserve toujours le nom de la source et l'URL d'origine.

Fournisseurs configurés et testés séparément :

- Marmiton, 750g, CuisineAZ et TheMealDB activés par défaut ;
- TheMealDB sert de source alternative structurée via son API publique lorsque les recherches HTML changent ou sont bloquées ;
- activation/désactivation indépendante depuis l'interface ou `PATCH /api/providers/:id` ;
- délai de 8 secondes, intervalle minimal de 1,8 seconde et cache local de 7 jours pour les recherches, pages, API et règles d’accès ;
- lecture de `robots.txt` avant la collecte HTML et refus des chemins interdits ;
- désactivation automatique persistante après trois échecs consécutifs, avec réactivation manuelle possible ;
- déduplication par empreinte du titre et des ingrédients.

La collecte est volontairement limitée à 12 recettes par demande (6 depuis l'interface). Elle ne constitue pas une copie massive des sites. Les fournisseurs peuvent modifier leur HTML, bloquer l'automatisation ou imposer leurs propres conditions : une source peut donc devenir temporairement indisponible. L'utilisation doit rester privée et respecter les conditions des sites.

Le générateur permet une période libre de 1 à 62 jours, crée les repas midi/soir et limite les répétitions. Les saisons changent aux dates calendaires : printemps le 20 mars, été le 21 juin, automne le 22 septembre et hiver le 21 décembre. Chaque recette peut appartenir à une ou plusieurs saisons et être autorisée au déjeuner, au dîner ou aux deux, grâce aux cases à cocher de l’éditeur. Le moteur exclut les recettes qui ne couvrent pas la saison ou le moment du repas. Un repli sur les autres saisons n’est utilisé que lorsqu’aucune recette de la saison n’existe pour ce créneau. Une recette peut aussi être marquée « Menu express ». Ces recettes sont utilisées aux dates express demandées, après un retour de nuit et lorsque Madame est seule. Dans ce dernier cas, un reste déjà disponible reste prioritaire afin d’éviter le gaspillage.

Chaque recette indique si elle supporte la conservation et le réchauffage. MealPilot calcule les portions supplémentaires d’après les présences réelles au repas où le reste sera consommé : travail de Papa, présence de Madame, école, cantine, centre et vacances scolaires. Il prépare uniquement la quantité nécessaire et relie automatiquement les deux repas. Le menu indique directement la quantité préparée et le jour prévu, puis l’origine du reste lorsqu’il est servi. Il n’existe plus d’écran ni d’action manuelle consacrés aux restes. Ce lien interne évite d’ajouter une seconde fois leurs ingrédients aux courses.

Le bouton **Valider le menu** enregistre une copie figée de la période dans l’onglet **Menu validé**. Cette copie reste indépendante des modifications ultérieures du brouillon. Un clic sur un repas validé ouvre sa recette en lecture seule avec les ingrédients recalculés et enregistrés selon le nombre exact de portions préparées pour ce repas.

Les portions familiales valent 3 portions adultes équivalentes : 2 adultes + enfant de 6 ans (0,6) + enfant de 3 ans (0,4). Un repas peut être remplacé seul et les courses sont recalculées immédiatement.

## Fonctionnalités précédentes

- planning hebdomadaire midi/soir cliquable ;
- 8 recettes de saison (printemps, été, automne et hiver) ;
- recettes personnelles ajoutables, modifiables et supprimables ;
- ingrédients structurés avec quantité et unité, préparation détaillée ;
- favoris, recherche et filtres par saison et catégorie ;
- remplacement d'un repas directement depuis le planning ;
- recalcul et agrégation automatiques de la liste de courses ;
- ajout, cochage, modification et suppression d'articles ;
- stockage JSON persistant et écriture atomique ;
- interface adaptée aux ordinateurs et téléphones Android, avec navigation mobile basse.

Les anciennes données du Sprint 1 sont migrées automatiquement au premier chargement. Les recettes et articles personnels existants sont conservés.

Les réglages fournisseurs, leur état de santé, le cache, les recettes collectées, le menu, les restes et les courses sont stockés dans le même fichier persistant `mealpilot.json`.

## Déploiement Unraid

Depuis le dossier du projet :

```bash
docker compose up -d --build
```

L'application est ensuite disponible sur `http://ADRESSE_DU_SERVEUR:8095`.

Les données sont conservées sur l'hôte dans :

```text
/mnt/user/appdata/mealpilot/data
```

Le conteneur utilise le port interne `3000` et l'expose sur le port hôte `8095`. Pour arrêter le service :

```bash
docker compose down
```

## Développement local

Node.js 20 ou supérieur est requis. Le projet n'a aucune dépendance npm externe.

```bash
npm start
```

Ouvrir ensuite `http://localhost:3000`. Les données locales sont écrites dans `./data`.

## Tests

```bash
npm test
```
