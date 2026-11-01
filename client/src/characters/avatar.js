// A seated player avatar: one AnimationMixer per rig, clip cross-fades, additive gaze (neck/head/eyes)
// driven by the network presence, blinking, talking mouth, wolf form, outline highlight and an
// invisible capsule used for picking.
import * as THREE from 'three';
import { ProceduralFace } from './procedural.js';
import { clamp, damp } from '../util/math.js';

const MORPHS = ['Blink', 'EyesHalf', 'MouthOpen', 'Smile', 'Worried'];
const STANDING = new Set(['Wolf_Idle', 'Wolf_Howl', 'Stand_Idle', 'Walk']);

class MorphFace {
  constructor(root) {
    this.targets = [];
    root.traverse((o) => {
      if (o.morphTargetDictionary && o.morphTargetInfluences) {
        const idx = MORPHS.map((k) => o.morphTargetDictionary[k] ?? -1);
        if (idx.some((i) => i >= 0)) this.targets.push({ inf: o.morphTargetInfluences, idx });
      }
    });
  }
  apply(v) {
    for (const t of this.targets) {
      for (let k = 0; k < MORPHS.length; k++) {
        const i = t.idx[k];
        if (i >= 0) t.inf[i] = v[MORPHS[k]];
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Outline (inverted hull) shared by skinned and rigid meshes
// ---------------------------------------------------------------------------------------------
function makeOutlineMaterial() {
  const uniforms = { uWidth: { value: 0.008 } };
  const m = new THREE.MeshBasicMaterial({ color: 0x140c08, side: THREE.BackSide, fog: true });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uWidth = uniforms.uWidth;
    shader.vertexShader = 'uniform float uWidth;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\ntransformed += normalize(normal) * uWidth;',
    );
  };
  m.customProgramCacheKey = () => 'lg-outline';
  m.userData.uniforms = uniforms;
  return m;
}

const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _qRootInv = new THREE.Quaternion();
const _qYaw = new THREE.Quaternion();
const _qPitch = new THREE.Quaternion();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _m1 = new THREE.Matrix4();
const Y = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);

/** Rotate a bone by qChar (expressed in character root space), on top of its animated pose. */
function rotateInRootSpace(bone, qChar) {
  bone.parent.getWorldQuaternion(_q1);
  _q1.premultiply(_qRootInv); // parent orientation in character space
  _q2.copy(_q1).invert();
  bone.quaternion.premultiply(_q1).premultiply(qChar).premultiply(_q2);
}
function yawPitch(out, yaw, pitch) {
  _qYaw.setFromAxisAngle(Y, yaw);
  _qPitch.setFromAxisAngle(X, -pitch);
  return out.copy(_qYaw).multiply(_qPitch);
}

class Rig {
  constructor(lib, id) {
    const inst = lib.instantiate(id);
    this.root = inst.root;
    this.template = inst.template;
    this.clips = inst.clips;
    this.kind = inst.kind;
    this.mixer = new THREE.AnimationMixer(this.root);
    this.actions = new Map();
    this.current = null;
    this.currentName = null;
    const find = (...names) => {
      for (const n of names) {
        const o = this.root.getObjectByName(n);
        if (o) return o;
      }
      return null;
    };
    this.bones = {
      head: find('Head', 'head'),
      neck: find('neck_01', 'neck'),
      eyeL: find('eye_l'),
      eyeR: find('eye_r'),
      spine1: find('spine_01'),
      spine2: find('spine_02'),
      spine3: find('spine_03'),
      pelvis: find('pelvis'),
      thighL: find('thigh_l'), thighR: find('thigh_r'), calfL: find('calf_l'), calfR: find('calf_r'),
      upperL: find('upperarm_l'), upperR: find('upperarm_r'), lowerL: find('lowerarm_l'), lowerR: find('lowerarm_r'),
    };
    // bones that receive additive rotations on top of the clips. three.js' PropertyMixer only writes
    // a bone when its animated value CHANGES, so constant tracks would let our additive rotations
    // accumulate frame after frame: we restore the animated base ourselves.
    this.additive = Object.values(this.bones).filter((b, i, arr) => b && b !== this.bones.pelvis && arr.indexOf(b) === i)
      .map((bone) => ({ bone, base: bone.quaternion.clone(), written: new THREE.Quaternion(NaN, NaN, NaN, NaN) }));
    this.face = this.kind === 'procedural' ? new ProceduralFace(this.root) : new MorphFace(this.root);
    this.meshes = [];
    this.root.traverse((o) => { if (o.isMesh) this.meshes.push(o); });
    // seat placement: pelvis on the seat point
    const sit = this.template.sit;
    this.root.position.set(-sit.pelvis.x, -(sit.pelvis.y - sit.pelvisAboveSeat), -sit.pelvis.z);
    // two placements: seated (pelvis on the seat point) and standing (feet on the ground in front of
    // the log) for the standing clips (Wolf_Idle, Wolf_Howl, Stand_Idle, Walk)
    this.sitPos = this.root.position.clone();
    this.standPos = new THREE.Vector3(0, -0.45, 0.3);
    this.timeOffset = Math.random() * 10;
    this.outlines = null;
  }

  /** After mixer.update: bring back the animated pose of bones the mixer did not rewrite. */
  beginAdditive() {
    for (const a of this.additive) {
      const q = a.bone.quaternion;
      if (q.x === a.written.x && q.y === a.written.y && q.z === a.written.z && q.w === a.written.w) q.copy(a.base);
      a.base.copy(q);
    }
  }
  endAdditive() {
    for (const a of this.additive) a.written.copy(a.bone.quaternion);
  }

  action(name) {
    if (this.actions.has(name)) return this.actions.get(name);
    const clip = this.clips[name];
    if (!clip) return null;
    const a = this.mixer.clipAction(clip);
    const loop = clip.userData?.loop !== false;
    a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    a.clampWhenFinished = !loop;
    this.actions.set(name, a);
    return a;
  }

  play(name, fade = 0.45, atEnd = false) {
    const next = this.action(name);
    if (!next) return 0;
    if (this.current === next && !atEnd) return next.getClip().duration;
    next.reset();
    next.enabled = true;
    next.setEffectiveTimeScale(1);
    next.setEffectiveWeight(1);
    if (next.loop === THREE.LoopRepeat) next.time = this.timeOffset % next.getClip().duration;
    if (atEnd) next.time = next.getClip().duration;
    next.play();
    if (this.current && this.current !== next && fade > 0) this.current.crossFadeTo(next, fade, false);
    else if (this.current && this.current !== next) this.current.stop();
    this.current = next;
    this.currentName = name;
    return next.getClip().duration;
  }

  ensureOutlines(material) {
    if (this.outlines) return this.outlines;
    this.outlines = [];
    for (const mesh of this.meshes) {
      if (mesh.userData.noOutline || mesh.name.startsWith('pupil') || mesh.parent?.name?.startsWith('lid')) continue;
      let o;
      if (mesh.isSkinnedMesh) {
        o = new THREE.SkinnedMesh(mesh.geometry, material);
        o.bind(mesh.skeleton, mesh.bindMatrix);
        o.bindMode = mesh.bindMode;
        if (mesh.morphTargetInfluences) {
          o.morphTargetInfluences = mesh.morphTargetInfluences;
          o.morphTargetDictionary = mesh.morphTargetDictionary;
        }
      } else {
        o = new THREE.Mesh(mesh.geometry, material);
      }
      o.frustumCulled = false;
      o.castShadow = false;
      o.receiveShadow = false;
      o.raycast = () => {};
      o.name = 'outline';
      mesh.add(o);
      this.outlines.push(o);
    }
    // width in mesh units (GLB armatures are sometimes scaled)
    if (this.meshes[0]) {
      this.meshes[0].updateWorldMatrix(true, false);
      const s = new THREE.Vector3().setFromMatrixScale(this.meshes[0].matrixWorld).x || 1;
      material.userData.scale = 1 / s;
    }
    return this.outlines;
  }
}

let candleGeo = null;
let candleMat = null;
let flameMat = null;
function candleMeshes() {
  if (!candleGeo) {
    candleGeo = new THREE.CylinderGeometry(0.035, 0.04, 0.16, 10).translate(0, 0.08, 0);
    candleMat = new THREE.MeshStandardMaterial({ color: 0xeee6d6, roughness: 0.7 });
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 36, 0, 32, 36, 30);
    g.addColorStop(0, 'rgba(255,240,200,1)');
    g.addColorStop(0.3, 'rgba(255,170,60,0.8)');
    g.addColorStop(1, 'rgba(255,120,30,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    flameMat = new THREE.SpriteMaterial({ map: t, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  }
  const g = new THREE.Group();
  const body = new THREE.Mesh(candleGeo, candleMat);
  body.castShadow = true;
  const flame = new THREE.Sprite(flameMat);
  flame.scale.set(0.12, 0.16, 1);
  flame.position.y = 0.21;
  g.add(body, flame);
  g.userData.flame = flame;
  return g;
}

let glowMat = null;
function eyeGlowMaterial() {
  if (!glowMat) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,250,200,1)');
    g.addColorStop(0.25, 'rgba(255,200,40,0.9)');
    g.addColorStop(1, 'rgba(255,160,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    glowMat = new THREE.SpriteMaterial({ map: t, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  }
  return glowMat;
}

const OUTLINE_COLORS = {
  none: [0x140c08, 0.007],
  hover: [0xfff0b8, 0.016],
  select: [0xff3b2a, 0.02],
  target: [0xffffff, 0.013],
  ally: [0xffa020, 0.014],
  lover: [0xff6fa8, 0.014],
};

export class Avatar {
  constructor({ lib, playerId, avatarId, isSelf, quality }) {
    this.lib = lib;
    this.playerId = playerId;
    this.avatarId = avatarId;
    this.isSelf = isSelf;
    this.quality = quality;
    this.root = new THREE.Group();
    this.root.name = `avatar_${playerId}`;
    this.human = new Rig(lib, avatarId);
    this.root.add(this.human.root);
    this.wolf = null;
    this.rig = this.human;

    // state
    this.pose = 'idle';
    this.talking = false;
    this.hold = null; // 'Sit_Point' | 'Sit_RaiseHand'
    this.oneShot = null;
    this.oneShotUntil = 0;
    this.eyes = 'open';
    this.lookTarget = { yaw: 0, pitch: -0.12 };
    this.look = { yaw: 0, pitch: -0.12 };
    this.twistTarget = 0;
    this.twist = 0;
    this.closed = 0;
    this.half = 0;
    this.blink = 0;
    this.nextBlink = 1 + Math.random() * 4;
    this.mouth = 0;
    this.worried = 0;
    this.smile = 0.15;
    this.deadSince = -1;
    this.ghost = false;
    this.targetable = true;
    this.glowEyes = false;
    this.wolfForm = false;
    this.headAnchor = new THREE.Vector3();
    this.faceValues = { Blink: 0, EyesHalf: 0, MouthOpen: 0, Smile: 0, Worried: 0 };
    this.fpPose = { knee: this.human.kind === 'glb' ? 0.32 : 0.05, arm: this.human.kind === 'glb' ? 0.4 : 0.08, fore: this.human.kind === 'glb' ? 0.15 : 0 };

    // picking capsule (never rendered)
    const capsule = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.34, 0.75, 2, 8),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    capsule.position.set(0, 0.36, 0.12);
    capsule.visible = false;
    capsule.userData.playerId = playerId;
    this.capsule = capsule;
    this.root.add(capsule);

    this.outlineMat = makeOutlineMaterial();
    this.highlight = 'none';
    this.applyOutlines();

    this.glows = null;
    this.candle = null;
    this.rig.play('Sit_Idle', 0);
  }

  setSeat(seat) {
    this.seat = seat;
    for (const rig of [this.human, this.wolf]) if (rig) this.fitRig(rig);
    this.root.position.copy(seat.position);
    this.root.quaternion.copy(seat.quaternion);
    this.root.updateMatrixWorld(true);
  }

  /**
   * Seat fitting. The pelvis sits exactly on the seat marker; with the character scale the seated
   * pelvis is 0.41-0.48 m above the feet, so on a 0.45 m log the feet would float or sink by a few
   * cm: the thighs are pitched (additively) so the feet reach the ground. Standing clips go to the
   * ground in front of the log.
   */
  fitRig(rig) {
    const sit = rig.template.sit;
    rig.standPos.y = -this.seat.position.y; // the camp ground is y = 0
    const footLift = this.seat.position.y - (sit.pelvis.y - sit.pelvisAboveSeat); // > 0: floating feet
    rig.legFix = clamp(Math.asin(clamp(footLift / sit.thighLen, -0.5, 0.5)), -0.25, 0.25);
  }

  // --- high level state ----------------------------------------------------------------------
  setPose(pose) {
    if (pose === this.pose) return;
    if (pose === 'dead' && this.pose !== 'dead') this.deadSince = performance.now();
    if (pose !== 'dead') this.deadSince = -1;
    this.pose = pose;
  }
  setTalking(v) { this.talking = v; }
  setGesture(g) {
    if (g === 'point') this.hold = 'Sit_Point';
    else if (g === 'raise') this.hold = 'Sit_RaiseHand';
    else {
      this.hold = null;
      if (g === 'nod') this.playOnce('Sit_Nod');
      else if (g === 'shake') this.playOnce('Sit_Shake');
    }
  }
  playOnce(name, now = performance.now()) {
    if (this.pose === 'dead') return;
    const clip = this.rig.clips[name];
    if (!clip) return;
    this.oneShot = name;
    this.oneShotUntil = now + clip.duration * 1000 - 250;
  }
  react(kind) {
    if (kind === 'shocked') this.playOnce('Sit_Shocked');
    if (kind === 'howl') this.playOnce('Wolf_Howl');
  }
  setLook(yaw, pitch) {
    this.lookTarget.yaw = clamp(yaw, -1.6, 1.6);
    this.lookTarget.pitch = clamp(pitch, -0.9, 0.7);
  }
  /** Look at a world point (head height of another avatar, the fire...). */
  lookAtPoint(p) {
    const { yaw, pitch } = this.anglesTo(p);
    this.setLook(yaw, pitch);
  }
  anglesTo(p) {
    _v1.copy(p).sub(this.headAnchor.lengthSq() ? this.headAnchor : this.root.position);
    // into seat space
    _q3.copy(this.root.quaternion).invert();
    _v1.applyQuaternion(_q3);
    const yaw = Math.atan2(_v1.x, _v1.z);
    const pitch = Math.atan2(_v1.y, Math.hypot(_v1.x, _v1.z));
    return { yaw, pitch };
  }
  setTwistTowards(p) {
    if (!p) {
      this.twistTarget = 0;
      return;
    }
    _v1.copy(p).sub(this.root.position);
    _q3.copy(this.root.quaternion).invert();
    _v1.applyQuaternion(_q3);
    this.twistTarget = clamp(Math.atan2(_v1.x, _v1.z), -1.2, 1.2);
  }
  setEyes(e) { this.eyes = e || 'open'; }

  setWolfForm(on) {
    if (on === this.wolfForm) return;
    this.wolfForm = on;
    if (on && !this.wolf) {
      this.wolf = new Rig(this.lib, 'werewolf');
      if (this.seat) this.fitRig(this.wolf);
      this.root.add(this.wolf.root);
      if (this.outlines !== false) this.applyOutlines();
    }
    const from = this.rig;
    this.rig = on ? this.wolf : this.human;
    this.human.root.visible = !on;
    if (this.wolf) this.wolf.root.visible = on;
    if (from !== this.rig) {
      this.rig.current = null;
      this.rig.play(from.currentName || 'Sit_Idle', 0, from.currentName === 'Sit_Death');
    }
  }
  setGlowEyes(on) {
    this.glowEyes = on;
    if (on && !this.glows) {
      const m = eyeGlowMaterial();
      this.glows = [new THREE.Sprite(m), new THREE.Sprite(m)];
      for (const g of this.glows) {
        g.scale.setScalar(0.09);
        g.renderOrder = 8;
        this.root.add(g);
      }
    }
    if (this.glows) for (const g of this.glows) g.visible = on;
  }

  /** Dead and gone: hide the body, leave a small candle on the seat. */
  setGhost(on) {
    if (on === this.ghost) return;
    this.ghost = on;
    this.human.root.visible = !on && !this.wolfForm;
    if (this.wolf) this.wolf.root.visible = !on && this.wolfForm;
    if (on && !this.candle) {
      this.candle = candleMeshes();
      this.candle.position.set(0, -0.45, 0.45);
      this.root.add(this.candle);
    }
    if (this.candle) this.candle.visible = on;
  }

  setHighlight(kind) {
    kind = kind || 'none';
    if (kind === this.highlight) return;
    this.highlight = kind;
    this.applyOutlines();
  }

  applyOutlines() {
    const [color, width] = OUTLINE_COLORS[this.highlight] || OUTLINE_COLORS.none;
    const show = this.highlight !== 'none' || this.quality.tier.outlines;
    if (!show && !this.human.outlines) return;
    for (const rig of [this.human, this.wolf]) {
      if (!rig) continue;
      const outlines = rig.ensureOutlines(this.outlineMat);
      for (const o of outlines) o.visible = show && !this.isSelf;
    }
    this.outlineMat.color.setHex(color);
    this.outlineMat.userData.uniforms.uWidth.value = width * (this.outlineMat.userData.scale || 1);
  }

  hideHead(on) { this.headHidden = on; }

  /**
   * First person: hide the torso of one's own avatar with an intersection of 4 clipping planes
   * (a box around the chest, in seat space) so that only sleeves, hands, lap and knees remain,
   * seen over the shoulders like in the reference shot. The shadow keeps the whole body.
   */
  setFirstPersonClip(on) {
    if (on === !!this.clip) return;
    if (!on) {
      for (const [mesh, mat] of this.clipOriginals) mesh.material = mat;
      this.clip = null;
      return;
    }
    this.clipOriginals = new Map();
    this.root.updateMatrixWorld(true);
    const m = this.root.matrixWorld;
    const plane = (nx, ny, nz, c) => new THREE.Plane(new THREE.Vector3(nx, ny, nz), c).applyMatrix4(m);
    const planes = [plane(1, 0, 0, -0.17), plane(-1, 0, 0, -0.17), plane(0, 0, 1, -0.13), plane(0, -1, 0, -0.02)];
    this.clip = planes;
    const swap = new Map();
    for (const rig of [this.human, this.wolf]) {
      if (!rig) continue;
      for (const mesh of rig.meshes) {
        this.clipOriginals.set(mesh, mesh.material);
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const out = mats.map((mat) => {
          if (!swap.has(mat)) {
            const c = mat.clone();
            c.clippingPlanes = planes;
            c.clipIntersection = true;
            c.clipShadows = false;
            swap.set(mat, c);
          }
          return swap.get(mat);
        });
        mesh.material = Array.isArray(mesh.material) ? out : out[0];
      }
    }
  }

  // --- per frame -------------------------------------------------------------------------------
  resolveClip(now) {
    if (this.oneShot && now > this.oneShotUntil) this.oneShot = null;
    if (this.pose === 'dead') return 'Sit_Death';
    if (this.oneShot) return this.oneShot;
    if (this.pose === 'sleep') return 'Sit_Sleep';
    if (this.hold) return this.hold;
    if (this.pose === 'stand') return 'Stand_Idle';
    if (this.pose === 'awake') return this.wolfForm && this.rig.clips.Wolf_Idle ? 'Wolf_Idle' : 'Sit_Awake_Night';
    return this.talking ? 'Sit_Talk' : 'Sit_Idle';
  }

  update(dt, time, now = performance.now()) {
    if (this.ghost) {
      if (this.candle) {
        const f = this.candle.userData.flame;
        f.scale.y = 0.16 * (0.85 + 0.15 * Math.sin(time * 13 + this.seat.index));
      }
      return;
    }
    const rig = this.rig;
    const want = this.resolveClip(now);
    if (want !== rig.currentName) {
      const fade = want === 'Sit_Death' ? 0.25 : want === 'Sit_Sleep' ? 1.2 : 0.45;
      const instantDeath = want === 'Sit_Death' && this.deadSince > 0 && now - this.deadSince > 4000;
      rig.play(want, fade, instantDeath);
    }
    rig.mixer.update(dt);
    rig.beginAdditive();
    // (procedural Wolf_* clips are seated)
    const standing = STANDING.has(rig.currentName) && (rig.kind === 'glb' || !rig.currentName.startsWith('Wolf'));
    rig.root.position.lerp(standing ? rig.standPos : rig.sitPos, 1 - Math.exp(-5 * dt));

    // --- additive gaze & torso twist
    const peeking = this.eyes === 'peek' && this.pose !== 'dead';
    const asleep = (this.pose === 'sleep' && !peeking) || this.pose === 'dead';
    const lambda = asleep ? 2 : 7;
    this.look.yaw = damp(this.look.yaw, asleep ? 0 : this.lookTarget.yaw, lambda, dt);
    this.look.pitch = damp(this.look.pitch, asleep ? 0 : this.lookTarget.pitch, lambda, dt);
    this.twist = damp(this.twist, this.hold === 'Sit_Point' && !asleep ? this.twistTarget : 0, 4, dt);
    const b = rig.bones;
    rig.root.getWorldQuaternion(_qRootInv).invert();
    // first person: knees up a little and hands forward on the knees, so they enter the bottom of
    // the frame like in the reference shot (additive, own avatar only)
    const fpOn = this.clip && this.pose !== 'dead';
    const seated = rig.currentName?.startsWith('Sit_') && rig.currentName !== 'Sit_Death' && rig.currentName !== 'Sit_Stand';
    const knee = (seated ? rig.legFix || 0 : 0) - (fpOn ? this.fpPose.knee : 0);
    if (Math.abs(knee) > 0.001) {
      if (b.thighL) rotateInRootSpace(b.thighL, _q3.setFromAxisAngle(X, knee));
      if (b.thighR) rotateInRootSpace(b.thighR, _q3.setFromAxisAngle(X, knee));
      if (b.calfL) rotateInRootSpace(b.calfL, _q3.setFromAxisAngle(X, -knee * 0.95));
      if (b.calfR) rotateInRootSpace(b.calfR, _q3.setFromAxisAngle(X, -knee * 0.95));
    }
    if (fpOn) {
      const fp = this.fpPose;
      if (b.upperL) rotateInRootSpace(b.upperL, _q3.setFromAxisAngle(X, -fp.arm));
      if (b.upperR) rotateInRootSpace(b.upperR, _q3.setFromAxisAngle(X, -fp.arm));
      if (b.lowerL) rotateInRootSpace(b.lowerL, _q3.setFromAxisAngle(X, -fp.fore));
      if (b.lowerR) rotateInRootSpace(b.lowerR, _q3.setFromAxisAngle(X, -fp.fore));
    }
    if (Math.abs(this.twist) > 0.001) {
      for (const [bone, share] of [[b.spine1, 0.3], [b.spine2, 0.35], [b.spine3, 0.35]]) {
        if (bone) rotateInRootSpace(bone, _q3.setFromAxisAngle(Y, this.twist * share));
      }
    }
    // head yaw is relative to the seat; the twist already turned the shoulders
    const yaw = this.look.yaw - (this.hold === 'Sit_Point' ? this.twist : 0);
    const pitch = this.look.pitch + 0.12; // clips already look slightly down at the fire
    if (b.neck) rotateInRootSpace(b.neck, yawPitch(_q3, yaw * 0.35, pitch * 0.3));
    if (b.head) rotateInRootSpace(b.head, yawPitch(_q3, yaw * 0.65, pitch * 0.7));
    // eyes lead the head
    const ey = clamp(this.lookTarget.yaw - this.look.yaw, -0.45, 0.45);
    const ep = clamp(this.lookTarget.pitch - this.look.pitch, -0.3, 0.3);
    if (!asleep && (Math.abs(ey) > 0.01 || Math.abs(ep) > 0.01)) {
      yawPitch(_q3, ey, ep);
      if (b.eyeL) rotateInRootSpace(b.eyeL, _q3);
      if (b.eyeR) rotateInRootSpace(b.eyeR, _q3);
    }

    rig.endAdditive();

    // --- face
    this.nextBlink -= dt;
    if (this.nextBlink <= 0) {
      this.blink = 1;
      this.nextBlink = 1.8 + Math.random() * 4.5;
      if (Math.random() < 0.15) this.nextBlink = 0.25; // double blink
    }
    this.blink = Math.max(0, this.blink - dt * 7);
    const closedTarget = this.eyes === 'closed' || (asleep && !peeking) ? 1 : 0;
    this.closed = damp(this.closed, closedTarget, closedTarget ? 6 : 9, dt);
    this.half = damp(this.half, this.eyes === 'peek' ? 1 : 0, 8, dt);
    const talking = this.talking && rig.currentName === 'Sit_Talk';
    // Wolf_Howl: the mouth opens from 0.6 s to 3.0 s (manifest clip note)
    const howlT = rig.currentName === 'Wolf_Howl' && rig.current ? rig.current.time : -1;
    this.mouth = howlT > 0.6 && howlT < 3.0 ? damp(this.mouth, 1, 8, dt) : talking ? 0.15 + 0.55 * Math.abs(Math.sin(time * 9.5 + Math.sin(time * 3.1) * 2)) : damp(this.mouth, 0, 10, dt);
    this.worried = damp(this.worried, this.pose === 'awake' || this.oneShot === 'Sit_Shocked' ? 0.8 : 0, 4, dt);
    const fv = this.faceValues;
    fv.Blink = Math.max(this.closed, this.blink > 0.5 ? (1 - this.blink) * 2 : this.blink * 2);
    fv.EyesHalf = this.half * (1 - this.closed);
    fv.MouthOpen = this.oneShot === 'Sit_Shocked' ? 0.7 : this.mouth;
    fv.Smile = this.pose === 'idle' && !talking ? this.smile : 0;
    fv.Worried = this.worried;
    rig.face.apply(fv);

    // --- head anchor (labels, gaze targets) and own head hiding
    if (b.head) {
      b.head.getWorldPosition(this.headAnchor);
      if (this.headHidden) b.head.scale.setScalar(0.0001);
      else if (b.head.scale.x < 0.5) b.head.scale.setScalar(1);
    } else {
      this.headAnchor.copy(this.root.position).y += 0.8;
    }
    if (this.glows && this.glowEyes) {
      const eyes = [b.eyeL, b.eyeR];
      rig.root.getWorldQuaternion(_q1);
      _v2.set(0, 0, 0.03).applyQuaternion(_q1);
      for (let i = 0; i < 2; i++) {
        const g = this.glows[i];
        if (eyes[i]) eyes[i].getWorldPosition(g.position);
        else g.position.copy(this.headAnchor).add(_v1.set(i ? -0.04 : 0.04, 0.1, 0.1).applyQuaternion(_q1));
        g.position.add(_v2);
        this.root.worldToLocal(g.position);
        g.material.opacity = 1 - this.closed;
      }
    }
  }

  dispose() {
    this.root.removeFromParent();
    for (const rig of [this.human, this.wolf]) {
      if (!rig) continue;
      rig.mixer.stopAllAction();
      rig.mixer.uncacheRoot(rig.root);
    }
    this.capsule.geometry.dispose();
    this.outlineMat.dispose();
  }
}
