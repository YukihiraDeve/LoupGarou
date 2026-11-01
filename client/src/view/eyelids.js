// Eyelids: full-screen animated mask (top and bottom lids, soft lashes, vignette). Heavy closing at
// nightfall, fluttering wake-up, trembling slit for the petite fille, blink.
import { clamp, damp, wobble } from '../util/math.js';

const SEQ = {
  close: [[0.55, 0.7], [0.72, 0.35], [0.25, 0.5], [0.4, 0.3], [0, 0.8]],
  open: [[0.3, 0.35], [0.12, 0.25], [0.55, 0.35], [0.4, 0.2], [1, 0.7]],
  blink: [[0, 0.09], [1, 0.16]],
  snap: [[0, 0.25]],
};

export class Eyelids {
  constructor(parent, canvas) {
    this.canvas = canvas;
    this.el = document.createElement('div');
    this.el.id = 'lids';
    this.el.innerHTML = '<div class="lid top"></div><div class="lid bottom"></div><div class="lid-vignette"></div>';
    parent.appendChild(this.el);
    this.top = this.el.querySelector('.top');
    this.bottom = this.el.querySelector('.bottom');
    this.vignette = this.el.querySelector('.lid-vignette');
    this.open = 1; // 1 = fully open, 0 = closed
    this.seq = null;
    this.peek = false;
    this.peekAmount = 0;
    this.base = 1; // resting openness when no sequence runs
    this.time = 0;
    this.last = { open: -1, blur: -1, vig: -1 };
    this.dread = 0; // night vignette strength
  }

  get closed() { return this.open < 0.03; }
  get isOpen() { return this.open > 0.97; }

  play(name, base) {
    this.seq = { frames: SEQ[name], i: 0, t: 0, from: this.open };
    this.base = base;
  }
  close() { if (this.base !== 0 || this.seq?.frames !== SEQ.close) this.play('close', 0); }
  wake() { if (this.base !== 1) this.play('open', 1); }
  blink() { if (!this.seq && this.base === 1) this.play('blink', 1); }
  setClosedInstant(closed) {
    this.seq = null;
    this.base = closed ? 0 : 1;
    this.open = this.base;
  }
  setPeek(on) { this.peek = on; }

  update(dt) {
    this.time += dt;
    let target = this.base;
    if (this.seq) {
      const s = this.seq;
      const [to, dur] = s.frames[s.i];
      s.t += dt;
      const k = clamp(s.t / dur, 0, 1);
      const e = k * k * (3 - 2 * k);
      this.open = s.from + (to - s.from) * e;
      if (k >= 1) {
        s.i++;
        s.t = 0;
        s.from = this.open;
        if (s.i >= s.frames.length) this.seq = null;
      }
    } else {
      // petite fille: a trembling slit while the button is held
      this.peekAmount = damp(this.peekAmount, this.peek ? 1 : 0, this.peek ? 5 : 9, dt);
      if (this.base === 0 && this.peekAmount > 0.001) {
        target = this.peekAmount * (0.2 + wobble(this.time * 7, 2) * 0.03 + Math.sin(this.time * 31) * 0.008);
      }
      this.open = damp(this.open, target, 10, dt);
    }
    this.render();
  }

  render() {
    const o = clamp(this.open, 0, 1);
    if (Math.abs(o - this.last.open) > 0.0005) {
      this.last.open = o;
      const hidden = o > 0.995;
      this.el.style.display = hidden && this.dread < 0.01 ? 'none' : '';
      // closed: each lid covers 52% of the screen; open: pushed out
      const shift = o * 62;
      this.top.style.transform = `translate3d(0, ${-shift}vh, 0)`;
      this.bottom.style.transform = `translate3d(0, ${shift}vh, 0)`;
      const blur = this.peekAmount > 0.05 ? 1.6 * this.peekAmount : o < 0.6 && o > 0.02 ? (0.6 - o) * 3 : 0;
      if (Math.abs(blur - this.last.blur) > 0.05) {
        this.last.blur = blur;
        this.canvas.style.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : '';
      }
    }
    const vig = clamp(Math.max(this.dread, 1 - this.open, this.peekAmount), 0, 1);
    if (Math.abs(vig - this.last.vig) > 0.01) {
      this.last.vig = vig;
      this.vignette.style.opacity = String(vig);
      if (this.open > 0.995) this.el.style.display = vig < 0.01 ? 'none' : '';
    }
  }
}
