// One room on the network: binds a Game to sockets, timers, bots, presence relay and chat.
import { S2C, PHASES, LIMITS, CHANNELS, ROLES, EYES } from '../../../shared/protocol.js';
import { Game, cleanText } from '../engine/game.js';
import { buildSnapshot } from '../engine/snapshot.js';
import { presenceRecipients, chatError, chatRecipients, effectivePresence, isPeeking } from '../engine/visibility.js';
import { BotController } from '../bots/controller.js';
import { BOT_NAMES } from '../bots/names.js';
import { pick } from '../engine/rng.js';
import { logger } from '../log.js';

const log = logger('room');
const PRESENCE_INTERVAL = Math.ceil(1000 / LIMITS.PRESENCE_HZ);
const HISTORY_MAX = 80;
const CHAT_BURST = 5;          // messages
const CHAT_REFILL_MS = 1500;   // one message regained every 1.5 s
const CHAT_DUPLICATE_MS = 5000;

const realScheduler = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 2 ** 31 - 1)),
  clearTimeout: (h) => clearTimeout(h),
};

export class Room {
  constructor(code, { speedFactor = 1 } = {}) {
    this.code = code;
    this.game = new Game({ code, speedFactor });
    this.sockets = new Map(); // memberId -> socket
    this.tokens = new Map();  // memberId -> token
    this.timer = null;
    this.flushPending = false;
    this.phaseKey = '';
    this.peekKey = '';
    this.presence = new Map(); // memberId -> { lastAt, timer }
    this.chatLimits = new Map();
    this.history = [];
    this.lastActivity = Date.now();
    this.emptySince = null;
    this.disposed = false;
    this.bots = new BotController(this.game, {
      scheduler: realScheduler,
      act: (id, action) => this.applyAction(id, action),
      say: (id, text, channel) => this.chat(id, { text, channel }, { bot: true }),
      sendPresence: (id, p) => this.presenceIn(id, p),
    });
    this.bots.onError = (err) => log.error(`${code} bot:`, err);
  }

  safe(fn) {
    try { return fn(); } catch (err) { log.error(`${this.code}:`, err); return undefined; }
  }

  touchActivity() { this.lastActivity = Date.now(); }

  connectedHumans() {
    return this.game.humans().filter((m) => this.sockets.has(m.id));
  }

  // ------------------------------------------------------------ membership

  attach(memberId, socket) {
    const old = this.sockets.get(memberId);
    if (old && old !== socket) {
      old.emit(S2C.ERROR, { message: 'Session reprise sur un autre appareil.', code: 'replaced' });
      old.data.code = null;
      old.data.playerId = null;
    }
    this.sockets.set(memberId, socket);
    socket.data.code = this.code;
    socket.data.playerId = memberId;
    this.game.setConnected(memberId, true);
    this.emptySince = null;
    this.touchActivity();
    this.sendState(memberId);
    for (const h of this.history) if (h.to.has(memberId)) socket.emit(S2C.CHAT, h.msg);
    this.after();
  }

  /** Socket gone (disconnect) or explicit leave. */
  detach(socket, { leave = false } = {}) {
    const id = socket.data.playerId;
    socket.data.code = null;
    socket.data.playerId = null;
    if (!id) return;
    if (this.sockets.get(id) === socket) this.sockets.delete(id);
    else if (!leave) return; // an old socket that was already replaced
    const m = this.game.member(id);
    if (!m) return;
    this.game.setConnected(id, false);
    if (leave) {
      const res = this.game.removeMember(id);
      if (res.ok) this.forget(id);
    }
    this.after();
  }

  forget(id) {
    this.tokens.delete(id);
    this.presence.delete(id);
    this.chatLimits.delete(id);
  }

  kick(byId, targetId) {
    const target = this.sockets.get(targetId);
    const res = this.game.kick(byId, targetId);
    if (res.ok) {
      this.forget(targetId);
      if (target) {
        this.sockets.delete(targetId);
        target.emit(S2C.ERROR, { message: 'Vous avez été exclu du salon.', code: 'kicked' });
        target.data.code = null;
        target.data.playerId = null;
      }
    }
    this.after();
    return res;
  }

  addBot(byId) {
    const used = new Set(this.game.members().map((m) => m.name.toLowerCase()));
    const free = BOT_NAMES.filter((n) => !used.has(n.toLowerCase()));
    const res = this.game.addBot(byId, pick(Math.random, free.length ? free : BOT_NAMES));
    this.after();
    return res;
  }

  // ------------------------------------------------------------ game operations

  run(fn) {
    const res = this.safe(fn) || { ok: false, error: 'Erreur interne.' };
    this.touchActivity();
    this.after();
    return res;
  }

  applyAction(id, action) { return this.run(() => this.game.act(id, action)); }

  // ------------------------------------------------------------ chat

  chat(id, payload, { bot = false } = {}) {
    const m = this.game.member(id);
    const channel = payload?.channel ?? CHANNELS.VILLAGE;
    const error = chatError(this.game, m, channel);
    if (error) return { ok: false, error };
    const text = cleanText(payload?.text, LIMITS.CHAT_MAX);
    if (!text) return { ok: false, error: 'Message vide.' };
    if (!bot) {
      const now = Date.now();
      const st = this.chatLimits.get(id) || { tokens: CHAT_BURST, at: now, lastText: '', lastAt: 0 };
      st.tokens = Math.min(CHAT_BURST, st.tokens + (now - st.at) / CHAT_REFILL_MS);
      st.at = now;
      if (text === st.lastText && now - st.lastAt < CHAT_DUPLICATE_MS) {
        this.chatLimits.set(id, st);
        return { ok: false, error: 'Message déjà envoyé.' };
      }
      if (st.tokens < 1) {
        this.chatLimits.set(id, st);
        return { ok: false, error: 'Doucement ! Attendez un peu avant de renvoyer un message.' };
      }
      st.tokens -= 1;
      st.lastText = text;
      st.lastAt = now;
      this.chatLimits.set(id, st);
      this.touchActivity();
    }
    const msg = { id: this.game.nextChatId(), from: id, name: m.name, text, channel, ts: Date.now() };
    this.deliverChat(msg, chatRecipients(this.game, channel));
    this.safe(() => this.bots.onChat(msg));
    return { ok: true };
  }

  deliverChat(msg, to) {
    const set = new Set(to);
    for (const id of set) this.sockets.get(id)?.emit(S2C.CHAT, msg);
    this.history.push({ msg, to: set });
    if (this.history.length > HISTORY_MAX) this.history.shift();
  }

  // ------------------------------------------------------------ presence

  presenceIn(id, raw) {
    const eff = this.game.updatePresence(id, raw);
    if (eff) {
      const st = this.presence.get(id) || { lastAt: 0, timer: null };
      this.presence.set(id, st);
      const wait = PRESENCE_INTERVAL - (Date.now() - st.lastAt);
      if (wait <= 0) this.relayPresence(id);
      else if (!st.timer) {
        st.timer = setTimeout(() => { st.timer = null; this.safe(() => this.relayPresence(id)); }, wait);
      }
    }
    if (this.game.outbox.length || this.game.dirty) this.after();
  }

  relayPresence(id) {
    const p = this.game.member(id);
    if (!p || this.disposed) return;
    const eff = effectivePresence(this.game, p);
    if (!eff) return;
    const st = this.presence.get(id);
    if (st) st.lastAt = Date.now();
    const payload = { ...eff, id };
    for (const to of presenceRecipients(this.game, id)) this.sockets.get(to)?.emit(S2C.PRESENCE, payload);
  }

  /**
   * The petite fille starts/stops peeking inside the wolves' step: wolves get her half-open eyes at once,
   * then her closed eyes when she stops (she is no longer relayed afterwards); she gets the wolves' heads.
   */
  relayPeekChange() {
    const g = this.game;
    const pk = g.night?.peek;
    const pf = pk?.id ? g.player(pk.id) : null;
    const peeking = !!pf && isPeeking(g, pf);
    const key = peeking ? `${pf.id}|${g.day}` : '';
    if (key === this.peekKey) return;
    const prevId = this.peekKey.split('|')[0];
    this.peekKey = key;
    if (peeking) {
      if (!pf.presence) pf.presence = { yaw: 0, pitch: -0.2, eyes: EYES.PEEK, gesture: null, target: null };
      this.relayPresence(pf.id);
      for (const w of g.players) if (w.alive && w.role === ROLES.LOUP && w.presence) this.relayPresence(w.id);
    } else if (prevId) {
      const prev = g.player(prevId);
      const base = prev?.presence || { yaw: 0, pitch: -0.2 };
      const payload = { id: prevId, yaw: base.yaw, pitch: base.pitch, eyes: EYES.CLOSED, gesture: null, target: null };
      for (const w of g.players) {
        if (w.role === ROLES.LOUP && w.alive && w.id !== prevId) this.sockets.get(w.id)?.emit(S2C.PRESENCE, payload);
      }
    }
  }

  /** After a phase/step change, everyone receives the current presence of those they may now see. */
  resyncPresence() {
    for (const p of this.game.players) if (p.presence) this.relayPresence(p.id);
  }

  // ------------------------------------------------------------ flush / timers

  after() {
    if (this.disposed) return;
    this.arm();
    if (this.flushPending) return;
    this.flushPending = true;
    setImmediate(() => { this.flushPending = false; this.safe(() => this.flush()); });
  }

  arm() {
    clearTimeout(this.timer);
    this.timer = null;
    const d = this.game.nextDeadline();
    if (d == null || this.disposed) return;
    const delay = Math.min(Math.max(0, d - Date.now()) + 5, 2 ** 31 - 1);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.safe(() => this.game.tick());
      this.after();
    }, delay);
  }

  sendState(id) {
    const s = this.sockets.get(id);
    if (s) s.emit(S2C.STATE, buildSnapshot(this.game, id));
  }

  flush() {
    if (this.disposed) return;
    const { items, dirty } = this.game.drain();
    if (dirty) for (const id of this.sockets.keys()) this.sendState(id);
    for (const it of items) {
      if (it.kind === 'event') {
        for (const id of it.to) {
          this.sockets.get(id)?.emit(S2C.EVENT, it.event);
          if (this.game.member(id)?.isBot) this.safe(() => this.bots.onEvent(id, it.event));
        }
      } else if (it.kind === 'chat') {
        this.deliverChat(it.msg, it.to);
      }
    }
    const key = `${this.game.phase}|${this.game.step}|${this.game.day}`;
    if (key !== this.phaseKey) {
      if (this.phaseKey) log.debug(`${this.code} → ${this.game.phase}${this.game.step ? `/${this.game.step}` : ''} (jour ${this.game.day})`);
      if (this.game.phase === PHASES.GAME_OVER && this.game.result) {
        log.info(`${this.code} partie terminée : victoire ${this.game.result.winner} (jour ${this.game.day})`);
      }
      this.phaseKey = key;
      this.resyncPresence();
    }
    this.relayPeekChange();
    this.bots.sync();
    this.arm();
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
    for (const st of this.presence.values()) clearTimeout(st.timer);
    this.bots.dispose();
    for (const s of this.sockets.values()) {
      s.emit(S2C.ERROR, { message: 'Le salon a été fermé.', code: 'closed' });
      s.data.code = null;
      s.data.playerId = null;
    }
    this.sockets.clear();
  }
}
