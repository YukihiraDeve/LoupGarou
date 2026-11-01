# Step 3: fire pit (stone ring, logs, embers), log benches and the 16 seat markers + fire marker.
LIB = "/Users/valentinbour/Desktop/Git/LoupGarou/blender/scene/scripts/_lib.py"
exec(compile(open(LIB).read(), LIB, "exec"))

coll = get_coll("camp_export/static/fire")
clear_coll(coll)
mcoll = get_coll("camp_export/markers")
rng = random.Random(42)

# ----------------------------------------------------------------------------- fire pit
mb = MB("fire_pit")

# stone ring
N_ST = 14
STONE_COLS = [lin("#8c8070"), lin("#9a8d78"), lin("#7c7062"), lin("#86786a"), lin("#958a7a"), lin("#6f665c")]
for i in range(N_ST):
    a = 360.0 * i / N_ST + rng.uniform(-4, 4)
    r = 0.93 + rng.uniform(-0.04, 0.05)
    c = P(a, r)
    sx, sy, sz = rng.uniform(0.16, 0.24), rng.uniform(0.14, 0.2), rng.uniform(0.11, 0.19)
    c.z = sz * 0.5
    base = rng.choice(STONE_COLS)

    def scol(p, n=None, base=base, seed=i):
        rr = hypot(p.x, p.y)
        soot = smoothstep(1.0, 0.74, rr) * smoothstep(0.34, 0.06, p.z) * 0.8
        k = 1 + 0.1 * nz(p, 7.0, seed) + 0.06 * nz(p, 18.0, seed + 1)
        bottom = smoothstep(-0.02, 0.12, p.z)
        cc = cmix(base, lin("#2c2622"), soot)
        return cmul(cc, k * (0.7 + 0.3 * bottom))
    mb.blob(c, (sx, sy, sz), subdiv=2, seed=100 + i, amp=0.34, freq=1.1, rot=(rng.uniform(-0.2, 0.2), 0, radians(a + 90)),
            mat="stone", color=scol, flat_bottom=-0.5)

# ember bed: low irregular mound
bm = mb.bm
rows = []
radii = [0.0, 0.2, 0.42, 0.62]
for k, r in enumerate(radii):
    if r == 0:
        rows.append([bm.verts.new((0, 0, 0.075))])
        continue
    row = []
    n = 18
    for i in range(n):
        a = 2 * pi * i / n
        rr = r * (1 + 0.12 * nz((cos(a), sin(a), k), 1.5, 9))
        h = 0.075 * (1 - (r / 0.62) ** 2) + 0.015 * nz((cos(a) * 3, sin(a) * 3, k), 1.0, 7)
        row.append(bm.verts.new((rr * cos(a), rr * sin(a), max(h, 0.004))))
    rows.append(row)
efaces = []
for A, B in zip(rows[:-1], rows[1:]):
    for i in range(len(B)):
        j = (i + 1) % len(B)
        if len(A) == 1:
            efaces.append(bm.faces.new((A[0], B[i], B[j])))
        else:
            efaces.append(bm.faces.new((A[i], B[i], B[j], A[j])))
mb.paint(efaces, "EMIT_embers", (1, 1, 1), smooth=True)

# coal chunks scattered on the bed (half glowing, half black)
for i in range(16):
    a = rng.uniform(0, 360)
    r = rng.uniform(0.1, 0.6)
    s = rng.uniform(0.035, 0.07)
    c = P(a, r, 0.05 * (1 - r / 0.62) + s * 0.4)
    glow = rng.random() < 0.55
    mb.blob(c, (s, s * 0.8, s * 0.6), subdiv=1, seed=300 + i, amp=0.3, rot=(0, 0, rng.uniform(0, 6)),
            mat="EMIT_embers" if glow else "wood", color=PAL["char"], smooth=False)


# fire logs: teepee of 5 logs, char + glowing inner ends
def fire_log(p_out, p_in, r, seed):
    p_out, p_in = Vector(p_out), Vector(p_in)
    mid = p_out.lerp(p_in, 0.62)

    def lcol(p, n=None):
        t = clamp((0.62 - hypot(p.x, p.y)) / 0.45)
        c = cmix(PAL["bark"], PAL["char"], smoothstep(0.1, 0.8, t))
        return cmul(c, 1 + 0.15 * nz(p, 9.0, seed))

    def rf(t, a):
        return 1 + 0.08 * nz((t * 4, cos(a), sin(a)), 1.0, seed)
    mb.cyl(p_out, mid, r, r * 0.95, segs=7, mat="bark", color=lcol, cap0=True, cap1=False, rings=3, rfunc=rf,
           cap_color=lambda p, n=None: cmix(PAL["endgrain"], PAL["endgrain_ring"], 0.5))
    mb.cyl(mid, p_in, r * 0.95, r * 0.75, segs=7, mat="EMIT_embers", color=(1, 1, 1), cap0=False, cap1=True,
           rings=1, rfunc=rf)


for i in range(5):
    a = 72 * i + 20 + rng.uniform(-8, 8)
    p_out = P(a, 0.6, 0.06)
    p_in = P(a + 25, 0.06, 0.5 + rng.uniform(-0.05, 0.05))
    fire_log(p_out, p_in, rng.uniform(0.068, 0.085), 500 + i)
# two logs lying across the embers
fire_log(P(150, 0.62, 0.1), P(330, 0.1, 0.13), 0.08, 520)
fire_log(P(250, 0.6, 0.09), P(70, 0.06, 0.16), 0.075, 521)

fire_obj = mb.obj(coll, "fire_pit")

# ----------------------------------------------------------------------------- benches
bcoll = get_coll("camp_export/static/benches")
clear_coll(bcoll)
mb = MB("benches")
half = 180.0 / SEAT_COUNT          # 11.25 deg
seats = []
for k in range(LOG_COUNT):
    seed = 700 + k
    thc = SEAT_ANGLE0 + 2 * half * 2 * k + half
    a = radians(thc)
    D = SEAT_R * cos(radians(half))
    cen = Vector((D * cos(a), D * sin(a), 0))
    tang = Vector((-sin(a), cos(a), 0))
    L = rng.uniform(2.05, 2.3)
    r = rng.uniform(0.225, 0.25)
    seat_h = rng.uniform(0.445, 0.46)
    cz = seat_h - r
    shift = rng.uniform(-0.06, 0.06)  # small asymmetry along the log
    p0 = cen - tang * (L / 2 + shift) + Vector((0, 0, cz))
    p1 = cen + tang * (L / 2 - shift) + Vector((0, 0, cz))
    tone = rng.uniform(0, 1)
    bark = cmix(PAL["bark"], PAL["bark_light"], tone * 0.6)

    _d = (p1 - p0).normalized()
    _u = _d.cross(Vector((0, 0, 1))).normalized()
    _v = _d.cross(_u)

    def bark_col(p, n=None, bark=bark, seed=seed, cz=cz, p0=p0.copy(), d=_d, u=_u, v=_v):
        q = p - p0
        t = q.dot(d)
        ang = atan2(q.dot(v), q.dot(u))
        groove = 0.5 + 0.5 * sin(ang * 7 + 1.5 * t + 3.0 * nz((t * 0.8, ang, 0), 1.0, seed + 2))
        k1 = 1 + 0.18 * nz((t * 1.5, cos(ang) * 2, sin(ang) * 2), 1.0, seed) - 0.12 * groove ** 3
        under = smoothstep(cz - 0.2, cz + 0.15, p.z)
        moss = smoothstep(0.35, 0.7, nz(p, 1.3, seed + 5)) * smoothstep(cz + 0.05, cz + 0.2, p.z) * 0.35
        c = cmix(bark, PAL["moss"], moss)
        return cmul(c, k1 * (0.6 + 0.4 * under))

    def rf(t, ang, seed=seed):
        # keep the top (seat) nearly round; knots and swelling elsewhere
        top = max(0.0, -sin(ang)) ** 4   # v axis points down for horizontal logs
        bulge = 1 + 0.05 * nz((t * 3.0, 0, 0), 1.0, seed) + 0.06 * (1 - 4 * t * (1 - t)) ** 3
        bumps = 0.035 * nz((t * 14, cos(ang) * 2, sin(ang) * 2), 1.0, seed + 1)
        return bulge + bumps * (1 - top)

    def cap(c0):
        def f(p, n=None, c0=c0, r=r):
            d = (p - c0).length / r
            ring = 0.5 + 0.5 * sin(d * 18)
            c = cmix(PAL["endgrain"], PAL["endgrain_ring"], 0.25 + 0.35 * ring * d)
            return cmix(c, PAL["bark_dark"], smoothstep(0.85, 1.0, d))
        return f
    # build two halves so each end cap gets its own end-grain gradient
    mid = (p0 + p1) / 2
    twist = rng.uniform(0, 6.28)
    mb.cyl(p0, mid, r, r, segs=18, mat="bark", color=bark_col, cap0=True, cap1=False, cap_color=cap(p0),
           rings=7, rfunc=lambda t, ang, rf=rf: rf(t * 0.5, ang), twist=twist, uv_u0=k * 0.37, uv_v0=0.0)
    mb.cyl(mid, p1, r, r, segs=18, mat="bark", color=bark_col, cap0=False, cap1=True, cap_color=cap(p1),
           rings=7, rfunc=lambda t, ang, rf=rf: rf(0.5 + t * 0.5, ang), twist=twist, uv_u0=k * 0.37,
           uv_v0=(mid - p0).length / 0.6)
    # a branch stub on the back side of some logs
    if k % 3 != 1:
        out = Vector((cos(a), sin(a), 0))
        bp = p0.lerp(p1, rng.uniform(0.25, 0.75)) + out * r * 0.85 + Vector((0, 0, -0.03))
        mb.cyl(bp - out * 0.05, bp + out * 0.12 + Vector((0, 0, 0.04)), 0.045, 0.03, segs=6, mat="bark",
               color=cmul(bark, 0.9), cap_color=PAL["endgrain"])
    for j in (0, 1):
        phi = SEAT_ANGLE0 + 2 * half * (2 * k + j)
        pos = P(phi, SEAT_R, cz + r)
        seats.append((2 * k + j, pos))

bmesh.ops.remove_doubles(mb.bm, verts=list(mb.bm.verts), dist=0.0005)
bench_obj = mb.obj(bcoll, "benches")

# ----------------------------------------------------------------------------- markers
for n in [f"seat_{i:02d}" for i in range(SEAT_COUNT)] + ["fire"]:
    o = bpy.data.objects.get(n)
    if o:
        bpy.data.objects.remove(o, do_unlink=True)
empty("fire", mcoll, (0, 0, 0), size=0.5, kind="PLAIN_AXES")
for i, pos in sorted(seats):
    empty(f"seat_{i:02d}", mcoll, pos, (0, 0, rot_facing(pos)), size=0.25, kind="ARROWS")

result = {
    "fire_tris": sum(len(p.vertices) - 2 for p in fire_obj.data.polygons),
    "bench_tris": sum(len(p.vertices) - 2 for p in bench_obj.data.polygons),
    "seats": [(i, tuple(round(x, 3) for x in pos)) for i, pos in sorted(seats)][:3],
}
