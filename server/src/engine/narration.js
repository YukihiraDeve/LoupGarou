// French narrator lines (CHANNELS.SYSTEM). Gender-neutral wording on purpose.
import { ROLE_INFO } from '../../../shared/roles.js';
import { TEAMS } from '../../../shared/protocol.js';

export const NARRATOR_NAME = 'Narrateur';

export function roleName(role) {
  return ROLE_INFO[role]?.name ?? role;
}

function list(names) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}`;
}

export const T = {
  joined: (name) => `${name} rejoint le camp.`,
  left: (name) => `${name} quitte le camp.`,
  kicked: (name) => `${name} a été exclu du camp.`,
  newHost: (name) => `${name} est maintenant l'hôte de la partie.`,
  spectator: (name) => `${name} observe la partie depuis l'ombre.`,

  start: () => 'La partie commence ! Découvrez votre carte en secret.',
  yourRole: (role) => `Vous êtes ${roleName(role)}. ${ROLE_INFO[role]?.short ?? ''}`.trim(),
  yourWolves: (names) => (names.length
    ? `Votre meute : ${list(names)}.`
    : 'Vous êtes le seul Loup-Garou de la partie.'),

  nightFall: (first) => (first
    ? 'La première nuit tombe sur le camp. Tout le monde ferme les yeux…'
    : 'La nuit tombe sur le camp. Tout le monde ferme les yeux…'),
  cupidon: () => 'Cupidon se réveille et désigne deux amoureux.',
  cupidonRandom: () => 'Cupidon a hésité : les flèches sont parties au hasard.',
  cupidonDone: (a, b) => `Vous avez uni ${a} et ${b}.`,
  lovers: () => 'Les amoureux ouvrent les yeux et se découvrent…',
  yourLover: (name, mixed) => `Vous êtes amoureux de ${name}. Si l'un meurt, l'autre meurt de chagrin.${mixed
    ? ' Votre couple est mixte : vous gagnez ensemble si vous êtes les deux derniers survivants.' : ''}`,
  voyante: () => "La Voyante se réveille et sonde l'âme d'un joueur.",
  inspect: (name, role) => `${name} est ${roleName(role)}.`,
  loups: () => 'Les Loups-Garous se réveillent et choisissent leur victime.',
  wolvesChose: (name) => (name ? `La meute a choisi ${name}.` : "La meute n'a choisi personne."),
  spotted: (name) => `Vous surprenez ${name} en train d'épier : c'est la Petite Fille !`,
  sorciere: () => 'La Sorcière se réveille.',
  witchVictim: (name) => (name ? `Les loups ont attaqué ${name}.` : "Les loups n'ont attaqué personne cette nuit."),
  witchHealed: (name) => `Vous sauvez ${name} avec votre potion de vie.`,
  witchKilled: (name) => `Vous empoisonnez ${name}.`,

  dawn: (day) => `Le jour ${day} se lève sur le camp.`,
  nightDeath: (name, role) => `Cette nuit, le village a perdu ${name} (${roleName(role)}).`,
  grief: (name, role) => `${name} ne survit pas à la perte de son amour (${roleName(role)}).`,
  noDeath: () => "Miracle : personne n'est mort cette nuit !",

  hunter: (name) => `${name} était Chasseur et épaule son fusil pour un dernier tir…`,
  hunterShot: (hunter, name, role) => `Dernière balle de ${hunter} : ${name} s'effondre (${roleName(role)}).`,
  hunterMissed: (hunter) => `${hunter} n'a pas tiré.`,

  succession: (name) => `${name} était Capitaine et désigne son successeur.`,
  newCaptain: (name) => `${name} devient Capitaine !`,
  election: () => 'Élisez votre Capitaine : sa voix comptera double au vote du village.',
  elected: (name) => `Le village élit ${name} Capitaine !`,

  debate: (day) => `Jour ${day} : le débat est ouvert. Qui sont les loups ?`,
  vote: () => "Le soleil décline : votez avant qu'il ne touche l'horizon !",
  executed: (name, role) => `Le village a tranché : exécution de ${name} (${roleName(role)}).`,
  tie: (names) => `Égalité entre ${list(names)} : le Capitaine doit trancher.`,
  noLynch: () => "Égalité : personne n'est exécuté aujourd'hui.",
  noVote: () => "Personne n'a voté : pas d'exécution aujourd'hui.",

  victory: (winner, names) => {
    if (winner === TEAMS.VILLAGE) return 'Victoire du village ! Les Loups-Garous ont été chassés du camp.';
    if (winner === TEAMS.LOUPS) return 'Victoire des Loups-Garous ! Le camp est tombé sous leurs crocs.';
    return `Victoire des amoureux ${list(names)} ! Leur amour a triomphé de tout.`;
  },
  restart: () => 'Retour au camp : préparez la prochaine partie.',
};
