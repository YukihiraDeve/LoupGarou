// Role visuals shared by the HUD (HTML cards) and the 3D cards (canvas textures).
import { ROLES } from '@shared/protocol.js';
import { ROLE_INFO } from '@shared/roles.js';

export const ROLE_ART = {
  [ROLES.VILLAGEOIS]: { icon: '🧑‍🌾', color: '#7a8a4a', glow: '#c8d890' },
  [ROLES.LOUP]: { icon: '🐺', color: '#a8322a', glow: '#ff6a4a' },
  [ROLES.VOYANTE]: { icon: '🔮', color: '#6a4aa8', glow: '#b89aff' },
  [ROLES.SORCIERE]: { icon: '🧪', color: '#3f8a5a', glow: '#8affb0' },
  [ROLES.CHASSEUR]: { icon: '🎯', color: '#8a5a2a', glow: '#ffb060' },
  [ROLES.CUPIDON]: { icon: '💘', color: '#c8507a', glow: '#ff9ac0' },
  [ROLES.PETITE_FILLE]: { icon: '👧', color: '#c87a32', glow: '#ffc080' },
};
export const roleName = (r) => ROLE_INFO[r]?.name || 'Inconnu';
export const roleIcon = (r) => ROLE_ART[r]?.icon || '❔';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Card face (role) or back (role = null) as a canvas, 256x384. */
export function cardCanvas(role) {
  const W = 256;
  const H = 384;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  const art = ROLE_ART[role];
  roundRect(ctx, 4, 4, W - 8, H - 8, 22);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  if (art) {
    g.addColorStop(0, '#2a1a12');
    g.addColorStop(0.5, art.color);
    g.addColorStop(1, '#1a100a');
  } else {
    g.addColorStop(0, '#3a2016');
    g.addColorStop(1, '#170d08');
  }
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#d9b26a';
  ctx.stroke();
  roundRect(ctx, 16, 16, W - 32, H - 32, 14);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(217,178,106,0.7)';
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (art) {
    const rg = ctx.createRadialGradient(W / 2, 165, 10, W / 2, 165, 95);
    rg.addColorStop(0, art.glow + 'aa');
    rg.addColorStop(1, art.glow + '00');
    ctx.fillStyle = rg;
    ctx.fillRect(0, 60, W, 220);
    ctx.font = '112px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    ctx.fillText(art.icon, W / 2, 168);
    ctx.fillStyle = '#f6e7c8';
    ctx.font = '600 30px Grenze, Georgia, serif';
    const name = roleName(role);
    const words = name.split(' ');
    if (ctx.measureText(name).width > W - 40 && words.length > 1) {
      ctx.fillText(words.slice(0, -1).join(' '), W / 2, 296);
      ctx.fillText(words[words.length - 1], W / 2, 330);
    } else ctx.fillText(name, W / 2, 312);
  } else {
    // back: moon and wolf silhouette
    ctx.fillStyle = 'rgba(217,178,106,0.9)';
    ctx.beginPath();
    ctx.arc(W / 2, 170, 62, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2a170f';
    ctx.beginPath();
    ctx.arc(W / 2 + 26, 156, 56, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#d9b26a';
    ctx.font = '600 26px Grenze, Georgia, serif';
    ctx.fillText('Loup-Garou', W / 2, 286);
    ctx.font = '20px Grenze, Georgia, serif';
    ctx.fillText('de Thiercelieux', W / 2, 316);
  }
  return c;
}

export const LOGO_SVG = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
<circle cx="50" cy="50" r="47" fill="#140a08"/>
<path d="M50 4a46 46 0 1 1-32.5 13.5c6 3 9 2 13-2-9 1-13 7-15 12-2-8 4-17 12-21 9-4 15-2 22-2z" fill="#a81e1e"/>
<path d="M50 9a41 41 0 1 1-29 12c5 2 8 1 11-2-7 1-10 5-12 9-1-6 4-13 10-16 8-4 13-3 20-3z" fill="#e0452e" opacity="0.75"/>
<path d="M18 72c8-6 18-6 22-12l-5-9 9 3 4-14 3 9 9-12 1 12 9-4-3 10c6 4 12 12 13 19-12-3-22 1-31 1s-21-1-31-3z" fill="#f2e6d0"/>
<path d="M28 66c6-2 11-6 14-11m21 6c-3-3-6-7-7-12" stroke="#140a08" stroke-width="2" fill="none"/>
<circle cx="47" cy="57" r="2.4" fill="#140a08"/><circle cx="59" cy="56" r="2.4" fill="#140a08"/>
<path d="M50 66l3 3 3-3" stroke="#140a08" stroke-width="2" fill="none"/>
</svg>`;
