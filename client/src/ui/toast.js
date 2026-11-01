import { h } from './dom.js';

const root = () => document.getElementById('toasts');
export function toast(text, kind = '', ms = 3200) {
  const el = h('div', { class: `toast ${kind}` }, text);
  root().appendChild(el);
  while (root().children.length > 4) root().firstChild.remove();
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 450);
  }, ms);
  return el;
}

export function bigAlert(text, parent = document.getElementById('overlay')) {
  const el = h('div', { class: 'big-alert' }, text);
  parent.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

export function flashRed(parent = document.getElementById('overlay')) {
  const el = h('div', { class: 'flash-red' });
  parent.appendChild(el);
  setTimeout(() => el.remove(), 1500);
}
