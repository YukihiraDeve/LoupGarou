// Drives the bots of one game: schedules their actions with human-like delays, chats a little and
// simulates their presence (gaze, eyes, gestures). Works with real timers (rooms) or a simulated
// scheduler (tests), through the injected `scheduler` = { now(), setTimeout(fn, ms), clearTimeout(h) }.
import { ACTIONS, PHASES, NIGHT_STEPS, ROLES, CHANNELS, EYES, GESTURES, EVENTS } from '../../../shared/protocol.js';
import { buildSnapshot } from '../engine/snapshot.js';
import { yawTo, clamp, YAW_LIMIT } from '../engine/geometry.js';
import { pick, chance, between } from '../engine/rng.js';
import { decide, observe, newMemory, suspect } from './brain.js';
import { LINES, fill } from './names.js';

/** Share of the remaining phase time after which a bot acts: [min, max]. */
const DELAYS = {
  [ACTIONS.CUPIDON_LINK]: [0.2, 0.5],
  [ACTIONS.VOYANTE_INSPECT]: [0.15, 0.45],
  [ACTIONS.LOUP_VOTE]: [0.1, 0.4],
  witch: [0.2, 0.45],
  [ACTIONS.HUNTER_SHOOT]: [0.2, 0.5],
  [ACTIONS.CAPTAIN_DESIGNATE]: [0.2, 0.5],
  [ACTIONS.CAPTAIN_TIEBREAK]: [0.25, 0.6],
  [ACTIONS.ELECTION_VOTE]: [0.15, 0.6],
  [ACTIONS.DAY_VOTE]: [0.15, 0.7],
  [ACTIONS.SKIP]: [0.5, 0.9],
};
const WITCH_ACTIONS = new Set([ACTIONS.SORCIERE_HEAL, ACTIONS.SORCIERE_KILL, ACTIONS.SORCIERE_DONE]);
const VOTE_GESTURES = new Set([ACTIONS.DAY_VOTE, ACTIONS.ELECTION_VOTE, ACTIONS.LOUP_VOTE, ACTIONS.HUNTER_SHOOT,
  ACTIONS.CAPTAIN_DESIGNATE, ACTIONS.CAPTAIN_TIEBREAK, ACTIONS.CUPIDON_LINK, ACTIONS.VOYANTE_INSPECT,
  ACTIONS.SORCIERE_KILL]);

export class BotController {
  /**
   * @param {import('../engine/game.js').Game} game
   * @param {{scheduler, act:(id,action)=>{ok:boolean}, say?:(id,text,channel)=>void,
   *          sendPresence?:(id,presence)=>void, rng?:()=>number, presence?:boolean, chat?:boolean}} opts
   */
  constructor(game, opts) {
    this.game = game;
    this.sched = opts.scheduler;
    this.actFn = opts.act;
    this.sayFn = opts.say || (() => {});
    this.presenceFn = opts.sendPresence || (() => {});
    this.rng = opts.rng || Math.random;
    this.presenceOn = opts.presence !== false;
    this.chatOn = opts.chat !== false;
    this.bots = new Map();
    this.lastSpeaker = null;
    this.disposed = false;
  }

  // ------------------------------------------------------------ plumbing

  now() { return this.sched.now(); }
  scale() { return this.game.scale(); }

  later(st, ms, fn) {
    if (this.disposed) return null;
    const h = this.sched.setTimeout(() => {
      st.timers.delete(h);
      if (this.disposed || !this.bots.has(st.id)) return;
      try { fn(); } catch (err) { this.onError?.(err); }
    }, Math.max(0, ms));
    st.timers.add(h);
    return h;
  }

  /** Timers bound to the current phase context, cancelled when the phase changes. */
  laterInCtx(st, ms, fn) {
    const h = this.later(st, ms, () => { st.ctxTimers.delete(h); fn(); });
    if (h != null) st.ctxTimers.add(h);
    return h;
  }

  clearCtx(st) {
    for (const h of st.ctxTimers) { this.sched.clearTimeout(h); st.timers.delete(h); }
    st.ctxTimers.clear();
    st.pending.clear();
  }

  dispose() {
    this.disposed = true;
    for (const st of this.bots.values()) for (const h of st.timers) this.sched.clearTimeout(h);
    this.bots.clear();
  }

  ensure(id) {
    let st = this.bots.get(id);
    if (!st) {
      st = {
        id, ctx: '', pending: new Set(), done: new Set(), revotes: 0, mem: newMemory(), timers: new Set(),
        ctxTimers: new Set(), focus: null, lastSent: null, lastSentAt: 0, presenceTimer: null, greeted: false,
        game: this.game.gamesPlayed,
      };
      this.bots.set(id, st);
      if (this.presenceOn) this.schedulePresence(st, between(this.rng, 300, 1500));
    }
    if (st.game !== this.game.gamesPlayed) { st.game = this.game.gamesPlayed; st.mem = newMemory(); }
    return st;
  }

  snap(id) { return buildSnapshot(this.game, id); }

  // ------------------------------------------------------------ main loop

  /** Re-plan every bot after a state change (idempotent). */
  sync() {
    if (this.disposed) return;
    const ids = new Set();
    for (const p of this.game.players) {
      if (!p.isBot) continue;
      ids.add(p.id);
      this.syncBot(this.ensure(p.id));
    }
    for (const [id, st] of this.bots) {
      if (!ids.has(id)) {
        for (const h of st.timers) this.sched.clearTimeout(h);
        this.bots.delete(id);
      }
    }
  }

  syncBot(st) {
    const snap = this.snap(st.id);
    observe(snap, st.mem);
    const ctx = `${this.game.gamesPlayed}|${snap.phase}|${snap.step}|${snap.day}`;
    if (ctx !== st.ctx) {
      this.clearCtx(st);
      st.ctx = ctx;
      st.done.clear();
      st.revotes = 0;
      st.focus = null;
      this.onNewContext(st, snap);
    }
    for (const type of snap.me.actions) {
      const key = WITCH_ACTIONS.has(type) ? 'witch' : type;
      if (key === ACTIONS.PEEK) continue; // planned in onNewContext
      if (st.pending.has(key)) continue;
      if (st.done.has(key)) {
        if (key === ACTIONS.LOUP_VOTE) this.maybeRevote(st, snap);
        continue;
      }
      this.scheduleAction(st, key, snap);
    }
  }

  delayFor(key, snap) {
    const now = this.now();
    const remain = Math.max(0, (snap.phaseEndsAt ?? now + 10_000) - now);
    const [lo, hi] = DELAYS[key] || [0.15, 0.55];
    let delay = remain * between(this.rng, lo, hi);
    delay = Math.max(delay, Math.min(1200 * this.scale(), remain * 0.3));
    return Math.min(delay, Math.max(0, remain - 400 * this.scale()));
  }

  scheduleAction(st, key, snap) {
    if (key === ACTIONS.SKIP && !chance(this.rng, 0.7)) { st.done.add(key); return; }
    st.pending.add(key);
    this.laterInCtx(st, this.delayFor(key, snap), () => {
      st.pending.delete(key);
      st.done.add(key);
      if (key === 'witch') this.witchTurn(st);
      else this.perform(st, key);
    });
  }

  perform(st, type) {
    const snap = this.snap(st.id);
    if (!snap.me.actions.includes(type)) return false;
    const action = decide(type, snap, st.mem, this.rng);
    if (!action) return false;
    const res = this.actFn(st.id, action);
    if (res?.ok) this.afterAct(st, action);
    return !!res?.ok;
  }

  /** Wolves converge on the pack's choice so the step can end early. */
  maybeRevote(st, snap) {
    if (st.revotes >= 2) return;
    const mine = snap.votes[st.id] || null;
    const tally = new Map();
    for (const [voter, t] of Object.entries(snap.votes)) if (voter !== st.id && t) tally.set(t, (tally.get(t) || 0) + 1);
    if (!tally.size) return;
    const max = Math.max(...tally.values());
    const top = [...tally.keys()].filter((t) => tally.get(t) === max);
    if (top.length !== 1 || top[0] === mine || top[0] === snap.me.lover) return;
    if (!(snap.me.targets[ACTIONS.LOUP_VOTE] || []).includes(top[0])) return;
    st.revotes++;
    st.pending.add(ACTIONS.LOUP_VOTE);
    this.laterInCtx(st, Math.min(this.delayFor(ACTIONS.LOUP_VOTE, snap), between(this.rng, 800, 2500) * this.scale()), () => {
      st.pending.delete(ACTIONS.LOUP_VOTE);
      const res = this.actFn(st.id, { type: ACTIONS.LOUP_VOTE, target: top[0] });
      if (res?.ok) this.afterAct(st, { type: ACTIONS.LOUP_VOTE, target: top[0] });
    });
  }

  witchTurn(st) {
    const step = (type) => this.perform(st, type);
    step(ACTIONS.SORCIERE_HEAL);
    this.laterInCtx(st, between(this.rng, 800, 2000) * this.scale(), () => {
      step(ACTIONS.SORCIERE_KILL);
      this.laterInCtx(st, between(this.rng, 600, 1500) * this.scale(), () => step(ACTIONS.SORCIERE_DONE));
    });
  }

  afterAct(st, action) {
    if (!this.presenceOn || !VOTE_GESTURES.has(action.type)) return;
    const target = action.target || action.targets?.[0] || null;
    if (!target) return;
    const now = this.now();
    const raise = action.type === ACTIONS.DAY_VOTE || action.type === ACTIONS.ELECTION_VOTE;
    st.focus = { target, gesture: GESTURES.POINT, until: now + 2000, then: raise ? GESTURES.RAISE : null };
    this.pushPresence(st);
  }

  // ------------------------------------------------------------ phase reactions (chat, peek)

  onNewContext(st, snap) {
    const me = snap.me;
    const rng = this.rng;
    const remain = Math.max(0, (snap.phaseEndsAt ?? this.now() + 10_000) - this.now());
    const at = (lo, hi) => remain * between(rng, lo, hi);

    if (snap.phase === PHASES.NIGHT && snap.step === NIGHT_STEPS.LOUPS && me.actions.includes(ACTIONS.PEEK)) {
      const peeks = chance(rng, 0.3) ? 0 : chance(rng, 0.55) ? 1 : 2;
      for (let i = 0; i < peeks; i++) this.laterInCtx(st, at(0.1 + i * 0.4, 0.4 + i * 0.4), () => this.peek(st));
    }
    if (!this.chatOn) return;

    switch (snap.phase) {
      case PHASES.LOBBY:
        if (!st.greeted) { st.greeted = true; if (chance(rng, 0.5)) this.laterInCtx(st, between(rng, 800, 3000), () => this.say(st, pick(rng, LINES.greet), CHANNELS.VILLAGE)); }
        break;
      case PHASES.DAWN: {
        const dead = snap.lastDeaths.map((id) => snap.players.find((p) => p.id === id)).filter(Boolean);
        if (me.alive && dead.length && chance(rng, 0.2)) {
          this.laterInCtx(st, at(0.3, 0.8), () => this.say(st, fill(pick(rng, LINES.mourn), { name: pick(rng, dead).name }), CHANNELS.VILLAGE));
        }
        if (!me.alive && snap.lastDeaths.includes(me.id) && chance(rng, 0.25)) {
          this.laterInCtx(st, at(0.2, 0.7), () => this.say(st, pick(rng, LINES.dead), CHANNELS.MORTS));
        }
        break;
      }
      case PHASES.ELECTION:
        if (me.alive && chance(rng, 0.2)) this.laterInCtx(st, at(0.05, 0.4), () => this.say(st, pick(rng, LINES.election), CHANNELS.VILLAGE));
        break;
      case PHASES.DEBATE:
        if (!me.alive) {
          if (chance(rng, 0.08)) this.laterInCtx(st, at(0.2, 0.8), () => this.say(st, pick(rng, LINES.dead), CHANNELS.MORTS));
          break;
        }
        if (chance(rng, 0.65)) this.laterInCtx(st, at(0.08, 0.45), () => this.debateLine(st));
        if (chance(rng, 0.3)) this.laterInCtx(st, at(0.5, 0.85), () => this.debateLine(st));
        break;
      case PHASES.NIGHT:
        if (snap.step === NIGHT_STEPS.LOUPS && me.alive && me.role === ROLES.LOUP && chance(rng, 0.35)) {
          this.laterInCtx(st, at(0.15, 0.5), () => {
            const s = this.snap(st.id);
            const target = s.votes[st.id] || pick(rng, s.me.targets[ACTIONS.LOUP_VOTE] || []);
            const p = s.players.find((x) => x.id === target);
            if (p) this.say(st, fill(pick(rng, LINES.wolves), { name: p.name }), CHANNELS.LOUPS);
          });
        }
        break;
      case PHASES.GAME_OVER:
        if (chance(rng, 0.3)) this.laterInCtx(st, between(rng, 1500, 5000), () => this.say(st, pick(rng, LINES.over), CHANNELS.VILLAGE));
        break;
      default: break;
    }
  }

  debateLine(st) {
    const snap = this.snap(st.id);
    if (snap.phase !== PHASES.DEBATE || !snap.me.alive) return;
    const rng = this.rng;
    const me = snap.me;
    const others = snap.players.filter((p) => p.alive && p.id !== me.id && p.id !== me.lover);
    if (!others.length) return;
    const knownWolf = others.find((p) => st.mem.knownWolves.has(p.id));
    if (me.role === ROLES.VOYANTE && knownWolf && chance(rng, 0.5)) {
      return this.say(st, fill(pick(rng, LINES.seerClaim), { name: knownWolf.name }), CHANNELS.VILLAGE);
    }
    let accused;
    if (me.role === ROLES.LOUP) accused = pick(rng, others.filter((p) => p.role !== ROLES.LOUP));
    else accused = knownWolf || others.slice().sort((a, b) => (st.mem.suspicion.get(b.id) || 0) - (st.mem.suspicion.get(a.id) || 0))[0];
    if (accused && chance(rng, 0.6)) return this.say(st, fill(pick(rng, LINES.accuse), { name: accused.name }), CHANNELS.VILLAGE);
    return this.say(st, pick(rng, LINES.debate), CHANNELS.VILLAGE);
  }

  say(st, text, channel) {
    if (!text) return;
    this.sayFn(st.id, text, channel);
    if (this.presenceOn) {
      st.focus = { target: null, gesture: GESTURES.TALK, until: this.now() + 2500, then: null };
      this.pushPresence(st);
    }
  }

  peek(st) {
    const snap = this.snap(st.id);
    if (!snap.me.actions.includes(ACTIONS.PEEK) || snap.me.peeking) return;
    const res = this.actFn(st.id, { type: ACTIONS.PEEK, active: true });
    if (!res?.ok) return;
    observe(this.snap(st.id), st.mem);
    const risky = chance(this.rng, 0.12);
    const ms = (risky ? between(this.rng, 3300, 4500) : between(this.rng, 800, 2600)) * this.scale();
    this.later(st, ms, () => {
      observe(this.snap(st.id), st.mem);
      this.actFn(st.id, { type: ACTIONS.PEEK, active: false });
    });
  }

  /** Personal events (knowledge) routed to a bot. */
  onEvent(botId, event) {
    const st = this.bots.get(botId);
    if (!st || !event) return;
    if (event.type === EVENTS.PEEK_SPOTTED) st.mem.spottedPf = event.playerId;
    if (event.type === EVENTS.VOTE_CAST && event.kind === 'day' && event.target === botId && event.voterId !== botId) {
      suspect(st.mem, event.voterId, 0.7);
    }
  }

  /** Chat heard by the bots (village / loups / morts). */
  onChat(msg) {
    if (this.disposed || !msg || !msg.from || msg.channel === CHANNELS.SYSTEM) return;
    const now = this.now();
    if (msg.channel === CHANNELS.VILLAGE) this.lastSpeaker = { id: msg.from, at: now };
    const text = String(msg.text || '').toLowerCase();
    const mentions = this.game.players.filter((p) => p.alive && p.id !== msg.from && text.includes(p.name.toLowerCase()));
    const claim = /voyante|c'est un loup|est un loup/.test(text);
    const speaker = this.game.member(msg.from);
    for (const st of this.bots.values()) {
      if (st.id === msg.from) continue;
      const me = this.game.player(st.id);
      if (!me) continue;
      for (const m of mentions) {
        if (m.id === st.id) continue;
        if (me.role === ROLES.LOUP) {
          if (claim && msg.from) st.mem.threats.add(msg.from);
        } else {
          suspect(st.mem, m.id, claim ? 2 : text.includes('loup') ? 1 : 0.4);
        }
      }
      // look at the speaker
      if (this.presenceOn && msg.channel === CHANNELS.VILLAGE && me.alive) {
        this.later(st, between(this.rng, 200, 900), () => this.pushPresence(st));
      }
      // defend when accused by name
      if (this.chatOn && msg.channel === CHANNELS.VILLAGE && me.alive && mentions.some((m) => m.id === st.id)) {
        const fromHuman = speaker && !speaker.isBot;
        if (chance(this.rng, fromHuman ? 0.5 : 0.15)) {
          suspect(st.mem, msg.from, 0.8);
          this.later(st, between(this.rng, 1800, 4500), () => {
            this.say(st, fill(pick(this.rng, LINES.defend), { name: speaker?.name ?? '' }), CHANNELS.VILLAGE);
          });
        }
      }
    }
  }

  // ------------------------------------------------------------ presence

  schedulePresence(st, ms) {
    st.presenceTimer = this.later(st, ms, () => {
      this.pushPresence(st, true);
      this.schedulePresence(st, between(this.rng, 1500, 4000));
    });
  }

  computeLook(st, wander) {
    const g = this.game;
    const me = g.player(st.id);
    if (!me || !me.alive) return null;
    const snap = this.snap(st.id);
    const now = this.now();
    const rng = this.rng;
    const noise = (a) => (rng() - 0.5) * a;
    const lookAt = (id, pitch = -0.05) => {
      const t = g.player(id);
      if (!t) return { yaw: noise(0.2), pitch: -0.3 };
      return { yaw: clamp(yawTo(me.seat, t.seat) + noise(0.06), -YAW_LIMIT, YAW_LIMIT), pitch: pitch + noise(0.05) };
    };
    if (!snap.me.awake) {
      return { yaw: noise(0.1), pitch: -0.45, eyes: snap.me.peeking ? EYES.PEEK : EYES.CLOSED, gesture: null, target: null };
    }
    if (st.focus && st.focus.until <= now && st.focus.then) {
      st.focus = { target: st.focus.target, gesture: st.focus.then, until: now + 1500, then: null };
    }
    if (st.focus && st.focus.until > now) {
      const base = st.focus.target ? lookAt(st.focus.target) : (st.look || { yaw: noise(0.3), pitch: -0.1 });
      return { ...base, eyes: EYES.OPEN, gesture: st.focus.gesture, target: st.focus.target };
    }
    if (snap.phase === PHASES.NIGHT) {
      // awake at night (wolves, lovers...): look at the pack's prey or a fellow awake player
      const vote = snap.votes[st.id];
      const mates = snap.players.filter((p) => p.awake && p.id !== st.id);
      const id = vote || pick(rng, mates)?.id;
      const l = id ? lookAt(id) : { yaw: noise(0.4), pitch: -0.2 };
      return { ...l, eyes: EYES.OPEN, gesture: null, target: id || null };
    }
    const sp = this.lastSpeaker;
    if (sp && now - sp.at < 4000 && sp.id !== st.id && g.player(sp.id)) {
      return { ...lookAt(sp.id), eyes: EYES.OPEN, gesture: null, target: sp.id };
    }
    if (!wander && st.look) return { ...st.look };
    if (chance(rng, 0.45)) {
      st.look = { yaw: noise(0.35), pitch: -0.3 + noise(0.1), eyes: EYES.OPEN, gesture: null, target: null };
    } else {
      const other = pick(rng, g.players.filter((p) => p.id !== st.id && p.alive));
      st.look = other ? { ...lookAt(other.id), eyes: EYES.OPEN, gesture: null, target: other.id }
        : { yaw: 0, pitch: -0.3, eyes: EYES.OPEN, gesture: null, target: null };
    }
    return { ...st.look };
  }

  pushPresence(st, wander = false) {
    if (!this.presenceOn) return;
    const look = this.computeLook(st, wander);
    if (!look) return;
    const prev = st.lastSent;
    const now = this.now();
    const changed = !prev || Math.abs(prev.yaw - look.yaw) > 0.04 || Math.abs(prev.pitch - look.pitch) > 0.04
      || prev.eyes !== look.eyes || prev.gesture !== look.gesture || prev.target !== look.target;
    if (!changed && now - st.lastSentAt < 8000) return;
    st.lastSent = look;
    st.lastSentAt = now;
    this.presenceFn(st.id, look);
  }
}
