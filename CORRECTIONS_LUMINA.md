# Chœur Lumina Web — v2.8.2

## Corrections et alignement avec Android

- Inscription Firebase rendue atomique : la fiche `members` et le document `userRoles` sont créés/modifiés dans le même batch.
- `userRoles` contient désormais systématiquement `role` + `memberId`, conformément aux règles Firestore.
- Réponse **Présent / Absent / Peut-être** ajoutée directement sur le prochain événement de l'accueil, comme sur Android.
- Compatibilité conservée avec les anciens chants qui utilisent encore l'audio général `audioUrl`.
- Modification d'un membre + mise à jour de son rôle rendues atomiques.
- Suppression d'un membre + suppression de son rôle rendues atomiques.
- Régénération des codes d'invitation alignée sur Android : 8 caractères.
- Régénérer un code ne remet plus un compte actif à `claimed=false`.
- Version Web passée à **2.8.2** (application + service worker + fichier de version).

## Construction

Le dossier `dist` fourni dans l'ancienne archive correspondait encore à la v2.7.0. Il a volontairement été retiré pour empêcher un déploiement accidentel de l'ancienne interface.

Sous Windows, double-cliquer sur `BUILD_WEB.bat` après avoir installé Node.js. Sinon :

```bash
npm install
npm run build
```

Le nouveau dossier `dist` généré contiendra la v2.8.2 prête pour Firebase Hosting.
