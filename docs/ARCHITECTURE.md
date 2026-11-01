# Loup-Garou de Thiercelieux — Architecture et contrats

Jeu multijoueur en vue première personne, autour d'un feu de camp (camping, tentes, chalets, guirlandes,
tour de guet). Three.js côté client, Node + socket.io côté serveur, scène et personnages produits dans Blender.
Cible : téléphone **et** ordinateur. Référence visuelle : `docs/reference/ambiance.webp` (style 3D stylisé chaleureux,
type film d'animation).

Ce document est le **contrat** entre les sous-projets. Les noms qu'il fixe (fichiers, marqueurs, clips, morph
targets, événements réseau) peuvent être complétés, jamais renommés. Tout ajout est noté dans le
« Journal du contrat » en fin de fichier.

## Arborescence et propriétaires

```
LoupGarou/
  3DLib/                   bibliothèque d'assets CC0 + outils (lecture seule, sauf ajout d'outils)
  docs/                    ce contrat, références visuelles
  shared/                  protocole réseau + rôles (ESM pur, importé par server/ et client/)
  server/                  Node 22, socket.io, état de jeu autoritaire, bots      (agent Serveur)
  client/                  Vite + three.js, HUD HTML/CSS                          (agent Client)
    public/assets/camp/        camp.glb + camp_manifest.json                      (agent Scène)
    public/assets/characters/  camper_XX.glb, werewolf.glb, anims.glb, manifest.json (agent Personnages)
  blender/
    scene/                 camp.blend + scripts Python de construction           (agent Scène)
    characters/            characters.blend + scripts Python                     (agent Personnages)
```

Chaque agent n'écrit que dans ses dossiers. Pas de workspaces npm : `server/` et `client/` ont chacun leur
`package.json` et leur `node_modules`. `shared/` est importé par chemin relatif (serveur) et par l'alias Vite
`@shared` (client).

Langue : identifiants et commentaires de code en anglais, textes d'interface et docs en français.

Outils : Blender 5.2 (`3DLib/tools/blender`, CLI) et Blender MCP (instance interactive : **réservée à l'agent
Scène**), Node 22, `@gltf-transform/cli` dans `3DLib/tools/node_modules/.bin/gltf-transform`.

## Ports

- Serveur : `PORT` (défaut 3001). En production il sert aussi `client/dist`.
- Client dev : Vite sur 5180 (`--host` pour tester depuis un téléphone du réseau local), proxy `/socket.io` → 3001.

## Réseau

Voir `shared/protocol.js` (événements `C2S`, `S2C`, `ACTIONS`, `EVENTS`, forme de `StateSnapshot`).

Principes :
- **Serveur autoritaire.** Le client n'envoie que des intentions ; le serveur valide tout (rôle, phase, cible
  vivante, potions restantes…).
- **Pas de fuite d'information.** Chaque `state` est personnalisé : un client ne reçoit jamais un rôle, un vote de
  loup, un état « réveillé » ou une présence qu'il n'a pas le droit de connaître. La nuit, un joueur endormi ne
  reçoit aucune présence.
- **Présence** (`presence`, 10 Hz max) : orientation de tête (yaw/pitch relatifs au siège), yeux, geste, cible.
  Elle anime les avatars des autres (ils regardent vraiment là où regarde le joueur). Relais filtré :
  - jour : tout le monde voit tout le monde ;
  - nuit : les éveillés d'une même étape se voient entre eux (les loups entre loups, les amoureux entre eux) ;
    la petite fille qui épie voit les loups ; **les loups voient la petite fille quand elle épie** (ses yeux
    entrouverts sur son avatar) ; les morts voient tout ;
  - un joueur qui n'a pas le droit d'être éveillé est relayé avec `eyes: 'closed'`.
- **Reconnexion** : le `token` (localStorage) permet de reprendre sa place après une coupure.
- **Bots** : l'hôte peut ajouter des bots côté serveur (actions plausibles avec délais, présence simulée :
  ils regardent celui qui parle, le feu, la cible du vote).

## Règles (classiques)

Rôles : Simple Villageois, Loup-Garou, Voyante, Sorcière, Chasseur, Cupidon, Petite Fille, plus le Capitaine
(élu le jour 1, voix double au vote, départage les égalités, désigne son successeur en mourant).
Composition par défaut : `defaultComposition(n)` dans `shared/roles.js` (4 à 16 joueurs).

Déroulé :
1. `role_reveal` (jour 0, heure dorée) : chacun découvre sa carte.
2. `night` : `fall` → (nuit 1 : `cupidon` → `lovers`) → `voyante` → `loups` → `sorciere`.
3. `dawn` : annonce et révélation des morts (chagrin d'amour en cascade) → `hunter` si le chasseur est mort →
   `captain_succession` si le capitaine est mort.
4. Jour 1 seulement : `election` du capitaine.
5. `debate` → `vote` → `execution` (→ `hunter` / `captain_succession`) → nuit suivante.
6. Fin : village gagne quand plus aucun loup ; loups gagnent quand plus aucun non-loup ; amoureux de camps
   opposés gagnent s'ils sont les deux derniers.

Petite Fille : pendant `loups`, elle maintient « Entrouvrir les yeux » (jauge `peekLeft`, ~8 s par nuit). Son
écran passe par une fente de paupières floue et tremblante ; elle voit les loups éveillés. Les loups, eux,
voient son avatar aux yeux entrouverts s'ils regardent dans sa direction (et reçoivent `peek_spotted` si elle
épie plus de 3 s d'affilée pendant qu'un loup la regarde).

## Temps et soleil

Le temps de jeu est porté par le soleil. Le client calcule la position du soleil à partir de `phase`, `day`,
`phaseStartedAt`, `phaseEndsAt` et `serverNow` (horloge corrigée) :

| Phase | Course du soleil (élévation) |
|---|---|
| `role_reveal` | 12° → 2° (heure dorée), puis crépuscule pendant `night.fall` |
| `night` | soleil sous l'horizon, lune haute, étoiles ; seule lumière : feu, lanternes, guirlandes |
| `dawn` | −6° → 10° (aube rose) |
| `election`, `debate` | 10° → 35° → redescend jusqu'à 14° à la fin du débat |
| `vote` | 14° → 0° : **le vote se ferme quand le soleil touche l'horizon** |
| `execution` | 0° → −6° (coucher, ciel rouge) puis la nuit tombe |

Le HUD affiche aussi le compte à rebours, mais la lecture « naturelle » du temps est la lumière.

## Contrat de la scène — `client/public/assets/camp/camp.glb`

Repères three.js : Y vers le haut, mètres. Dans Blender (Z vers le haut), l'axe local **−Y** d'un objet devient
**+Z** dans three.js : un objet qui « regarde » vers −Y dans Blender regarde vers +Z dans three.js.

Marqueurs (objets vides exportés comme nœuds) :
- `fire` : centre du foyer, au niveau du sol. Les flammes sont faites dans le client (pas de géométrie de flamme).
- `seat_00` … `seat_15` : point de la surface d'assise où se pose le bassin d'un personnage assis (hauteur
  d'assise 0,42–0,48 m), axe +Z three.js (−Y Blender) tourné vers le feu. Répartis sur le cercle de bûches,
  dans l'ordre trigonométrique, `seat_00` face à la caméra de présentation.
- `light_lantern_NN`, `light_window_NN`, `light_string_NN` : positions de lumières ponctuelles possibles
  (le client en allume un nombre limité selon la qualité).
- `cam_intro` : caméra/position de présentation pour le lobby (vue d'ensemble du camp).

Matériaux :
- Les matériaux dont le nom commence par `EMIT_` (ampoules de guirlande, fenêtres, lanternes, braises) sont
  émissifs ; le client module leur intensité entre le jour et la nuit.
- Occlusion ambiante cuite dans les couleurs de sommet (`COLOR_0`) ou une texture AO : l'éclairage reste
  dynamique (jour/nuit), seule l'occlusion est précalculée.

Budget mobile : ≤ 150 k triangles visibles, ≤ 40 matériaux, textures ≤ 1024 px (sol jusqu'à 2048), GLB
optimisé (meshopt + WebP) ≤ 10 Mo. Les arbres et objets répétés sont instanciés (`EXT_mesh_gpu_instancing`).

`camp_manifest.json` : liste des marqueurs, nombre de triangles, matériaux `EMIT_*`, notes pour le client.

## Contrat des personnages — `client/public/assets/characters/`

Personnages **créés pour ce projet** (aucun personnage existant de 3DLib). Style stylisé chaleureux type film
d'animation, adultes et ados campeurs aux silhouettes bien distinctes.

- `camper_01.glb` … `camper_10.glb` : un maillage skinné par personnage (≤ 2 matériaux, ≤ 8 k triangles,
  texture ≤ 1024 px), squelette commun.
- `werewolf.glb` : le loup-garou (même squelette et mêmes noms d'os, plus grand), vu par les autres loups la nuit
  et lors des révélations.
- `anims.glb` : tous les clips, partagés par tous les personnages (liaison par nom d'os).
- `manifest.json` : `[{ id, name, description, height, file, tints? }]` + liste des clips et morph targets.

Orientation : origine au sol entre les pieds, personnage tourné vers +Z three.js (−Y Blender), 1 unité = 1 m.

Squelette (noms type mannequin Unreal, compatibles Quaternius UAL) : `root`, `pelvis`, `spine_01`, `spine_02`,
`spine_03`, `neck_01`, `Head`, `clavicle_l/r`, `upperarm_l/r`, `lowerarm_l/r`, `hand_l/r`, doigts simplifiés
(`thumb_01..03_l/r`, `index_01..03_l/r`, …, facultatifs), `thigh_l/r`, `calf_l/r`, `foot_l/r`, `ball_l/r`,
et `eye_l`, `eye_r` (rotation du regard). ≤ 65 os.

Clips (dans `anims.glb`) :

| Clip | Boucle | Usage |
|---|---|---|
| `Sit_Idle` | oui | assis, respiration, micro-mouvements |
| `Sit_Talk` | oui | assis, gestes de parole (quand le joueur écrit/parle) |
| `Sit_Sleep` | oui | nuit : tête baissée, épaules tombantes |
| `Sit_Awake_Night` | oui | réveillé la nuit : tendu, regarde autour |
| `Sit_Point` | maintien | bras tendu vers l'avant (le client oriente le buste vers la cible) |
| `Sit_RaiseHand` | maintien | main levée (vote, prise de parole) |
| `Sit_Nod`, `Sit_Shake` | non | oui / non de la tête |
| `Sit_Shocked` | non | réaction à l'annonce d'une mort |
| `Sit_Death` | non | s'effondre du tronc vers le sol (fin au sol) |
| `Sit_Stand`, `Stand_Sit` | non | se lever / s'asseoir |
| `Stand_Idle`, `Walk` | oui | debout (lobby, révélations) |
| `Wolf_Howl`, `Wolf_Idle` | — | loup-garou |

Le client compose : la tête et les yeux suivent la présence (`Head`, `neck_01`, `eye_l/r` en additif par-dessus
le clip) ; le buste pivote vers la cible du geste.

Morph targets (sur le maillage du visage/corps) : `Blink` (1 = yeux fermés), `EyesHalf` (yeux entrouverts de
la petite fille), `MouthOpen`, `Smile`, `Worried`. `Blink` doit fermer complètement les yeux : c'est l'état
« dort » de la nuit.

Vue première personne : la caméra est placée aux yeux de son propre avatar assis ; la tête de son propre avatar
est masquée (échelle 0 de l'os `Head`), on voit ses genoux, ses mains et ses manches comme sur la référence.

## Client

- Rendu : `WebGLRenderer`, tone mapping AgX ou ACES, couleur sRGB. Ciel dynamique (shader dégradé + soleil,
  lune, étoiles), brouillard teinté selon l'heure, feu (shader de flammes + étincelles + lumière qui vacille),
  guirlandes et lanternes, lucioles la nuit.
- Qualité : 3 paliers auto (`low` mobile, `medium`, `high`) : DPR plafonné, ombres (une seule lumière
  ombrante), nombre de lumières ponctuelles, particules, post-traitement léger.
- Contrôles : glisser (souris / doigt) pour tourner la tête depuis son siège, gyroscope optionnel sur mobile,
  toucher/clic sur un avatar pour le désigner (vote, pouvoir), long appui « Entrouvrir les yeux ».
- Paupières : à la tombée de la nuit, les paupières se ferment (masque plein écran animé) ; on ne voit plus
  rien tant que son rôle n'est pas appelé.
- HUD (comme la référence) : logo en haut à gauche, bandeau de phase centré, joueurs + minuteur en haut à
  droite, chat en bas à gauche, consigne au centre en bas, réglages en bas à droite.
- Audio : ambiance procédurale WebAudio (feu, grillons, chouette, hurlements), narrateur (texte + synthèse
  vocale française optionnelle via `speechSynthesis`).

## Journal du contrat

- v1 (orchestrateur) : création.
- v2 (agent Serveur) — ajouts compatibles uniquement :
  - `shared/protocol.js` : `DEATH_CAUSES.NIGHT = 'nuit'` (cause publique d'une mort nocturne : la vraie cause
    `loups`/`sorciere` n'est envoyée qu'aux loups, à la sorcière et aux morts/spectateurs) ;
    `DEFAULT_TIMERS.captain_tiebreak = 20` (le Capitaine départage une égalité pendant `execution`) ;
    `LIMITS` (longueurs nom/chat, 10 Hz, jauge de la Petite Fille 8 s / repérage 3 s, alphabet des codes,
    bornes des minuteurs et de la vitesse).
  - `StateSnapshot` : `spectators` (`SpectatorView[]`), `tie` (ids à départager), `skip` (`{count, needed}` pendant
    le débat), `room.canStart`, `room.startError`, `room.config.rolesAuto` ; `room.config.roles` est la composition
    effective (les villageois complètent toujours jusqu'au nombre de joueurs ; `lobby:config {roles: null}` revient
    à la composition automatique). `me` : `spectator`, `isHost`, `team` (objectif réel, `amoureux` pour un couple
    mixte), `peeking`, `skipped`, `targets` (`{action: ids[]}` cibles valides de chaque action permise).
    `PlayerView.deathCause` (cause telle que le destinataire a le droit de la connaître).
  - Événements : `vote_cast` porte `kind` (`election` | `day` | `loups`) et `weight` (2 = voix du Capitaine).
    `error` peut porter `code` : `kicked`, `replaced` (session reprise ailleurs), `closed`.
    Acks : `room:create`/`room:join` renvoient aussi `spectator` ; `lobby:addBot` renvoie `playerId`.
  - Conventions précisées : `presence.yaw > 0` = tête tournée vers la **gauche** (rotation +Y de three.js, sens
    trigonométrique vu de dessus, comme l'ordre des sièges). La nuit, `day` vaut le numéro du dernier jour
    (1re nuit : `day = 0`) et `phaseStartedAt`/`phaseEndsAt` sont ceux de l'étape en cours. `phaseEndsAt` peut
    avancer (tous ont agi) ou revenir à sa valeur initiale (unanimité des loups rompue, vote retiré). Pour un même
    tick, les `event` et lignes du narrateur sont émis **après** le `state` correspondant. `me.peekLeft` est la
    jauge restante (s) à l'instant du snapshot ; elle décroît côté client tant que `me.peeking`.
- v3 (agent Scène) : `camp.glb` livré. Ajout du matériau émissif `EMIT_tent` (toile de la tente cloche éclairée de l'intérieur). Matériaux non émissifs : `wood`, `bark` (texture de détail d'écorce × `COLOR_0`), `stone`, `fabric`, `foliage`, `grass`, `paint`, `ground` (texture 2048 avec AO), `ground_far`, `mountain`. Marqueurs : `fire`, `seat_00..15`, `light_window_00..06`, `light_lantern_00..11`, `light_string_00..12`, `cam_intro` (caméra glTF), tous à la racine. GLB compressé meshopt : `GLTFLoader.setMeshoptDecoder` obligatoire. Détails : `client/public/assets/camp/camp_manifest.json`.
- v4 (agent Personnages) : personnages livrés (`camper_01..10.glb`, `werewolf.glb`, `anims.glb`, `manifest.json`).
  Ajouts compatibles : `manifest.json` est un **objet** `{ characters: [{ id, name, description, height, file, scale,
  triangles, bones, bytes, sitPelvisHeight, seatedEyeOffset }], werewolf: {…, emissiveMaterials: ["EMIT_eyes"]},
  anims, clips: [{ name, duration, loop, hold }], morphTargets, lookBones, seat, firstPerson, clipsNotes }` (le loup-garou
  est hors de `characters`, donc hors du lobby). Squelette : 55 os (noms du contrat, doigts 01..03 sans `_04_leaf`),
  l'os `pelvis` est placé au **point de contact d'assise** (sous les hanches) ; dans tous les `Sit_*` il est à 0,45 m × échelle
  du personnage, pieds au sol. `Head`, `neck_01`, `eye_l/r` (et le dos) ont, au repos, leurs axes locaux alignés sur le modèle
  (+X gauche du personnage, +Y haut, +Z avant). Matériaux : `M_<id>` (atlas 1024 WebP) + `M_<id>_eyes` (même texture, brillant) ;
  loup-garou `M_werewolf` + `EMIT_eyes`. `Sit_Point` / `Sit_RaiseHand` : bras **droit**, dernière image à maintenir ;
  `Sit_Stand` finit debout ~0,24 m devant le point d'assise (`Stand_Sit` y commence) ; `Sit_Death` finit allongé sur le côté
  devant la bûche ; `Wolf_Howl` non bouclé (3,6 s, le client pilote `MouthOpen`), `Wolf_Idle` bouclé. `anims.glb` : pistes de
  rotation sur tous les os, translation sur `root`/`pelvis` seulement. Compression meshopt + quantization + WebP :
  `GLTFLoader.setMeshoptDecoder` obligatoire.
- v5 (orchestrateur) : `peek_spotted` est aussi envoyé à la petite fille repérée (le payload ne contient que son propre id).
- v4.1 (agent Personnages) : refonte des visages sans changement de noms ni de budgets. `M_<id>_eyes` a désormais un
  léger émissif (texture × 0,12) pour que les yeux restent lisibles la nuit ; le client peut le moduler ou le laisser tel quel.
