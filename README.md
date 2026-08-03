# MealPilot

MealPilot est un planificateur de repas familial, responsive et auto-hébergé. Il permet d'organiser les repas du midi et du soir, de conserver ses recettes et de générer une liste de courses cochable.

## Fonctionnalités

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
