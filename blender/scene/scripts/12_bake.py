# Step 12: ambient occlusion bake (Cycles).
#  - static meshes: AO into the corner colour attribute "ao", then Col = albedo * AO (albedo kept in "albedo")
#  - ground: AO baked to an image, multiplied into the ground albedo texture -> textures/ground.png
# Lighting stays dynamic in the client: only occlusion is precomputed.
LIB = "/Users/valentinbour/Desktop/Git/LoupGarou/blender/scene/scripts/_lib.py"
exec(compile(open(LIB).read(), LIB, "exec"))
import numpy as np
import time

scn = bpy.context.scene
TEX_DIR = SCENE_DIR + "/textures"
AO_DIST = 1.4
AO_SAMPLES = 64
AO_STRENGTH = 0.8            # 1 = full AO, 0 = none (vertex colours)
AO_GAMMA = 0.6
AO_FLOOR = 0.25
GROUND_AO_STRENGTH = 0.85
COMBINE_ONLY = globals().get("COMBINE_ONLY", False)
GROUND_AO_RES = 1024
SKIP = {"mountains", "treeline"}

t_start = time.time()
scn.render.engine = "CYCLES"
try:
    scn.cycles.device = "GPU"
except Exception:
    pass
scn.cycles.samples = AO_SAMPLES
scn.cycles.use_denoising = False
if scn.world is None:
    scn.world = bpy.data.worlds.new("preview_world")
scn.world.light_settings.distance = AO_DIST
bake = scn.render.bake
bake.use_selected_to_active = False
bake.margin = 4

static = get_coll("camp_export/static")
objs = [o for o in static.all_objects if o.type == "MESH" and o.name not in SKIP and o.name != "ground"]

# make sure we never bake into shared data
for o in objs:
    if o.data.users > 1:
        o.data = o.data.copy()


def corner_array(me, name):
    a = me.color_attributes[name]
    buf = np.empty(len(a.data) * 4, dtype=np.float32)
    a.data.foreach_get("color", buf)
    return buf.reshape(-1, 4)


def ensure_attr(me, name, src=None):
    a = me.color_attributes.get(name)
    if a is None:
        a = me.color_attributes.new(name, "FLOAT_COLOR", "CORNER")
        if src is not None:
            a.data.foreach_set("color", corner_array(me, src).ravel())
    return a


def combine(objs, strength=None, gamma=None, floor=None):
    """Col = albedo * remapped AO. AO is remapped (gamma, floor) so that vertices buried in other geometry
    do not blacken whole faces of low-poly props."""
    strength = AO_STRENGTH if strength is None else strength
    gamma = AO_GAMMA if gamma is None else gamma
    floor = AO_FLOOR if floor is None else floor
    out = {}
    for o in objs:
        me = o.data
        if "ao" not in me.color_attributes or "albedo" not in me.color_attributes:
            continue
        alb = corner_array(me, "albedo")
        ao = np.clip(corner_array(me, "ao")[:, :1], 0, 1) ** gamma
        ao = floor + (1 - floor) * ao
        k = 1.0 - strength + strength * ao
        col = alb.copy()
        col[:, :3] = alb[:, :3] * k
        col[:, 3] = 1.0
        me.color_attributes["Col"].data.foreach_set("color", col.ravel())
        me.color_attributes.active_color_name = "Col"
        out[o.name] = round(float(ao.mean()), 3)
    return out


def bake_vertex(objs):
    for o in objs:
        me = o.data
        ensure_attr(me, "albedo", "Col")
        ensure_attr(me, "ao")
        me.color_attributes.active_color_name = "ao"
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.hide_set(False)
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    t0 = time.time()
    bpy.ops.object.bake(type="AO", target="VERTEX_COLORS")
    return time.time() - t0


def ground_texture(ao):
    """ground.png = ground albedo (sRGB) * AO (applied in linear space)."""
    albedo = np.load(TMP + "/ground_albedo.npy")                   # sRGB float (2048, 2048, 3)
    rep = albedo.shape[0] // ao.shape[0]
    ao_up = np.repeat(np.repeat(ao, rep, axis=0), rep, axis=1)
    ao_up = (ao_up + np.roll(ao_up, 1, 0) + np.roll(ao_up, -1, 0) + np.roll(ao_up, 1, 1) + np.roll(ao_up, -1, 1)) / 5
    k = 1.0 - GROUND_AO_STRENGTH + GROUND_AO_STRENGTH * np.clip(ao_up, 0, 1)
    lin_a = np.where(albedo <= 0.04045, albedo / 12.92, ((albedo + 0.055) / 1.055) ** 2.4)
    lin_a = lin_a * k[..., None]
    srgb = np.where(lin_a <= 0.0031308, lin_a * 12.92, 1.055 * np.power(np.clip(lin_a, 0, None), 1 / 2.4) - 0.055)
    res = albedo.shape[0]
    out = bpy.data.images.get("ground")
    if out is not None and out.size[0] != res:
        bpy.data.images.remove(out)
        out = None
    if out is None:
        out = bpy.data.images.new("ground", res, res, alpha=False)
    rgba = np.ones((res, res, 4), dtype=np.float32)
    rgba[..., :3] = np.clip(srgb, 0, 1)
    out.colorspace_settings.name = "sRGB"
    out.pixels.foreach_set(rgba.ravel())
    out.filepath_raw = TEX_DIR + "/ground.png"
    out.file_format = "PNG"
    out.save()
    MAT("ground").node_tree.nodes.get("albedo").image = out


def bake_ground():
    ground = bpy.data.objects["ground"]
    img = bpy.data.images.get("ground_ao")
    if img is not None:
        bpy.data.images.remove(img)
    img = bpy.data.images.new("ground_ao", GROUND_AO_RES, GROUND_AO_RES, alpha=False, float_buffer=True)
    img.colorspace_settings.name = "Non-Color"
    nt = MAT("ground").node_tree
    bake_node = nt.nodes.new("ShaderNodeTexImage")
    bake_node.name = "bake_target"
    bake_node.image = img
    nt.nodes.active = bake_node
    bpy.ops.object.select_all(action="DESELECT")
    ground.select_set(True)
    bpy.context.view_layer.objects.active = ground
    t0 = time.time()
    bpy.ops.object.bake(type="AO", target="IMAGE_TEXTURES")
    t = time.time() - t0
    nt.nodes.remove(bake_node)
    ao = np.array(img.pixels[:], dtype=np.float32).reshape(GROUND_AO_RES, GROUND_AO_RES, 4)[..., 0]
    np.save(TMP + "/ground_ao.npy", ao)
    ground_texture(ao)
    return t, float(ao.mean())


if COMBINE_ONLY:
    stats = combine(objs)
    ground_texture(np.load(TMP + "/ground_ao.npy"))
    result = {"combined": stats}
else:
    t_vc = bake_vertex(objs)
    stats = combine(objs)
    t_img, ao_mean = bake_ground()
    result = {"objects": len(objs), "vc_bake_s": round(t_vc, 1), "img_bake_s": round(t_img, 1),
              "total_s": round(time.time() - t_start, 1), "mean_ao": stats, "ground_ao_mean": ao_mean}
scn.render.engine = "BLENDER_EEVEE"
