// URL parameters, device detection and persisted settings.
const q = new URLSearchParams(location.search);
const flag = (name) => q.has(name) && q.get(name) !== '0' && q.get(name) !== 'false';

export const params = {
  demo: flag('demo'),
  role: q.get('role') || null, // demo: force my role (petite_fille, loup, ...)
  speed: Math.max(0.1, parseFloat(q.get('speed')) || 1), // demo: time multiplier
  players: Math.max(4, Math.min(16, parseInt(q.get('players'), 10) || 10)), // demo: player count
  autostart: flag('autostart'), // demo: skip the lobby
  room: (q.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8),
  quality: q.get('quality') || null, // low | medium | high
  server: q.get('server') || null, // socket.io URL override
  name: q.get('name') || null,
  debug: flag('debug'),
  phase: q.get('phase') || null, // demo: jump to a phase (night, vote, ...) for screenshots
  fresh: flag('new'), // ignore the stored session: a second player in another tab of the same browser
};

export const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
export const isMobile =
  /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
  (isTouch && Math.min(screen.width, screen.height) < 820);
export const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const SETTINGS_KEY = 'lg_settings_v1';
const defaults = {
  quality: 'auto', // auto | low | medium | high
  volume: 0.8,
  ambience: 0.8,
  narrator: true,
  gyro: false,
  sensitivity: 1,
};

function load() {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return { ...defaults };
  }
}

export const settings = load();
const listeners = new Set();
export function setSetting(key, value) {
  settings[key] = value;
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch { /* private mode */ }
  for (const fn of listeners) fn(key, value);
}
export const onSetting = (fn) => listeners.add(fn);

export function storageGet(key, fallback = null) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}
export function storageSet(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch { /* ignore */ }
}

export const ASSET_BASE = import.meta.env.BASE_URL + 'assets/';
