// French texts: phase banners, night narration, instructions, death causes.
import { PHASES, NIGHT_STEPS, ACTIONS, DEATH_CAUSES, TEAMS, ROLES } from '@shared/protocol.js';

export const STEP_NARRATION = {
  [NIGHT_STEPS.FALL]: ['Nuit tombée…', 'Le village s’endort. Fermez les yeux.'],
  [NIGHT_STEPS.CUPIDON]: ['Cupidon se réveille', 'Il désigne deux amoureux…'],
  [NIGHT_STEPS.LOVERS]: ['Les amoureux se réveillent', 'Ils se découvrent en silence…'],
  [NIGHT_STEPS.VOYANTE]: ['La Voyante se réveille', 'Elle sonde l’âme d’un joueur…'],
  [NIGHT_STEPS.LOUPS]: ['Les Loups-Garous se réveillent', 'Ils choisissent leur victime…'],
  [NIGHT_STEPS.SORCIERE]: ['La Sorcière se réveille', 'Elle prépare ses potions…'],
};

export function banner(state) {
  const { phase, step, day } = state;
  switch (phase) {
    case PHASES.LOBBY: return { title: 'Autour du feu', sub: 'En attente des campeurs', icon: 'players', subIcon: null };
    case PHASES.ROLE_REVEAL: return { title: 'Le soleil décline…', sub: 'Découvrez votre rôle', icon: 'card', subIcon: 'sun' };
    case PHASES.NIGHT: {
      const [t, s] = STEP_NARRATION[step] || ['La nuit', ''];
      return step === NIGHT_STEPS.FALL
        ? { title: 'Nuit tombée…', sub: 'Fermez les yeux', icon: 'eye', subIcon: 'moon' }
        : { title: t, sub: s, icon: 'moon', subIcon: null };
    }
    case PHASES.DAWN: return { title: 'L’aube se lève', sub: `Jour ${Math.max(1, day)} · le village se réveille`, icon: 'sunrise', subIcon: null };
    case PHASES.HUNTER: return { title: 'Le dernier tir du Chasseur', sub: 'Il emporte quelqu’un avec lui', icon: 'target', subIcon: null };
    case PHASES.CAPTAIN_SUCCESSION: return { title: 'Le Capitaine est tombé', sub: 'Il désigne son successeur', icon: 'star', subIcon: null };
    case PHASES.ELECTION: return { title: 'Élection du Capitaine', sub: 'Sa voix comptera double', icon: 'star', subIcon: 'sun' };
    case PHASES.DEBATE: return { title: 'Le village débat', sub: 'Qui sont les Loups-Garous ?', icon: 'chat', subIcon: 'sun' };
    case PHASES.VOTE: return { title: 'Le vote', sub: 'Il se ferme quand le soleil touche l’horizon', icon: 'vote', subIcon: 'sun' };
    case PHASES.EXECUTION: return { title: 'Le verdict', sub: 'Le soleil se couche…', icon: 'skull', subIcon: null };
    case PHASES.GAME_OVER: return { title: 'Fin de la partie', sub: '', icon: 'star', subIcon: null };
    default: return { title: '', sub: '', icon: 'eye' };
  }
}

export const ACTION_TEXT = {
  [ACTIONS.CUPIDON_LINK]: { consigne: 'Touchez deux joueurs à unir', verb: 'Unir', confirm: (n) => `Unir <b>${n}</b> ?`, icon: 'heart' },
  [ACTIONS.VOYANTE_INSPECT]: { consigne: 'Touchez un joueur pour sonder son âme', verb: 'Sonder', confirm: (n) => `Sonder l’âme de <b>${n}</b> ?`, icon: 'eye' },
  [ACTIONS.LOUP_VOTE]: { consigne: 'Touchez votre victime', verb: 'Dévorer', confirm: (n) => `Dévorer <b>${n}</b> ?`, icon: 'target' },
  [ACTIONS.SORCIERE_KILL]: { consigne: 'Touchez le joueur à empoisonner', verb: 'Empoisonner', confirm: (n) => `Empoisonner <b>${n}</b> ?`, icon: 'potion' },
  [ACTIONS.HUNTER_SHOOT]: { consigne: 'Visez un joueur et tirez !', verb: 'Tirer', confirm: (n) => `Tirer sur <b>${n}</b> ?`, icon: 'target' },
  [ACTIONS.ELECTION_VOTE]: { consigne: 'Touchez un joueur pour l’élire Capitaine', verb: 'Voter', confirm: (n) => `Élire <b>${n}</b> Capitaine ?`, icon: 'star' },
  [ACTIONS.DAY_VOTE]: { consigne: 'Touchez un joueur pour voter contre lui', verb: 'Voter', confirm: (n) => `Voter contre <b>${n}</b> ?`, icon: 'vote' },
  [ACTIONS.CAPTAIN_DESIGNATE]: { consigne: 'Désignez votre successeur', verb: 'Nommer', confirm: (n) => `Nommer <b>${n}</b> Capitaine ?`, icon: 'star' },
  [ACTIONS.CAPTAIN_TIEBREAK]: { consigne: 'Égalité : tranchez entre les ex æquo', verb: 'Trancher', confirm: (n) => `Exécuter <b>${n}</b> ?`, icon: 'skull' },
};

export const CAUSE_TEXT = {
  [DEATH_CAUSES.LOUPS]: 'dévoré par les loups',
  [DEATH_CAUSES.SORCIERE]: 'empoisonné',
  [DEATH_CAUSES.VOTE]: 'exécuté par le village',
  [DEATH_CAUSES.CHASSEUR]: 'abattu par le Chasseur',
  [DEATH_CAUSES.CHAGRIN]: 'mort de chagrin',
  [DEATH_CAUSES.NIGHT || 'nuit']: 'mort pendant la nuit',
};

export const WIN_TEXT = {
  [TEAMS.VILLAGE]: ['Le village a gagné !', 'Tous les Loups-Garous ont été démasqués.'],
  [TEAMS.LOUPS]: ['Les Loups-Garous ont gagné !', 'La meute a dévoré le village.'],
  [TEAMS.AMOUREUX]: ['Les amoureux ont gagné !', 'Leur amour a triomphé de tout.'],
};

export const PHASE_SPEECH = {
  [PHASES.ROLE_REVEAL]: 'Le soleil décline sur le camp. Découvrez votre rôle, en secret.',
  [PHASES.DAWN]: 'L’aube se lève. Le village se réveille.',
  [PHASES.ELECTION]: 'Le village doit élire son Capitaine.',
  [PHASES.DEBATE]: 'Le village débat. Qui sont les Loups-Garous ?',
  [PHASES.VOTE]: 'Il est temps de voter. Le vote se ferme au coucher du soleil.',
  [PHASES.HUNTER]: 'Le Chasseur, dans un dernier souffle, tire une balle.',
  [PHASES.CAPTAIN_SUCCESSION]: 'Le Capitaine est mort. Il désigne son successeur.',
};

export const TEAM_OF = (role) => (role === ROLES.LOUP ? TEAMS.LOUPS : TEAMS.VILLAGE);
