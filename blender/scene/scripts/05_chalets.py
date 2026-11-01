# Step 5: log cabins (chalets) with glowing windows (EMIT_window), porch, chimney, light markers.
LIB = "/Users/valentinbour/Desktop/Git/LoupGarou/blender/scene/scripts/_lib.py"
exec(compile(open(LIB).read(), LIB, "exec"))

coll = get_coll("camp_export/static/chalets")
clear_coll(coll)
mcoll = get_coll("camp_export/markers")
rng = random.Random(11)

RL = 0.13            # log radius
PITCH_Z = 0.235      # vertical log spacing
EXT = 0.24           # log ends sticking out at the corners


def log_color(seed, tone):
    base = cmix(lin("#8a5634"), lin("#a86c3e"), tone)

    def f(p, n=None):
        k = 1 + 0.14 * nz((p.x * 0.7, p.y * 0.7, p.z * 6), 2.0, seed) + 0.06 * nz(p, 9.0, seed + 1)
        under = 0.72 + 0.28 * smoothstep(-0.6, 0.6, n.z if n is not None else 0)
        return cmul(base, k * under)
    return f


def endgrain(center, r):
    def f(p, n=None):
        d = (p - Vector(center)).length / r
        c = cmix(PAL["endgrain"], PAL["endgrain_ring"], 0.3 + 0.4 * d)
        return cmix(c, PAL["bark_dark"], smoothstep(0.8, 1.0, d))
    return f


def endgrain2(pa, pb, r):
    pa, pb = Vector(pa), Vector(pb)

    def f(p, n=None):
        d = min((p - pa).length, (p - pb).length) / r
        c = cmix(PAL["endgrain"], PAL["endgrain_ring"], 0.3 + 0.4 * d)
        return cmix(c, PAL["bark_dark"], smoothstep(0.8, 1.0, d))
    return f


def subtract(intervals, cut):
    out = []
    for a, b in intervals:
        c0, c1 = cut
        if c1 <= a or c0 >= b:
            out.append((a, b))
            continue
        if c0 > a:
            out.append((a, c0))
        if c1 < b:
            out.append((c1, b))
    return out


def window(mb, center, tang, nrm, w, h, shutters=None, flower=False, depth=RL):
    """Window in a wall opening. center: pane centre (wall plane), tang: along wall, nrm: outward."""
    c = Vector(center)
    t = Vector(tang).normalized()
    n = Vector(nrm).normalized()
    up = Vector((0, 0, 1))
    rot = (0, 0, atan2(t.y, t.x))
    fw = 0.08
    # glass
    hw, hh = w / 2, h / 2
    pc = c + n * 0.0
    mb.poly([pc - t * hw - up * hh + n * 0.01, pc + t * hw - up * hh + n * 0.01, pc + t * hw + up * hh + n * 0.01,
             pc - t * hw + up * hh + n * 0.01], [(0, 1, 2, 3)], "EMIT_window", (1, 1, 1))
    frame_col = lin("#5b3a22")
    D = depth * 2 + 0.06
    # frame (top, bottom, sides)
    for dz in (hh + fw / 2, -hh - fw / 2):
        mb.box(c + up * dz, (w + 2 * fw, D, fw), rot=rot, mat="wood", color=frame_col)
    for dt in (hw + fw / 2, -hw - fw / 2):
        mb.box(c + t * dt, (fw, D, h), rot=rot, mat="wood", color=frame_col)
    # mullions (cross)
    mb.box(c + n * 0.03, (0.045, 0.04, h), rot=rot, mat="wood", color=frame_col)
    mb.box(c + n * 0.03 + up * (h * 0.08), (w, 0.04, 0.045), rot=rot, mat="wood", color=frame_col)
    # sill
    mb.box(c - up * (hh + fw + 0.03) + n * (depth * 0.6), (w + 0.3, D * 0.7 + 0.1, 0.06), rot=rot, mat="wood",
           color=lin("#6b4428"))
    if shutters:
        for s in (-1, 1):
            sc = c + t * s * (hw + fw + w * 0.27) + n * (depth + 0.05)
            for kk in range(3):
                off = (kk - 1) * (w * 0.5 / 3)
                mb.box(sc + t * off, (w * 0.5 / 3 - 0.01, 0.04, h + 0.1), rot=rot, mat="wood",
                       color=cmul(shutters, 1 + 0.08 * (kk - 1)))
            mb.box(sc + n * 0.03 + up * (h * 0.25), (w * 0.5, 0.03, 0.07), rot=rot, mat="wood", color=cmul(shutters, 0.8))
            mb.box(sc + n * 0.03 - up * (h * 0.25), (w * 0.5, 0.03, 0.07), rot=rot, mat="wood", color=cmul(shutters, 0.8))
    if flower:
        fb = c - up * (hh + fw + 0.17) + n * (depth + 0.12)
        mb.box(fb, (w + 0.1, 0.22, 0.2), rot=rot, mat="wood", color=lin("#7a4a2a"))
        for kk in range(5):
            tt = (kk - 2) / 2 * (w / 2)
            mb.blob(fb + t * tt + up * 0.14, (0.12, 0.1, 0.1), subdiv=1, seed=kk + 900, amp=0.3, mat="foliage",
                    color=PAL["foliage_light"], smooth=True)
            if kk % 2 == 0:
                mb.blob(fb + t * tt + up * 0.22 + n * 0.03, (0.05, 0.05, 0.04), subdiv=1, seed=kk + 950, amp=0.2,
                        mat="paint", color=[PAL["red"], PAL["yellow"], PAL["white"]][kk // 2 % 3])
    return c + n * 0.45


def door(mb, center, tang, nrm, w=0.95, h=1.95, color=lin("#6e4527")):
    c = Vector(center)
    t = Vector(tang).normalized()
    n = Vector(nrm).normalized()
    up = Vector((0, 0, 1))
    rot = (0, 0, atan2(t.y, t.x))
    planks = 5
    for i in range(planks):
        off = (i - (planks - 1) / 2) * (w / planks)
        mb.box(c + t * off + up * (h / 2), (w / planks - 0.012, 0.06, h), rot=rot, mat="wood",
               color=cmul(color, 1 + 0.07 * ((i * 7) % 3 - 1)))
    for dz in (0.3, h - 0.3):
        mb.box(c + n * 0.045 + up * dz, (w - 0.06, 0.035, 0.12), rot=rot, mat="wood", color=cmul(color, 0.8))
    mb.box(c + n * 0.05 + t * (w * 0.36) + up * 1.0, (0.04, 0.05, 0.12), rot=rot, mat="paint", color=PAL["metal"])
    fw = 0.09
    D = RL * 2 + 0.06
    mb.box(c + up * (h + fw / 2), (w + 2 * fw, D, fw), rot=rot, mat="wood", color=lin("#5b3a22"))
    for s in (-1, 1):
        mb.box(c + t * s * (w / 2 + fw / 2) + up * (h / 2), (fw, D, h), rot=rot, mat="wood", color=lin("#5b3a22"))


def cabin(name, w, d, Hw, pitch_deg, openings, porch=False, chimney=None, seed=0, tone=0.5, roof_col=None):
    """Canonical frame: ridge along X, eave walls S (-Y) and N (+Y), gable walls W (-X) and E (+X).
    openings: list of dict(wall, kind, t, z0, z1, w, ...) with t along the wall from its centre."""
    mb = MB(name)
    tanp = math.tan(radians(pitch_deg))
    ridge_z = Hw + RL + (d / 2 + RL) * tanp
    lights = []
    walls = {
        # wall: (origin of wall centre, tangent, outward normal, half length (incl. corner ext), phase, gable)
        "S": (Vector((0, -d / 2, 0)), Vector((1, 0, 0)), Vector((0, -1, 0)), w / 2 + EXT, 0.0, False),
        "N": (Vector((0, d / 2, 0)), Vector((-1, 0, 0)), Vector((0, 1, 0)), w / 2 + EXT, 0.0, False),
        "W": (Vector((-w / 2, 0, 0)), Vector((0, -1, 0)), Vector((-1, 0, 0)), d / 2 + EXT, 0.5, True),
        "E": (Vector((w / 2, 0, 0)), Vector((0, 1, 0)), Vector((1, 0, 0)), d / 2 + EXT, 0.5, True),
    }
    lc = log_color(seed, tone)
    for wname, (o, t, n, half, phase, gable) in walls.items():
        cuts = [op for op in openings if op["wall"] == wname]
        i = 0
        while True:
            z = RL * 0.85 + PITCH_Z * (i + phase)
            i += 1
            if not gable and z > Hw:
                break
            if gable and z > ridge_z - RL * 1.5:
                break
            hl = half
            if gable and z > Hw:
                hl = min(half, (ridge_z - z) / tanp - RL * 0.5)
                if hl < 0.25:
                    break
            segs = [(-hl, hl)]
            for op in cuts:
                if z + RL * 0.7 > op["z0"] and z - RL * 0.7 < op["z1"]:
                    segs = subtract(segs, (op["t"] - op["w"] / 2 - 0.09, op["t"] + op["w"] / 2 + 0.09))
            for a, b in segs:
                if b - a < 0.12:
                    continue
                pa = o + t * a + Vector((0, 0, z))
                pb = o + t * b + Vector((0, 0, z))
                mb.cyl(pa, pb, RL, RL, segs=8, mat="bark", color=lc, cap_color=endgrain2(pa, pb, RL), rings=1,
                       twist=rng.uniform(0, 1))
        for op in cuts:
            c = o + t * op["t"]
            if op["kind"] == "window":
                pc = c + Vector((0, 0, (op["z0"] + op["z1"]) / 2))
                lp = window(mb, pc, t, n, op["w"], op["z1"] - op["z0"], shutters=op.get("shutters"),
                            flower=op.get("flower", False))
                if op.get("light", True):
                    lights.append(lp)
            elif op["kind"] == "door":
                door(mb, c, t, n, w=op["w"], h=op["z1"])
    # stone plinth
    st = vary(PAL["stone"], 0.12, 3.0, seed + 3)
    mb.box((0, -d / 2, 0.06), (w + 0.2, 0.36, 0.16), mat="stone", color=st, bevel=0.03)
    mb.box((0, d / 2, 0.06), (w + 0.2, 0.36, 0.16), mat="stone", color=st, bevel=0.03)
    mb.box((-w / 2, 0, 0.06), (0.36, d + 0.2, 0.16), mat="stone", color=st, bevel=0.03)
    mb.box((w / 2, 0, 0.06), (0.36, d + 0.2, 0.16), mat="stone", color=st, bevel=0.03)
    # roof: shingle rows on both slopes
    ov_e, ov_g = 0.5, 0.42
    slope_len = (d / 2 + RL + ov_e) / cos(radians(pitch_deg))
    rows = 7
    rc = roof_col or PAL["shingle"]
    for side in (-1, 1):
        for k in range(rows):
            s0 = slope_len * k / rows
            s_mid = s0 + slope_len / rows * 0.5
            # point on slope: from ridge going down toward side
            y = side * s_mid * cos(radians(pitch_deg))
            zz = ridge_z + 0.06 - s_mid * sin(radians(pitch_deg))
            ang = -side * radians(pitch_deg + 2.5)
            col = cmul(rc, 0.85 + 0.25 * rng.random() - 0.1 * (k == rows - 1))
            mb.box((0, y, zz + 0.02 * (rows - k) / rows), (w + 2 * EXT + 2 * ov_g, slope_len / rows * 1.25, 0.06),
                   rot=(ang, 0, 0), mat="wood", color=vary(col, 0.1, 2.5, seed + k))
        # barge boards along the gable edges
        for gx in (-1, 1):
            x = gx * (w / 2 + EXT + ov_g)
            p_top = Vector((x, 0, ridge_z + 0.02))
            p_low = Vector((x, side * (d / 2 + RL + ov_e), ridge_z - (d / 2 + RL + ov_e) * tanp - 0.02))
            mid = (p_top + p_low) / 2
            mb.box(mid, (0.06, (p_low - p_top).length + 0.05, 0.2), rot=(-side * radians(pitch_deg), 0, 0),
                   mat="wood", color=lin("#4f3420"))
    mb.cyl((-(w / 2 + EXT + ov_g + 0.05), 0, ridge_z + 0.1), ((w / 2 + EXT + ov_g + 0.05), 0, ridge_z + 0.1), 0.1,
           segs=8, mat="wood", color=vary(lin("#5e3b22"), 0.1, 2, seed), cap_color=lin("#a5713f"))
    # porch on the S side
    if porch:
        pd = 1.7
        y0, y1 = -d / 2 - 0.15, -d / 2 - 0.15 - pd
        plank_n = 9
        for k in range(plank_n):
            yy = y0 - (k + 0.5) * pd / plank_n
            mb.box((0, yy, 0.2), (w + 0.4, pd / plank_n - 0.015, 0.06), mat="wood",
                   color=cmul(lin("#9b6a40"), 0.9 + 0.2 * rng.random()))
        mb.box((0, (y0 + y1) / 2, 0.09), (w + 0.3, pd, 0.16), mat="wood", color=lin("#4a3020"))
        # steps
        for k, (dy, hz) in enumerate(((0.3, 0.13), (0.6, 0.06))):
            mb.box((0, y1 - dy + 0.15, hz / 2 + 0.02), (1.3, 0.3, hz), mat="wood", color=lin("#8a5a36"))
        # lean-to porch roof starting under the main eave
        eave_z = ridge_z - (d / 2 + RL + ov_e) * tanp
        y_a, z_a = -d / 2 - 0.2, eave_z - 0.1
        y_b, z_b = y1 - 0.4, eave_z - 0.42
        ang = atan2(z_a - z_b, y_a - y_b)
        yb_beam = y1 + 0.12
        Hp = z_a - (z_a - z_b) * (y_a - yb_beam) / (y_a - y_b) - 0.16
        rows_p = 4
        run = y_a - y_b
        for k in range(rows_p):
            t0 = (k + 0.5) / rows_p
            yy = y_a - run * t0
            zz = z_a - (z_a - z_b) * t0
            mb.box((0, yy, zz + 0.015 * (rows_p - k)), (w + 0.8, run / rows_p * 1.3, 0.06),
                   rot=(ang + radians(2), 0, 0), mat="wood",
                   color=vary(cmul(rc, 0.9 + 0.2 * rng.random()), 0.1, 2.5, seed + 50 + k))
        # posts + beam
        px = [-w / 2 - 0.1, -0.85, 0.85, w / 2 + 0.1]
        for x in px:
            mb.cyl((x, yb_beam, 0.2), (x, yb_beam, Hp), 0.085, segs=8, mat="bark", color=lc, cap0=False)
        mb.box((0, yb_beam, Hp + 0.08), (w + 0.5, 0.18, 0.18), mat="wood", color=lin("#6b4428"))
        # railing between outer posts (stairs in the middle)
        for xa, xb in ((px[0], px[1]), (px[2], px[3])):
            mb.box(((xa + xb) / 2, yb_beam, 0.95), (xb - xa, 0.08, 0.08), mat="wood", color=lin("#7a4e2e"))
            mb.box(((xa + xb) / 2, yb_beam, 0.55), (xb - xa, 0.06, 0.06), mat="wood", color=lin("#7a4e2e"))
            nb = int((xb - xa) / 0.35)
            for k in range(1, nb):
                x = xa + (xb - xa) * k / nb
                mb.box((x, yb_beam, 0.6), (0.05, 0.05, 0.7), mat="wood", color=lin("#7a4e2e"))
        # hanging lantern
        lx = 0.85
        mb.tube([(lx, yb_beam, Hp), (lx, yb_beam, Hp - 0.3)], 0.008, mat="paint", color=PAL["metal"])
        lan = Vector((lx, yb_beam, Hp - 0.42))
        mb.box(lan, (0.14, 0.14, 0.2), mat="EMIT_lantern", color=(1, 1, 1))
        mb.box(lan + Vector((0, 0, 0.12)), (0.18, 0.18, 0.04), mat="paint", color=PAL["metal"])
        mb.box(lan - Vector((0, 0, 0.11)), (0.17, 0.17, 0.03), mat="paint", color=PAL["metal"])
        lights.append(("lantern", lan))
        # a bench on the porch
        mb.box((-1.6, -d / 2 - 0.5, 0.62), (1.3, 0.38, 0.06), mat="wood", color=lin("#8a5a36"))
        for x in (-2.1, -1.1):
            mb.box((x, -d / 2 - 0.5, 0.42), (0.08, 0.32, 0.4), mat="wood", color=lin("#6b4428"))
    if chimney:
        cx, cy = chimney
        top = ridge_z + 0.9
        ccol = vary(cmix(PAL["stone"], lin("#8a7a68"), 0.4), 0.14, 2.2, seed + 9)
        mb.box((cx, cy, top / 2), (0.75, 0.75, top), mat="stone", color=ccol, bevel=0.05, taper=(0.8, 0.8))
        # irregular stones on the faces
        for k in range(14):
            zz = rng.uniform(0.3, top - 0.4)
            side = rng.choice((-1, 1))
            sc = 1 - 0.2 * zz / top
            if rng.random() < 0.5:
                pos = (cx + side * 0.37 * sc, cy + rng.uniform(-0.3, 0.3) * sc, zz)
            else:
                pos = (cx + rng.uniform(-0.3, 0.3) * sc, cy + side * 0.37 * sc, zz)
            mb.blob(pos, (0.14, 0.14, 0.1), subdiv=1, seed=k + seed * 10, amp=0.25, mat="stone",
                    color=cmul(ccol((0, 0, zz)), 0.9 + 0.2 * rng.random()))
        mb.box((cx, cy, top + 0.05), (0.7, 0.7, 0.1), mat="stone", color=lin("#5f5850"))
        mb.box((cx, cy, top + 0.08), (0.42, 0.42, 0.06), mat="stone", color=lin("#1c1714"))
    return mb, lights


SHUT_G = lin("#3f6a54")
SHUT_R = lin("#9a3b2c")
SHUT_B = lin("#3c5f80")

specs = {
    # chalet A: big cabin, eave side (S) faces the fire, porch, two front windows, side windows
    "chalet_A": dict(gable_front=False, Hw=2.6, pitch=33, porch=True, chimney=(2.9 + 0.3, 0.6), tone=0.45,
                     openings=[
                         dict(wall="S", kind="door", t=0.0, z0=0.0, z1=1.98, w=0.95),
                         dict(wall="S", kind="window", t=-1.75, z0=0.95, z1=1.85, w=0.95, shutters=SHUT_G,
                              flower=True),
                         dict(wall="S", kind="window", t=1.75, z0=0.95, z1=1.85, w=0.95, shutters=SHUT_G,
                              flower=True),
                         dict(wall="W", kind="window", t=0.0, z0=1.0, z1=1.8, w=0.8),
                         dict(wall="E", kind="window", t=-0.6, z0=1.0, z1=1.8, w=0.8, light=False),
                         dict(wall="W", kind="window", t=0.0, z0=2.85, z1=3.3, w=0.5, light=False),
                     ]),
    # chalet B: gable faces the fire (E wall), door + window + attic window
    "chalet_B": dict(gable_front=True, Hw=2.3, pitch=38, porch=False, chimney=(-0.5, 2.55), tone=0.25,
                     openings=[
                         dict(wall="E", kind="door", t=-0.75, z0=0.0, z1=1.95, w=0.9),
                         dict(wall="E", kind="window", t=0.8, z0=0.95, z1=1.8, w=0.9, shutters=SHUT_R),
                         dict(wall="E", kind="window", t=0.0, z0=2.75, z1=3.25, w=0.55, light=False),
                         dict(wall="S", kind="window", t=0.4, z0=1.0, z1=1.75, w=0.8, shutters=SHUT_R),
                         dict(wall="N", kind="window", t=0.0, z0=1.0, z1=1.75, w=0.8, light=False),
                     ]),
    # chalet C: small cabin, gable to the fire
    "chalet_C": dict(gable_front=True, Hw=2.15, pitch=40, porch=False, chimney=None, tone=0.7,
                     openings=[
                         dict(wall="E", kind="door", t=0.55, z0=0.0, z1=1.9, w=0.85),
                         dict(wall="E", kind="window", t=-0.75, z0=0.95, z1=1.7, w=0.75, shutters=SHUT_B),
                         dict(wall="S", kind="window", t=0.0, z0=1.0, z1=1.7, w=0.7, light=False),
                     ]),
}

light_points = []
stats = {}
for key, sp in specs.items():
    L = LAYOUT[key]
    w, d = L["w"], L["d"]
    if sp["gable_front"]:
        w, d = L["d"], L["w"]      # gable wall (E) is the front: its length is d
    mb, lights = cabin(key, w, d, sp["Hw"], sp["pitch"], sp["openings"], porch=sp["porch"], chimney=sp["chimney"],
                       seed=hash(key) % 1000, tone=sp["tone"])
    o = mb.obj(coll, key)
    pos = P(L["a"], L["r"])
    rot = rot_facing(pos) + radians(rng.uniform(-6, 6))
    if sp["gable_front"]:
        rot -= pi / 2
    o.location = pos
    o.rotation_euler = (0, 0, rot)
    bpy.context.view_layer.update()
    for lp in lights:
        if isinstance(lp, tuple):
            light_points.append(("lantern", o.matrix_world @ lp[1]))
        else:
            light_points.append(("window", o.matrix_world @ lp))
    stats[key] = sum(len(p.vertices) - 2 for p in o.data.polygons)

# light points (markers are created by 10_markers.py)
bpy.context.scene["pts_window_chalets"] = [list(p) for k, p in light_points if k == "window"]
bpy.context.scene["pts_lantern_chalets"] = [list(p) for k, p in light_points if k == "lantern"]
wi = len(bpy.context.scene["pts_window_chalets"])
CHALET_LANTERNS = list(bpy.context.scene["pts_lantern_chalets"])
result = {"tris": stats, "windows": wi, "lanterns": CHALET_LANTERNS}
