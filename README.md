# MealPilot

MealPilot est un planificateur de repas familial, responsive et auto-hébergé. Il permet d'organiser les repas du midi et du soir, de conserver ses recettes et de générer une liste de courses cochable.

## Fonctionnalités

- planning hebdomadaire midi/soir cliquable ;
- recettes détaillées avec ingrédients et étapes de préparation ;
- favoris et recherche ;
- ajout manuel de recettes ;
- génération de la liste de courses depuis le menu ;
- ajout, cochage, modification et suppression d'articles ;
- stockage JSON persistant et écriture atomique ;
- interface adaptée aux ordinateurs et téléphones Android.

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
