# MealPilot

Application web auto-hébergée pour organiser les repas, conserver ses recettes et gérer une liste de courses.

## Fonctionnalités

- Planning hebdomadaire midi/soir navigable et cliquable
- Ajout, consultation et favoris des recettes
- Remplacement manuel de chaque repas
- Liste de courses cochable, modifiable et supprimable
- Interface responsive pour ordinateur et téléphone
- Données SQLite persistantes

## Déploiement Unraid

```bash
docker compose up -d --build
```

L'application est disponible sur `http://ADRESSE_DU_SERVEUR:8095`. Les données sont conservées dans `/mnt/user/appdata/mealpilot/data`.
