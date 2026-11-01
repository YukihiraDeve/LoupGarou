// Who may know what. Single source of truth for snapshots, presence relay and chat rights.
import { PHASES, NIGHT_STEPS, ROLES, CHANNELS, EYES, GESTURES, DEATH_CAUSES } from '../../../shared/protocol.js';

/** A game is running (roles dealt, not over). */
export function inGame(game) {
  return game.phase !== PHASES.LOBBY && game.phase !== PHASES.GAME_OVER;
}

/** Observers see everything: spectators and dead players during a game, everyone once it is over. */
export function isObserver(game, m) {
  if (!m) return false;
  if (game.phase === PHASES.GAME_OVER) return true;
  if (game.phase === PHASES.LOBBY) return false;
  return m.spectator || !m.alive;
}

export function isLover(game, id) {
  return !!game.lovers && game.lovers.includes(id);
}

export function loverOf(game, id) {
  if (!isLover(game, id)) return null;
  return game.lovers[0] === id ? game.lovers[1] : game.lovers[0];
}

/** Is this living player allowed to have their eyes open right now? */
export function isAwakeAllowed(game, p) {
  if (!p) return false;
  if (!inGame(game) || isObserver(game, p)) return true;
  if (game.phase !== PHASES.NIGHT) return true;
  switch (game.step) {
    case NIGHT_STEPS.CUPIDON: return p.role === ROLES.CUPIDON;
    case NIGHT_STEPS.LOVERS: return isLover(game, p.id);
    case NIGHT_STEPS.VOYANTE: return p.role === ROLES.VOYANTE;
    case NIGHT_STEPS.LOUPS: return p.role === ROLES.LOUP;
    case NIGHT_STEPS.SORCIERE: return p.role === ROLES.SORCIERE;
    default: return false;
  }
}

export function isPeeking(game, p) {
  return !!(p && game.phase === PHASES.NIGHT && game.step === NIGHT_STEPS.LOUPS && game.night?.peek?.peeking
    && game.night.peek.id === p.id && p.alive);
}

/** Night: can living `viewer` see that living `target` is awake? */
function seesAwake(game, viewer, target) {
  if (!target.alive) return false;
  if (isAwakeAllowed(game, viewer) && isAwakeAllowed(game, target)) return true;
  if (game.step === NIGHT_STEPS.LOUPS && isPeeking(game, viewer) && target.role === ROLES.LOUP) return true;
  return false;
}

/** PlayerView.awake: value when visible to the viewer, undefined otherwise (field omitted). */
export function awakeFor(game, viewer, target) {
  if (game.phase !== PHASES.NIGHT || !target.alive) return undefined;
  if (isObserver(game, viewer)) return isAwakeAllowed(game, target);
  if (!viewer || viewer.spectator) return undefined;
  if (viewer.id === target.id) return isAwakeAllowed(game, target);
  return seesAwake(game, viewer, target) ? true : undefined;
}

export function knowsRole(game, viewer, target) {
  if (!target.role) return false;
  if (game.phase === PHASES.LOBBY) return false;
  if (isObserver(game, viewer)) return true;
  if (!target.alive) return true; // revealed at death
  if (!viewer || viewer.spectator) return false;
  if (viewer.id === target.id) return true;
  if (viewer.role === ROLES.LOUP && target.role === ROLES.LOUP) return true;
  if (viewer.role === ROLES.VOYANTE && viewer.inspected && target.id in viewer.inspected) return true;
  return false;
}

export function knowsLover(game, viewer, target) {
  if (!game.lovers || !isLover(game, target.id)) return false;
  if (isObserver(game, viewer)) return true;
  if (!target.alive) return true; // the grief death makes the couple public
  if (!viewer || viewer.spectator) return false;
  if (viewer.role === ROLES.CUPIDON) return true;
  if (isLover(game, viewer.id)) return game.loversKnown; // from the lovers step on
  return false;
}

/** Night kills (wolves, poison) are not disclosed to the village: they become DEATH_CAUSES.NIGHT. */
export function isSecretCause(cause) {
  return cause === DEATH_CAUSES.LOUPS || cause === DEATH_CAUSES.SORCIERE;
}

/** Does `viewer` know the real cause of a secret night death? */
export function knowsSecretCause(game, viewer, cause) {
  if (isObserver(game, viewer)) return true;
  if (!viewer || viewer.spectator) return false;
  if (cause === DEATH_CAUSES.LOUPS) return viewer.role === ROLES.LOUP;
  if (cause === DEATH_CAUSES.SORCIERE) return viewer.role === ROLES.SORCIERE;
  return true;
}

/** Death cause as the viewer is allowed to know it. */
export function deathCauseFor(game, viewer, target) {
  if (target.alive || !target.deathCause) return null;
  const real = target.deathCause;
  if (!isSecretCause(real) || knowsSecretCause(game, viewer, real)) return real;
  return DEATH_CAUSES.NIGHT;
}

/** Presence as relayed: enforces eyes/gesture rules for the sender's current rights. */
export function effectivePresence(game, p) {
  const pr = p.presence;
  if (!pr) return null;
  const out = { yaw: pr.yaw, pitch: pr.pitch, eyes: pr.eyes, gesture: pr.gesture, target: pr.target };
  if (isPeeking(game, p)) {
    out.eyes = EYES.PEEK;
    out.gesture = GESTURES.NONE;
  } else if (!isAwakeAllowed(game, p)) {
    out.eyes = EYES.CLOSED;
    out.gesture = GESTURES.NONE;
  } else if (out.eyes === EYES.PEEK) {
    out.eyes = EYES.OPEN;
  }
  return out;
}

/** May `viewer` receive the presence of `sender`? */
export function seesPresence(game, viewer, sender) {
  if (!viewer || !sender || viewer.id === sender.id || sender.spectator) return false;
  if (!inGame(game)) return true;
  if (isObserver(game, viewer)) return true;
  if (!sender.alive || viewer.spectator) return false;
  if (game.phase !== PHASES.NIGHT) return true;
  if (!viewer.alive) return false;
  if (isAwakeAllowed(game, viewer) && isAwakeAllowed(game, sender)) return true;
  if (game.step === NIGHT_STEPS.LOUPS) {
    if (isPeeking(game, sender) && viewer.role === ROLES.LOUP) return true;
    if (sender.role === ROLES.LOUP && isPeeking(game, viewer)) return true;
  }
  return false;
}

export function presenceRecipients(game, senderId) {
  const sender = game.member(senderId);
  if (!sender) return [];
  const out = [];
  for (const m of game.members()) if (seesPresence(game, m, sender)) out.push(m.id);
  return out;
}

/** French error when `m` may not write on `channel`, else null. */
export function chatError(game, m, channel) {
  if (!m) return 'Vous ne faites pas partie de ce salon.';
  switch (channel) {
    case CHANNELS.VILLAGE:
      if (!inGame(game)) return null;
      if (m.spectator || !m.alive) return 'Les morts ne parlent plus au village : utilisez le canal des morts.';
      if (game.phase === PHASES.NIGHT) return 'Chut… le village dort.';
      return null;
    case CHANNELS.LOUPS:
      if (!inGame(game) || m.spectator || !m.alive || m.role !== ROLES.LOUP) return 'Canal réservé aux Loups-Garous.';
      if (game.phase !== PHASES.NIGHT || game.step !== NIGHT_STEPS.LOUPS) return 'La meute ne parle que pendant son tour.';
      return null;
    case CHANNELS.MORTS:
      if (game.phase === PHASES.LOBBY || !isObserver(game, m)) return 'Canal réservé aux morts et aux spectateurs.';
      return null;
    default:
      return 'Canal inconnu.';
  }
}

export function chatRecipients(game, channel) {
  const out = [];
  for (const m of game.members()) {
    if (channel === CHANNELS.VILLAGE || channel === CHANNELS.SYSTEM) out.push(m.id);
    else if (channel === CHANNELS.LOUPS) {
      if (isObserver(game, m) || (m.alive && !m.spectator && m.role === ROLES.LOUP)) out.push(m.id);
    } else if (channel === CHANNELS.MORTS) {
      if (isObserver(game, m)) out.push(m.id);
    }
  }
  return out;
}
