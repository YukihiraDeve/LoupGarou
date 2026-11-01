// Bot decisions. A bot only uses what its own personalised snapshot tells it (plus what it heard),
// so it can never cheat: same information as a human sitting in its seat.
import { ACTIONS, ROLES } from '../../../shared/protocol.js';
import { pick, chance } from '../engine/rng.js';

export function newMemory() {
  return {
    knownWolves: new Set(), // non-wolf bots: wolves they are sure about (voyante, petite fille, revealed)
    knownGood: new Set(),
    suspicion: new Map(),   // id -> score
    threats: new Set(),     // wolf bots: players who claimed to be the voyante
    spottedPf: null,        // wolf bots: caught petite fille
  };
}

const isWolfRole = (r) => r === ROLES.LOUP;

/** Update memory with what the snapshot reveals. */
export function observe(snap, mem) {
  const me = snap.me;
  if (!me || !me.id) return;
  const amWolf = isWolfRole(me.role);
  for (const p of snap.players) {
    if (p.id === me.id) continue;
    if (p.role) {
      if (isWolfRole(p.role)) { if (!amWolf) mem.knownWolves.add(p.id); } else mem.knownGood.add(p.id);
    }
    // petite fille peeking: the awake players during the wolves' step are wolves
    if (me.peeking && p.awake === true && !amWolf) mem.knownWolves.add(p.id);
  }
  for (const [id, role] of Object.entries(me.inspected || {})) {
    if (isWolfRole(role)) mem.knownWolves.add(id); else mem.knownGood.add(id);
  }
}

export function suspicionOf(mem, id) { return mem.suspicion.get(id) || 0; }
export function suspect(mem, id, amount) { mem.suspicion.set(id, suspicionOf(mem, id) + amount); }

function byId(snap) { return new Map(snap.players.map((p) => [p.id, p])); }

/** Weighted random pick (weights >= 0). */
function weighted(rng, items, weightOf) {
  if (!items.length) return undefined;
  const w = items.map((x) => Math.max(0.05, weightOf(x)));
  let r = rng() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < items.length; i++) { r -= w[i]; if (r <= 0) return items[i]; }
  return items[items.length - 1];
}

/** Most voted target among `votes` restricted to `pool`, or null. */
export function leaderOf(votes, pool, excludeVoter = null) {
  const tally = new Map();
  for (const [voter, t] of Object.entries(votes || {})) {
    if (!t || voter === excludeVoter || !pool.includes(t)) continue;
    tally.set(t, (tally.get(t) || 0) + 1);
  }
  let best = null;
  let max = 0;
  for (const [t, c] of tally) if (c > max) { max = c; best = t; }
  return best;
}

function wolvesIKnow(snap) {
  return new Set(snap.players.filter((p) => isWolfRole(p.role)).map((p) => p.id));
}

/** Target for a public vote (day vote, tiebreak, hunter...), coherent with the bot's camp. */
function campTarget(snap, mem, rng, targets, follow = 0.5) {
  const me = snap.me;
  const amWolf = isWolfRole(me.role);
  let pool = targets.filter((id) => id !== me.lover && id !== me.id);
  if (!pool.length) pool = targets.slice();
  if (amWolf) {
    const pack = wolvesIKnow(snap);
    const prey = pool.filter((id) => !pack.has(id));
    if (!prey.length) return pick(rng, pool);
    const threat = prey.find((id) => mem.threats.has(id) || id === mem.spottedPf);
    if (threat && chance(rng, 0.6)) return threat;
    const leader = leaderOf(snap.votes, prey, me.id);
    if (leader && chance(rng, follow + 0.1)) return leader;
    return weighted(rng, prey, (id) => 1 + suspicionOf(mem, id) * 0.3);
  }
  const sure = pool.filter((id) => mem.knownWolves.has(id));
  if (sure.length) return pick(rng, sure);
  const unknown = pool.filter((id) => !mem.knownGood.has(id));
  const candidates = unknown.length ? unknown : pool;
  const leader = leaderOf(snap.votes, candidates, me.id);
  if (leader && chance(rng, follow)) return leader;
  return weighted(rng, candidates, (id) => 1 + suspicionOf(mem, id));
}

/** Decide the payload for one allowed action, or null to abstain. */
export function decide(type, snap, mem, rng) {
  const me = snap.me;
  const targets = me.targets?.[type] || [];
  const players = byId(snap);
  switch (type) {
    case ACTIONS.CUPIDON_LINK: {
      if (targets.length < 2) return null;
      const others = targets.filter((id) => id !== me.id);
      const first = targets.includes(me.id) && chance(rng, 0.3) ? me.id : pick(rng, others);
      const second = pick(rng, targets.filter((id) => id !== first));
      return { type, targets: [first, second] };
    }
    case ACTIONS.VOYANTE_INSPECT: {
      const fresh = targets.filter((id) => !(id in (me.inspected || {})) && !mem.knownGood.has(id));
      const pool = fresh.length ? fresh : targets;
      const t = weighted(rng, pool, (id) => 1 + suspicionOf(mem, id));
      return t ? { type, target: t } : null;
    }
    case ACTIONS.LOUP_VOTE: {
      if (!targets.length) return null;
      const pool = targets.filter((id) => id !== me.lover);
      const choices = pool.length ? pool : targets;
      const leader = leaderOf(snap.votes, choices, me.id);
      if (leader && chance(rng, 0.85)) return { type, target: leader };
      const threat = choices.find((id) => mem.threats.has(id) || id === mem.spottedPf);
      if (threat && chance(rng, 0.7)) return { type, target: threat };
      return { type, target: weighted(rng, choices, (id) => 1 + suspicionOf(mem, id) * 0.2) };
    }
    case ACTIONS.SORCIERE_HEAL: {
      const victim = me.wolfVictim;
      if (!victim) return null;
      if (victim === me.id || victim === me.lover || mem.knownGood.has(victim)) return { type };
      if (mem.knownWolves.has(victim)) return null;
      return chance(rng, snap.day === 0 ? 0.75 : 0.55) ? { type } : null;
    }
    case ACTIONS.SORCIERE_KILL: {
      const sure = targets.filter((id) => mem.knownWolves.has(id) && players.get(id)?.alive);
      if (sure.length && chance(rng, 0.85)) return { type, target: pick(rng, sure) };
      if (snap.day >= 2 && chance(rng, 0.18)) {
        const pool = targets.filter((id) => id !== me.lover && !mem.knownGood.has(id));
        const top = pool.sort((a, b) => suspicionOf(mem, b) - suspicionOf(mem, a))[0];
        if (top && suspicionOf(mem, top) >= 1.5) return { type, target: top };
      }
      return null;
    }
    case ACTIONS.SORCIERE_DONE: return { type };
    case ACTIONS.HUNTER_SHOOT: {
      const t = campTarget(snap, mem, rng, targets, 0.3);
      return t ? { type, target: t } : null;
    }
    case ACTIONS.CAPTAIN_DESIGNATE: {
      if (!targets.length) return null;
      if (isWolfRole(me.role)) {
        const pack = targets.filter((id) => wolvesIKnow(snap).has(id));
        if (pack.length && chance(rng, 0.6)) return { type, target: pick(rng, pack) };
        return { type, target: pick(rng, targets) };
      }
      const good = targets.filter((id) => mem.knownGood.has(id));
      if (good.length) return { type, target: pick(rng, good) };
      const safe = targets.filter((id) => !mem.knownWolves.has(id));
      return { type, target: weighted(rng, safe.length ? safe : targets, (id) => 3 - Math.min(2.5, suspicionOf(mem, id))) };
    }
    case ACTIONS.CAPTAIN_TIEBREAK: {
      const t = campTarget(snap, mem, rng, targets, 0);
      return t ? { type, target: t } : null;
    }
    case ACTIONS.ELECTION_VOTE: {
      if (!targets.length) return null;
      if (chance(rng, 0.2) && targets.includes(me.id)) return { type, target: me.id };
      if (isWolfRole(me.role)) {
        const pack = targets.filter((id) => wolvesIKnow(snap).has(id) && id !== me.id);
        if (pack.length && chance(rng, 0.4)) return { type, target: pick(rng, pack) };
      } else {
        const good = targets.filter((id) => mem.knownGood.has(id));
        if (good.length && chance(rng, 0.7)) return { type, target: pick(rng, good) };
      }
      const pool = targets.filter((id) => !mem.knownWolves.has(id));
      const leader = leaderOf(snap.votes, pool, me.id);
      if (leader && chance(rng, 0.45)) return { type, target: leader };
      return { type, target: weighted(rng, pool.length ? pool : targets, (id) => 2 - Math.min(1.8, suspicionOf(mem, id) * 0.5)) };
    }
    case ACTIONS.DAY_VOTE: {
      const t = campTarget(snap, mem, rng, targets, 0.5);
      return t ? { type, target: t } : null;
    }
    case ACTIONS.SKIP: return { type };
    default: return null;
  }
}
