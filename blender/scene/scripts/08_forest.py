# Step 8: instanced spruce forest, young firs, bushes, ferns, grass tufts; unique boulders.
LIB = "/Users/valentinbour/Desktop/Git/LoupGarou/blender/scene/scripts/_lib.py"
exec(compile(open(LIB).read(), LIB, "exec"))

icoll = get_coll("camp_export/instances")
clear_coll(icoll)
for n in ("forest", "vegetation"):
    o = bpy.data.objects.get(n)
    if o:
        bpy.data.objects.remove(o, do_unlink=True)
pcoll = get_coll("protos")
clear_coll(pcoll)
bpy.context.view_layer.layer_collection.children["protos"].exclude = True
rcoll = get_coll("camp_export/static/rocks")
clear_coll(rcoll)
rng = random.Random(77)


# ----------------------------------------------------------------------------- prototypes
def spruce(name, Ht, Rb, n_t, m, under, seed, c_dark, c_light, trunk=True):
    mb = MB(name)
    r = random.Random(seed)
    bm = mb.bm
    z0 = 0.12 * Ht
    span = Ht - z0
    tiers = []
    for i in range(n_t):
        f = i / n_t
        zb = z0 + span * 0.84 * (f ** 1.08)
        R = Rb * (1 - f) ** 0.92 * (0.92 + 0.16 * r.random()) + 0.18
        if i < n_t - 1:
            h = span * 0.84 / n_t * 2.4
            apex_z = min(zb + h, Ht)
        else:
            apex_z = Ht
            h = Ht - zb
        tiers.append((zb, R, h, apex_z, f))
    for (zb, R, h, apex_z, f) in tiers:
        rot0 = r.uniform(0, 2 * pi)
        ring = []
        shade = 0.5 + 0.5 * f          # lower tiers are darker (occlusion)
        cols = []
        for k in range(2 * m):
            a = rot0 + 2 * pi * k / (2 * m)
            if k % 2 == 0:
                rr = R * (0.93 + 0.14 * r.random())
                z = zb - 0.1 * R * (0.6 + 0.4 * r.random())
                c = cmul(c_light, shade * (0.9 + 0.2 * r.random()))
            else:
                rr = R * 0.66
                z = zb + 0.16 * h
                c = cmul(cmix(c_dark, c_light, 0.35), shade * 0.85)
            ring.append(bm.verts.new((rr * cos(a), rr * sin(a), z)))
            cols.append(c)
        apex = bm.verts.new((r.uniform(-0.05, 0.05) * R, r.uniform(-0.05, 0.05) * R, apex_z))
        c_apex = cmul(cmix(c_dark, c_light, 0.7), 0.6 + 0.5 * f)
        fs = []
        for k in range(2 * m):
            j = (k + 1) % (2 * m)
            fc = bm.faces.new((ring[k], ring[j], apex))
            fc.material_index = mb.mi("foliage")
            fc.smooth = True
            for l, cc in zip(fc.loops, (cols[k], cols[j], c_apex)):
                l[mb.cl] = (*cc, 1)
        if under:
            inner = bm.verts.new((0, 0, zb + 0.3 * h))
            for k in range(2 * m):
                j = (k + 1) % (2 * m)
                fc = bm.faces.new((ring[j], ring[k], inner))
                fc.material_index = mb.mi("foliage")
                fc.smooth = True
                for l, cc in zip(fc.loops, (cmul(cols[j], 0.45), cmul(cols[k], 0.45), cmul(c_dark, 0.25))):
                    l[mb.cl] = (*cc, 1)
    if trunk:
        mb.cyl((0, 0, -0.4), (0, 0, z0 + span * 0.45), 0.018 * Ht + 0.06, 0.05, segs=6, mat="bark",
               color=lambda p, n=None: cmul(PAL["bark_dark"], 0.7 + 0.3 * clamp(p.z / 3)), cap0=False, cap1=False)
    return mb.obj(pcoll, name).data


def bush(name, seed, n=3, col=None):
    mb = MB(name)
    r = random.Random(seed)
    col = col or PAL["bush"]
    for i in range(n):
        a = r.uniform(0, 2 * pi)
        d = 0.0 if i == 0 else r.uniform(0.35, 0.55)
        s = r.uniform(0.45, 0.65) if i == 0 else r.uniform(0.3, 0.45)
        c = Vector((cos(a) * d, sin(a) * d, s * 0.6))

        def bc(p, nn=None, c=c, s=s):
            up = clamp((p.z - c.z + s) / (2 * s))
            return cmul(cmix(cmul(col, 0.45), cmix(col, PAL["foliage_light"], 0.4), up), 1 + 0.1 * nz(p, 4, seed))
        mb.blob(c, (s, s, s * 0.85), subdiv=2, seed=seed * 10 + i, amp=0.18, freq=1.6, mat="foliage", color=bc,
                flat_bottom=-0.6)
    return mb.obj(pcoll, name).data


def grass_tuft(name, seed, blades=7, height=0.38, col_base=None, col_tip=None):
    mb = MB(name)
    r = random.Random(seed)
    cb = col_base or PAL["grass_dark"]
    ct = col_tip or PAL["grass_light"]
    for i in range(blades):
        a = 2 * pi * i / blades + r.uniform(-0.3, 0.3)
        out = Vector((cos(a), sin(a), 0))
        side = Vector((-sin(a), cos(a), 0))
        h = height * r.uniform(0.6, 1.15)
        lean = r.uniform(0.15, 0.4)
        w = r.uniform(0.025, 0.04)
        base = out * r.uniform(0.0, 0.05)
        mid = base + out * lean * h * 0.45 + Vector((0, 0, h * 0.55))
        tip = base + out * lean * h * 1.2 + Vector((0, 0, h))
        vs = [base - side * w, base + side * w, mid + side * w * 0.7, mid - side * w * 0.7, tip]
        cs = [cb, cb, cmix(cb, ct, 0.6), cmix(cb, ct, 0.6), ct]
        bm = mb.bm
        vv = [bm.verts.new(v) for v in vs]
        for fi in ((0, 1, 2, 3), (3, 2, 4)):
            fc = bm.faces.new([vv[k] for k in fi])
            fc.material_index = mb.mi("grass")
            fc.smooth = True
            for l in fc.loops:
                l[mb.cl] = (*cs[vv.index(l.vert)], 1)
    return mb.obj(pcoll, name).data


def fern(name, seed, fronds=7, length=0.75):
    mb = MB(name)
    r = random.Random(seed)
    cb, ct = cmul(PAL["fern"], 0.55), cmix(PAL["fern"], PAL["grass_light"], 0.35)
    bm = mb.bm
    for i in range(fronds):
        a = 2 * pi * i / fronds + r.uniform(-0.25, 0.25)
        out = Vector((cos(a), sin(a), 0))
        side = Vector((-sin(a), cos(a), 0))
        L = length * r.uniform(0.75, 1.1)
        rise = r.uniform(0.35, 0.6)
        segs = 5
        left, right, cols = [], [], []
        for k in range(segs + 1):
            t = k / segs
            p = out * L * t + Vector((0, 0, L * rise * sin(pi * t * 0.8)))
            w = 0.16 * L * sin(pi * min(t * 1.15, 1.0)) * (1.0 if k % 2 else 0.65) + 0.01
            left.append(bm.verts.new(p - side * w))
            right.append(bm.verts.new(p + side * w))
            cols.append(cmix(cb, ct, t))
        for k in range(segs):
            fc = bm.faces.new((left[k], right[k], right[k + 1], left[k + 1]))
            fc.material_index = mb.mi("grass")
            fc.smooth = True
            for l in fc.loops:
                kk = k if l.vert in (left[k], right[k]) else k + 1
                l[mb.cl] = (*cols[kk], 1)
    return mb.obj(pcoll, name).data


G = lin
protos = {
    "spruce_a": spruce("spruce_a", 12.0, 3.0, 7, 7, True, 1, G("#13261a"), G("#3f6a40")),
    "spruce_b": spruce("spruce_b", 13.0, 2.6, 8, 7, True, 2, G("#122419"), G("#365f44")),
    "spruce_c": spruce("spruce_c", 11.0, 3.2, 6, 7, True, 3, G("#16281a"), G("#4a7038")),
    "spruce_far_a": spruce("spruce_far_a", 15.0, 3.6, 5, 6, False, 4, G("#102016"), G("#2f5236"), trunk=False),
    "spruce_far_b": spruce("spruce_far_b", 16.0, 3.2, 5, 6, False, 5, G("#0f1e17"), G("#2c4c3a"), trunk=False),
    "fir_young": spruce("fir_young", 2.6, 0.9, 4, 6, True, 6, G("#1a2e1c"), G("#4d7a3c"), trunk=True),
    "bush_a": bush("bush_a", 11, 3),
    "bush_b": bush("bush_b", 12, 4, PAL["foliage"]),
    "grass_a": grass_tuft("grass_a", 21, 7, 0.36),
    "grass_b": grass_tuft("grass_b", 22, 6, 0.5, G("#3e5022"), G("#a3a64a")),
    "fern_a": fern("fern_a", 31, 7, 0.75),
    "fern_b": fern("fern_b", 32, 6, 0.6),
}
proto_tris = {k: sum(len(p.vertices) - 2 for p in m.polygons) for k, m in protos.items()}

# ----------------------------------------------------------------------------- placement helpers
zones = structure_zones()
cam = P(LAYOUT["cam_intro"]["a"], LAYOUT["cam_intro"]["r"])
cam_tgt = P(LAYOUT["cam_intro"]["a"], 5.0)


CAM_EYE = P(LAYOUT["cam_intro"]["a"], LAYOUT["cam_intro"]["r"], LAYOUT["cam_intro"]["z"])
CAM_FWD = (Vector((0.0, -2.2, 0.3)) - CAM_EYE).normalized()


def in_intro_view(x, y, h, near=15.0, half_angle=40.0):
    """True when a tree of height h would sit in the foreground of the cam_intro frame."""
    for frac in (0.35, 0.7, 1.0):
        p = Vector((x, y, H(x, y) + h * frac))
        d = p - CAM_EYE
        if d.length < near and d.normalized().dot(CAM_FWD) > cos(radians(half_angle)):
            return True
    return False


def free(x, y, margin=0.0, path_clear=1.6, cam_clear=3.4):
    for zx, zy, zr in zones:
        if hypot(x - zx, y - zy) < zr + margin:
            return False
    if dist_to_paths(x, y) < path_clear:
        return False
    if dist_to_segment(x, y, cam, cam_tgt) < cam_clear or hypot(x - cam.x, y - cam.y) < 6.0:
        return False
    return True


class Poisson:
    def __init__(self, cell=2.0):
        self.cell = cell
        self.grid = {}

    def ok(self, x, y, d):
        cx, cy = int(x // self.cell), int(y // self.cell)
        rr = int(d // self.cell) + 1
        for i in range(cx - rr, cx + rr + 1):
            for j in range(cy - rr, cy + rr + 1):
                for (px, py, pd) in self.grid.get((i, j), ()):
                    if hypot(x - px, y - py) < max(d, pd) * 0.5 + min(d, pd) * 0.5:
                        return False
        return True

    def add(self, x, y, d):
        self.grid.setdefault((int(x // self.cell), int(y // self.cell)), []).append((x, y, d))


forest = empty("forest", icoll, (0, 0, 0), size=1.0, kind="PLAIN_AXES")
veg = empty("vegetation", icoll, (0, 0, 0), size=1.0, kind="PLAIN_AXES")
pz = Poisson(2.5)
counts = {}


def put(proto, x, y, s, parent, sink=0.1, sxy=1.0, name=None):
    z = H(x, y) - sink
    counts[proto] = counts.get(proto, 0) + 1
    nm = name or f"{proto}_{counts[proto]:03d}"
    return instance(protos[proto], nm, icoll, (x, y, z), (0, 0, rng.uniform(0, 2 * pi)), (s * sxy, s * sxy, s),
                    parent=parent)


# near forest: r 10.5 .. 28 (dense), far forest r 28 .. 63
tries = 0
placed_near = 0
while tries < 26000:
    tries += 1
    r = sqrt(rng.uniform(10.5 ** 2, 63.0 ** 2))
    a = rng.uniform(0, 2 * pi)
    x, y = r * cos(a), r * sin(a)
    near = r < 28.0
    d = (3.3 + 0.05 * (r - 10.5)) if near else 5.4 + 0.02 * (r - 28)
    if not free(x, y, margin=0.8 if r < 16 else 0.0):
        continue
    if not pz.ok(x, y, d):
        continue
    pz.add(x, y, d)
    if near:
        proto = rng.choice(["spruce_a", "spruce_b", "spruce_c"])
        s = rng.uniform(0.75, 1.25) * (0.85 + 0.25 * smoothstep(10.5, 22, r))
        if in_intro_view(x, y, 12.5 * s):
            continue
        put(proto, x, y, s, forest, sxy=rng.uniform(0.9, 1.1))
        placed_near += 1
    else:
        proto = rng.choice(["spruce_far_a", "spruce_far_b", "spruce_a"]) if r < 40 else \
            rng.choice(["spruce_far_a", "spruce_far_b"])
        s = rng.uniform(0.85, 1.3)
        put(proto, x, y, s, forest, sxy=rng.uniform(0.9, 1.15))

# young firs and bushes along the forest edge and around buildings
for i in range(5000):
    if counts.get("fir_young", 0) >= 34 and counts.get("bush_a", 0) + counts.get("bush_b", 0) >= 34:
        break
    r = rng.uniform(9.0, 19.0)
    a = rng.uniform(0, 2 * pi)
    x, y = r * cos(a), r * sin(a)
    if not free(x, y, margin=-0.6, path_clear=1.2, cam_clear=1.8):
        continue
    if not pz.ok(x, y, 1.6):
        continue
    pz.add(x, y, 1.6)
    if rng.random() < 0.5 and counts.get("fir_young", 0) < 34:
        put("fir_young", x, y, rng.uniform(0.6, 1.3), veg, sink=0.05)
    elif counts.get("bush_a", 0) + counts.get("bush_b", 0) < 34:
        put(rng.choice(["bush_a", "bush_b"]), x, y, rng.uniform(0.7, 1.25), veg, sink=0.1)

# ferns near the trees, grass tufts on the meadow ring
for i in range(6000):
    if counts.get("fern_a", 0) + counts.get("fern_b", 0) >= 70:
        break
    r = rng.uniform(9.5, 20.0)
    a = rng.uniform(0, 2 * pi)
    x, y = r * cos(a), r * sin(a)
    if not free(x, y, margin=-1.2, path_clear=1.0, cam_clear=1.0):
        continue
    put(rng.choice(["fern_a", "fern_b"]), x, y, rng.uniform(0.8, 1.4), veg, sink=0.02)

gp = Poisson(1.0)
for i in range(20000):
    if counts.get("grass_a", 0) + counts.get("grass_b", 0) >= 300:
        break
    r = rng.uniform(5.2, 15.5)
    a = rng.uniform(0, 2 * pi)
    x, y = r * cos(a), r * sin(a)
    edge = 6.0 + 1.6 * nz((x, y, 0), 0.25, 1)          # rough clearing edge (cf. ground texture)
    if r < edge + 0.3:
        continue
    if dist_to_paths(x, y) < 1.0:
        continue
    if not gp.ok(x, y, 0.55):
        continue
    # skip inside buildings / tents
    inside = False
    for zx, zy, zr in zones:
        if hypot(x - zx, y - zy) < zr * 0.72:
            inside = True
    if inside:
        continue
    gp.add(x, y, 0.55)
    put(rng.choice(["grass_a", "grass_a", "grass_b"]), x, y, rng.uniform(0.7, 1.3), veg, sink=0.02)

# ----------------------------------------------------------------------------- boulders (unique, merged later)
mb = MB("rocks")
rk = 0
for i in range(3000):
    if rk >= 26:
        break
    r = rng.uniform(9.5, 24.0)
    a = rng.uniform(0, 2 * pi)
    x, y = r * cos(a), r * sin(a)
    if not free(x, y, margin=0.2, path_clear=1.5):
        continue
    if not pz.ok(x, y, 1.8):
        continue
    pz.add(x, y, 1.8)
    s = rng.uniform(0.3, 0.75) if r < 15 else rng.uniform(0.45, 1.1) * (1.35 if rng.random() < 0.2 else 1.0)
    base = cmix(PAL["stone"], PAL["stone_dark"], rng.random() * 0.5)

    def rc(p, n=None, base=base, s=s, seed=rk):
        top = clamp(n.z if n is not None else 0.0)
        moss = smoothstep(0.45, 0.85, top) * smoothstep(-0.35, 0.25, nz(p, 1.2, seed)) * 0.85
        c = cmix(base, PAL["moss"], moss)
        return cmul(c, 1 + 0.12 * nz(p, 3.0, seed + 1))
    z = H(x, y)
    mb.blob((x, y, z + s * 0.25), (s, s * rng.uniform(0.7, 1.0), s * rng.uniform(0.55, 0.8)), subdiv=2, seed=800 + rk,
            amp=0.28, freq=0.9, rot=(0, 0, rng.uniform(0, 6.28)), mat="stone", color=rc, flat_bottom=-0.4)
    rk += 1
rocks = mb.obj(rcoll, "rocks")

total_inst_tris = sum(proto_tris[k] * v for k, v in counts.items())
result = {"proto_tris": proto_tris, "counts": counts, "instanced_tris": total_inst_tris, "near": placed_near,
          "rock_tris": sum(len(p.vertices) - 2 for p in rocks.data.polygons)}
