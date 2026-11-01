"""Loup-Garou characters: hair, beards, hats and head accessories (head-local coordinates).

Hair cap: a lattice (crown -> hairline) of directions projected on the head SDF and pushed outward by a
thickness field (volume, clumps, quiff, parting). The hairline edge tucks under the skin so no gap
shows. Extra volumes (long hair, braids, buns, tufts, afro) are lofts / bumpy shells added on top.
"""
from __future__ import annotations

import math

import numpy as np

import lg_core as C
from lg_head import orient_outward, nearest_on_polyline


def periodic_interp(phi, keys):
    """keys: list of (phi_deg, value) on [-180, 180]; smooth periodic interpolation (cosine)."""
    ks = sorted(keys)
    xs = np.radians([k[0] for k in ks])
    ys = np.array([k[1] for k in ks], dtype=np.float64)
    xs_ext = np.concatenate([xs - C.TAU, xs, xs + C.TAU])
    ys_ext = np.concatenate([ys, ys, ys])
    phi = np.asarray(phi, dtype=np.float64)
    i = np.searchsorted(xs_ext, phi) - 1
    i = np.clip(i, 0, len(xs_ext) - 2)
    x0, x1 = xs_ext[i], xs_ext[i + 1]
    t = (phi - x0) / np.maximum(x1 - x0, 1e-9)
    t = 0.5 - 0.5 * np.cos(np.clip(t, 0, 1) * math.pi)
    return ys_ext[i] + (ys_ext[i + 1] - ys_ext[i]) * t


def _dir(theta, phi):
    return np.stack([np.sin(theta) * np.sin(phi), -np.sin(theta) * np.cos(phi), np.cos(theta)], axis=-1)


HAIRLINES = {
    # (phi deg, theta deg): 0 = front, 90 = left side, 180 = back
    "short": [(0, 40), (28, 46), (50, 57), (68, 66), (77, 90), (84, 72), (100, 74), (118, 100), (145, 114), (180, 120)],
    "fringe": [(0, 62), (25, 64), (50, 66), (75, 72), (95, 78), (115, 100), (145, 114), (180, 118)],
    "long": [(0, 44), (30, 52), (60, 66), (85, 80), (100, 90), (125, 108), (150, 118), (180, 122)],
    "afro": [(0, 46), (30, 52), (60, 64), (80, 72), (100, 84), (130, 104), (160, 114), (180, 116)],
    "wolf": [(0, 50), (25, 58), (50, 80), (75, 104), (100, 112), (130, 122), (160, 126), (180, 126)],
    "under_hat": [(0, 70), (45, 72), (75, 76), (95, 82), (120, 100), (150, 112), (180, 115)],
    "buzz": [(0, 44), (35, 52), (65, 66), (90, 74), (115, 96), (150, 110), (180, 114)],
}


def hair_cap(H, f_head, style, n_phi=30, n_s=10, color="hair"):
    """style dict: hairline (key or list), thick, top (extra volume on top), quiff, part_phi, clumps,
    fringe_points, messy, back_volume, side_volume."""
    hl = style.get("hairline", "short")
    hl_keys = HAIRLINES[hl] if isinstance(hl, str) else hl
    keys = [(p, t) for p, t in hl_keys] + [(-p, t) for p, t in hl_keys if 0 < p < 180]
    phis = np.linspace(-math.pi, math.pi, n_phi, endpoint=False)
    th_hl = np.radians(periodic_interp(phis, keys))
    # fringe points: zigzag of the front edge
    fp = style.get("fringe_points", 0)
    if fp:
        amp = math.radians(style.get("fringe_amp", 7.0))
        front = np.exp(-(phis / math.radians(style.get("fringe_width", 60))) ** 2)
        zig = np.abs(np.sin((phis + style.get("fringe_phase", 0.0)) * fp / 2.0))
        th_hl = th_hl + amp * front * (zig - 0.3)
    s = np.linspace(0.0, 1.0, n_s)
    s = s ** 0.85
    S_, PH = np.meshgrid(s, phis, indexing="ij")
    TH = np.maximum(S_ * th_hl[None, :], math.radians(5))
    D = _dir(TH, PH)
    P, r = C.radial_project(f_head, (0, 0, 0), D.reshape(-1, 3), tmax=0.3)
    r = r.reshape(TH.shape)
    thick = style.get("thick", 0.012)
    t = np.full(TH.shape, thick)
    # volume profile: thicker on top/back, thin at the hairline
    t *= 0.55 + 0.45 * np.cos(np.clip(S_, 0, 1) * math.pi * 0.5) ** 0.6
    top = style.get("top", 0.0)
    t += top * np.exp(-(TH / math.radians(style.get("top_w", 40))) ** 2)
    back = style.get("back_volume", 0.0)
    t += back * np.exp(-((PH - math.pi) % C.TAU - math.pi) ** 2 / 0.8 ** 2 * 0 - ((np.abs(PH) - math.pi) / 0.9) ** 2) * C.smoothstep(0.2, 0.7, S_)
    side = style.get("side_volume", 0.0)
    t += side * np.exp(-((np.abs(PH) - math.pi / 2) / 0.6) ** 2) * C.smoothstep(0.3, 0.8, S_)
    q = style.get("quiff", 0.0)
    if q:
        qphi = math.radians(style.get("quiff_phi", 0.0))
        t += q * np.exp(-((PH - qphi) / 0.55) ** 2) * np.exp(-((TH - math.radians(38)) / math.radians(18)) ** 2)
    pphi = style.get("part_phi")
    if pphi is not None:
        g = np.exp(-((PH - math.radians(pphi)) / 0.07) ** 2) * C.smoothstep(0.15, 0.5, S_) * C.smoothstep(1.0, 0.7, S_)
        t *= 1 - 0.55 * g
    cl = style.get("clumps", 0.25)
    nclump = style.get("clump_n", 9)
    clump = C.periodic_noise((PH + math.pi) / C.TAU * nclump / 9.0, harmonics=3, seed=style.get("seed", 1))
    clump2 = np.abs(np.sin((PH + math.pi) * nclump))
    t *= 1 + cl * (0.5 * clump + 0.5 * (clump2 - 0.6)) * C.smoothstep(0.2, 1.0, S_)
    messy = style.get("messy", 0.0)
    if messy:
        rnd = C.hash_noise(np.arange(TH.size).reshape(TH.shape), 77)
        t += messy * (rnd - 0.3) * C.smoothstep(0.1, 0.6, S_)
    # edge: the fringe keeps a visible thickness at the front, then folds back under the hair
    lip = style.get("lip", 0.004) * np.exp(-(phis / math.radians(style.get("lip_width", 70))) ** 2)
    t[-1, :] = np.maximum(-0.002, lip * 0.4)
    t[-2, :] = np.minimum(t[-2, :], 0.004 + lip * 1.5)
    Pout = D * (r + t)[..., None]
    # tuck row: under the hair, slightly above the hairline
    th_tuck = TH[-1] - np.radians(4.0) * (0.3 + np.exp(-(phis / 1.2) ** 2))
    Dt = _dir(th_tuck, phis)
    Pt, rt = C.radial_project(f_head, (0, 0, 0), Dt, tmax=0.3)
    Pout = np.concatenate([Pout, (Dt * (rt - 0.003)[:, None])[None]], axis=0)
    # sweep: rotate the outer points around the vertical a bit (combed direction)
    sweep = style.get("sweep", 0.0)
    if sweep:
        ang = sweep * C.smoothstep(0.3, 1.0, S_) * np.exp(-(PH / 1.2) ** 2)
        x, y = Pout[:-1, :, 0], Pout[:-1, :, 1]
        ca, sa = np.cos(ang), np.sin(ang)
        Pout[:-1] = np.stack([x * ca - y * sa, x * sa + y * ca, Pout[:-1, :, 2]], axis=-1)
    pole = C.radial_project(f_head, (0, 0, 0), np.array([[0, 0.12, 1.0]]))[0][0] * 1.0
    pole = pole + C.normalize(pole) * (thick + top * 0.8)
    uu = (phis + math.pi) / C.TAU
    uv = np.stack(np.meshgrid(uu, np.concatenate([s * 0.92, [0.99]])), axis=-1)
    V, F, UV = C.grid(Pout, wrap_u=True, uv=uv, cap_start=tuple(pole))
    part = C.Part("hair_cap", V, F, UV, region="hair")
    orient_outward(part, lambda X: np.zeros_like(X))
    return part


def hair_shell_sdf(f_head, thick):
    return C.op_offset(f_head, thick)


def long_hair(H, f_head, spec, n=16, color_region="hair"):
    """Long hair mass falling down the back (and over the shoulders): crescent rings around the back
    of the head/neck from the ears down to the tips. Head-local coords."""
    n = spec.get("n", n)
    length = spec.get("length", 0.30)        # below the head centre
    width = spec.get("width", 1.0)
    wave = spec.get("wave", 0.0)
    span = math.radians(spec.get("span", 230))  # angular span around the back
    zs = np.linspace(spec.get("top", 0.02), -length, 9)
    rings = []
    phis = np.linspace(-span / 2, span / 2, n) + math.pi  # centred on the back
    for k, z in enumerate(zs):
        f = k / (len(zs) - 1)
        # radius: hugs the head at the top, widens over the shoulders, tapers at the tips
        rx = (0.105 + 0.030 * C.smoothstep(0.25, 0.7, f) - 0.020 * C.smoothstep(0.8, 1.0, f)) * width
        ry = (0.118 + 0.010 * C.smoothstep(0.2, 0.6, f)) * width
        cy = 0.010 + 0.035 * C.smoothstep(0.3, 0.8, f)
        th = 0.020 + 0.010 * math.sin(f * math.pi)
        wv = wave * np.sin(phis * 7 + f * 9) * C.smoothstep(0.2, 0.6, f)
        x = np.sin(phis) * (rx + wv)
        y = -np.cos(phis) * (ry + wv) + cy
        zz = np.full(n, z) - 0.03 * C.smoothstep(0.85, 1.0, f) * (0.5 + 0.5 * np.cos(phis * 9))  # pointy tips
        outer = np.stack([x, y, zz], 1)
        inner = np.stack([np.sin(phis) * (rx - th), -np.cos(phis) * (ry - th) + cy, zz], 1)
        ring = np.concatenate([outer, inner[::-1]], axis=0)
        rings.append(ring)
    P = np.stack(rings)
    uu = np.concatenate([np.linspace(0, 0.5, n), np.linspace(0.5, 1.0, n)])
    vv = np.linspace(0.3, 1.0, len(zs))
    uv = np.stack(np.meshgrid(uu, vv), axis=-1)
    V, F, UV = C.grid(P, wrap_u=True, uv=uv, cap_end="pole")
    part = C.Part("long_hair", V, F, UV, region=color_region)
    axis = [np.array((0, 0.03, 0.1)), np.array((0, 0.06, -length - 0.1))]

    def inside(X):
        # inside reference: the crescent's mid line at the same height/angle
        out = X.copy()
        ang = np.arctan2(X[:, 0], -(X[:, 1] - 0.03))
        r = np.sqrt(X[:, 0] ** 2 + (X[:, 1] - 0.03) ** 2)
        return np.stack([np.sin(ang) * (r - 0.01), -np.cos(ang) * (r - 0.01) + 0.03, X[:, 2]], 1)
    orient_outward(part, inside)
    return part


def braid(start, direction, length, r=0.016, segs=7, n=7, side=1):
    """Braid: chain of bulges along a slightly curved path + tie + end tuft."""
    d = C.normalize(np.asarray(direction, dtype=np.float64))
    pts = []
    radii = []
    m = segs * 2
    for i in range(m + 1):
        t = i / m
        p = np.asarray(start) + d * length * t + np.array((side * 0.02, -0.03, 0)) * math.sin(t * math.pi * 0.8)
        pts.append(p)
        bulge = 0.75 + 0.25 * abs(math.sin(t * segs * math.pi))
        radii.append(r * bulge * (1 - 0.25 * t))
    tie = pts[-1] + d * 0.012
    pts += [tie, tie + d * 0.008]
    radii += [r * 0.45, r * 0.5]
    tuft_end = tie + d * 0.05
    pts += [tie + d * 0.02, tie + d * 0.035]
    radii += [r * 0.8, r * 0.6]
    V, F, UV = C.tube(np.array(pts), radii, n=n, up_hint=(0, -1, 0), cap_start="pole", cap_end=tuple(tuft_end))
    part = C.Part("braid", V, F, UV, region="hair")
    part.UV = [[(u * 0.25, 0.4 + 0.6 * v) for (u, v) in fu] for fu in UV]
    orient_outward(part, nearest_on_polyline(pts + [tuft_end]))
    return part


def tufts(H, f_head, count, seed, length=0.035, r=0.012, region_theta=(0, 70), phi_range=(-180, 180), n=5):
    """Spiky locks sticking out of the cap (messy hair)."""
    parts = []
    rng = np.random.default_rng(seed)
    for i in range(count):
        th = math.radians(rng.uniform(*region_theta))
        ph = math.radians(rng.uniform(*phi_range))
        d = _dir(np.array(th), np.array(ph))
        p, _ = C.radial_project(f_head, (0, 0, 0), d[None, :])
        base = p[0] + d * 0.010
        out = C.normalize(d + np.array((rng.uniform(-0.4, 0.4), rng.uniform(-0.6, 0.2), rng.uniform(0.0, 0.5))))
        L = length * rng.uniform(0.7, 1.3)
        pts = [base - out * 0.012, base + out * L * 0.4, base + out * L * 0.75]
        tip = base + out * L + np.array((0, 0.006, -0.004))
        V, F, UV = C.tube(np.array(pts), [r, r * 0.75, r * 0.4], n=n, up_hint=(0, 0, 1), cap_start="pole", cap_end=tuple(tip))
        tp = C.Part("tuft", V, F, UV, region="hair")
        tp.UV = [[(0.1 + u * 0.3, 0.2 + 0.6 * v) for (u, v) in fu] for fu in UV]
        orient_outward(tp, nearest_on_polyline(pts + [tip]))
        parts.append(tp)
    return parts


def bumpy_shell(H, f_head, hairline_key, thick, bump, n_phi=34, n_s=12, seed=3):
    """Afro / curly volume: a thick cap with round bumps."""
    keys = HAIRLINES[hairline_key]
    keys = [(p, t) for p, t in keys] + [(-p, t) for p, t in keys if 0 < p < 180]
    phis = np.linspace(-math.pi, math.pi, n_phi, endpoint=False)
    th_hl = np.radians(periodic_interp(phis, keys))
    s = np.linspace(0, 1, n_s) ** 0.9
    S_, PH = np.meshgrid(s, phis, indexing="ij")
    TH = np.maximum(S_ * th_hl[None, :], math.radians(4))
    D = _dir(TH, PH)
    P, r = C.radial_project(f_head, (0, 0, 0), D.reshape(-1, 3), tmax=0.3)
    r = r.reshape(TH.shape)
    t = thick * (0.35 + 0.65 * C.smoothstep(1.0, 0.55, S_))
    b = 0.5 + 0.5 * np.sin(PH * 9 + S_ * 2) * np.sin(S_ * 14 + PH * 3)
    t = t + bump * b * C.smoothstep(1.0, 0.7, S_)
    t[-1, :] = -0.0025
    t[-2, :] = np.minimum(t[-2, :], thick * 0.35)
    Pout = D * (r + t)[..., None]
    top = C.radial_project(f_head, (0, 0, 0), np.array([[0, 0.05, 1.0]]))[0][0]
    top = top + C.normalize(top) * (thick + bump * 0.5)
    uu = (phis + math.pi) / C.TAU
    uv = np.stack(np.meshgrid(uu, s), axis=-1)
    V, F, UV = C.grid(Pout, wrap_u=True, uv=uv, cap_start=tuple(top))
    part = C.Part("afro", V, F, UV, region="hair")
    orient_outward(part, lambda X: np.zeros_like(X))
    return part


def beard(H, f_head, kind="full", thick=0.012, n_phi=20, n_t=8):
    """Beard shell over the jaw: covers cheeks/jaw/chin below the mouth line and sideburns."""
    phis = np.linspace(-math.radians(118), math.radians(118), n_phi)
    if kind == "full":
        th_top = 96.0 + 16.0 * np.exp(-(phis / 0.45) ** 2)  # rises to the sideburns, stays under the cheekbones
        th_bot = 150.0
    else:  # short / stubble beard
        th_top = 104.0 + 10.0 * np.exp(-(phis / 0.45) ** 2)
        th_bot = 146.0
    th_top = th_top - 22.0 * C.smoothstep(math.radians(70), math.radians(112), np.abs(phis))
    ts = np.linspace(0, 1, n_t)
    TT, PH = np.meshgrid(ts, phis, indexing="ij")
    TH = np.radians(th_top[None, :] + (th_bot - th_top[None, :]) * TT)
    D = _dir(TH, PH)
    P, r = C.radial_project(f_head, (0, 0, 0), D.reshape(-1, 3), tmax=0.3)
    r = r.reshape(TH.shape)
    t = thick * np.sin(np.clip(TT, 0, 1) * math.pi * 0.5 + 0.25) * C.smoothstep(math.radians(118), math.radians(95), np.abs(PH))
    chin = np.exp(-(PH / 0.5) ** 2) * C.smoothstep(0.3, 0.8, TT)
    t = t + thick * 0.9 * chin * (1.0 if kind == "full" else 0.4)
    clump = 0.85 + 0.15 * np.abs(np.sin(PH * 11))
    t = t * clump
    t[0, :] = -0.002
    t[:, 0] = -0.002
    t[:, -1] = -0.002
    Pout = D * (r + t)[..., None]
    uu = (phis - phis.min()) / (phis.max() - phis.min())
    uv = np.stack(np.meshgrid(uu, ts * 0.9 + 0.05), axis=-1)
    V, F, UV = C.grid(Pout, wrap_u=False, uv=uv)
    part = C.Part("beard", V, F, UV, region="hair2")
    orient_outward(part, lambda X: np.zeros_like(X))
    return part


def mustache(H, f_head, thick=0.008, width=0.030):
    mz = H["mouth_z"]
    xs = np.linspace(-width, width, 9)
    pts = []
    for x in xs:
        k = abs(x) / width
        z = mz + 0.009 - 0.010 * k ** 1.6
        pts.append((x, -0.15, z))
    P0 = np.array(pts)
    dirs = P0.copy()
    dirs[:, 1] = -0.11
    P, _ = C.radial_project(f_head, (0, 0, 0), dirs)
    n = C.sdf_gradient(f_head, P)
    rings = []
    nr = 6
    for i in range(len(P)):
        k = abs(xs[i]) / width
        w = (0.0075 * (1 - 0.65 * k)) + 0.0015
        h = thick * (1 - 0.5 * k) + 0.002
        up = np.array((0, 0, 1.0))
        a = np.arange(nr) / nr * C.TAU
        ring = P[i] + n[i] * h * 0.6 + np.cos(a)[:, None] * up * w + np.sin(a)[:, None] * n[i] * h
        rings.append(ring)
    V, F, UV = C.grid(np.stack(rings), wrap_u=True, cap_start="pole", cap_end="pole")
    part = C.Part("mustache", V, F, UV, region="hair2")
    part.UV = [[(0.3 + 0.4 * u, 0.5 + 0.3 * v) for (u, v) in fu] for fu in UV]
    orient_outward(part, nearest_on_polyline(P))
    return part


# ------------------------------------------------------------------------------------------------
# hats (lathe around the head's vertical axis, fitted to the head + hair)
# ------------------------------------------------------------------------------------------------

def head_extent(f, z, clearance=0.0):
    """Half width / half depth (front, back) of the SDF at height z (head-local)."""
    out = {}
    for name, d in (("x", (1, 0, 0)), ("front", (0, -1, 0)), ("back", (0, 1, 0))):
        dd = np.array([[d[0], d[1], 0.0]])
        P, _ = C.radial_project(f, (0, 0, z), dd, tmax=0.25)
        out[name] = abs(P[0][0] if name == "x" else P[0][1]) + clearance
    return out


def fitted_lathe(f, profile, n=24, center_y=None, tilt=0.0, rmod=None, base_z=0.03, clearance=0.006):
    """profile: list of (k, dz) where k scales the head ellipse measured at base_z (k=1 -> touching)
    and dz is the height above base_z. Returns V, F, UV in head-local coordinates."""
    ext = head_extent(f, base_z, clearance)
    rx = ext["x"]
    ry = 0.5 * (ext["front"] + ext["back"])
    cy = 0.5 * (ext["back"] - ext["front"]) if center_y is None else center_y
    prof = [(k, dz) for k, dz in profile]
    V, F, UV = C.lathe([(k, dz) for k, dz in prof], n=n, sx=rx, sy=ry, rmod=rmod,
                       cap_top="pole", cap_bottom="pole")
    V = np.asarray(V)
    V[:, 1] += cy
    V[:, 2] += base_z
    if tilt:
        R = C.rot_x(math.radians(tilt))
        piv = np.array((0, cy, base_z))
        V = (V - piv) @ R.T + piv
    return V, F, UV


def hat_part(V, F, UV, name="hat", region="hat", sub=None):
    part = C.Part(name, V, F, UV, region=region)
    if sub:
        part.tags["uv_rect"] = sub
    ctr = V.mean(axis=0)

    def inside(X):
        # nearest point on the vertical axis through the hat
        return np.stack([np.full(len(X), ctr[0]), np.full(len(X), ctr[1]), X[:, 2]], 1)
    orient_outward(part, inside)
    return part


def straw_hat(f, n=20):
    crown = [(0.0, 0.135), (0.55, 0.132), (0.85, 0.120), (0.98, 0.090), (1.02, 0.045), (1.05, 0.010),
             (1.06, -0.004)]
    brim = [(1.06, -0.004), (1.35, -0.010), (1.75, -0.022), (2.05, -0.040), (2.10, -0.046), (2.07, -0.052),
            (1.70, -0.030), (1.30, -0.016), (1.0, -0.012)]
    prof = list(reversed(crown)) + brim[1:]
    prof = [(k, z) for k, z in prof]
    # profile must go from the top pole down and back in: lathe expects bottom->top order for caps;
    # we pass top->...->inner and cap both ends.
    V, F, UV = fitted_lathe(f, prof, n=n, tilt=-8.0, base_z=0.045, clearance=0.012)
    p = hat_part(V, F, UV, "straw_hat")
    return p


def ranger_hat(f, n=24):
    def rmod(t, k):
        # four dents on the top of the crown (Montana peak)
        if k <= 2:
            return 1.0 - 0.14 * (1 - k / 2.0) * (0.5 + 0.5 * np.cos(4 * (t + math.pi / 4)))
        return np.ones_like(t)
    crown = [(0.0, 0.150), (0.30, 0.135), (0.62, 0.120), (0.90, 0.090), (1.0, 0.045), (1.03, 0.012), (1.04, -0.002)]
    brim = [(1.04, -0.002), (1.40, -0.004), (1.85, -0.006), (1.95, -0.010), (1.90, -0.016), (1.40, -0.012), (1.0, -0.010)]
    prof = crown + brim[1:]
    V, F, UV = fitted_lathe(f, prof, n=n, tilt=-4.0, base_z=0.050, clearance=0.012, rmod=rmod)
    return hat_part(V, F, UV, "ranger_hat")


def beanie(f, n=20, cuff=True, pompom=False, slouch=0.0, base_z=0.025):
    prof = [(0.0, 0.160 + slouch), (0.45, 0.150 + slouch * 0.9), (0.78, 0.120 + slouch * 0.5), (0.97, 0.070),
            (1.02, 0.020), (1.02, -0.010)]
    if cuff:
        prof += [(1.07, -0.012), (1.08, 0.030), (1.04, 0.036), (0.98, 0.030)]
    else:
        prof += [(0.97, -0.014)]
    V, F, UV = fitted_lathe(f, prof, n=n, tilt=-10.0, base_z=base_z, clearance=0.008)
    parts = [hat_part(V, F, UV, "beanie")]
    if pompom:
        top = V[np.argmax(V[:, 2])]
        c = top + np.array((0, 0.0, 0.028))
        pv, pf, puv = C.lathe([(0.0, -1.0), (0.7, -0.72), (1.0, 0.0), (0.7, 0.72), (0.0, 1.0)], n=10)
        pv = np.asarray(pv) * 0.034 + c
        noise = 1.0 + 0.10 * np.sin(pv[:, 0] * 400) * np.sin(pv[:, 1] * 380) * np.sin(pv[:, 2] * 420)
        pv = c + (pv - c) * noise[:, None]
        pp = C.Part("pompom", pv, pf, puv, region="hat")
        pp.tags["uv_rect"] = (0.0, 0.0, 0.3, 0.2)
        orient_outward(pp, lambda X: np.repeat(c[None, :], len(X), 0))
        parts.append(pp)
    return parts


def cap(f, n=24, backwards=False):
    prof = [(0.0, 0.128), (0.50, 0.122), (0.82, 0.100), (0.98, 0.060), (1.03, 0.020), (1.03, -0.002), (0.97, -0.006)]
    V, F, UV = fitted_lathe(f, prof, n=n, tilt=-6.0, base_z=0.050, clearance=0.008)
    crown = hat_part(V, F, UV, "cap")
    # visor: curved slab in front
    ext = head_extent(f, 0.05, 0.008)
    front = -ext["front"]
    zb = 0.050 + 0.004
    xs = np.linspace(-1, 1, 9)
    rows = []
    for k, (dl, dz, thick) in enumerate(((0.0, 0.0, 0.0), (0.035, -0.006, 0.0), (0.070, -0.016, 0.0))):
        w = ext["x"] * (0.92 - 0.25 * k / 2)
        x = xs * w
        y = front - dl * np.sqrt(np.clip(1 - xs ** 2, 0, 1)) * 1.0 + 0.012 * xs ** 2 * 0 + 0.005
        z = zb + dz - 0.012 * xs ** 2
        rows.append(np.stack([x, y, z], 1))
    top = np.stack(rows)
    bot = top.copy()
    bot[..., 2] -= 0.006
    # closed slab: ring around the outline (top row 0 .. end, then bottom back)
    ring_list = []
    for j in range(len(xs)):
        col_top = top[:, j]
        col_bot = bot[:, j][::-1]
        ring_list.append(np.concatenate([col_top, col_bot]))
    P = np.stack(ring_list)  # (n_x, 6, 3): rings across x
    V2, F2, UV2 = C.grid(P, wrap_u=True, cap_start="pole", cap_end="pole")
    visor = C.Part("visor", V2, F2, UV2, region="hat")
    visor.tags["uv_rect"] = (0.0, 0.0, 1.0, 0.3)
    c = np.array((0, front - 0.03, zb - 0.01))
    orient_outward(visor, lambda X: np.stack([X[:, 0], np.full(len(X), c[1]), np.full(len(X), c[2] - 0.003)], 1))
    parts = [crown, visor]
    if backwards:
        R = C.rot_z(math.pi)
        for p in parts:
            p.V = p.V @ R.T
    return parts


def head_band(f, z_front=0.055, z_back=0.020, width=0.022, thick=0.006, n=28, clearance=0.010, name="band", region="hat"):
    """Band around the head (bandana / headlamp strap), tilted from front to back."""
    t = np.arange(n) / n * C.TAU
    rings = []
    for dz, dr in ((-width / 2, 0.0), (-width / 2, thick), (width / 2, thick), (width / 2, 0.0)):
        pts = []
        for a in t:
            # a = 0 front
            z = z_front + (z_back - z_front) * (0.5 - 0.5 * math.cos(a)) + dz
            d = np.array([[math.sin(a), -math.cos(a), 0.0]])
            P, _ = C.radial_project(f, (0, 0, z), d, tmax=0.25)
            p = P[0]
            dd = C.normalize(np.array((p[0], p[1], 0.0)))
            pts.append(p + dd * (clearance + dr))
        rings.append(np.array(pts))
    P = np.stack(rings)
    V, F, UV = C.grid(P, wrap_u=True)
    # close the band section: rings 0..3 form an open strip; add the inner face by wrapping rows
    P2 = np.concatenate([P, P[:1]], axis=0)
    V, F, UV = C.grid(P2, wrap_u=True)
    part = C.Part(name, V, F, UV, region=region)
    part.tags["uv_rect"] = (0.0, 0.3, 1.0, 0.6)
    ctr = np.array((0, 0.0, (z_front + z_back) / 2))
    orient_outward(part, lambda X: np.stack([np.zeros(len(X)), np.zeros(len(X)), X[:, 2]], 1))
    return part


def headlamp(f, z_front=0.060, color="lamp"):
    d = np.array([[0.0, -1.0, 0.0]])
    P, _ = C.radial_project(f, (0, 0, z_front), d, tmax=0.25)
    c = P[0] + np.array((0, -0.022, 0.0))
    prof = [(0.0, -0.012), (0.85, -0.012), (1.0, -0.006), (1.0, 0.010), (0.75, 0.014), (0.6, 0.012), (0.0, 0.010)]
    V, F, UV = C.lathe(prof, n=12, sx=0.024, sy=0.024)
    V = np.asarray(V)
    # lathe axis Z -> forward (-Y)
    R = C.rot_x(math.radians(90))
    V = V @ R.T
    V[:, 0] *= 1.25
    V = V + c
    part = C.Part("headlamp", V, F, UV, color=color)
    orient_outward(part, lambda X: np.repeat(c[None, :], len(X), 0))
    lens_c = c + np.array((0, -0.014, 0))
    lv, lf, luv = C.lathe([(0.0, 0.0), (0.8, -0.002), (0.75, 0.003), (0.0, 0.004)], n=10, sx=0.016, sy=0.016)
    lv = np.asarray(lv) @ R.T + lens_c
    lens = C.Part("lens", lv, lf, luv, color="lamp_lens")
    orient_outward(lens, lambda X: np.repeat((lens_c + np.array((0, 0.01, 0)))[None, :], len(X), 0))
    return [part, lens]


def glasses(H, f_head, eyes, r=0.0215, color="glasses"):
    parts = []
    rims = []
    for k, e in enumerate(eyes):
        c = np.array((e[0], e[1] - H["eye_r"] - 0.010, e[2] + 0.001))
        t = np.linspace(0, C.TAU, 14, endpoint=False)
        path = np.stack([c[0] + np.cos(t) * r, np.full_like(t, c[1]) + 0.004 * np.cos(t) * np.sign(e[0]), c[2] + np.sin(t) * r * 0.92], 1)
        rims.append((c, path))
        rings = []
        a = np.arange(4) / 4 * C.TAU
        for i in range(len(path)):
            d = C.normalize(path[i] - c)
            fwd = np.array((0, -1.0, 0))
            rings.append(path[i] + np.cos(a)[:, None] * d * 0.0018 + np.sin(a)[:, None] * fwd * 0.0018)
        P = np.stack(rings + [rings[0]])
        V, F, UV = C.grid(P[:-1], wrap_u=True)
        # close the torus: add faces between last and first ring
        n = 4
        R = len(path)
        F = [tuple(fc) for fc in F]
        for j in range(n):
            j2 = (j + 1) % n
            F.append(((R - 1) * n + j, (R - 1) * n + j2, j2, j))
        UV = UV + [[(0, 0)] * 4] * n
        part = C.Part("rim", V, F, UV, color=color)
        orient_outward(part, nearest_on_polyline(np.concatenate([path, path[:1]])))
        parts.append(part)
    # bridge and temples
    (c0, p0), (c1, p1) = rims
    br = [c0 + np.array((-np.sign(c0[0]) * r, 0, 0.004)), np.array((0, c0[1] - 0.002, c0[2] + 0.008)),
          c1 + np.array((-np.sign(c1[0]) * r, 0, 0.004))]
    V, F, UV = C.tube(np.array(br), 0.0016, n=5, up_hint=(0, -1, 0), cap_start="pole", cap_end="pole")
    bp = C.Part("bridge", V, F, UV, color=color)
    orient_outward(bp, nearest_on_polyline(br))
    parts.append(bp)
    hx = head_extent(f_head, c0[2], 0.0)["x"]
    for c in (c0, c1):
        sx = np.sign(c[0])
        a = c + np.array((sx * r, 0, 0.004))
        ear_p = np.array((sx * (hx + 0.003), 0.012, c[2] - 0.004))
        mid = np.array((sx * (hx + 0.005), (a[1] + ear_p[1]) / 2, c[2] + 0.002))
        pts = [a, np.array((sx * (hx + 0.002), a[1] + 0.012, a[2])), mid, ear_p]
        V, F, UV = C.tube(np.array(pts), 0.0017, n=5, up_hint=(0, 0, 1), cap_start="pole", cap_end="pole")
        tp = C.Part("temple", V, F, UV, color=color)
        orient_outward(tp, nearest_on_polyline(pts))
        parts.append(tp)
    return parts


def lock(f_head, theta0, phi0, dtheta, dphi, steps=5, width=0.016, thick=0.006, base_off=0.010, lift=0.006,
         tip_drop=0.0, n=6, uv=(0.0, 0.3)):
    """Flattened lock of hair lying on the head: starts at (theta0, phi0) and runs dtheta/dphi (deg)
    per step over the skull at a height base_off (+ an arch of `lift`), tapering to a point."""
    th = np.radians(theta0 + dtheta * np.arange(steps + 1))
    ph = np.radians(phi0 + dphi * np.arange(steps + 1))
    D = _dir(th, ph)
    P, r = C.radial_project(f_head, (0, 0, 0), D, tmax=0.3)
    k = np.arange(steps + 1) / steps
    off = base_off + lift * np.sin(np.pi * np.clip(k * 1.1, 0, 1)) - tip_drop * k ** 2
    pts = D * (r + off)[:, None]
    nrm = D
    T = np.gradient(pts, axis=0)
    T = C.normalize(T)
    rings = []
    a = np.arange(n) / n * C.TAU
    for i in range(len(pts)):
        side = C.normalize(np.cross(nrm[i], T[i]))
        nn = C.normalize(np.cross(T[i], side))
        w = width * (1 - 0.85 * k[i] ** 1.4)
        h = thick * (1 - 0.7 * k[i])
        rings.append(pts[i] + np.cos(a)[:, None] * side * w + np.sin(a)[:, None] * nn * h)
    tip = pts[-1] + T[-1] * width * 0.8
    V, F, UV = C.grid(np.stack(rings), wrap_u=True, cap_start="pole", cap_end=tuple(tip))
    part = C.Part("lock", V, F, UV, region="hair")
    part.UV = [[(uv[0] + 0.25 * u, uv[1] + 0.6 * v) for (u, v) in fu] for fu in UV]
    orient_outward(part, nearest_on_polyline(list(pts) + [tip]))
    return part
