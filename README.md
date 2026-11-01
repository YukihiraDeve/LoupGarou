# Loup-Garou de Thiercelieux — feu de camp 3D

Jeu multijoueur en vue première personne autour d'un feu de camp (Three.js + Node/socket.io), pour téléphone et
ordinateur. Règles classiques : Villageois, Loup-Garou, Voyante, Sorcière, Chasseur, Cupidon, Petite Fille,
Capitaine. Le temps est porté par le soleil : le vote se ferme quand il touche l'horizon.

## Lancer

```bash
npm run install:all   # dépendances de server/ et client/
npm run dev           # serveur (3001) + client Vite (http://localhost:5180)
```

Production : `npm run build` puis `npm start` → tout est servi sur http://localhost:3001.

Depuis un téléphone du même réseau : ouvrir `http://<IP de l'ordinateur>:5180` (dev) ou `:3001` (production).

- Créer une partie, partager le lien `?room=CODE`, ajouter des bots pour compléter (4 à 16 joueurs).
- Mode démo hors ligne : `?demo=1&autostart=1&role=petite_fille` (options `phase=loups|vote|dawn…`,
  `speed=0.5` pour ralentir, `players=12`).
- Tests du serveur : `npm test` · 1 000 parties de bots : `npm --prefix server run sim -- 1000`.

## Organisation

| Dossier | Contenu |
|---|---|
| `docs/ARCHITECTURE.md` | contrat entre les parties (réseau, règles, soleil, scène, personnages) |
| `shared/` | protocole réseau et rôles, partagés client/serveur |
| `server/` | serveur autoritaire, moteur de règles pur, bots, tests (`server/README.md`) |
| `client/` | Vite + three.js : vue subjective, jour/nuit, feu, avatars, HUD, audio |
| `blender/scene/` | camp construit par scripts dans Blender (MCP) → `client/public/assets/camp/` |
| `blender/characters/` | 10 campeurs + loup-garou créés par scripts → `client/public/assets/characters/` |
| `docs/previews/` | rendus d'aperçu du camp et des personnages |

Assets : camp et personnages entièrement modélisés par scripts pour ce projet (`3DLib/` ne sert que d'outillage :
Blender, gltf-transform) ; 3 clips de base (`Walk`, `Sit_Stand`, `Stand_Sit`) reciblés depuis la Quaternius
Universal Animation Library (CC0), les 13 autres animés à la main.
