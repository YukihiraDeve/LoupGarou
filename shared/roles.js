// Role descriptions shared by the server (rules) and the client (cards, UI). French UI text.
import { ROLES, TEAMS, MIN_PLAYERS, MAX_PLAYERS } from './protocol.js';

export const ROLE_INFO = Object.freeze({
  [ROLES.VILLAGEOIS]: {
    name: 'Simple Villageois',
    team: TEAMS.VILLAGE,
    short: 'Démasquez les Loups-Garous et éliminez-les lors du vote.',
    desc: "Vous n'avez aucun pouvoir particulier : votre arme, c'est votre flair et votre voix au vote du village.",
  },
  [ROLES.LOUP]: {
    name: 'Loup-Garou',
    team: TEAMS.LOUPS,
    short: 'Chaque nuit, dévorez un villageois avec votre meute.',
    desc: 'La nuit, vous ouvrez les yeux avec les autres loups et désignez ensemble une victime. Le jour, faites-vous passer pour un villageois.',
  },
  [ROLES.VOYANTE]: {
    name: 'Voyante',
    team: TEAMS.VILLAGE,
    short: "Chaque nuit, découvrez le rôle d'un joueur.",
    desc: 'Chaque nuit, vous choisissez un joueur et sa carte vous est révélée. Aidez le village sans vous faire repérer par les loups.',
  },
  [ROLES.SORCIERE]: {
    name: 'Sorcière',
    team: TEAMS.VILLAGE,
    short: 'Une potion de vie, une potion de mort.',
    desc: "Vous voyez la victime des loups et pouvez la sauver avec votre potion de vie. Vous pouvez aussi empoisonner un joueur. Chaque potion ne sert qu'une fois.",
  },
  [ROLES.CHASSEUR]: {
    name: 'Chasseur',
    team: TEAMS.VILLAGE,
    short: 'En mourant, emportez quelqu\'un avec vous.',
    desc: 'Quand vous mourez, quelle que soit la cause, vous tirez une dernière balle sur le joueur de votre choix.',
  },
  [ROLES.CUPIDON]: {
    name: 'Cupidon',
    team: TEAMS.VILLAGE,
    short: 'La première nuit, liez deux amoureux.',
    desc: "La première nuit, vous désignez deux amoureux. Si l'un meurt, l'autre meurt de chagrin. Un couple loup + villageois gagne seul s'il survit.",
  },
  [ROLES.PETITE_FILLE]: {
    name: 'Petite Fille',
    team: TEAMS.VILLAGE,
    short: 'Entrouvrez les yeux pendant le tour des loups… sans vous faire prendre.',
    desc: 'Pendant le tour des Loups-Garous, maintenez le bouton pour entrouvrir les yeux et les espionner. Mais les loups peuvent vous voir épier !',
  },
});

// Order in which the night steps are played (night 1 adds cupidon + lovers).
export const NIGHT_ORDER = Object.freeze(['cupidon', 'lovers', 'voyante', 'loups', 'sorciere']);

/** Default composition for n players (host may override in the lobby). */
export function defaultComposition(n) {
  const count = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, n));
  const comp = {
    [ROLES.LOUP]: count <= 7 ? 1 : count <= 11 ? 2 : 3,
    [ROLES.VOYANTE]: 1,
    [ROLES.SORCIERE]: count >= 6 ? 1 : 0,
    [ROLES.CHASSEUR]: count >= 7 ? 1 : 0,
    [ROLES.CUPIDON]: count >= 8 ? 1 : 0,
    [ROLES.PETITE_FILLE]: count >= 9 ? 1 : 0,
    [ROLES.VILLAGEOIS]: 0,
  };
  const used = Object.values(comp).reduce((a, b) => a + b, 0);
  comp[ROLES.VILLAGEOIS] = count - used;
  return comp;
}
