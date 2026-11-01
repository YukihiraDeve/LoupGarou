// Network: socket.io client (real server) with acks, reconnection and session token.
import { io } from 'socket.io-client';
import { S2C, C2S } from '@shared/protocol.js';
import { params, storageGet, storageSet } from '../config.js';

// ?new=1: this tab plays as another player (its session lives under a per-tab key)
function sessionKey() {
  if (!params.fresh) return 'lg_session_v1';
  let id = null;
  try {
    id = sessionStorage.getItem('lg_tab') || Math.random().toString(36).slice(2, 8);
    sessionStorage.setItem('lg_tab', id);
  } catch { id = 'tab'; }
  return `lg_session_v1_${id}`;
}
const SESSION_KEY = sessionKey();
export const getSession = () => storageGet(SESSION_KEY);
export const setSession = (s) => storageSet(SESSION_KEY, s);

export class SocketNet {
  constructor() {
    this.handlers = new Map();
    this.statusHandlers = new Set();
    this.status = 'connecting';
    const url = params.server || undefined; // same origin (Vite proxy in dev, game server in prod)
    this.socket = io(url, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 600,
      reconnectionDelayMax: 4000,
      timeout: 8000,
    });
    for (const ev of Object.values(S2C)) {
      this.socket.on(ev, (data) => this.dispatch(ev, data));
    }
    this.socket.on('connect', () => this.setStatus('connected'));
    this.socket.on('disconnect', () => this.setStatus('disconnected'));
    this.socket.io.on('reconnect_attempt', () => this.setStatus('reconnecting'));
    this.socket.on('connect_error', () => this.setStatus('error'));
  }

  get offline() { return false; }

  setStatus(s) {
    const prev = this.status;
    this.status = s;
    for (const fn of this.statusHandlers) fn(s, prev);
  }
  onStatus(fn) { this.statusHandlers.add(fn); }

  dispatch(ev, data) {
    const set = this.handlers.get(ev);
    if (set) for (const fn of set) fn(data);
  }
  on(ev, fn) {
    if (!this.handlers.has(ev)) this.handlers.set(ev, new Set());
    this.handlers.get(ev).add(fn);
  }
  emit(ev, payload = {}) {
    if (this.socket.connected) this.socket.emit(ev, payload);
  }
  /** Emit with ack; resolves { ok:false, error } on timeout or disconnect. */
  request(ev, payload = {}, timeout = 8000) {
    return new Promise((resolve) => {
      if (!this.socket.connected && ev !== C2S.JOIN && ev !== C2S.CREATE) {
        resolve({ ok: false, error: 'Connexion au serveur perdue.' });
        return;
      }
      this.socket.timeout(timeout).emit(ev, payload, (err, res) => {
        if (err) resolve({ ok: false, error: 'Le serveur ne répond pas.' });
        else resolve(res || { ok: true });
      });
    });
  }
  waitConnected(ms = 6000) {
    if (this.socket.connected) return Promise.resolve(true);
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(false), ms);
      this.socket.once('connect', () => {
        clearTimeout(t);
        resolve(true);
      });
    });
  }
}
