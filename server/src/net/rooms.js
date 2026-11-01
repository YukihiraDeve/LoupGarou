// Room registry: codes, reconnection tokens, socket.io handlers, cleanup of idle rooms.
import { randomBytes, randomInt } from 'node:crypto';
import { C2S, S2C, LIMITS } from '../../../shared/protocol.js';
import { Room } from './room.js';
import { logger } from '../log.js';

const log = logger('rooms');
const MAX_EVENTS_PER_SECOND = 40;

function obj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v) ? v : {}; }

const ACK_FIELDS = ['code', 'playerId', 'token', 'spectator'];
/** Only whitelisted fields go back to the client (never internal objects). */
function publicResult(res) {
  if (!res.ok) return { ok: false, error: typeof res.error === 'string' ? res.error : 'Erreur.' };
  const out = { ok: true };
  for (const k of ACK_FIELDS) if (k in res) out[k] = res[k];
  return out;
}

export function normalizeCode(raw) {
  return typeof raw === 'string' ? raw.trim().toUpperCase().slice(0, LIMITS.CODE_LENGTH) : '';
}

export class RoomManager {
  /**
   * @param {{speedFactor?:number, emptyTtlMs?:number, idleTtlMs?:number, maintenanceMs?:number,
   *          hostGraceMs?:number, lobbyGraceMs?:number, maxRooms?:number}} opts
   */
  constructor(opts = {}) {
    this.speedFactor = opts.speedFactor || 1;
    this.emptyTtlMs = opts.emptyTtlMs ?? 10 * 60_000;
    this.idleTtlMs = opts.idleTtlMs ?? 6 * 3600_000;
    this.hostGraceMs = opts.hostGraceMs ?? 30_000;
    this.lobbyGraceMs = opts.lobbyGraceMs ?? 120_000;
    this.maxRooms = opts.maxRooms ?? 500;
    this.rooms = new Map();
    this.tokens = new Map(); // token -> { code, playerId }
    this.interval = setInterval(() => this.safe(() => this.maintenance()), opts.maintenanceMs ?? 10_000);
    this.interval.unref?.();
  }

  safe(fn) {
    try { return fn(); } catch (err) { log.error(err); return undefined; }
  }

  newCode() {
    const abc = LIMITS.CODE_ALPHABET;
    for (let attempt = 0; attempt < 1000; attempt++) {
      let code = '';
      for (let i = 0; i < LIMITS.CODE_LENGTH; i++) code += abc[randomInt(abc.length)];
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('no free room code');
  }

  issueToken(room, memberId) {
    const token = randomBytes(18).toString('base64url');
    room.tokens.set(memberId, token);
    this.tokens.set(token, { code: room.code, playerId: memberId });
    return token;
  }

  dropTokens(room, ids) {
    for (const id of ids) {
      const t = room.tokens.get(id);
      if (t) this.tokens.delete(t);
      room.tokens.delete(id);
    }
  }

  roomOf(socket) {
    const code = socket.data.code;
    return code ? this.rooms.get(code) || null : null;
  }

  /** Leave the current room (if any) before creating/joining another one. */
  detachSocket(socket, opts) {
    const room = this.roomOf(socket);
    if (room) {
      const id = socket.data.playerId;
      const token = room.tokens.get(id);
      room.detach(socket, opts);
      if (opts?.leave && !room.game.member(id) && token) this.tokens.delete(token);
      this.cleanupIfAbandoned(room);
    }
  }

  create(socket, payload) {
    const p = obj(payload);
    if (this.rooms.size >= this.maxRooms) return { ok: false, error: 'Trop de salons ouverts, réessayez plus tard.' };
    this.detachSocket(socket, { leave: true });
    const code = this.newCode();
    const room = new Room(code, { speedFactor: this.speedFactor });
    this.rooms.set(code, room);
    const res = room.game.join({ name: p.name, avatar: p.avatar });
    if (!res.ok) { this.rooms.delete(code); room.dispose(); return res; }
    const token = this.issueToken(room, res.member.id);
    room.attach(res.member.id, socket);
    log.info(`salon ${code} créé par ${res.member.name}`);
    return { ok: true, code, playerId: res.member.id, token, spectator: false };
  }

  join(socket, payload) {
    const p = obj(payload);
    const code = normalizeCode(p.code);
    const room = this.rooms.get(code);
    // reconnection: same token, same seat, even in the middle of a game
    const known = typeof p.token === 'string' ? this.tokens.get(p.token) : null;
    if (known && (!code || known.code === code)) {
      const r = this.rooms.get(known.code);
      const m = r?.game.member(known.playerId);
      if (r && m) {
        if (socket.data.code !== r.code || socket.data.playerId !== m.id) this.detachSocket(socket);
        r.attach(m.id, socket);
        log.info(`${r.code} reconnexion de ${m.name}`);
        return { ok: true, code: r.code, playerId: m.id, token: p.token, spectator: !!m.spectator };
      }
      this.tokens.delete(p.token);
    }
    if (!room) return { ok: false, error: 'Salon introuvable. Vérifiez le code.' };
    this.detachSocket(socket, { leave: true });
    const res = room.game.join({ name: p.name, avatar: p.avatar });
    if (!res.ok) { room.after(); return res; }
    const token = this.issueToken(room, res.member.id);
    room.attach(res.member.id, socket);
    log.info(`${code} ${res.member.name} rejoint${res.spectator ? ' (spectateur)' : ''}`);
    return { ok: true, code, playerId: res.member.id, token, spectator: res.spectator };
  }

  leave(socket) {
    this.detachSocket(socket, { leave: true });
    return { ok: true };
  }

  disconnect(socket) {
    this.detachSocket(socket, { leave: false });
  }

  cleanupIfAbandoned(room) {
    if (room.game.humans().length === 0) this.deleteRoom(room, 'plus aucun humain');
  }

  deleteRoom(room, reason) {
    if (!this.rooms.has(room.code)) return;
    this.rooms.delete(room.code);
    this.dropTokens(room, [...room.tokens.keys()]);
    room.dispose();
    log.info(`salon ${room.code} fermé (${reason})`);
  }

  maintenance() {
    const now = Date.now();
    for (const room of [...this.rooms.values()]) {
      const removed = room.safe(() => room.game.maintenance({ hostGraceMs: this.hostGraceMs, lobbyGraceMs: this.lobbyGraceMs })) || [];
      if (removed.length) this.dropTokens(room, removed);
      room.after();
      if (room.game.humans().length === 0) { this.deleteRoom(room, 'plus aucun humain'); continue; }
      if (room.connectedHumans().length === 0) {
        room.emptySince ??= now;
        if (now - room.emptySince > this.emptyTtlMs) { this.deleteRoom(room, 'vide'); continue; }
      } else room.emptySince = null;
      if (now - room.lastActivity > this.idleTtlMs) this.deleteRoom(room, 'inactif');
    }
  }

  close() {
    clearInterval(this.interval);
    for (const room of [...this.rooms.values()]) this.deleteRoom(room, 'arrêt du serveur');
  }

  // ------------------------------------------------------------ socket.io wiring

  attachIo(io) {
    io.on('connection', (socket) => {
      socket.data.code = null;
      socket.data.playerId = null;
      const window = { start: Date.now(), count: 0 };
      const flood = () => {
        const now = Date.now();
        if (now - window.start >= 1000) { window.start = now; window.count = 0; }
        return ++window.count > MAX_EVENTS_PER_SECOND;
      };
      /** Register a handler: (payload, ack) with validation, flood control and error isolation. */
      const on = (event, handler) => {
        socket.on(event, (...args) => {
          let ack = typeof args[args.length - 1] === 'function' ? args.pop() : null;
          if (flood()) {
            if (ack) ack({ ok: false, error: 'Trop de requêtes.' });
            return;
          }
          const payload = args[0];
          let res;
          try {
            res = handler(payload);
          } catch (err) {
            log.error(`${event}:`, err);
            res = { ok: false, error: 'Erreur interne.' };
          }
          if (!res) return;
          const out = publicResult(res);
          if (ack) { const a = ack; ack = null; a(out); } else if (!out.ok && out.error) socket.emit(S2C.ERROR, { message: out.error });
        });
      };
      const inRoom = (fn) => (payload) => {
        const room = this.roomOf(socket);
        const id = socket.data.playerId;
        if (!room || !id || !room.game.member(id)) return { ok: false, error: "Vous n'êtes dans aucun salon." };
        return fn(room, id, obj(payload));
      };

      on(C2S.CREATE, (p) => this.create(socket, p));
      on(C2S.JOIN, (p) => this.join(socket, p));
      on(C2S.LEAVE, () => this.leave(socket));
      on(C2S.AVATAR, inRoom((room, id, p) => room.run(() => room.game.setAvatar(id, p.avatar))));
      on(C2S.CONFIG, inRoom((room, id, p) => room.run(() => room.game.setConfig(id, p))));
      on(C2S.ADD_BOT, inRoom((room, id) => {
        const res = room.addBot(id);
        return res.ok ? { ok: true, playerId: res.member.id } : res;
      }));
      on(C2S.KICK, inRoom((room, id, p) => {
        const token = room.tokens.get(p.playerId);
        const res = room.kick(id, p.playerId);
        if (res.ok && token) this.tokens.delete(token);
        return res.ok ? { ok: true } : res;
      }));
      on(C2S.START, inRoom((room, id) => {
        const res = room.run(() => room.game.start(id));
        if (res.ok) log.info(`${room.code} partie lancée (${room.game.players.length} joueurs)`);
        return res;
      }));
      on(C2S.RESTART, inRoom((room, id) => room.run(() => room.game.restart(id))));
      on(C2S.ACTION, inRoom((room, id, p) => {
        const res = room.applyAction(id, p);
        return res.ok ? { ok: true } : res;
      }));
      on(C2S.CHAT, inRoom((room, id, p) => room.chat(id, p)));
      on(C2S.PRESENCE, inRoom((room, id, p) => { room.safe(() => room.presenceIn(id, p)); return null; }));

      socket.on('disconnect', () => this.safe(() => this.disconnect(socket)));
      socket.on('error', (err) => log.warn('socket:', err?.message || err));
    });
  }
}
