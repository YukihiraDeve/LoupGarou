// Lobby configuration: composition, timers, captain, speed. Pure validation helpers.
import { ROLES, DEFAULT_TIMERS, MIN_PLAYERS, MAX_PLAYERS, LIMITS } from '../../../shared/protocol.js';
import { defaultComposition, ROLE_INFO } from '../../../shared/roles.js';

export const TIMER_KEYS = Object.freeze(Object.keys(DEFAULT_TIMERS));
export const ROLE_KEYS = Object.freeze(Object.values(ROLES));
/** Roles that can appear at most once. */
export const UNIQUE_ROLES = Object.freeze([
  ROLES.VOYANTE, ROLES.SORCIERE, ROLES.CHASSEUR, ROLES.CUPIDON, ROLES.PETITE_FILLE,
]);
export const MAX_WOLVES = 7;

export function defaultConfig() {
  return { roles: null, timers: { ...DEFAULT_TIMERS }, captain: true, speed: 1 };
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Merge a host request into the current config. Returns { ok, config } or { ok: false, error }.
 * roles: { role: count } (villageois is ignored: it always fills up to the number of players), null = automatic.
 */
export function applyConfig(current, input) {
  if (!isPlainObject(input)) return { ok: false, error: 'Configuration invalide.' };
  const next = {
    roles: current.roles ? { ...current.roles } : null,
    timers: { ...current.timers },
    captain: current.captain,
    speed: current.speed,
  };

  if ('roles' in input) {
    if (input.roles === null) {
      next.roles = null;
    } else if (!isPlainObject(input.roles)) {
      return { ok: false, error: 'Composition invalide.' };
    } else {
      const roles = {};
      for (const role of ROLE_KEYS) roles[role] = 0;
      for (const [role, raw] of Object.entries(input.roles)) {
        if (!ROLE_KEYS.includes(role)) return { ok: false, error: `Rôle inconnu : ${String(role).slice(0, 20)}.` };
        const count = Number(raw);
        if (!Number.isInteger(count) || count < 0) return { ok: false, error: 'Nombre de cartes invalide.' };
        if (UNIQUE_ROLES.includes(role) && count > 1) {
          return { ok: false, error: `${ROLE_INFO[role].name} : une seule carte possible.` };
        }
        if (role === ROLES.LOUP && count > MAX_WOLVES) {
          return { ok: false, error: `Au plus ${MAX_WOLVES} Loups-Garous.` };
        }
        roles[role] = count;
      }
      if (roles[ROLES.LOUP] < 1) return { ok: false, error: 'Il faut au moins un Loup-Garou.' };
      delete roles[ROLES.VILLAGEOIS];
      next.roles = roles;
    }
  }

  if ('timers' in input) {
    if (!isPlainObject(input.timers)) return { ok: false, error: 'Minuteurs invalides.' };
    for (const [key, raw] of Object.entries(input.timers)) {
      if (!TIMER_KEYS.includes(key)) continue; // unknown keys are ignored
      const sec = Number(raw);
      if (!Number.isFinite(sec)) return { ok: false, error: 'Durée invalide.' };
      next.timers[key] = Math.round(Math.min(LIMITS.TIMER_MAX, Math.max(LIMITS.TIMER_MIN, sec)));
    }
  }

  if ('captain' in input) {
    if (typeof input.captain !== 'boolean') return { ok: false, error: 'Option Capitaine invalide.' };
    next.captain = input.captain;
  }

  if ('speed' in input) {
    const speed = Number(input.speed);
    if (!Number.isFinite(speed)) return { ok: false, error: 'Vitesse invalide.' };
    next.speed = Math.round(Math.min(LIMITS.SPEED_MAX, Math.max(LIMITS.SPEED_MIN, speed)) * 100) / 100;
  }

  return { ok: true, config: next };
}

/** Effective composition for n players: villageois fills the remaining seats. */
export function effectiveComposition(config, n) {
  if (!config.roles) return defaultComposition(n);
  const comp = {};
  for (const role of ROLE_KEYS) comp[role] = role === ROLES.VILLAGEOIS ? 0 : config.roles[role] || 0;
  const specials = Object.values(comp).reduce((a, b) => a + b, 0);
  comp[ROLES.VILLAGEOIS] = Math.max(0, Math.max(n, MIN_PLAYERS) - specials);
  return comp;
}

/** French error message when a game cannot start with this composition, else null. */
export function compositionError(comp, n) {
  if (n < MIN_PLAYERS) return `Il faut au moins ${MIN_PLAYERS} joueurs (bots compris).`;
  if (n > MAX_PLAYERS) return `Au plus ${MAX_PLAYERS} joueurs.`;
  const total = Object.values(comp).reduce((a, b) => a + b, 0);
  if (total !== n) return `La composition compte ${total} cartes pour ${n} joueurs.`;
  const wolves = comp[ROLES.LOUP] || 0;
  if (wolves < 1) return 'Il faut au moins un Loup-Garou.';
  if (wolves * 2 >= n) return 'Trop de Loups-Garous pour ce nombre de joueurs.';
  for (const role of UNIQUE_ROLES) {
    if ((comp[role] || 0) > 1) return `${ROLE_INFO[role].name} : une seule carte possible.`;
  }
  return null;
}

/** Public view of the config (effective composition). */
export function publicConfig(config, n) {
  return {
    roles: effectiveComposition(config, n),
    rolesAuto: !config.roles,
    timers: { ...config.timers },
    captain: config.captain,
    speed: config.speed,
  };
}
