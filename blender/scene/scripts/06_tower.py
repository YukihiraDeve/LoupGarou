# Step 6: wooden watchtower with a lit cabin on top. Ladder side faces the fire (local -Y).
LIB = "/Users/valentinbour/Desktop/Git/LoupGarou/blender/scene/scripts/_lib.py"
exec(compile(open(LIB).read(), LIB, "exec"))

coll = get_coll("camp_export/static/tower")
clear_coll(coll)
mcoll = get_coll("camp_export/markers")
rng = random.Random(23)

mb = MB("tower")
B0, T0 = 1.7, 1.18          # half footprint at the base / at the platform
ZP = 7.2                    # platform height
wood = lambda s: vary(cmix(lin("#7a4e2e"), lin("#8f5f37"), rng.random()), 0.12, 1.5, s)


def leg_pt(sx, sy, z):
    t = clamp(z / ZP)
    h = B0 + (T0 - B0) * t
    return Vector((sx * h, sy * h, z))


corners = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
# legs (round poles), continuing vertically as cabin corner posts
for i, (sx, sy) in enumerate(corners):
    mb.cyl(leg_pt(sx, sy, -0.2), leg_pt(sx, sy, ZP), 0.13, 0.11, segs=8, mat="bark", color=wood(i), cap0=False,
           rings=3)
    mb.cyl(leg_pt(sx, sy, ZP), leg_pt(sx, sy, ZP) + Vector((0, 0, 2.15)), 0.09, 0.09, segs=8, mat="bark",
           color=wood(i + 10), cap0=False)
    # concrete-ish footing stone
    mb.blob(leg_pt(sx, sy, 0.05), (0.32, 0.32, 0.18), subdiv=1, seed=40 + i, amp=0.15, mat="stone",
            color=vary(PAL["stone"], 0.1, 3, 40 + i), flat_bottom=-0.3)

# horizontal beams and X bracing on every face
levels = [0.45, 2.75, 5.0, ZP - 0.1]
for f in range(4):
    a, b = corners[f], corners[(f + 1) % 4]
    for z in levels:
        mb.cyl(leg_pt(*a, z), leg_pt(*b, z), 0.075, 0.075, segs=6, mat="bark", color=wood(100 + f), cap_color=PAL["endgrain"])
    for z0, z1 in zip(levels[:-1], levels[1:]):
        mb.cyl(leg_pt(*a, z0 + 0.1), leg_pt(*b, z1 - 0.1), 0.06, 0.06, segs=6, mat="bark", color=wood(200 + f),
               cap_color=PAL["endgrain"])
        mb.cyl(leg_pt(*b, z0 + 0.1), leg_pt(*a, z1 - 0.1), 0.06, 0.06, segs=6, mat="bark", color=wood(300 + f),
               cap_color=PAL["endgrain"])

# platform deck (planks) with overhang
D = T0 + 0.35
n_pl = 10
for k in range(n_pl):
    x = -D + (k + 0.5) * 2 * D / n_pl
    mb.box((x, 0, ZP + 0.06), (2 * D / n_pl - 0.02, 2 * D, 0.09), mat="wood",
           color=cmul(lin("#9b6a40"), 0.85 + 0.25 * rng.random()))
for sy in (-1, 1):
    mb.box((0, sy * (D - 0.05), ZP - 0.06), (2 * D, 0.12, 0.18), mat="wood", color=lin("#6b4428"))
    mb.box((sy * (D - 0.05), 0, ZP - 0.06), (0.12, 2 * D, 0.18), mat="wood", color=lin("#6b4428"))

# cabin: half walls of vertical boards, window band, roof
C = T0
ZW = ZP + 1.0      # top of the half walls
ZR = ZP + 2.05     # roof base
for f in range(4):
    a, b = Vector((*corners[f], 0)) * C, Vector((*corners[(f + 1) % 4], 0)) * C
    t = (b - a).normalized()
    n = Vector((t.y, -t.x, 0))       # outward
    if n.dot((a + b) / 2) < 0:
        n = -n
    L = (b - a).length
    nb = 7
    rot = (0, 0, atan2(t.y, t.x))
    for k in range(nb):
        if f == 0 and k in (3,):      # gap in the front wall where the ladder arrives
            continue
        c = a + t * (L * (k + 0.5) / nb) + n * 0.02
        mb.box((c.x, c.y, ZP + 0.1 + 0.48), (L / nb - 0.02, 0.06, 0.96), rot=rot, mat="wood",
               color=cmul(lin("#8f5f37"), 0.85 + 0.25 * rng.random()))
    # rail cap
    cc = (a + b) / 2 + n * 0.03
    mb.box((cc.x, cc.y, ZW + 0.03), (L + 0.1, 0.14, 0.07), rot=rot, mat="wood", color=lin("#6b4428"))
    # window band: glowing panes between the posts, with mullions
    pc = (a + b) / 2 - n * 0.05
    hh = (ZR - ZW - 0.12) / 2
    zc = ZW + 0.06 + hh
    hw = L / 2 - 0.08
    mb.poly([pc - t * hw + Vector((0, 0, zc - hh)), pc + t * hw + Vector((0, 0, zc - hh)),
             pc + t * hw + Vector((0, 0, zc + hh)), pc - t * hw + Vector((0, 0, zc + hh))], [(0, 1, 2, 3)],
            "EMIT_window", (1, 1, 1))
    for k in (1, 2):
        m = a + t * (L * k / 3) + n * 0.0
        mb.box((m.x, m.y, zc), (0.05, 0.06, 2 * hh), rot=rot, mat="wood", color=lin("#5b3a22"))
    mb.box((cc.x, cc.y, zc), (L, 0.05, 0.05), rot=rot, mat="wood", color=lin("#5b3a22"))
    mb.box((cc.x, cc.y, ZR - 0.04), (L + 0.1, 0.12, 0.1), rot=rot, mat="wood", color=lin("#6b4428"))
# inner floor shadow + ceiling (closes the cabin)
mb.box((0, 0, ZR + 0.02), (2 * C + 0.1, 2 * C + 0.1, 0.06), mat="wood", color=lin("#3a2617"))

# pyramid roof in three overlapping tiers (stylised shingles)
RO = C + 0.55
apex_z = ZR + 1.55
rc = lin("#5b3a2c")
tiers = [(ZR + 0.0, RO, ZR + 0.55, RO * 0.62), (ZR + 0.42, RO * 0.70, ZR + 0.95, RO * 0.32),
         (ZR + 0.85, RO * 0.38, apex_z, 0.0)]
for i, (z0, h0, z1, h1) in enumerate(tiers):
    mb.cyl((0, 0, z0), (0, 0, z1), h0 * 1.414, h1 * 1.414, segs=4, mat="wood",
           color=vary(cmul(rc, 1.0 + 0.1 * i), 0.1, 2.0, 60 + i), cap0=True, cap1=False, twist=pi / 4,
           smooth=False, cap_color=lin("#3a2617"))
# flag on the apex
mb.cyl((0, 0, apex_z - 0.2), (0, 0, apex_z + 1.1), 0.03, 0.025, segs=6, mat="wood", color=PAL["wood_dark"])
fl = [Vector((0, 0, apex_z + 1.08)), Vector((0.55, 0.05, apex_z + 0.93)), Vector((0, 0, apex_z + 0.78))]
mb.poly(fl, [(0, 1, 2)], "fabric", PAL["red"])

# ladder from the ground to the front gap of the deck (local -Y side)
lg0 = Vector((0, -(B0 + 0.9), 0.0))
lg1 = Vector((0, -(D + 0.05), ZP + 0.95))
side = Vector((1, 0, 0))
for s in (-0.26, 0.26):
    mb.cyl(lg0 + side * s, lg1 + side * s, 0.045, 0.045, segs=6, mat="wood", color=wood(500), cap_color=PAL["endgrain"])
nr = 26
for k in range(1, nr):
    p = lg0.lerp(lg1, k / nr)
    if p.z > ZP + 0.6:
        break
    mb.cyl(p - side * 0.26, p + side * 0.26, 0.025, 0.025, segs=5, mat="wood", color=cmul(PAL["wood_light"], 0.9),
           cap0=False, cap1=False)
# lantern hanging at the deck corner
lan = Vector((-(D - 0.1), -(D - 0.1), ZP - 0.45))
mb.tube([lan + Vector((0, 0, 0.42)), lan + Vector((0, 0, 0.12))], 0.008, mat="paint", color=PAL["metal"])
mb.box(lan, (0.14, 0.14, 0.2), mat="EMIT_lantern", color=(1, 1, 1))
mb.box(lan + Vector((0, 0, 0.12)), (0.18, 0.18, 0.04), mat="paint", color=PAL["metal"])
mb.box(lan - Vector((0, 0, 0.11)), (0.17, 0.17, 0.03), mat="paint", color=PAL["metal"])

o = mb.obj(coll, "tower")
L = LAYOUT["tower"]
pos = P(L["a"], L["r"])
o.location = pos
o.rotation_euler = (0, 0, rot_facing(pos) + radians(8))
bpy.context.view_layer.update()
M = o.matrix_world
# light points (markers are created by 10_markers.py)
bpy.context.scene["pts_lantern_tower"] = [list(M @ lan)]
bpy.context.scene["pts_window_tower"] = [list(M @ Vector((0, -(C + 0.6), (ZW + ZR) / 2)))]
result = {"tris": sum(len(p.vertices) - 2 for p in o.data.polygons), "top": apex_z + 1.1}
