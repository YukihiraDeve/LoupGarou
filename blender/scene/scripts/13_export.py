# Step 13: merge static meshes by material and export the raw GLB (run in background Blender, never saves):
#   Blender -b blender/scene/camp.blend --python blender/scene/scripts/13_export.py -- --out blender/scene/tmp/camp_raw.glb
# Static geometry -> one mesh per material ("camp_<material>"); trees / vegetation stay instanced
# (EXT_mesh_gpu_instancing); markers are exported as empty nodes; cam_intro as a camera.
import sys
LIB = "/Users/valentinbour/Desktop/Git/LoupGarou/blender/scene/scripts/_lib.py"
exec(compile(open(LIB).read(), LIB, "exec"))

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
out = argv[argv.index("--out") + 1] if "--out" in argv else TMP + "/camp_raw.glb"

scn = bpy.context.scene
vl = bpy.context.view_layer
static = bpy.data.collections["static"]

# --- join every static mesh, then split by material ----------------------------------------
objs = [o for o in static.all_objects if o.type == "MESH"]
for o in objs:
    o.hide_set(False)
    o.hide_viewport = False
    if o.data.users > 1:
        o.data = o.data.copy()
bpy.ops.object.select_all(action="DESELECT")
for o in objs:
    o.select_set(True)
vl.objects.active = objs[0]
bpy.ops.object.join()
merged = vl.objects.active
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.separate(type="MATERIAL")
bpy.ops.object.mode_set(mode="OBJECT")

VCOL_MATS = {"wood", "bark", "stone", "fabric", "foliage", "grass", "paint", "ground_far", "mountain", "EMIT_tent"}
UV_MATS = {"ground", "bark"}
parts = [o for o in static.all_objects if o.type == "MESH"]
info = {}
for o in parts:
    me = o.data
    mats = [m.name for m in me.materials if m]
    # drop unused material slots
    used = {p.material_index for p in me.polygons}
    mname = me.materials[list(used)[0]].name if used else (mats[0] if mats else "none")
    o.name = me.name = f"camp_{mname}"
    for i in reversed(range(len(me.materials))):
        if i not in used:
            o.active_material_index = i
            vl.objects.active = o
            bpy.ops.object.material_slot_remove()
    for n in ("albedo", "ao"):
        a = me.color_attributes.get(n)
        if a is not None:
            me.color_attributes.remove(a)
    if mname not in VCOL_MATS:
        for a in list(me.color_attributes):
            me.color_attributes.remove(a)
    else:
        me.color_attributes.active_color_name = "Col"
    if mname not in UV_MATS:
        while me.uv_layers:
            me.uv_layers.remove(me.uv_layers[0])
    info[o.name] = len(me.polygons)

# instanced prototypes: keep only Col
for o in bpy.data.collections["instances"].all_objects:
    if o.type == "MESH":
        me = o.data
        for n in ("albedo", "ao"):
            a = me.color_attributes.get(n)
            if a is not None:
                me.color_attributes.remove(a)
        if not any(m and m.name in UV_MATS for m in me.materials):
            while me.uv_layers:
                me.uv_layers.remove(me.uv_layers[0])

# --- export ------------------------------------------------------------------------------------
def find_lc(lc, name):
    if lc.collection.name == name:
        return lc
    for c in lc.children:
        r = find_lc(c, name)
        if r:
            return r
    return None


set_emission(EMIT_NIGHT)
vl.active_layer_collection = find_lc(vl.layer_collection, "camp_export")
scn.render.resolution_x, scn.render.resolution_y = 1920, 1080
bpy.ops.export_scene.gltf(
    filepath=out, export_format="GLB",
    use_active_collection=True, use_active_collection_with_nested=True, use_visible=False,
    export_cameras=True, export_lights=False, export_apply=True, export_yup=True,
    export_gpu_instances=True,
    export_vertex_color="ACTIVE", export_all_vertex_colors=False, export_active_vertex_color_when_no_material=False,
    export_normals=True, export_texcoords=True, export_tangents=False,
    export_materials="EXPORT", export_image_format="AUTO",
    export_extras=False, export_animations=False, export_morph=False, export_skins=False,
)
print("EXPORTED", out, info)
