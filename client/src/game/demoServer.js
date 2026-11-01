// Offline demo (?demo=1): a local, simplified but complete game server with bots, exposing the same
// interface as SocketNet (on / emit / request) and the same protocol (personalised snapshots,
// events, presence relay rules). Options: ?role=petite_fille ?speed=2 ?players=10 ?autostart=1
// ?phase=loups (fast-forward to a phase or night step).
import {
  C2S, S2C, PHASES, NIGHT_STEPS, ACTIONS, EVENTS, CHANNELS, ROLES, TEAMS, DEATH_CAUSES, EYES, GESTURES,
  AVATARS, DEFAULT_TIMERS, MIN_PLAYERS, MAX_PLAYERS, PROTOCOL_VERSION,
} from '@shared/protocol.js';
import { ROLE_INFO, defaultComposition } from '@shared/roles.js';
import { gazeAngles } from './seatGeometry.js';
import { shuffle, pick } from '../util/math.js';

const BOT_NAMES = ['Tom', 'Léa', 'Mathis', 'Zoé', 'Hugo', 'Inès', 'Bastien', 'Chloé', 'Paul', 'Nina', 'Lucas', 'Emma', 'Jules', 'Manon', 'Louis', 'Camille'];
const LINES = {
  lobby: ['Salut tout le monde !', 'Bonne soirée à tous !', 'On est prêts ?', 'Qui a ramené les chamallows ?', 'Le feu est parfait ce soir.'],
  debate: [
    'Moi je trouve que {name} est bien silencieux…', "Cette nuit j'ai entendu du bruit du côté de {name}.",
    'Je suis simple villageois, je vous jure !', 'On devrait voter {name}, non ?', 'Attendez, réfléchissons avant de voter.',
    '{name}, tu étais où cette nuit ?', 'Je ne sens pas {name}.', 'Bon, qui est la voyante ?', 'Ça sent le loup par ici…',
    "C'est trop facile d'accuser {name}.", 'Moi je fais confiance à {name}.', 'Quelqu’un a une piste ?',
    '{name} a voté bizarrement hier.', 'Je garde un œil sur {name}.', 'Pas de panique, on va les trouver.',
  ],
  mourn: ['Pauvre {dead}…', '{dead} ne méritait pas ça.', 'Ils ont eu {dead} !', 'RIP {dead}.'],
  vote: ['Je vote {name}, désolé.', 'Allez, contre {name}.', 'Bon… {name}.', 'Mon vote : {name}.'],
  wolves: ['On mange {name} ?', '{name}, c’est sûrement la voyante.', "D'accord pour {name}.", 'Pas {name}, trop suspect demain.', 'Vite, le jour va se lever.'],
  dead: ['Bonne chance les vivants…', "Je l'avais dit !", 'Ils vont se faire avoir…', 'Le loup, c’est {name}, évidemment.'],
};
const PHASE_ALIASES = { night: 'fall', loups: 'loups', voyante: 'voyante', sorciere: 'sorciere', cupidon: 'cupidon', lovers: 'lovers' };

export class DemoNet {
  constructor(opts) {
    this.handlers = new Map();
    this.statusHandlers = new Set();
    this.status = 'connected';
    this.server = new DemoServer(this, opts);
  }
  get offline() { return true; }
  onStatus(fn) { this.statusHandlers.add(fn); }
  on(ev, fn) {
    if (!this.handlers.has(ev)) this.handlers.set(ev, new Set());
    this.handlers.get(ev).add(fn);
  }
  /** server -> client, asynchronous like a socket */
  deliver(ev, data) {
    const copy = JSON.parse(JSON.stringify(data));
    setTimeout(() => {
      const set = this.handlers.get(ev);
      if (set) for (const fn of set) fn(copy);
    }, 8);
  }
  emit(ev, payload = {}) { this.server.handle(ev, payload, null); }
  request(ev, payload = {}) {
    return new Promise((resolve) => {
      this.server.handle(ev, payload, (res) => setTimeout(() => resolve(res), 30));
    });
  }
  waitConnected() { return Promise.resolve(true); }
}

class DemoServer {
  constructor(net, { speed = 1, players = 10, role = null, phase = null } = {}) {
    this.net = net;
    this.speed = speed;
    this.targetPlayers = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, players));
    this.forcedRole = Object.values(ROLES).includes(role) ? role : null;
    this.fastForward = phase ? (PHASE_ALIASES[phase] || phase) : null;
    this.players = [];
    this.meId = null;
    this.code = 'DEMO';
    this.config = {
      roles: null,
      timers: { ...DEFAULT_TIMERS, debate: 70, election: 35, vote: 40, loups: 32, role_reveal: 10 },
      captain: true,
      speed: 1,
    };
    this.phase = PHASES.LOBBY;
    this.step = null;
    this.day = 0;
    this.phaseStartedAt = Date.now();
    this.phaseEndsAt = null;
    this.timer = null;
    this.votes = {};
    this.lastDeaths = [];
    this.result = null;
    this.captainId = null;
    this.night = null;
    this.pendingHunters = [];
    this.pendingSuccession = null;
    this.tie = null;
    this.botTimers = new Set();
    this.presence = new Map(); // id -> presence
    this.myPresence = { yaw: 0, pitch: 0, eyes: EYES.OPEN, gesture: null, target: null };
    this.peek = { active: false, left: 8, spottedAcc: 0, botPeekUntil: 0, botPeekAcc: 0 };
    this.lastSpeaker = null;
    this.tick = setInterval(() => this.update(0.25), 250);
  }

  // ------------------------------------------------------------------------------------------
  // helpers
  // ------------------------------------------------------------------------------------------
  get me() { return this.players.find((p) => p.id === this.meId); }
  p(id) { return this.players.find((x) => x.id === id); }
  alive() { return this.players.filter((p) => p.alive); }
  dur(key) {
    if (this.fastForward) return 350;
    const base = this.config.timers[key] ?? DEFAULT_TIMERS[key] ?? 10;
    // config.speed multiplies durations like the real server; the ?speed= URL option accelerates.
    return (base * 1000 * (this.config.speed || 1)) / this.speed;
  }
  later(ms, fn) {
    const t = setTimeout(() => {
      this.botTimers.delete(t);
      fn();
    }, this.fastForward ? Math.min(ms, 60) : ms / this.speed);
    this.botTimers.add(t);
  }
  clearBots() {
    for (const t of this.botTimers) clearTimeout(t);
    this.botTimers.clear();
  }
  send(ev, data) { this.net.deliver(ev, data); }
  event(type, payload = {}) { this.send(S2C.EVENT, { type, ...payload }); }
  chat(from, text, channel = CHANNELS.VILLAGE) {
    const p = from ? this.p(from) : null;
    if (!this.canReadChannel(channel)) return;
    this.send(S2C.CHAT, { id: Math.random().toString(36).slice(2), from, name: p ? p.name : 'Narrateur', text, channel, ts: Date.now() });
    if (p && p.isBot) {
      this.lastSpeaker = from;
      const pres = this.presence.get(from);
      if (pres) {
        pres.gesture = GESTURES.TALK;
        this.later(2600, () => { if (pres.gesture === GESTURES.TALK) pres.gesture = null; });
      }
    }
  }
  canReadChannel(ch) {
    const me = this.me;
    if (!me) return false;
    if (ch === CHANNELS.SYSTEM) return true;
    if (ch === CHANNELS.MORTS) return !me.alive;
    if (ch === CHANNELS.LOUPS) return me.role === ROLES.LOUP || !me.alive;
    return true;
  }
  fill(line, extra = {}) {
    const others = this.alive().filter((p) => p.id !== extra.self);
    const name = (extra.target && this.p(extra.target)?.name) || pick(others)?.name || 'quelqu’un';
    return line.replace('{name}', name).replace('{dead}', extra.dead || name);
  }

  // ------------------------------------------------------------------------------------------
  // client -> server
  // ------------------------------------------------------------------------------------------
  handle(ev, payload, ack) {
    const ok = (extra = {}) => ack && ack({ ok: true, ...extra });
    const fail = (error) => ack && ack({ ok: false, error });
    switch (ev) {
      case C2S.CREATE:
      case C2S.JOIN: {
        if (!this.meId) {
          this.meId = 'me';
          this.players.push(this.makePlayer('me', payload.name || 'Vous', payload.avatar || AVATARS[0], false));
          this.me.isHost = true;
          for (let i = 1; i < this.targetPlayers; i++) this.addBot();
        }
        ok({ code: this.code, playerId: this.meId, token: 'demo-token' });
        this.broadcast();
        this.later(1200, () => this.chat(this.players[1]?.id, pick(LINES.lobby)));
        this.later(2600, () => this.chat(this.players[2]?.id, pick(LINES.lobby)));
        return;
      }
      case C2S.LEAVE:
        return ok();
      case C2S.AVATAR:
        if (this.me) this.me.avatar = payload.avatar;
        this.broadcast();
        return ok();
      case C2S.CONFIG:
        if ('roles' in payload) this.config.roles = payload.roles ? { ...payload.roles } : null;
        if (payload.timers) Object.assign(this.config.timers, payload.timers);
        if (typeof payload.captain === 'boolean') this.config.captain = payload.captain;
        if (payload.speed) this.config.speed = payload.speed;
        this.broadcast();
        return ok();
      case C2S.ADD_BOT:
        if (this.players.length >= MAX_PLAYERS) return fail('La table est complète (16 places).');
        this.addBot();
        this.broadcast();
        return ok();
      case C2S.KICK:
        this.players = this.players.filter((p) => p.id !== payload.playerId || p.id === this.meId);
        this.broadcast();
        return ok();
      case C2S.START: {
        if (this.phase !== PHASES.LOBBY) return fail('La partie a déjà commencé.');
        if (this.players.length < MIN_PLAYERS) return fail(`Il faut au moins ${MIN_PLAYERS} joueurs.`);
        const err = this.startError();
        if (err) return fail(err);
        const comp = this.composition();
        ok();
        this.startGame(comp);
        return;
      }
      case C2S.RESTART:
        this.restart();
        return ok();
      case C2S.ACTION: {
        const err = this.action(this.meId, payload);
        if (err) return fail(err);
        this.broadcast();
        return ok();
      }
      case C2S.CHAT: {
        const text = String(payload.text || '').slice(0, 240).trim();
        if (!text) return ok();
        const ch = this.allowedChannel(this.me);
        if (!ch) return fail('Vous ne pouvez pas parler maintenant.');
        this.chat(this.meId, text, ch);
        if (ch === CHANNELS.VILLAGE && this.phase !== PHASES.LOBBY && Math.random() < 0.6) {
          const bot = pick(this.alive().filter((p) => p.isBot));
          if (bot) {
            this.later(2500 + Math.random() * 2500, () => {
              this.chat(bot.id, pick(['Hmm, pas sûr…', 'Tu dis ça pour te couvrir !', "C'est vrai, ça.", "Je suis d'accord.", 'Prouve-le !', 'Intéressant…']));
            });
          }
        }
        return ok();
      }
      case C2S.PRESENCE:
        this.myPresence = { ...this.myPresence, ...payload };
        return;
      default:
        return fail('Action inconnue (démo).');
    }
  }

  allowedChannel(p) {
    if (!p) return null;
    if (this.phase === PHASES.LOBBY || this.phase === PHASES.GAME_OVER) return CHANNELS.VILLAGE;
    if (!p.alive) return CHANNELS.MORTS;
    if (this.phase === PHASES.NIGHT) return this.step === NIGHT_STEPS.LOUPS && p.role === ROLES.LOUP ? CHANNELS.LOUPS : null;
    return CHANNELS.VILLAGE;
  }

  makePlayer(id, name, avatar, isBot) {
    const used = new Set(this.players.map((p) => p.seat));
    let seat = 0;
    // spread players around the circle
    const order = [0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15];
    for (const s of order) if (!used.has(s)) { seat = s; break; }
    return { id, name, avatar, seat, alive: true, connected: true, isBot, isHost: false, role: null, lover: null };
  }

  addBot() {
    const used = new Set(this.players.map((p) => p.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) || `Bot ${this.players.length}`;
    const usedAv = this.players.map((p) => p.avatar);
    const avatar = AVATARS.find((a) => !usedAv.includes(a)) || pick(AVATARS);
    const id = `bot${this.players.length}_${Math.random().toString(36).slice(2, 6)}`;
    const p = this.makePlayer(id, name, avatar, true);
    this.players.push(p);
    this.presence.set(id, { yaw: 0, pitch: -0.15, eyes: EYES.OPEN, gesture: null, target: null, next: 0, look: null });
  }

  // ------------------------------------------------------------------------------------------
  // game flow
  // ------------------------------------------------------------------------------------------
  startGame(comp) {
    const roles = [];
    for (const [r, n] of Object.entries(comp)) for (let i = 0; i < n; i++) roles.push(r);
    shuffle(roles);
    this.players.forEach((p, i) => {
      p.role = roles[i];
      p.alive = true;
      p.lover = null;
    });
    if (this.forcedRole && this.me.role !== this.forcedRole) {
      const other = this.players.find((p) => p.role === this.forcedRole);
      if (other) [other.role, this.me.role] = [this.me.role, other.role];
      else {
        const v = this.players.find((p) => p.id !== this.meId && p.role === ROLES.VILLAGEOIS);
        if (v) v.role = this.me.role;
        this.me.role = this.forcedRole;
      }
    }
    this.captainId = null;
    this.potions = { heal: true, kill: true };
    this.inspected = {};
    this.result = null;
    this.lastDeaths = [];
    this.day = 0;
    this.nightCount = 0;
    for (const p of this.players) p.deathCause = null;
    this.setPhase(PHASES.ROLE_REVEAL, null, this.dur('role_reveal'));
  }

  restart() {
    this.clearBots();
    clearTimeout(this.timer);
    for (const p of this.players) {
      p.alive = true;
      p.role = null;
      p.lover = null;
    }
    this.captainId = null;
    this.result = null;
    this.votes = {};
    this.lastDeaths = [];
    this.phase = PHASES.LOBBY;
    this.step = null;
    this.day = 0;
    this.phaseEndsAt = null;
    this.phaseStartedAt = Date.now();
    this.event(EVENTS.PHASE, { phase: this.phase, step: null, day: 0 });
    this.broadcast();
  }

  setPhase(phase, step, ms) {
    clearTimeout(this.timer);
    this.clearBots();
    this.phase = phase;
    this.step = step;
    this.phaseStartedAt = Date.now();
    this.phaseEndsAt = ms ? this.phaseStartedAt + ms : null;
    if (phase !== PHASES.EXECUTION) this.tie = null;
    if (this.fastForward && (phase === this.fastForward || step === this.fastForward)) {
      this.fastForward = null;
      this.phaseEndsAt = this.phaseStartedAt + this.durFor(phase, step);
      ms = this.phaseEndsAt - this.phaseStartedAt;
    }
    if (ms) this.timer = setTimeout(() => this.next(), ms);
    this.event(EVENTS.PHASE, { phase, step, day: this.day });
    this.onEnter();
    this.broadcast();
  }

  durFor(phase, step) {
    const key = phase === PHASES.NIGHT ? (step === NIGHT_STEPS.FALL ? 'night_fall' : step) : phase;
    return this.dur(key);
  }

  /** Shorten the current phase (actor done). */
  finishSoon(ms = 1800) {
    const end = Date.now() + (this.fastForward ? 50 : ms / this.speed);
    if (this.phaseEndsAt && end < this.phaseEndsAt) {
      clearTimeout(this.timer);
      this.phaseEndsAt = end;
      this.timer = setTimeout(() => this.next(), end - Date.now());
      this.broadcast();
    }
  }

  nightSteps() {
    const has = (r) => this.players.some((p) => p.alive && p.role === r);
    const steps = [NIGHT_STEPS.FALL];
    if (this.nightCount === 1 && has(ROLES.CUPIDON)) steps.push(NIGHT_STEPS.CUPIDON, NIGHT_STEPS.LOVERS);
    if (has(ROLES.VOYANTE)) steps.push(NIGHT_STEPS.VOYANTE);
    steps.push(NIGHT_STEPS.LOUPS);
    if (has(ROLES.SORCIERE) && (this.potions.heal || this.potions.kill)) steps.push(NIGHT_STEPS.SORCIERE);
    return steps;
  }

  startNight() {
    this.nightCount = (this.nightCount || 0) + 1;
    this.night = { wolfVotes: {}, victim: null, healed: false, poisoned: null, inspected: false, steps: this.nightSteps(), i: 0, cupidonDone: false };
    this.votes = {};
    this.peek.left = 8;
    this.peek.active = false;
    this.setPhase(PHASES.NIGHT, NIGHT_STEPS.FALL, this.dur('night_fall'));
  }

  next() {
    switch (this.phase) {
      case PHASES.ROLE_REVEAL:
        return this.startNight();
      case PHASES.NIGHT: {
        const n = this.night;
        if (this.step === NIGHT_STEPS.LOUPS) this.resolveWolves();
        if (this.step === NIGHT_STEPS.CUPIDON && !n.cupidonDone) this.botCupidon(true);
        n.i += 1;
        // sorcière step needs the victim: recompute the list (potions may be used up)
        if (n.i < n.steps.length) {
          const step = n.steps[n.i];
          return this.setPhase(PHASES.NIGHT, step, this.dur(step));
        }
        return this.dawn();
      }
      case PHASES.DAWN:
        return this.afterDeaths(() => (this.day === 1 && this.config.captain && !this.captainId
          ? this.setPhase(PHASES.ELECTION, null, this.dur('election'))
          : this.setPhase(PHASES.DEBATE, null, this.dur('debate'))));
      case PHASES.HUNTER: {
        const h = this.pendingHunters.shift();
        if (h && !h.shot) this.hunterShoot(h.id, this.botTarget(h.id));
        return this.afterDeaths(this.resume);
      }
      case PHASES.CAPTAIN_SUCCESSION:
        if (this.pendingSuccession) this.designate(this.pendingSuccession, this.botTarget(this.pendingSuccession));
        return this.afterDeaths(this.resume);
      case PHASES.ELECTION:
        this.resolveElection();
        return this.setPhase(PHASES.DEBATE, null, this.dur('debate'));
      case PHASES.DEBATE:
        return this.setPhase(PHASES.VOTE, null, this.dur('vote'));
      case PHASES.VOTE:
        return this.resolveVote();
      case PHASES.EXECUTION:
        if (this.tie && !this.tie.done) {
          this.tie.done = true;
          this.event(EVENTS.NO_LYNCH);
          this.chat(null, 'Égalité : personne n’est exécuté.', CHANNELS.SYSTEM);
        }
        return this.afterDeaths(() => this.startNight());
      default:
    }
  }

  /** After a batch of deaths: hunter shots, captain succession, win check, then continue. */
  afterDeaths(cont) {
    if (this.checkWin()) return;
    const hunter = this.pendingHunters.find((h) => !h.shot);
    if (hunter) {
      this.resume = cont;
      return this.setPhase(PHASES.HUNTER, null, this.dur('hunter'));
    }
    if (this.pendingSuccession) {
      this.resume = cont;
      return this.setPhase(PHASES.CAPTAIN_SUCCESSION, null, this.dur('captain_succession'));
    }
    return cont.call(this);
  }

  checkWin() {
    const alive = this.alive();
    const wolves = alive.filter((p) => p.role === ROLES.LOUP);
    const others = alive.filter((p) => p.role !== ROLES.LOUP);
    let winner = null;
    let winners = [];
    if (alive.length === 2 && alive[0].lover === alive[1].id && (wolves.length === 1)) {
      winner = TEAMS.AMOUREUX;
      winners = alive.map((p) => p.id);
    } else if (wolves.length === 0) {
      winner = TEAMS.VILLAGE;
      winners = this.players.filter((p) => p.role !== ROLES.LOUP).map((p) => p.id);
    } else if (others.length === 0) {
      winner = TEAMS.LOUPS;
      winners = this.players.filter((p) => p.role === ROLES.LOUP).map((p) => p.id);
    }
    if (!winner) return false;
    this.result = { winner, winners };
    clearTimeout(this.timer);
    this.clearBots();
    this.phase = PHASES.GAME_OVER;
    this.step = null;
    this.phaseStartedAt = Date.now();
    this.phaseEndsAt = null;
    this.event(EVENTS.PHASE, { phase: this.phase, step: null, day: this.day });
    this.event(EVENTS.GAME_OVER, { winner, winners, roles: Object.fromEntries(this.players.map((p) => [p.id, p.role])) });
    this.broadcast();
    return true;
  }

  kill(id, cause, deaths) {
    const p = this.p(id);
    if (!p || !p.alive) return;
    p.alive = false;
    p.deathCause = cause;
    deaths.push({ playerId: id, cause, role: p.role });
    if (p.role === ROLES.CHASSEUR) this.pendingHunters.push({ id, shot: false });
    if (this.captainId === id) this.pendingSuccession = id;
    if (p.lover) this.kill(p.lover, DEATH_CAUSES.CHAGRIN, deaths);
  }

  announce(deaths) {
    this.lastDeaths = deaths.map((d) => d.playerId);
    deaths.forEach((d, i) => {
      setTimeout(() => {
        this.event(EVENTS.DEATH, { ...d, cause: this.causeFor(d.cause) });
        this.broadcast();
      }, this.fastForward ? 0 : 900 + i * 1600);
    });
  }

  dawn() {
    this.day += 1;
    const n = this.night;
    const deaths = [];
    if (n.victim && !n.healed) this.kill(n.victim, DEATH_CAUSES.LOUPS, deaths);
    if (n.poisoned) this.kill(n.poisoned, DEATH_CAUSES.SORCIERE, deaths);
    this.setPhase(PHASES.DAWN, null, this.dur('dawn') + deaths.length * 1200);
    if (deaths.length) this.announce(deaths);
    else {
      this.lastDeaths = [];
      this.later(900, () => this.event(EVENTS.NO_DEATH));
    }
  }

  resolveWolves() {
    const n = this.night;
    const counts = {};
    for (const t of Object.values(n.wolfVotes)) if (t) counts[t] = (counts[t] || 0) + 1;
    let best = null;
    let max = 0;
    for (const [t, c] of Object.entries(counts)) {
      if (c > max || (c === max && Math.random() < 0.5)) {
        best = t;
        max = c;
      }
    }
    if (!best) {
      const prey = this.alive().filter((p) => p.role !== ROLES.LOUP);
      best = pick(prey)?.id || null;
    }
    n.victim = best;
  }

  resolveElection() {
    const counts = {};
    for (const t of Object.values(this.votes)) if (t) counts[t] = (counts[t] || 0) + 1;
    const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const id = ranked.length ? ranked[0][0] : pick(this.alive()).id;
    this.captainId = id;
    this.event(EVENTS.CAPTAIN, { playerId: id });
    this.chat(null, `${this.p(id).name} est élu Capitaine.`, CHANNELS.SYSTEM);
    this.votes = {};
  }

  resolveVote() {
    const counts = {};
    for (const [voter, t] of Object.entries(this.votes)) {
      if (!t) continue;
      counts[t] = (counts[t] || 0) + (voter === this.captainId ? 2 : 1);
    }
    const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    this.setPhase(PHASES.EXECUTION, null, this.dur('execution'));
    if (!ranked.length) {
      this.event(EVENTS.NO_LYNCH);
      return;
    }
    const top = ranked.filter(([, c]) => c === ranked[0][1]).map(([t]) => t);
    if (top.length > 1) {
      if (this.captainId && this.p(this.captainId)?.alive) {
        this.tie = { candidates: top, done: false };
        this.phaseEndsAt = Date.now() + this.dur('execution') + (this.captainId === this.meId ? 6000 / this.speed : 0);
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.next(), this.phaseEndsAt - Date.now());
        if (this.captainId !== this.meId) this.later(2200, () => this.tiebreak(this.captainId, pick(top)));
        this.broadcast();
        return;
      }
      this.event(EVENTS.NO_LYNCH);
      return;
    }
    this.execute(top[0]);
  }

  execute(id) {
    const deaths = [];
    this.kill(id, DEATH_CAUSES.VOTE, deaths);
    this.announce(deaths);
  }

  tiebreak(captain, target) {
    if (!this.tie || this.tie.done) return 'Pas d’égalité à départager.';
    if (!this.tie.candidates.includes(target)) return 'Choisissez parmi les ex æquo.';
    this.tie.done = true;
    this.execute(target);
    this.broadcast();
    return null;
  }

  hunterShoot(hunterId, target) {
    const h = this.pendingHunters.find((x) => x.id === hunterId && !x.shot);
    if (!h) return 'Vous ne pouvez pas tirer.';
    const t = this.p(target);
    if (!t || !t.alive) return 'Cible invalide.';
    h.shot = true;
    const deaths = [];
    this.kill(target, DEATH_CAUSES.CHASSEUR, deaths);
    this.announce(deaths);
    this.pendingHunters = this.pendingHunters.filter((x) => !x.shot);
    this.finishSoon(2400 + deaths.length * 1500);
    return null;
  }

  designate(from, target) {
    if (this.pendingSuccession !== from) return 'Vous ne pouvez pas désigner de successeur.';
    const t = this.p(target);
    if (!t || !t.alive) return 'Cible invalide.';
    this.captainId = target;
    this.pendingSuccession = null;
    this.event(EVENTS.CAPTAIN, { playerId: target });
    this.finishSoon(1500);
    return null;
  }

  // ------------------------------------------------------------------------------------------
  // actions
  // ------------------------------------------------------------------------------------------
  composition() {
    const n = this.players.length;
    if (!this.config.roles) return defaultComposition(n);
    const comp = { ...this.config.roles };
    delete comp[ROLES.VILLAGEOIS];
    const specials = Object.values(comp).reduce((a, b) => a + b, 0);
    comp[ROLES.VILLAGEOIS] = Math.max(0, n - specials);
    return comp;
  }

  startError() {
    const n = this.players.length;
    if (n < MIN_PLAYERS) return `Il faut au moins ${MIN_PLAYERS} joueurs (bots compris).`;
    const comp = this.composition();
    const total = Object.values(comp).reduce((a, b) => a + b, 0);
    if (total !== n) return `La composition compte ${total} cartes pour ${n} joueurs.`;
    if (!comp[ROLES.LOUP]) return 'Il faut au moins un Loup-Garou.';
    if (comp[ROLES.LOUP] * 2 >= n) return 'Trop de Loups-Garous pour ce nombre de joueurs.';
    return null;
  }

  /** Night death causes are hidden from the village (v2: 'nuit'). */
  causeFor(cause) {
    const me = this.me;
    if (cause !== DEATH_CAUSES.LOUPS && cause !== DEATH_CAUSES.SORCIERE) return cause;
    if (!me || !me.alive || me.role === ROLES.LOUP || me.role === ROLES.SORCIERE || this.phase === PHASES.GAME_OVER) return cause;
    return DEATH_CAUSES.NIGHT || 'nuit';
  }

  targetsFor(p, action) {
    const alive = this.alive();
    const others = alive.filter((x) => x.id !== p.id);
    switch (action) {
      case ACTIONS.CUPIDON_LINK: return alive.map((x) => x.id);
      case ACTIONS.VOYANTE_INSPECT: return others.filter((x) => !this.inspected[x.id]).map((x) => x.id);
      case ACTIONS.LOUP_VOTE: return others.filter((x) => x.role !== ROLES.LOUP).map((x) => x.id);
      case ACTIONS.ELECTION_VOTE: return alive.map((x) => x.id);
      case ACTIONS.CAPTAIN_TIEBREAK: return this.tie ? [...this.tie.candidates] : [];
      case ACTIONS.SORCIERE_KILL:
      case ACTIONS.HUNTER_SHOOT:
      case ACTIONS.CAPTAIN_DESIGNATE:
      case ACTIONS.DAY_VOTE: return others.map((x) => x.id);
      default: return [];
    }
  }

  actionsFor(p) {
    const A = [];
    if (!p) return A;
    const n = this.night;
    if (this.phase === PHASES.NIGHT && p.alive) {
      if (this.step === NIGHT_STEPS.CUPIDON && p.role === ROLES.CUPIDON && !n.cupidonDone) A.push(ACTIONS.CUPIDON_LINK);
      if (this.step === NIGHT_STEPS.VOYANTE && p.role === ROLES.VOYANTE && !n.inspected) A.push(ACTIONS.VOYANTE_INSPECT);
      if (this.step === NIGHT_STEPS.LOUPS && p.role === ROLES.LOUP) A.push(ACTIONS.LOUP_VOTE);
      if (this.step === NIGHT_STEPS.LOUPS && p.role === ROLES.PETITE_FILLE && this.peek.left > 0) A.push(ACTIONS.PEEK);
      if (this.step === NIGHT_STEPS.SORCIERE && p.role === ROLES.SORCIERE && !n.sorcDone) {
        if (this.potions.heal && n.victim && !n.healed) A.push(ACTIONS.SORCIERE_HEAL);
        if (this.potions.kill && !n.poisoned) A.push(ACTIONS.SORCIERE_KILL);
        A.push(ACTIONS.SORCIERE_DONE);
      }
    }
    if (this.phase === PHASES.HUNTER && this.pendingHunters.some((h) => h.id === p.id && !h.shot)) A.push(ACTIONS.HUNTER_SHOOT);
    if (this.phase === PHASES.CAPTAIN_SUCCESSION && this.pendingSuccession === p.id) A.push(ACTIONS.CAPTAIN_DESIGNATE);
    if (p.alive) {
      if (this.phase === PHASES.ELECTION) A.push(ACTIONS.ELECTION_VOTE);
      if (this.phase === PHASES.DEBATE) A.push(ACTIONS.SKIP);
      if (this.phase === PHASES.VOTE) A.push(ACTIONS.DAY_VOTE);
      if (this.phase === PHASES.EXECUTION && this.tie && !this.tie.done && this.captainId === p.id) A.push(ACTIONS.CAPTAIN_TIEBREAK);
    }
    return A;
  }

  action(id, { type, target, targets, active }) {
    const p = this.p(id);
    if (!this.actionsFor(p).includes(type)) return 'Action impossible maintenant.';
    const n = this.night;
    const living = (t) => this.p(t)?.alive;
    switch (type) {
      case ACTIONS.CUPIDON_LINK: {
        if (!Array.isArray(targets) || targets.length !== 2 || targets[0] === targets[1]) return 'Choisissez deux joueurs.';
        if (!targets.every(living)) return 'Cible invalide.';
        const [a, b] = targets.map((t) => this.p(t));
        a.lover = b.id;
        b.lover = a.id;
        n.cupidonDone = true;
        this.sendLovers();
        this.finishSoon();
        return null;
      }
      case ACTIONS.VOYANTE_INSPECT: {
        if (!living(target) || target === id) return 'Cible invalide.';
        n.inspected = true;
        this.inspected[target] = this.p(target).role;
        if (id === this.meId) this.event(EVENTS.INSPECT_RESULT, { target, role: this.p(target).role });
        this.finishSoon(4500);
        return null;
      }
      case ACTIONS.LOUP_VOTE: {
        if (!living(target) || this.p(target).role === ROLES.LOUP) return 'Les loups ne peuvent pas se dévorer entre eux.';
        n.wolfVotes[id] = target;
        this.votes = { ...n.wolfVotes };
        this.event(EVENTS.VOTE_CAST, { voterId: id, target, kind: 'loups', weight: 1 });
        // bots follow a human wolf
        if (id === this.meId) {
          for (const w of this.alive().filter((x) => x.role === ROLES.LOUP && x.isBot)) {
            this.later(900 + Math.random() * 2500, () => {
              if (this.step !== NIGHT_STEPS.LOUPS) return;
              n.wolfVotes[w.id] = Math.random() < 0.8 ? target : n.wolfVotes[w.id];
              this.votes = { ...n.wolfVotes };
              this.event(EVENTS.VOTE_CAST, { voterId: w.id, target: n.wolfVotes[w.id] });
              this.chat(w.id, Math.random() < 0.5 ? `D'accord pour ${this.p(target).name}.` : 'Ok.', CHANNELS.LOUPS);
              this.broadcast();
              this.checkWolvesAgree();
            });
          }
        }
        this.checkWolvesAgree();
        return null;
      }
      case ACTIONS.PEEK:
        this.peek.active = !!active && this.peek.left > 0;
        this.myPresence.eyes = this.peek.active ? EYES.PEEK : EYES.CLOSED;
        return null;
      case ACTIONS.SORCIERE_HEAL:
        this.potions.heal = false;
        n.healed = true;
        return null;
      case ACTIONS.SORCIERE_KILL:
        if (!living(target) || target === id) return 'Cible invalide.';
        this.potions.kill = false;
        n.poisoned = target;
        return null;
      case ACTIONS.SORCIERE_DONE:
        n.sorcDone = true;
        this.finishSoon(1200);
        return null;
      case ACTIONS.HUNTER_SHOOT:
        return this.hunterShoot(id, target);
      case ACTIONS.CAPTAIN_DESIGNATE:
        return this.designate(id, target);
      case ACTIONS.CAPTAIN_TIEBREAK:
        return this.tiebreak(id, target);
      case ACTIONS.ELECTION_VOTE:
        if (!living(target)) return 'Cible invalide.';
        this.votes[id] = target;
        this.event(EVENTS.VOTE_CAST, { voterId: id, target, kind: 'election', weight: 1 });
        return null;
      case ACTIONS.DAY_VOTE:
        if (target != null && (!living(target) || target === id)) return 'Cible invalide.';
        this.votes[id] = target ?? null;
        this.event(EVENTS.VOTE_CAST, { voterId: id, target: target ?? null, kind: 'day', weight: id === this.captainId ? 2 : 1 });
        return null;
      case ACTIONS.SKIP: {
        if (p.skip) return null;
        if (this.alive().filter((x) => x.skip).length > this.alive().length / 2) return null;
        p.skip = true;
        const alive = this.alive();
        const skips = alive.filter((x) => x.skip).length;
        this.chat(null, `${p.name} veut passer au vote (${skips}/${Math.floor(alive.length / 2) + 1}).`, CHANNELS.SYSTEM);
        if (skips > alive.length / 2) this.finishSoon(1500);
        return null;
      }
      default:
        return 'Action inconnue.';
    }
  }

  checkWolvesAgree() {
    const wolves = this.alive().filter((p) => p.role === ROLES.LOUP);
    const votes = wolves.map((w) => this.night.wolfVotes[w.id]);
    if (votes.every((v) => v && v === votes[0])) this.finishSoon(3000);
  }

  sendLovers() {
    const lovers = this.players.filter((p) => p.lover);
    const me = this.me;
    if (me.lover || me.role === ROLES.CUPIDON) this.event(EVENTS.LOVERS, { ids: lovers.map((p) => p.id) });
  }

  botTarget(selfId, filter = () => true) {
    const choices = this.alive().filter((p) => p.id !== selfId && filter(p));
    return pick(choices)?.id || null;
  }

  botCupidon(force) {
    const cup = this.players.find((p) => p.role === ROLES.CUPIDON && p.alive);
    if (!cup || (!cup.isBot && !force)) return;
    const alive = shuffle(this.alive().slice());
    if (Math.random() < 0.4 && cup.isBot) {
      const meIdx = alive.findIndex((p) => p.id === this.meId);
      if (meIdx > 1) [alive[0], alive[meIdx]] = [alive[meIdx], alive[0]];
    }
    alive[0].lover = alive[1].id;
    alive[1].lover = alive[0].id;
    this.night.cupidonDone = true;
    this.sendLovers();
  }

  // ------------------------------------------------------------------------------------------
  // per phase bot behaviour
  // ------------------------------------------------------------------------------------------
  onEnter() {
    const bots = () => this.alive().filter((p) => p.isBot);
    const n = this.night;
    for (const p of this.players) p.skip = false;
    if (this.phase === PHASES.NIGHT) {
      const actor = (role) => this.players.find((p) => p.role === role && p.alive);
      switch (this.step) {
        case NIGHT_STEPS.CUPIDON: {
          const c = actor(ROLES.CUPIDON);
          if (c?.isBot) this.later(2500 + Math.random() * 3000, () => { this.botCupidon(); this.finishSoon(); });
          break;
        }
        case NIGHT_STEPS.LOVERS:
          if (!this.players.some((p) => p.lover)) this.finishSoon(500);
          else this.sendLovers();
          break;
        case NIGHT_STEPS.VOYANTE: {
          const v = actor(ROLES.VOYANTE);
          if (v?.isBot) {
            this.later(3000 + Math.random() * 3000, () => {
              const t = this.botTarget(v.id, (p) => !this.inspected[p.id]);
              if (t) this.action(v.id, { type: ACTIONS.VOYANTE_INSPECT, target: t });
            });
          }
          break;
        }
        case NIGHT_STEPS.LOUPS: {
          const wolves = this.alive().filter((p) => p.role === ROLES.LOUP);
          const humanWolf = wolves.some((w) => !w.isBot);
          const prey = this.botTarget(null, (p) => p.role !== ROLES.LOUP);
          for (const w of wolves.filter((x) => x.isBot)) {
            this.later(humanWolf ? 9000 + Math.random() * 8000 : 3000 + Math.random() * 4000, () => {
              if (this.step !== NIGHT_STEPS.LOUPS || n.wolfVotes[w.id]) return;
              const t = humanWolf ? (Object.values(n.wolfVotes)[0] || prey) : prey;
              n.wolfVotes[w.id] = t;
              this.votes = { ...n.wolfVotes };
              this.event(EVENTS.VOTE_CAST, { voterId: w.id, target: t });
              if (humanWolf) this.chat(w.id, this.fill(pick(LINES.wolves), { target: t }), CHANNELS.LOUPS);
              this.broadcast();
              this.checkWolvesAgree();
            });
          }
          if (humanWolf) this.later(4000, () => this.chat(wolves.find((x) => x.isBot)?.id, this.fill(pick(LINES.wolves), { target: prey }), CHANNELS.LOUPS));
          // a bot petite fille peeks for a while
          const pf = actor(ROLES.PETITE_FILLE);
          if (pf?.isBot) {
            this.later(4000 + Math.random() * 6000, () => {
              this.peek.botPeekUntil = Date.now() + 4500;
              this.peek.botPeekAcc = 0;
            });
          }
          // wolves howl
          break;
        }
        case NIGHT_STEPS.SORCIERE: {
          const s = actor(ROLES.SORCIERE);
          if (s && !s.isBot && n.victim !== undefined) this.event(EVENTS.WOLF_VICTIM, { target: n.healed ? null : n.victim });
          if (s?.isBot) {
            this.later(3000 + Math.random() * 3000, () => {
              if (this.potions.heal && n.victim && Math.random() < 0.5) this.action(s.id, { type: ACTIONS.SORCIERE_HEAL });
              if (this.potions.kill && Math.random() < 0.2) this.action(s.id, { type: ACTIONS.SORCIERE_KILL, target: this.botTarget(s.id) });
              this.action(s.id, { type: ACTIONS.SORCIERE_DONE });
            });
          }
          break;
        }
        default:
      }
    }
    if (this.phase === PHASES.DAWN) {
      // bots mourn, nod...
      this.later(5000, () => {
        const d = this.lastDeaths[0];
        if (d) this.chat(pick(bots())?.id, this.fill(pick(LINES.mourn), { dead: this.p(d)?.name }));
      });
    }
    if (this.phase === PHASES.HUNTER) {
      const h = this.pendingHunters.find((x) => !x.shot);
      if (h && this.p(h.id)?.isBot) this.later(3500, () => this.hunterShoot(h.id, this.botTarget(h.id)));
    }
    if (this.phase === PHASES.CAPTAIN_SUCCESSION && this.p(this.pendingSuccession)?.isBot) {
      this.later(3000, () => this.designate(this.pendingSuccession, this.botTarget(this.pendingSuccession)));
    }
    if (this.phase === PHASES.ELECTION) {
      const favs = shuffle(this.alive().slice()).slice(0, 2).map((p) => p.id);
      for (const b of bots()) {
        this.later(2500 + Math.random() * (this.phaseEndsAt - Date.now()) * this.speed * 0.6, () => {
          const t = Math.random() < 0.75 ? pick(favs) : this.botTarget(b.id);
          this.action(b.id, { type: ACTIONS.ELECTION_VOTE, target: t });
          this.setGaze(b.id, t, GESTURES.RAISE);
          this.broadcast();
        });
      }
    }
    if (this.phase === PHASES.DEBATE) {
      const span = (this.phaseEndsAt - Date.now()) * this.speed;
      const count = Math.max(4, Math.round(span / 6000));
      for (let i = 0; i < count; i++) {
        this.later(1500 + (i / count) * span * 0.9 + Math.random() * 2000, () => {
          const b = pick(bots());
          if (b) this.chat(b.id, this.fill(pick(LINES.debate), { self: b.id }));
          const r = pick(bots());
          if (r && Math.random() < 0.5) {
            const pr = this.presence.get(r.id);
            if (pr) {
              pr.gesture = Math.random() < 0.5 ? GESTURES.NOD : GESTURES.SHAKE;
              this.later(1500, () => { if (pr.gesture === GESTURES.NOD || pr.gesture === GESTURES.SHAKE) pr.gesture = null; });
            }
          }
        });
      }
      for (const b of bots()) {
        this.later(span * (0.5 + Math.random() * 0.45), () => this.action(b.id, { type: ACTIONS.SKIP }));
      }
    }
    if (this.phase === PHASES.VOTE) {
      const span = (this.phaseEndsAt - Date.now()) * this.speed;
      const suspects = shuffle(this.alive().slice()).slice(0, 3);
      for (const b of bots()) {
        this.later(2000 + Math.random() * span * 0.75, () => {
          const options = suspects.filter((s) => s.id !== b.id && (b.role !== ROLES.LOUP || s.role !== ROLES.LOUP));
          const t = (pick(options) || this.p(this.botTarget(b.id)))?.id;
          if (!t) return;
          this.action(b.id, { type: ACTIONS.DAY_VOTE, target: t });
          this.setGaze(b.id, t, GESTURES.POINT);
          if (Math.random() < 0.3) this.chat(b.id, this.fill(pick(LINES.vote), { target: t }));
          this.broadcast();
        });
      }
    }
    if (this.phase === PHASES.GAME_OVER) this.clearBots();
  }

  setGaze(botId, target, gesture) {
    const pr = this.presence.get(botId);
    if (!pr) return;
    pr.look = target;
    pr.target = target;
    pr.gesture = gesture;
    pr.next = Date.now() + 999999;
  }

  // ------------------------------------------------------------------------------------------
  // tick: bot presence, petite fille
  // ------------------------------------------------------------------------------------------
  isAwake(p) {
    if (this.phase !== PHASES.NIGHT) return true;
    if (!p.alive) return true;
    switch (this.step) {
      case NIGHT_STEPS.CUPIDON: return p.role === ROLES.CUPIDON;
      case NIGHT_STEPS.LOVERS: return !!p.lover;
      case NIGHT_STEPS.VOYANTE: return p.role === ROLES.VOYANTE;
      case NIGHT_STEPS.LOUPS: return p.role === ROLES.LOUP;
      case NIGHT_STEPS.SORCIERE: return p.role === ROLES.SORCIERE;
      default: return false;
    }
  }
  /** May the receiver (me) see p's real state right now? */
  canSee(me, p) {
    if (p.id === me.id) return true;
    if (this.phase !== PHASES.NIGHT) return true;
    if (!me.alive) return true;
    if (!this.isAwake(me) && !(me.role === ROLES.PETITE_FILLE && this.peek.active)) return false;
    if (this.step === NIGHT_STEPS.LOUPS) {
      if (me.role === ROLES.LOUP) return p.role === ROLES.LOUP || (p.role === ROLES.PETITE_FILLE && this.botPeeking());
      if (me.role === ROLES.PETITE_FILLE) return p.role === ROLES.LOUP;
    }
    if (this.step === NIGHT_STEPS.LOVERS) return !!(me.lover && p.lover);
    return false;
  }
  botPeeking() { return Date.now() < this.peek.botPeekUntil; }

  update(dt) {
    if (!this.meId) return;
    const now = Date.now();
    const me = this.me;
    // petite fille (human) peeking
    if (this.phase === PHASES.NIGHT && this.step === NIGHT_STEPS.LOUPS && me.role === ROLES.PETITE_FILLE) {
      if (this.peek.active) {
        this.peek.left = Math.max(0, this.peek.left - dt);
        if (this.peek.left <= 0) this.peek.active = false;
        const watched = this.alive().some((w) => w.role === ROLES.LOUP && this.presence.get(w.id)?.look === me.id);
        this.peek.spottedAcc = watched ? this.peek.spottedAcc + dt : 0;
        if (this.peek.spottedAcc > 3) {
          this.peek.spottedAcc = -6;
          this.event(EVENTS.PEEK_SPOTTED, { playerId: me.id });
        }
        if (Math.random() < 0.06) {
          const w = pick(this.alive().filter((x) => x.role === ROLES.LOUP));
          if (w) this.presence.get(w.id).look = Math.random() < 0.5 ? me.id : null;
        }
      }
      this.broadcastSoon();
    }
    // human wolf catching a bot petite fille
    if (this.phase === PHASES.NIGHT && this.step === NIGHT_STEPS.LOUPS && me.role === ROLES.LOUP && this.botPeeking()) {
      const pf = this.players.find((p) => p.role === ROLES.PETITE_FILLE && p.alive);
      if (pf) {
        const g = gazeAngles(me.seat, pf.seat);
        const looking = Math.abs(g.yaw - (this.myPresence.yaw || 0)) < 0.3;
        this.peek.botPeekAcc = looking ? this.peek.botPeekAcc + dt : 0;
        if (this.peek.botPeekAcc > 2) {
          this.peek.botPeekAcc = -99;
          this.peek.botPeekUntil = 0;
          this.event(EVENTS.PEEK_SPOTTED, { playerId: pf.id });
        }
      }
    }
    // bot presence
    for (const p of this.players) {
      if (!p.isBot) continue;
      const pr = this.presence.get(p.id);
      if (!pr) continue;
      const awake = this.isAwake(p);
      if (now > pr.next) {
        pr.next = now + 2000 + Math.random() * 4000;
        if (this.phase === PHASES.NIGHT && awake) {
          const mates = this.alive().filter((x) => x.id !== p.id && (p.role === ROLES.LOUP ? x.role === ROLES.LOUP || Math.random() < 0.3 : true));
          pr.look = Math.random() < 0.3 ? null : pick(mates)?.id ?? null;
        } else if (this.lastSpeaker && this.lastSpeaker !== p.id && Math.random() < 0.6) {
          pr.look = this.lastSpeaker;
        } else {
          pr.look = Math.random() < 0.35 ? null : this.botTarget(p.id);
        }
        if (pr.gesture === GESTURES.POINT || pr.gesture === GESTURES.RAISE) {
          if (this.phase !== PHASES.VOTE && this.phase !== PHASES.ELECTION) pr.gesture = null;
        }
      }
      const target = pr.look ? this.p(pr.look) : null;
      const g = gazeAngles(p.seat, target ? target.seat : null);
      pr.yaw = g.yaw + Math.sin(now * 0.0007 + p.seat) * 0.05;
      pr.pitch = g.pitch + Math.sin(now * 0.0011 + p.seat * 2) * 0.03;
      let eyes = awake ? EYES.OPEN : EYES.CLOSED;
      if (p.role === ROLES.PETITE_FILLE && this.botPeeking() && this.step === NIGHT_STEPS.LOUPS) eyes = EYES.PEEK;
      pr.eyes = eyes;
      if (this.canSee(me, p) || (eyes === EYES.PEEK && me.role === ROLES.LOUP)) {
        this.send(S2C.PRESENCE, { id: p.id, yaw: pr.yaw, pitch: pr.pitch, eyes: pr.eyes, gesture: pr.gesture, target: pr.target || pr.look || null });
      }
    }
  }

  broadcastSoon() {
    if (this.pendingBroadcast) return;
    this.pendingBroadcast = setTimeout(() => {
      this.pendingBroadcast = null;
      this.broadcast();
    }, 500);
  }

  // ------------------------------------------------------------------------------------------
  // personalised snapshot
  // ------------------------------------------------------------------------------------------
  broadcast() {
    const me = this.me;
    if (!me) return;
    const night = this.phase === PHASES.NIGHT;
    const over = this.phase === PHASES.GAME_OVER;
    const knowsLovers = me.lover || me.role === ROLES.CUPIDON || !me.alive;
    const players = this.players.map((p) => {
      const known = p.id === me.id || !p.alive || over || (me.role === ROLES.LOUP && p.role === ROLES.LOUP) || !me.alive;
      const view = {
        id: p.id, name: p.name, avatar: p.avatar, seat: p.seat, alive: p.alive, connected: p.connected,
        isBot: p.isBot, isHost: !!p.isHost, isCaptain: this.captainId === p.id, role: known ? p.role : null,
        deathCause: p.alive ? null : this.causeFor(p.deathCause),
      };
      if (knowsLovers && p.lover) view.isLover = true;
      if (night && this.canSee(me, p)) view.awake = this.isAwake(p) || (p.role === ROLES.PETITE_FILLE && this.botPeeking() && me.role === ROLES.LOUP);
      return view;
    });
    let votes = {};
    if (this.phase === PHASES.VOTE || this.phase === PHASES.ELECTION || this.phase === PHASES.EXECUTION) votes = { ...this.votes };
    if (night && this.step === NIGHT_STEPS.LOUPS && (me.role === ROLES.LOUP || !me.alive)) votes = { ...this.night.wolfVotes };
    const n = this.night;
    const awake = !me.alive || this.phase !== PHASES.NIGHT || this.isAwake(me);
    const snap = {
      v: PROTOCOL_VERSION,
      room: {
        code: this.code, hostId: this.meId,
        config: { ...this.config, roles: this.composition(), rolesAuto: !this.config.roles },
        canStart: this.phase === PHASES.LOBBY && !this.startError(),
        startError: this.phase === PHASES.LOBBY ? this.startError() : null,
      },
      spectators: [],
      serverNow: Date.now(),
      phase: this.phase,
      step: this.step,
      day: this.day,
      phaseStartedAt: this.phaseStartedAt,
      phaseEndsAt: this.phaseEndsAt,
      players,
      me: {
        id: me.id,
        role: me.role,
        alive: me.alive,
        lover: me.lover,
        potions: me.role === ROLES.SORCIERE ? { ...this.potions } : { heal: false, kill: false },
        awake,
        canAct: this.actionsFor(me).length > 0,
        actions: this.actionsFor(me),
        inspected: me.role === ROLES.VOYANTE ? { ...this.inspected } : {},
        wolfVictim: night && this.step === NIGHT_STEPS.SORCIERE && me.role === ROLES.SORCIERE ? (n.healed ? null : n.victim) : null,
        peekLeft: me.role === ROLES.PETITE_FILLE ? this.peek.left : 0,
        spectator: false,
        isHost: true,
        team: me.role ? (me.lover && (me.role === ROLES.LOUP) !== (this.p(me.lover)?.role === ROLES.LOUP) ? TEAMS.AMOUREUX : me.role === ROLES.LOUP ? TEAMS.LOUPS : TEAMS.VILLAGE) : null,
        peeking: !!this.peek.active,
        skipped: !!me.skip,
        targets: Object.fromEntries(this.actionsFor(me).map((a) => [a, this.targetsFor(me, a)])),
      },
      tie: this.tie && !this.tie.done ? this.tie.candidates : null,
      skip: this.phase === PHASES.DEBATE ? { count: this.alive().filter((p) => p.skip).length, needed: Math.floor(this.alive().length / 2) + 1 } : null,
      votes,
      lastDeaths: this.lastDeaths,
      result: this.result,
    };
    this.send(S2C.STATE, snap);
  }
}

export { ROLE_INFO };
