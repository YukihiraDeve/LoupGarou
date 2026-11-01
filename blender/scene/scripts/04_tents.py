# Step 4: canvas tents (bell tents and A-frame ridge tents), doors facing the fire.
LIB = "/Users/valentinbour/Desktop/Git/LoupGarou/blender/scene/scripts/_lib.py"
exec(compile(open(LIB).read(), LIB, "exec"))

coll = get_coll("camp_export/static/tents")
clear_coll(coll)
rng = random.Random(7)


def canvas_col(base, seed, z_top):
    def f(p, n=None):
        k = 1 + 0.07 * nz(p, 1.2, seed) + 0.04 * nz(p, 5.0, seed + 1)
        dirt = smoothstep(0.35, 0.0, p.z) * 0.35          # dusty hem
        c = cmix(base, lin("#7a6247"), dirt)
        return cmul(c, k * (0.88 + 0.12 * clamp(p.z / z_top)))
    return f


def stake_and_rope(mb, top, ground_pt):
    mb.tube([top, ground_pt + Vector((0, 0, 0.12))], 0.009, segs=3, mat="wood", color=PAL["rope"])
    mb.box(ground_pt + Vector((0, 0, 0.07)), (0.04, 0.04, 0.18), mat="wood", color=PAL["wood_light"])


# ----------------------------------------------------------------------------- bell tent
def bell_tent(name, base, glow):
    mb = MB(name)
    Rw, Hw, Hapex = 2.05, 0.8, 3.0
    SEG = 24
    canvas_mat = "EMIT_tent" if glow else "fabric"
    col = canvas_col(cmul(base, 0.92) if glow else base, rng.randint(0, 999), Hapex)
    bm = mb.bm
    # profile rings (radius, z): wall then slightly concave cone
    prof = [(Rw, 0.0), (Rw, Hw * 0.5), (Rw, Hw), (Rw + 0.1, Hw + 0.06), (1.35, 1.55), (0.7, 2.3), (0.08, Hapex)]
    rows = []
    front = -pi / 2    # local -Y
    for (r, z) in prof:
        row = []
        for i in range(SEG):
            a = front + 2 * pi * i / SEG
            sag = 1.0 - (0.03 if (i % 2 == 0 and z > Hw) else 0.0)  # seams between panels
            row.append(bm.verts.new((r * sag * cos(a), r * sag * sin(a), z)))
        rows.append(row)
    faces = []
    for k, (A, B) in enumerate(zip(rows[:-1], rows[1:])):
        for i in range(SEG):
            j = (i + 1) % SEG
            if i in (SEG - 1, 0) and k <= 3:      # door opening, centred on the front axis
                continue
            faces.append(bm.faces.new((A[i], A[j], B[j], B[i])))
    apex = bm.verts.new((0, 0, Hapex + 0.02))
    top = [bm.faces.new((rows[-1][i], rows[-1][(i + 1) % SEG], apex)) for i in range(SEG)]
    faces += top
    for f in faces:
        f.normal_update()
        c = f.calc_center_median()
        if f.normal.dot(Vector((c.x, c.y, 0))) < 0 and abs(f.normal.z) < 0.99:
            f.normal_flip()
    mb.paint(faces, canvas_mat, col, smooth=True)
    # door flaps folded to both sides of the opening
    a0 = front - 2 * pi / SEG * 1.0
    a1 = front + 2 * pi / SEG * 1.0
    for a, s in ((a0, -1), (a1, 1)):
        p_low = Vector((Rw * cos(a), Rw * sin(a), 0.05))
        p_hi = Vector(((Rw + 0.05) * cos(a), (Rw + 0.05) * sin(a), 1.25))
        tang = Vector((-sin(a), cos(a), 0)) * s
        out = Vector((cos(a), sin(a), 0))
        p_tip = p_low + tang * 0.35 + out * 0.18 + Vector((0, 0, 0.55))
        fl_col = cmul(base, 0.85)
        mb.poly([p_low, p_tip, p_hi], [(0, 1, 2)], canvas_mat, fl_col, smooth=False)
        mb.box(p_tip.lerp(p_hi, 0.5), (0.05, 0.05, 0.04), mat="wood", color=PAL["rope"])
    # interior: ground sheet and a glow / shadow panel at the back
    mb.cyl((0, 0, 0.005), (0, 0, 0.02), Rw - 0.05, segs=16, mat="fabric", color=lin("#3b3227"), cap0=False)
    if glow:
        mb.cyl((0, 0, 0.0), (0, 0, 2.6), 0.05, segs=6, mat="wood", color=PAL["wood"])
        mb.box((0.0, 0.0, 1.6), (0.12, 0.12, 0.2), mat="EMIT_lantern", color=(1, 1, 1))
    else:
        mb.cyl((0, 0, 0.0), (0, 0, 2.6), 0.05, segs=6, mat="wood", color=PAL["wood"])
    # pole top + small flag
    mb.cyl((0, 0, Hapex - 0.1), (0, 0, Hapex + 0.45), 0.03, segs=6, mat="wood", color=PAL["wood_dark"])
    mb.poly([(0, 0, Hapex + 0.44), (0.32, 0.02, Hapex + 0.36), (0, 0, Hapex + 0.26)], [(0, 1, 2)], "fabric",
            PAL["red"])
    # guy ropes
    for i in range(0, SEG, 3):
        if i in (0, SEG - 1, 1, SEG - 2):
            continue
        a = front + 2 * pi * i / SEG
        top_p = Vector(((Rw + 0.1) * cos(a), (Rw + 0.1) * sin(a), Hw + 0.06))
        gp = Vector(((Rw + 1.0) * cos(a), (Rw + 1.0) * sin(a), 0))
        stake_and_rope(mb, top_p, gp)
    return mb


# ----------------------------------------------------------------------------- A-frame tent
def aframe_tent(name, base):
    mb = MB(name)
    L, W, Hr = 2.5, 2.1, 1.5
    seed = rng.randint(0, 999)
    col = canvas_col(base, seed, Hr)
    bm = mb.bm
    NY = 4
    eave_z = 0.12
    # fly: two slopes, ridge sags slightly in the middle
    ridge, left, right = [], [], []
    for k in range(NY + 1):
        y = -L / 2 + L * k / NY
        sag = 0.06 * sin(pi * k / NY)
        ridge.append(bm.verts.new((0, y, Hr - sag)))
        left.append(bm.verts.new((-W / 2 - 0.05, y, eave_z + sag * 0.5)))
        right.append(bm.verts.new((W / 2 + 0.05, y, eave_z + sag * 0.5)))
    fly = []
    for k in range(NY):
        fly.append(bm.faces.new((ridge[k], ridge[k + 1], left[k + 1], left[k])))
        fly.append(bm.faces.new((ridge[k + 1], ridge[k], right[k], right[k + 1])))
    for f in fly:
        f.normal_update()
        if f.normal.z < 0:
            f.normal_flip()
    mb.paint(fly, "fabric", col, smooth=False)
    # cream valance strips along the eaves
    for side in (-1, 1):
        for k in range(NY):
            a = Vector((side * (W / 2 + 0.05), -L / 2 + L * k / NY, eave_z + 0.03 * sin(pi * k / NY)))
            b = Vector((side * (W / 2 + 0.05), -L / 2 + L * (k + 1) / NY, eave_z + 0.03 * sin(pi * (k + 1) / NY)))
            up = Vector((-side * 0.17, 0, 0.26))
            mb.poly([a, b, b + up, a + up], [(0, 1, 2, 3)], "fabric", PAL["cream"])
    # back wall
    mb.poly([(-W / 2, L / 2, 0.0), (W / 2, L / 2, 0.0), (0, L / 2, Hr - 0.02)], [(0, 1, 2)], "fabric", col)
    # front: door panels folded back to both sides (opening reveals the dark interior)
    y0 = -L / 2
    for side in (-1, 1):
        base_pt = Vector((side * W / 2, y0, 0.02))
        top_pt = Vector((side * 0.08, y0, Hr - 0.1))
        tip = Vector((side * (W / 2 + 0.15), y0 - 0.25, 0.55))
        mb.poly([base_pt, tip, top_pt], [(0, 1, 2)], "fabric", cmul(base, 0.9))
        mb.box(tip, (0.05, 0.05, 0.05), mat="wood", color=PAL["rope"])
    # dark inner tent visible through the door
    inner = lin("#2b241c")
    mb.poly([(-W / 2 + 0.25, y0 + 0.35, 0.0), (W / 2 - 0.25, y0 + 0.35, 0.0), (0, y0 + 0.35, Hr - 0.2)],
            [(0, 1, 2)], "fabric", inner)
    mb.poly([(-W / 2 + 0.1, y0 + 0.1, 0.01), (W / 2 - 0.1, y0 + 0.1, 0.01), (W / 2 - 0.1, L / 2 - 0.1, 0.01),
             (-W / 2 + 0.1, L / 2 - 0.1, 0.01)], [(0, 1, 2, 3)], "fabric", lin("#3b3227"))
    # poles front and back
    for y in (-L / 2 - 0.04, L / 2 + 0.04):
        mb.cyl((0, y, 0), (0, y, Hr + 0.22), 0.028, segs=6, mat="wood", color=PAL["wood_dark"], cap0=False)
    # guy ropes: from pole tops and eave corners
    for y, dy in ((-L / 2 - 0.04, -1.1), (L / 2 + 0.04, 1.1)):
        stake_and_rope(mb, Vector((0, y, Hr + 0.15)), Vector((0, y + dy, 0)))
    for side in (-1, 1):
        for y in (-L / 2 + 0.2, 0.0, L / 2 - 0.2):
            stake_and_rope(mb, Vector((side * (W / 2 + 0.05), y, eave_z + 0.05)),
                           Vector((side * (W / 2 + 0.75), y, 0)))
    return mb


stats = {}
for key, v in LAYOUT.items():
    if not key.startswith("tent_"):
        continue
    pos = P(v["a"], v["r"])
    rot = rot_facing(pos) + radians(rng.uniform(-12, 12))
    base = PAL[v["color"]]
    if v["kind"] == "bell":
        mb = bell_tent(key, base, v.get("glow", False))
    else:
        mb = aframe_tent(key, base)
    o = mb.obj(coll, key)
    o.location = pos
    o.rotation_euler = (0, 0, rot)
    stats[key] = len(o.data.polygons)

result = stats
