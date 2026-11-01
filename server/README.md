# Serveur — Loup-Garou de Thiercelieux

Serveur de jeu **autoritaire** (Node 22, ESM, socket.io 4.8) : salons, lobby, moteur de règles, vues
personnalisées sans fuite d'information, chat, relais de présence filtré, bots. Le contrat réseau est dans
`../shared/protocol.js` et `../docs/ARCHITECTURE.md`.

## Lancer

```sh
cd server
npm install
npm start                 # http://localhost:3001 (sert aussi ../client/dist s'il existe)
npm run dev               # node --watch (redémarre à chaque modification, shared/ compris)
SPEED=0.2 npm run dev     # minuteurs x0,2 pour tester vite
npm test                  # node --test (moteur, non-divulgation, simulation, réseau, statique)
npm run sim -- 500        # 500 parties de bots en accéléré, statistiques de victoire
```

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `3001` | port HTTP + socket.io |
| `HOST` | `0.0.0.0` | interface d'écoute (`0.0.0.0` = accessible depuis un téléphone du réseau local) |
| `SPEED` | `1` | multiplie **toutes** les durées (minuteurs, délais de grâce, jauge de la Petite Fille, délais des bots), en plus de la vitesse choisie par l'hôte |
| `STATIC_DIR` | `../client/dist` | dossier servi en production |
| `LOG_LEVEL` | `info` | `debug` (chaque phase), `info`, `warn`, `error`, `silent` |

En développement, Vite (port 5180) relaie `/socket.io` vers 3001. En production, le serveur sert
`client/dist` : types MIME (dont `.glb`, `.ktx2`, `.wasm`), `ETag`/304, `index.html` en `no-cache`, bundles
Vite fingerprintés (`/assets/nom-xxxxxxxx.ext`) en cache immuable, fichiers de `public/` (`/assets/camp/…`)
en cache d'une heure, repli sur `index.html` pour les routes sans extension, aucune traversée de chemin.
`GET /healthz` renvoie `{ ok, v, rooms, uptime }`.

## Architecture

```
src/
  index.js              démarrage HTTP + socket.io, startServer() réutilisé par les tests
  log.js                journalisation concise par niveaux
  sim.js                simulation sans réseau (horloge simulée) : tests + `npm run sim`
  engine/               ── module pur, aucune dépendance réseau ni minuterie réelle ──
    game.js             état d'un salon : lobby + machine à états des règles (now()/rng() injectés)
    config.js           composition, minuteurs, capitaine, vitesse : validation
    visibility.js       qui a le droit de savoir quoi (rôles, éveil, présence, chat, causes de mort)
    snapshot.js         buildSnapshot(game, playerId) : StateSnapshot personnalisé
    narration.js        lignes du narrateur (français, formulations neutres)
    geometry.js         sièges sur un cercle, lacet pour regarder un siège (convention three.js)
    rng.js              PRNG à graine (mulberry32), pick/shuffle
  bots/
    brain.js            décisions d'un bot à partir de SON snapshot (il ne triche jamais)
    controller.js       planification humaine des actions, chat, présence simulée
    names.js            prénoms français et répliques
  net/
    rooms.js            RoomManager : codes, jetons de reconnexion, câblage socket.io, nettoyage
    room.js             Room : Game + sockets, minuterie, diffusion groupée, relais de présence, chat
    static.js           service statique de client/dist
test/                   node --test
```

**Flux.** Une intention client (`game:action`, `lobby:*`, `chat:send`…) est validée par `Game`, qui modifie
l'état et pousse dans une *outbox* des événements et des lignes de narrateur avec leurs destinataires
explicites (calculés au moment de l'émission). `Room.after()` réarme la minuterie sur `game.nextDeadline()` et
programme un `flush` (`setImmediate`) : tous les changements d'un même tick produisent **un** `state`
personnalisé par membre connecté, puis les `event`/`chat` dans l'ordre. Les bots sont ensuite replanifiés.
Le moteur n'utilise jamais `Date.now()` directement : la simulation l'exécute sur une horloge simulée.

**Salons.** Code de 4 lettres sans ambiguïté (`ACDEFGHJKMNPRTUVWXY`, insensible à la casse). Le créateur est
l'hôte ; s'il part (ou reste déconnecté plus de 30 s alors qu'un autre humain est là), l'hôte passe au
suivant. 4 à 16 joueurs, sièges répartis à chaque changement (`seat = round(i*16/n) % 16`). Avatar unique tant
qu'il en reste un libre. Le `token` (renvoyé par create/join, à garder en localStorage) permet de reprendre la
même place à tout moment, même en pleine partie ; une seconde connexion avec le même jeton remplace la
première (`error {code:'replaced'}`) ; l'historique récent du chat est renvoyé. Un joueur déconnecté pendant la
partie reste en jeu (ses actions expirent avec les minuteurs) ; dans le lobby il est retiré après 2 min.
Rejoindre une partie lancée = spectateur (aucun siège, voit tout, canal des morts) ; il obtient un siège au
redémarrage. Un salon est fermé quand plus aucun humain n'en fait partie, après 10 min sans humain connecté ou
6 h d'inactivité.

**Robustesse.** Chaque gestionnaire socket est isolé (try/catch, ack `{ ok:false, error }` ou `error`), entrées
validées et bornées (noms 20 car., chat 200 car., caractères de contrôle retirés, présence bornée, 40
événements/s max par socket, `maxHttpBufferSize` 32 Ko). Les acks ne renvoient que des champs publics.
`uncaughtException`/`unhandledRejection` sont journalisées sans arrêter le serveur.

## Règles retenues

- **Déroulé** : `role_reveal` → nuit (`fall` → nuit 1 : `cupidon` → `lovers` → `voyante` → `loups` → `sorciere`)
  → `dawn` → (`hunter`)* → (`captain_succession`) → jour 1 : `election` → `debate` → `vote` → `execution` →
  (`hunter`/`captain_succession`) → nuit… Une étape dont le rôle n'est pas (ou plus) en vie est sautée (le rôle
  d'un mort est de toute façon révélé). La victoire est vérifiée à la fin de `dawn`, `execution` et `hunter`
  (l'annonce se joue avant l'écran de fin).
- **Fin anticipée** : dès que tous les concernés connectés ont agi, l'étape se termine après un court délai de
  grâce (1 à 3 s × vitesse) pour voir le résultat. Morts et déconnectés sont ignorés des quorums ; si personne
  n'est en état d'agir, l'étape va au bout de son minuteur.
- **Cupidon** (nuit 1) : deux joueurs vivants distincts (lui-même compris) ; à expiration, couple tiré au sort.
  Les amoureux l'apprennent à leur réveil (`lovers`), pas avant. Si l'un meurt, l'autre meurt de chagrin
  (cascade). Couple mixte loup + non-loup : il gagne seul s'il est le dernier en vie, et ne gagne pas avec son
  camp d'origine.
- **Voyante** : un joueur vivant par nuit ; résultat privé (`inspect_result`, `me.inspected`, rôle visible dans
  ses `players`).
- **Loups** : vote parmi les vivants non-loups, modifiable ; unanimité = fin anticipée ; à expiration, majorité
  relative ; égalité = tirage au sort parmi les ex-aequo ; aucun vote = pas de victime. Les votes ne sont
  visibles que des loups (et des morts).
- **Sorcière** : voit la victime à son tour (`wolf_victim`, `me.wolfVictim`). Potion de vie et potion de mort
  une fois chacune par partie, utilisables la même nuit. **Règle classique : elle peut se sauver elle-même** ;
  elle ne peut pas s'empoisonner. Son tour finit sur « Terminer » ou quand plus aucune potion n'est utilisable
  après en avoir utilisé une.
- **Causes de mort nocturnes secrètes** : le village apprend la mort et le rôle, avec la cause `nuit` ; la vraie
  cause n'est donnée qu'aux loups (leur victime), à la sorcière (son poison) et aux morts. Chagrin, vote et tir
  du chasseur sont publics.
- **Chasseur** : quelle que soit sa mort (nuit, vote, chagrin, tir), il tire sur un vivant pendant `hunter` ;
  les tirs s'enchaînent (cascade d'amoureux comprise). Sans tir à temps, il n'emporte personne.
- **Petite Fille** : `peek {active}` seulement pendant `loups`, jauge de 8 s par nuit (× vitesse). Elle voit les
  loups éveillés (`awake: true` dans son snapshot, présence des loups relayée). Les loups reçoivent sa présence
  aux yeux `peek` pendant qu'elle épie (puis `closed` quand elle arrête). `peek_spotted` est envoyé aux loups
  (une fois par nuit) si elle épie depuis plus de 3 s d'affilée alors qu'au moins un loup éveillé la regarde :
  `presence.target` = elle, ou lacet à ±0,35 rad de la direction de son siège (sièges sur un cercle, ordre
  trigonométrique, `yaw > 0` = vers la gauche).
- **Capitaine** (option, activée par défaut) : élu le jour 1 (majorité relative, égalité au sort, aucun vote =
  tirage). Voix double au vote du village. Égalité au vote : le Capitaine vivant départage (`captain_tiebreak`,
  `tie` dans le snapshot) ; sans décision à temps ou sans Capitaine, **pas d'exécution**. À sa mort il désigne
  un successeur (tirage au sort à expiration).
- **Débat** : « Passer » (`skip`) termine le débat quand une majorité stricte des vivants connectés le demande.
- **Victoire** : couple mixte seul survivant → `amoureux` ; plus aucun loup vivant → `village` (y compris si tout
  le monde meurt en même temps : victoire posthume) ; plus aucun non-loup vivant → `loups`. Tous les rôles sont
  révélés (`game_over.roles` et snapshot). `game:restart` ramène au lobby avec les mêmes joueurs.
- **Ce que voit qui** : chacun connaît son rôle ; les loups se connaissent ; les morts sont révélés ; **les morts
  et spectateurs voient tout** (rôles, amoureux, votes des loups, éveil, présence) mais ne parlent qu'entre eux.
- **Chat** : `village` (lobby et fin de partie : tous ; en jeu : vivants, hors nuit), `loups` (loups vivants
  pendant `loups`), `morts` (morts et spectateurs), `system` (narrateur). Anti-spam : rafale de 5 messages puis
  1 toutes les 1,5 s, doublons refusés pendant 5 s.
- **Présence** : relayée à 10 Hz max par joueur (valeur la plus récente envoyée en fin de fenêtre). Jour : tous ;
  nuit : éveillés d'une même étape entre eux, Petite Fille qui épie ↔ loups, morts → reçoivent tout ; un joueur
  endormi ne reçoit rien ; un joueur qui n'a pas le droit d'être éveillé est relayé `eyes: 'closed'` sans geste ;
  la présence d'un mort n'est vue que des morts. Au changement d'étape, les présences actuelles sont renvoyées aux
  nouveaux destinataires.

## Bots

`lobby:addBot` (hôte) ajoute un bot au prénom français. Un bot décide uniquement à partir de son propre
`StateSnapshot` et de ce qu'il a entendu : loups qui convergent vers la proie de la meute (et ne votent jamais
contre un loup), voyante et petite fille qui exploitent ce qu'elles ont vu, sorcière qui sauve souvent la
victime, villageois qui suivent le vote majoritaire ou leurs soupçons (accusations dans le chat, votes contre
eux), amoureux qui ne se votent pas. Délais humains proportionnels au temps restant. Quelques phrases de chat
(débat, accusations, défense quand on les nomme, meute la nuit, morts, fin de partie). Présence simulée :
regard vers celui qui parle, la cible de leur vote (`point` puis `raise`), le feu ou un voisin ; yeux fermés la
nuit sauf à leur tour.

## Tests

`npm test` (≈ 20 s) :
- `engine.test.js` — composition et configuration, salon (sièges, avatars, hôte, spectateurs), ordre de la nuit,
  chaque rôle, cascade amoureux + chasseur, égalités, capitaine (voix double, départage, succession), débat,
  quorum avec déconnectés, toutes les conditions de victoire, Petite Fille (jauge, repérage), minuteurs.
- `snapshot.test.js` — non-divulgation ciblée (rôles, votes des loups, victime, amoureux, éveil, présence, chat)
  et vérification d'invariants sur chaque `flush` de 40 parties complètes de bots.
- `simulation.test.js` — ~360 parties complètes de bots (4 à 16 joueurs, compositions et options variées) :
  toutes se terminent avec un vainqueur cohérent avec l'état final ; tous les événements apparaissent ;
  simulation déterministe à graine égale.
- `room.test.js` — relais de présence filtré et limité à 10 Hz, Petite Fille ↔ loups, chat (droits, anti-spam).
- `integration.test.js` — serveur réel sur un port libre + `socket.io-client` : création, code invalide, bots,
  configuration, chat, lancement, spectateur, reconnexion par jeton en pleine partie, partie jusqu'à la fin,
  redémarrage, entrées invalides, exclusion, suppression du salon ; fichiers statiques.
