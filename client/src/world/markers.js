// 3D markers above the avatars: voyante card flip, lovers' hearts, captain star, hunter reticle.
import * as THREE from 'three';
import { cardCanvas } from '../ui/roleArt.js';
import { easeOut, easeInOut, clamp } from '../util/math.js';

const texCache = new Map();
function cardTexture(role) {
  const key = role || '__back';
  if (!texCache.has(key)) {
    const t = new THREE.CanvasTexture(cardCanvas(role));
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    texCache.set(key, t);
  }
  return texCache.get(key);
}

function spriteTexture(draw, size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const heartTex = () => spriteTexture((ctx, s) => {
  const g = ctx.createRadialGradient(s / 2, s / 2, 4, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,120,170,0.55)');
  g.addColorStop(1, 'rgba(255,80,140,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  ctx.translate(s / 2, s / 2 + 6);
  ctx.scale(s / 140, s / 140);
  ctx.beginPath();
  ctx.moveTo(0, 30);
  ctx.bezierCurveTo(-60, -10, -30, -55, 0, -25);
  ctx.bezierCurveTo(30, -55, 60, -10, 0, 30);
  ctx.fillStyle = '#ff4f8a';
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#ffd0e0';
  ctx.stroke();
});
const starTex = () => spriteTexture((ctx, s) => {
  const g = ctx.createRadialGradient(s / 2, s / 2, 4, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,220,120,0.6)');
  g.addColorStop(1, 'rgba(255,200,80,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  ctx.translate(s / 2, s / 2);
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? s * 0.16 : s * 0.36;
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fillStyle = '#ffcf4a';
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#8a5a10';
  ctx.stroke();
});

export class Markers {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'markers';
    scene.add(this.group);
    this.cards = [];
    this.hearts = new Map();
    this.heartMat = new THREE.SpriteMaterial({ map: heartTex(), depthWrite: false, transparent: true, fog: false });
    this.starMat = new THREE.SpriteMaterial({ map: starTex(), depthWrite: false, transparent: true, fog: false });
    this.star = new THREE.Sprite(this.starMat);
    this.star.scale.setScalar(0.32);
    this.star.visible = false;
    this.star.renderOrder = 9;
    this.group.add(this.star);
    this.captain = null;
    this.cardGeo = new THREE.PlaneGeometry(0.56, 0.84);
  }

  /** Voyante: the inspected player's card rises above their head and flips. */
  showCard(avatar, role, duration = 7) {
    const g = new THREE.Group();
    const front = new THREE.Mesh(this.cardGeo, new THREE.MeshBasicMaterial({ map: cardTexture(role), transparent: true, fog: false, toneMapped: false }));
    const back = new THREE.Mesh(this.cardGeo, new THREE.MeshBasicMaterial({ map: cardTexture(null), transparent: true, fog: false, toneMapped: false }));
    back.rotation.y = Math.PI;
    g.add(front, back);
    g.renderOrder = 10;
    this.group.add(g);
    this.cards.push({ g, avatar, t: 0, duration, mats: [front.material, back.material] });
  }

  setLovers(ids, avatars) {
    for (const [id, s] of this.hearts) {
      if (!ids.includes(id)) {
        this.group.remove(s);
        this.hearts.delete(id);
      }
    }
    for (const id of ids) {
      if (this.hearts.has(id) || !avatars.get(id)) continue;
      const s = new THREE.Sprite(this.heartMat);
      s.scale.setScalar(0.26);
      s.renderOrder = 9;
      s.userData.burst = 1;
      this.group.add(s);
      this.hearts.set(id, s);
    }
  }

  setCaptain(id) { this.captain = id; }

  update(dt, time, camera, avatars, visibleFn) {
    for (let i = this.cards.length - 1; i >= 0; i--) {
      const c = this.cards[i];
      c.t += dt;
      const a = c.avatar;
      const rise = easeOut(clamp(c.t / 0.8, 0, 1));
      c.g.position.copy(a.headAnchor);
      c.g.position.y += 0.35 + rise * 0.45 + Math.sin(time * 2) * 0.02;
      // face the camera (yaw), then flip from back to front
      const yaw = Math.atan2(camera.position.x - c.g.position.x, camera.position.z - c.g.position.z);
      const flip = easeInOut(clamp((c.t - 0.7) / 0.9, 0, 1));
      c.g.rotation.set(0, yaw + Math.PI * (1 - flip), 0);
      const s = 0.6 + rise * 0.4;
      c.g.scale.setScalar(s);
      const fade = 1 - clamp((c.t - c.duration) / 0.8, 0, 1);
      for (const m of c.mats) m.opacity = fade;
      c.g.visible = visibleFn ? visibleFn(a.playerId) : true;
      if (fade <= 0) {
        this.group.remove(c.g);
        for (const m of c.mats) m.dispose();
        this.cards.splice(i, 1);
      }
    }
    for (const [id, s] of this.hearts) {
      const a = avatars.get(id);
      if (!a) continue;
      s.position.copy(a.headAnchor);
      s.position.y += 0.5 + Math.sin(time * 2.2 + a.seat?.index) * 0.04;
      const burst = s.userData.burst;
      s.userData.burst = Math.max(0, burst - dt * 0.6);
      s.scale.setScalar(0.22 * (1 + Math.sin(time * 6) * 0.06 + burst * 1.2));
      s.visible = (visibleFn ? visibleFn(id) : true) && !a.ghost && !a.isSelf;
    }
    const cap = this.captain && avatars.get(this.captain);
    this.star.visible = !!cap && !cap.ghost && !cap.isSelf && (visibleFn ? visibleFn(this.captain) : true);
    if (cap) {
      this.star.position.copy(cap.headAnchor);
      this.star.position.y += this.hearts.has(this.captain) ? 0.78 : 0.52;
      this.star.material.rotation = Math.sin(time * 0.8) * 0.25;
    }
  }
}
