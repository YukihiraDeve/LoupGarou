// Tiny DOM helpers.
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
export const $ = (sel, root = document) => root.querySelector(sel);

/** Set textContent only when it changed (avoids layout work every frame). */
export function setText(el, text) {
  if (el && el.textContent !== text) el.textContent = text;
}

const PLAYER_COLORS = ['#ff9a6a', '#ffd36a', '#9adf7a', '#6ad4ff', '#c99aff', '#ff8ac0', '#7affd8', '#ffb86a', '#a0b4ff', '#ffef9a', '#ff7a7a', '#8affa0', '#d4b48a', '#9ae0ff', '#f0a0ff', '#c0ff7a'];
export function playerColor(seat) {
  return PLAYER_COLORS[(seat ?? 0) % PLAYER_COLORS.length];
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
