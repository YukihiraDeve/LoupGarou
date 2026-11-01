// Step 14: web optimisation of the raw GLB with glTF Transform (from 3DLib/tools/node_modules).
//   node blender/scene/scripts/14_optimize.mjs blender/scene/tmp/camp_raw.glb client/public/assets/camp/camp.glb
// - keeps every node (markers are empty leaf nodes: prune keepLeaves) and every material name (no dedup/join/
//   palette/flatten, so EMIT_* materials and marker names survive)
// - textures -> WebP (ground <= 2048, others <= 1024)
// - meshopt compression (EXT_meshopt_compression + KHR_mesh_quantization): three.js needs
//   GLTFLoader.setMeshoptDecoder(MeshoptDecoder)
import { createRequire } from 'module';

const require = createRequire('/Users/valentinbour/Desktop/Git/LoupGarou/3DLib/tools/package.json');
const { NodeIO } = require('@gltf-transform/core');
const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');
const { prune, weld, meshopt, textureCompress } = require('@gltf-transform/functions');
const { MeshoptEncoder, MeshoptDecoder } = require('meshoptimizer');
const sharp = require('sharp');

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage: node 14_optimize.mjs <in.glb> <out.glb>');
  process.exit(1);
}

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

const doc = await io.read(input);
const root = doc.getRoot();
const before = root.listNodes().length;

await doc.transform(
  prune({ keepLeaves: true, keepAttributes: false, keepIndices: true, keepSolidTextures: true, keepExtras: true }),
  weld(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [2048, 2048], quality: 88, slots: /baseColor/,
    pattern: /ground/ }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 85,
    pattern: /^(?!ground).+$/ }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);

const after = root.listNodes().length;
if (after !== before) {
  console.error(`node count changed ${before} -> ${after}`);
  process.exit(2);
}
await io.write(output, doc);
console.log(JSON.stringify({ nodes: after, materials: root.listMaterials().map((m) => m.getName()),
  textures: root.listTextures().map((t) => [t.getName(), t.getMimeType(), t.getSize()]) }));
