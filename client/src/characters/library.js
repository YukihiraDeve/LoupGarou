// Character library: real GLBs (manifest.json, camper_XX.glb, werewolf.glb, anims.glb) when they
// exist, procedural stand-ins otherwise. Same interface either way.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { AVATARS } from '@shared/protocol.js';
import { fetchJSON, loadGLB, reportProgress } from '../engine/assets.js';
import { buildProceduralClips, buildProceduralCharacter, PROCEDURAL_CAMPERS } from './procedural.js';

export const CLIP_NAMES = [
  'Sit_Idle', 'Sit_Talk', 'Sit_Sleep', 'Sit_Awake_Night', 'Sit_Point', 'Sit_RaiseHand', 'Sit_Nod', 'Sit_Shake',
  'Sit_Shocked', 'Sit_Death', 'Sit_Stand', 'Stand_Sit', 'Stand_Idle', 'Walk', 'Wolf_Howl', 'Wolf_Idle',
];
const LOOPING = new Set(['Sit_Idle', 'Sit_Talk', 'Sit_Sleep', 'Sit_Awake_Night', 'Stand_Idle', 'Walk', 'Wolf_Idle']);
const FALLBACK = {
  Sit_Awake_Night: 'Sit_Idle', Sit_Talk: 'Sit_Idle', Sit_Sleep: 'Sit_Idle', Sit_Point: 'Sit_RaiseHand',
  Sit_RaiseHand: 'Sit_Point', Wolf_Idle: 'Sit_Awake_Night', Wolf_Howl: 'Sit_Awake_Night', Stand_Idle: 'Sit_Idle',
};
const PELVIS_ABOVE_SEAT = 0.08; // hip joint height above the seat surface

/** Keep rotations; keep translations only on the root/pelvis; drop scales (proportions differ). */
function cleanClip(clip) {
  const name = clip.name.includes('|') ? clip.name.split('|').pop() : clip.name;
  const tracks = clip.tracks.filter((t) => {
    const [node, prop] = [t.name.slice(0, t.name.lastIndexOf('.')), t.name.slice(t.name.lastIndexOf('.') + 1)];
    if (prop === 'scale') return false;
    if (prop === 'position') return /^(root|pelvis|hips)$/i.test(node);
    return true;
  });
  const out = new THREE.AnimationClip(name, clip.duration, tracks);
  out.userData = { loop: LOOPING.has(name) };
  return out;
}

export class CharacterLibrary {
  constructor() {
    this.real = false;
    this.entries = [];
    this.templates = new Map(); // id -> { scene, kind, info }
    this.wolf = null;
    this.clips = {};
    this.proceduralClips = buildProceduralClips();
  }

  async init() {
    reportProgress('characters', 0, 4);
    const manifest = await fetchJSON('characters/manifest.json');
    let anims = null;
    if (manifest) {
      const animFile = manifest.anims?.file || manifest.animations?.file || manifest.animsFile || 'anims.glb';
      anims = await loadGLB(`characters/${animFile}`, 'anims');
    }
    if (manifest && anims?.animations?.length) {
      for (const clip of anims.animations) {
        const c = cleanClip(clip);
        this.clips[c.name] = c;
      }
      const list = Array.isArray(manifest) ? manifest : manifest.characters || manifest.campers || manifest.avatars || [];
      const entries = list.filter((e) => e && (e.id || e.file));
      const loads = entries.map(async (e, i) => {
        const id = e.id || e.file.replace(/\.glb$/, '');
        const gltf = await loadGLB(`characters/${e.file || id + '.glb'}`, `char_${i}`);
        if (gltf) this.templates.set(id, { scene: gltf.scene, kind: 'glb', info: { ...e, id } });
      });
      const wolfFile = manifest.werewolf?.file || (typeof manifest.werewolf === 'string' ? manifest.werewolf : 'werewolf.glb');
      loads.push(loadGLB(`characters/${wolfFile}`, 'wolf').then((g) => {
        if (g) this.wolf = { scene: g.scene, kind: 'glb', info: { id: 'werewolf', name: 'Loup-Garou' } };
      }));
      await Promise.all(loads);
      this.real = this.templates.size > 0;
      this.entries = entries.map((e) => ({ id: e.id || e.file.replace(/\.glb$/, ''), name: e.name, description: e.description }));
    }
    if (!this.real) {
      this.clips = this.proceduralClips;
      this.entries = PROCEDURAL_CAMPERS.map(({ id, name, description }) => ({ id, name, description }));
    } else {
      for (const n of CLIP_NAMES) {
        if (!this.clips[n] && this.clips[FALLBACK[n]]) this.clips[n] = this.clips[FALLBACK[n]];
      }
      for (const t of this.templates.values()) this.prepareGLB(t.scene);
      if (this.wolf) this.prepareGLB(this.wolf.scene);
    }
    // every lobby avatar exists (procedural stand-in for missing files)
    for (const id of AVATARS) {
      if (!this.templates.has(id)) {
        const info = PROCEDURAL_CAMPERS.find((c) => c.id === id) || PROCEDURAL_CAMPERS[0];
        this.templates.set(id, { scene: buildProceduralCharacter(info), kind: 'procedural', info });
      }
      if (!this.entries.find((e) => e.id === id)) {
        const info = PROCEDURAL_CAMPERS.find((c) => c.id === id);
        this.entries.push({ id, name: info?.name || id, description: info?.description || '' });
      }
    }
    if (!this.wolf) {
      this.wolf = { scene: buildProceduralCharacter({ wolf: true, pants: '#3d3a40', shoes: '#2a201a', scale: 1 }), kind: 'procedural', info: { id: 'werewolf' } };
    }
    // seat placement measurements (pelvis and eyes in the sitting pose)
    for (const t of this.templates.values()) this.measure(t);
    this.measure(this.wolf);
    reportProgress('characters', 1, 4);
    console.info(`[personnages] ${this.real ? `${this.templates.size} GLB + anims.glb (${Object.keys(this.clips).length} clips)` : 'procéduraux (assets absents)'}`);
  }

  prepareGLB(scene) {
    scene.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false; // skinned bounds are unreliable when sitting
      }
    });
  }

  clipsFor(template) {
    return template.kind === 'procedural' ? this.proceduralClips : this.clips;
  }

  /** Sitting pose measurements: pelvis offset (root space) and eye position (root space). */
  measure(t) {
    const root = SkeletonUtils.clone(t.scene);
    const clips = this.clipsFor(t);
    const mixer = new THREE.AnimationMixer(root);
    const clip = clips.Sit_Idle || Object.values(clips)[0];
    if (clip) {
      mixer.clipAction(clip).play();
      mixer.update(0);
    }
    root.updateMatrixWorld(true);
    const pelvis = root.getObjectByName('pelvis') || root.getObjectByName('Hips') || root;
    const head = root.getObjectByName('Head');
    const eyeL = root.getObjectByName('eye_l');
    const eyeR = root.getObjectByName('eye_r');
    const p = pelvis.getWorldPosition(new THREE.Vector3());
    let eyes;
    if (eyeL && eyeR) {
      eyes = eyeL.getWorldPosition(new THREE.Vector3()).add(eyeR.getWorldPosition(new THREE.Vector3())).multiplyScalar(0.5);
    } else if (head) {
      eyes = head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.1, 0.09));
    } else {
      eyes = new THREE.Vector3(0, 1.2, 0.1);
    }
    const neck = root.getObjectByName('neck_01') || head;
    const thigh = root.getObjectByName('thigh_l');
    const calf = root.getObjectByName('calf_l');
    const thighLen = thigh && calf ? thigh.getWorldPosition(new THREE.Vector3()).distanceTo(calf.getWorldPosition(new THREE.Vector3())) : 0.42;
    t.sit = {
      pelvis: p,
      eyes,
      neck: neck ? neck.getWorldPosition(new THREE.Vector3()) : eyes.clone(),
      thighLen: Math.max(0.2, thighLen),
      // manifest.json (seat note): in every Sit_* clip the pelvis joint lies ON the seat surface
      pelvisAboveSeat: t.info?.pelvisAboveSeat ?? (t.kind === 'glb' ? 0 : PELVIS_ABOVE_SEAT),
    };
    mixer.stopAllAction();
  }

  list() {
    return AVATARS.map((id) => this.entries.find((e) => e.id === id) || { id, name: id, description: '' });
  }

  template(id) {
    return this.templates.get(id) || this.templates.get(AVATARS[0]);
  }

  instantiate(id) {
    const t = id === 'werewolf' ? this.wolf : this.template(id);
    const root = SkeletonUtils.clone(t.scene);
    return { root, template: t, clips: this.clipsFor(t), kind: t.kind };
  }
}
