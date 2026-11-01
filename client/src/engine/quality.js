// Quality tiers: chosen from the device, then lowered automatically when the measured frame rate drops.
import { isMobile, settings, params } from '../config.js';

export const TIERS = {
  low: {
    name: 'low', label: 'Basse', dpr: 1.25, shadows: false, shadowSize: 512, pointLights: 2,
    embers: 60, smoke: 8, fireflies: 24, outlines: false, treeShadows: false, maxFlameLayers: 2,
  },
  medium: {
    name: 'medium', label: 'Moyenne', dpr: 1.5, shadows: true, shadowSize: 1024, pointLights: 4,
    embers: 140, smoke: 14, fireflies: 50, outlines: false, treeShadows: false, maxFlameLayers: 3,
  },
  high: {
    name: 'high', label: 'Haute', dpr: 2, shadows: true, shadowSize: 2048, pointLights: 7,
    embers: 260, smoke: 22, fireflies: 90, outlines: true, treeShadows: true, maxFlameLayers: 4,
  },
};
const ORDER = ['low', 'medium', 'high'];

function detectTier(renderer) {
  if (isMobile) {
    // recent iPhones / flagship Android handle "medium" at DPR 1.5
    const cores = navigator.hardwareConcurrency || 4;
    const mem = navigator.deviceMemory || 4;
    return cores >= 6 && mem >= 6 ? 'medium' : 'low';
  }
  let gpu = '';
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
  } catch { /* ignore */ }
  if (/Apple M\d|RTX|Radeon RX|Radeon Pro|GTX 1[06-9]|Arc/i.test(gpu)) return 'high';
  if (/Intel|UHD|Iris|Mali|Adreno|SwiftShader|llvmpipe/i.test(gpu)) return 'medium';
  return 'medium';
}

export class Quality {
  constructor(renderer) {
    this.renderer = renderer;
    this.listeners = new Set();
    this.auto = (params.quality || settings.quality) === 'auto';
    const forced = params.quality || (settings.quality !== 'auto' ? settings.quality : null);
    this.detected = detectTier(renderer);
    this.tier = TIERS[forced] || TIERS[this.detected];
    // FPS monitor
    this.acc = 0;
    this.frames = 0;
    this.warmup = 5; // seconds ignored after load / tier change (shader compilation)
    this.slowWindows = 0;
  }

  get dpr() {
    const cap = isMobile ? Math.min(1.5, this.tier.dpr) : this.tier.dpr;
    return Math.min(window.devicePixelRatio || 1, cap);
  }

  onChange(fn) { this.listeners.add(fn); }

  set(name, manual = true) {
    if (manual) this.auto = name === 'auto';
    const tier = name === 'auto' ? TIERS[this.detected] : TIERS[name];
    if (!tier || tier === this.tier) return;
    this.tier = tier;
    this.warmup = 4;
    this.slowWindows = 0;
    for (const fn of this.listeners) fn(tier);
  }

  /** Called every rendered frame with the real frame time (seconds). */
  sample(dt) {
    if (!this.auto) return;
    // background / throttled tabs and long pauses say nothing about the GPU
    if (document.hidden || dt > 0.2) return;
    if (this.warmup > 0) {
      this.warmup -= dt;
      return;
    }
    this.acc += Math.min(dt, 0.25);
    this.frames++;
    if (this.acc < 2.5) return;
    const fps = this.frames / this.acc;
    this.acc = 0;
    this.frames = 0;
    const threshold = this.tier.name === 'high' ? 50 : 40;
    this.slowWindows = fps < threshold ? this.slowWindows + 1 : 0;
    if (this.slowWindows >= 2) {
      const i = ORDER.indexOf(this.tier.name);
      if (i > 0) {
        console.info(`[qualité] ${fps.toFixed(0)} i/s : passage en ${ORDER[i - 1]}`);
        this.set(ORDER[i - 1], false);
      }
    }
  }
}
