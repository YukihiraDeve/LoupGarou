# Step 10: light markers (light_window_NN, light_lantern_NN, light_string_NN) and the cam_intro camera.
# Light points are collected by the previous steps in scene custom properties (pts_*).
LIB = "/Users/valentinbour/Desktop/Git/LoupGarou/blender/scene/scripts/_lib.py"
exec(compile(open(LIB).read(), LIB, "exec"))

scn = bpy.context.scene
mcoll = get_coll("camp_export/markers")
for o in list(mcoll.objects):
    if o.name.startswith("light_") or o.name == "cam_intro":
        d = o.data
        bpy.data.objects.remove(o, do_unlink=True)
        if d is not None and d.users == 0 and isinstance(d, bpy.types.Camera):
            bpy.data.cameras.remove(d)


def pts(*keys):
    out = []
    for k in keys:
        out += [Vector(p) for p in scn.get(k, [])]
    return out


# glowing tent: light spilling from the door
extra = []
t1 = bpy.data.objects.get("tent_1")
if t1:
    extra.append(t1.matrix_world @ Vector((0, -2.6, 1.0)))

windows = pts("pts_window_chalets", "pts_window_tower")
lanterns = pts("pts_lantern_posts", "pts_lantern_chalets", "pts_lantern_tower", "pts_lantern_props") + extra
strings = pts("pts_string")

for i, p in enumerate(windows):
    empty(f"light_window_{i:02d}", mcoll, p, size=0.25, kind="SPHERE")
for i, p in enumerate(lanterns):
    empty(f"light_lantern_{i:02d}", mcoll, p, size=0.15, kind="SPHERE")
for i, p in enumerate(strings):
    empty(f"light_string_{i:02d}", mcoll, p, size=0.2, kind="SPHERE")

# ----------------------------------------------------------------------------- cam_intro
L = LAYOUT["cam_intro"]
eye = P(L["a"], L["r"], L["z"])
target = Vector((0.0, -2.2, 0.3))
cd = bpy.data.cameras.new("cam_intro")
cd.lens = 24.0
cd.sensor_width = 36.0
cd.sensor_fit = "HORIZONTAL"
cd.clip_start = 0.1
cd.clip_end = 1200.0
cam = bpy.data.objects.new("cam_intro", cd)
mcoll.objects.link(cam)
cam.location = eye
cam.rotation_euler = (target - eye).normalized().to_track_quat("-Z", "Y").to_euler()
scn["cam_intro_target"] = list(target)
scn.render.resolution_x, scn.render.resolution_y = 1920, 1080

result = {"windows": len(windows), "lanterns": len(lanterns), "strings": len(strings), "cam": list(eye)}
