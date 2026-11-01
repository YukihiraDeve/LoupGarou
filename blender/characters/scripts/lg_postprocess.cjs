// Loup-Garou characters: glTF post-processing (Node, @gltf-transform from 3DLib/tools).
//   node lg_postprocess.cjs anims <in.glb> <out.glb>     keep only rotation channels + translation on root/pelvis
//   node lg_postprocess.cjs report <file.glb> [...]      print a JSON report (nodes, joints, morphs, clips, tris)
const path = require('path');
const TOOLS = path.resolve(__dirname, '../../../3DLib/tools/node_modules/@gltf-transform');
const { NodeIO } = require(path.join(TOOLS, 'core'));
const { ALL_EXTENSIONS } = require(path.join(TOOLS, 'extensions'));
const { MeshoptDecoder, MeshoptEncoder } = require(path.resolve(__dirname, '../../../3DLib/tools/node_modules/meshoptimizer'));

async function io() {
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.decoder': MeshoptDecoder,
    'meshopt.encoder': MeshoptEncoder,
  });
}

async function anims(inp, out) {
  const doc = await (await io()).read(inp);
  let removed = 0;
  for (const anim of doc.getRoot().listAnimations()) {
    for (const ch of anim.listChannels()) {
      const node = ch.getTargetNode();
      const p = ch.getTargetPath();
      const name = node ? node.getName() : '';
      const keep = p === 'rotation' || (p === 'translation' && (name === 'pelvis' || name === 'root'));
      if (!keep) {
        const s = ch.getSampler();
        ch.dispose();
        if (s && s.listParents().filter((x) => x.propertyType !== 'Root').length === 0) s.dispose();
        removed++;
      }
    }
  }
  // drop unused accessors
  for (const acc of doc.getRoot().listAccessors()) {
    if (acc.listParents().filter((x) => x.propertyType !== 'Root').length === 0) acc.dispose();
  }
  await (await io()).write(out, doc);
  console.log(JSON.stringify({ removedChannels: removed }));
}

async function report(files) {
  const res = {};
  for (const f of files) {
    const doc = await (await io()).read(f);
    const root = doc.getRoot();
    let tris = 0;
    const morphs = new Set();
    const mats = root.listMaterials().map((m) => m.getName());
    for (const mesh of root.listMeshes()) {
      const names = (mesh.getExtras() || {}).targetNames || [];
      names.forEach((n) => morphs.add(n));
      for (const prim of mesh.listPrimitives()) {
        const idx = prim.getIndices();
        tris += (idx ? idx.getCount() : prim.getAttribute('POSITION').getCount()) / 3;
      }
    }
    const skins = root.listSkins().map((s) => s.listJoints().map((j) => j.getName()));
    const clips = root.listAnimations().map((a) => {
      let dur = 0;
      const paths = {};
      for (const ch of a.listChannels()) {
        const inp = ch.getSampler().getInput();
        dur = Math.max(dur, inp.getMax([0])[0]);
        paths[ch.getTargetPath()] = (paths[ch.getTargetPath()] || 0) + 1;
      }
      return { name: a.getName(), duration: +dur.toFixed(3), channels: paths };
    });
    const textures = root.listTextures().map((t) => ({ mime: t.getMimeType(), size: t.getSize() }));
    const scenes = root.listScenes().map((s) => s.listChildren().map((n) => ({ name: n.getName(), scale: n.getScale() })));
    res[path.basename(f)] = { tris, joints: skins[0] ? skins[0].length : 0, jointNames: skins[0] || [], morphs: [...morphs], materials: mats, clips, textures, scenes };
  }
  console.log(JSON.stringify(res, null, 1));
}

(async () => {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'anims') await anims(args[0], args[1]);
  else if (cmd === 'report') await report(args);
  else throw new Error('usage: anims|report');
})().catch((e) => { console.error(e); process.exit(1); });
