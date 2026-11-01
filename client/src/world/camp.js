// Camp loading: camp.glb + camp_manifest.json when present, otherwise a procedural stand-in that
// exposes the same markers (fire, seat_00..15, light_*, cam_intro, EMIT_* materials).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { fetchJSON, assetExists, loadGLB, reportProgress } from '../engine/assets.js';
import { MAX_PLAYERS } from '@shared/protocol.js';
import { rng } from '../util/math.js';

const SEAT_RADIUS = 3.5;
const SEAT_HEIGHT = 0.45;
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();

function seatFromWorld(index, obj, fire) {
  obj.updateWorldMatrix(true, false);
  obj.matrixWorld.decompose(_v, _q, _s);
  const position = _v.clone();
  const quaternion = _q.clone();
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion);
  forward.y = 0;
  forward.normalize();
  const toFire = fire.clone().sub(position).setY(0).normalize();
  if (forward.dot(toFire) < 0.7) {
    // tolerate a marker exported with another axis convention: face the fire
    forward.copy(toFire);
  }
  quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(forward.x, forward.z));
  return { index, position, quaternion, forward };
}

function defaultSeat(index, fire) {
  const phi = Math.PI + (index * Math.PI * 2) / MAX_PLAYERS;
  const position = new THREE.Vector3(Math.sin(phi) * SEAT_RADIUS, SEAT_HEIGHT, Math.cos(phi) * SEAT_RADIUS).add(
    new THREE.Vector3(fire.x, 0, fire.z),
  );
  const forward = fire.clone().sub(position).setY(0).normalize();
  const quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(forward.x, forward.z));
  return { index, position, quaternion, forward };
}

function finalizeIntro(camp, node) {
  const fireTarget = camp.fire.clone().add(new THREE.Vector3(0, 0.7, 0));
  if (node) {
    const cam = node.isCamera ? node : node.children.find((c) => c.isCamera);
    node.updateWorldMatrix(true, true);
    if (cam) {
      cam.matrixWorld.decompose(_v, _q, _s);
      camp.intro = { position: _v.clone(), quaternion: _q.clone(), fov: cam.fov || 45, target: null };
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(_q);
      camp.intro.target = _v.clone().add(fwd.multiplyScalar(10));
      return;
    }
    node.getWorldPosition(_v);
    camp.intro = { position: _v.clone(), quaternion: null, fov: 45, target: fireTarget };
    return;
  }
  camp.intro = { position: camp.fire.clone().add(new THREE.Vector3(0, 2.7, 10.5)), quaternion: null, fov: 45, target: fireTarget };
}

export async function loadCamp(quality) {
  reportProgress('camp', 0, 3);
  const manifest = await fetchJSON('camp/camp_manifest.json');
  let gltf = null;
  if (manifest || (await assetExists('camp/camp.glb'))) gltf = await loadGLB('camp/camp.glb', 'camp');
  const camp = gltf ? fromGLTF(gltf, manifest, quality) : buildProceduralCamp(quality);
  reportProgress('camp', 1, 3);
  console.info(`[camp] ${camp.source === 'glb' ? 'camp.glb chargé' : 'camp procédural (camp.glb absent)'}`);
  return camp;
}

function fromGLTF(gltf, manifest, quality) {
  const root = gltf.scene;
  root.name = 'camp';
  const camp = { root, source: 'glb', manifest, fire: new THREE.Vector3(), seats: [], lights: [], intro: null };
  const seatNodes = new Map();
  let fireNode = null;
  let introNode = null;
  const lightNodes = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const n = o.name || '';
    if (n === 'fire') fireNode = o;
    else if (/^seat_\d\d$/.test(n)) seatNodes.set(parseInt(n.slice(5), 10), o);
    else if (n === 'cam_intro') introNode = o;
    else if (/^light_(lantern|window|string)_\d+/.test(n)) lightNodes.push(o);
    if (o.isMesh) {
      const matName = (Array.isArray(o.material) ? o.material[0]?.name : o.material?.name) || '';
      const ground = /ground|terrain|sol|floor|mountain/i.test(n) || /^(ground|ground_far|mountain|grass)$/i.test(matName);
      // manifest note: only nearby objects deserve to cast shadows (bark, wood, stone, fabric, paint)
      const caster = /bark|wood|stone|fabric|paint/i.test(n) || /^(bark|wood|stone|fabric|paint)$/i.test(matName);
      o.receiveShadow = !/mountain|treeline/i.test(n);
      o.castShadow = !ground && caster && !o.isInstancedMesh;
      o.frustumCulled = true;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m?.name?.startsWith('EMIT_')) {
          o.castShadow = false;
          m.toneMapped = true;
        }
      }
    }
  });
  if (fireNode) fireNode.getWorldPosition(camp.fire);
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const node = seatNodes.get(i);
    camp.seats.push(node ? seatFromWorld(i, node, camp.fire) : defaultSeat(i, camp.fire));
  }
  for (const o of lightNodes) {
    const kind = o.name.split('_')[1];
    const position = o.getWorldPosition(new THREE.Vector3());
    // colours and ranges recommended by camp_manifest.json
    camp.lights.push({
      kind, name: o.name, position,
      color: kind === 'window' ? 0xffa04a : kind === 'string' ? 0xffc777 : 0xff9a40,
      intensity: kind === 'string' ? 2.2 : kind === 'window' ? 3.5 : 3.2,
      distance: kind === 'string' ? 4.5 : kind === 'window' ? 7.5 : 5,
    });
  }
  sortLights(camp);
  finalizeIntro(camp, introNode);
  return camp;
}

function sortLights(camp) {
  const rank = { lantern: 0, string: 1, window: 2 };
  camp.lights.sort((a, b) => {
    const ra = rank[a.kind] ?? 3;
    const rb = rank[b.kind] ?? 3;
    if (ra !== rb) return ra - rb;
    return a.position.distanceToSquared(camp.fire) - b.position.distanceToSquared(camp.fire);
  });
  // interleave kinds so a small light budget still spreads around the camp
  const byKind = { lantern: [], string: [], window: [] };
  for (const l of camp.lights) (byKind[l.kind] || byKind.lantern).push(l);
  const out = [];
  while (out.length < camp.lights.length) {
    for (const k of ['lantern', 'string', 'lantern', 'window']) if (byKind[k].length) out.push(byKind[k].shift());
  }
  camp.lights = out;
}

// ---------------------------------------------------------------------------------------------
// Procedural stand-in
// ---------------------------------------------------------------------------------------------
function std(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, ...extra });
}
function emit(name, color, intensity = 2.5) {
  const m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.6 });
  m.name = name;
  return m;
}

function buildProceduralCamp(quality) {
  const R = rng(1234);
  const root = new THREE.Group();
  root.name = 'camp';
  const fire = new THREE.Vector3(0, 0, 0);
  const camp = { root, source: 'procedural', manifest: null, fire, seats: [], lights: [], intro: null };

  // --- ground with vertex colours (dirt around the fire, grass outside, paths)
  const ground = new THREE.PlaneGeometry(220, 220, 110, 110).rotateX(-Math.PI / 2);
  const pos = ground.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const dirt = new THREE.Color('#6e4a30');
  const dirtDark = new THREE.Color('#4d3322');
  const grass = new THREE.Color('#3d5a26');
  const grass2 = new THREE.Color('#58702e');
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    const n = Math.sin(x * 0.7) * Math.cos(z * 0.6) * 0.5 + Math.sin(x * 2.3 + z * 1.7) * 0.25 + (R() - 0.5) * 0.4;
    const path = Math.exp(-Math.pow(Math.abs(x - z * 0.15) - 0, 2) / 2.5) * (z > 0 ? 1 : 0) +
      Math.exp(-Math.pow(z + x * 0.6, 2) / 2.0) * (x < 0 ? 1 : 0);
    const dirtW = THREE.MathUtils.smoothstep(r, 9.5, 5.5) + Math.min(path, 1) * THREE.MathUtils.smoothstep(r, 26, 6) * 0.85;
    c.copy(grass).lerp(grass2, THREE.MathUtils.clamp(0.5 + n, 0, 1));
    const d = dirt.clone().lerp(dirtDark, THREE.MathUtils.clamp(0.5 + n * 0.8 + (r < 1.6 ? 0.6 : 0), 0, 1));
    c.lerp(d, THREE.MathUtils.clamp(dirtW + n * 0.15, 0, 1));
    colors.set([c.r, c.g, c.b], i * 3);
    if (r > 11) pos.setY(i, (Math.sin(x * 0.18) * Math.cos(z * 0.21) + 1) * 0.35 * THREE.MathUtils.smoothstep(r, 11, 30));
  }
  ground.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  ground.computeVertexNormals();
  const groundMesh = new THREE.Mesh(ground, std(0xffffff, { vertexColors: true, roughness: 1 }));
  groundMesh.name = 'ground';
  groundMesh.receiveShadow = true;
  root.add(groundMesh);

  // --- fire pit: stones, logs, embers
  const stoneGeo = new THREE.DodecahedronGeometry(0.17, 0);
  const stoneMat = std(0x7d7368, { flatShading: true });
  const stones = new THREE.InstancedMesh(stoneGeo, stoneMat, 13);
  for (let i = 0; i < 13; i++) {
    const a = (i / 13) * Math.PI * 2 + R() * 0.2;
    _m.compose(
      _v.set(Math.cos(a) * 0.72, 0.07, Math.sin(a) * 0.72),
      _q.setFromEuler(new THREE.Euler(R() * 3, R() * 3, R() * 3)),
      _s.set(1 + R() * 0.5, 0.7 + R() * 0.4, 1 + R() * 0.4),
    );
    stones.setMatrixAt(i, _m);
  }
  stones.castShadow = true;
  stones.receiveShadow = true;
  root.add(stones);
  const charMat = std(0x2b1d14);
  const barkMat = std(0x5a3a22, { flatShading: true });
  const woodMat = std(0xb98a5a);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.075, 0.95, 7), [charMat, woodMat, woodMat]);
    log.position.set(Math.cos(a) * 0.22, 0.28, Math.sin(a) * 0.22);
    log.rotation.set(0, -a, 0);
    log.rotateZ(0.95);
    log.castShadow = true;
    root.add(log);
  }
  const embers = new THREE.Mesh(new THREE.CircleGeometry(0.5, 16).rotateX(-Math.PI / 2), emit('EMIT_embers', 0xff5a14, 1.6));
  embers.position.y = 0.04;
  root.add(embers);

  // --- log benches: 8 logs, 2 seats each, top surface at 0.45 m
  const benchGeo = new THREE.CylinderGeometry(0.24, 0.24, 2.25, 12, 1).rotateZ(Math.PI / 2);
  for (let k = 0; k < MAX_PLAYERS / 2; k++) {
    const a0 = Math.PI + ((2 * k) * Math.PI * 2) / MAX_PLAYERS;
    const a1 = Math.PI + ((2 * k + 1) * Math.PI * 2) / MAX_PLAYERS;
    const am = (a0 + a1) / 2;
    const rr = SEAT_RADIUS * Math.cos(Math.PI / MAX_PLAYERS) + 0.06;
    const log = new THREE.Mesh(benchGeo, [barkMat, woodMat, woodMat]);
    log.position.set(Math.sin(am) * rr, SEAT_HEIGHT - 0.24, Math.cos(am) * rr);
    log.rotation.y = am + Math.PI / 2;
    log.castShadow = true;
    log.receiveShadow = true;
    root.add(log);
  }
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const s = defaultSeat(i, fire);
    camp.seats.push(s);
    const marker = new THREE.Object3D();
    marker.name = `seat_${String(i).padStart(2, '0')}`;
    marker.position.copy(s.position);
    marker.quaternion.copy(s.quaternion);
    root.add(marker);
  }

  // --- pine trees (instanced)
  const foliageParts = [];
  for (let k = 0; k < 4; k++) {
    const h = 2.6 - k * 0.45;
    foliageParts.push(new THREE.ConeGeometry(1.7 - k * 0.32, h, 8).translate(0, 1.6 + k * 1.15 + h / 2, 0));
  }
  const foliageGeo = mergeGeometries(foliageParts);
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.24, 2.0, 6).translate(0, 1.0, 0);
  const foliageMat = std(0x24432a, { flatShading: true });
  const trunkMat = std(0x4a3020);
  const placed = [];
  const blocked = (x, z, minD) => placed.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < minD * minD);
  const reserve = [
    { x: -7.5, z: 6.5, r: 3.5 }, { x: 8.5, z: 5.5, r: 3.5 }, { x: -10.5, z: -3, r: 3.5 }, { x: 10.5, z: -4.5, r: 3.5 },
    { x: -2.5, z: -11.5, r: 4.5 }, { x: 12.5, z: -12.5, r: 5 }, { x: -15, z: -10, r: 6 }, { x: 16, z: 8, r: 4 },
  ];
  const treeCount = 130;
  const trees = [];
  let guard = 0;
  while (trees.length < treeCount && guard++ < 4000) {
    const a = R() * Math.PI * 2;
    const r = 13 + Math.pow(R(), 0.8) * 42;
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r;
    if (z > 6 && Math.abs(x) < 4 + (z - 6) * 0.25 && r < 26) continue; // keep the intro view open
    if (reserve.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < p.r * p.r)) continue;
    if (blocked(x, z, 2.2)) continue;
    placed.push({ x, z });
    trees.push({ x, z, s: 0.8 + R() * 0.9, rot: R() * 6 });
  }
  const foliage = new THREE.InstancedMesh(foliageGeo, foliageMat, trees.length);
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, trees.length);
  trees.forEach((t, i) => {
    _m.compose(_v.set(t.x, -0.05, t.z), _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rot), _s.set(t.s, t.s * (0.9 + (i % 5) * 0.08), t.s));
    foliage.setMatrixAt(i, _m);
    trunks.setMatrixAt(i, _m);
  });
  foliage.castShadow = quality.tier.treeShadows;
  trunks.castShadow = quality.tier.treeShadows;
  foliage.receiveShadow = true;
  root.add(foliage, trunks);

  // --- tents (A-frame prisms)
  const tentShape = new THREE.Shape();
  tentShape.moveTo(-1.15, 0);
  tentShape.lineTo(0, 1.65);
  tentShape.lineTo(1.15, 0);
  tentShape.lineTo(-1.15, 0);
  const tentGeo = new THREE.ExtrudeGeometry(tentShape, { depth: 2.6, bevelEnabled: false }).translate(0, 0, -1.3);
  const doorGeo = new THREE.ShapeGeometry((() => {
    const s = new THREE.Shape();
    s.moveTo(-0.5, 0); s.lineTo(0, 1.1); s.lineTo(0.5, 0); s.lineTo(-0.5, 0);
    return s;
  })());
  const tentColors = [0xd9c9a3, 0xc8683a, 0x6f8a4a, 0xd9c9a3, 0x8a5a3a];
  const tents = [
    { x: -7.5, z: 6.5 }, { x: 8.5, z: 5.5 }, { x: -10.5, z: -3 }, { x: 10.5, z: -4.5 }, { x: 16, z: 8 },
  ];
  tents.forEach((t, i) => {
    const g = new THREE.Group();
    const tent = new THREE.Mesh(tentGeo, std(tentColors[i % tentColors.length], { flatShading: true, side: THREE.DoubleSide }));
    tent.castShadow = true;
    tent.receiveShadow = true;
    g.add(tent);
    const door = new THREE.Mesh(doorGeo, std(0x2a1d16, { side: THREE.DoubleSide }));
    door.position.set(0, 0.01, 1.31);
    g.add(door);
    g.position.set(t.x, 0, t.z);
    g.rotation.y = Math.atan2(-t.x, -t.z) + Math.PI / 2 * 0; // door faces the fire
    g.lookAt(0, 0, 0);
    root.add(g);
    // lantern near the tent
    const side = new THREE.Vector3(t.x, 0, t.z).normalize();
    const lp = new THREE.Vector3(t.x, 0, t.z).sub(side.clone().multiplyScalar(1.9)).add(new THREE.Vector3(side.z, 0, -side.x).multiplyScalar(1.3));
    addLantern(root, camp, lp, 1.1);
  });

  // --- cabins with glowing windows
  const logWall = std(0x7a4f2e, { flatShading: true });
  const roofMat = std(0x3b2a22, { flatShading: true });
  const windowMat = emit('EMIT_window', 0xffb050, 2.2);
  const cabins = [{ x: -15, z: -10, rot: 0 }, { x: 12.5, z: -12.5, rot: 0 }];
  cabins.forEach((cb, i) => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(4.6, 2.6, 3.6), logWall);
    body.position.y = 1.3;
    body.castShadow = true;
    body.receiveShadow = true;
    const roofShape = new THREE.Shape();
    roofShape.moveTo(-2.75, 0); roofShape.lineTo(0, 1.6); roofShape.lineTo(2.75, 0); roofShape.lineTo(-2.75, 0);
    const roof = new THREE.Mesh(new THREE.ExtrudeGeometry(roofShape, { depth: 4.2, bevelEnabled: false }).translate(0, 0, -2.1), roofMat);
    roof.position.y = 2.6;
    roof.castShadow = true;
    const win1 = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.8), windowMat);
    win1.position.set(-1.1, 1.5, 1.81);
    const win2 = win1.clone();
    win2.position.x = 1.1;
    const door = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.8), std(0x3a2416));
    door.position.set(0, 0.9, 1.815);
    const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.4, 0.5), std(0x6a625a, { flatShading: true }));
    chimney.position.set(1.4, 3.6, -0.6);
    g.add(body, roof, win1, win2, door, chimney);
    g.position.set(cb.x, 0, cb.z);
    g.lookAt(0, 0, 0);
    root.add(g);
    g.updateMatrixWorld(true);
    for (const w of [win1, win2]) {
      const p = w.getWorldPosition(new THREE.Vector3());
      const out = new THREE.Vector3(0, 0, 0.8).applyQuaternion(g.quaternion);
      camp.lights.push({ kind: 'window', name: `light_window_${i}`, position: p.add(out), color: 0xffb060, intensity: 3, distance: 8 });
    }
  });

  // --- watchtower
  {
    const g = new THREE.Group();
    const legGeo = new THREE.BoxGeometry(0.22, 7, 0.22);
    for (const [x, z] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) {
      const leg = new THREE.Mesh(legGeo, barkMat);
      leg.position.set(x * 0.9, 3.5, z * 0.9);
      leg.castShadow = true;
      g.add(leg);
    }
    const deck = new THREE.Mesh(new THREE.BoxGeometry(3, 0.2, 3), woodMat);
    deck.position.y = 6.2;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.2, 2.6), logWall);
    cabin.position.y = 6.9;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.3, 1.3, 4).rotateY(Math.PI / 4), roofMat);
    roof.position.y = 8.2;
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(2.62, 0.4, 2.62), windowMat);
    lamp.position.y = 7.05;
    g.add(deck, cabin, roof, lamp);
    g.position.set(-2.5, 0, -15);
    root.add(g);
  }

  // --- string lights between poles + bulbs
  const poleGeo = new THREE.CylinderGeometry(0.07, 0.09, 3.6, 6).translate(0, 1.8, 0);
  const poles = [];
  const POLES = 7;
  for (let i = 0; i < POLES; i++) {
    const a = (i / POLES) * Math.PI * 2 + 0.25;
    const p = new THREE.Vector3(Math.sin(a) * 7.2, 0, Math.cos(a) * 7.2);
    const pole = new THREE.Mesh(poleGeo, barkMat);
    pole.position.copy(p);
    pole.castShadow = true;
    root.add(pole);
    poles.push(p.setY(3.5));
  }
  const bulbPositions = [];
  const cablePts = [];
  for (let i = 0; i < POLES; i++) {
    const a = poles[i];
    const b = poles[(i + 1) % POLES];
    const steps = 14;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const p = a.clone().lerp(b, t);
      p.y -= Math.sin(t * Math.PI) * 0.75;
      cablePts.push(p);
      if (s > 0 && s < steps && s % 2 === 0) bulbPositions.push(p.clone().add(new THREE.Vector3(0, -0.07, 0)));
    }
  }
  const cable = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(cablePts, true), 260, 0.012, 4, true),
    std(0x1a1410),
  );
  root.add(cable);
  const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.055, 8, 6), emit('EMIT_bulb', 0xffc870, 3), bulbPositions.length);
  bulbPositions.forEach((p, i) => {
    _m.compose(p, _q.identity(), _s.set(1, 1.3, 1));
    bulbs.setMatrixAt(i, _m);
    if (i % 6 === 2) camp.lights.push({ kind: 'string', name: `light_string_${i}`, position: p.clone(), color: 0xffcf88, intensity: 2.2, distance: 6 });
  });
  root.add(bulbs);

  // --- bushes and rocks
  const bushGeo = new THREE.IcosahedronGeometry(0.6, 0);
  const bushes = new THREE.InstancedMesh(bushGeo, std(0x35552a, { flatShading: true }), 40);
  for (let i = 0; i < 40; i++) {
    const a = R() * Math.PI * 2;
    const r = 9 + R() * 12;
    _m.compose(_v.set(Math.sin(a) * r, 0.2, Math.cos(a) * r), _q.identity(), _s.setScalar(0.6 + R() * 0.9));
    bushes.setMatrixAt(i, _m);
  }
  root.add(bushes);
  const rocks = new THREE.InstancedMesh(stoneGeo, std(0x6d665e, { flatShading: true }), 30);
  for (let i = 0; i < 30; i++) {
    const a = R() * Math.PI * 2;
    const r = 5.5 + R() * 14;
    _m.compose(_v.set(Math.sin(a) * r, 0.05, Math.cos(a) * r), _q.setFromEuler(new THREE.Euler(R(), R(), R())), _s.setScalar(1 + R() * 3));
    rocks.setMatrixAt(i, _m);
  }
  rocks.receiveShadow = true;
  root.add(rocks);

  // --- small props near the circle: cooler, mug stumps, guitar-ish crate
  const cooler = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.45, 0.45), std(0xb0302a));
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.08, 0.47), std(0xe8e4dc));
  lid.position.y = 0.26;
  cooler.add(lid);
  cooler.position.set(4.6, 0.23, 1.6);
  cooler.rotation.y = 0.6;
  cooler.castShadow = true;
  root.add(cooler);
  const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.55, 10), [barkMat, woodMat, woodMat]);
  stump.position.set(-4.4, 0.27, 2.2);
  stump.castShadow = true;
  root.add(stump);

  sortLights(camp);
  finalizeIntro(camp, null);
  return camp;
}

function addLantern(root, camp, p, h) {
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, h, 6).translate(0, h / 2, 0), std(0x3a2a1c));
  post.position.copy(p);
  root.add(post);
  const lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.28, 6), emit('EMIT_lantern', 0xffa040, 2.6));
  lantern.position.copy(p).setY(h + 0.16);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.12, 6), std(0x1e1a16));
  cap.position.y = 0.2;
  lantern.add(cap);
  root.add(lantern);
  camp.lights.push({
    kind: 'lantern', name: `light_lantern_${camp.lights.length}`, position: lantern.position.clone().add(new THREE.Vector3(0, 0.05, 0)),
    color: 0xffa850, intensity: 4, distance: 9,
  });
}
