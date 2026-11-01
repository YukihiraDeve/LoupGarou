"""Loup-Garou characters: head, eyes, eyelids, brows, mouth, ears, neck.

The head is a signed distance field (smooth union of ellipsoids: cranium, face, jaw, cheeks, brow,
nose, carved eye sockets) sampled on a latitude/longitude lattice that is denser on the face, each
vertex projected radially on the surface. Eyes are separate spheres (skinned to eye_l / eye_r) with
iris + pupil painted in the atlas. Eyelids are spherical shells around each eyeball whose edge angle is
driven by the morph targets (Blink closes them completely). Brows and mouth are thin pieces conforming
to the face surface.

All coordinates in this module are head-local (origin = head centre, metres, Blender axes) until
`place_head_parts()` moves them into armature space.
"""
from __future__ import annotations

import math

import numpy as np

import lg_core as C

THETA_MAX = math.radians(150.0)

# skull profile (head-local metres): z, half width, front depth (-Y), back depth (+Y), y centre, exponent
SKULL_ROWS = [
    (-0.119, 0.016, 0.030, 0.008, -0.047, 2.0),
    (-0.114, 0.033, 0.050, 0.018, -0.043, 2.1),
    (-0.104, 0.046, 0.061, 0.030, -0.037, 2.2),
    (-0.091, 0.057, 0.068, 0.042, -0.031, 2.3),
    (-0.075, 0.068, 0.072, 0.056, -0.025, 2.3),
    (-0.057, 0.076, 0.077, 0.072, -0.019, 2.3),
    (-0.040, 0.083, 0.082, 0.086, -0.013, 2.3),
    (-0.020, 0.089, 0.088, 0.098, -0.008, 2.25),
    (0.000, 0.093, 0.093, 0.106, -0.004, 2.2),
    (0.020, 0.095, 0.095, 0.111, -0.002, 2.2),
    (0.040, 0.096, 0.094, 0.113, 0.000, 2.2),
    (0.060, 0.096, 0.090, 0.113, 0.002, 2.2),
    (0.080, 0.093, 0.084, 0.109, 0.004, 2.1),
    (0.100, 0.087, 0.075, 0.099, 0.006, 2.0),
    (0.118, 0.074, 0.061, 0.083, 0.008, 2.0),
    (0.132, 0.054, 0.042, 0.059, 0.010, 2.0),
    (0.142, 0.022, 0.016, 0.023, 0.010, 2.0),
]

HEAD_DEFAULT = dict(
    size=1.0,
    jaw=1.0,          # width of the lower face (jaw / cheeks)
    chin=1.0,         # chin length / forward
    cran=1.0,         # cranium volume
    face_len=1.0,     # vertical stretch of the lower face
    cheek=1.0,        # cheek fullness
    cheek_c=(0.044, -0.064, -0.036), cheek_r=(0.031, 0.031, 0.028),
    cheekbone=0.0,    # extra cheekbone volume (0..1)
    jaw_square=0.0,   # squarer jaw corners (0..1)
    brow_c=(0.0, -0.074, 0.030), brow_r=(0.066, 0.028, 0.016),
    nose_len=1.0, nose_w=1.0, nose_tip=1.0, nose_up=0.0,
    eye_r=0.0215, eye_x=0.0405, eye_z=0.008, eye_k=0.64,
    lid_up=31.0, lid_low=29.0, lid_corner=62.0, lid_tilt=0.0, lashes=False,
    brow_thick=1.0, brow_h=1.0, brow_arch=1.0,
    mouth_z=-0.058, mouth_w=0.022, mouth_smile=0.0012, lip=1.0,
    ear_size=1.0,
)


def skull_rows(H):
    rows = []
    for z, hw, fr, bk, cy, ex in SKULL_ROWS:
        low = C.smoothstep(0.0, -0.06, z)          # 0 above the eyes, 1 at the jaw
        top = C.smoothstep(0.0, 0.08, z)
        hw = hw * (1 + (H["jaw"] - 1) * low) * (1 + (H["cran"] - 1) * top)
        bk = bk * (1 + (H["cran"] - 1) * top)
        z2 = z * (1 + (H["face_len"] - 1) * low) if z < 0 else z
        if z < -0.06:
            fr = fr + (H["chin"] - 1) * 0.020 * C.smoothstep(-0.06, -0.10, z)
            cy = cy - (H["chin"] - 1) * 0.010 * C.smoothstep(-0.06, -0.10, z)
        ex = ex + H.get("jaw_square", 0.0) * 0.9 * low
        rows.append((z2, hw, fr, bk, cy, ex))
    return rows


def head_params(spec_head: dict | None) -> dict:
    H = dict(HEAD_DEFAULT)
    H.update(spec_head or {})
    return H


# ------------------------------------------------------------------------------------------------
# SDF
# ------------------------------------------------------------------------------------------------

def head_sdf(H, sockets=True, eyes=None):
    skull = C.sd_loft_z(skull_rows(H))
    cc = np.array(H["cheek_c"]) * np.array((H["jaw"] ** 0.5, 1, 1))
    cr = np.array(H["cheek_r"]) * H["cheek"]
    cheek_l = C.sd_ellipsoid(cc, cr)
    cheek_r = C.sd_ellipsoid(cc * (-1, 1, 1), cr)
    brow = C.sd_ellipsoid(H["brow_c"], H["brow_r"])
    nl, nw, nt, nu = H["nose_len"], H["nose_w"], H["nose_tip"], H["nose_up"]
    tip_y = -0.109 - 0.013 * nl
    bridge = C.sd_ellipsoid((0, -0.094 - 0.005 * nl, -0.006), (0.0085 * nw, 0.013, 0.024))
    tip = C.sd_ellipsoid((0, tip_y, -0.031 + nu * 0.006), (0.0125 * nt * nw, 0.0118 * nt, 0.0112 * nt))
    wing_l = C.sd_sphere((0.0105 * nw, tip_y + 0.012, -0.034 + nu * 0.004), 0.0080 * nt)
    wing_r = C.sd_sphere((-0.0105 * nw, tip_y + 0.012, -0.034 + nu * 0.004), 0.0080 * nt)
    f = C.op_smooth_union(0.020, skull, cheek_l, cheek_r)
    cb = H.get("cheekbone", 0.0)
    if cb > 0:
        cbc = np.array((0.056, -0.058, -0.010))
        cbr = np.array((0.024, 0.022, 0.015)) * (0.8 + 0.4 * cb)
        f = C.op_smooth_union(0.012 + 0.006 * cb, f, C.sd_ellipsoid(cbc, cbr), C.sd_ellipsoid(cbc * (-1, 1, 1), cbr))
    f = C.op_smooth_union(0.016, f, brow)
    nose = C.op_smooth_union(0.007, bridge, tip, wing_l, wing_r)
    f = C.op_smooth_union(0.009, f, nose)
    if H.get("muzzle"):
        m = H["muzzle"]
        muz = C.sd_ellipsoid((0, -0.122 - 0.036 * m, -0.040), (0.036, 0.068 + 0.036 * m, 0.029))
        bridge2 = C.sd_ellipsoid((0, -0.112 - 0.026 * m, -0.012), (0.026, 0.062 + 0.026 * m, 0.021))
        jaw = C.sd_ellipsoid((0, -0.110 - 0.030 * m, -0.066), (0.031, 0.062 + 0.028 * m, 0.017))
        muz = C.op_smooth_union(0.02, muz, bridge2)
        ridge = C.sd_ellipsoid((0, -0.082, 0.030), (0.080, 0.034, 0.022))
        f = C.op_smooth_union(0.022, f, muz, jaw)
        f = C.op_smooth_union(0.018, f, ridge)
    if sockets and eyes is not None:
        r = H["eye_r"] + 0.0019
        s_l = C.sd_sphere(eyes[0], r)
        s_r = C.sd_sphere(eyes[1], r)
        f = C.op_smooth_sub(0.0035, f, s_l)
        f = C.op_smooth_sub(0.0035, f, s_r)
    return f


def eye_centers(H):
    base = head_sdf(H, sockets=False)
    out = []
    for sx in (1, -1):
        d = np.array([[sx * H["eye_x"], -0.10, H["eye_z"]]])
        P, _ = C.radial_project(base, (0, 0, 0), d)
        # the eye looks along -Y: put its centre behind the surface point
        p = P[0]
        c = np.array((sx * H["eye_x"], p[1] + H["eye_k"] * H["eye_r"], H["eye_z"]))
        out.append(c)
    return out


def sample_density(n, lo, hi, bumps=(), endpoint=True, wrap=False):
    """n samples of [lo, hi] with density 1 + sum(gain * gauss((x - c) / w))."""
    xs = np.linspace(lo, hi, 2001)
    dens = np.ones_like(xs)
    for c, w, g in bumps:
        if wrap:
            per = hi - lo
            dd = (xs - c + per / 2) % per - per / 2
        else:
            dd = xs - c
        dens += g * np.exp(-(dd / w) ** 2)
    cdf = np.concatenate([[0], np.cumsum((dens[1:] + dens[:-1]) * 0.5 * np.diff(xs))])
    cdf /= cdf[-1]
    q = np.linspace(0, 1, n, endpoint=endpoint)
    return np.interp(q, cdf, xs)


def head_dirs(n_phi=30, n_theta=22):
    phis = sample_density(n_phi, -math.pi, math.pi, [(0.0, 0.75, 1.2), (0.0, 0.22, 2.6)], endpoint=False, wrap=True)
    thetas = sample_density(n_theta, math.radians(8), THETA_MAX,
                            [(math.radians(92), math.radians(26), 1.0), (math.radians(101), math.radians(7), 1.8)])
    T, P = np.meshgrid(thetas, phis, indexing="ij")
    D = np.stack([np.sin(T) * np.sin(P), -np.sin(T) * np.cos(P), np.cos(T)], axis=-1)
    return D, thetas, phis


def build_head_mesh(H, f, n_phi=30, n_theta=22):
    D, thetas, phis = head_dirs(n_phi, n_theta)
    R, Cn = D.shape[:2]
    P, t = C.radial_project(f, (0, 0, 0), D.reshape(-1, 3), tmax=0.3)
    P = P.reshape(R, Cn, 3)
    uu = (phis + math.pi) / C.TAU
    vv = 1.0 - thetas / THETA_MAX
    uv = np.stack(np.meshgrid(uu, vv), axis=-1)
    top = C.radial_project(f, (0, 0, 0), np.array([[0, 0, 1.0]]))[0][0]
    bottom = np.array((0.0, 0.0, -0.05))
    # rows run top -> bottom; rings ccw seen from below are clockwise seen from top. Orientation is
    # fixed afterwards by orient_outward().
    V, F, UV = C.grid(P, wrap_u=True, uv=uv, cap_start=tuple(top), cap_end=tuple(bottom))
    # pole uvs: fix to sensible values
    return V, F, UV


def orient_outward(part, center_fn):
    """Flip all faces if most face normals point towards center_fn(face_centroids)."""
    V = part.V
    votes = 0
    for f in part.F:
        p = V[list(f)]
        c = p.mean(axis=0)
        n = np.cross(p[1] - p[0], p[2] - p[0])
        ref = center_fn(c[None, :])[0]
        votes += 1 if np.dot(n, c - ref) > 0 else -1
    if votes < 0:
        part.F = [tuple(reversed(f)) for f in part.F]
        if part.UV is not None:
            part.UV = [list(reversed(u)) for u in part.UV]
    return part


def nearest_on_polyline(pts):
    pts = np.asarray(pts, dtype=np.float64)

    def fn(X):
        best = np.full(len(X), np.inf)
        out = np.zeros_like(X)
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            ab = b - a
            l2 = max(np.dot(ab, ab), 1e-12)
            t = np.clip(((X - a) @ ab) / l2, 0, 1)
            q = a + t[:, None] * ab
            d = np.linalg.norm(X - q, axis=1)
            m = d < best
            best = np.where(m, d, best)
            out[m] = q[m]
        return out
    return fn


# ------------------------------------------------------------------------------------------------
# eyes and lids
# ------------------------------------------------------------------------------------------------

def eyeball(center, r, n_around=12):
    """Sphere with its pole looking -Y; uv = polar mapping of the iris disc."""
    gam = np.radians([8, 18, 28, 38, 50, 66, 88, 112])
    psi = np.arange(n_around) / n_around * C.TAU
    rings = []
    uvs = []
    for g in gam:
        x = np.sin(g) * np.cos(psi)
        z = np.sin(g) * np.sin(psi)
        y = -np.cos(g) * np.ones_like(psi)
        rings.append(np.stack([x, y, z], 1) * r + center)
        rho = min(g / math.radians(140.0), 0.5)
        uvs.append(np.stack([0.5 + rho * np.cos(psi), 0.5 + rho * np.sin(psi)], 1))
    P = np.stack(rings)
    uv = np.stack(uvs)
    front = center + np.array((0, -r, 0))
    back = center + np.array((0, r * 0.5, 0))
    V, F, UV = C.grid(P, wrap_u=True, uv=uv, cap_start=tuple(front), cap_end=tuple(back))
    # the grid helper gives wrapped seam corners u+1: undo for the polar mapping (u is not periodic)
    UV = [[(u if u <= 1.0 else u - 1.0, v) for (u, v) in fu] for fu in UV]
    # recompute per-corner uv from geometry to avoid seam artefacts
    UV = []
    for fc in F:
        cu = []
        for i in fc:
            p = V[i] - center
            g = math.acos(max(-1.0, min(1.0, -p[1] / r)))
            ang = math.atan2(p[2], p[0])
            rho = min(g / math.radians(140.0), 0.5)
            cu.append((0.5 + rho * math.cos(ang), 0.5 + rho * math.sin(ang)))
        UV.append(cu)
    part = C.Part("eye", V, F, UV, region="eye", mat=1)
    orient_outward(part, lambda X: np.repeat(np.asarray(center)[None, :], len(X), 0))
    return part


def lid_edges(H, beta, state):
    """Edge angles (deg) of the upper and lower lid for column angles beta (deg, + = outer side)."""
    bc = H["lid_corner"]
    tilt = H["lid_tilt"]
    b = np.asarray(beta, dtype=np.float64)
    # almond: peak of the upper lid slightly towards the inner side
    xu = np.clip((b + 8.0) / (bc + 8.0 * np.sign(b + 8.0) + 1e-9), -1, 1)
    xl = np.clip((b - 6.0) / (bc - 6.0 * np.sign(b - 6.0) + 1e-9), -1, 1)
    pu = np.cos(xu * math.pi / 2) ** 0.75
    pl = np.cos(xl * math.pi / 2) ** 0.9
    up_open = H["lid_up"] * pu + tilt * (b / bc) - 2.0 * (1 - pu)
    lo_open = -H["lid_low"] * pl + tilt * 0.4 * (b / bc) + 2.0 * (1 - pl)
    outside = np.abs(b) > bc
    up_open = np.where(outside, -2.0 + tilt * np.sign(b), up_open)
    lo_open = np.where(outside, 2.0 + tilt * 0.4 * np.sign(b), lo_open)
    lo_blink = lo_open * 0.62
    up_blink = lo_blink - 5.0
    if state == "open":
        return up_open, lo_open
    if state == "blink":
        return up_blink, lo_blink
    if state == "half":
        return up_open + (up_blink - up_open) * 0.70, lo_open + (lo_blink - lo_open) * 0.75
    if state == "smile":
        return up_open - 0.10 * (up_open - up_blink), lo_open + 0.38 * (lo_blink - lo_open)
    if state == "worried":
        # outer part of the upper lid drops a little, inner part opens
        k = np.clip(b / bc, -1, 1)
        return up_open - 4.0 * np.clip(k, 0, 1) + 2.0 * np.clip(-k, 0, 1), lo_open
    raise ValueError(state)


def lid_shells(H, center, side=1, n_cols=10, n_rows=5):
    """Upper and lower lids of the LEFT eye (side=1) or right eye (mirrored angles) as one Part with
    morphs Blink / EyesHalf / Smile / Worried."""
    r = H["eye_r"]
    betas = np.concatenate([np.linspace(-110, -66, 3)[:-1], np.linspace(-66, 66, n_cols - 4), np.linspace(66, 110, 3)[1:]])
    rows_t = (np.arange(n_rows) / (n_rows - 1)) ** 1.15
    top = H.get("lid_top", 78.0)

    def shell(state):
        up, lo = lid_edges(H, betas, state)
        pts_u, pts_l = [], []
        for i, t in enumerate(rows_t):
            au = up + (top - up) * t
            al = lo + (-top - lo) * t
            # rim: the edge row stands proud of the shell (lid thickness)
            rr = r + (0.0022 if i == 0 else 0.0016 if i == 1 else 0.0013)
            pts_u.append(_sph(center, rr, au, betas * side))
            pts_l.append(_sph(center, rr, al, betas * side))
        return np.stack(pts_u), np.stack(pts_l)

    base_u, base_l = shell("open")
    # lash flick on the upper lid outer corner
    if H.get("lashes"):
        k = np.clip((betas - 30.0) / 50.0, 0, 1) ** 1.5
        for arr in (base_u,):
            off = (arr[0] - center)
            arr[0] = arr[0] + C.normalize(off) * (0.0016 * k)[:, None] + np.array((side * 0.0012, 0.0, 0.0008)) * k[:, None]
    # inner rim rows: tuck the lid edge into the eyeball direction so the edge looks thick
    uv_rows = np.array([0.02, 0.22, 0.45, 0.7, 0.95])
    uu = (betas - betas.min()) / (betas.max() - betas.min())
    uv_u = np.stack(np.meshgrid(uu * 0.48, uv_rows[:n_rows]), axis=-1)
    uv_l = np.stack(np.meshgrid(0.52 + uu * 0.48, uv_rows[:n_rows]), axis=-1)
    Vu, Fu, UVu = C.grid(base_u, wrap_u=False, uv=uv_u)
    Vl, Fl, UVl = C.grid(base_l, wrap_u=False, uv=uv_l)
    pu = C.Part("lid_u", Vu, Fu, UVu, region="lid")
    pl = C.Part("lid_l", Vl, Fl, UVl, region="lid")
    part = C.merge_parts([pu, pl], "lids", region="lid")
    ctr = np.asarray(center)
    orient_outward(part, lambda X: np.repeat(ctr[None, :], len(X), 0))
    nu = base_u.reshape(-1, 3).shape[0]
    for name, state in (("Blink", "blink"), ("EyesHalf", "half"), ("Smile", "smile"), ("Worried", "worried")):
        su, sl = shell(state)
        if H.get("lashes"):
            k = np.clip((betas - 30.0) / 50.0, 0, 1) ** 1.5
            off = su[0] - center
            su[0] = su[0] + C.normalize(off) * (0.0016 * k)[:, None] + np.array((side * 0.0012, 0.0, 0.0008)) * k[:, None]
        new = np.concatenate([su.reshape(-1, 3), sl.reshape(-1, 3)])
        part.morphs[name] = new - part.V
    return part


def _sph(center, r, alpha_deg, beta_deg):
    a = np.radians(np.asarray(alpha_deg, dtype=np.float64))
    b = np.radians(np.asarray(beta_deg, dtype=np.float64))
    d = np.stack([np.cos(a) * np.sin(b), -np.cos(a) * np.cos(b), np.sin(a)], axis=-1)
    return np.asarray(center) + d * r


# ------------------------------------------------------------------------------------------------
# brows, mouth, ears
# ------------------------------------------------------------------------------------------------

def surface_offset_points(f, pts, offset, center=(0, 0, 0)):
    P, _ = C.radial_project(f, center, np.asarray(pts) - np.asarray(center))
    n = C.sdf_gradient(f, P)
    return P + n * offset, n


def brow(H, f, eye_c, side=1, color="hair"):
    """Brow of the left eye (side=1) - a flattened tube conforming to the face."""
    r = (H["eye_r"] + 0.0135) * H.get("brow_h", 1.0)
    betas = np.linspace(-44, 60, 7)
    arch = H.get("brow_arch", 1.0)
    alphas = 47.0 + 7.0 * arch * np.cos(np.radians((betas - 15) * 1.25)) - 4.0
    ang = H.get("brow_angry", 0.0)
    alphas = alphas - ang * C.smoothstep(30, -40, betas)
    guide = _sph(eye_c, r, alphas, betas * side)

    def build(alpha_shift_fn=None, extra=None):
        al = alphas.copy()
        if alpha_shift_fn is not None:
            al = al + alpha_shift_fn(betas)
        g = _sph(eye_c, r, al, betas * side)
        P, n = surface_offset_points(f, g, 0.0014)
        return P, n

    P0, N0 = build()
    th = H.get("brow_thick", 1.0)
    tt = np.linspace(0, 1, len(betas))
    w = (0.0042 + 0.0014 * np.sin(np.clip(tt * 1.6, 0, math.pi)) - 0.0034 * C.smoothstep(0.55, 1.0, tt)) * th
    w = np.maximum(w, 0.0012)
    h = 0.0022 * th * (0.6 + 0.4 * w / w.max())
    nr = 6

    def rings_from(P, N):
        T = np.gradient(P, axis=0)
        T = C.normalize(T)
        rings = []
        for i in range(len(P)):
            nrm = N[i]
            up = C.normalize(np.cross(nrm, T[i]))
            if up[2] < 0:
                up = -up
            ang = np.arange(nr) / nr * C.TAU
            pts = P[i] + np.cos(ang)[:, None] * up * w[i] + np.sin(ang)[:, None] * nrm * h[i] + nrm * h[i] * 0.6
            rings.append(pts)
        return np.stack(rings)

    R0 = rings_from(P0, N0)
    V, F, UV = C.grid(R0, wrap_u=True, cap_start="pole", cap_end="pole")
    part = C.Part("brow", V, F, UV, color=color)
    part.color = color
    orient_outward(part, nearest_on_polyline(P0))
    shifts = {
        "Worried": lambda b: 13.0 * C.smoothstep(40, -40, b) - 3.0 * C.smoothstep(20, 60, b),
        "Smile": lambda b: 4.0 + 1.5 * C.smoothstep(-20, 50, b),
        "Blink": lambda b: -2.5 + 0 * b,
        "MouthOpen": lambda b: 2.0 + 0 * b,
    }
    for name, fn in shifts.items():
        P1, N1 = build(fn)
        R1 = rings_from(P1, N1)
        V1, _, _ = C.grid(R1, wrap_u=True, cap_start="pole", cap_end="pole")
        part.morphs[name] = V1 - V
    return part


def mouth(H, f, n_ang=14):
    """Modelled mouth: dark interior disc (teeth/tongue painted) framed by an upper and a lower lip
    (flattened tubes along the outline, conforming to the face). Morphs: MouthOpen, Smile, Worried."""
    hw = H["mouth_w"]
    mz = H["mouth_z"]
    lk = H.get("lip", 1.0)
    rings_t = np.array([0.0, 0.6, 1.0])
    psi = np.arange(n_ang) / n_ang * C.TAU
    npath = 8

    def outline(open_h, width_k, corner_up, t, angles):
        x = np.cos(angles) * hw * width_k * t
        xn = np.clip(np.abs(x) / (hw * width_k), 0, 1)
        hh = open_h * np.sqrt(np.clip(1 - xn ** 2.2, 0, 1)) + 0.0007
        y = np.sin(angles) * hh * t
        y = np.where(np.sin(angles) > 0, y * 0.45, y)
        z = mz + y + corner_up * xn ** 2
        return np.stack([x, np.full_like(x, -0.2), z], 1)

    def project(P, off):
        dirs = P.reshape(-1, 3).copy()
        dirs[:, 1] = -0.11
        Pp, n = surface_offset_points(f, dirs, off)
        return Pp.reshape(P.shape), n.reshape(P.shape)

    def build(open_h, width_k, corner_up):
        disc = np.stack([outline(open_h, width_k, corner_up, t, psi) for t in rings_t])
        D, _ = project(disc, 0.0009)
        lips = []
        for upper in (True, False):
            ang = np.linspace(0.0, math.pi, npath) if upper else np.linspace(math.pi, C.TAU, npath)
            O = outline(open_h, width_k, corner_up, 1.0, ang)
            Pp, N = project(O, 0.0012)
            T = C.normalize(np.gradient(Pp, axis=0))
            k = np.sin(np.linspace(0, math.pi, npath)) ** 0.7
            r = ((0.0016 if upper else 0.0022) * k + 0.0005) * lk
            rings = []
            a = np.arange(5) / 5 * C.TAU
            for i in range(npath):
                side = C.normalize(np.cross(N[i], T[i]))
                if (side[2] < 0) == upper:
                    side = -side
                c = Pp[i] + side * r[i] * 0.75 + N[i] * r[i] * 0.35
                rings.append(c + np.cos(a)[:, None] * side * r[i] * 1.15 + np.sin(a)[:, None] * N[i] * r[i] * 0.9)
            lips.append(np.stack(rings))
        return D, lips

    D0, L0 = build(0.0, 1.0, H["mouth_smile"])
    uv = np.stack([[0.5 + 0.5 * t * np.cos(psi), 0.5 + 0.5 * t * np.sin(psi)] for t in rings_t], 0).transpose(0, 2, 1)
    V, F, UV = C.grid(D0[1:], wrap_u=True, uv=uv[1:], cap_start=tuple(D0[0].mean(axis=0)))
    inner = C.Part("mouth", V, F, None, region="mouth")
    inner.UV = _polar_uv_from_rings(F, len(psi), len(rings_t) - 1, rings_t[1:], psi)
    orient_outward(inner, lambda X: np.zeros_like(X))
    lip_parts = []
    for L in L0:
        Vl, Fl, UVl = C.grid(L, wrap_u=True, cap_start="pole", cap_end="pole")
        lp = C.Part("lip", Vl, Fl, UVl, color="lip")
        orient_outward(lp, nearest_on_polyline(L.mean(axis=1)))
        lip_parts.append(lp)
    states = {
        "MouthOpen": (0.0115, 0.90, H["mouth_smile"] * 0.4),
        "Smile": (0.0030, 1.16, 0.0058),
        "Worried": (0.0008, 0.86, -0.0030),
    }
    for name, (oh, wk, cu) in states.items():
        D1, L1 = build(oh, wk, cu)
        inner.morphs[name] = np.concatenate([D1[1:].reshape(-1, 3), D1[0].mean(axis=0)[None, :]]) - inner.V
        for lp, L in zip(lip_parts, L1):
            Vn, _, _ = C.grid(L, wrap_u=True, cap_start="pole", cap_end="pole")
            lp.morphs[name] = np.asarray(Vn) - lp.V
    return inner, lip_parts


def _polar_uv_from_rings(F, n_ang, n_rings, ts, psi):
    UV = []
    n_grid = n_ang * n_rings
    for fc in F:
        cu = []
        for i in fc:
            if i >= n_grid:
                cu.append((0.5, 0.5))
            else:
                r, a = divmod(i, n_ang)
                t = ts[r]
                cu.append((0.5 + 0.5 * t * math.cos(psi[a]), 0.5 + 0.5 * t * math.sin(psi[a])))
        UV.append(cu)
    return UV


def ear(H, side=1, color="skin", f=None):
    s = H.get("ear_size", 1.0)
    prof = [(0.0, -0.0035), (0.70, -0.0045), (1.0, 0.000), (0.93, 0.0042), (0.68, 0.0030),
            (0.0, -0.0012)]
    V, F, UV = C.lathe(prof, n=10, sx=0.0215 * s, sy=0.0315 * s, cap_bottom="pole", cap_top="pole")
    # lathe gives a disc in XY with thickness along Z. Orient: disc normal -> outward/back, long axis -> up
    V = np.asarray(V)
    # local: x across (front-back), y along (up), z normal
    M = np.array(((0, 0, 1), (1, 0, 0), (0, 1, 0)), dtype=np.float64)  # (x,y,z)->(z?,..)
    # build basis: normal n, up u, across a
    n = C.normalize(np.array((side * 1.0, 0.30, 0.0)))
    u = C.normalize(np.array((0.0, 0.18, 1.0)))
    a = C.normalize(np.cross(u, n))
    B = np.stack([a, u, n], axis=1)  # columns
    W = V @ B.T
    # cup it a little: push the rim backwards
    rr = np.sqrt((V[:, 0] / (0.0215 * s)) ** 2 + (V[:, 1] / (0.0315 * s)) ** 2)
    W = W + np.outer(rr ** 2 * 0.004 * s, np.array((side * 0.6, 0.6, 0.0)))
    c = np.array((side * 0.084, 0.004, -0.006))
    if f is not None:
        P, _ = C.radial_project(f, (0, 0, -0.006), np.array([[side * 1.0, 0.12, 0.0]]))
        c = P[0] - np.array((side * 0.0035, 0.0, 0.0))
    part = C.Part("ear", W + c, F, UV, color=color)
    orient_outward(part, lambda X: np.repeat((c - n * 0.02)[None, :], len(X), 0))
    return part


# ------------------------------------------------------------------------------------------------
# full head
# ------------------------------------------------------------------------------------------------

def jaw_drop(V, H, amount=0.0055):
    """Morph delta that lowers the chin region (used by MouthOpen on head, beard, mouth)."""
    mz = H["mouth_z"]
    z = V[:, 2]
    y = V[:, 1]
    w = C.smoothstep(mz + 0.004, mz - 0.03, z) * C.smoothstep(0.03, -0.06, y)
    d = np.zeros_like(V)
    d[:, 2] = -amount * w
    d[:, 1] = amount * 0.25 * w
    return d


def cheek_raise(V, H, amount=0.0034):
    mz = H["mouth_z"]
    cx = H["cheek_c"][0]
    d = np.zeros_like(V)
    for sx in (1, -1):
        p = np.array((sx * cx * 1.05, -0.08, mz + 0.030))
        r = np.linalg.norm(V - p, axis=1)
        w = np.exp(-(r / 0.024) ** 2)
        d[:, 2] += amount * w
        d[:, 1] -= amount * 0.7 * w
        d[:, 0] += sx * amount * 0.35 * w
        # mouth corners pull up/out
        pc = np.array((sx * H["mouth_w"] * 1.0, -0.09, mz))
        rc = np.linalg.norm(V - pc, axis=1)
        wc = np.exp(-(rc / 0.012) ** 2)
        d[:, 2] += 0.0030 * wc
        d[:, 0] += sx * 0.0015 * wc
    return d


def build_head(H, skin_color="skin", n_phi=30, n_theta=22):
    """Returns dict of head-local parts + design data."""
    eyes = eye_centers(H)
    f = head_sdf(H, sockets=True, eyes=eyes)
    f_plain = head_sdf(H, sockets=False)
    V, F, UV = build_head_mesh(H, f, n_phi, n_theta)
    head = C.Part("head", V, F, UV, region="face")
    orient_outward(head, lambda X: np.zeros_like(X))
    head.morphs["MouthOpen"] = jaw_drop(head.V, H)
    head.morphs["Smile"] = cheek_raise(head.V, H)
    parts = {"head": head}
    parts["eye_l"] = eyeball(eyes[0], H["eye_r"])
    parts["eye_r"] = eyeball(eyes[1], H["eye_r"])
    lid_l = lid_shells(H, eyes[0], side=1)
    lid_r = lid_shells(H, eyes[1], side=-1)
    parts["lids"] = C.merge_parts([lid_l, lid_r], "lids", region="lid")
    parts["lids"].morphs = {k: np.concatenate([lid_l.morphs[k], lid_r.morphs[k]]) for k in lid_l.morphs}
    bl = brow(H, f_plain, eyes[0], 1)
    br = brow(H, f_plain, eyes[1], -1)
    parts["brows"] = C.merge_parts([bl, br], "brows", color="brow")
    parts["brows"].morphs = {k: np.concatenate([bl.morphs[k], br.morphs[k]]) for k in bl.morphs}
    m, lips = mouth(H, f_plain)
    m.morphs["MouthOpen"] = m.morphs["MouthOpen"] + jaw_drop(m.V + m.morphs["MouthOpen"], H) * 0.6
    parts["mouth"] = m
    for lp, upper in zip(lips, (True, False)):
        if not upper:
            lp.morphs["MouthOpen"] = lp.morphs["MouthOpen"] + jaw_drop(lp.V + lp.morphs["MouthOpen"], H) * 0.8
    lip_all = C.merge_parts(lips, "lips", color="lip")
    lip_all.morphs = {k: np.concatenate([lips[0].morphs[k], lips[1].morphs[k]]) for k in lips[0].morphs}
    parts["lips"] = lip_all
    parts["ear_l"] = ear(H, 1, color="ear", f=f_plain)
    parts["ear_r"] = ear(H, -1, color="ear", f=f_plain)
    return parts, dict(f=f, f_plain=f_plain, eyes=eyes)


def wolf_ear(H, side=1, color="fur"):
    """Pointed wolf ear (flattened cone) on top-side of the head."""
    prof = [(0.0, 0.0), (1.0, 0.0), (0.82, 0.35), (0.45, 0.75), (0.0, 1.0)]
    V, F, UV = C.lathe(prof, n=8, sx=0.042, sy=0.017, cap_bottom="pole", cap_top="pole")
    V = np.asarray(V)
    V[:, 2] *= 0.135
    # concave front: push the front face back
    V[:, 1] = np.where(V[:, 1] < 0, V[:, 1] * 0.4, V[:, 1])
    R = C.rot_y(math.radians(-side * 12)) @ C.rot_x(math.radians(4))
    V = V @ R.T + np.array((side * 0.054, 0.022, 0.110))
    part = C.Part("wolf_ear", V, F, UV, color=color)
    c = np.array((side * 0.062, 0.030, 0.13))
    orient_outward(part, lambda X: np.stack([np.full(len(X), c[0]), np.full(len(X), c[1]), X[:, 2]], 1))
    return part


def wolf_nose(H, f, color="nose"):
    m = H.get("muzzle", 1.0)
    tip = C.radial_project(f, (0, 0, -0.03), np.array([[0, -1.0, 0.15]]))[0][0]
    V, F, UV = C.lathe([(0.0, -1.0), (0.8, -0.6), (1.0, 0.0), (0.8, 0.6), (0.0, 1.0)], n=10)
    V = np.asarray(V) * np.array((0.020, 0.014, 0.013)) + tip + np.array((0, -0.002, 0.002))
    part = C.Part("wolf_nose", V, F, UV, color=color)
    orient_outward(part, lambda X: np.repeat(tip[None, :], len(X), 0))
    return part


def wolf_fangs(H, f, color="claw"):
    parts = []
    mz = H["mouth_z"]
    for sx in (1, -1):
        d = np.array([[sx * 0.016, -0.11, mz + 0.004]])
        P, _ = C.radial_project(f, (0, 0, mz + 0.004), np.array([[sx * 0.30, -1.0, 0.0]]))
        base = P[0] + np.array((0, 0.003, 0.002))
        tip = base + np.array((sx * 0.001, -0.002, -0.016))
        pts = [base + np.array((0, 0, 0.004)), base, base + (tip - base) * 0.5]
        V, F, UV = C.tube(np.array(pts), [0.0040, 0.0038, 0.0024], n=5, up_hint=(0, -1, 0), cap_start="pole", cap_end=tuple(tip))
        fp = C.Part("fang", V, F, UV, color=color)
        orient_outward(fp, nearest_on_polyline(pts + [tip]))
        parts.append(fp)
    return parts
