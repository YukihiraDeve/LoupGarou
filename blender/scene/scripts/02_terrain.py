# Step 2: ground (textured clearing + vertex-coloured forest floor), distant mountains, tree-line band.
LIB = "/Users/valentinbour/Desktop/Git/LoupGarou/blender/scene/scripts/_lib.py"
exec(compile(open(LIB).read(), LIB, "exec"))
import numpy as np
import os

TEX_HALF = 16.0          # the ground texture covers [-16, 16] m on X and Y
TEX_RES = 2048
TEX_DIR = SCENE_DIR + "/textures"
os.makedirs(TEX_DIR, exist_ok=True)

coll = get_coll("camp_export/static/terrain")
clear_coll(coll)


# ----------------------------------------------------------------------------- ground texture
def value_noise(res, cells, rng):
    lat = rng.uniform(-1, 1, (cells + 2, cells + 2))
    t = np.linspace(0, cells, res, endpoint=False)
    i = t.astype(int)
    f = t - i
    f = f * f * (3 - 2 * f)
    a = lat[np.ix_(i, i)]
    b = lat[np.ix_(i, i + 1)]
    c = lat[np.ix_(i + 1, i)]
    d = lat[np.ix_(i + 1, i + 1)]
    top = a + (b - a) * f[None, :]
    bot = c + (d - c) * f[None, :]
    return top + (bot - top) * f[:, None]


def fbm(res, cells, octaves, seed, gain=0.5):
    rng = np.random.default_rng(seed)
    out = np.zeros((res, res))
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        out += amp * value_noise(res, cells * 2 ** o, rng)
        tot += amp
        amp *= gain
    return out / tot


def sstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def srgb_hex(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)])


def ground_albedo(res=TEX_RES):
    """sRGB float image (res, res, 3), row 0 = y = -TEX_HALF (Blender images are bottom-up)."""
    t = (np.arange(res) + 0.5) / res * 2 * TEX_HALF - TEX_HALF
    X, Y = np.meshgrid(t, t)          # X varies along columns, Y along rows
    R = np.hypot(X, Y)
    n1 = fbm(res, 6, 3, 1)            # ~5 m features
    n2 = fbm(res, 28, 3, 2)           # ~1 m
    n3 = fbm(res, 520, 2, 3)          # ~6 cm grain
    n4 = fbm(res, 12, 3, 4)

    # path distance field
    D = np.full((res, res), 1e9)
    for pts in PATHS:
        for a, b in zip(pts[:-1], pts[1:]):
            dx, dy = b.x - a.x, b.y - a.y
            L2 = dx * dx + dy * dy
            tt = np.clip(((X - a.x) * dx + (Y - a.y) * dy) / L2, 0, 1)
            D = np.minimum(D, np.hypot(X - (a.x + tt * dx), Y - (a.y + tt * dy)))

    edge = 6.0 + 1.6 * n1 + 0.5 * n2
    m_clear = 1 - sstep(edge - 0.7, edge + 0.5, R)
    w = 0.72 + 0.22 * n2 + 0.1 * n3
    m_path = (1 - sstep(w - 0.35, w + 0.25, D)) * (1 - sstep(13.5, 16.0, R) * 0.6)
    m_dirt = np.maximum(m_clear, m_path * 0.92)
    # ragged grass intrusions into the dirt edge
    m_dirt = np.clip(m_dirt - np.clip(n3 * 0.9, 0, 1) * (m_dirt < 0.95) * 0.5, 0, 1)

    # grass
    ga, gb, gdry = srgb_hex("#4f5f2b"), srgb_hex("#617231"), srgb_hex("#7a7540")
    ff = srgb_hex("#3c4426")
    g = ga[None, None, :] + (gb - ga)[None, None, :] * sstep(-0.3, 0.4, n2)[..., None]
    g = g + (gdry - g) * (sstep(0.1, 0.6, n4) * 0.4)[..., None]
    g = g * (1 + 0.10 * n3 + 0.06 * n2)[..., None]
    rim = sstep(0.0, 0.25, m_dirt) * (1 - sstep(0.25, 0.6, m_dirt))
    g = g + (srgb_hex("#7a8a3c") - g) * (rim * 0.5)[..., None]
    g = g + (ff - g) * sstep(10.5, 15.5, R + 1.2 * n1)[..., None]

    # dirt
    dbase, ddark, dlight = srgb_hex("#9a7550"), srgb_hex("#6f5038"), srgb_hex("#b89068")
    d = np.broadcast_to(dbase, (res, res, 3)).copy()
    d = d + (dlight - d) * (sstep(0.1, 0.6, n1) * 0.55)[..., None]
    ring = np.exp(-((R - 3.05) / 0.75) ** 2)        # feet area in front of the benches
    d = d + (ddark - d) * (ring * 0.45 + sstep(0.3, 0.7, n2) * 0.2)[..., None]
    d = d * (1 + 0.10 * n2 + 0.035 * n3)[..., None]
    # sparse pebbles: small discs (light top, dark contact shadow)
    rng = np.random.default_rng(9)
    npeb = 5500
    px = rng.integers(0, res, npeb)
    py = rng.integers(0, res, npeb)
    stamp = np.zeros((res, res))
    stamp[py, px] = rng.uniform(0.5, 1.0, npeb)
    shadow = np.zeros((res, res))
    shadow[np.clip(py - 2, 0, res - 1), np.clip(px + 1, 0, res - 1)] = 1.0

    def blur(a, k):
        for ax in (0, 1):
            c = np.cumsum(np.pad(a, [(k + 1, k) if i == ax else (0, 0) for i in (0, 1)], mode="edge"), axis=ax)
            if ax == 0:
                a = (c[2 * k + 1:, :] - c[:-2 * k - 1, :]) / (2 * k + 1)
            else:
                a = (c[:, 2 * k + 1:] - c[:, :-2 * k - 1]) / (2 * k + 1)
        return a
    pebm = np.clip(blur(stamp, 1) * 6.0, 0, 1)
    shm = np.clip(blur(shadow, 2) * 5.0, 0, 1)
    d = d + (srgb_hex("#5e4632") - d) * (shm * 0.35)[..., None]
    d = d + (srgb_hex("#b39b7e") - d) * (pebm * 0.55)[..., None]

    col = g + (d - g) * m_dirt[..., None]

    # fire pit: char in the middle, ash, soot halo
    rr = R + 0.12 * n2
    col = col + (srgb_hex("#5a524c") - col) * (1 - sstep(0.9, 1.75, rr))[..., None] * 0.65
    col = col + (srgb_hex("#2a2320") - col) * (1 - sstep(0.35, 1.0, rr))[..., None]
    col = col * (1 + 0.05 * n1)[..., None]
    return np.clip(col, 0, 1)


def save_image(name, arr, path):
    res = arr.shape[0]
    img = bpy.data.images.get(name)
    if img is None or img.size[0] != res:
        if img is not None:
            bpy.data.images.remove(img)
        img = bpy.data.images.new(name, res, res, alpha=False)
    rgba = np.ones((res, res, 4), dtype=np.float32)
    rgba[..., :3] = arr
    img.colorspace_settings.name = "sRGB"
    img.pixels.foreach_set(rgba.ravel())
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    return img


albedo = ground_albedo()
np.save(TMP + "/ground_albedo.npy", albedo.astype(np.float32))
img = save_image("ground_albedo", albedo, TEX_DIR + "/ground_albedo.png")

# ground material: image texture (clamped) -> base colour
m = MAT("ground")
nt = m.node_tree
b = [n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"][0]
for n in [n for n in nt.nodes if n.type == "TEX_IMAGE"]:
    nt.nodes.remove(n)
tex = nt.nodes.new("ShaderNodeTexImage")
tex.name = "albedo"
tex.image = img
tex.extension = "EXTEND"
tex.location = (-300, 0)
nt.links.new(tex.outputs["Color"], b.inputs["Base Color"])

# ----------------------------------------------------------------------------- ground mesh
SEG = 120
R_IN = [0.0, 0.5, 1.0, 1.6, 2.2, 2.8, 3.4, 4.0, 4.7, 5.4, 6.2, 7.0, 8.0, 9.0, 10.0, 11.0, 12.0, 13.0, 14.0, 15.0,
        TEX_HALF - 0.2]
R_OUT = [TEX_HALF - 0.2, 17.2, 18.6, 20.2, 22.0, 24.0, 26.5, 29.0, 32.0, 35.5, 39.5, 44.0, 49.0, 55.0, 62.0, 70.0,
         80.0, 95.0, 115.0, 140.0, 175.0, 220.0, 280.0, 360.0]


def ring_mesh(mb, radii, mat, color, seg=SEG, uv=False):
    bm = mb.bm
    rows = []
    for r in radii:
        if r == 0:
            rows.append([bm.verts.new((0, 0, 0))])
            continue
        row = []
        for i in range(seg):
            a = 2 * pi * (i + 0.5 * (len(rows) % 2)) / seg
            x, y = r * cos(a), r * sin(a)
            row.append(bm.verts.new((x, y, H(x, y))))
        rows.append(row)
    faces = []
    for A, B in zip(rows[:-1], rows[1:]):
        for i in range(seg):
            j = (i + 1) % seg
            if len(A) == 1:
                faces.append(bm.faces.new((A[0], B[i], B[j])))
            else:
                faces.append(bm.faces.new((A[i], B[i], B[j], A[j])))
    # orientation: make sure normals point up
    for f in faces:
        f.normal_update()
        if f.normal.z < 0:
            f.normal_flip()
    mb.paint(faces, mat, color, smooth=True)
    return faces


mb = MB("ground")
ring_mesh(mb, R_IN, "ground", (1, 1, 1))
uvl = mb.bm.loops.layers.uv.new("UVMap")
for f in mb.bm.faces:
    for l in f.loops:
        l[uvl].uv = ((l.vert.co.x + TEX_HALF) / (2 * TEX_HALF), (l.vert.co.y + TEX_HALF) / (2 * TEX_HALF))
ground = mb.obj(coll, "ground")

ffc = PAL["forest_floor"]
needles = lin("#4a3a26")


def floor_color(p, n=None):
    k = 1 + 0.18 * nz(p, 0.08, 21)
    t = clamp(0.5 + 0.8 * nz(p, 0.05, 22))
    c = cmix(ffc, needles, t * 0.45)
    return cmul(c, k)


mb = MB("ground_far")
ring_mesh(mb, R_OUT, "ground_far", floor_color)
ground_far = mb.obj(coll, "ground_far")
# put the matching UV layer on the far ground too (keeps join/export consistent)
ground_far.data.uv_layers.new(name="UVMap")

# ----------------------------------------------------------------------------- mountains
mb = MB("mountains")


def ridge(radius, n, base_h, amp, seed, c_low, c_high, z0=-25.0):
    bm = mb.bm
    rows = [[], [], []]
    for i in range(n):
        a = 2 * pi * i / n
        p = Vector((cos(a), sin(a), 0)) * 3.0
        h = base_h + amp * (0.55 * nz(p, 1.0, seed) + 0.3 * nz(p, 2.7, seed + 1) + 0.15 * nz(p, 6.0, seed + 2))
        # sharpen peaks
        h = base_h + (h - base_h) * (1.4 if h > base_h else 0.8)
        rr = radius * (1 + 0.06 * nz(p, 1.7, seed + 3))
        x, y = rr * cos(a), rr * sin(a)
        rows[0].append(bm.verts.new((x, y, z0)))
        rows[1].append(bm.verts.new((x * 1.0, y * 1.0, z0 + (h - z0) * 0.55)))
        rows[2].append(bm.verts.new((x, y, h)))
    faces = []
    for A, B in zip(rows[:-1], rows[1:]):
        for i in range(n):
            j = (i + 1) % n
            faces.append(bm.faces.new((A[i], B[i], B[j], A[j])))
    for f in faces:
        f.normal_update()
        cen = f.calc_center_median()
        if f.normal.dot(Vector((cen.x, cen.y, 0))) > 0:   # face the centre
            f.normal_flip()

    def colf(p, nn=None):
        t = clamp((p.z - z0) / (base_h + amp - z0))
        return cmix(c_low, c_high, t ** 1.3)
    mb.paint(faces, "mountain", colf, smooth=True)


ridge(250.0, 140, 38.0, 32.0, 31, lin("#1d2a26"), lin("#3a4d4a"))
ridge(360.0, 160, 95.0, 70.0, 41, lin("#2a3540"), lin("#6f7f8c"))
mountains = mb.obj(coll, "mountains")

# ----------------------------------------------------------------------------- tree-line band
# A cheap jagged wall of spruce silhouettes behind the instanced forest: closes the horizon.
mb = MB("treeline")
bm = mb.bm
N = 260
RB = 66.0
low, top = [], []
rng = random.Random(5)
for i in range(N * 2):
    a = 2 * pi * i / (N * 2)
    rr = RB + rng.uniform(-2.5, 2.5)
    x, y = rr * cos(a), rr * sin(a)
    g = H(x, y)
    if i % 2 == 0:   # tree tip
        h = g + rng.uniform(15.0, 23.0)
    else:            # valley between two tips
        h = g + rng.uniform(8.0, 11.0)
    low.append(bm.verts.new((x, y, g - 3.0)))
    top.append(bm.verts.new((x, y, h)))
faces = []
for i in range(N * 2):
    j = (i + 1) % (N * 2)
    faces.append(bm.faces.new((low[i], top[i], top[j], low[j])))
for f in faces:
    f.normal_update()
    cen = f.calc_center_median()
    if f.normal.dot(Vector((cen.x, cen.y, 0))) > 0:
        f.normal_flip()
base_floor = 4.0


def band_col(p, nn=None):
    t = clamp((p.z - H(p.x, p.y) + 3.0) / 24.0)
    return cmix(lin("#0f1d14"), lin("#2a4430"), t ** 0.8)


mb.paint(faces, "foliage", band_col, smooth=False)
treeline = mb.obj(coll, "treeline")

result = {
    "ground_tris": sum(len(p.vertices) - 2 for p in ground.data.polygons),
    "ground_far_tris": sum(len(p.vertices) - 2 for p in ground_far.data.polygons),
    "mountain_tris": sum(len(p.vertices) - 2 for p in mountains.data.polygons),
    "treeline_tris": sum(len(p.vertices) - 2 for p in treeline.data.polygons),
}
