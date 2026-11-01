// Discreet HTML name tags above the avatars (projected every frame, DOM touched only on change).
import * as THREE from 'three';
import { h, setText } from './dom.js';

const _v = new THREE.Vector3();

export class Labels {
  constructor(container, camera) {
    this.container = container;
    this.camera = camera;
    this.entries = new Map();
  }

  ensure(id) {
    let e = this.entries.get(id);
    if (!e) {
      const ico = h('span', { class: 'ico' });
      const name = h('span', { class: 'nm' });
      const vc = h('span', { class: 'vc', hidden: true });
      const el = h('div', { class: 'nametag' }, ico, name, vc);
      this.container.appendChild(el);
      e = { el, ico, name, vc, cls: '', visible: true, x: -1, y: -1 };
      this.entries.set(id, e);
    }
    return e;
  }

  remove(id) {
    const e = this.entries.get(id);
    if (e) {
      e.el.remove();
      this.entries.delete(id);
    }
  }

  set(id, { name, icons = '', votes = 0, cls = '' }) {
    const e = this.ensure(id);
    setText(e.name, name);
    setText(e.ico, icons);
    if (votes > 0) {
      e.vc.hidden = false;
      setText(e.vc, String(votes));
    } else e.vc.hidden = true;
    const c = `nametag ${cls}`;
    if (e.cls !== c) {
      e.cls = c;
      e.el.className = c;
    }
  }

  update(avatars, visibleFn) {
    const w = this.container.clientWidth;
    const hgt = this.container.clientHeight;
    for (const [id, e] of this.entries) {
      const a = avatars.get(id);
      let show = !!a && (!visibleFn || visibleFn(id));
      if (show) {
        _v.copy(a.headAnchor);
        _v.y += a.ghost ? -0.15 : 0.36;
        _v.project(this.camera);
        show = _v.z < 1 && _v.z > -1 && Math.abs(_v.x) < 1.15 && Math.abs(_v.y) < 1.15;
        if (show) {
          const x = Math.round(((_v.x + 1) / 2) * w);
          const y = Math.round(((1 - _v.y) / 2) * hgt);
          if (x !== e.x || y !== e.y) {
            e.x = x;
            e.y = y;
            e.el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -100%)`;
          }
        }
      }
      if (show !== e.visible) {
        e.visible = show;
        e.el.style.display = show ? '' : 'none';
      }
    }
  }
}
