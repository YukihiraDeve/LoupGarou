# Step 7: string lights on poles (EMIT_bulbs), lantern posts (EMIT_lantern), pennant garlands.
LIB = "/Users/valentinbour/Desktop/Git/LoupGarou/blender/scene/scripts/_lib.py"
exec(compile(open(LIB).read(), LIB, "exec"))

coll = get_coll("camp_export/static/lights")
clear_coll(coll)
rng = random.Random(31)
scn = bpy.context.scene

mb = MB("string_lights")
POLE_R = 6.3
POLE_H = 3.5
POLE_ANGLES = [4, 46, 82, 140, 180, 214, 250, 287]
POLE_RADII = [6.6, 6.1, 6.4, 6.0, 6.5, 6.2, 6.0, 6.7]
poles = []
for i, a in enumerate(POLE_ANGLES):
    base = P(a, POLE_RADII[i])
    lean = Vector((rng.uniform(-0.05, 0.05), rng.uniform(-0.05, 0.05), 0))
    top = base + Vector((0, 0, POLE_H)) + lean
    mb.cyl(base + Vector((0, 0, -0.3)), top, 0.075, 0.06, segs=7, mat="bark",
           color=vary(cmix(PAL["bark"], PAL["bark_light"], rng.random()), 0.15, 2.0, 600 + i),
           cap0=False, cap_color=PAL["endgrain"], rings=2)
    # small stones wedging the pole
    for k in range(3):
        ang = rng.uniform(0, 2 * pi)
        mb.blob(base + Vector((cos(ang) * 0.17, sin(ang) * 0.17, 0.04)), (0.09, 0.08, 0.07), subdiv=1, seed=650 + i * 3 + k,
                amp=0.2, mat="stone", color=vary(PAL["stone"], 0.1, 3.0, 650 + k))
    poles.append(top - Vector((0, 0, 0.12)))


# extra anchors on buildings (approximate eaves / tower leg), in world space
def obj_point(name, local):
    o = bpy.data.objects.get(name)
    return o.matrix_world @ Vector(local) if o else None


bpy.context.view_layer.update()
anchors = {
    "chalet_A": obj_point("chalet_A", (-1.0, -2.2 - 1.85 - 0.45, 2.05)),
    "chalet_A2": obj_point("chalet_A", (2.0, -2.2 - 1.85 - 0.45, 2.05)),
    "chalet_B": obj_point("chalet_B", (1.9 + 0.7, -2.3 - 0.4, 2.3)),
    "chalet_C": obj_point("chalet_C", (1.65 + 0.6, 1.9 + 0.3, 2.1)),
    "tower": obj_point("tower", (-1.45, -1.45, 3.4)),
}

spans = []
for i in range(len(poles)):
    spans.append((poles[i], poles[(i + 1) % len(poles)], 0.42))
spans += [
    (poles[6], anchors["chalet_A"], 0.35),
    (poles[7], anchors["chalet_A2"], 0.35),
    (poles[7], anchors["tower"], 0.3),
    (poles[3], anchors["chalet_B"], 0.3),
    (poles[2], anchors["chalet_C"], 0.3),
]
string_pts = []
bulb_count = 0
for (p, q, sag) in spans:
    if p is None or q is None:
        continue
    L = (q - p).length
    n = max(6, int(L / 0.25))
    pts = catenary(p, q, sag * L / 4.0, n)
    mb.tube(pts, 0.008, segs=3, mat="paint", color=PAL["wire"])
    nb = max(3, int(L / 0.42))
    for k in range(1, nb):
        t = k / nb
        c = Vector(p).lerp(Vector(q), t)
        c.z -= sag * L / 4.0 * 4 * t * (1 - t)
        mb.cyl(c + Vector((0, 0, 0.0)), c - Vector((0, 0, 0.05)), 0.014, 0.014, segs=5, mat="paint",
               color=PAL["metal"], cap0=False)
        mb.blob(c - Vector((0, 0, 0.09)), (0.035, 0.035, 0.05), subdiv=1, seed=k, amp=0.0, mat="EMIT_bulbs",
                color=(1, 1, 1), smooth=True)
        bulb_count += 1
    mid = Vector(p).lerp(Vector(q), 0.5)
    mid.z -= sag * L / 4.0 + 0.25
    string_pts.append(list(mid))

# ----------------------------------------------------------------------------- lantern posts
lantern_pts = []


def lantern(mbb, c, hang=True):
    c = Vector(c)
    if hang:
        mbb.tube([c + Vector((0, 0, 0.36)), c + Vector((0, 0, 0.16))], 0.007, segs=3, mat="paint", color=PAL["metal"])
    # glass body with a dark frame
    mbb.cyl(c - Vector((0, 0, 0.1)), c + Vector((0, 0, 0.1)), 0.07, 0.07, segs=6, mat="EMIT_lantern", color=(1, 1, 1),
            cap0=False, cap1=False, smooth=False)
    for k in range(3):
        a = 2 * pi * k / 3
        off = Vector((cos(a), sin(a), 0)) * 0.072
        mbb.box(c + off, (0.02, 0.02, 0.2), rot=(0, 0, a), mat="paint", color=PAL["metal"])
    mbb.cyl(c + Vector((0, 0, 0.1)), c + Vector((0, 0, 0.17)), 0.095, 0.03, segs=6, mat="paint", color=PAL["metal"])
    mbb.cyl(c - Vector((0, 0, 0.13)), c - Vector((0, 0, 0.1)), 0.085, 0.085, segs=6, mat="paint", color=PAL["metal"])
    mbb.cyl(c + Vector((0, 0, 0.17)), c + Vector((0, 0, 0.22)), 0.012, 0.012, segs=4, mat="paint", color=PAL["metal"])


POSTS = [(262, 5.4), (326, 5.5), (344, 5.6), (64, 5.5), (153, 5.4)]
for i, (a, r) in enumerate(POSTS):
    base = P(a, r)
    top = base + Vector((0, 0, 1.75))
    mb.cyl(base - Vector((0, 0, 0.2)), top, 0.06, 0.05, segs=6, mat="bark",
           color=vary(PAL["wood_dark"], 0.12, 2.0, 700 + i), cap_color=PAL["endgrain"])
    # arm toward the clearing
    d = (Vector((0, 0, 0)) - base)
    d.z = 0
    d.normalize()
    arm_end = top + d * 0.38 - Vector((0, 0, 0.06))
    mb.cyl(top - Vector((0, 0, 0.06)) - d * 0.04, arm_end, 0.03, 0.03, segs=5, mat="wood", color=PAL["wood_dark"])
    mb.cyl(top - Vector((0, 0, 0.35)), top - Vector((0, 0, 0.06)) + d * 0.2, 0.02, 0.02, segs=4, mat="wood",
           color=PAL["wood_dark"])
    c = arm_end - Vector((0, 0, 0.42))
    lantern(mb, c)
    lantern_pts.append(list(c))

# lanterns standing on the ground next to the benches (no post)
for a, r in ((258.75, 4.15), (33.75, 4.2), (168.75, 4.1)):
    c = P(a, r, 0.13)
    lantern(mb, c, hang=False)
    mb.cyl(c + Vector((0, 0, 0.22)), c + Vector((0, 0, 0.3)), 0.06, 0.06, segs=8, mat="paint", color=PAL["metal"],
           cap0=False, cap1=False, rings=1, rfunc=lambda t, a: 1.0)
    lantern_pts.append(list(c))

# ----------------------------------------------------------------------------- pennants
FLAG_COLS = [PAL["red"], PAL["orange"], PAL["yellow"], PAL["teal"], PAL["cream"], PAL["blue"], PAL["green"]]
pen = [
    (poles[0], poles[1], 0.5, -0.45),
    (poles[4], poles[5], 0.5, -0.5),
    (poles[0] + Vector((0, 0, -0.5)), anchors["tower"] + Vector((0, 0, 0.6)), 0.35, 0.0),
    (poles[2] + Vector((0, 0, -0.55)), anchors["chalet_C"] + Vector((0, 0, -0.25)), 0.35, 0.0),
]
nflags = 0
for (p, q, sag, dz) in pen:
    p = Vector(p) + Vector((0, 0, dz))
    q = Vector(q) + Vector((0, 0, dz if dz else 0))
    L = (q - p).length
    sg = sag * L / 4
    pts = catenary(p, q, sg, max(6, int(L / 0.3)))
    mb.tube(pts, 0.007, segs=3, mat="wood", color=PAL["rope"])
    nf = int(L / 0.36)
    d = (q - p).normalized()
    for k in range(1, nf):
        t0, t1 = (k - 0.38) / nf, (k + 0.38) / nf
        a = p.lerp(q, t0)
        a.z -= sg * 4 * t0 * (1 - t0)
        b = p.lerp(q, t1)
        b.z -= sg * 4 * t1 * (1 - t1)
        tip = (a + b) / 2 - Vector((0, 0, 0.3)) + Vector((rng.uniform(-0.02, 0.02), rng.uniform(-0.02, 0.02), 0))
        mb.poly([a, b, tip], [(0, 1, 2)], "fabric", FLAG_COLS[(k + nflags) % len(FLAG_COLS)])
        nflags += 1

o = mb.obj(coll, "string_lights")
scn["pts_string"] = string_pts
scn["pts_lantern_posts"] = lantern_pts
result = {"tris": sum(len(p.vertices) - 2 for p in o.data.polygons), "bulbs": bulb_count, "strings": len(string_pts),
          "flags": nflags, "lanterns": len(lantern_pts)}
