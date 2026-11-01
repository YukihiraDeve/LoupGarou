// Procedural stand-in characters: a bone hierarchy with the contract's bone names (root, pelvis,
// spine_01..03, neck_01, Head, eye_l/r, clavicle/upperarm/lowerarm/hand, thigh/calf/foot/ball)
// carrying rigid body parts, plus procedurally generated clips with the contract's clip names.
// Clips bind by node name, exactly like the real anims.glb would.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ------------------------------------------------------------------------------------------
// Skeleton
// ------------------------------------------------------------------------------------------
const SKEL = [
  ['pelvis', 'root', [0, 0.95, 0]],
  ['spine_01', 'pelvis', [0, 0.1, 0]],
  ['spine_02', 'spine_01', [0, 0.13, 0]],
  ['spine_03', 'spine_02', [0, 0.13, 0]],
  ['neck_01', 'spine_03', [0, 0.17, 0]],
  ['Head', 'neck_01', [0, 0.09, 0]],
  ['eye_l', 'Head', [0.042, 0.105, 0.108]],
  ['eye_r', 'Head', [-0.042, 0.105, 0.108]],
  ['clavicle_l', 'spine_03', [0.03, 0.12, 0]],
  ['upperarm_l', 'clavicle_l', [0.15, 0, 0]],
  ['lowerarm_l', 'upperarm_l', [0.27, 0, 0]],
  ['hand_l', 'lowerarm_l', [0.25, 0, 0]],
  ['clavicle_r', 'spine_03', [-0.03, 0.12, 0]],
  ['upperarm_r', 'clavicle_r', [-0.15, 0, 0]],
  ['lowerarm_r', 'upperarm_r', [-0.27, 0, 0]],
  ['hand_r', 'lowerarm_r', [-0.25, 0, 0]],
  ['thigh_l', 'pelvis', [0.095, -0.04, 0]],
  ['calf_l', 'thigh_l', [0, -0.43, 0]],
  ['foot_l', 'calf_l', [0, -0.42, 0]],
  ['ball_l', 'foot_l', [0, -0.05, 0.13]],
  ['thigh_r', 'pelvis', [-0.095, -0.04, 0]],
  ['calf_r', 'thigh_r', [0, -0.43, 0]],
  ['foot_r', 'calf_r', [0, -0.42, 0]],
  ['ball_r', 'foot_r', [0, -0.05, 0.13]],
];
const PARENT = Object.fromEntries(SKEL.map(([n, p]) => [n, p]));
const REST_AXIS = {
  upperarm_l: [1, 0, 0], lowerarm_l: [1, 0, 0], hand_l: [1, 0, 0],
  upperarm_r: [-1, 0, 0], lowerarm_r: [-1, 0, 0], hand_r: [-1, 0, 0],
  thigh_l: [0, -1, 0], calf_l: [0, -1, 0], thigh_r: [0, -1, 0], calf_r: [0, -1, 0],
  foot_l: [0, 0, 1], foot_r: [0, 0, 1],
};
const DIR_KEYS = {
  upperarm_l: 'ua_l', lowerarm_l: 'la_l', hand_l: 'ha_l', upperarm_r: 'ua_r', lowerarm_r: 'la_r', hand_r: 'ha_r',
  thigh_l: 'th_l', calf_l: 'ca_l', foot_l: 'ft_l', thigh_r: 'th_r', calf_r: 'ca_r', foot_r: 'ft_r',
};
const EULER_KEYS = { spine_01: 's1', spine_02: 's2', spine_03: 's3', neck_01: 'nk', Head: 'hd', clavicle_l: 'cl_l', clavicle_r: 'cl_r' };

// ------------------------------------------------------------------------------------------
// Pose solver: euler angles for the spine/head, character-space directions for the limbs
// ------------------------------------------------------------------------------------------
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _a = new THREE.Vector3();
const _d = new THREE.Vector3();
const _qi = new THREE.Quaternion();

function solve(spec) {
  const world = { root: new THREE.Quaternion() };
  const local = {};
  for (const [name, parent] of SKEL) {
    const pw = world[parent];
    let wq;
    if (name === 'pelvis') {
      const r = spec.pr || [0, 0, 0];
      wq = new THREE.Quaternion().setFromEuler(_e.set(r[0], r[1], r[2], 'YXZ'));
    } else if (EULER_KEYS[name]) {
      const r = spec[EULER_KEYS[name]] || [0, 0, 0];
      wq = pw.clone().multiply(new THREE.Quaternion().setFromEuler(_e.set(r[0], r[1], r[2], 'YXZ')));
    } else if (DIR_KEYS[name] && spec[DIR_KEYS[name]]) {
      const dir = spec[DIR_KEYS[name]];
      _a.fromArray(REST_AXIS[name]);
      _d.fromArray(dir).normalize();
      wq = new THREE.Quaternion().setFromUnitVectors(_a, _d);
    } else {
      wq = pw.clone();
    }
    world[name] = wq;
    local[name] = _qi.copy(pw).invert().multiply(wq).clone();
  }
  return { local, pelvis: spec.pp || [0, 0.95, 0] };
}

const mx = (v) => [-v[0], v[1], v[2]];

// Base sitting pose: pelvis 8 cm above a 0.45 m seat, hands resting on the knees.
const SIT = {
  pp: [0, 0.53, 0],
  pr: [0.03, 0, 0],
  s1: [0.03, 0, 0], s2: [0.03, 0, 0], s3: [0.0, 0, 0], nk: [-0.02, 0, 0], hd: [-0.03, 0, 0],
  // low log: knees slightly above the hips, hands resting on the knees
  ua_l: [0.02, -0.72, 0.68], la_l: [-0.1, -0.55, 0.83], ha_l: [-0.05, -0.5, 1],
  ua_r: mx([0.02, -0.72, 0.68]), la_r: mx([-0.1, -0.55, 0.83]), ha_r: mx([-0.05, -0.5, 1]),
  th_l: [0.13, 0.2, 1], ca_l: [0.02, -1, -0.2], ft_l: [0.08, 0, 1],
  th_r: mx([0.13, 0.2, 1]), ca_r: mx([0.02, -1, -0.2]), ft_r: mx([0.08, 0, 1]),
};
const STAND = {
  pp: [0, 0.95, 0], pr: [0, 0, 0],
  ua_l: [0.18, -1, 0.02], la_l: [0.08, -1, 0.12], ha_l: [0.05, -1, 0.1],
  ua_r: mx([0.18, -1, 0.02]), la_r: mx([0.08, -1, 0.12]), ha_r: mx([0.05, -1, 0.1]),
  th_l: [0.03, -1, 0], ca_l: [0, -1, -0.02], ft_l: [0.1, 0, 1],
  th_r: mx([0.03, -1, 0]), ca_r: mx([0, -1, -0.02]), ft_r: mx([0.1, 0, 1]),
};
const with_ = (base, over) => ({ ...base, ...over });
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const blendPose = (a, b, t) => {
  const out = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const va = a[k] || b[k];
    const vb = b[k] || a[k];
    out[k] = lerp3(va, vb, t);
  }
  return out;
};
const ease = (t) => t * t * (3 - 2 * t);
const S = Math.sin;
const TAU = Math.PI * 2;

// clip name -> { duration, loop, fps, pose(t) }
const CLIP_DEFS = {
  Sit_Idle: {
    duration: 4, pose: (t) => {
      const b = S((t / 4) * TAU);
      return with_(SIT, {
        s3: [0.0 + b * 0.025, 0, 0], s1: [0.05, S((t / 4) * TAU) * 0.015, 0],
        hd: [-0.03 - b * 0.02, S((t / 4) * TAU * 0.5) * 0.05, 0],
        cl_l: [0, 0, b * 0.03], cl_r: [0, 0, -b * 0.03],
      });
    },
  },
  Sit_Talk: {
    duration: 3, pose: (t) => {
      const p = (t / 3) * TAU;
      const g = Math.max(0, S(p)); // right hand gesture
      const g2 = Math.max(0, S(p + Math.PI)); // left hand gesture
      return with_(SIT, {
        s2: [0.06, S(p) * 0.06, 0], s3: [0.02, S(p) * 0.05, 0],
        hd: [-0.02 + S(p * 2) * 0.05, S(p) * 0.12, S(p * 0.5) * 0.04],
        ua_r: lerp3(SIT.ua_r, [-0.35, -0.6, 0.7], g),
        la_r: lerp3(SIT.la_r, [0.25, 0.35, 0.95], g),
        ha_r: lerp3(SIT.ha_r, [0.1, 0.6, 1], g),
        ua_l: lerp3(SIT.ua_l, [0.3, -0.7, 0.6], g2 * 0.7),
        la_l: lerp3(SIT.la_l, [-0.2, 0.2, 1], g2 * 0.7),
      });
    },
  },
  Sit_Sleep: {
    duration: 5, pose: (t) => {
      const b = S((t / 5) * TAU);
      return with_(SIT, {
        pr: [0.12, 0, 0], s1: [0.12, 0, 0], s2: [0.12, 0, 0], s3: [0.1 + b * 0.02, 0, 0],
        nk: [0.45, 0, 0.05], hd: [0.35 + b * 0.03, 0.1, 0.12],
        cl_l: [0, 0, -0.08], cl_r: [0, 0, 0.08],
        ua_l: [0.05, -0.9, 0.45], la_l: [-0.6, -0.25, 0.75], ha_l: [-1, -0.3, 0.2],
        ua_r: [-0.05, -0.9, 0.45], la_r: [0.6, -0.2, 0.75], ha_r: [1, -0.3, 0.2],
      });
    },
  },
  Sit_Awake_Night: {
    duration: 4, pose: (t) => {
      const p = (t / 4) * TAU;
      return with_(SIT, {
        pr: [0.16, 0, 0], s1: [0.1, 0, 0], s2: [0.08, 0, 0], s3: [0.04, S(p) * 0.08, 0],
        hd: [-0.12, S(p) * 0.45, 0], nk: [-0.05, S(p) * 0.2, 0],
        ua_l: [0.08, -0.8, 0.6], la_l: [-0.7, -0.3, 0.65], ha_l: [-1, -0.2, 0.3],
        ua_r: [-0.08, -0.8, 0.6], la_r: [0.7, -0.3, 0.65], ha_r: [1, -0.2, 0.3],
      });
    },
  },
  Sit_Point: {
    duration: 1, loop: false, pose: (t) => {
      const k = ease(Math.min(1, t / 0.45));
      return blendPose(SIT, with_(SIT, {
        pr: [0.14, 0, 0], s2: [0.06, 0, 0],
        ua_r: [-0.12, 0.12, 1], la_r: [-0.05, 0.1, 1], ha_r: [0, 0.05, 1], cl_r: [0, 0.15, 0],
        hd: [-0.05, 0, 0],
      }), k);
    },
  },
  Sit_RaiseHand: {
    duration: 1, loop: false, pose: (t) => {
      const k = ease(Math.min(1, t / 0.5));
      return blendPose(SIT, with_(SIT, {
        s2: [0.0, 0, -0.06], ua_r: [-0.3, 1, 0.15], la_r: [-0.05, 1, 0.12], ha_r: [0, 1, 0.1], cl_r: [0, 0, -0.2],
      }), k);
    },
  },
  Sit_Nod: {
    duration: 1.1, loop: false, pose: (t) => with_(SIT, { hd: [-0.03 + Math.max(0, S((t / 1.1) * TAU * 1.5)) * 0.32, 0, 0], nk: [0.06 * S((t / 1.1) * Math.PI), 0, 0] }),
  },
  Sit_Shake: {
    duration: 1.3, loop: false, pose: (t) => with_(SIT, { hd: [0, S((t / 1.3) * TAU * 2) * 0.38 * (1 - t / 1.3), 0] }),
  },
  Sit_Shocked: {
    duration: 1.8, loop: false, pose: (t) => {
      const k = t < 0.25 ? ease(t / 0.25) : 1 - ease(Math.max(0, (t - 1.0) / 0.8));
      return blendPose(SIT, with_(SIT, {
        pr: [-0.12, 0, 0], s2: [-0.12, 0, 0], s3: [-0.08, 0, 0], hd: [-0.25, 0, 0],
        ua_l: [0.35, -0.45, 0.55], la_l: [-0.45, 0.8, 0.35], ha_l: [-0.2, 1, 0.3],
        ua_r: [-0.35, -0.45, 0.55], la_r: [0.45, 0.8, 0.35], ha_r: [0.2, 1, 0.3],
      }), k);
    },
  },
  Sit_Death: {
    duration: 2.2, loop: false, pose: (t) => {
      const k2 = ease(Math.min(1, t / 0.8));
      const slump = with_(SIT, { pr: [0.4, 0, 0.1], s2: [0.3, 0, 0], nk: [0.6, 0, 0], hd: [0.3, 0.2, 0.2] });
      const ground = {
        pp: [0.15, 0.13, 0.55], pr: [0.2, 0.3, 1.45], s1: [0.15, 0, 0.05], s2: [0.12, 0, 0], s3: [0.1, 0, 0],
        nk: [0.2, 0, 0.3], hd: [0.1, 0.3, 0.3],
        ua_l: [0.2, 0.3, 0.9], la_l: [-0.4, 0.4, 0.8], ha_l: [-0.5, 0.2, 0.8],
        ua_r: [-1, -0.9, 0.3], la_r: [-0.5, -0.5, 0.9], ha_r: [-0.3, -0.5, 1],
        th_l: [-0.5, -0.4, 0.8], ca_l: [-0.9, 0.0, -0.4], ft_l: [-0.3, 0.2, -1],
        th_r: [-0.7, -0.6, 0.4], ca_r: [-0.6, 0.2, -0.75], ft_r: [-0.2, 0.3, -1],
      };
      return t < 0.8 ? blendPose(SIT, slump, k2) : blendPose(slump, ground, ease(Math.min(1, (t - 0.8) / 1.2)));
    },
  },
  Stand_Idle: {
    duration: 4, pose: (t) => {
      const b = S((t / 4) * TAU);
      return with_(STAND, { s3: [b * 0.02, 0, 0], hd: [0, S((t / 4) * Math.PI) * 0.06, 0], pp: [0, 0.95 + b * 0.004, 0] });
    },
  },
  Sit_Stand: {
    duration: 1.4, loop: false, pose: (t) => blendPose(SIT, STAND, ease(Math.min(1, t / 1.4))),
  },
  Stand_Sit: {
    duration: 1.4, loop: false, pose: (t) => blendPose(STAND, SIT, ease(Math.min(1, t / 1.4))),
  },
  Wolf_Idle: {
    duration: 3, pose: (t) => {
      const b = S((t / 3) * TAU);
      return with_(SIT, { pr: [0.2, 0, 0], s2: [0.12, 0, 0], s3: [0.08 + b * 0.04, 0, 0], hd: [-0.2, b * 0.2, 0],
        ua_l: [0.3, -0.8, 0.5], la_l: [0.1, -0.6, 0.8], ua_r: [-0.3, -0.8, 0.5], la_r: [-0.1, -0.6, 0.8] });
    },
  },
  Wolf_Howl: {
    duration: 3.2, loop: false, pose: (t) => {
      const k = t < 0.6 ? ease(t / 0.6) : t > 2.6 ? 1 - ease((t - 2.6) / 0.6) : 1;
      return blendPose(SIT, with_(SIT, { pr: [-0.1, 0, 0], s3: [-0.15, 0, 0], nk: [-0.55, 0, 0], hd: [-0.45, 0, 0] }), k);
    },
  },
};
CLIP_DEFS.Walk = CLIP_DEFS.Stand_Idle;

/** Build AnimationClips for the procedural rig. */
export function buildProceduralClips() {
  const clips = {};
  const names = SKEL.map(([n]) => n);
  for (const [name, def] of Object.entries(CLIP_DEFS)) {
    const fps = 15;
    const frames = Math.max(2, Math.round(def.duration * fps) + 1);
    const times = new Float32Array(frames);
    const quats = Object.fromEntries(names.map((n) => [n, new Float32Array(frames * 4)]));
    const pelvisPos = new Float32Array(frames * 3);
    for (let f = 0; f < frames; f++) {
      const t = (f / (frames - 1)) * def.duration;
      times[f] = t;
      const { local, pelvis } = solve(def.pose(def.loop === false ? t : t % def.duration));
      for (const n of names) local[n].toArray(quats[n], f * 4);
      pelvisPos.set(pelvis, f * 3);
    }
    const tracks = names.map((n) => new THREE.QuaternionKeyframeTrack(`${n}.quaternion`, times, quats[n]));
    tracks.push(new THREE.VectorKeyframeTrack('pelvis.position', times, pelvisPos));
    const clip = new THREE.AnimationClip(name, def.duration, tracks);
    clip.userData = { loop: def.loop !== false };
    clips[name] = clip;
  }
  return clips;
}

// ------------------------------------------------------------------------------------------
// Bodies
// ------------------------------------------------------------------------------------------
const geoCache = new Map();
function geo(key, make) {
  if (!geoCache.has(key)) geoCache.set(key, make());
  return geoCache.get(key);
}
const capsule = (r, len) => geo(`cap${r}_${len}`, () => new THREE.CapsuleGeometry(r, len, 4, 10));
const sphere = (r, w = 14, h = 10) => geo(`sph${r}_${w}`, () => new THREE.SphereGeometry(r, w, h));
const box = (x, y, z) => geo(`box${x}_${y}_${z}`, () => new THREE.BoxGeometry(x, y, z));

const SKIN = ['#f1c7a5', '#e0a97f', '#c98b62', '#a86b45', '#7b4a2e', '#f4d2b8'];
export const PROCEDURAL_CAMPERS = [
  { id: 'camper_01', name: 'Tom', description: 'Chemise à carreaux rouge, toujours le premier au feu.', skin: 0, hair: '#5a3420', hairStyle: 'short', top: 'plaid', topA: '#b3262a', topB: '#1c1414', pants: '#3a4f72', shoes: '#5a3a22', scale: 1 },
  { id: 'camper_02', name: 'Léa', description: 'Pull crème et chapeau de paille.', skin: 5, hair: '#6b3e22', hairStyle: 'long', hat: 'straw', top: '#e9dfc8', pants: '#4b5f86', shoes: '#e8e8e8', scale: 0.95 },
  { id: 'camper_03', name: 'Bastien', description: 'Barbu, chapeau de cow-boy, la guitare jamais loin.', skin: 2, hair: '#3a2416', hairStyle: 'short', beard: true, hat: 'cowboy', top: '#a0622e', pants: '#4a3a2a', shoes: '#3a2a1a', scale: 1.04 },
  { id: 'camper_04', name: 'Zoé', description: 'Sweat clair, cheveux bruns ondulés.', skin: 1, hair: '#2e1c12', hairStyle: 'long', top: '#d8d4cf', pants: '#2f3b55', shoes: '#f0f0f0', scale: 0.94 },
  { id: 'camper_05', name: 'Mathis', description: 'Sweat à capuche marine, toujours pensif.', skin: 0, hair: '#4a2c1a', hairStyle: 'messy', top: '#28324a', pants: '#2c3446', shoes: '#4a3020', scale: 1 },
  { id: 'camper_06', name: 'Inès', description: 'Veste verte et bonnet rouge.', skin: 3, hair: '#1c1210', hairStyle: 'long', hat: 'beanie', hatColor: '#b8322c', top: '#4f6b3a', pants: '#3a3a3a', shoes: '#5a3a22', scale: 0.96 },
  { id: 'camper_07', name: 'Hugo', description: 'Ciré jaune et casquette, prêt pour la pluie.', skin: 1, hair: '#8a5a30', hairStyle: 'short', hat: 'cap', hatColor: '#2a4a7a', top: '#e0b830', pants: '#3a4252', shoes: '#2a2a2a', scale: 1.02 },
  { id: 'camper_08', name: 'Chloé', description: 'Polaire violette, queue de cheval blonde.', skin: 5, hair: '#d8b060', hairStyle: 'ponytail', top: '#6a4a8a', pants: '#2f3b55', shoes: '#c8c8c8', scale: 0.93 },
  { id: 'camper_09', name: 'Paul', description: 'Le doyen du camp, gilet en laine et barbe grise.', skin: 2, hair: '#9a9a9a', hairStyle: 'short', beard: true, top: 'plaid', topA: '#6a5a3a', topB: '#3a3020', pants: '#4a4a40', shoes: '#3a2a1a', scale: 1.0 },
  { id: 'camper_10', name: 'Nina', description: 'Ado aux cheveux bouclés, t-shirt orange.', skin: 4, hair: '#160e0a', hairStyle: 'curly', top: '#e07a2e', pants: '#3a4f72', shoes: '#e8e8e8', scale: 0.9 },
];

// Body parts are merged into ONE skinned mesh per character (rigid skinning, vertex colours, a
// material shared by every procedural character): 1 draw call instead of ~60. Only the animated face
// parts (eyelids, brows, mouth) stay separate small meshes.
const bodyMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });
bodyMaterial.name = 'procedural_body';
const faceMats = new Map();
function realMat(color) {
  if (!faceMats.has(color)) faceMats.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.75 }));
  return faceMats.get(color);
}
/** Colour descriptor for a merged body part. */
function mat(color) { return { color: new THREE.Color(color) }; }

let PARTS = null; // collector while building a character

function buildSkeleton() {
  const root = new THREE.Group();
  root.name = 'root';
  const bones = { root };
  const list = [];
  for (const [name, parent, p] of SKEL) {
    const b = new THREE.Bone();
    b.name = name;
    b.position.fromArray(p);
    bones[parent].add(b);
    bones[name] = b;
    list.push(b);
  }
  return { root, bones, list };
}

function add(bone, geometry, material, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1], name) {
  if (!material.isMaterial) {
    PARTS.push({ bone, geometry, color: material.color, pos, rot, scale });
    return null;
  }
  const m = new THREE.Mesh(geometry, material);
  m.position.fromArray(pos);
  m.rotation.set(rot[0], rot[1], rot[2]);
  m.scale.fromArray(scale);
  m.castShadow = false;
  m.receiveShadow = true;
  if (name) m.name = name;
  bone.add(m);
  return m;
}

function buildFace(bones, skinColor, opts) {
  const H = bones.Head;
  const white = mat('#f8f4ee');
  const iris = mat(opts.wolf ? '#ffcc22' : '#2a1a10');
  for (const side of ['l', 'r']) {
    const eb = bones[`eye_${side}`];
    add(eb, sphere(0.022, 12, 8), white, [0, 0, 0], [0, 0, 0], [1, 1, 0.7]);
    add(eb, sphere(0.012, 10, 8), iris, [0, 0, 0.012], [0, 0, 0], [1, 1, 0.5]);
    // eyelid: a dome rotating down over the eye (Blink), half way for EyesHalf
    const lidPivot = new THREE.Object3D();
    lidPivot.name = `lid_${side}`;
    H.add(lidPivot);
    lidPivot.position.copy(eb.position);
    add(lidPivot, geo('lid', () => new THREE.SphereGeometry(0.026, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2)), realMat(skinColor), [0, 0, 0], [0, 0, 0], [1, 1, 0.78]);
    const brow = add(H, box(0.04, 0.009, 0.012), realMat(opts.hair), [eb.position.x, eb.position.y + 0.036, eb.position.z + 0.012], [0, 0, 0], [1, 1, 1], `brow_${side}`);
    brow.userData.noOutline = true;
  }
  const mouth = add(H, sphere(0.022, 12, 8), realMat('#4a1a16'), [0, 0.045, 0.108], [0, 0, 0], [1.2, 0.18, 0.45], 'mouth');
  mouth.userData.noOutline = true;
}

function buildHair(bones, opts) {
  const H = bones.Head;
  const hm = mat(opts.hair);
  const style = opts.hairStyle;
  add(H, geo('hairCap', () => new THREE.SphereGeometry(0.128, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55)), hm, [0, 0.118, -0.008], [-0.15, 0, 0], [1.02, 1.05, 1.06]);
  if (style === 'long' || style === 'ponytail' || style === 'curly') {
    add(H, capsule(0.1, 0.12), hm, [0, 0.06, -0.06], [0.15, 0, 0], [1.25, 1, 0.7]);
  }
  if (style === 'ponytail') add(H, capsule(0.035, 0.14), hm, [0, 0.12, -0.15], [0.7, 0, 0]);
  if (style === 'curly') {
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      add(H, sphere(0.05, 8, 6), hm, [Math.cos(a) * 0.1, 0.17 + Math.sin(i) * 0.02, Math.sin(a) * 0.09 - 0.01]);
    }
  }
  if (style === 'messy') {
    for (let i = 0; i < 5; i++) add(H, sphere(0.04, 8, 6), hm, [(i - 2) * 0.04, 0.215, 0.03 - (i % 2) * 0.04]);
  }
  if (opts.beard) add(H, sphere(0.1, 12, 8), hm, [0, 0.04, 0.035], [0, 0, 0], [0.95, 0.75, 0.85]);
  if (opts.hat === 'cowboy' || opts.hat === 'straw') {
    const hc = mat(opts.hat === 'straw' ? '#d8b878' : '#b88a52');
    add(H, geo('brim', () => new THREE.CylinderGeometry(0.26, 0.26, 0.012, 20)), hc, [0, 0.2, 0], [-0.08, 0, 0]);
    add(H, geo('crown', () => new THREE.CylinderGeometry(0.1, 0.125, 0.12, 14)), hc, [0, 0.26, -0.005], [-0.08, 0, 0]);
    add(H, geo('band', () => new THREE.CylinderGeometry(0.126, 0.126, 0.025, 14)), mat('#5a2a1a'), [0, 0.215, -0.004], [-0.08, 0, 0]);
  } else if (opts.hat === 'beanie') {
    add(H, geo('beanie', () => new THREE.SphereGeometry(0.135, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.5)), mat(opts.hatColor), [0, 0.135, -0.005], [-0.12, 0, 0]);
    add(H, sphere(0.035, 8, 6), mat('#f0e8e0'), [0, 0.27, -0.03]);
  } else if (opts.hat === 'cap') {
    add(H, geo('capTop', () => new THREE.SphereGeometry(0.132, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.5)), mat(opts.hatColor), [0, 0.13, -0.005], [-0.1, 0, 0]);
    add(H, box(0.16, 0.012, 0.11), mat(opts.hatColor), [0, 0.15, 0.13], [-0.25, 0, 0]);
  }
}

const _pm = new THREE.Matrix4();
const _pq = new THREE.Quaternion();
const _pe = new THREE.Euler();
const _pv = new THREE.Vector3();
const _ps = new THREE.Vector3();

function mergeParts(root, boneList) {
  root.updateMatrixWorld(true);
  const index = new Map(boneList.map((b, i) => [b, i]));
  const geos = [];
  for (const part of PARTS) {
    const g = part.geometry.clone();
    _pm.compose(_pv.fromArray(part.pos), _pq.setFromEuler(_pe.set(part.rot[0], part.rot[1], part.rot[2])), _ps.fromArray(part.scale));
    // rigid parts may hang from a non-bone pivot: walk up to the bone
    let bone = part.bone;
    while (bone && !index.has(bone)) bone = bone.parent;
    _pm.premultiply(part.bone.matrixWorld);
    g.applyMatrix4(_pm);
    const n = g.attributes.position.count;
    const color = new Float32Array(n * 3);
    // soft vertical shading baked in the vertex colours (cheap fake AO)
    for (let i = 0; i < n; i++) {
      const y = g.attributes.position.getY(i);
      const k = 0.88 + 0.12 * Math.min(1, Math.max(0, y / 1.7));
      color[i * 3] = part.color.r * k;
      color[i * 3 + 1] = part.color.g * k;
      color[i * 3 + 2] = part.color.b * k;
    }
    const bi = index.get(bone) ?? 0;
    const skinIndex = new Uint16Array(n * 4);
    const skinWeight = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      skinIndex[i * 4] = bi;
      skinWeight[i * 4] = 1;
    }
    g.setAttribute('color', new THREE.BufferAttribute(color, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color', 'skinIndex', 'skinWeight'].includes(k)) g.deleteAttribute(k);
    geos.push(g);
  }
  const allIndexed = geos.every((g) => g.index);
  const merged = mergeGeometries(allIndexed ? geos : geos.map((g) => (g.index ? g.toNonIndexed() : g)));
  for (const g of geos) g.dispose();
  const mesh = new THREE.SkinnedMesh(merged, bodyMaterial);
  mesh.name = 'body';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  root.add(mesh);
  root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(boneList));
  return mesh;
}

/** Build one procedural character template (camper or werewolf). */
export function buildProceduralCharacter(opts) {
  const { root, bones, list } = buildSkeleton();
  PARTS = [];
  const wolf = !!opts.wolf;
  const skinColor = wolf ? '#5b4a3f' : SKIN[opts.skin ?? 0];
  const skinMat = mat(skinColor);
  const topMat = mat(wolf ? '#4d3e35' : opts.top === 'plaid' ? opts.topA : opts.top);
  const pantsMat = mat(opts.pants || '#3a4a5a');
  const shoeMat = mat(opts.shoes || '#3a2a1a');

  // torso
  add(bones.pelvis, sphere(0.17), pantsMat, [0, 0.02, -0.01], [0, 0, 0], [1.05, 0.72, 0.8]);
  add(bones.spine_01, sphere(0.155), topMat, [0, 0.07, 0], [0, 0, 0], [1.05, 0.95, 0.78]);
  add(bones.spine_03, capsule(0.165, 0.14), topMat, [0, 0.03, -0.005], [0, 0, 0], [1.18, 1, 0.78]);
  if (opts.top === 'plaid') {
    // darker plaid bands across the chest and belly
    add(bones.spine_03, geo('band1', () => new THREE.CylinderGeometry(0.168, 0.168, 0.035, 14, 1, true)), mat(opts.topB), [0, 0.06, -0.005], [0, 0, 0], [1.19, 1, 0.79]);
    add(bones.spine_01, geo('band2', () => new THREE.CylinderGeometry(0.158, 0.158, 0.03, 14, 1, true)), mat(opts.topB), [0, 0.04, 0], [0, 0, 0], [1.06, 1, 0.79]);
  }
  add(bones.neck_01, capsule(0.052, 0.08), skinMat, [0, 0.04, 0]);
  // head
  add(bones.Head, sphere(0.125, 18, 14), skinMat, [0, 0.105, 0], [0, 0, 0], wolf ? [1.05, 1.0, 1.0] : [0.95, 1.08, 1.0]);
  add(bones.Head, sphere(0.022, 8, 6), skinMat, [0, 0.075, 0.125], [0, 0, 0], [1, 0.9, 1]); // nose
  for (const s of [1, -1]) add(bones.Head, sphere(0.03, 8, 6), skinMat, [s * 0.12, 0.1, 0], [0, 0, 0], [0.5, 1, 0.8]);
  if (wolf) {
    add(bones.Head, geo('snout', () => new THREE.CylinderGeometry(0.045, 0.075, 0.15, 10).rotateX(Math.PI / 2)), skinMat, [0, 0.06, 0.15]);
    add(bones.Head, sphere(0.025, 8, 6), mat('#1a1210'), [0, 0.075, 0.23]);
    for (const s of [1, -1]) add(bones.Head, geo('ear', () => new THREE.ConeGeometry(0.045, 0.13, 6)), skinMat, [s * 0.08, 0.23, -0.02], [0, 0, -s * 0.25]);
    add(bones.spine_03, sphere(0.2), skinMat, [0, 0.12, -0.03], [0, 0, 0], [1.25, 0.8, 0.85]); // fur ruff
    add(bones.pelvis, geo('tail', () => new THREE.ConeGeometry(0.07, 0.5, 8).rotateX(-Math.PI * 0.6)), skinMat, [0, -0.02, -0.25]);
  } else {
    buildHair(bones, opts);
  }
  buildFace(bones, skinColor, { wolf, hair: wolf ? '#2a201a' : opts.hair });
  // arms and legs
  for (const s of ['l', 'r']) {
    const sign = s === 'l' ? 1 : -1;
    add(bones[`upperarm_${s}`], capsule(0.058, 0.18), topMat, [sign * 0.135, 0, 0], [0, 0, Math.PI / 2]);
    add(bones[`lowerarm_${s}`], capsule(0.048, 0.17), opts.rolled ? skinMat : topMat, [sign * 0.12, 0, 0], [0, 0, Math.PI / 2]);
    add(bones[`hand_${s}`], sphere(0.05, 10, 8), skinMat, [sign * 0.055, 0, 0], [0, 0, 0], [1.25, 0.6, 0.95]);
    add(bones[`hand_${s}`], capsule(0.016, 0.03), skinMat, [sign * 0.02, 0.0, 0.045], [Math.PI / 2, 0, 0]); // thumb
    add(bones[`thigh_${s}`], capsule(0.08, 0.3), pantsMat, [0, -0.21, 0]);
    add(bones[`calf_${s}`], capsule(0.062, 0.3), pantsMat, [0, -0.21, 0]);
    add(bones[`foot_${s}`], box(0.11, 0.085, 0.25), shoeMat, [0, -0.035, 0.06]);
  }
  mergeParts(root, list);
  PARTS = null;
  root.scale.setScalar((opts.scale || 1) * (wolf ? 1.15 : 1));
  root.userData.procedural = true;
  return root;
}

/** Face controller for procedural rigs (same API as the morph-target face). */
export class ProceduralFace {
  constructor(root) {
    this.lids = ['lid_l', 'lid_r'].map((n) => root.getObjectByName(n)).filter(Boolean);
    this.mouth = root.getObjectByName('mouth');
    this.brows = ['brow_l', 'brow_r'].map((n) => root.getObjectByName(n)).filter(Boolean);
    this.pupils = ['pupil_l', 'pupil_r'].map((n) => root.getObjectByName(n)).filter(Boolean);
    this.browBase = this.brows.map((b) => b.position.y);
  }
  /** values: { Blink, EyesHalf, MouthOpen, Smile, Worried } in 0..1 */
  apply(v) {
    const closed = Math.max(v.Blink, v.EyesHalf * 0.72);
    const angle = -0.9 + closed * (Math.PI / 2 + 0.9);
    for (const l of this.lids) l.rotation.x = angle;
    if (this.mouth) {
      this.mouth.scale.y = 0.18 + v.MouthOpen * 0.75;
      this.mouth.scale.x = 1.2 + v.Smile * 0.4 - v.MouthOpen * 0.2;
    }
    this.brows.forEach((b, i) => {
      const s = i === 0 ? 1 : -1;
      b.rotation.z = s * (v.Worried * 0.35 - v.Smile * 0.05);
      b.position.y = this.browBase[i] + v.Worried * 0.006;
    });
  }
}
