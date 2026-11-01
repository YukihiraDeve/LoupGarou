# Step 1: scene, collections and materials of the camp.
LIB = "/Users/valentinbour/Desktop/Git/LoupGarou/blender/scene/scripts/_lib.py"
exec(compile(open(LIB).read(), LIB, "exec"))

scn = bpy.context.scene
scn.name = "camp"
scn.unit_settings.system = "METRIC"
scn.unit_settings.scale_length = 1.0

# remove the default startup objects only (never anything else)
for n in ("Cube", "Light", "Camera"):
    o = bpy.data.objects.get(n)
    if o is not None and o.users_collection and o.users_collection[0].name == "Collection":
        bpy.data.objects.remove(o, do_unlink=True)
c = bpy.data.collections.get("Collection")
if c is not None and len(c.all_objects) == 0:
    bpy.data.collections.remove(c)

for path in ("camp_export/static", "camp_export/instances", "camp_export/markers", "preview"):
    get_coll(path)


def principled(m):
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (400, 0)
    b = nt.nodes.new("ShaderNodeBsdfPrincipled")
    b.location = (100, 0)
    nt.links.new(b.outputs["BSDF"], out.inputs["Surface"])
    return nt, b


def make_mat(name, rough=0.85, metal=0.0, double=False, vcol=True, base=(1, 1, 1), spec=0.5):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    if hasattr(m, "use_nodes"):
        try:
            m.use_nodes = True
        except Exception:
            pass
    nt, b = principled(m)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if "Specular IOR Level" in b.inputs:
        b.inputs["Specular IOR Level"].default_value = spec
    b.inputs["Base Color"].default_value = (*base, 1)
    if vcol:
        ca = nt.nodes.new("ShaderNodeVertexColor")
        ca.layer_name = "Col"
        ca.location = (-200, 0)
        nt.links.new(ca.outputs["Color"], b.inputs["Base Color"])
    m.use_backface_culling = not double
    m.diffuse_color = (*base, 1)
    return m


def make_emit(name, base, emit, strength, vcol=False):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    nt, b = principled(m)
    b.inputs["Base Color"].default_value = (*base, 1)
    if vcol:
        ca = nt.nodes.new("ShaderNodeVertexColor")
        ca.layer_name = "Col"
        ca.location = (-200, 0)
        nt.links.new(ca.outputs["Color"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.6
    b.inputs["Emission Color"].default_value = (*emit, 1)
    b.inputs["Emission Strength"].default_value = strength
    m.use_backface_culling = True
    m.diffuse_color = (*emit, 1)
    return m


make_mat("wood", rough=0.85)


# bark: tileable detail texture (grey, multiplies the vertex colour) for every round log / pole / trunk
import numpy as np
import os


def periodic_noise(res, cu, cv, rng):
    lat = rng.uniform(-1, 1, (cv, cu))
    tu = np.arange(res) / res * cu
    tv = np.arange(res) / res * cv
    iu, iv = tu.astype(int), tv.astype(int)
    fu, fv = tu - iu, tv - iv
    fu, fv = fu * fu * (3 - 2 * fu), fv * fv * (3 - 2 * fv)
    a = lat[np.ix_(iv % cv, iu % cu)]
    b = lat[np.ix_(iv % cv, (iu + 1) % cu)]
    c = lat[np.ix_((iv + 1) % cv, iu % cu)]
    d = lat[np.ix_((iv + 1) % cv, (iu + 1) % cu)]
    top = a + (b - a) * fu[None, :]
    bot = c + (d - c) * fu[None, :]
    return top + (bot - top) * fv[:, None]


def make_bark_texture(path, res=512):
    rng = np.random.default_rng(3)
    # u (columns) = around the log, v (rows) = along the log. Bark = warped vertical furrows + plates.
    U = (np.arange(res) / res)[None, :]
    warp = 0.55 * periodic_noise(res, 6, 2, rng) + 0.25 * periodic_noise(res, 12, 5, rng)
    phase = 9 * U + 1.4 * warp                      # 9 furrows per tile, integer -> tileable in u
    furrow = 1 - np.abs(np.sin(np.pi * phase))      # 1 on the furrow line
    furrow = np.clip((furrow - 0.72) / 0.28, 0, 1) ** 1.6
    plates = periodic_noise(res, 18, 7, rng)
    cross = np.clip(1 - np.abs(periodic_noise(res, 10, 9, rng)) / 0.05, 0, 1) * (plates > 0.15)
    fine = periodic_noise(res, 96, 40, rng)
    v = 0.9 + 0.1 * plates - 0.6 * furrow - 0.25 * cross + 0.05 * fine
    v = np.clip(v, 0.25, 1.0)
    rgb = np.stack([v, v * 0.97, v * 0.93], -1)
    img = bpy.data.images.get("bark") or bpy.data.images.new("bark", res, res, alpha=False)
    rgba = np.ones((res, res, 4), dtype=np.float32)
    rgba[..., :3] = rgb
    img.pixels.foreach_set(rgba.ravel())
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    return img


os.makedirs(SCENE_DIR + "/textures", exist_ok=True)
bark_img = make_bark_texture(SCENE_DIR + "/textures/bark.png")
m = make_mat("bark", rough=0.9)
nt = m.node_tree
bsdf = [n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"][0]
ca = [n for n in nt.nodes if n.type == "VERTEX_COLOR"][0]
tx = nt.nodes.new("ShaderNodeTexImage")
tx.image = bark_img
tx.location = (-450, 200)
mix = nt.nodes.new("ShaderNodeMix")
mix.data_type = "RGBA"
mix.blend_type = "MULTIPLY"
mix.inputs["Factor"].default_value = 1.0
mix.location = (-150, 100)
nt.links.new(tx.outputs["Color"], mix.inputs[6])
nt.links.new(ca.outputs["Color"], mix.inputs[7])
nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])
make_mat("stone", rough=0.9)
make_mat("fabric", rough=0.95, double=True)
make_mat("foliage", rough=0.9)
make_mat("grass", rough=0.9, double=True)
make_mat("paint", rough=0.45)
make_mat("ground_far", rough=0.95)
make_mat("mountain", rough=1.0)
# ground: textured (image assigned by 02_terrain.py)
make_mat("ground", rough=0.95, vcol=False)
# re-link the ground texture if it already exists (baked "ground" preferred over "ground_albedo")
_gimg = bpy.data.images.get("ground") or bpy.data.images.get("ground_albedo")
if _gimg is not None:
    _nt = bpy.data.materials["ground"].node_tree
    _b = [n for n in _nt.nodes if n.type == "BSDF_PRINCIPLED"][0]
    _t = _nt.nodes.new("ShaderNodeTexImage")
    _t.name = "albedo"
    _t.image = _gimg
    _t.extension = "EXTEND"
    _t.location = (-300, 0)
    _nt.links.new(_t.outputs["Color"], _b.inputs["Base Color"])

# Emissive materials: base colour = how it looks unlit (day), emission = night glow.
make_emit("EMIT_embers", lin("#3a1a10"), lin("#ff7420"), 3.0)
make_emit("EMIT_window", lin("#c9a46a"), lin("#ffa850"), 2.5)
make_emit("EMIT_bulbs", lin("#f3e6c8"), lin("#ffc777"), 4.0)
make_emit("EMIT_lantern", lin("#f0d9a8"), lin("#ffa94a"), 4.0)
make_emit("EMIT_tent", lin("#e6d6b3"), lin("#ff8a38"), 0.6, vcol=True)

set_emission(EMIT_NIGHT)
result = {"materials": [m.name for m in bpy.data.materials], "collections": [c.name for c in bpy.data.collections]}
