// Compare world-space bounds of every mesh node (instances included) between two GLBs, e.g. raw vs optimised:
//   node blender/scene/scripts/check_glb.mjs blender/scene/tmp/camp_raw.glb client/public/assets/camp/camp.glb
import { createRequire } from 'module';

const require = createRequire('/Users/valentinbour/Desktop/Git/LoupGarou/3DLib/tools/package.json');
const { NodeIO } = require('@gltf-transform/core');
const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');
const { MeshoptDecoder } = require('meshoptimizer');

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

function mul(a, b) { // column-major 4x4
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
function trs(t, q, s) {
  const [x, y, z, w] = q;
  const m = [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0, 0, 0, 0, 1];
  for (let i = 0; i < 3; i++) { m[i] *= s[0]; m[4 + i] *= s[1]; m[8 + i] *= s[2]; }
  m[12] = t[0]; m[13] = t[1]; m[14] = t[2];
  return m;
}
function apply(m, p) {
  return [0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]);
}

async function bounds(path) {
  const doc = await io.read(path);
  const out = {};
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const world = node.getWorldMatrix();
    const pts = [];
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      const tmp = [];
      for (let i = 0; i < pos.getCount(); i++) pts.push(pos.getElement(i, tmp).slice());
    }
    let mats = [world];
    const inst = node.getExtension('EXT_mesh_gpu_instancing');
    if (inst) {
      const T = inst.getAttribute('TRANSLATION'), R = inst.getAttribute('ROTATION'), S = inst.getAttribute('SCALE');
      const n = T.getCount();
      mats = [];
      for (let i = 0; i < n; i++) {
        const m = trs(T.getElement(i, []), R ? R.getElement(i, []) : [0, 0, 0, 1], S ? S.getElement(i, []) : [1, 1, 1]);
        mats.push(mul(world, m));
      }
    }
    const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (const m of mats) for (const p of pts) {
      const w = apply(m, p);
      for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], w[k]); hi[k] = Math.max(hi[k], w[k]); }
    }
    out[node.getName()] = [lo, hi, mats.length];
  }
  return out;
}

const [a, b] = process.argv.slice(2);
const A = await bounds(a), B = await bounds(b);
let worst = 0;
for (const k of Object.keys(A)) {
  if (!B[k]) { console.log('missing in second:', k); continue; }
  const d = Math.max(...[0, 1].flatMap((j) => [0, 1, 2].map((i) => Math.abs(A[k][j][i] - B[k][j][i]))));
  worst = Math.max(worst, d);
  if (d > 0.05) console.log('MISMATCH', k, A[k], B[k]);
}
console.log(JSON.stringify({ meshNodes: Object.keys(A).length, worstBoundsDelta: +worst.toFixed(4),
  forest: B['spruce_a'] ? B['spruce_a'].map((v) => (Array.isArray(v) ? v.map((x) => +x.toFixed(2)) : v)) : null }));
