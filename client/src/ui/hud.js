// In-game HUD (French), laid out like docs/reference/ambiance.webp: logo top-left, ornate phase
// banner top-centre, players + timer top-right, chat bottom-left, instruction bottom-centre, settings
// bottom-right. Pure view: the game client decides what to show.
import { h, setText, playerColor, escapeHtml } from './dom.js';
import { ICONS } from './icons.js';
import { LOGO_SVG, cardCanvas, roleName, roleIcon, ROLE_ART } from './roleArt.js';
import { ROLE_INFO } from '@shared/roles.js';
import { CHANNELS, LIMITS } from '@shared/protocol.js';
import { settings, setSetting, isTouch } from '../config.js';
import { TIERS } from '../engine/quality.js';

const smallScreen = () => matchMedia('(max-width: 760px) and (orientation: portrait), (max-height: 500px)').matches;

export class Hud {
  constructor(root, cb) {
    this.root = root;
    this.cb = cb;
    this.cache = {};
    this.build();
  }

  build() {
    const r = this.root;
    r.innerHTML = '';
    // logo
    this.logo = h('div', { class: 'hud-logo logo' },
      h('div', { class: 'emblem', html: LOGO_SVG }),
      h('div', { class: 'words' }, h('span', { class: 'w1' }, 'Loup-Garou'), h('span', { class: 'w2' }, 'de Thiercelieux')));
    // banner
    this.bIcon = h('div', { class: 'b-icon', html: ICONS.eye });
    this.bTitle = h('div', { class: 'b-title' }, '');
    this.bSubIcon = h('span', { class: 'b-subicon' });
    this.bSubText = h('span', {});
    this.bSub = h('div', { class: 'b-sub' }, this.bSubIcon, this.bSubText);
    this.banner = h('div', { class: 'banner' }, this.bIcon, h('div', { class: 'b-text' }, this.bTitle, this.bSub));
    // top right
    this.countEl = h('span', {}, '');
    this.timerEl = h('span', { class: 'timer' }, '--:--');
    this.sunbar = h('span', {});
    this.topright = h('div', { class: 'topright panel', role: 'button', 'aria-label': 'Liste des joueurs', onclick: () => this.togglePlayers() },
      h('div', { class: 'row', html: ICONS.players }, this.countEl),
      h('div', { class: 'row', html: ICONS.clock }, this.timerEl),
      h('div', { class: 'sunbar' }, this.sunbar));
    this.playerlist = h('div', { class: 'playerlist panel', hidden: true });
    this.votesEl = h('div', { class: 'votes-recap panel', hidden: true });
    // chat
    this.msgs = h('div', { class: 'msgs' });
    this.input = h('input', { type: 'text', maxlength: String(LIMITS?.CHAT_MAX || 200), placeholder: 'Écrire un message…', enterkeyhint: 'send', autocomplete: 'off' });
    this.chanEl = h('span', {}, '');
    this.emotes = h('div', { class: 'emotes' },
      h('button', { type: 'button', title: 'Hocher la tête (oui)', onclick: () => this.cb.onEmote?.('nod') }, '👍 Oui'),
      h('button', { type: 'button', title: 'Secouer la tête (non)', onclick: () => this.cb.onEmote?.('shake') }, '👎 Non'),
      h('button', { type: 'button', title: 'Lever la main', onclick: () => this.cb.onEmote?.('raise') }, '✋'));
    const form = h('form', { onsubmit: (e) => { e.preventDefault(); this.sendChat(); } },
      this.input, h('button', { class: 'send', type: 'submit', 'aria-label': 'Envoyer', html: ICONS.send }));
    this.input.addEventListener('input', () => this.cb.onTyping?.());
    this.input.addEventListener('focus', () => this.cb.onTyping?.());
    this.chat = h('div', { class: 'chat panel' }, this.msgs, h('div', { class: 'chan' }, this.chanEl, this.emotes), form);
    this.chatBadge = h('span', { class: 'badge', hidden: true }, '0');
    this.chatToggle = h('button', { class: 'btn icon-btn chat-toggle', 'aria-label': 'Discussion', html: ICONS.chat, onclick: () => this.toggleChat() }, this.chatBadge);
    this.unread = 0;
    // bottom centre
    this.consIcon = h('span', { html: ICONS.eye });
    this.consText = h('span', {}, '');
    this.consigne = h('div', { class: 'consigne' }, this.consIcon, this.consText);
    this.actionbar = h('div', { class: 'actionbar panel', hidden: true });
    this.peekGauge = h('div', { class: 'gauge' });
    this.peekLabel = h('span', {}, 'Entrouvrir les yeux');
    this.peekBtn = h('button', { class: 'peek-btn', hidden: true, 'aria-label': 'Entrouvrir les yeux (maintenir)' },
      this.peekGauge, h('span', { html: ICONS.eye }), this.peekLabel);
    const down = (e) => { e.preventDefault(); this.cb.onPeek?.(true); };
    const up = () => this.cb.onPeek?.(false);
    this.peekBtn.addEventListener('pointerdown', down);
    this.peekBtn.addEventListener('pointerup', up);
    this.peekBtn.addEventListener('pointercancel', up);
    this.peekBtn.addEventListener('pointerleave', up);
    this.peekBtn.addEventListener('contextmenu', (e) => e.preventDefault());
    // bottom right
    this.gear = h('button', { class: 'btn icon-btn gear', 'aria-label': 'Réglages', html: ICONS.gear, onclick: () => this.toggleSettings() });
    this.mycard = h('button', { class: 'mycard panel', hidden: true, onclick: () => this.cb.onMyCard?.() });
    this.settings = this.buildSettings();
    // narration (night) and tints live in the overlay layer below the HUD
    this.narr = h('div', { class: 'night-narration' }, h('div', { class: 'moon' }, '☾'), h('div', { class: 'nt' }), h('div', { class: 'ns' }));
    this.tint = h('div', { class: 'wolf-tint', hidden: true });
    this.crosshair = h('div', { class: 'crosshair', hidden: true });
    const overlay = document.getElementById('overlay');
    overlay.append(this.tint, this.narr, this.crosshair);
    r.append(this.logo, this.banner, this.topright, this.playerlist, this.votesEl, this.chat, this.chatToggle,
      this.consigne, this.actionbar, this.peekBtn, this.mycard, this.gear, this.settings);
    this.layout();
    window.addEventListener('resize', () => this.layout());
  }

  layout() {
    const small = smallScreen();
    this.chatToggle.hidden = !small;
    if (small && this.chatOpen === undefined) this.chatOpen = false;
    this.chat.hidden = small && !this.chatOpen;
    if (!small) this.chat.hidden = false;
    if (!this.chat.hidden) this.msgs.scrollTop = this.msgs.scrollHeight;
  }
  toggleChat() {
    this.chatOpen = !this.chatOpen;
    this.unread = 0;
    this.chatBadge.hidden = true;
    this.chat.hidden = !this.chatOpen;
    this.chatToggle.style.bottom = this.chatOpen ? `calc(var(--sab) + 16px + ${this.chat.offsetHeight}px)` : '';
    if (this.chatOpen) this.msgs.scrollTop = this.msgs.scrollHeight;
  }

  show(on) {
    this.root.hidden = !on;
    // Messages received while hidden could not scroll (zero height): jump to the latest ones.
    if (on) this.msgs.scrollTop = this.msgs.scrollHeight;
  }

  // ---------------------------------------------------------------------------------------------
  setBanner({ title, sub = '', icon = 'eye', subIcon = null }) {
    const key = `${title}|${sub}|${icon}|${subIcon}`;
    if (this.cache.banner === key) return;
    const flash = this.cache.banner && this.cache.bannerTitle !== title;
    this.cache.banner = key;
    this.cache.bannerTitle = title;
    this.bIcon.innerHTML = ICONS[icon] || '';
    setText(this.bTitle, title);
    this.bSubIcon.innerHTML = subIcon ? `<span style="display:inline-block;width:18px;height:18px">${ICONS[subIcon] || ''}</span>` : '';
    setText(this.bSubText, sub);
    this.bSub.hidden = !sub;
    if (flash) {
      this.banner.classList.remove('flash');
      void this.banner.offsetWidth;
      this.banner.classList.add('flash');
    }
  }

  setTopRight({ alive, total, seconds, progress }) {
    setText(this.countEl, total == null ? '' : `${alive} / ${total} joueurs`);
    if (seconds == null) setText(this.timerEl, '--:--');
    else {
      const s = Math.max(0, Math.ceil(seconds));
      setText(this.timerEl, `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`);
    }
    const urgent = seconds != null && seconds <= 10 && seconds > 0;
    if (this.cache.urgent !== urgent) {
      this.cache.urgent = urgent;
      this.timerEl.classList.toggle('urgent', urgent);
    }
    const w = `${Math.round((progress ?? 0) * 100)}%`;
    if (this.sunbar.style.width !== w) this.sunbar.style.width = w;
  }

  togglePlayers(force) {
    this.playersOpen = force ?? !this.playersOpen;
    this.playerlist.hidden = !this.playersOpen;
    if (this.playersOpen) this.votesEl.hidden = true;
    this.cb.onClick?.();
  }

  setPlayers(list) {
    const key = JSON.stringify(list);
    if (key === this.cache.players) return;
    this.cache.players = key;
    this.playerlist.innerHTML = '';
    for (const p of list) {
      const row = h('div', {
        class: `pl ${p.alive ? '' : 'dead'} ${p.targetable ? 'targetable' : ''} ${p.selected ? 'selected' : ''}`,
        onclick: () => this.cb.onPlayerClick?.(p.id),
      },
      h('span', { class: 'dot', style: { background: playerColor(p.seat) } }),
      h('span', { class: 'nm' }, `${p.name}${p.me ? ' (vous)' : ''}`),
      h('span', { class: 'tag' }, p.tag || ''));
      this.playerlist.appendChild(row);
    }
  }

  setVotes(rows, title = 'Votes') {
    const key = rows ? JSON.stringify(rows) + title : '';
    if (key === this.cache.votes) return;
    this.cache.votes = key;
    if (!rows || !rows.length || this.playersOpen) {
      this.votesEl.hidden = true;
      return;
    }
    this.votesEl.hidden = false;
    this.votesEl.innerHTML = `<h4>${escapeHtml(title)}</h4>` + rows.map((r) =>
      `<div class="vr"><span>${escapeHtml(r.name)}<span class="who">${escapeHtml(r.voters.join(', '))}</span></span><b>${r.count}</b></div>`).join('');
  }

  setConsigne(text, icon = 'eye') {
    const key = text + icon;
    if (this.cache.cons === key) return;
    this.cache.cons = key;
    this.consigne.hidden = !text;
    this.consIcon.innerHTML = ICONS[icon] || '';
    setText(this.consText, text || '');
  }

  /** spec: { key, html, buttons: [{ label, kind, onClick, disabled }] } or null */
  setActionBar(spec) {
    const key = spec ? spec.key : '';
    if (this.cache.action === key) return;
    this.cache.action = key;
    if (!spec) {
      this.actionbar.hidden = true;
      return;
    }
    this.actionbar.hidden = false;
    this.actionbar.innerHTML = '';
    if (spec.html) this.actionbar.appendChild(h('div', { class: 'ab-text', html: spec.html }));
    if (spec.buttons?.length) {
      const row = h('div', { class: 'ab-buttons' });
      for (const b of spec.buttons) {
        row.appendChild(h('button', {
          class: `btn ${b.kind || ''}`,
          disabled: b.disabled,
          onclick: (e) => { e.stopPropagation(); b.onClick?.(); },
        }, b.label));
      }
      this.actionbar.appendChild(row);
    }
  }

  setPeek({ visible, active, left = 0, max = 8 }) {
    this.peekBtn.hidden = !visible;
    if (!visible) return;
    this.peekBtn.classList.toggle('active', !!active);
    this.peekGauge.style.setProperty('--p', `${Math.round((left / max) * 100)}%`);
    setText(this.peekLabel, left > 0 ? `Entrouvrir les yeux · ${left.toFixed(1)} s` : 'Plus de courage…');
  }

  setMyCard(role) {
    if (this.cache.mycard === role) return;
    this.cache.mycard = role;
    this.mycard.hidden = !role;
    if (role) this.mycard.innerHTML = `<span class="ico">${roleIcon(role)}</span><span>${escapeHtml(roleName(role))}</span>`;
  }

  setChannel(label, enabled, placeholder) {
    setText(this.chanEl, label);
    this.input.disabled = !enabled;
    this.input.placeholder = placeholder || (enabled ? 'Écrire un message…' : 'Silence…');
    this.chat.classList.toggle('disabled', !enabled);
    this.emotes.hidden = !enabled;
  }

  addMessage({ name, text, channel, seat, system }) {
    const cls = system || channel === CHANNELS.SYSTEM ? 'sys' : channel === CHANNELS.LOUPS ? 'wolves' : channel === CHANNELS.MORTS ? 'dead' : '';
    const el = h('div', { class: `msg ${cls}` });
    if (cls !== 'sys') el.appendChild(h('span', { class: 'n', style: { color: playerColor(seat) } }, `${name} :`));
    el.appendChild(document.createTextNode(text));
    const atBottom = this.msgs.clientHeight === 0 || this.msgs.scrollHeight - this.msgs.scrollTop - this.msgs.clientHeight < 40;
    this.msgs.appendChild(el);
    while (this.msgs.children.length > 120) this.msgs.firstChild.remove();
    if (atBottom) this.msgs.scrollTop = this.msgs.scrollHeight;
    if (this.chat.hidden) {
      this.unread++;
      this.chatBadge.hidden = false;
      setText(this.chatBadge, String(this.unread));
    }
  }

  sendChat() {
    const text = this.input.value.trim();
    if (!text) return;
    this.input.value = '';
    this.cb.onChat?.(text);
    if (isTouch) this.input.blur();
  }

  // ---------------------------------------------------------------------------------------------
  buildSettings() {
    const el = h('div', { class: 'settings panel', hidden: true });
    const sw = (key, label, onChange) => {
      const input = h('input', { type: 'checkbox' });
      input.checked = !!settings[key];
      input.addEventListener('change', async () => {
        const ok = onChange ? await onChange(input.checked) : true;
        if (ok === false) input.checked = false;
        setSetting(key, input.checked);
      });
      return h('label', {}, h('span', {}, label), h('span', { class: 'switch' }, input, h('span', {})));
    };
    const range = (key, label, min, max, step) => {
      const input = h('input', { type: 'range', min, max, step, value: settings[key] });
      input.addEventListener('input', () => setSetting(key, parseFloat(input.value)));
      return h('label', {}, h('span', {}, label), input);
    };
    const quality = h('select', {},
      h('option', { value: 'auto' }, 'Automatique'),
      ...Object.values(TIERS).map((t) => h('option', { value: t.name }, t.label)));
    quality.value = settings.quality;
    quality.addEventListener('change', () => {
      setSetting('quality', quality.value);
      this.cb.onQuality?.(quality.value);
    });
    this.qualityInfo = h('span', { class: 'muted', style: { fontSize: '0.85rem' } }, '');
    el.append(...[
      h('h3', {}, 'Réglages'),
      h('label', {}, h('span', {}, 'Qualité graphique'), quality),
      this.qualityInfo,
      range('volume', 'Volume', 0, 1, 0.05),
      range('ambience', 'Ambiance', 0, 1, 0.05),
      sw('narrator', 'Voix du narrateur', (v) => { if (!v) this.cb.onNarratorOff?.(); return true; }),
      isTouch ? sw('gyro', 'Gyroscope', (v) => this.cb.onGyro?.(v)) : null,
      range('sensitivity', 'Sensibilité', 0.4, 2, 0.1),
      h('div', { class: 'row-btns' },
        h('button', { class: 'btn small', onclick: () => this.cb.onFullscreen?.() }, 'Plein écran'),
        h('button', { class: 'btn small danger', onclick: () => this.cb.onQuit?.() }, 'Quitter la partie')),
    ].filter(Boolean));
    return el;
  }
  toggleSettings(force) {
    this.settings.hidden = !(force ?? this.settings.hidden);
    this.cb.onClick?.();
  }
  setQualityInfo(text) { setText(this.qualityInfo, text); }

  // ---------------------------------------------------------------------------------------------
  showRoleCard(role, { onClose, intro = true, extra = '' } = {}) {
    this.hideRoleCard();
    const info = ROLE_INFO[role];
    const face = cardCanvas(role);
    const back = cardCanvas(null);
    const card = h('div', { class: 'rolecard' }, h('div', { class: 'inner' }, h('div', { class: 'face' }, face), h('div', { class: 'back' }, back)));
    const caption = h('div', { class: 'card-caption' },
      h('div', { class: 'rn' }, info ? info.name : role),
      h('p', {}, info ? info.desc : ''),
      extra ? h('p', { html: extra }) : null,
      h('div', { class: 'hint' }, 'Touchez pour fermer'));
    caption.style.opacity = '0';
    const overlay = h('div', { class: 'card-overlay' }, h('div', { style: { display: 'grid', justifyItems: 'center' } }, card, caption));
    const close = () => {
      this.hideRoleCard();
      onClose?.();
    };
    overlay.addEventListener('click', close);
    document.getElementById('screens').appendChild(overlay);
    this.cardOverlay = overlay;
    setTimeout(() => {
      card.classList.add('flipped');
      setTimeout(() => { caption.style.transition = 'opacity .6s'; caption.style.opacity = '1'; }, 700);
    }, intro ? 600 : 50);
  }
  hideRoleCard() {
    this.cardOverlay?.remove();
    this.cardOverlay = null;
  }

  showDeathLog(title, entries, ms = 7000) {
    this.deathlog?.remove();
    const box = h('div', { class: 'deathlog panel' }, h('h3', {}, title),
      ...entries.map((e) => h('div', { class: 'd' }, h('span', {}, e.icon || '✝'), h('b', {}, e.name), e.role ? h('span', { class: 'r' }, `${roleIcon(e.role)} ${roleName(e.role)}`) : null, h('span', { class: 'muted' }, e.cause || ''))));
    if (!entries.length) box.appendChild(h('div', { class: 'd muted' }, 'Personne n’est mort cette nuit.'));
    this.root.appendChild(box);
    this.deathlog = box;
    clearTimeout(this.deathTimer);
    this.deathTimer = setTimeout(() => { box.remove(); if (this.deathlog === box) this.deathlog = null; }, ms);
  }

  showEnd({ title, sub, players, isHost, onReplay, onQuit, win }) {
    this.hideEnd();
    const grid = h('div', { class: 'grid' }, ...players.map((p) => h('div', { class: `who ${p.winner ? 'win' : ''} ${p.alive ? '' : 'dead'}` },
      h('span', { class: 'ri' }, roleIcon(p.role)),
      h('span', {}, h('div', { class: 'nm', style: { color: playerColor(p.seat) } }, p.name + (p.me ? ' (vous)' : '')), h('div', { class: 'rl' }, roleName(p.role) + (p.lover ? ' ♥' : ''))))));
    const box = h('div', { class: 'box panel' },
      h('h2', {}, title), h('div', { class: 'sub' }, sub), grid,
      h('div', { class: 'row-btns', style: { justifyContent: 'center', display: 'flex', gap: '10px', flexWrap: 'wrap' } },
        isHost ? h('button', { class: 'btn primary', onclick: onReplay }, 'Rejouer') : h('span', { class: 'muted' }, 'En attente de l’hôte pour rejouer…'),
        h('button', { class: 'btn', onclick: () => this.hideEnd() }, 'Voir le camp'),
        h('button', { class: 'btn ghost', onclick: onQuit }, 'Quitter')));
    const el = h('div', { class: 'endscreen' }, box);
    document.getElementById('screens').appendChild(el);
    this.endEl = el;
    this.endWin = win;
  }
  hideEnd() {
    this.endEl?.remove();
    this.endEl = null;
  }

  setNightNarration(title, sub) {
    const on = !!title;
    if (on) {
      setText(this.narr.querySelector('.nt'), title);
      setText(this.narr.querySelector('.ns'), sub || '');
    }
    this.narr.classList.toggle('on', on);
  }

  setTint(kind) {
    if (this.cache.tint === kind) return;
    this.cache.tint = kind;
    this.tint.hidden = !kind;
    this.tint.className = kind === 'ghost' ? 'ghost-tint' : 'wolf-tint';
  }
  setCrosshair(on) { this.crosshair.hidden = !on; }
}

export { ROLE_ART };
