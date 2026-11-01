# Step 9: props — signpost, stumps, woodpile + chopping block, cooler, guitar, picnic table, mugs, bucket,
# backpack. All built in world space into one object (merged later).
LIB = "/Users/valentinbour/Desktop/Git/LoupGarou/blender/scene/scripts/_lib.py"
exec(compile(open(LIB).read(), LIB, "exec"))

coll = get_coll("camp_export/static/props")
clear_coll(coll)
rng = random.Random(91)
mb = MB("props")
UP = Vector((0, 0, 1))


def frame_at(pos, yaw):
    """Matrix placing local coordinates at pos with a Z rotation."""
    return Matrix.Translation(Vector(pos)) @ Matrix.Rotation(yaw, 4, "Z")


def tbox(M, c, size, rot=(0, 0, 0), **kw):
    """Box in a local frame M (translation + yaw only)."""
    loc, q, _ = M.decompose()
    e = q.to_euler()
    cw = M @ Vector(c)
    return mb.box(cw, size, rot=(rot[0], rot[1], e.z + rot[2]), **kw)


def endgrain_at(center, r):
    def f(p, n=None):
        d = (p - Vector(center)).length / r
        ring = 0.5 + 0.5 * sin(d * 16)
        c = cmix(PAL["endgrain"], PAL["endgrain_ring"], 0.25 + 0.35 * ring * d)
        return cmix(c, PAL["bark_dark"], smoothstep(0.85, 1.0, d))
    return f


# ----------------------------------------------------------------------------- stumps
def stump(pos, r=0.24, h=0.45, seed=0):
    pos = Vector(pos)
    top = pos + Vector((0, 0, h))

    def rf(t, a):
        flare = 1 + 0.35 * (1 - t) ** 3
        return flare * (1 + 0.05 * nz((cos(a) * 2, sin(a) * 2, t * 3), 1.0, seed))
    bark = vary(cmix(PAL["bark"], PAL["bark_dark"], rng.random() * 0.5), 0.18, 4.0, seed)
    mb.cyl(pos - Vector((0, 0, 0.05)), top, r, r * 0.95, segs=12, mat="bark", color=bark, cap0=False,
           cap_color=endgrain_at(top, r), rings=3, rfunc=rf)
    for k in range(4):
        a = rng.uniform(0, 2 * pi) if k else seed
        d = Vector((cos(a), sin(a), 0))
        mb.cyl(pos + d * r * 0.8 + Vector((0, 0, 0.12)), pos + d * (r + 0.32) - Vector((0, 0, 0.03)), 0.07, 0.02,
               segs=5, mat="wood", color=bark, cap0=False, cap1=False)
    return top


def mug(pos, col, yaw=0.0):
    pos = Vector(pos)
    mb.cyl(pos, pos + Vector((0, 0, 0.095)), 0.045, 0.045, segs=10, mat="paint", color=col, cap0=True, cap1=False)
    # white enamel rim + dark inside
    mb.cyl(pos + Vector((0, 0, 0.088)), pos + Vector((0, 0, 0.097)), 0.047, 0.047, segs=10, mat="paint",
           color=PAL["white"], cap0=False, cap1=False)
    mb.cyl(pos + Vector((0, 0, 0.097)), pos + Vector((0, 0, 0.03)), 0.04, 0.04, segs=10, mat="paint",
           color=lin("#2a211b"), cap0=False, cap1=True)
    d = Vector((cos(yaw), sin(yaw), 0))
    pts = [pos + d * 0.044 + Vector((0, 0, 0.075))]
    for k in range(1, 6):
        a = pi * k / 5
        pts.append(pos + d * (0.044 + 0.03 * sin(a)) + Vector((0, 0, 0.045 + 0.03 * cos(a))))
    mb.tube(pts, 0.008, segs=4, mat="paint", color=col)


MUG_COLS = [PAL["red"], lin("#2f5f8a"), lin("#3f7a4a"), lin("#d9a52e")]

stump_tops = []
for i, (a, r, s) in enumerate([(213.75, 4.4, 1.0), (78.75, 4.45, 0.92), (348.75, 4.6, 1.1), (130.0, 9.8, 1.2),
                               (40.0, 11.2, 1.0), (285.0, 10.5, 0.85), (200.0, 11.5, 1.1)]):
    stump_tops.append(stump(P(a, r), r=0.22 * s, h=0.42 * s, seed=i * 13 + 1))
mug(stump_tops[0] + Vector((0.05, 0.02, 0)), MUG_COLS[0], 0.6)
mug(stump_tops[2] + Vector((0.0, 0.0, 0)), MUG_COLS[3], 4.0)

# ----------------------------------------------------------------------------- signpost
sp = P(343, 7.6)
mb.cyl(sp - Vector((0, 0, 0.3)), sp + Vector((0, 0, 2.35)), 0.075, 0.065, segs=6, mat="bark",
       color=vary(PAL["wood_dark"], 0.12, 3.0, 5), cap0=False, cap_color=PAL["endgrain"])
mb.cyl(sp + Vector((0, 0, 2.33)), sp + Vector((0, 0, 2.48)), 0.12, 0.02, segs=4, mat="wood", color=PAL["roof"],
       twist=pi / 4, smooth=False)
SIGN_COLS = [lin("#a8774a"), lin("#94643c"), lin("#b5885a")]
for k, (yaw, z, L) in enumerate([(radians(345), 2.05, 0.85), (radians(110), 1.78, 0.75), (radians(230), 1.5, 0.9)]):
    d = Vector((cos(yaw), sin(yaw), 0))
    side = Vector((-sin(yaw), cos(yaw), 0))
    c0 = sp + d * 0.08 + Vector((0, 0, z))
    hgt, th = 0.19, 0.05
    # pointed board as a prism (pentagon profile)
    prof = [(-0.05, -hgt / 2), (L - 0.12, -hgt / 2), (L, 0), (L - 0.12, hgt / 2), (-0.05, hgt / 2)]
    vs = []
    for sgn in (-1, 1):
        for (u, v) in prof:
            vs.append(c0 + d * u + Vector((0, 0, v)) + side * (sgn * th / 2))
    faces = [(0, 1, 2, 3, 4), (9, 8, 7, 6, 5)] + [(i, i + 5, (i + 1) % 5 + 5, (i + 1) % 5) for i in range(5)]
    col = SIGN_COLS[k]
    mb.poly(vs, faces, "wood", vary(col, 0.1, 6.0, 40 + k))
    # painted "lettering" strip on both faces
    for sgn in (-1, 1):
        a0 = c0 + d * 0.08 + side * sgn * (th / 2 + 0.004)
        b0 = c0 + d * (L - 0.22) + side * sgn * (th / 2 + 0.004)
        q = [a0 - UP * 0.03, b0 - UP * 0.03, b0 + UP * 0.03, a0 + UP * 0.03]
        mb.poly(q if sgn > 0 else q[::-1], [(0, 1, 2, 3)], "wood", lin("#3a2617"))

# ----------------------------------------------------------------------------- cooler (red, white lid)
cpos = P(303.75, 4.35)
M = frame_at(cpos, radians(303.75) + pi / 2)
tbox(M, (0, 0, 0.19), (0.62, 0.4, 0.36), mat="paint", color=lin("#c0362c"), bevel=0.035)
tbox(M, (0, 0, 0.405), (0.64, 0.42, 0.08), mat="paint", color=PAL["white"], bevel=0.03)
for s in (-1, 1):
    tbox(M, (s * 0.33, 0, 0.3), (0.04, 0.16, 0.05), mat="paint", color=lin("#e8e2d6"), bevel=0.01)
tbox(M, (0, -0.205, 0.33), (0.18, 0.02, 0.06), mat="paint", color=PAL["white"])

# bucket in another gap
bpos = P(123.75, 4.35)
mb.cyl(bpos, bpos + Vector((0, 0, 0.3)), 0.13, 0.16, segs=12, mat="paint", color=vary(lin("#7b8b8f"), 0.08, 5, 3),
       cap0=True, cap1=False)
mb.cyl(bpos + Vector((0, 0, 0.29)), bpos + Vector((0, 0, 0.12)), 0.15, 0.14, segs=12, mat="paint",
       color=lin("#3c4a52"), cap0=False, cap1=True)
mb.tube([bpos + Vector((-0.16, 0, 0.27)) + Vector((0.32 * t, 0, 0.12 * sin(pi * t))) for t in [k / 6 for k in range(7)]],
        0.006, segs=3, mat="paint", color=PAL["metal"])

# ----------------------------------------------------------------------------- guitar leaning on a log end
gap = 78.75                                # guitar in a bench gap, face to the fire, back on a stump
gpos = P(gap, 3.93)
yaw = radians(gap) - pi / 2 + 0.12
lean = radians(30)
G = Matrix.Translation(gpos) @ Matrix.Rotation(yaw, 4, "Z") @ Matrix.Rotation(-lean, 4, "X")


def gpoly2d(outline, z0, z1, mat, col):
    """Extrude a 2D outline in the guitar plane (x, z) along local y."""
    vs = []
    for y in (z0, z1):
        for (x, z) in outline:
            vs.append(G @ Vector((x, y, z)))
    n = len(outline)
    faces = [tuple(range(n))[::-1], tuple(range(n, 2 * n))]
    faces += [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
    mb.poly(vs, faces, mat, col)


body = []
N = 28
for k in range(N):
    t = 2 * pi * k / N
    # figure-eight body: lower bout (r .2), upper bout (r .155), waist
    z = 0.26 - 0.25 * cos(t)
    w = 0.2 * (1 - 0.55 * smoothstep(0.25, 0.45, z) + 0.35 * smoothstep(0.42, 0.5, z)) * abs(sin(t)) ** 0.75
    w = (0.2 if z < 0.26 else 0.155) * abs(sin(t)) ** 0.8 * (0.82 if 0.23 < z < 0.33 else 1.0)
    body.append((w * (1 if sin(t) >= 0 else -1), z + 0.02))
gpoly2d(body, -0.05, 0.05, "paint", lin("#c9853e"))
# dark side band + sound hole + bridge
hole = [(0.05 * cos(2 * pi * k / 12), 0.37 + 0.05 * sin(2 * pi * k / 12)) for k in range(12)]
gpoly2d(hole, -0.054, -0.05, "paint", lin("#1d1410"))
gpoly2d([(-0.07, 0.12), (0.07, 0.12), (0.07, 0.15), (-0.07, 0.15)], -0.058, -0.05, "wood", lin("#3a2617"))
# neck, head
gpoly2d([(-0.026, 0.5), (0.026, 0.5), (0.022, 0.95), (-0.022, 0.95)], -0.03, 0.02, "wood", lin("#5a3a22"))
gpoly2d([(-0.04, 0.95), (0.04, 0.95), (0.045, 1.12), (-0.045, 1.12)], -0.025, 0.015, "wood", lin("#2e1f15"))
for s in (-1, 1):
    for k in range(3):
        p = G @ Vector((s * 0.055, -0.005, 0.99 + 0.045 * k))
        mb.box(p, (0.03, 0.015, 0.015), rot=(0, 0, yaw), mat="paint", color=lin("#d8d0c0"))
# strings (one thin strip)
gpoly2d([(-0.007, 0.13), (0.007, 0.13), (0.007, 0.96), (-0.007, 0.96)], -0.06, -0.057, "paint", lin("#d8d0c0"))

# ----------------------------------------------------------------------------- picnic table
L = LAYOUT["picnic"]
tp = P(L["a"], L["r"])
TY = radians(L["a"]) + pi / 2 + radians(8)
M = frame_at(tp, TY)
wood_t = lambda k: cmul(lin("#a06d42"), 0.88 + 0.22 * ((k * 37) % 7) / 6)
for k in range(5):
    tbox(M, (0, -0.32 + k * 0.16, 0.76), (1.9, 0.15, 0.05), mat="wood", color=vary(wood_t(k), 0.1, 3, k))
for s in (-1, 1):
    for k in range(2):
        tbox(M, (0, s * (0.62 + k * 0.13), 0.46), (1.9, 0.12, 0.045), mat="wood", color=vary(wood_t(k + 5), 0.1, 3, k + 7))
    # A-frame legs
    for e in (-1, 1):
        tbox(M, (s * 0.72, e * 0.32, 0.38), (0.07, 0.07, 0.86), rot=(e * radians(-33), 0, 0), mat="wood",
             color=lin("#7a4e2e"))
    tbox(M, (s * 0.72, 0, 0.44), (0.07, 1.45, 0.07), mat="wood", color=lin("#7a4e2e"))
    tbox(M, (s * 0.72, 0, 0.72), (0.08, 0.75, 0.06), mat="wood", color=lin("#6b4428"))
mug(M @ Vector((0.4, -0.15, 0.785)), MUG_COLS[1], 1.0)
mug(M @ Vector((-0.55, 0.12, 0.785)), MUG_COLS[2], 2.5)
mug(M @ Vector((0.62, 0.2, 0.785)), MUG_COLS[0], 4.2)
# enamel pot
pp = M @ Vector((-0.15, -0.05, 0.785))
mb.cyl(pp, pp + Vector((0, 0, 0.16)), 0.12, 0.13, segs=12, mat="paint", color=lin("#2f5f8a"), cap0=True, cap1=False)
mb.cyl(pp + Vector((0, 0, 0.16)), pp + Vector((0, 0, 0.18)), 0.135, 0.12, segs=12, mat="paint", color=PAL["white"],
       cap0=False, cap1=True)
# table lantern (EMIT)
lp = M @ Vector((0.15, 0.18, 0.785 + 0.13))
mb.cyl(lp - Vector((0, 0, 0.13)), lp - Vector((0, 0, 0.1)), 0.08, 0.08, segs=6, mat="paint", color=PAL["metal"])
mb.cyl(lp - Vector((0, 0, 0.1)), lp + Vector((0, 0, 0.08)), 0.065, 0.065, segs=6, mat="EMIT_lantern", color=(1, 1, 1),
       cap0=False, cap1=False, smooth=False)
mb.cyl(lp + Vector((0, 0, 0.08)), lp + Vector((0, 0, 0.15)), 0.09, 0.025, segs=6, mat="paint", color=PAL["metal"])
mb.tube([lp + Vector((-0.06, 0, 0.14)), lp + Vector((0, 0, 0.24)), lp + Vector((0.06, 0, 0.14))], 0.006, segs=3,
        mat="paint", color=PAL["metal"])

# ----------------------------------------------------------------------------- woodpile + chopping block + axe
WP = P(141.0, 10.1)
M = frame_at(WP, radians(141.0) + pi / 2 - 0.35)
k = 0
for row in range(4):
    n = 6 - row
    for i in range(n):
        x = (i - (n - 1) / 2) * 0.24
        z = 0.11 + row * 0.2
        ry = rng.uniform(-0.06, 0.06)
        p0 = M @ Vector((x, -0.42 + ry, z))
        p1 = M @ Vector((x, 0.42 + ry, z))
        rr = rng.uniform(0.09, 0.115)
        bark = vary(cmix(PAL["bark"], PAL["bark_light"], rng.random()), 0.15, 5, 70 + k)
        mb.cyl(p0, p1, rr, rr, segs=7, mat="bark", color=bark, cap_color=lambda p, n=None: cmix(PAL["endgrain"],
               PAL["endgrain_ring"], rng.random() * 0.4), twist=rng.uniform(0, 3))
        k += 1
for s in (-1, 1):
    for e in (-1, 1):
        tbox(M, (s * 0.8, e * 0.3, 0.45), (0.06, 0.06, 0.9), mat="wood", color=lin("#6b4428"))
cb = stump(P(147.5, 8.2), r=0.26, h=0.36, seed=99)
ax0 = cb + Vector((0.02, 0.0, -0.05))
ax_dir = Vector((0.35, 0.15, 0.55)).normalized()
mb.cyl(ax0, ax0 + ax_dir * 0.62, 0.02, 0.018, segs=6, mat="wood", color=lin("#b38658"))
mb.box(ax0 + Vector((0, 0, 0.0)), (0.06, 0.16, 0.1), rot=(0, 0, radians(156)), mat="paint", color=PAL["metal_light"])

# ----------------------------------------------------------------------------- backpack next to the green tent
bp_pos = P(205, 6.0)
M = frame_at(bp_pos, radians(205) + 0.4)
tbox(M, (0, 0, 0.27), (0.38, 0.24, 0.52), rot=(radians(-8), 0, 0), mat="fabric", color=lin("#b4482e"), bevel=0.06)
tbox(M, (0, -0.15, 0.2), (0.28, 0.1, 0.22), mat="fabric", color=lin("#9a3a25"), bevel=0.04)
tbox(M, (0, 0.02, 0.56), (0.34, 0.2, 0.1), mat="fabric", color=lin("#3a5f7a"), bevel=0.03)
mb.cyl(M @ Vector((-0.22, 0.02, 0.6)), M @ Vector((0.22, 0.02, 0.6)), 0.07, 0.07, segs=8, mat="fabric",
       color=lin("#5d7346"))

o = mb.obj(coll, "props")
bpy.context.scene["pts_lantern_props"] = [list(lp)]
result = {"tris": sum(len(p.vertices) - 2 for p in o.data.polygons)}
