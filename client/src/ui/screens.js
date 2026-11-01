// Home (name, create / join, avatar) and lobby (players, host settings, bots, start) screens.
import { h, setText, playerColor, escapeHtml } from './dom.js';
import { ICONS } from './icons.js';
import { LOGO_SVG, roleIcon, roleName } from './roleArt.js';
import { ROLES, AVATARS, DEFAULT_TIMERS, LIMITS, MIN_PLAYERS } from '@shared/protocol.js';
import { defaultComposition } from '@shared/roles.js';

const TIMER_LABELS = {
  role_reveal: 'Révélation', night_fall: 'Tombée de la nuit', cupidon: 'Cupidon', lovers: 'Amoureux', voyante: 'Voyante',
  loups: 'Loups-Garous', sorciere: 'Sorcière', dawn: 'Aube', hunter: 'Chasseur', captain_succession: 'Succession',
  election: 'Élection', debate: 'Débat', vote: 'Vote', execution: 'Exécution', captain_tiebreak: 'Départage',
};
const ROLE_ORDER = [ROLES.LOUP, ROLES.VOYANTE, ROLES.SORCIERE, ROLES.CHASSEUR, ROLES.CUPIDON, ROLES.PETITE_FILLE, ROLES.VILLAGEOIS];
const UNIQUE = new Set([ROLES.VOYANTE, ROLES.SORCIERE, ROLES.CHASSEUR, ROLES.CUPIDON, ROLES.PETITE_FILLE]);

function avatarPicker(lib, preview, initial, onChange) {
  const list = lib.list();
  let idx = Math.max(0, list.findIndex((a) => a.id === initial));
  const view = h('div', { class: 'avatar-view' });
  const name = h('div', { class: 'avatar-name' });
  const desc = h('div', { class: 'avatar-desc' });
  const dots = h('div', { class: 'avatar-dots' });
  const set = (i) => {
    idx = (i + list.length) % list.length;
    const a = list[idx];
    preview.setAvatar(a.id);
    setText(name, a.name || a.id);
    setText(desc, a.description || '');
    [...dots.children].forEach((d, k) => d.classList.toggle('on', k === idx));
    onChange(a.id);
  };
  list.forEach((a, k) => dots.appendChild(h('button', { type: 'button', 'aria-label': a.name, onclick: () => set(k) })));
  const el = h('div', { style: { display: 'grid', gap: '8px' } },
    h('div', { class: 'avatar-picker' },
      h('button', { class: 'btn icon-btn', type: 'button', 'aria-label': 'Précédent', html: ICONS.left, onclick: () => set(idx - 1) }),
      view,
      h('button', { class: 'btn icon-btn', type: 'button', 'aria-label': 'Suivant', html: ICONS.right, onclick: () => set(idx + 1) })),
    name, desc, dots);
  preview.mount(view);
  set(idx);
  return { el, get: () => list[idx].id, set: (id) => set(list.findIndex((a) => a.id === id)) };
}

export class HomeScreen {
  constructor(root, { lib, preview, defaults, onCreate, onJoin, onDemo }) {
    this.root = root;
    let avatar = defaults.avatar || AVATARS[Math.floor(Math.random() * AVATARS.length)];
    const nameInput = h('input', { type: 'text', maxlength: String(LIMITS?.NAME_MAX || 20), placeholder: 'Votre pseudo', value: defaults.name || '', autocomplete: 'nickname' });
    const codeInput = h('input', { type: 'text', class: 'code-input', maxlength: '8', placeholder: 'CODE', value: defaults.code || '', autocapitalize: 'characters' });
    const err = h('div', { class: 'err' });
    const busy = (on) => { for (const b of this.el.querySelectorAll('button')) b.disabled = on; };
    const name = () => {
      const n = nameInput.value.trim();
      if (!n) {
        setText(err, 'Choisissez un pseudo.');
        nameInput.focus();
        return null;
      }
      return n;
    };
    const run = async (fn) => {
      setText(err, '');
      busy(true);
      const res = await fn();
      busy(false);
      if (res && !res.ok) setText(err, res.error || 'Erreur.');
    };
    const picker = avatarPicker(lib, preview, avatar, (id) => { avatar = id; });
    this.el = h('div', { class: 'screen home' }, h('div', { class: 'box' },
      h('div', { class: 'hero' }, h('div', { class: 'logo' }, h('div', { class: 'emblem', html: LOGO_SVG }), h('div', { class: 'words' }, h('span', { class: 'w1' }, 'Loup-Garou'), h('span', { class: 'w2' }, 'de Thiercelieux')))),
      h('div', { class: 'cols' },
        h('div', { class: 'card panel' },
          h('h3', {}, 'Rejoindre le feu de camp'),
          h('label', { class: 'field' }, h('span', {}, 'Pseudo'), nameInput),
          h('button', { class: 'btn primary', onclick: () => { const n = name(); if (n) run(() => onCreate(n, avatar)); } }, 'Créer une partie'),
          h('div', { class: 'or' }, '— ou rejoindre avec un code —'),
          h('div', { class: 'join-row field' }, codeInput, h('button', {
            class: 'btn', onclick: () => {
              const n = name();
              const code = codeInput.value.trim().toUpperCase();
              if (!n) return;
              if (!code) { setText(err, 'Entrez le code de la partie.'); return; }
              run(() => onJoin(code, n, avatar));
            },
          }, 'Rejoindre')),
          err,
          h('button', { class: 'btn ghost small', onclick: onDemo }, 'Essayer hors ligne (démo avec des bots)'),
          h('div', { class: 'muted', style: { fontSize: '0.9rem' } }, 'Glissez pour regarder autour de vous. Touchez un joueur pour le désigner.')),
        h('div', { class: 'card panel' }, h('h3', {}, 'Votre campeur'), picker.el))));
    nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const n = name(); if (n) run(() => (codeInput.value ? onJoin(codeInput.value.trim().toUpperCase(), n, avatar) : onCreate(n, avatar))); } });
    codeInput.addEventListener('input', () => { codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
    root.appendChild(this.el);
  }
  destroy() { this.el.remove(); }
}

export class LobbyScreen {
  constructor(root, { lib, preview, onAvatar, onConfig, onAddBot, onKick, onStart, onLeave, onClose }) {
    this.root = root;
    this.cb = { onAvatar, onConfig, onAddBot, onKick, onStart, onLeave };
    this.lib = lib;
    this.codeEl = h('div', { class: 'code' }, '----');
    this.status = h('div', { class: 'muted' }, '');
    this.players = h('div', { class: 'players' });
    this.settingsBox = h('div', { style: { display: 'grid', gap: '12px' } });
    this.err = h('div', { class: 'err' });
    this.startBtn = h('button', { class: 'btn primary', onclick: async () => {
      this.startBtn.disabled = true;
      const res = await onStart();
      this.startBtn.disabled = false;
      setText(this.err, res && !res.ok ? res.error || 'Impossible de lancer.' : '');
    } }, 'Lancer la partie');
    this.addBotBtn = h('button', { class: 'btn', onclick: () => onAddBot() }, '+ Ajouter un bot');
    const copy = h('button', { class: 'btn small', html: `${ICONS.link}<span>Copier le lien</span>`, onclick: () => this.copyLink() });
    this.avatarBox = h('div', {});
    this.picker = null;
    this.preview = preview;
    this.el = h('div', { class: 'screen lobby' }, h('div', { class: 'box' },
      h('div', { class: 'head panel' },
        h('div', {}, h('div', { class: 'muted' }, 'Code de la partie'), this.codeEl),
        h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } }, copy, h('button', { class: 'btn small ghost', onclick: () => onClose() }, 'Voir le camp'), h('button', { class: 'btn small ghost', onclick: () => onLeave() }, 'Quitter'))),
      h('div', { class: 'cols' },
        h('div', { class: 'card panel' }, h('h3', {}, 'Autour du feu'), this.status, this.players, this.addBotBtn,
          h('details', {}, h('summary', {}, 'Changer de campeur'), this.avatarBox)),
        h('div', { class: 'card panel' }, h('h3', {}, 'Réglages de la partie'), this.settingsBox, this.err,
          h('div', { class: 'actions' }, this.startBtn)))));
    this.el.querySelector('details').addEventListener('toggle', (e) => {
      if (e.target.open && !this.picker) {
        this.picker = avatarPicker(lib, preview, this.myAvatar, (id) => { if (id !== this.myAvatar) onAvatar(id); });
        this.avatarBox.appendChild(this.picker.el);
      }
    });
    root.appendChild(this.el);
  }

  copyLink() {
    const url = new URL(location.href);
    url.search = `?room=${this.code}`;
    const text = url.toString();
    const done = () => this.flash('Lien copié !');
    if (navigator.share && /Mobi|Android|iPhone/i.test(navigator.userAgent)) {
      navigator.share({ title: 'Loup-Garou de Thiercelieux', text: 'Rejoins-moi autour du feu !', url: text }).catch(() => {});
    } else navigator.clipboard?.writeText(text).then(done, () => prompt('Lien de la partie :', text));
  }
  flash(t) {
    setText(this.status, t);
    setTimeout(() => this.update(this.state), 1500);
  }

  update(state) {
    if (!state) return;
    this.state = state;
    const me = state.players.find((p) => p.id === state.me?.id);
    const isHost = state.room.hostId === state.me?.id;
    this.code = state.room.code;
    this.myAvatar = me?.avatar;
    setText(this.codeEl, state.room.code);
    const n = state.players.length;
    setText(this.status, `${n} campeur${n > 1 ? 's' : ''} · ${n < MIN_PLAYERS ? `encore ${MIN_PLAYERS - n} pour commencer` : 'prêts à jouer'}`);
    // players
    const key = JSON.stringify(state.players.map((p) => [p.id, p.name, p.avatar, p.isHost, p.isBot, p.connected])) + isHost;
    if (key !== this.playersKey) {
      this.playersKey = key;
      this.players.innerHTML = '';
      for (const p of state.players) {
        const av = this.lib.list().find((a) => a.id === p.avatar);
        this.players.appendChild(h('div', { class: 'lp' },
          h('span', { style: { width: '10px', height: '10px', borderRadius: '50%', background: playerColor(p.seat) } }),
          h('span', { class: 'nm' }, p.name + (p.id === state.me.id ? ' (vous)' : '')),
          h('span', { class: 'muted', style: { fontSize: '0.85rem' } }, av?.name || ''),
          p.isHost ? h('span', { class: 'badge' }, 'Hôte') : null,
          p.isBot ? h('span', { class: 'badge' }, 'Bot') : null,
          !p.connected ? h('span', { class: 'badge' }, 'Déconnecté') : null,
          isHost && p.id !== state.me.id ? h('button', { class: 'btn small ghost', onclick: () => this.cb.onKick(p.id), 'aria-label': `Exclure ${p.name}` }, '✕') : null));
      }
    }
    this.addBotBtn.hidden = !isHost;
    this.startBtn.hidden = !isHost;
    const startError = state.room.startError ?? (n < MIN_PLAYERS ? `Il faut au moins ${MIN_PLAYERS} joueurs (bots compris).` : null);
    this.startBtn.disabled = !!startError;
    if (startError) setText(this.err, startError);
    else if (this.err.textContent && !this.err.dataset.keep) setText(this.err, '');
    this.renderSettings(state, isHost);
  }

  renderSettings(state, isHost) {
    const cfg = state.room.config || {};
    const n = state.players.length;
    const comp = cfg.roles || defaultComposition(n);
    const auto = cfg.rolesAuto ?? !cfg.roles;
    const key = JSON.stringify([comp, auto, cfg.timers, cfg.captain, cfg.speed, isHost, n]);
    if (key === this.settingsKey) return;
    this.settingsKey = key;
    const box = this.settingsBox;
    box.innerHTML = '';
    const total = Object.values(comp).reduce((a, b) => a + b, 0);
    const specials = (c) => Object.fromEntries(Object.entries(c).filter(([r]) => r !== ROLES.VILLAGEOIS));
    const setRole = (role, delta) => {
      const next = specials({ ...comp });
      next[role] = Math.max(role === ROLES.LOUP ? 1 : 0, (next[role] || 0) + delta);
      if (UNIQUE.has(role)) next[role] = Math.min(1, next[role]);
      this.cb.onConfig({ roles: next });
    };
    const compEl = h('div', { class: 'comp' }, ...ROLE_ORDER.map((r) => h('div', { class: 'cr' },
      h('span', { class: 'ic' }, roleIcon(r)), h('span', { class: 'nm' }, roleName(r)),
      isHost && r !== ROLES.VILLAGEOIS ? h('button', { onclick: () => setRole(r, -1), 'aria-label': 'Retirer' }, '−') : null,
      h('span', { class: 'n' }, String(comp[r] || 0)),
      isHost && r !== ROLES.VILLAGEOIS ? h('button', { onclick: () => setRole(r, +1), 'aria-label': 'Ajouter' }, '+') : null)));
    const autoBtn = isHost ? h('button', { class: `btn small ${auto ? 'primary' : ''}`, onclick: () => this.cb.onConfig({ roles: null }) }, auto ? 'Composition automatique ✓' : 'Revenir à la composition automatique') : null;
    box.append(...[h('div', { class: 'muted' }, `Composition (${total} cartes pour ${n} joueurs)`), compEl, autoBtn].filter(Boolean));
    // captain + speed
    const cap = h('input', { type: 'checkbox', disabled: !isHost });
    cap.checked = cfg.captain !== false;
    cap.addEventListener('change', () => this.cb.onConfig({ captain: cap.checked }));
    // config.speed multiplies every duration (protocol contract): below 1 the game is faster.
    const paces = [[0.5, 'Très rapide'], [0.75, 'Rapide'], [1, 'Normal'], [1.5, 'Posé'], [2, 'Lent'], [3, 'Très lent']];
    const speed = h('select', { disabled: !isHost }, ...paces.map(([s, label]) => h('option', { value: String(s) }, label)));
    speed.value = String(cfg.speed ?? 1);
    speed.addEventListener('change', () => this.cb.onConfig({ speed: parseFloat(speed.value) }));
    box.append(h('div', { class: 'timers' },
      h('label', {}, 'Capitaine', h('span', { class: 'switch' }, cap, h('span', {}))),
      h('label', {}, 'Rythme', speed)));
    // timers
    const timers = cfg.timers || DEFAULT_TIMERS;
    const keys = ['debate', 'vote', 'election', 'loups', 'voyante', 'sorciere', 'cupidon', 'role_reveal', 'dawn', 'hunter'];
    const tbox = h('div', { class: 'timers' }, ...keys.map((k) => {
      const input = h('input', { type: 'number', min: '3', max: '600', value: String(timers[k] ?? DEFAULT_TIMERS[k]), disabled: !isHost });
      input.addEventListener('change', () => this.cb.onConfig({ timers: { [k]: Math.max(3, Math.min(600, parseInt(input.value, 10) || DEFAULT_TIMERS[k])) } }));
      return h('label', {}, TIMER_LABELS[k] || k, input);
    }));
    box.append(h('details', {}, h('summary', {}, 'Minuteurs (secondes)'), tbox));
  }

  destroy() {
    this.preview.unmount();
    this.el.remove();
  }
}

export { escapeHtml };
