"""Loup-Garou characters: join Parts into one skinned Blender mesh (UVs, materials, vertex groups,
shape keys) parented to the armature."""
from __future__ import annotations

import bpy
import numpy as np

import lg_core as C
import lg_skin as S
import lg_texture as T

MORPHS = ("Blink", "EyesHalf", "MouthOpen", "Smile", "Worried")


def part_uvs(atlas, p, colors):
    """Final per-corner atlas UVs for one part."""
    out = []
    if p.region is None or p.UV is None:
        name = p.color or "skin"
        col = colors.get(name, "#ff00ff")
        uv = atlas.cell_uv(name, col)
        return [[uv] * len(f) for f in p.F]
    sub = p.tags.get("uv_rect")
    for fu in p.UV:
        cu = []
        for (u, v) in fu:
            cu.append(atlas.region_uv(p.region, u, v, sub))
        out.append(cu)
    return out


def make_image(name, atlas, path=None):
    img = bpy.data.images.get(name)
    if img is not None:
        bpy.data.images.remove(img)
    img = bpy.data.images.new(name, T.SIZE, T.SIZE, alpha=False)
    img.pixels.foreach_set(atlas.to_pixels().ravel())
    if path:
        img.filepath_raw = path
        img.file_format = "PNG"
        img.save()
    img.pack()
    return img


def make_material(name, img, roughness=0.8, emissive=None, emissive_strength=0.0, spec=0.3):
    mat = bpy.data.materials.get(name)
    if mat is not None:
        bpy.data.materials.remove(mat)
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    tex.interpolation = "Linear"
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = 0.0
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = spec
    if emissive is not None:
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = emissive_strength
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    out.location = (300, 0)
    tex.location = (-400, 0)
    return mat


def assemble(name, parts, arm, atlas, colors, materials, coll=None):
    """Create the skinned mesh object `name` from parts. Returns (obj, stats)."""
    V_all, F_all, UV_all, M_all = [], [], [], []
    W_all = {}
    morph_all = {m: [] for m in MORPHS}
    off = 0
    nv_total = sum(len(p.V) for p in parts)
    for p in parts:
        n = len(p.V)
        V_all.append(p.V)
        F_all += [tuple(i + off for i in f) for f in p.F]
        UV_all += part_uvs(atlas, p, colors)
        M_all += [p.mat] * len(p.F)
        if not p.weights:
            raise ValueError(f"part {p.name} has no weights")
        for b, w in p.weights.items():
            arr = W_all.setdefault(b, np.zeros(nv_total))
            arr[off:off + n] += np.broadcast_to(np.asarray(w, dtype=np.float64), (n,))
        for m in MORPHS:
            d = p.morphs.get(m)
            morph_all[m].append(np.zeros((n, 3)) if d is None else d)
        off += n
    V = np.concatenate(V_all)
    W = S.normalize_weights(W_all, len(V))
    me = bpy.data.meshes.new(name)
    me.from_pydata(V.tolist(), [], [list(f) for f in F_all])
    me.update()
    # uv
    uvl = me.uv_layers.new(name="UVMap")
    flat_uv = np.array([uv for fu in UV_all for uv in fu], dtype=np.float32)
    # loops are ordered per polygon in from_pydata order
    uvl.data.foreach_set("uv", flat_uv.ravel())
    me.polygons.foreach_set("material_index", np.array(M_all, dtype=np.int32))
    for m in materials:
        me.materials.append(m)
    me.shade_smooth()
    obj = bpy.data.objects.new(name, me)
    (coll or bpy.context.scene.collection).objects.link(obj)
    # vertex groups: in skeleton order
    for b in [bn.name for bn in arm.data.bones]:
        if b in W:
            vg = obj.vertex_groups.new(name=b)
            w = W[b]
            idx = np.nonzero(w > 0)[0]
            for i in idx:
                vg.add([int(i)], float(w[i]), "REPLACE")
    missing = [b for b in W if b not in arm.data.bones]
    if missing:
        raise ValueError(f"weights on unknown bones: {missing}")
    # shape keys
    obj.shape_key_add(name="Basis", from_mix=False)
    for m in MORPHS:
        d = np.concatenate(morph_all[m])
        sk = obj.shape_key_add(name=m, from_mix=False)
        sk.value = 0.0
        sk.slider_min = 0.0
        sk.slider_max = 1.0
        co = (V + d).astype(np.float32)
        sk.data.foreach_set("co", co.ravel())
    obj.parent = arm
    mod = obj.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    tris = sum(len(f) - 2 for f in F_all)
    return obj, dict(tris=tris, verts=len(V))
