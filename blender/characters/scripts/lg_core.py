"""Loup-Garou characters: procedural geometry toolkit (numpy only, no hand modelling).

Blender convention everywhere: Z up, the character faces -Y, its left side is +X, metres.

A character is assembled from `Part`s: plain numpy vertex arrays + polygon index tuples + per-corner
UVs (in a local 0..1 space, mapped into an atlas region at assembly time), skin weights per bone,
and morph-target deltas. Everything is joined into one skinned mesh at the end (lg_assemble).

Surface builders:
- grid:    a (rows, cols) lattice of points joined by quads, optionally wrapped in u (tubes, shells)
- loft:    rings joined by quads (sleeves, trouser legs, torso, shoes...)
- lathe:   a profile revolved around an axis (hats, buttons, lamps)
- radial:  a direction lattice projected on a signed distance field from a centre (head, hair, beard)
"""
from __future__ import annotations

import math
from typing import Callable, Sequence

import numpy as np

TAU = 2.0 * math.pi


# ------------------------------------------------------------------------------------------------
# small maths
# ------------------------------------------------------------------------------------------------

def v3(x, y=None, z=None):
    if y is None:
        return np.asarray(x, dtype=np.float64)
    return np.array((x, y, z), dtype=np.float64)


def normalize(v, axis=-1):
    v = np.asarray(v, dtype=np.float64)
    n = np.linalg.norm(v, axis=axis, keepdims=True)
    return v / np.maximum(n, 1e-12)


def smoothstep(e0, e1, x):
    t = np.clip((np.asarray(x, dtype=np.float64) - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def rot_x(a):
    c, s = math.cos(a), math.sin(a)
    return np.array(((1, 0, 0), (0, c, -s), (0, s, c)), dtype=np.float64)


def rot_y(a):
    c, s = math.cos(a), math.sin(a)
    return np.array(((c, 0, s), (0, 1, 0), (-s, 0, c)), dtype=np.float64)


def rot_z(a):
    c, s = math.cos(a), math.sin(a)
    return np.array(((c, -s, 0), (s, c, 0), (0, 0, 1)), dtype=np.float64)


def rot_axis(axis, a):
    """3x3 rotation of angle a (radians) around axis (Rodrigues)."""
    k = normalize(np.asarray(axis, dtype=np.float64))
    K = np.array(((0, -k[2], k[1]), (k[2], 0, -k[0]), (-k[1], k[0], 0)))
    return np.eye(3) + math.sin(a) * K + (1 - math.cos(a)) * (K @ K)


def frame_from(direction, up_hint=(0.0, 0.0, 1.0)):
    """Orthonormal (u, v, w) with w = direction, u ~ perpendicular to up_hint, v completing."""
    w = normalize(direction)
    up = np.asarray(up_hint, dtype=np.float64)
    if abs(np.dot(up, w)) > 0.98:
        up = np.array((0.0, -1.0, 0.0)) if abs(w[1]) < 0.9 else np.array((1.0, 0.0, 0.0))
    u = normalize(np.cross(up, w))
    v = np.cross(w, u)
    return u, v, w


def hash_noise(i, seed=0):
    """Deterministic pseudo random in [0,1) for integer arrays."""
    x = (np.asarray(i, dtype=np.int64) * 374761393 + seed * 668265263) & 0xFFFFFFFF
    x = ((x ^ (x >> 13)) * 1274126177) & 0xFFFFFFFF
    x = x ^ (x >> 16)
    return (x & 0xFFFFFF) / float(0x1000000)


def value_noise_1d(t, freq=1.0, seed=0):
    """Smooth periodic-free 1D value noise in [-1, 1]."""
    x = np.asarray(t, dtype=np.float64) * freq
    i = np.floor(x).astype(np.int64)
    f = x - i
    a = hash_noise(i, seed) * 2 - 1
    b = hash_noise(i + 1, seed) * 2 - 1
    s = f * f * (3 - 2 * f)
    return a + (b - a) * s


def periodic_noise(t, harmonics=4, seed=0, falloff=0.6):
    """Smooth periodic noise of t in [0, 1) (period 1), in about [-1, 1]."""
    t = np.asarray(t, dtype=np.float64)
    out = np.zeros_like(t)
    amp = 1.0
    tot = 0.0
    for k in range(1, harmonics + 1):
        ph = hash_noise(np.array([k * 7 + 1]), seed)[0] * TAU
        out += amp * np.sin(TAU * k * t + ph)
        tot += amp
        amp *= falloff
    return out / tot


# ------------------------------------------------------------------------------------------------
# signed distance fields (numpy, vectorised on (N,3) arrays)
# ------------------------------------------------------------------------------------------------

def sd_sphere(c, r):
    c = v3(c)
    return lambda p: np.linalg.norm(p - c, axis=1) - r


def sd_ellipsoid(c, radii, rot=None):
    """Approximate SDF of an ellipsoid (Inigo Quilez's bound), optional 3x3 rotation (local->world)."""
    c = v3(c)
    r = v3(radii)
    R = None if rot is None else np.asarray(rot, dtype=np.float64)

    def f(p):
        q = p - c
        if R is not None:
            q = q @ R  # world -> local
        k0 = np.linalg.norm(q / r, axis=1)
        k1 = np.linalg.norm(q / (r * r), axis=1)
        return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)
    return f


def sd_capsule(a, b, ra, rb=None):
    a, b = v3(a), v3(b)
    rb = ra if rb is None else rb
    ba = b - a
    l2 = float(np.dot(ba, ba))

    def f(p):
        pa = p - a
        h = np.clip((pa @ ba) / l2, 0.0, 1.0)
        d = np.linalg.norm(pa - h[:, None] * ba, axis=1)
        return d - (ra + (rb - ra) * h)
    return f


def sd_loft_z(rows):
    """SDF (approximate) of a vertical loft of superellipse sections.

    rows: list of (z, half_width, front_depth(-Y), back_depth(+Y), y_centre, exponent), z increasing.
    """
    R = np.asarray(rows, dtype=np.float64)
    zs = R[:, 0]

    def f(p):
        z = p[:, 2]
        zc = np.clip(z, zs[0], zs[-1])
        hw = np.maximum(np.interp(zc, zs, R[:, 1]), 1e-4)
        fr = np.maximum(np.interp(zc, zs, R[:, 2]), 1e-4)
        bk = np.maximum(np.interp(zc, zs, R[:, 3]), 1e-4)
        cy = np.interp(zc, zs, R[:, 4])
        ex = np.interp(zc, zs, R[:, 5])
        y = p[:, 1] - cy
        D = np.where(y < 0, fr, bk)
        r = (np.abs(p[:, 0] / hw) ** ex + np.abs(y / D) ** ex) ** (1.0 / ex)
        sc = np.minimum(hw, D)
        d = (r - 1.0) * sc
        dz = np.maximum(zs[0] - z, 0) + np.maximum(z - zs[-1], 0)
        return np.where(dz > 0, np.sqrt(np.maximum(d, 0) ** 2 + dz ** 2), d)
    return f


def sd_plane(n, d0):
    n = normalize(v3(n))
    return lambda p: p @ n - d0


def op_smooth_union(k, *fs):
    def f(p):
        d = fs[0](p)
        for g in fs[1:]:
            e = g(p)
            h = np.clip(0.5 + 0.5 * (e - d) / k, 0.0, 1.0)
            d = e + (d - e) * h - k * h * (1.0 - h)
        return d
    return f


def op_smooth_sub(k, a, b):
    """a minus b, smoothed."""
    def f(p):
        d1 = a(p)
        d2 = -b(p)
        h = np.clip(0.5 + 0.5 * (d2 - d1) / k, 0.0, 1.0)
        return d1 + (d2 - d1) * h + k * h * (1.0 - h)
    return f


def op_union(*fs):
    def f(p):
        d = fs[0](p)
        for g in fs[1:]:
            d = np.minimum(d, g(p))
        return d
    return f


def op_offset(a, amount):
    return lambda p: a(p) - amount


def sdf_gradient(f, p, eps=1e-4):
    p = np.asarray(p, dtype=np.float64)
    g = np.zeros_like(p)
    for i in range(3):
        d = np.zeros(3)
        d[i] = eps
        g[:, i] = f(p + d) - f(p - d)
    return normalize(g)


def radial_project(f, center, dirs, tmin=0.005, tmax=0.4, iters=40):
    """Outermost zero of f along rays center + t * dir (bisection after a coarse outside->inside march)."""
    c = v3(center)
    dirs = normalize(np.asarray(dirs, dtype=np.float64).reshape(-1, 3))
    n = len(dirs)
    # coarse march from outside inward to bracket the outermost crossing
    steps = 64
    ts = np.linspace(tmax, tmin, steps)
    lo = np.full(n, tmin)
    hi = np.full(n, tmax)
    prev_out = f(c + dirs * tmax) > 0
    found = np.zeros(n, dtype=bool)
    for i in range(1, steps):
        t = ts[i]
        inside = f(c + dirs * t) <= 0
        hit = inside & prev_out & ~found
        lo[hit] = t
        hi[hit] = ts[i - 1]
        found |= hit
        prev_out = ~inside
    for _ in range(iters):
        mid = 0.5 * (lo + hi)
        inside = f(c + dirs * mid[:, None]) <= 0
        lo = np.where(inside, mid, lo)
        hi = np.where(inside, hi, mid)
    t = 0.5 * (lo + hi)
    return c + dirs * t[:, None], t


# ------------------------------------------------------------------------------------------------
# parts
# ------------------------------------------------------------------------------------------------

class Part:
    """Geometry chunk: V (N,3), F list of index tuples, UV list (per face, per corner) in local 0..1.

    region: atlas region key the local UVs are mapped into (see lg_texture.REGIONS); a 'flat' part
    maps every corner on one palette cell (`color` key).
    mat: 0 = main material, 1 = eyes/emissive material.
    weights: dict bone -> (N,) array (filled by lg_skin), morphs: dict name -> (N,3) deltas.
    """

    def __init__(self, name, V, F, UV=None, region=None, color=None, mat=0):
        self.name = name
        self.V = np.asarray(V, dtype=np.float64).reshape(-1, 3)
        self.F = [tuple(int(i) for i in f) for f in F]
        self.UV = UV
        self.region = region
        self.color = color
        self.mat = mat
        self.weights = {}
        self.morphs = {}
        self.tags = {}

    def copy(self, name=None):
        p = Part(name or self.name, self.V.copy(), list(self.F), None if self.UV is None else [list(u) for u in self.UV],
                 self.region, self.color, self.mat)
        p.weights = {k: v.copy() for k, v in self.weights.items()}
        p.morphs = {k: v.copy() for k, v in self.morphs.items()}
        p.tags = dict(self.tags)
        return p

    def mirrored(self, name=None):
        """Mirror across X (left <-> right), flipping winding and renaming weights."""
        p = self.copy(name)
        p.V[:, 0] *= -1
        p.F = [tuple(reversed(f)) for f in p.F]
        if p.UV is not None:
            p.UV = [list(reversed(u)) for u in p.UV]
        w = {}
        for k, v in p.weights.items():
            w[swap_side(k)] = v
        p.weights = w
        for k in p.morphs:
            p.morphs[k][:, 0] *= -1
        return p

    def transform(self, M3=None, t=None):
        if M3 is not None:
            self.V = self.V @ np.asarray(M3).T
            for k in self.morphs:
                self.morphs[k] = self.morphs[k] @ np.asarray(M3).T
        if t is not None:
            self.V = self.V + np.asarray(t)
        return self

    @property
    def tri_count(self):
        return sum(len(f) - 2 for f in self.F)


def swap_side(name):
    if name.endswith("_l"):
        return name[:-2] + "_r"
    if name.endswith("_r"):
        return name[:-2] + "_l"
    return name


def merge_parts(parts, name, region=None, color=None, mat=None):
    """Concatenate parts (keeps per-part UVs; region/color of the first unless overridden)."""
    V, F, UV = [], [], []
    off = 0
    has_uv = all(p.UV is not None for p in parts)
    for p in parts:
        V.append(p.V)
        F += [tuple(i + off for i in f) for f in p.F]
        if has_uv:
            UV += p.UV
        off += len(p.V)
    q = Part(name, np.concatenate(V), F, UV if has_uv else None,
             region if region is not None else parts[0].region,
             color if color is not None else parts[0].color,
             mat if mat is not None else parts[0].mat)
    return q


# ------------------------------------------------------------------------------------------------
# lattices
# ------------------------------------------------------------------------------------------------

def grid(P, wrap_u=True, uv=None, cap_start=None, cap_end=None, flip=False):
    """Quads over a (R, C, 3) lattice; rows = v (along), cols = u (around).

    uv: optional (R, C, 2) per-vertex local uv; for wrapped grids the seam corner gets u + 1 period.
    cap_*: None | 'pole' (fan to the row centroid) | (x,y,z) explicit pole | 'flat' (fan to centroid)
    Winding: with rings counter-clockwise when seen from the end (row R-1) the normals point outward.
    Returns V, F, UV (per corner)
    """
    P = np.asarray(P, dtype=np.float64)
    R, C = P.shape[:2]
    V = P.reshape(-1, 3)
    if uv is None:
        uu = np.linspace(0, 1, C, endpoint=not wrap_u) if True else None
        if wrap_u:
            uu = np.arange(C) / C
        vv = np.linspace(0, 1, R)
        uv = np.stack(np.meshgrid(uu, vv), axis=-1)
    uv = np.asarray(uv, dtype=np.float64)
    F, UV = [], []
    cols = C if wrap_u else C - 1
    for i in range(R - 1):
        for j in range(cols):
            j2 = (j + 1) % C
            f = (i * C + j, i * C + j2, (i + 1) * C + j2, (i + 1) * C + j)
            u0 = uv[i, j]
            u1 = uv[i, j2].copy()
            u2 = uv[i + 1, j2].copy()
            u3 = uv[i + 1, j]
            if wrap_u and j2 == 0:
                u1 = u1 + np.array((1.0, 0.0))
                u2 = u2 + np.array((1.0, 0.0))
            fu = [tuple(u0), tuple(u1), tuple(u2), tuple(u3)]
            if flip:
                f = tuple(reversed(f))
                fu = list(reversed(fu))
            F.append(f)
            UV.append(fu)
    extra = []
    for which, cap in (("start", cap_start), ("end", cap_end)):
        if cap is None:
            continue
        row = 0 if which == "start" else R - 1
        ring = P[row]
        if isinstance(cap, str):
            pole = ring.mean(axis=0)
        else:
            pole = np.asarray(cap, dtype=np.float64)
        idx = len(V) + len(extra)
        extra.append(pole)
        pu = uv[row].mean(axis=0)
        for j in range(cols):
            j2 = (j + 1) % C
            a, b = row * C + j, row * C + j2
            ua, ub = tuple(uv[row, j]), tuple(uv[row, j2] + (np.array((1.0, 0)) if wrap_u and j2 == 0 else 0))
            if which == "start":
                f = (idx, b, a)
                fu = [tuple(pu), ub, ua]
            else:
                f = (idx, a, b)
                fu = [tuple(pu), ua, ub]
            if flip:
                f = tuple(reversed(f))
                fu = list(reversed(fu))
            F.append(f)
            UV.append(fu)
    if extra:
        V = np.concatenate([V, np.asarray(extra)])
    return V, F, UV


def ring_points(center, u, v, n, ra, rb=None, p=2.0, phase=0.0, rmod=None):
    """n points of a superellipse ring in plane (u, v) around center, counter-clockwise from u."""
    rb = ra if rb is None else rb
    t = phase + np.arange(n) / n * TAU
    c, s = np.cos(t), np.sin(t)
    e = 2.0 / p
    x = np.sign(c) * np.abs(c) ** e
    y = np.sign(s) * np.abs(s) ** e
    k = 1.0 if rmod is None else rmod(t)
    x = x * ra * k
    y = y * rb * k
    return np.asarray(center)[None, :] + x[:, None] * np.asarray(u)[None, :] + y[:, None] * np.asarray(v)[None, :]


def path_frames(path, up_hint=(0.0, -1.0, 0.0)):
    """Rotation-minimising frames along a polyline: list of (u, v, w) with w the tangent."""
    path = np.asarray(path, dtype=np.float64)
    n = len(path)
    T = np.zeros_like(path)
    T[1:-1] = path[2:] - path[:-2]
    T[0] = path[1] - path[0]
    T[-1] = path[-1] - path[-2]
    T = normalize(T)
    frames = []
    u, v, w = frame_from(T[0], up_hint)
    frames.append((u, v, w))
    for i in range(1, n):
        w2 = T[i]
        # parallel transport u
        u2 = u - np.dot(u, w2) * w2
        if np.linalg.norm(u2) < 1e-6:
            u2, _, _ = frame_from(w2, up_hint)
        u2 = normalize(u2)
        v2 = np.cross(w2, u2)
        frames.append((u2, v2, w2))
        u, v, w = u2, v2, w2
    return frames


def tube(path, radii, n=12, up_hint=(0.0, -1.0, 0.0), cap_start=None, cap_end=None, shape=None,
         frames=None, phase=0.0):
    """Loft of rings along a path. radii: scalar, list, or list of (ra, rb). shape(i, t_angles)->k mod."""
    path = np.asarray(path, dtype=np.float64)
    frames = frames or path_frames(path, up_hint)
    rings = []
    for i, (p, (u, v, w)) in enumerate(zip(path, frames)):
        r = radii[i] if isinstance(radii, (list, tuple, np.ndarray)) else radii
        if isinstance(r, (list, tuple, np.ndarray)) and np.ndim(r) == 1 and len(r) >= 2:
            ra, rb = r[0], r[1]
            pe = r[2] if len(r) > 2 else 2.0
        else:
            ra = rb = float(r)
            pe = 2.0
        rm = (lambda t, i=i: shape(i, t)) if shape is not None else None
        rings.append(ring_points(p, u, v, n, ra, rb, pe, phase=phase, rmod=rm))
    P = np.stack(rings)
    # local uv: u around, v by arc length (normalised)
    seg = np.linalg.norm(np.diff(path, axis=0), axis=1)
    s = np.concatenate([[0.0], np.cumsum(seg)])
    s = s / max(s[-1], 1e-9)
    uu = np.arange(n) / n
    uv = np.stack(np.meshgrid(uu, s), axis=-1)
    return grid(P, wrap_u=True, uv=uv, cap_start=cap_start, cap_end=cap_end)


def lathe(profile, n=24, center=(0, 0, 0), sx=1.0, sy=1.0, cap_top=None, cap_bottom=None, rmod=None, phase=-math.pi / 2):
    """Revolve a (r, z) profile (listed bottom->top or any order) around Z. Rings ccw seen from +Z.

    rmod(angles, ring_index) -> radius multiplier (ovalisation, notches...). phase -pi/2 puts the seam at the back (+Y).
    """
    prof = np.asarray(profile, dtype=np.float64)
    t = phase + np.arange(n) / n * TAU
    rings = []
    for k, (r, z) in enumerate(prof):
        m = 1.0 if rmod is None else rmod(t, k)
        x = np.cos(t) * r * sx * m
        y = np.sin(t) * r * sy * m
        rings.append(np.stack([x, y, np.full(n, z)], axis=1) + np.asarray(center))
    P = np.stack(rings)
    seg = np.linalg.norm(np.diff(prof, axis=0), axis=1)
    s = np.concatenate([[0.0], np.cumsum(seg)])
    s = s / max(s[-1], 1e-9)
    uu = np.arange(n) / n
    uv = np.stack(np.meshgrid(uu, s), axis=-1)
    return grid(P, wrap_u=True, uv=uv, cap_start=cap_bottom, cap_end=cap_top)


def make_part(name, VFU, region=None, color=None, mat=0):
    V, F, UV = VFU
    return Part(name, V, F, UV, region=region, color=color, mat=mat)


def warp_samples(n, lo, hi, focus=None, strength=0.0, endpoint=True):
    """n samples in [lo, hi], denser around `focus` (0..1 of the range) when strength > 0."""
    t = np.linspace(0, 1, n, endpoint=endpoint)
    if focus is not None and strength > 0:
        # inverse of a density bump: t' = t - strength * sin(2pi (t - focus)) / 2pi style warp
        t = t + strength * np.sin(TAU * (t - focus)) / TAU
        t = (t - t.min()) / (t.max() - t.min()) if endpoint else t
    return lo + (hi - lo) * t


def compute_vertex_normals(V, F):
    N = np.zeros_like(V)
    for f in F:
        if len(f) < 3:
            continue
        p = V[list(f)]
        # Newell normal
        n = np.zeros(3)
        for i in range(len(f)):
            a = p[i]
            b = p[(i + 1) % len(f)]
            n += np.array(((a[1] - b[1]) * (a[2] + b[2]), (a[2] - b[2]) * (a[0] + b[0]), (a[0] - b[0]) * (a[1] + b[1])))
        for i in f:
            N[i] += n
    return normalize(N)
