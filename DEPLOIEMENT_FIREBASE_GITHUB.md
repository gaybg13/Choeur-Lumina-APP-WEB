# Déploiement automatique Chœur Lumina Web

Le workflow `.github/workflows/build-pwa.yml` construit maintenant la PWA puis la déploie automatiquement sur Firebase Hosting à chaque push sur `main`.

## Secret GitHub requis

Le dépôt doit contenir ce secret :

`FIREBASE_SERVICE_ACCOUNT_CHORALE_LUMINA_APP`

Le moyen recommandé pour le créer est d'exécuter, depuis un poste où Firebase CLI est connecté au projet `chorale-lumina-app` :

```bash
firebase init hosting:github
```

Firebase crée le compte de service, enregistre sa clé comme secret GitHub et peut générer ses propres workflows. Si la commande crée de nouveaux workflows en doublon, conserve le workflow `build-pwa.yml` fourni dans ce projet et vérifie seulement que le secret est présent.

## Après configuration

Un push sur `main` lance :

1. `npm ci`
2. `npm run build`
3. contrôle de `dist/version.json`
4. déploiement du dossier `dist` sur le canal `live` Firebase Hosting.

La version 2.8.2 contient aussi un mécanisme de mise à jour PWA qui vérifie `version.json` sans cache et force le renouvellement du service worker lorsqu'une nouvelle version est déployée.
