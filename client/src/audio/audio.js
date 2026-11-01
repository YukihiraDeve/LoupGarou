// Procedural WebAudio ambience: crackling fire, wind, crickets (night), birds (day), owl, wolf howls,
// heartbeat, discreet UI sounds; French narrator with speechSynthesis. Unlocked on the first gesture.
import { settings, onSetting } from '../config.js';
import { clamp } from '../util/math.js';

function noiseBuffer(ctx, seconds = 2, brown = false) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    } else d[i] = w;
  }
  return buf;
}

function cricketBuffer(ctx, rate) {
  const seconds = 2.4;
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  const f = 4300 + Math.random() * 600;
  for (let i = 0; i < len; i++) {
    const t = i / ctx.sampleRate;
    const chirp = t % (1 / rate); // chirp groups
    const inGroup = (t % 1.2) < 0.55;
    const pulse = chirp < 0.018 ? Math.sin((chirp / 0.018) * Math.PI) : 0;
    d[i] = inGroup ? Math.sin(2 * Math.PI * f * t) * pulse * 0.5 : 0;
  }
  return buf;
}

function impulse(ctx, seconds = 2.8, decay = 2.5) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.started = false;
    this.night = 0;
    this.day = 1;
    this.firePan = 0;
    this.nextCrackle = 0;
    this.nextBird = 3;
    this.nextOwl = 15;
    this.time = 0;
    this.heartbeat = false;
    this.nextBeat = 0;
    const unlock = () => this.start();
    window.addEventListener('pointerdown', unlock, { once: false, passive: true });
    window.addEventListener('keydown', unlock, { once: false });
    onSetting((k) => {
      if (k === 'volume' || k === 'ambience') this.applyVolumes();
    });
  }

  start() {
    if (this.started) {
      if (this.ctx?.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.started = true;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.ambience = ctx.createGain();
    this.ambience.connect(this.master);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = impulse(ctx);
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.5;
    this.reverb.connect(this.reverbGain).connect(this.master);
    this.white = noiseBuffer(ctx, 2);
    this.brown = noiseBuffer(ctx, 4, true);

    // fire bed: brown noise rumble, stereo-panned with the head direction
    this.firePanner = ctx.createStereoPanner();
    this.fireGain = ctx.createGain();
    this.fireGain.gain.value = 0.32;
    this.fireGain.connect(this.firePanner).connect(this.ambience);
    const bed = ctx.createBufferSource();
    bed.buffer = this.brown;
    bed.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    bed.connect(lp).connect(this.fireGain);
    bed.start();

    // wind
    const wind = ctx.createBufferSource();
    wind.buffer = this.white;
    wind.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 400;
    this.windFilter.Q.value = 0.7;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.035;
    wind.connect(this.windFilter).connect(this.windGain).connect(this.ambience);
    wind.start();

    // crickets
    this.cricketGain = ctx.createGain();
    this.cricketGain.gain.value = 0;
    this.cricketGain.connect(this.ambience);
    for (let i = 0; i < 3; i++) {
      const src = ctx.createBufferSource();
      src.buffer = cricketBuffer(ctx, 14 + i * 4);
      src.loop = true;
      src.playbackRate.value = 0.94 + i * 0.05;
      const pan = ctx.createStereoPanner();
      pan.pan.value = [-0.7, 0.6, 0.1][i];
      const g = ctx.createGain();
      g.gain.value = [0.05, 0.035, 0.025][i];
      src.connect(g).connect(pan).connect(this.cricketGain);
      src.start(ctx.currentTime + i * 0.37);
    }
    this.applyVolumes();
  }

  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(clamp(settings.volume, 0, 1), t, 0.1);
    this.ambience.gain.setTargetAtTime(clamp(settings.ambience, 0, 1), t, 0.1);
  }

  /** Called every frame with the environment (night 0..1) and the head yaw relative to the fire. */
  update(dt, env, fireYaw = 0) {
    this.time += dt;
    if (!this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    this.night = env.night;
    this.day = env.day;
    this.firePanner.pan.setTargetAtTime(clamp(-Math.sin(fireYaw) * 0.8, -0.8, 0.8), t, 0.15);
    this.cricketGain.gain.setTargetAtTime(this.night * 0.9, t, 0.8);
    this.windFilter.frequency.setTargetAtTime(330 + Math.sin(this.time * 0.13) * 140 + Math.sin(this.time * 0.37) * 60, t, 0.5);
    this.windGain.gain.setTargetAtTime(0.03 + 0.025 * (0.5 + 0.5 * Math.sin(this.time * 0.09)), t, 0.5);
    // crackles
    this.nextCrackle -= dt;
    if (this.nextCrackle <= 0) {
      this.crackle(Math.random() < 0.08 ? 2.2 : 0.6 + Math.random() * 0.7);
      this.nextCrackle = 0.05 + Math.random() * Math.random() * 0.45;
    }
    // birds by day, owl by night
    this.nextBird -= dt;
    if (this.nextBird <= 0) {
      if (this.day > 0.4) this.bird();
      this.nextBird = 1.5 + Math.random() * 5;
    }
    this.nextOwl -= dt;
    if (this.nextOwl <= 0) {
      if (this.night > 0.7) this.owl();
      this.nextOwl = 22 + Math.random() * 30;
    }
    if (this.heartbeat) {
      this.nextBeat -= dt;
      if (this.nextBeat <= 0) {
        this.beat();
        this.nextBeat = 0.62;
      }
    }
  }

  env(gain, attack, hold, release, t0 = this.ctx.currentTime) {
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(1, t0 + attack);
    gain.gain.setValueAtTime(1, t0 + attack + hold);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + hold + release);
    return t0 + attack + hold + release;
  }

  crackle(strength) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900 + Math.random() * 3800;
    bp.Q.value = 0.8 + Math.random() * 2;
    const g = ctx.createGain();
    const out = ctx.createGain();
    out.gain.value = 0.09 * strength;
    src.connect(bp).connect(g).connect(out).connect(this.firePanner);
    const t0 = ctx.currentTime;
    const end = this.env(g, 0.001, 0.002, 0.012 + Math.random() * 0.05 * strength, t0);
    src.start(t0, Math.random() * 1.5);
    src.stop(end + 0.02);
  }

  bird() {
    const ctx = this.ctx;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    const out = ctx.createGain();
    out.gain.value = 0.035 * this.day;
    out.connect(pan).connect(this.ambience);
    const notes = 2 + Math.floor(Math.random() * 4);
    let t0 = ctx.currentTime;
    const base = 2600 + Math.random() * 1800;
    for (let i = 0; i < notes; i++) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      const g = ctx.createGain();
      o.connect(g).connect(out);
      const f = base * (0.85 + Math.random() * 0.4);
      o.frequency.setValueAtTime(f, t0);
      o.frequency.exponentialRampToValueAtTime(f * (Math.random() < 0.5 ? 1.4 : 0.7), t0 + 0.08);
      const end = this.env(g, 0.005, 0.04, 0.06, t0);
      o.start(t0);
      o.stop(end + 0.02);
      t0 = end + 0.03 + Math.random() * 0.06;
    }
  }

  owl() {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0.07 * this.night;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.4 - 0.7;
    out.connect(pan).connect(this.ambience);
    out.connect(this.reverb);
    let t0 = ctx.currentTime + 0.05;
    for (const [dur, f] of [[0.35, 390], [0.15, 360], [0.6, 375]]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 6;
      const lg = ctx.createGain();
      lg.gain.value = 6;
      lfo.connect(lg).connect(o.frequency);
      const g = ctx.createGain();
      o.connect(g).connect(out);
      const end = this.env(g, 0.06, dur * 0.6, dur * 0.4, t0);
      o.start(t0);
      lfo.start(t0);
      o.stop(end + 0.05);
      lfo.stop(end + 0.05);
      t0 = end + 0.12;
    }
  }

  /** Wolf pack howl (wolves wake up). */
  howl(count = 2) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    for (let k = 0; k < count; k++) {
      const t0 = ctx.currentTime + 0.1 + k * (0.9 + Math.random() * 0.8);
      const pan = ctx.createStereoPanner();
      pan.pan.value = Math.random() * 1.6 - 0.8;
      const out = ctx.createGain();
      out.gain.value = 0.11;
      out.connect(pan).connect(this.sfx);
      out.connect(this.reverb);
      const f0 = 260 + Math.random() * 90;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      const o2 = ctx.createOscillator();
      o2.type = 'sine';
      for (const osc of [o, o2]) {
        osc.frequency.setValueAtTime(f0, t0);
        osc.frequency.exponentialRampToValueAtTime(f0 * 1.85, t0 + 0.7);
        osc.frequency.setValueAtTime(f0 * 1.85, t0 + 2.0);
        osc.frequency.exponentialRampToValueAtTime(f0 * 1.3, t0 + 3.1);
      }
      const vib = ctx.createOscillator();
      vib.frequency.value = 5.2;
      const vg = ctx.createGain();
      vg.gain.value = 7;
      vib.connect(vg);
      vg.connect(o.frequency);
      vg.connect(o2.frequency);
      const formant = ctx.createBiquadFilter();
      formant.type = 'bandpass';
      formant.frequency.value = 900;
      formant.Q.value = 1.6;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1800;
      const mixA = ctx.createGain();
      mixA.gain.value = 0.25;
      const mixB = ctx.createGain();
      mixB.gain.value = 0.8;
      const g = ctx.createGain();
      o.connect(formant).connect(mixA).connect(g);
      o2.connect(mixB).connect(g);
      g.connect(lp).connect(out);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(1, t0 + 0.5);
      g.gain.setValueAtTime(1, t0 + 2.2);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 3.4);
      for (const osc of [o, o2, vib]) {
        osc.start(t0);
        osc.stop(t0 + 3.5);
      }
    }
  }

  beat() {
    const ctx = this.ctx;
    for (const [dt, f] of [[0, 62], [0.17, 55]]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f * 1.6, ctx.currentTime + dt);
      o.frequency.exponentialRampToValueAtTime(f, ctx.currentTime + dt + 0.08);
      const g = ctx.createGain();
      o.connect(g).connect(this.sfx);
      g.gain.value = 0;
      const end = this.env(g, 0.01, 0.03, 0.14, ctx.currentTime + dt);
      g.gain.value = 0.35;
      o.start(ctx.currentTime + dt);
      o.stop(end + 0.02);
    }
  }

  /** UI and game sounds. */
  play(name) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const tone = (f, dur, type = 'sine', vol = 0.12, when = 0, glide = null, toReverb = false) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f, t0 + when);
      if (glide) o.frequency.exponentialRampToValueAtTime(glide, t0 + when + dur);
      const g = ctx.createGain();
      const out = ctx.createGain();
      out.gain.value = vol;
      o.connect(g).connect(out).connect(this.sfx);
      if (toReverb) out.connect(this.reverb);
      const end = this.env(g, 0.005, dur * 0.2, dur * 0.8, t0 + when);
      o.start(t0 + when);
      o.stop(end + 0.02);
    };
    const thump = (vol = 0.5, f = 70) => {
      tone(f * 2, 0.5, 'sine', vol, 0, f, true);
      const src = ctx.createBufferSource();
      src.buffer = this.white;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 600;
      const g = ctx.createGain();
      const out = ctx.createGain();
      out.gain.value = vol * 0.6;
      src.connect(lp).connect(g).connect(out).connect(this.sfx);
      const end = this.env(g, 0.002, 0.02, 0.3, t0);
      src.start(t0);
      src.stop(end);
    };
    switch (name) {
      case 'click': tone(880, 0.06, 'sine', 0.05); break;
      case 'hover': tone(1320, 0.04, 'sine', 0.02); break;
      case 'select': tone(660, 0.08, 'triangle', 0.07); tone(990, 0.1, 'triangle', 0.06, 0.06); break;
      case 'confirm': tone(784, 0.25, 'sine', 0.08, 0, null, true); tone(1175, 0.4, 'sine', 0.06, 0.08, null, true); break;
      case 'error': tone(220, 0.18, 'square', 0.04); tone(180, 0.22, 'square', 0.04, 0.12); break;
      case 'reveal': tone(392, 1.2, 'sine', 0.08, 0, null, true); tone(587, 1.2, 'sine', 0.06, 0.15, null, true); tone(784, 1.4, 'sine', 0.05, 0.3, null, true); break;
      case 'night': tone(330, 2.0, 'sine', 0.06, 0, 220, true); tone(247, 2.4, 'sine', 0.05, 0.2, 165, true); break;
      case 'dawn': tone(523, 1.4, 'sine', 0.05, 0, null, true); tone(659, 1.4, 'sine', 0.05, 0.25, null, true); tone(784, 1.8, 'sine', 0.05, 0.5, null, true); break;
      case 'death': thump(0.5, 55); tone(196, 2.2, 'sine', 0.07, 0.05, 98, true); break;
      case 'shot': thump(0.9, 90); break;
      case 'bell': tone(660, 2.5, 'sine', 0.08, 0, null, true); tone(1320, 1.5, 'sine', 0.03, 0, null, true); tone(495, 2.5, 'sine', 0.04, 0, null, true); break;
      case 'heart': tone(880, 0.3, 'sine', 0.05, 0, 1320, true); tone(1320, 0.4, 'sine', 0.04, 0.15, 1760, true); break;
      case 'magic': for (let i = 0; i < 6; i++) tone(1200 + i * 220, 0.3, 'sine', 0.03, i * 0.06, null, true); break;
      case 'gasp': tone(300, 0.4, 'sawtooth', 0.03, 0, 600); break;
      case 'chat': tone(1046, 0.05, 'sine', 0.025); break;
      case 'win': [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.9, 'triangle', 0.06, i * 0.14, null, true)); break;
      case 'lose': [392, 349, 311, 262].forEach((f, i) => tone(f, 1.0, 'sine', 0.06, i * 0.2, null, true)); break;
      default:
    }
  }
}

// ------------------------------------------------------------------------------------------------
export class Narrator {
  constructor() {
    this.voice = null;
    this.queue = [];
    this.available = 'speechSynthesis' in window;
    if (this.available) {
      const pickVoice = () => {
        const voices = speechSynthesis.getVoices().filter((v) => v.lang?.toLowerCase().startsWith('fr'));
        this.voice = voices.find((v) => /Thomas|Amélie|Audrey|Google|Daniel|Marie/i.test(v.name)) || voices[0] || null;
      };
      pickVoice();
      speechSynthesis.onvoiceschanged = pickVoice;
    }
  }
  say(text, { interrupt = false } = {}) {
    if (!this.available || !settings.narrator || !text) return;
    try {
      if (interrupt) speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'fr-FR';
      if (this.voice) u.voice = this.voice;
      u.rate = 0.95;
      u.pitch = 0.85;
      u.volume = clamp(settings.volume, 0, 1);
      speechSynthesis.speak(u);
    } catch { /* ignore */ }
  }
  stop() {
    if (this.available) speechSynthesis.cancel();
  }
}
