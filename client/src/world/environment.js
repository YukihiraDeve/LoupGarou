// Time of day -> sky, sun/moon light (one shadow caster), hemisphere, fog, exposure, emissive
// materials (EMIT_*) and lantern lights.
import * as THREE from 'three';
import { Sky } from './sky.js';
import { clamp, lerp, smoothstep, damp, DEG, wobble } from '../util/math.js';

// Keyframes by sun elevation (degrees). "set" = evening (orange/red), "rise" = dawn (pink).
const RAW_SET = [
  { e: -22, zenith: '#03060f', horizon: '#0a1229', ground: '#03050a', glow: '#0a0e22', fog: '#081020', sun: '#000000', sunI: 0, hemiSky: '#4d64a8', hemiGround: '#2a1d14', hemiI: 1.1, exposure: 1.18 },
  { e: -11, zenith: '#081030', horizon: '#232c55', ground: '#05070d', glow: '#352a55', fog: '#141b36', sun: '#000000', sunI: 0, hemiSky: '#5566a8', hemiGround: '#2a1d14', hemiI: 1.05, exposure: 1.15 },
  { e: -4, zenith: '#1a2250', horizon: '#7a3c5a', ground: '#0c0a12', glow: '#c84c38', fog: '#3a2a44', sun: '#ff5a30', sunI: 0, hemiSky: '#6a5a98', hemiGround: '#3a2418', hemiI: 0.95, exposure: 1.1 },
  { e: 0, zenith: '#2a3a7c', horizon: '#e45e36', ground: '#1a1210', glow: '#ff5a26', fog: '#7a4846', sun: '#ff6a32', sunI: 0.8, hemiSky: '#8a7aa8', hemiGround: '#4a2e1c', hemiI: 0.85, exposure: 1.05 },
  { e: 4, zenith: '#3a5a9c', horizon: '#f59a52', ground: '#2a1e18', glow: '#ff9846', fog: '#b07e66', sun: '#ff8a46', sunI: 1.9, hemiSky: '#a8a8c8', hemiGround: '#5a3c26', hemiI: 0.8, exposure: 1.0 },
  { e: 10, zenith: '#4a7ac2', horizon: '#f4c892', ground: '#3a2c22', glow: '#ffc888', fog: '#c8b8a6', sun: '#ffbe80', sunI: 2.6, hemiSky: '#b8c8e8', hemiGround: '#6a4c32', hemiI: 0.85, exposure: 0.95 },
  { e: 20, zenith: '#3f80d2', horizon: '#bcd8ee', ground: '#4a3a2c', glow: '#fff0d0', fog: '#b9cde0', sun: '#ffe6c8', sunI: 3.0, hemiSky: '#c8daf2', hemiGround: '#6e5236', hemiI: 0.95, exposure: 0.92 },
  { e: 40, zenith: '#2e6ccc', horizon: '#a6cdee', ground: '#4a3a2c', glow: '#ffffff', fog: '#b0c8e0', sun: '#fff6ea', sunI: 3.3, hemiSky: '#d0e2f8', hemiGround: '#74583a', hemiI: 1.0, exposure: 0.9 },
];
const RISE_OVERRIDES = {
  '-11': { horizon: '#2a2c5a', glow: '#4a2c5a' },
  '-4': { horizon: '#a05a84', glow: '#e07a8a', fog: '#5a3a5a', hemiSky: '#8a6aa8' },
  0: { horizon: '#f08a86', glow: '#ff9a8a', fog: '#a06a72', sun: '#ff9a7a' },
  4: { horizon: '#ffb48e', glow: '#ffc0a0', fog: '#c09080', sun: '#ffb08a' },
};

const COLOR_KEYS = ['zenith', 'horizon', 'ground', 'glow', 'fog', 'sun', 'hemiSky', 'hemiGround'];
const NUM_KEYS = ['sunI', 'hemiI', 'exposure'];
function build(overrides) {
  return RAW_SET.map((k) => {
    const o = { ...k, ...(overrides?.[k.e] || {}) };
    const out = { e: o.e };
    for (const c of COLOR_KEYS) out[c] = new THREE.Color(o[c]);
    for (const n of NUM_KEYS) out[n] = o[n];
    return out;
  });
}
const KEYS_SET = build(null);
const KEYS_RISE = build(RISE_OVERRIDES);

const _c1 = new THREE.Color();
const _c2 = new THREE.Color();
function sample(keys, e, name, out) {
  if (e <= keys[0].e) return out.copy(keys[0][name]);
  for (let i = 1; i < keys.length; i++) {
    if (e <= keys[i].e) {
      const t = (e - keys[i - 1].e) / (keys[i].e - keys[i - 1].e);
      return out.copy(keys[i - 1][name]).lerp(keys[i][name], t);
    }
  }
  return out.copy(keys[keys.length - 1][name]);
}
function sampleNum(keys, e, name) {
  if (e <= keys[0].e) return keys[0][name];
  for (let i = 1; i < keys.length; i++) {
    if (e <= keys[i].e) {
      const t = (e - keys[i - 1].e) / (keys[i].e - keys[i - 1].e);
      return lerp(keys[i - 1][name], keys[i][name], t);
    }
  }
  return keys[keys.length - 1][name];
}

export class Environment {
  constructor(scene, renderer, quality) {
    this.scene = scene;
    this.renderer = renderer;
    this.quality = quality;
    this.sky = new Sky();
    scene.add(this.sky.mesh);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x443322, 1);
    this.light = new THREE.DirectionalLight(0xffffff, 2);
    this.light.name = 'sun';
    this.light.shadow.bias = -0.0005;
    this.light.shadow.normalBias = 0.03;
    const sc = this.light.shadow.camera;
    sc.left = -17; sc.right = 17; sc.top = 17; sc.bottom = -17; sc.near = 1; sc.far = 90;
    scene.add(this.hemi, this.light, this.light.target);

    this.fog = new THREE.Fog(0x000000, 12, 90);
    scene.fog = this.fog;

    this.center = new THREE.Vector3(); // fire position
    this.southAngle = 0; // world yaw of the sun's noon direction
    this.elevation = 4; // displayed (smoothed) elevation in degrees
    this.course = 0.88;
    this.rising = 0; // 0 = evening palette, 1 = dawn palette
    this.night = 0; // 0 day .. 1 full night (emissives, crickets, fireflies)
    this.day = 1;
    this.sunDir = new THREE.Vector3();
    this.moonDir = new THREE.Vector3();
    this.emissives = []; // { material, base }
    this.lanterns = []; // { light, base, seed }
    this.lanternMarkers = [];
    this.applyQuality(quality.tier);
  }

  /** Orientation: the sunset (course 1) is placed behind the camp as seen from cam_intro. */
  setOrientation(center, introForward) {
    this.center.copy(center);
    const west = Math.atan2(introForward.x, introForward.z);
    // course 1 -> azimuth +110° from south: the sunset glows ~50° left of the intro view direction,
    // so the camp gets warm side light while the sky glow stays in frame
    this.southAngle = west - 110 * DEG + 50 * DEG;
    const moonAz = this.southAngle - 150 * DEG;
    const me = 26 * DEG;
    this.moonDir.set(Math.sin(moonAz) * Math.cos(me), Math.sin(me), Math.cos(moonAz) * Math.cos(me));
  }

  registerEmissives(root) {
    root.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (!m || !m.name?.startsWith('EMIT_') || this.emissives.some((e) => e.material === m)) continue;
        if (m.emissive && m.emissive.getHex() === 0) m.emissive.copy(m.color || new THREE.Color(1, 0.7, 0.4));
        // EMIT_* intensities are the night values; by day ~6 % (embers keep ~40 %)
        this.emissives.push({ material: m, base: Math.max(m.emissiveIntensity ?? 1, 1), dayFactor: /embers/i.test(m.name) ? 0.4 : 0.06 });
      }
    });
  }

  /** Lantern / window / string-light markers (Vector3 list, best first). */
  setLanternMarkers(markers) {
    this.lanternMarkers = markers;
    this.rebuildLanterns();
  }

  /** Light the markers nearest to this point first (the player's seat). */
  setFocus(position) {
    if (this.focus && this.focus.distanceToSquared(position) < 0.01) return;
    this.focus = position.clone();
    const byDist = (a, b) => a.position.distanceToSquared(position) - b.position.distanceToSquared(position);
    // nearest lanterns/strings first, but keep one window for the warm glow of the chalets
    const near = this.lanternMarkers.filter((m) => m.kind !== 'window').sort(byDist);
    const windows = this.lanternMarkers.filter((m) => m.kind === 'window').sort(byDist);
    this.lanternMarkers = [...near.slice(0, 2), ...windows.slice(0, 1), ...near.slice(2), ...windows.slice(1)];
    this.rebuildLanterns();
  }

  rebuildLanterns() {
    for (const l of this.lanterns) {
      this.scene.remove(l.light);
      l.light.dispose();
    }
    this.lanterns = [];
    const count = Math.max(0, this.quality.tier.pointLights - 1); // the fire takes one
    for (let i = 0; i < Math.min(count, this.lanternMarkers.length); i++) {
      const m = this.lanternMarkers[i];
      const light = new THREE.PointLight(m.color ?? 0xffb060, 0, m.distance ?? 9, 2);
      light.position.copy(m.position);
      light.castShadow = false;
      this.scene.add(light);
      this.lanterns.push({ light, base: m.intensity ?? 4, seed: i * 1.7 });
    }
  }

  applyQuality(tier) {
    const shadows = tier.shadows;
    this.renderer.shadowMap.enabled = shadows;
    this.light.castShadow = shadows;
    if (shadows) {
      this.light.shadow.mapSize.set(tier.shadowSize, tier.shadowSize);
      this.light.shadow.radius = tier.name === 'high' ? 3 : 1.5;
      if (this.light.shadow.map) {
        this.light.shadow.map.dispose();
        this.light.shadow.map = null;
      }
    }
    if (this.lanternMarkers.length) this.rebuildLanterns();
    this.scene.traverse((o) => {
      if (o.material) for (const m of [o.material].flat()) m.needsUpdate = true;
    });
  }

  /**
   * @param target {elevation, course} from SunClock
   * @param dt seconds, @param time seconds since start
   */
  update(target, dt, time, camera, snap = false) {
    const lambda = snap ? 1000 : 1.6;
    this.elevation = damp(this.elevation, target.elevation, lambda, dt);
    this.course = damp(this.course, target.course, lambda, dt);
    this.rising = damp(this.rising, target.course < 0.5 ? 1 : 0, snap ? 1000 : 0.8, dt);
    const e = this.elevation;

    // sun direction
    const az = this.southAngle + lerp(-110, 110, this.course) * DEG;
    const el = e * DEG;
    this.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));

    // palettes
    const u = this.sky.uniforms;
    const r = this.rising;
    const mix = (name, out) => {
      sample(KEYS_SET, e, name, _c1);
      sample(KEYS_RISE, e, name, _c2);
      return out.copy(_c1).lerp(_c2, r);
    };
    mix('zenith', u.uZenith.value);
    mix('horizon', u.uHorizon.value);
    mix('ground', u.uGround.value);
    mix('glow', u.uGlow.value);
    mix('sun', u.uSunColor.value);
    u.uSunDir.value.copy(this.sunDir);
    u.uMoonDir.value.copy(this.moonDir);
    this.night = 1 - smoothstep(-9, 5, e);
    this.day = smoothstep(-2, 12, e);
    u.uStars.value = 1 - smoothstep(-12, -2, e);
    u.uMoon.value = 1 - smoothstep(-2, 14, e);
    u.uSunDisc.value = smoothstep(-1.5, 0.5, e);
    u.uTime.value = time;
    this.sky.follow(camera);

    // fog
    mix('fog', this.fog.color);
    // far silhouettes (tree line ~66 m, mountains 250-400 m) stay readable by day, fade at night
    this.fog.near = lerp(14, 40, this.day);
    this.fog.far = lerp(170, 560, this.day);

    // hemisphere
    mix('hemiSky', this.hemi.color);
    mix('hemiGround', this.hemi.groundColor);
    this.hemi.intensity = sampleNum(KEYS_SET, e, 'hemiI');

    // single directional light: the sun, or the moon when the sun is down
    const sunI = sampleNum(KEYS_SET, e, 'sunI');
    const moonW = 1 - smoothstep(-7, -2, e);
    const L = this.light;
    if (sunI > 0.01 || moonW < 0.01) {
      L.color.copy(u.uSunColor.value);
      L.intensity = sunI;
      L.position.copy(this.sunDir).multiplyScalar(45).add(this.center);
    } else {
      L.color.setRGB(0.55, 0.66, 1.0);
      L.intensity = 0.55 * moonW;
      L.position.copy(this.moonDir).multiplyScalar(45).add(this.center);
    }
    L.target.position.copy(this.center);

    this.renderer.toneMappingExposure = sampleNum(KEYS_SET, e, 'exposure');

    // emissive materials and lanterns rise with the night
    for (const em of this.emissives) em.material.emissiveIntensity = em.base * lerp(em.dayFactor, 1, this.night);
    for (const l of this.lanterns) {
      l.light.intensity = l.base * this.night * (0.92 + 0.08 * wobble(time * 2.2, l.seed));
    }
  }
}
