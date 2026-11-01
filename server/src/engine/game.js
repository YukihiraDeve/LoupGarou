// Authoritative game state of one room: lobby + rules engine. Pure module (no network, no timers):
// time comes from an injected now(), randomness from an injected rng(). The network layer calls
// tick() at nextDeadline() and drains the outbox (events + narrator lines with explicit recipients).
import { randomBytes } from 'node:crypto';
import {
  PHASES, NIGHT_STEPS, ROLES, TEAMS, ACTIONS, EVENTS, CHANNELS, DEATH_CAUSES,
  MAX_PLAYERS, AVATARS, LIMITS, EYES, GESTURES,
} from '../../../shared/protocol.js';
import { defaultConfig, applyConfig, effectiveComposition, compositionError } from './config.js';
import { T, NARRATOR_NAME } from './narration.js';
import * as V from './visibility.js';
import { pick, shuffle } from './rng.js';
import { clamp, YAW_LIMIT, PITCH_MIN, PITCH_MAX, isLookingAt } from './geometry.js';

const NIGHT_SEQUENCE = [
  NIGHT_STEPS.FALL, NIGHT_STEPS.CUPIDON, NIGHT_STEPS.LOVERS,
  NIGHT_STEPS.VOYANTE, NIGHT_STEPS.LOUPS, NIGHT_STEPS.SORCIERE,
];
const STEP_TIMER = {
  [NIGHT_STEPS.FALL]: 'night_fall',
  [NIGHT_STEPS.CUPIDON]: 'cupidon',
  [NIGHT_STEPS.LOVERS]: 'lovers',
  [NIGHT_STEPS.VOYANTE]: 'voyante',
  [NIGHT_STEPS.LOUPS]: 'loups',
  [NIGHT_STEPS.SORCIERE]: 'sorciere',
};
/** Seconds (x speed) left once everybody concerned has acted, so the result can be seen. */
const GRACE = {
  [NIGHT_STEPS.CUPIDON]: 2,
  [NIGHT_STEPS.VOYANTE]: 3,
  [NIGHT_STEPS.LOUPS]: 2,
  [NIGHT_STEPS.SORCIERE]: 1.5,
  [PHASES.HUNTER]: 3,
  [PHASES.CAPTAIN_SUCCESSION]: 2,
  [PHASES.ELECTION]: 2.5,
  [PHASES.DEBATE]: 1,
  [PHASES.VOTE]: 3,
};
const GESTURE_VALUES = new Set(Object.values(GESTURES));
const EYES_VALUES = new Set(Object.values(EYES));
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g;

export function cleanText(raw, max) {
  if (typeof raw !== 'string') return '';
  return raw.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function ok(extra) { return { ok: true, ...extra }; }
function fail(error) { return { ok: false, error }; }

export class Game {
  /**
   * @param {{code?:string, now?:()=>number, rng?:()=>number, speedFactor?:number, idGen?:()=>string}} opts
   * speedFactor multiplies every duration on top of the host's config.speed (env SPEED).
   */
  constructor(opts = {}) {
    this.code = opts.code || 'TEST';
    this.now = opts.now || Date.now;
    this.rng = opts.rng || Math.random;
    this.speedFactor = opts.speedFactor > 0 ? opts.speedFactor : 1;
    this.idGen = opts.idGen || (() => `p${randomBytes(6).toString('hex')}`);
    this.players = []; // seated players, in join order
    this.spectators = []; // joined after the start (no seat)
    this.byId = new Map();
    this.hostId = null;
    this.config = defaultConfig();
    this.joinSeq = 0;
    this.chatSeq = 0;
    this.outbox = [];
    this.dirty = true;
    this.version = 0;
    this.gamesPlayed = 0;
    this.resetGameState();
  }

  resetGameState() {
    this.phase = PHASES.LOBBY;
    this.step = null;
    this.day = 0;
    this.phaseStartedAt = this.now();
    this.phaseEndsAt = null;
    this.fullEndsAt = null;
    this.earlyAt = null;
    this.lovers = null;
    this.loversKnown = false;
    this.captainId = null;
    this.potions = { heal: false, kill: false };
    this.night = null;
    this.electionVotes = new Map();
    this.dayVotes = new Map();
    this.skips = new Set();
    this.pendingHunters = [];
    this.pendingSuccession = null;
    this.currentHunter = null;
    this.hunterShot = false;
    this.currentSuccession = null;
    this.designated = false;
    this.resume = null;
    this.execStage = null;
    this.tie = null;
    this.lastDeaths = [];
    this.result = null;
    for (const p of this.players) this.resetPlayer(p);
  }

  resetPlayer(p) {
    p.role = null;
    p.alive = true;
    p.inspected = {};
    p.deathCause = null;
    p.deathDay = null;
  }

  // ---------------------------------------------------------------- members

  members() { return this.players.concat(this.spectators); }
  member(id) { return (typeof id === 'string' && this.byId.get(id)) || null; }
  player(id) { const m = this.member(id); return m && !m.spectator ? m : null; }
  living() { return this.players.filter((p) => p.alive); }
  allIds() { return this.members().map((m) => m.id); }
  idsWhere(fn) { return this.members().filter(fn).map((m) => m.id); }
  observerIds() { return this.idsWhere((m) => V.isObserver(this, m)); }
  humans() { return this.members().filter((m) => !m.isBot); }
  isRunning() { return V.inGame(this); }
  name(id) { return this.member(id)?.name ?? '?'; }
  playersWithRole(role) { return this.players.filter((p) => p.role === role); }
  livingWithRole(role) { return this.players.filter((p) => p.alive && p.role === role); }

  /** Living players who count in a quorum: connected humans and bots. */
  quorum(filter = () => true) {
    return this.players.filter((p) => p.alive && (p.connected || p.isBot) && filter(p));
  }

  // ---------------------------------------------------------------- outbox

  touch() { this.dirty = true; this.version++; }

  emit(event, to) {
    if (!to || to.length === 0) return;
    this.outbox.push({ kind: 'event', event, to: [...new Set(to)] });
  }

  narrate(text, to = this.allIds()) {
    if (!to || to.length === 0) return;
    this.outbox.push({ kind: 'chat', msg: this.systemMessage(text), to: [...new Set(to)] });
  }

  systemMessage(text) {
    return { id: ++this.chatSeq, from: null, name: NARRATOR_NAME, text, channel: CHANNELS.SYSTEM, ts: this.now() };
  }

  nextChatId() { return ++this.chatSeq; }

  /** Items emitted since the last drain, in order, plus whether the state changed. */
  drain() {
    const items = this.outbox;
    const dirty = this.dirty;
    this.outbox = [];
    this.dirty = false;
    return { items, dirty };
  }

  // ---------------------------------------------------------------- lobby

  uniqueName(raw, excludeId = null) {
    let base = cleanText(raw, LIMITS.NAME_MAX);
    if (!base) base = `Campeur ${this.joinSeq + 1}`;
    const taken = new Set(this.members().filter((m) => m.id !== excludeId).map((m) => m.name.toLowerCase()));
    if (!taken.has(base.toLowerCase())) return base;
    for (let i = 2; i < 100; i++) {
      const suffix = ` ${i}`;
      const candidate = base.slice(0, LIMITS.NAME_MAX - suffix.length) + suffix;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return `${base.slice(0, LIMITS.NAME_MAX - 5)} ${this.joinSeq}`;
  }

  freeAvatars(excludeId = null) {
    const taken = new Set(this.players.filter((p) => p.id !== excludeId).map((p) => p.avatar));
    return AVATARS.filter((a) => !taken.has(a));
  }

  chooseAvatar(requested, excludeId = null) {
    const free = this.freeAvatars(excludeId);
    if (AVATARS.includes(requested) && free.includes(requested)) return requested;
    if (free.length) return pick(this.rng, free);
    return AVATARS.includes(requested) ? requested : pick(this.rng, AVATARS);
  }

  reseat() {
    const n = this.players.length;
    this.players.forEach((p, i) => { p.seat = Math.round((i * MAX_PLAYERS) / n) % MAX_PLAYERS; });
  }

  makeMember({ name, avatar, isBot = false, spectator = false }) {
    const m = {
      id: this.idGen(),
      name: this.uniqueName(name),
      avatar: spectator ? (AVATARS.includes(avatar) ? avatar : AVATARS[0]) : this.chooseAvatar(avatar),
      seat: -1,
      isBot: !!isBot,
      spectator: !!spectator,
      connected: true,
      disconnectedAt: null,
      joinSeq: ++this.joinSeq,
      presence: null,
      presenceAt: 0,
    };
    this.resetPlayer(m);
    if (spectator) m.alive = false;
    this.byId.set(m.id, m);
    return m;
  }

  /** Join the room: seated in the lobby, spectator once the game started. */
  join({ name, avatar, isBot = false } = {}) {
    if (this.phase === PHASES.LOBBY) {
      if (this.players.length >= MAX_PLAYERS) return fail('Le camp est complet (16 joueurs).');
      const p = this.makeMember({ name, avatar, isBot });
      this.players.push(p);
      this.reseat();
      if (!this.hostId && !p.isBot) this.hostId = p.id;
      this.narrate(T.joined(p.name));
      this.touch();
      return ok({ member: p, spectator: false });
    }
    if (isBot) return fail('La partie a déjà commencé.');
    if (this.spectators.length >= LIMITS.MAX_SPECTATORS) return fail('Trop de spectateurs dans ce salon.');
    const s = this.makeMember({ name, avatar, spectator: true });
    this.spectators.push(s);
    if (!this.hostId) this.hostId = s.id;
    this.narrate(T.spectator(s.name));
    this.touch();
    return ok({ member: s, spectator: true });
  }

  addBot(byId, name) {
    if (byId !== this.hostId) return fail("Seul l'hôte peut ajouter des bots.");
    if (this.phase !== PHASES.LOBBY) return fail('La partie a déjà commencé.');
    if (this.players.length >= MAX_PLAYERS) return fail('Le camp est complet (16 joueurs).');
    return this.join({ name, avatar: null, isBot: true });
  }

  /** Remove a member for good (lobby leave, kick, cleanup). Seated players can't leave a running game. */
  removeMember(id, { kicked = false } = {}) {
    const m = this.member(id);
    if (!m) return fail('Joueur inconnu.');
    if (!m.spectator && this.phase !== PHASES.LOBBY && this.phase !== PHASES.GAME_OVER) {
      return fail('Impossible de quitter une partie en cours.');
    }
    if (m.spectator) this.spectators = this.spectators.filter((s) => s !== m);
    else this.players = this.players.filter((p) => p !== m);
    this.byId.delete(id);
    if (!m.spectator && this.phase === PHASES.LOBBY) {
      // a waiting spectator takes the free seat
      const next = this.spectators.shift();
      if (next) this.promoteSpectator(next);
      this.reseat();
    }
    this.narrate(kicked ? T.kicked(m.name) : T.left(m.name));
    if (this.hostId === id) this.transferHost();
    this.touch();
    return ok({ member: m });
  }

  promoteSpectator(s) {
    s.spectator = false;
    s.avatar = this.chooseAvatar(s.avatar, s.id);
    this.resetPlayer(s);
    this.players.push(s);
  }

  kick(byId, targetId) {
    if (byId !== this.hostId) return fail("Seul l'hôte peut exclure un joueur.");
    if (this.phase !== PHASES.LOBBY) return fail("On n'exclut personne pendant la partie.");
    if (targetId === byId) return fail('Vous ne pouvez pas vous exclure vous-même.');
    if (!this.member(targetId)) return fail('Joueur inconnu.');
    return this.removeMember(targetId, { kicked: true });
  }

  /** Pick a new host among humans: connected seated first, then any seated, then spectators. */
  transferHost() {
    const humans = this.humans().sort((a, b) => (a.spectator - b.spectator) || (b.connected - a.connected)
      || (a.joinSeq - b.joinSeq));
    const prev = this.hostId;
    this.hostId = humans[0]?.id ?? null;
    if (this.hostId && this.hostId !== prev) this.narrate(T.newHost(this.name(this.hostId)));
    this.touch();
  }

  setConnected(id, connected) {
    const m = this.member(id);
    if (!m || m.connected === connected) return;
    m.connected = connected;
    m.disconnectedAt = connected ? null : this.now();
    if (!connected && V.isPeeking(this, m)) this.stopPeek(this.now());
    this.touch();
    if (this.isRunning()) this.refreshEarlyEnd();
  }

  setAvatar(id, avatar) {
    const p = this.player(id);
    if (!p) return fail('Joueur inconnu.');
    if (this.phase !== PHASES.LOBBY) return fail("L'avatar se choisit dans le salon.");
    if (!AVATARS.includes(avatar)) return fail('Avatar inconnu.');
    if (p.avatar === avatar) return ok();
    const free = this.freeAvatars(id);
    if (!free.includes(avatar) && free.length > 0) return fail('Cet avatar est déjà pris.');
    p.avatar = avatar;
    this.touch();
    return ok();
  }

  setConfig(byId, input) {
    if (byId !== this.hostId) return fail("Seul l'hôte peut régler la partie.");
    if (this.phase !== PHASES.LOBBY) return fail('La partie a déjà commencé.');
    const res = applyConfig(this.config, input);
    if (!res.ok) return res;
    this.config = res.config;
    this.touch();
    return ok();
  }

  composition() { return effectiveComposition(this.config, this.players.length); }
  startError() {
    if (this.phase !== PHASES.LOBBY) return 'La partie a déjà commencé.';
    return compositionError(this.composition(), this.players.length);
  }

  /** Lobby housekeeping, called periodically by the network layer. Returns removed member ids. */
  maintenance({ hostGraceMs = 30_000, lobbyGraceMs = 120_000 } = {}) {
    const now = this.now();
    const removed = [];
    if (this.phase === PHASES.LOBBY) {
      for (const m of this.members()) {
        if (!m.isBot && !m.connected && m.disconnectedAt != null && now - m.disconnectedAt > lobbyGraceMs) {
          if (this.removeMember(m.id).ok) removed.push(m.id);
        }
      }
    }
    const host = this.member(this.hostId);
    if (!host || (!host.connected && host.disconnectedAt != null && now - host.disconnectedAt > hostGraceMs
      && this.humans().some((m) => m.connected && m.id !== host.id))) {
      this.transferHost();
    }
    return removed;
  }

  // ---------------------------------------------------------------- start / restart

  start(byId) {
    if (byId !== this.hostId) return fail("Seul l'hôte peut lancer la partie.");
    const error = this.startError();
    if (error) return fail(error);
    const comp = this.composition();
    const deck = [];
    for (const [role, count] of Object.entries(comp)) for (let i = 0; i < count; i++) deck.push(role);
    const roles = shuffle(this.rng, deck);
    this.resetGameState();
    this.players.forEach((p, i) => { p.role = roles[i]; });
    const hasWitch = this.players.some((p) => p.role === ROLES.SORCIERE);
    this.potions = { heal: hasWitch, kill: hasWitch };
    this.gamesPlayed++;
    this.setPhase(PHASES.ROLE_REVEAL, null, this.ms('role_reveal'));
    this.narrate(T.start());
    const wolves = this.playersWithRole(ROLES.LOUP);
    for (const p of this.players) {
      this.narrate(T.yourRole(p.role), [p.id]);
      if (p.role === ROLES.LOUP) this.narrate(T.yourWolves(wolves.filter((w) => w !== p).map((w) => w.name)), [p.id]);
    }
    return ok();
  }

  restart(byId) {
    if (byId !== this.hostId) return fail("Seul l'hôte peut relancer.");
    if (this.phase !== PHASES.GAME_OVER) return fail("La partie n'est pas terminée.");
    while (this.spectators.length && this.players.length < MAX_PLAYERS) this.promoteSpectator(this.spectators.shift());
    this.resetGameState();
    this.reseat();
    this.narrate(T.restart());
    this.emit({ type: EVENTS.PHASE, phase: this.phase, step: null, day: 0 }, this.allIds());
    this.touch();
    return ok();
  }

  // ---------------------------------------------------------------- time

  scale() { return this.config.speed * this.speedFactor; }
  ms(timerKey) { return Math.max(0, Math.round((this.config.timers[timerKey] ?? 10) * this.scale() * 1000)); }
  secs(s) { return Math.max(0, Math.round(s * this.scale() * 1000)); }
  peekBudgetMs() { return this.secs(LIMITS.PEEK_SECONDS); }
  spotMs() { return this.secs(LIMITS.PEEK_SPOT_SECONDS); }

  setPhase(phase, step, durationMs) {
    const now = this.now();
    this.phase = phase;
    this.step = step;
    this.phaseStartedAt = now;
    this.fullEndsAt = durationMs == null ? null : now + durationMs;
    this.earlyAt = null;
    this.phaseEndsAt = this.fullEndsAt;
    this.emit({ type: EVENTS.PHASE, phase, step, day: this.day }, this.allIds());
    this.touch();
  }

  /** New end for the current phase without announcing a new phase. */
  extendPhase(durationMs) {
    this.fullEndsAt = this.now() + durationMs;
    this.earlyAt = null;
    this.phaseEndsAt = this.fullEndsAt;
    this.touch();
  }

  nextDeadline() {
    let d = this.phaseEndsAt;
    const pk = this.night?.peek;
    if (this.phase === PHASES.NIGHT && this.step === NIGHT_STEPS.LOUPS && pk?.peeking) {
      const exhaust = pk.since + pk.leftMs;
      d = d == null ? exhaust : Math.min(d, exhaust);
      if (!pk.spotted) {
        const spot = pk.streakStart + this.spotMs();
        if (spot > this.now()) d = Math.min(d, spot);
      }
    }
    return d;
  }

  tick() {
    if (!this.isRunning()) return;
    const now = this.now();
    this.updatePeek(now);
    let guard = 0;
    while (this.phaseEndsAt != null && now >= this.phaseEndsAt && guard++ < 64) this.onPhaseEnd();
  }

  onPhaseEnd() {
    switch (this.phase) {
      case PHASES.ROLE_REVEAL: return this.startNight();
      case PHASES.NIGHT: this.endNightStep(); return this.advanceNight();
      case PHASES.DAWN: return this.continueQueue();
      case PHASES.HUNTER:
        if (!this.hunterShot) this.narrate(T.hunterMissed(this.name(this.currentHunter)));
        this.currentHunter = null;
        return this.continueQueue();
      case PHASES.CAPTAIN_SUCCESSION:
        if (!this.designated) {
          const heir = pick(this.rng, this.quorum().length ? this.quorum() : this.living());
          if (heir) this.setCaptain(heir.id);
        }
        this.currentSuccession = null;
        return this.continueQueue();
      case PHASES.ELECTION: this.resolveElection(); return this.startDebate();
      case PHASES.DEBATE: return this.startVote();
      case PHASES.VOTE: return this.startExecution();
      case PHASES.EXECUTION:
        if (this.execStage === 'tiebreak') {
          this.execStage = 'result';
          this.tie = null;
          this.emit({ type: EVENTS.NO_LYNCH }, this.allIds());
          this.narrate(T.noLynch());
          return this.extendPhase(Math.round(this.ms('execution') * 0.6));
        }
        this.resume = 'night';
        return this.continueQueue();
      default:
        this.phaseEndsAt = null;
        return undefined;
    }
  }

  /** Called whenever an action or a disconnection may complete the current step. */
  refreshEarlyEnd() {
    if (this.fullEndsAt == null || !this.isRunning()) return;
    const done = this.stepComplete();
    if (done) {
      if (this.earlyAt == null) {
        const key = this.phase === PHASES.NIGHT ? this.step : this.phase;
        this.earlyAt = this.now() + this.secs(GRACE[key] ?? 1);
      }
    } else {
      this.earlyAt = null;
    }
    const ends = this.earlyAt != null ? Math.min(this.fullEndsAt, this.earlyAt) : this.fullEndsAt;
    if (ends !== this.phaseEndsAt) {
      this.phaseEndsAt = ends;
      this.touch();
    }
  }

  stepComplete() {
    const n = this.night;
    switch (this.phase) {
      case PHASES.NIGHT:
        switch (this.step) {
          case NIGHT_STEPS.CUPIDON: return !!n.linked;
          case NIGHT_STEPS.VOYANTE: return !!n.inspected;
          case NIGHT_STEPS.LOUPS: {
            const q = this.quorum((p) => p.role === ROLES.LOUP);
            if (!q.length) return false;
            const first = n.wolfVotes.get(q[0].id);
            return !!first && q.every((w) => n.wolfVotes.get(w.id) === first);
          }
          case NIGHT_STEPS.SORCIERE:
            return n.sorciereDone || (n.sorciereActed && !this.canHeal() && !this.canPoison());
          default: return false;
        }
      case PHASES.HUNTER: return this.hunterShot;
      case PHASES.CAPTAIN_SUCCESSION: return this.designated;
      case PHASES.ELECTION: {
        const q = this.quorum();
        return q.length > 0 && q.every((p) => this.electionVotes.has(p.id));
      }
      case PHASES.DEBATE: {
        const q = this.quorum();
        return q.length > 0 && q.filter((p) => this.skips.has(p.id)).length * 2 > q.length;
      }
      case PHASES.VOTE: {
        const q = this.quorum();
        return q.length > 0 && q.every((p) => this.dayVotes.get(p.id));
      }
      default: return false;
    }
  }

  // ---------------------------------------------------------------- night

  startNight() {
    const pf = this.livingWithRole(ROLES.PETITE_FILLE)[0];
    this.night = {
      wolfVotes: new Map(),
      victim: null,
      healed: false,
      poisoned: null,
      inspected: false,
      linked: false,
      sorciereActed: false,
      sorciereDone: false,
      peek: { id: pf?.id ?? null, leftMs: this.peekBudgetMs(), peeking: false, since: 0, streakStart: 0, spotted: false },
    };
    this.electionVotes.clear();
    this.dayVotes.clear();
    this.skips.clear();
    this.tie = null;
    this.execStage = null;
    this.setPhase(PHASES.NIGHT, NIGHT_STEPS.FALL, this.ms('night_fall'));
    this.narrate(T.nightFall(this.day === 0));
  }

  stepApplies(step) {
    switch (step) {
      case NIGHT_STEPS.CUPIDON: return this.day === 0 && this.livingWithRole(ROLES.CUPIDON).length > 0;
      case NIGHT_STEPS.LOVERS: return this.day === 0 && !!this.lovers;
      case NIGHT_STEPS.VOYANTE: return this.livingWithRole(ROLES.VOYANTE).length > 0;
      case NIGHT_STEPS.LOUPS: return this.livingWithRole(ROLES.LOUP).length > 0;
      case NIGHT_STEPS.SORCIERE: return this.livingWithRole(ROLES.SORCIERE).length > 0;
      default: return false;
    }
  }

  advanceNight() {
    const idx = NIGHT_SEQUENCE.indexOf(this.step);
    for (let i = idx + 1; i < NIGHT_SEQUENCE.length; i++) {
      const step = NIGHT_SEQUENCE[i];
      if (this.stepApplies(step)) return this.enterStep(step);
    }
    return this.dawn();
  }

  enterStep(step) {
    this.setPhase(PHASES.NIGHT, step, this.ms(STEP_TIMER[step]));
    switch (step) {
      case NIGHT_STEPS.CUPIDON: this.narrate(T.cupidon()); break;
      case NIGHT_STEPS.LOVERS: {
        this.narrate(T.lovers());
        this.loversKnown = true;
        const [a, b] = this.lovers;
        this.emit({ type: EVENTS.LOVERS, ids: [a, b] }, [a, b, ...this.observerIds()]);
        const mixed = this.loversMixed();
        this.narrate(T.yourLover(this.name(b), mixed), [a]);
        this.narrate(T.yourLover(this.name(a), mixed), [b]);
        this.touch();
        break;
      }
      case NIGHT_STEPS.VOYANTE: this.narrate(T.voyante()); break;
      case NIGHT_STEPS.LOUPS: this.narrate(T.loups()); break;
      case NIGHT_STEPS.SORCIERE: {
        this.narrate(T.sorciere());
        const witches = this.livingWithRole(ROLES.SORCIERE).map((p) => p.id);
        const victim = this.night.victim;
        this.emit({ type: EVENTS.WOLF_VICTIM, target: victim }, witches);
        this.narrate(T.witchVictim(victim ? this.name(victim) : null), witches);
        break;
      }
      default: break;
    }
  }

  endNightStep() {
    const n = this.night;
    if (this.step === NIGHT_STEPS.CUPIDON && !n.linked) {
      const cupidon = this.livingWithRole(ROLES.CUPIDON)[0];
      const pair = shuffle(this.rng, this.living()).slice(0, 2);
      if (cupidon && pair.length === 2) {
        this.link(pair[0].id, pair[1].id, cupidon.id);
        this.narrate(T.cupidonRandom(), [cupidon.id]);
      }
    } else if (this.step === NIGHT_STEPS.LOUPS) {
      this.stopPeek(this.now());
      n.victim = this.resolveWolfVictim();
      const wolves = this.livingWithRole(ROLES.LOUP).map((w) => w.id);
      this.narrate(T.wolvesChose(n.victim ? this.name(n.victim) : null), wolves);
      this.touch();
    }
  }

  resolveWolfVictim() {
    const tally = new Map();
    for (const [voter, target] of this.night.wolfVotes) {
      const v = this.player(voter);
      const t = this.player(target);
      if (!v || !v.alive || v.role !== ROLES.LOUP || !t || !t.alive) continue;
      tally.set(target, (tally.get(target) || 0) + 1);
    }
    return this.topOf(tally, true);
  }

  /** Most voted id; ties are drawn at random when `drawTies`, else returns null on ties. */
  topOf(tally, drawTies) {
    if (tally.size === 0) return null;
    const max = Math.max(...tally.values());
    const top = [...tally.keys()].filter((k) => tally.get(k) === max);
    if (top.length === 1) return top[0];
    return drawTies ? pick(this.rng, top) : null;
  }

  link(a, b, cupidonId) {
    this.lovers = [a, b];
    this.night.linked = true;
    this.emit({ type: EVENTS.LOVERS, ids: [a, b] }, [cupidonId, ...this.observerIds()]);
    this.narrate(T.cupidonDone(this.name(a), this.name(b)), [cupidonId]);
    this.touch();
    this.refreshEarlyEnd();
  }

  loversMixed() {
    if (!this.lovers) return false;
    const [a, b] = this.lovers.map((id) => this.player(id));
    return !!a && !!b && (a.role === ROLES.LOUP) !== (b.role === ROLES.LOUP);
  }

  canHeal() { return this.potions.heal && !!this.night?.victim && !this.night.healed; }
  canPoison() { return this.potions.kill && !this.night?.poisoned; }

  // petite fille ------------------------------------------------------------

  peekLeftMs(now = this.now()) {
    const pk = this.night?.peek;
    if (!pk) return 0;
    return pk.peeking ? Math.max(0, pk.leftMs - (now - pk.since)) : pk.leftMs;
  }

  startPeek(now) {
    const pk = this.night.peek;
    if (pk.peeking || pk.leftMs <= 0) return;
    pk.peeking = true;
    pk.since = now;
    pk.streakStart = now;
    this.touch();
    this.checkSpotted(now);
  }

  stopPeek(now) {
    const pk = this.night?.peek;
    if (!pk || !pk.peeking) return;
    pk.leftMs = Math.max(0, pk.leftMs - (now - pk.since));
    pk.peeking = false;
    this.touch();
  }

  updatePeek(now) {
    const pk = this.night?.peek;
    if (!pk || !pk.peeking) return;
    if (this.phase !== PHASES.NIGHT || this.step !== NIGHT_STEPS.LOUPS) return this.stopPeek(now);
    this.checkSpotted(now);
    if (pk.leftMs - (now - pk.since) <= 0) this.stopPeek(now);
    return undefined;
  }

  checkSpotted(now = this.now()) {
    const pk = this.night?.peek;
    if (!pk || !pk.peeking || pk.spotted) return;
    if (now - pk.streakStart < this.spotMs()) return;
    const pf = this.player(pk.id);
    if (!pf || !pf.alive) return;
    const watcher = this.livingWithRole(ROLES.LOUP).find((w) => {
      if (!w.connected && !w.isBot) return false;
      const pr = V.effectivePresence(this, w);
      if (!pr || pr.eyes !== EYES.OPEN) return false;
      return pr.target === pf.id || isLookingAt(pr, w.seat, pf.seat);
    });
    if (!watcher) return;
    pk.spotted = true;
    const wolves = this.playersWithRole(ROLES.LOUP).filter((w) => w.alive).map((w) => w.id);
    // She is told too (no wolf identity in the payload): the client plays its "Repérée !" effect.
    this.emit({ type: EVENTS.PEEK_SPOTTED, playerId: pf.id }, [...wolves, pf.id, ...this.observerIds()]);
    this.narrate(T.spotted(pf.name), wolves);
    this.touch();
  }

  // ---------------------------------------------------------------- deaths

  kill(id, cause, deaths) {
    const p = this.player(id);
    if (!p || !p.alive) return;
    if (V.isPeeking(this, p)) this.stopPeek(this.now());
    p.alive = false;
    p.deathCause = cause;
    p.deathDay = this.day;
    deaths.push({ id, cause });
    if (p.role === ROLES.CHASSEUR) this.pendingHunters.push(id);
    if (this.captainId === id) this.pendingSuccession = id;
    const partner = V.loverOf(this, id);
    if (partner) this.kill(partner, DEATH_CAUSES.CHAGRIN, deaths);
    this.touch();
  }

  announceDeaths(deaths, { hunterId = null } = {}) {
    for (const d of deaths) {
      const p = this.player(d.id);
      const payload = { type: EVENTS.DEATH, playerId: d.id, cause: d.cause, role: p.role };
      if (V.isSecretCause(d.cause)) {
        const informed = this.idsWhere((m) => V.knowsSecretCause(this, m, d.cause));
        this.emit(payload, informed);
        const informedSet = new Set(informed);
        this.emit({ ...payload, cause: DEATH_CAUSES.NIGHT }, this.allIds().filter((id) => !informedSet.has(id)));
      } else {
        this.emit(payload, this.allIds());
      }
      switch (d.cause) {
        case DEATH_CAUSES.CHAGRIN: this.narrate(T.grief(p.name, p.role)); break;
        case DEATH_CAUSES.VOTE: this.narrate(T.executed(p.name, p.role)); break;
        case DEATH_CAUSES.CHASSEUR: this.narrate(T.hunterShot(this.name(hunterId), p.name, p.role)); break;
        default: this.narrate(T.nightDeath(p.name, p.role));
      }
    }
  }

  dawn() {
    const n = this.night;
    this.day += 1;
    this.lastDeaths = [];
    const deaths = [];
    if (n.victim && !n.healed) this.kill(n.victim, DEATH_CAUSES.LOUPS, deaths);
    if (n.poisoned) this.kill(n.poisoned, DEATH_CAUSES.SORCIERE, deaths);
    this.lastDeaths = deaths.map((d) => d.id);
    this.resume = 'day';
    this.setPhase(PHASES.DAWN, null, this.ms('dawn'));
    this.narrate(T.dawn(this.day));
    if (deaths.length) this.announceDeaths(deaths);
    else {
      this.emit({ type: EVENTS.NO_DEATH }, this.allIds());
      this.narrate(T.noDeath());
    }
  }

  /** After deaths: victory check, then pending hunter shots, captain succession, then resume. */
  continueQueue() {
    const result = this.checkVictory();
    if (result) return this.gameOver(result);
    while (this.pendingHunters.length) {
      const h = this.pendingHunters.shift();
      if (this.player(h)) {
        this.currentHunter = h;
        this.hunterShot = false;
        this.setPhase(PHASES.HUNTER, null, this.ms('hunter'));
        this.narrate(T.hunter(this.name(h)));
        return undefined;
      }
    }
    if (this.pendingSuccession && this.living().length) {
      this.currentSuccession = this.pendingSuccession;
      this.pendingSuccession = null;
      this.designated = false;
      this.setPhase(PHASES.CAPTAIN_SUCCESSION, null, this.ms('captain_succession'));
      this.narrate(T.succession(this.name(this.currentSuccession)));
      return undefined;
    }
    this.pendingSuccession = null;
    if (this.resume === 'night') return this.startNight();
    if (this.day === 1 && this.config.captain && !this.captainId) return this.startElection();
    return this.startDebate();
  }

  // ---------------------------------------------------------------- day

  setCaptain(id) {
    this.captainId = id;
    this.emit({ type: EVENTS.CAPTAIN, playerId: id }, this.allIds());
    this.touch();
  }

  startElection() {
    this.electionVotes.clear();
    this.setPhase(PHASES.ELECTION, null, this.ms('election'));
    this.narrate(T.election());
  }

  resolveElection() {
    const tally = new Map();
    for (const [voter, target] of this.electionVotes) {
      if (this.player(voter)?.alive && this.player(target)?.alive) tally.set(target, (tally.get(target) || 0) + 1);
    }
    let winner = this.topOf(tally, true);
    if (!winner) winner = pick(this.rng, this.quorum().length ? this.quorum() : this.living())?.id ?? null;
    if (!winner) return;
    this.setCaptain(winner);
    this.narrate(T.elected(this.name(winner)));
  }

  startDebate() {
    this.skips.clear();
    this.dayVotes.clear();
    this.setPhase(PHASES.DEBATE, null, this.ms('debate'));
    this.narrate(T.debate(this.day));
  }

  startVote() {
    this.dayVotes.clear();
    this.setPhase(PHASES.VOTE, null, this.ms('vote'));
    this.narrate(T.vote());
  }

  captainAlive() {
    return !!(this.config.captain && this.captainId && this.player(this.captainId)?.alive);
  }

  voteWeight(id) { return this.captainAlive() && id === this.captainId ? 2 : 1; }

  startExecution() {
    this.lastDeaths = [];
    this.tie = null;
    const tally = new Map();
    for (const [voter, target] of this.dayVotes) {
      if (!target || !this.player(voter)?.alive || !this.player(target)?.alive) continue;
      tally.set(target, (tally.get(target) || 0) + this.voteWeight(voter));
    }
    if (tally.size === 0) {
      this.execStage = 'result';
      this.setPhase(PHASES.EXECUTION, null, this.ms('execution'));
      this.emit({ type: EVENTS.NO_LYNCH }, this.allIds());
      this.narrate(T.noVote());
      return;
    }
    const max = Math.max(...tally.values());
    const top = [...tally.keys()].filter((k) => tally.get(k) === max);
    if (top.length === 1) {
      this.execStage = 'result';
      this.setPhase(PHASES.EXECUTION, null, this.ms('execution'));
      this.execute(top[0]);
      return;
    }
    if (this.captainAlive()) {
      this.tie = top;
      this.execStage = 'tiebreak';
      this.setPhase(PHASES.EXECUTION, null, this.ms('captain_tiebreak'));
      this.narrate(T.tie(top.map((id) => this.name(id))));
      return;
    }
    this.execStage = 'result';
    this.setPhase(PHASES.EXECUTION, null, this.ms('execution'));
    this.emit({ type: EVENTS.NO_LYNCH }, this.allIds());
    this.narrate(T.noLynch());
  }

  execute(id) {
    const deaths = [];
    this.kill(id, DEATH_CAUSES.VOTE, deaths);
    this.lastDeaths.push(...deaths.map((d) => d.id));
    this.announceDeaths(deaths);
  }

  // ---------------------------------------------------------------- victory

  checkVictory() {
    const alive = this.living();
    const mixed = this.loversMixed();
    if (mixed && alive.length === 2 && this.lovers.every((id) => this.player(id)?.alive)) {
      return { winner: TEAMS.AMOUREUX, winners: [...this.lovers] };
    }
    const wolves = alive.filter((p) => p.role === ROLES.LOUP);
    const excluded = (p) => mixed && this.lovers.includes(p.id);
    if (wolves.length === 0) {
      return { winner: TEAMS.VILLAGE, winners: this.players.filter((p) => p.role !== ROLES.LOUP && !excluded(p)).map((p) => p.id) };
    }
    if (wolves.length === alive.length) {
      return { winner: TEAMS.LOUPS, winners: this.players.filter((p) => p.role === ROLES.LOUP && !excluded(p)).map((p) => p.id) };
    }
    return null;
  }

  gameOver(result) {
    this.stopPeek(this.now());
    this.result = result;
    this.pendingHunters = [];
    this.pendingSuccession = null;
    this.currentHunter = null;
    this.currentSuccession = null;
    this.tie = null;
    this.execStage = null;
    this.setPhase(PHASES.GAME_OVER, null, null);
    const roles = Object.fromEntries(this.players.map((p) => [p.id, p.role]));
    this.emit({ type: EVENTS.GAME_OVER, winner: result.winner, winners: result.winners, roles }, this.allIds());
    this.narrate(T.victory(result.winner, result.winners.map((id) => this.name(id))));
  }

  /** Effective objective of a player (amoureux for a mixed couple). */
  teamOf(p) {
    if (!p || !p.role) return null;
    if (this.loversMixed() && this.lovers.includes(p.id)) return TEAMS.AMOUREUX;
    return p.role === ROLES.LOUP ? TEAMS.LOUPS : TEAMS.VILLAGE;
  }

  // ---------------------------------------------------------------- actions

  /** Actions this member may perform right now (ACTIONS.*). */
  allowedActions(p) {
    if (!p || p.spectator || !this.isRunning()) return [];
    const n = this.night;
    switch (this.phase) {
      case PHASES.NIGHT: {
        if (!p.alive) return [];
        switch (this.step) {
          case NIGHT_STEPS.CUPIDON:
            return p.role === ROLES.CUPIDON && !n.linked ? [ACTIONS.CUPIDON_LINK] : [];
          case NIGHT_STEPS.VOYANTE:
            return p.role === ROLES.VOYANTE && !n.inspected ? [ACTIONS.VOYANTE_INSPECT] : [];
          case NIGHT_STEPS.LOUPS:
            if (p.role === ROLES.LOUP) return [ACTIONS.LOUP_VOTE];
            if (p.role === ROLES.PETITE_FILLE && n.peek.id === p.id && (n.peek.peeking || n.peek.leftMs > 0)) {
              return [ACTIONS.PEEK];
            }
            return [];
          case NIGHT_STEPS.SORCIERE: {
            if (p.role !== ROLES.SORCIERE || n.sorciereDone) return [];
            const list = [];
            if (this.canHeal()) list.push(ACTIONS.SORCIERE_HEAL);
            if (this.canPoison()) list.push(ACTIONS.SORCIERE_KILL);
            list.push(ACTIONS.SORCIERE_DONE);
            return list;
          }
          default: return [];
        }
      }
      case PHASES.HUNTER:
        return p.id === this.currentHunter && !this.hunterShot ? [ACTIONS.HUNTER_SHOOT] : [];
      case PHASES.CAPTAIN_SUCCESSION:
        return p.id === this.currentSuccession && !this.designated ? [ACTIONS.CAPTAIN_DESIGNATE] : [];
      case PHASES.ELECTION: return p.alive ? [ACTIONS.ELECTION_VOTE] : [];
      case PHASES.DEBATE: return p.alive && !this.skips.has(p.id) ? [ACTIONS.SKIP] : [];
      case PHASES.VOTE: return p.alive ? [ACTIONS.DAY_VOTE] : [];
      case PHASES.EXECUTION:
        return this.execStage === 'tiebreak' && p.alive && p.id === this.captainId ? [ACTIONS.CAPTAIN_TIEBREAK] : [];
      default: return [];
    }
  }

  /** Valid target ids for an action of `p` (empty for actions without target). */
  targetsFor(p, type) {
    const living = this.living();
    const others = living.filter((x) => x.id !== p.id);
    switch (type) {
      case ACTIONS.CUPIDON_LINK: return living.map((x) => x.id);
      case ACTIONS.VOYANTE_INSPECT: return others.map((x) => x.id);
      case ACTIONS.LOUP_VOTE: return living.filter((x) => x.role !== ROLES.LOUP).map((x) => x.id);
      case ACTIONS.SORCIERE_HEAL: return this.canHeal() ? [this.night.victim] : [];
      case ACTIONS.SORCIERE_KILL: return others.map((x) => x.id);
      case ACTIONS.HUNTER_SHOOT: return others.map((x) => x.id);
      case ACTIONS.ELECTION_VOTE: return living.map((x) => x.id);
      case ACTIONS.DAY_VOTE: return others.map((x) => x.id);
      case ACTIONS.CAPTAIN_DESIGNATE: return others.map((x) => x.id);
      case ACTIONS.CAPTAIN_TIEBREAK: return this.tie ? [...this.tie] : [];
      default: return [];
    }
  }

  /** Apply a player intention. Returns { ok } or { ok: false, error } (French). */
  act(playerId, action) {
    const p = this.player(playerId);
    if (!p) return fail('Vous ne participez pas à cette partie.');
    if (!action || typeof action !== 'object' || typeof action.type !== 'string') return fail('Action invalide.');
    const { type } = action;
    if (!this.allowedActions(p).includes(type)) return fail('Action impossible maintenant.');
    const targets = this.targetsFor(p, type);
    const target = typeof action.target === 'string' ? action.target : null;
    const needTarget = () => (target && targets.includes(target) ? null : fail('Cible invalide.'));
    const n = this.night;
    let err;

    switch (type) {
      case ACTIONS.CUPIDON_LINK: {
        const list = Array.isArray(action.targets) ? action.targets : null;
        if (!list || list.length !== 2) return fail('Choisissez deux joueurs.');
        const [a, b] = list;
        if (a === b || !targets.includes(a) || !targets.includes(b)) return fail('Choisissez deux joueurs vivants différents.');
        this.link(a, b, p.id);
        return ok();
      }
      case ACTIONS.VOYANTE_INSPECT: {
        if ((err = needTarget())) return err;
        const t = this.player(target);
        p.inspected[target] = t.role;
        n.inspected = true;
        this.emit({ type: EVENTS.INSPECT_RESULT, target, role: t.role }, [p.id]);
        this.narrate(T.inspect(t.name, t.role), [p.id]);
        this.touch();
        this.refreshEarlyEnd();
        return ok({ role: t.role });
      }
      case ACTIONS.LOUP_VOTE: {
        if (action.target === null || action.target === undefined) n.wolfVotes.delete(p.id);
        else if ((err = needTarget())) return err;
        else n.wolfVotes.set(p.id, target);
        const audience = [...this.livingWithRole(ROLES.LOUP).map((w) => w.id), ...this.observerIds()];
        this.emit({ type: EVENTS.VOTE_CAST, voterId: p.id, target: n.wolfVotes.get(p.id) ?? null, kind: 'loups', weight: 1 }, audience);
        this.touch();
        this.refreshEarlyEnd();
        return ok();
      }
      case ACTIONS.SORCIERE_HEAL: {
        n.healed = true;
        n.sorciereActed = true;
        this.potions.heal = false;
        this.narrate(T.witchHealed(this.name(n.victim)), [p.id]);
        this.touch();
        this.refreshEarlyEnd();
        return ok();
      }
      case ACTIONS.SORCIERE_KILL: {
        if ((err = needTarget())) return err;
        n.poisoned = target;
        n.sorciereActed = true;
        this.potions.kill = false;
        this.narrate(T.witchKilled(this.name(target)), [p.id]);
        this.touch();
        this.refreshEarlyEnd();
        return ok();
      }
      case ACTIONS.SORCIERE_DONE: {
        n.sorciereDone = true;
        this.touch();
        this.refreshEarlyEnd();
        return ok();
      }
      case ACTIONS.PEEK: {
        if (typeof action.active !== 'boolean') return fail('Action invalide.');
        if (action.active) {
          if (n.peek.leftMs <= 0) return fail('Vous ne pouvez plus épier cette nuit.');
          this.startPeek(this.now());
        } else {
          this.stopPeek(this.now());
        }
        return ok();
      }
      case ACTIONS.HUNTER_SHOOT: {
        if ((err = needTarget())) return err;
        this.hunterShot = true;
        const deaths = [];
        this.kill(target, DEATH_CAUSES.CHASSEUR, deaths);
        this.lastDeaths.push(...deaths.map((d) => d.id));
        this.announceDeaths(deaths, { hunterId: p.id });
        this.touch();
        this.refreshEarlyEnd();
        return ok();
      }
      case ACTIONS.ELECTION_VOTE: {
        if ((err = needTarget())) return err;
        this.electionVotes.set(p.id, target);
        this.emit({ type: EVENTS.VOTE_CAST, voterId: p.id, target, kind: 'election', weight: 1 }, this.allIds());
        this.touch();
        this.refreshEarlyEnd();
        return ok();
      }
      case ACTIONS.DAY_VOTE: {
        if (action.target === null || action.target === undefined) this.dayVotes.delete(p.id);
        else if ((err = needTarget())) return err;
        else this.dayVotes.set(p.id, target);
        this.emit({
          type: EVENTS.VOTE_CAST, voterId: p.id, target: this.dayVotes.get(p.id) ?? null, kind: 'day', weight: this.voteWeight(p.id),
        }, this.allIds());
        this.touch();
        this.refreshEarlyEnd();
        return ok();
      }
      case ACTIONS.CAPTAIN_DESIGNATE: {
        if ((err = needTarget())) return err;
        this.designated = true;
        this.setCaptain(target);
        this.narrate(T.newCaptain(this.name(target)));
        this.refreshEarlyEnd();
        return ok();
      }
      case ACTIONS.CAPTAIN_TIEBREAK: {
        if ((err = needTarget())) return err;
        this.execStage = 'result';
        this.tie = null;
        this.extendPhase(this.ms('execution'));
        this.execute(target);
        return ok();
      }
      case ACTIONS.SKIP: {
        this.skips.add(p.id);
        this.touch();
        this.refreshEarlyEnd();
        return ok();
      }
      default:
        return fail('Action inconnue.');
    }
  }

  // ---------------------------------------------------------------- presence

  /** Validate and store a presence update. Returns the presence as it must be relayed, or null. */
  updatePresence(id, raw) {
    const p = this.player(id);
    if (!p || !raw || typeof raw !== 'object') return null;
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    const target = typeof raw.target === 'string' && this.player(raw.target) ? raw.target : null;
    p.presence = {
      yaw: clamp(num(raw.yaw), -YAW_LIMIT, YAW_LIMIT),
      pitch: clamp(num(raw.pitch), PITCH_MIN, PITCH_MAX),
      eyes: EYES_VALUES.has(raw.eyes) ? raw.eyes : EYES.OPEN,
      gesture: GESTURE_VALUES.has(raw.gesture) ? raw.gesture : GESTURES.NONE,
      target,
    };
    p.presenceAt = this.now();
    if (this.phase === PHASES.NIGHT && this.step === NIGHT_STEPS.LOUPS && p.role === ROLES.LOUP) this.checkSpotted();
    return V.effectivePresence(this, p);
  }
}
