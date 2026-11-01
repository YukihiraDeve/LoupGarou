// Camera: cam_intro overview (lobby, end), first-person seat view (drag / touch / gyroscope / keys),
// smooth transitions, breathing and micro-movements, ghost view after death.
import * as THREE from 'three';
import { clamp, damp, lerp, easeInOut, wobble } from '../util/math.js';
import { settings, onSetting, isTouch } from '../config.js';

const YAW_LIMIT = 1.6;
const PITCH_MIN = -0.9;
const PITCH_MAX = 0.7;
const REST_PITCH = -0.32;

const _q = new THREE.Quaternion();
const _qYaw = new THREE.Quaternion();
const _qPitch = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);
const RIGHT = new THREE.Vector3(1, 0, 0);
const BACK = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI); // camera looks down -Z, seats face +Z

export class CameraRig {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    this.mode = 'intro'; // intro | seat
    this.intro = null;
    this.seatAvatar = null;
    this.eyeLocal = new THREE.Vector3(0, 0.7, 0.1);
    this.yaw = 0;
    this.pitch = REST_PITCH;
    this.yawTarget = 0;
    this.pitchTarget = REST_PITCH;
    this.gyro = { enabled: false, alpha0: null, beta0: null, yaw: 0, pitch: 0, raw: null };
    this.lastInput = 0;
    this.transition = null; // { from: {pos, quat}, t, dur }
    this.ghost = 0;
    this.ghostTarget = 0;
    this.shake = 0;
    this.time = 0;
    this.fov = 62;
    this.locked = false; // e.g. peek: no head turning while eyes are almost closed
    this.onTap = null; // (ndcX, ndcY) => void
    this.onHover = null;
    this.keys = new Set();
    this.dragging = false;
    this.pointers = new Map();
    this.bindInput();
    onSetting((k, v) => { if (k === 'gyro') this.setGyro(v); });
  }

  setIntro(intro) {
    this.intro = intro;
    if (this.mode === 'intro' && !this.transition) this.applyIntro(0, true);
  }

  /** Switch to the first-person seat view of an avatar. */
  sitOn(avatar, eyeLocal, instant = false) {
    const changed = this.seatAvatar !== avatar || this.mode !== 'seat';
    this.seatAvatar = avatar;
    this.eyeLocal.copy(eyeLocal);
    if (!changed) return;
    if (!instant) this.beginTransition();
    this.mode = 'seat';
    this.yaw = this.yawTarget = 0;
    this.pitch = this.pitchTarget = REST_PITCH;
  }

  toIntro(instant = false) {
    if (this.mode === 'intro') return;
    if (!instant) this.beginTransition(3.2);
    this.mode = 'intro';
  }

  beginTransition(dur = 2.4) {
    this.transition = {
      pos: this.camera.position.clone(),
      quat: this.camera.quaternion.clone(),
      fov: this.camera.fov,
      t: 0,
      dur,
    };
  }

  setGhost(on) { this.ghostTarget = on ? 1 : 0; }
  impulse(amount = 0.4) { this.shake = Math.max(this.shake, amount); }

  // --- input ---------------------------------------------------------------------------------
  bindInput() {
    const el = this.dom;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture?.(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now(), moved: 0 });
    });
    el.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) {
        if (e.pointerType === 'mouse' && this.onHover) this.onHover(this.ndc(e));
        return;
      }
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      p.moved += Math.abs(dx) + Math.abs(dy);
      if (p.moved > 6 && this.mode === 'seat' && !this.locked) {
        const k = (settings.sensitivity || 1) * (e.pointerType === 'touch' ? 0.0062 : 0.0042) * (60 / this.camera.fov);
        this.yawTarget = clamp(this.yawTarget + dx * k, -YAW_LIMIT - 0.15, YAW_LIMIT + 0.15);
        this.pitchTarget = clamp(this.pitchTarget + dy * k, PITCH_MIN - 0.1, PITCH_MAX + 0.1);
        this.lastInput = this.time;
        this.dragging = true;
      }
      if (e.pointerType === 'mouse' && this.onHover) this.onHover(this.ndc(e));
    });
    const end = (e) => {
      const p = this.pointers.get(e.pointerId);
      this.pointers.delete(e.pointerId);
      if (!this.pointers.size) this.dragging = false;
      if (p && p.moved < 10 && performance.now() - p.t0 < 500 && this.onTap) this.onTap(this.ndc(e));
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', (e) => {
      this.pointers.delete(e.pointerId);
      this.dragging = false;
    });
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      this.keys.add(e.key);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key));
    window.addEventListener('blur', () => this.keys.clear());
  }

  ndc(e) {
    const r = this.dom.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 };
  }

  async setGyro(on) {
    if (!on) {
      this.gyro.enabled = false;
      return true;
    }
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const res = await DeviceOrientationEvent.requestPermission();
        if (res !== 'granted') return false;
      }
    } catch {
      return false;
    }
    if (!this.gyroBound) {
      this.gyroBound = true;
      window.addEventListener('deviceorientation', (e) => {
        if (e.alpha == null) return;
        this.gyro.raw = e;
      });
    }
    this.gyro.enabled = true;
    this.gyro.alpha0 = null;
    return isTouch;
  }

  readGyro() {
    const g = this.gyro;
    const e = g.raw;
    if (!g.enabled || !e) return;
    const landscape = Math.abs(window.orientation || screen.orientation?.angle || 0) === 90;
    const angle = screen.orientation?.angle ?? window.orientation ?? 0;
    const a = e.alpha;
    let b = landscape ? (angle === 90 ? -e.gamma : e.gamma) : e.beta;
    if (g.alpha0 == null) {
      g.alpha0 = a;
      g.beta0 = b;
    }
    let dy = a - g.alpha0;
    if (dy > 180) dy -= 360;
    if (dy < -180) dy += 360;
    g.yaw = clamp(dy * (Math.PI / 180), -1.2, 1.2);
    g.pitch = clamp((b - g.beta0) * (Math.PI / 180), -0.6, 0.6);
  }

  // --- per frame -----------------------------------------------------------------------------
  applyIntro(time, snap = false) {
    if (!this.intro) return;
    const i = this.intro;
    this.camera.position.copy(i.position);
    // slow breathing drift
    this.camera.position.x += Math.sin(time * 0.05) * 0.6;
    this.camera.position.y += Math.sin(time * 0.07) * 0.12;
    if (i.target) this.camera.lookAt(i.target);
    else this.camera.quaternion.copy(i.quaternion);
    this.fov = i.fov || 45;
    if (snap) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  update(dt, time) {
    this.time = time;
    const cam = this.camera;
    if (this.mode === 'intro') {
      this.applyIntro(time);
    } else if (this.seatAvatar) {
      // keyboard look
      if (!this.locked) {
        const k = dt * 1.6 * (settings.sensitivity || 1);
        if (this.keys.has('ArrowLeft') || this.keys.has('q') || this.keys.has('a')) { this.yawTarget += k; this.lastInput = time; }
        if (this.keys.has('ArrowRight') || this.keys.has('d')) { this.yawTarget -= k; this.lastInput = time; }
        if (this.keys.has('ArrowUp') || this.keys.has('z') || this.keys.has('w')) { this.pitchTarget += k * 0.7; this.lastInput = time; }
        if (this.keys.has('ArrowDown') || this.keys.has('s')) { this.pitchTarget -= k * 0.7; this.lastInput = time; }
      }
      // soft limits: spring back inside the realistic range
      if (!this.dragging) {
        this.yawTarget = damp(this.yawTarget, clamp(this.yawTarget, -YAW_LIMIT + 0.1, YAW_LIMIT - 0.1), 4, dt);
        this.pitchTarget = damp(this.pitchTarget, clamp(this.pitchTarget, PITCH_MIN + 0.1, PITCH_MAX - 0.15), 4, dt);
        // gentle return towards the fire after a long idle period
        if (time - this.lastInput > 7) {
          this.yawTarget = damp(this.yawTarget, 0, 0.25, dt);
          this.pitchTarget = damp(this.pitchTarget, REST_PITCH, 0.25, dt);
        }
      }
      this.readGyro();
      const gy = this.gyro.enabled ? this.gyro.yaw : 0;
      const gp = this.gyro.enabled ? this.gyro.pitch : 0;
      this.yaw = damp(this.yaw, clamp(this.yawTarget + gy, -YAW_LIMIT, YAW_LIMIT), 14, dt);
      this.pitch = damp(this.pitch, clamp(this.pitchTarget + gp, PITCH_MIN, PITCH_MAX), 14, dt);

      // position: eyes of the seated avatar + breathing + ghost lift
      this.ghost = damp(this.ghost, this.ghostTarget, 0.8, dt);
      const a = this.seatAvatar;
      _v.copy(this.eyeLocal);
      _v.y += Math.sin(time * 1.55) * 0.006 + this.ghost * 0.65;
      _v.z += Math.sin(time * 1.55 + 1.2) * 0.004 - this.ghost * 0.55;
      _v.x += wobble(time * 0.35, 1) * 0.006;
      a.root.localToWorld(_v);
      cam.position.copy(_v);
      // orientation: seat * yaw * pitch (+ micro movements, impulse shake)
      this.shake = Math.max(0, this.shake - dt * 1.5);
      const sy = wobble(time * 0.5, 3) * 0.006 + (Math.random() - 0.5) * this.shake * 0.04;
      const sp = wobble(time * 0.6, 7) * 0.005 + (Math.random() - 0.5) * this.shake * 0.04;
      _qYaw.setFromAxisAngle(UP, this.yaw + sy);
      _qPitch.setFromAxisAngle(RIGHT, this.pitch + sp);
      // camera looks down -Z: seat * yaw * half-turn gives the seat forward; rotation about the
      // camera's own +X then tilts the view up for a positive pitch
      _q.copy(a.root.quaternion).multiply(_qYaw).multiply(BACK).multiply(_qPitch);
      cam.quaternion.copy(_q);
      // wide lens like the reference shot (knees and hands at the bottom of the frame); portrait
      // screens need a larger vertical angle to keep a usable horizontal one
      const aspect = cam.aspect || 1.5;
      this.fov = aspect < 0.8 ? 86 : aspect < 1.2 ? 78 : 72;
    }
    // transition blend from the previous camera
    if (this.transition) {
      const tr = this.transition;
      tr.t += dt;
      const k = easeInOut(Math.min(1, tr.t / tr.dur));
      cam.position.lerpVectors(tr.pos, cam.position, k);
      cam.quaternion.slerpQuaternions(tr.quat, cam.quaternion, k);
      cam.fov = lerp(tr.fov, this.fov, k);
      cam.updateProjectionMatrix();
      if (tr.t >= tr.dur) this.transition = null;
    } else if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = damp(cam.fov, this.fov, 3, dt);
      cam.updateProjectionMatrix();
    }
  }

  /** Current presence angles (relative to the seat). */
  presenceAngles() {
    return { yaw: this.yaw, pitch: this.pitch };
  }
}
