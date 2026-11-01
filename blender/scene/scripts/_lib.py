# Shared helpers for the camp scene build scripts.
# Every step script starts with:
#   LIB = "/Users/valentinbour/Desktop/Git/LoupGarou/blender/scene/scripts/_lib.py"
#   exec(compile(open(LIB).read(), LIB, "exec"))
# Conventions: Blender Z up, metres, fire at the origin. Built geometry lives in world space
# (objects at the origin) unless it is an instanced prototype.
import bpy, bmesh, math, random
from math import sin, cos, radians, degrees, pi, hypot, atan2, sqrt, exp
from mathutils import Vector, Matrix, Euler, Quaternion, noise

ROOT = "/Users/valentinbour/Desktop/Git/LoupGarou"
SCENE_DIR = ROOT + "/blender/scene"
SCRIPTS = SCENE_DIR + "/scripts"
TMP = SCENE_DIR + "/tmp"
BLEND = SCENE_DIR + "/camp.blend"
OUT_DIR = ROOT + "/client/public/assets/camp"
PREVIEW_DIR = ROOT + "/docs/previews"


def run_step(name):
    p = f"{SCRIPTS}/{name}"
    g = {"__name__": "__main__", "__file__": p}
    exec(compile(open(p).read(), p, "exec"), g)
    return g


# ----------------------------------------------------------------------------- math helpers
def clamp(x, a=0.0, b=1.0):
    return a if x < a else b if x > b else x


def smoothstep(e0, e1, x):
    t = clamp((x - e0) / (e1 - e0))
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def P(angle_deg, r, z=0.0):
    """Polar position on the ground plane (angle counter-clockwise from +X)."""
    a = radians(angle_deg)
    return Vector((r * cos(a), r * sin(a), z))


def rot_facing(pos, target=(0, 0)):
    """Z rotation so that local -Y points from pos toward target."""
    dx, dy = target[0] - pos[0], target[1] - pos[1]
    # local -Y rotated by t = (sin t, -cos t) must equal (dx, dy)/|d|
    return atan2(dx, -dy)


def catenary(p, q, sag, n):
    p, q = Vector(p), Vector(q)
    pts = []
    for i in range(n + 1):
        t = i / n
        v = p.lerp(q, t)
        v.z -= sag * 4 * t * (1 - t)
        pts.append(v)
    return pts


# ----------------------------------------------------------------------------- colours
def lin(h):
    """'#rrggbb' sRGB -> linear RGB tuple."""
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c)


def cmix(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def cmul(c, k):
    return tuple(x * k for x in c)


_NOFF = {}


def _noff(seed):
    if seed not in _NOFF:
        rnd = random.Random(seed * 7919 + 13)
        _NOFF[seed] = Vector((rnd.uniform(-500, 500), rnd.uniform(-500, 500), rnd.uniform(-500, 500)))
    return _NOFF[seed]


def nz(p, scale=1.0, seed=0):
    return noise.noise(Vector(p) * scale + _noff(seed))


def vary(c, amp=0.12, scale=1.5, seed=0, hue=0.0):
    """Colour function: brightness (and optional warm/cool) variation driven by 3D noise."""
    def f(p, n=None):
        k = 1.0 + amp * nz(p, scale, seed)
        h = hue * nz(p, scale * 0.7, seed + 11)
        return (c[0] * k * (1 + h), c[1] * k, c[2] * k * (1 - h))
    return f


# Palette (sRGB hex -> linear). Warm, saturated, animated-film look.
PAL = {
    "bark": lin("#5a3d2b"), "bark_dark": lin("#3e2a1e"), "bark_light": lin("#7a5539"),
    "wood": lin("#8a5a36"), "wood_light": lin("#b07a4a"), "wood_dark": lin("#5e3b22"),
    "endgrain": lin("#d9b07a"), "endgrain_ring": lin("#a5713f"),
    "plank": lin("#9b6a40"), "plank_gray": lin("#7d6a58"),
    "roof": lin("#5b4636"), "roof_dark": lin("#3f3129"), "shingle": lin("#6b4a3a"),
    "char": lin("#1c1512"), "ash": lin("#6f6a66"),
    "stone": lin("#8d8478"), "stone_light": lin("#aaa194"), "stone_dark": lin("#5f5850"), "moss": lin("#5d6b33"),
    "canvas": lin("#dccaa6"), "canvas_dark": lin("#c7b18a"), "canvas_orange": lin("#c8703a"),
    "canvas_green": lin("#5d7346"), "canvas_blue": lin("#5a7488"), "canvas_sand": lin("#d8c08a"),
    "tent_inside": lin("#2a2018"),
    "rope": lin("#cbb48a"), "wire": lin("#1e1a17"), "metal": lin("#2b2a28"), "metal_light": lin("#6a6660"),
    "red": lin("#b8322a"), "white": lin("#eee8dc"), "blue": lin("#2f5f8a"), "green": lin("#3f7a4a"),
    "yellow": lin("#e0b43c"), "teal": lin("#2e8a84"), "orange": lin("#e07b2c"), "cream": lin("#efe2c4"),
    "foliage": lin("#2d4a2f"), "foliage_dark": lin("#16281b"), "foliage_light": lin("#4d6e3c"),
    "grass": lin("#56702f"), "grass_light": lin("#86a03f"), "grass_dark": lin("#33461f"),
    "fern": lin("#4f7a33"), "bush": lin("#38562e"),
    "forest_floor": lin("#3c4426"), "dirt": lin("#94704c"),
}


# Emission strengths exported in the GLB (night look). The client scales emissiveIntensity down by day.
EMIT_NIGHT = {"EMIT_embers": 1.2, "EMIT_window": 1.6, "EMIT_bulbs": 5.0, "EMIT_lantern": 4.0, "EMIT_tent": 0.35}


def set_emission(strengths):
    for name, st in strengths.items():
        m = bpy.data.materials.get(name)
        if m:
            for n in m.node_tree.nodes:
                if n.type == "BSDF_PRINCIPLED":
                    n.inputs["Emission Strength"].default_value = st


# ----------------------------------------------------------------------------- layout
# Angles in degrees (counter-clockwise from +X), radii in metres.
SEAT_R = 3.5
SEAT_COUNT = 16
SEAT_ANGLE0 = -90.0              # seat_00 on -Y: faces cam_intro which stands on +Y
LOG_COUNT = 8

LAYOUT = {
    "chalet_A": dict(a=268, r=11.4, w=5.6, d=4.4, porch=True),
    "chalet_B": dict(a=160, r=11.6, w=4.6, d=3.8, porch=False),
    "chalet_C": dict(a=56, r=11.6, w=3.8, d=3.3, porch=False),
    "tower": dict(a=318, r=12.2),
    "tent_1": dict(a=231, r=8.0, kind="bell", color="canvas", glow=True),
    "tent_2": dict(a=297, r=7.9, kind="aframe", color="canvas_orange"),
    "tent_3": dict(a=198, r=8.1, kind="aframe", color="canvas_green"),
    "tent_4": dict(a=22, r=8.3, kind="bell", color="canvas_sand"),
    "tent_5": dict(a=104, r=8.0, kind="aframe", color="canvas_blue"),
    "picnic": dict(a=128, r=7.0),
    "trail": dict(a=350),
    "cam_intro": dict(a=93, r=17.5, z=10.2),
}

# dirt paths (polylines, metres) from the clearing edge to the buildings
PATHS = [
    [P(268, 4.8), P(267, 6.5), P(268, 7.6)],
    [P(318, 4.8), P(316, 8.0), P(318, 10.4)],
    [P(352, 4.8), P(349, 8.5), P(353, 12.5), P(347, 16.5), P(352, 21.0), P(348, 28.0)],
    [P(56, 4.8), P(60, 7.5), P(56, 9.6)],
    [P(160, 4.8), P(156, 7.5), P(160, 9.6)],
    [P(128, 4.8), P(128, 5.8)],
]

# no-tree zones: (x, y, radius)
def structure_zones():
    z = []
    for k, v in LAYOUT.items():
        if k.startswith("chalet"):
            z.append((*P(v["a"], v["r"])[:2], max(v["w"], v["d"]) * 0.75 + 1.2))
        elif k == "tower":
            z.append((*P(v["a"], v["r"])[:2], 3.6))
        elif k.startswith("tent"):
            z.append((*P(v["a"], v["r"])[:2], 3.0))
        elif k == "picnic":
            z.append((*P(v["a"], v["r"])[:2], 2.6))
    return z


def dist_to_polyline(x, y, pts):
    best = 1e9
    for a, b in zip(pts[:-1], pts[1:]):
        ax, ay, bx, by = a.x, a.y, b.x, b.y
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy
        t = clamp(((x - ax) * dx + (y - ay) * dy) / L2) if L2 > 0 else 0
        px, py = ax + t * dx, ay + t * dy
        best = min(best, hypot(x - px, y - py))
    return best


def dist_to_paths(x, y):
    return min(dist_to_polyline(x, y, p) for p in PATHS)


def dist_to_segment(x, y, a, b):
    return dist_to_polyline(x, y, [Vector(a), Vector(b)])


# ----------------------------------------------------------------------------- terrain height
def H(x, y):
    """Ground height. Flat clearing (r < 15.5), gentle noise and a rising bowl beyond."""
    r = hypot(x, y)
    if r < 15.5:
        return 0.0
    t = smoothstep(15.5, 26.0, r)
    p = Vector((x, y, 0.0))
    n = 0.9 * nz(p, 0.045, 101) + 0.35 * nz(p, 0.13, 102)
    b = 0.0024 * max(0.0, r - 17.0) ** 2
    bowl = 16.0 * (1 - exp(-b / 16.0))
    return t * n + bowl


# ----------------------------------------------------------------------------- collections
def get_coll(path):
    parent = bpy.context.scene.collection
    coll = None
    for name in path.split("/"):
        coll = bpy.data.collections.get(name)
        if coll is None:
            coll = bpy.data.collections.new(name)
        if coll.name not in [c.name for c in parent.children]:
            parent.children.link(coll)
        parent = coll
    return coll


def clear_coll(coll):
    """Delete every object of a collection (recursively) and their orphaned data."""
    meshes = set()
    for c in [coll] + list(coll.children_recursive):
        for o in list(c.objects):
            if o.type == "MESH" and o.data:
                meshes.add(o.data)
            bpy.data.objects.remove(o, do_unlink=True)
    for m in meshes:
        if m.users == 0:
            bpy.data.meshes.remove(m)


# ----------------------------------------------------------------------------- materials
def MAT(name):
    m = bpy.data.materials.get(name)
    if m is None:
        raise KeyError(f"material {name} missing: run 01_setup.py")
    return m


# ----------------------------------------------------------------------------- mesh builder
def faces_of(verts):
    s = set()
    for v in verts:
        s.update(v.link_faces)
    return list(s)


class MB:
    """bmesh-based builder: primitives carry a material and a per-corner colour ('Col')."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.cl = self.bm.loops.layers.float_color.new("Col")
        self.mats = []

    def mi(self, mat):
        if mat not in self.mats:
            self.mats.append(mat)
        return self.mats.index(mat)

    def paint(self, faces, mat, color, smooth=False):
        idx = self.mi(mat)
        cl = self.cl
        call = callable(color)
        for f in faces:
            f.normal_update()
            f.material_index = idx
            f.smooth = smooth
            for l in f.loops:
                c = color(l.vert.co, f.normal) if call else color
                l[cl] = (c[0], c[1], c[2], 1.0)
        return faces

    # generic polygons -------------------------------------------------------
    def poly(self, verts, faces, mat, color, smooth=False):
        vs = [self.bm.verts.new(Vector(v)) for v in verts]
        fs = []
        for f in faces:
            try:
                fs.append(self.bm.faces.new([vs[i] for i in f]))
            except ValueError:
                pass
        self.paint(fs, mat, color, smooth)
        return vs, fs

    # box ---------------------------------------------------------------------
    def box(self, center, size, rot=(0, 0, 0), mat="wood", color=(0.5, 0.5, 0.5), bevel=0.0, smooth=False,
            taper=None):
        M = Matrix.Translation(Vector(center)) @ Euler(rot).to_matrix().to_4x4() @ Matrix.Diagonal((*size, 1.0))
        r = bmesh.ops.create_cube(self.bm, size=1.0, matrix=Matrix.Identity(4))
        verts = r["verts"]
        if taper:  # (sx_top, sy_top) scale of the +Z face
            for v in verts:
                if v.co.z > 0:
                    v.co.x *= taper[0]
                    v.co.y *= taper[1]
        for v in verts:
            v.co = M @ v.co
        if bevel > 0:
            edges = list({e for v in verts for e in v.link_edges})
            res = bmesh.ops.bevel(self.bm, geom=edges + verts, offset=bevel, segments=1, affect="EDGES",
                                  profile=0.5, clamp_overlap=True)
            verts = res["verts"]
        faces = faces_of(verts)
        self.paint(faces, mat, color, smooth)
        return faces

    # cylinder / cone / log -----------------------------------------------------
    def cyl(self, p0, p1, r0, r1=None, segs=8, mat="wood", color=(0.5, 0.5, 0.5), cap0=True, cap1=True,
            cap_color=None, cap_mat=None, smooth=True, rings=1, rfunc=None, twist=0.0, sharp_caps=True,
            uv_tile=None, uv_u0=None, uv_v0=0.0):
        if r1 is None:
            r1 = r0
        p0, p1 = Vector(p0), Vector(p1)
        axis = p1 - p0
        L = axis.length
        d = axis / L
        up = Vector((0, 0, 1)) if abs(d.z) < 0.95 else Vector((1, 0, 0))
        u = d.cross(up).normalized()
        v = d.cross(u).normalized()
        bm = self.bm
        rings_v = []
        for k in range(rings + 1):
            t = k / rings
            c = p0 + axis * t
            r = r0 + (r1 - r0) * t
            if r <= 1e-6:
                rings_v.append([bm.verts.new(c)])
                continue
            ring = []
            for i in range(segs):
                a = 2 * pi * i / segs + twist
                rr = r * (rfunc(t, a) if rfunc else 1.0)
                ring.append(bm.verts.new(c + (u * cos(a) + v * sin(a)) * rr))
            rings_v.append(ring)
        side = []
        for k in range(rings):
            A, B = rings_v[k], rings_v[k + 1]
            for i in range(segs):
                j = (i + 1) % segs
                if len(A) == 1:
                    side.append(bm.faces.new((A[0], B[j], B[i])))
                elif len(B) == 1:
                    side.append(bm.faces.new((A[i], A[j], B[0])))
                else:
                    side.append(bm.faces.new((A[i], A[j], B[j], B[i])))
        self.paint(side, mat, color, smooth)
        if uv_tile is None and mat == "bark":
            uv_tile = 0.6
        if uv_tile:
            uvl = bm.loops.layers.uv.get("UVMap") or bm.loops.layers.uv.new("UVMap")
            circ = 2 * pi * max(r0, r1) / uv_tile
            seed_u = (hash((round(p0.x, 2), round(p0.y, 2))) % 97) / 97.0 if uv_u0 is None else uv_u0
            fi = 0
            for k in range(rings):
                for i in range(segs):
                    f = side[fi]
                    fi += 1
                    if len(f.loops) == 4:   # corners were created as (A[i], A[i+1], B[i+1], B[i])
                        cs = ((i, k), (i + 1, k), (i + 1, k + 1), (i, k + 1))
                    else:
                        cs = ((i, k), (i + 1, k), (i + 0.5, k + 1))
                    for l, (ii, kk) in zip(f.loops, cs):
                        l[uvl].uv = (seed_u + circ * ii / segs, uv_v0 + (kk / rings) * L / uv_tile)
        caps = []
        cc = cap_color if cap_color is not None else color
        cm = cap_mat or ("wood" if mat == "bark" else mat)
        if cap0 and len(rings_v[0]) > 1:
            A = rings_v[0]
            cv = bm.verts.new(p0)
            caps += [bm.faces.new((cv, A[(i + 1) % segs], A[i])) for i in range(segs)]
        if cap1 and len(rings_v[-1]) > 1:
            B = rings_v[-1]
            cv = bm.verts.new(p1)
            caps += [bm.faces.new((cv, B[i], B[(i + 1) % segs])) for i in range(segs)]
        if caps:
            self.paint(caps, cm, cc, False)
            if sharp_caps:
                for f in caps:
                    for e in f.edges:
                        e.smooth = False
        return side, caps

    # rock / blob ---------------------------------------------------------------
    def blob(self, center, size, subdiv=2, seed=0, amp=0.25, freq=1.3, rot=(0, 0, 0), mat="stone",
             color=(0.5, 0.5, 0.5), smooth=True, flat_bottom=None):
        r = bmesh.ops.create_icosphere(self.bm, subdivisions=subdiv, radius=1.0, matrix=Matrix.Identity(4))
        verts = r["verts"]
        off = _noff(seed)
        for vv in verts:
            n = vv.co.normalized()
            dd = 1.0 + amp * noise.noise(n * freq + off) + 0.4 * amp * noise.noise(n * freq * 2.3 + off)
            vv.co = n * dd
            if flat_bottom is not None and vv.co.z < flat_bottom:
                vv.co.z = flat_bottom + (vv.co.z - flat_bottom) * 0.25
        M = Matrix.Translation(Vector(center)) @ Euler(rot).to_matrix().to_4x4() @ Matrix.Diagonal((*size, 1.0))
        for vv in verts:
            vv.co = M @ vv.co
        faces = faces_of(verts)
        self.paint(faces, mat, color, smooth)
        return faces

    # tube along a polyline (ropes, wires) -------------------------------------
    def tube(self, pts, r, segs=3, mat="wire", color=(0.02, 0.02, 0.02), smooth=True):
        pts = [Vector(p) for p in pts]
        bm = self.bm
        rings = []
        prev_u = None
        for i, p in enumerate(pts):
            if i == 0:
                d = (pts[1] - pts[0]).normalized()
            elif i == len(pts) - 1:
                d = (pts[-1] - pts[-2]).normalized()
            else:
                d = (pts[i + 1] - pts[i - 1]).normalized()
            if prev_u is None:
                up = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
                u = d.cross(up).normalized()
            else:
                u = (prev_u - d * prev_u.dot(d)).normalized()
            v = d.cross(u)
            prev_u = u
            rings.append([bm.verts.new(p + (u * cos(2 * pi * k / segs) + v * sin(2 * pi * k / segs)) * r)
                          for k in range(segs)])
        fs = []
        for A, B in zip(rings[:-1], rings[1:]):
            for k in range(segs):
                j = (k + 1) % segs
                fs.append(bm.faces.new((A[k], A[j], B[j], B[k])))
        self.paint(fs, mat, color, smooth)
        return fs

    # finish ---------------------------------------------------------------------
    def obj(self, coll, name=None, loc=None, parent=None):
        name = name or self.name
        me = bpy.data.meshes.new(name)
        self.bm.normal_update()
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(MAT(m))
        try:
            me.color_attributes.active_color_name = "Col"
            me.color_attributes.render_color_index = me.color_attributes.active_color_index
        except Exception:
            pass
        o = bpy.data.objects.new(name, me)
        coll.objects.link(o)
        if loc is not None:
            o.location = loc
        if parent is not None:
            o.parent = parent
        return o


def empty(name, coll, loc=(0, 0, 0), rot=(0, 0, 0), size=0.3, kind="ARROWS", parent=None):
    o = bpy.data.objects.get(name)
    if o is not None:
        bpy.data.objects.remove(o, do_unlink=True)
    o = bpy.data.objects.new(name, None)
    o.empty_display_type = kind
    o.empty_display_size = size
    o.location = Vector(loc)
    o.rotation_euler = Euler(rot)
    coll.objects.link(o)
    if parent is not None:
        o.parent = parent
    return o


def instance(proto_mesh, name, coll, loc, rot=(0, 0, 0), scale=(1, 1, 1), parent=None):
    o = bpy.data.objects.new(name, proto_mesh)
    o.location = Vector(loc)
    o.rotation_euler = Euler(rot)
    o.scale = Vector(scale) if not isinstance(scale, (int, float)) else Vector((scale,) * 3)
    coll.objects.link(o)
    if parent is not None:
        o.parent = parent
    return o
