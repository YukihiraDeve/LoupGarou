"""Loup-Garou characters: body and garments (torso, sleeves, hands, trousers / bare legs, shoes, neck).

Garments ARE the body: no skin is modelled under clothes. Every piece is a closed loft (caps hidden
inside other pieces), so nothing shows its inside, even in first person with the head scaled to 0.
All coordinates in armature space (scale 1), built from the joint layout of lg_skeleton.layout().
"""
from __future__ import annotations

import math

import numpy as np

import lg_core as C
import lg_skin as S
from lg_head import orient_outward, nearest_on_polyline


def _metric(part, circ, length):
    part.tags["uv_scale"] = (circ, length)
    return part


def ring_perimeter(ring):
    return float(np.linalg.norm(np.roll(ring, -1, axis=0) - ring, axis=1).sum())


# ------------------------------------------------------------------------------------------------
# torso
# ------------------------------------------------------------------------------------------------

def torso_profile(J, body):
    """Rows (z, half width a, front depth f, back depth b, exponent p, y centre)."""
    hip = J["thigh_l"]["head"][2]
    s1 = J["spine_01"]["head"][2]
    s2 = J["spine_02"]["head"][2]
    s3 = J["spine_03"]["head"][2]
    nk = J["neck_01"]["head"][2]
    sh = J["upperarm_l"]["head"]
    shx = sh[0]
    shz = sh[2]
    w = body.get("width", 1.0)
    chest = body.get("chest", 1.0)
    belly = body.get("belly", 0.0)
    bust = body.get("bust", 0.0)
    hips = body.get("hips", 1.0)
    rows = [
        # z, a, f, b, p, y
        (hip - 0.065, 0.164 * hips, 0.110, 0.120, 2.4, 0.016),
        (hip - 0.02, 0.165 * hips, 0.106 + belly * 0.02, 0.118, 2.4, 0.016),
        (s1 + 0.01, (0.153 + 0.012 * belly) * (0.5 + 0.5 * hips), 0.100 + belly * 0.050, 0.100, 2.5, 0.018),
        ((s1 + s2) / 2 + 0.01, 0.154 + 0.012 * belly, 0.102 + belly * 0.060, 0.096, 2.5, 0.018),
        (s2 + 0.03, 0.160 * chest + 0.008 * belly, 0.106 + belly * 0.045 + bust * 0.004, 0.096, 2.5, 0.016),
        (s3 - 0.01, 0.170 * chest, 0.112 + belly * 0.02 + bust * 0.024, 0.098, 2.5, 0.014),
        (s3 + 0.06, 0.177 * chest, 0.112 + bust * 0.018, 0.101, 2.4, 0.016),
        (shz - 0.045, max(0.180 * chest, shx + 0.012), 0.103, 0.100, 2.3, 0.020),
        (shz - 0.005, shx + 0.024, 0.090, 0.092, 2.2, 0.024),
        (shz + 0.028, shx + 0.016, 0.076, 0.082, 2.2, 0.026),
        (shz + 0.052, shx * 0.80, 0.064, 0.070, 2.1, 0.026),
        (nk + 0.035, 0.078, 0.056, 0.058, 2.0, 0.024),
    ]
    out = []
    for z, a, f, b, p, y in rows:
        out.append((z, a * w, f * w, b * w, p, y))
    return out


def torso_rings(J, body, n=26, loose=0.0, front_open=False):
    rows = torso_profile(J, body)
    rings = []
    zs = []
    for z, a, f, b, p, y in rows:
        a += loose
        f += loose
        b += loose
        t = np.arange(n) / n * C.TAU  # 0 = +x (left), pi/2 = +y (back)
        c, s = np.cos(t), np.sin(t)
        e = 2.0 / p
        x = np.sign(c) * np.abs(c) ** e * a
        depth = np.where(s > 0, b, f)
        yy = np.sign(s) * np.abs(s) ** e * depth + y
        rings.append(np.stack([x, yy, np.full(n, z)], axis=1))
        zs.append(z)
    return np.stack(rings), np.array(zs)


def torso_part(J, body, garment, n=24):
    """Main torso garment (shirt / sweater / hoodie / jacket ...)."""
    loose = garment.get("loose", 0.0)
    R, zs = torso_rings(J, body, n=n, loose=loose)
    # hem: extend down / tuck inward to show thickness
    hem_drop = garment.get("hem", 0.0)
    R[0, :, 2] -= hem_drop
    jag = garment.get("jag", 0.0)
    if jag:
        t = np.arange(n) / n
        zz = jag * (np.abs(((t * 9.0 + 0.3 * np.sin(t * 31)) % 1.0) - 0.5) * 2.0)
        R[0, :, 2] -= zz
        R[1, :, 2] -= zz * 0.35
    # puffer segments
    if garment.get("puffs"):
        k = garment["puffs"]
        R = _puff(R, zs, k)
    inner = R[0].copy()
    ctr = inner.mean(axis=0)
    inner = ctr + (inner - ctr) * 0.90
    inner[:, 2] += 0.012
    P = np.concatenate([inner[None], R], axis=0)
    circ = ring_perimeter(R[len(R) // 2])
    length = float(zs[-1] - zs[0]) + 0.05
    uu = np.arange(n) / n
    vv = np.concatenate([[0.0], (P[1:, 0, 2] - P[1, 0, 2]) / length + 0.01])
    uv = np.stack(np.meshgrid(uu, vv), axis=-1)
    V, F, UV = C.grid(P, wrap_u=True, uv=uv, cap_start="pole", cap_end="pole")
    part = C.Part("torso", V, F, UV, region=garment.get("region", "top"))
    _metric(part, circ, length)
    axis = np.array([[0, 0.02, zs[0] - 0.2], [0, 0.02, zs[-1] + 0.2]])
    orient_outward(part, nearest_on_polyline(axis))
    part.weights = S.torso_weights(part.V, J)
    return part


def _puff(R, zs, k):
    """Horizontal quilted puffs: modulate the radius between seams."""
    out = R.copy()
    ctr = R.mean(axis=1, keepdims=True)
    z0, z1 = zs[1], zs[-3]
    zz = R[:, :, 2]
    ph = (zz - z0) / (z1 - z0) * k
    bump = 0.010 * np.abs(np.sin(ph * math.pi)) ** 0.7
    mask = (zz > z0 - 0.01) & (zz < z1 + 0.01)
    d = R - ctr
    dn = C.normalize(d * np.array((1, 1, 0)))
    out = R + dn * (bump * mask)[..., None]
    return out


def collar_part(J, body, style="shirt", color=None, region=None, n=16):
    """Collar band around the neck base: 'shirt' (folded points), 'crew' (rolled rib), 'high' (zip collar),
    'shawl' (big knit collar)."""
    nk = J["neck_01"]["head"]
    rows = torso_profile(J, body)
    zt, a, f, b, p, y = rows[-1]
    t = np.arange(n) / n * C.TAU
    c, s = np.cos(t), np.sin(t)
    base_r = np.where(s > 0, 0.060, 0.058)
    if style == "crew":
        prof = [(0.000, 1.00), (0.010, 1.08), (0.020, 1.06), (0.026, 0.96), (0.022, 0.86)]
    elif style == "high":
        prof = [(0.000, 1.02), (0.030, 0.98), (0.060, 0.93), (0.066, 0.88), (0.060, 0.84)]
    elif style == "shawl":
        prof = [(-0.020, 1.30), (0.010, 1.32), (0.035, 1.18), (0.045, 1.00), (0.035, 0.90)]
    else:  # shirt
        prof = [(0.000, 1.00), (0.032, 1.00), (0.042, 1.06), (0.030, 1.24), (0.010, 1.30)]
    rings = []
    for dz, k in prof:
        r = base_r * k
        z = zt - 0.012 + dz
        # front lower than back (collar follows the neck slope)
        zf = z - 0.020 * np.clip(-s, 0, 1) ** 2
        if style == "shirt":
            # front opening: the two points flare forward and down
            zf = zf - 0.018 * np.exp(-((t - 1.5 * math.pi) / 0.35) ** 2) * (dz > 0.02)
        rings.append(np.stack([c * r * 1.05, s * r + y + 0.002, zf], axis=1))
    P = np.stack(rings)
    V, F, UV = C.grid(P, wrap_u=True, cap_end="pole")
    part = C.Part("collar", V, F, UV, region=region, color=color)
    orient_outward(part, lambda X: np.repeat(np.array([[0, y, zt - 0.1]]), len(X), 0))
    part.weights = S.add_weights(S.scale_weights(S.neck_weights(part.V, J), 0.5),
                                 S.scale_weights(S.torso_weights(part.V, J, arm_blend=False), 0.5))
    return part


def hood_part(J, body, color=None, region=None):
    """Hood lying on the upper back behind the neck (hoodies)."""
    nk = J["neck_01"]["head"]
    sh = J["upperarm_l"]["head"]
    c = np.array((0.0, nk[1] + 0.085, nk[2] - 0.005))
    prof = [(0.0, 0.0), (0.040, 0.010), (0.075, 0.030), (0.095, 0.060), (0.100, 0.085), (0.085, 0.100), (0.05, 0.108), (0.0, 0.11)]
    V, F, UV = C.lathe(prof, n=16, sx=1.25, sy=0.55, cap_top="pole", cap_bottom="pole")
    V = np.asarray(V)
    # lathe axis Z -> tilt so the hood lies back
    M = C.rot_x(math.radians(-58))
    V = V @ M.T + c - np.array((0, 0, 0.045))
    part = C.Part("hood", V, F, UV, region=region, color=color)
    orient_outward(part, lambda X: np.repeat(c[None, :], len(X), 0))
    part.weights = S.torso_weights(part.V, J, arm_blend=False)
    return part


# ------------------------------------------------------------------------------------------------
# arms
# ------------------------------------------------------------------------------------------------

def sleeve_part(J, s, garment, n=10, bare=False, body=None):
    """Sleeve of the left arm (s='l'); right arm = mirrored by the caller."""
    sh = J[f"upperarm_{s}"]["head"]
    el = J[f"lowerarm_{s}"]["head"]
    wr = J[f"hand_{s}"]["head"]
    d1 = C.normalize(el - sh)
    d2 = C.normalize(wr - el)
    body = body or {}
    arm_k = body.get("arm_thick", 1.0)
    length = garment.get("sleeve", "long")  # long | short | rolled | none
    r0 = 0.051 * arm_k + garment.get("loose", 0.0)
    pts = [sh - d1 * 0.05, sh + d1 * 0.02, sh + d1 * 0.10, sh + d1 * 0.19, el - d1 * 0.03, el + d2 * 0.03,
           el + d2 * 0.10, el + d2 * 0.18, wr - d2 * 0.025]
    radii = [r0 * 0.70, r0 * 0.93, r0 * 0.95, r0 * 0.86, r0 * 0.79, r0 * 0.77, r0 * 0.74, r0 * 0.66, r0 * 0.60]
    if bare:
        radii = [r * 0.82 for r in radii]
    if length == "short":
        pts = pts[:5]
        radii = radii[:4] + [radii[3] * 1.02]
    elif length == "rolled":
        pts = pts[:7]
        radii = radii[:6] + [radii[5] * 1.0]
    end = pts[-1]
    dirn = C.normalize(pts[-1] - pts[-2])
    cuff = garment.get("cuff", 0.0)
    # cuff lip and inner tuck
    if length in ("long", "rolled", "short") and not bare:
        rl = radii[-1]
        if length == "rolled":
            # rolled band: a fat torus-like lip
            pts += [end + dirn * 0.012, end + dirn * 0.03, end + dirn * 0.034, end + dirn * 0.02]
            radii += [rl * 1.18, rl * 1.17, rl * 1.05, rl * 0.70]
        else:
            pts += [end + dirn * 0.012, end + dirn * (0.022 + cuff), end + dirn * (0.026 + cuff), end + dirn * (0.012 + cuff)]
            radii += [rl * (1.0 + cuff * 2), rl * (1.02 + cuff * 2), rl * 0.92, rl * 0.70]
    V, F, UV = C.tube(np.array(pts), radii, n=n, up_hint=np.array((0, -1.0, 0)), cap_start="pole", cap_end="pole")
    jag = garment.get("jag", 0.0)
    if jag:
        # torn sleeve end: zigzag the last 4 rings along the arm
        V = np.asarray(V)
        R0 = len(pts) - 4
        tt = np.arange(n) / n
        zz = jag * (np.abs(((tt * 5.0 + 0.2 * np.sin(tt * 23)) % 1.0) - 0.5) * 2.0)
        for r in range(R0, len(pts)):
            V[r * n:(r + 1) * n] += np.outer(zz, dirn)
    reg = garment.get("sleeve_region", "sleeve")
    part = C.Part(f"sleeve_{s}", V, F, UV, region=reg, color=garment.get("sleeve_color"))
    circ = 2 * math.pi * r0
    _metric(part, circ, float(np.linalg.norm(np.diff(np.array(pts), axis=0), axis=1).sum()))
    orient_outward(part, nearest_on_polyline(pts))
    W = S.arm_chain_weights(part.V, J, s)
    # top of the sleeve inside the torso: share with spine_03
    t = (part.V - sh) @ d1
    k = C.smoothstep(0.03, -0.04, t)
    W = {b: w * (1 - k * 0.6) for b, w in W.items()}
    W["spine_03"] = W.get("spine_03", 0) + k * 0.6
    part.weights = W
    return part


def forearm_skin(J, s, start=0.5, color="skin", n=9, k=1.0):
    """Bare forearm (rolled / short sleeves) from a fraction of the upper arm to inside the hand."""
    sh = J[f"upperarm_{s}"]["head"]
    el = J[f"lowerarm_{s}"]["head"]
    wr = J[f"hand_{s}"]["head"]
    d2 = C.normalize(wr - el)
    a = sh + (el - sh) * start
    pts = [a, a + (el - a) * 0.5, el, el + d2 * 0.08, el + d2 * 0.17, wr + d2 * 0.012]
    radii = [0.046 * k, 0.042 * k, 0.038 * k, 0.037 * k, 0.032 * k, 0.026 * k]
    V, F, UV = C.tube(np.array(pts), radii, n=n, up_hint=np.array((0, -1.0, 0)), cap_start="pole", cap_end="pole")
    part = C.Part(f"forearm_{s}", V, F, UV, color=color)
    orient_outward(part, nearest_on_polyline(pts))
    part.weights = S.arm_chain_weights(part.V, J, s)
    return part


def hand_part(J, s, color="skin", body=None, claws=False, n_f=5):
    """Stylised hand: palm loft + 4 finger tubes + thumb, rigged to hand / finger bones (left side)."""
    body = body or {}
    hs = body.get("hand", 1.0)
    wr = J[f"hand_{s}"]["head"]
    kn = J[f"hand_{s}"]["tail"]
    back = C.normalize(J[f"hand_{s}"]["z"])
    fd = C.normalize(kn - wr)
    side = C.normalize(np.cross(fd, back))
    if side[1] > 0:
        side = -side
    parts = []
    # palm: rings across (side) x (back) along fd
    rows = [(-0.012, 0.024, 0.019), (0.012, 0.034, 0.017), (0.040, 0.041, 0.0155), (0.068, 0.044, 0.014),
            (0.084, 0.042, 0.0125), (0.092, 0.030, 0.008)]
    rings = []
    n = 10
    t = np.arange(n) / n * C.TAU
    for along, wa, th in rows:
        c = wr + fd * along * hs
        x = np.cos(t)
        y = np.sin(t)
        e = 2.0 / 2.6
        xs = np.sign(x) * np.abs(x) ** e * wa * hs
        ys = np.sign(y) * np.abs(y) ** e * th * hs
        # palm is fuller on the palm side (-back)
        ys = np.where(ys < 0, ys * 1.15, ys)
        rings.append(c + np.outer(xs, side) + np.outer(ys, back))
    P = np.stack(rings)
    V, F, UV = C.grid(P, wrap_u=True, cap_start="pole", cap_end="pole")
    palm = C.Part(f"palm_{s}", V, F, UV, color=color)
    orient_outward(palm, nearest_on_polyline([wr - fd * 0.05, kn + fd * 0.05]))
    w_h = C.smoothstep(-0.03, 0.0, (palm.V - wr) @ fd)
    palm.weights = {f"hand_{s}": w_h, f"lowerarm_{s}": 1 - w_h}
    parts.append(palm)
    for f in ("index", "middle", "ring", "pinky", "thumb"):
        b1 = J[f"{f}_01_{s}"]
        b2 = J[f"{f}_02_{s}"]
        b3 = J[f"{f}_03_{s}"]
        p0, p1, p2, p3 = b1["head"], b2["head"], b3["head"], b3["tail"]
        d0 = C.normalize(p1 - p0)
        rr = (0.0095 if f != "thumb" else 0.0115) * hs
        if f == "pinky":
            rr *= 0.85
        pts = [p0 - d0 * 0.012, p0 + d0 * 0.004, p1, p2, p3 - C.normalize(p3 - p2) * 0.004]
        radii = [rr, rr * 1.0, rr * 0.93, rr * 0.86, rr * 0.80]
        if claws:
            radii = [r * 1.15 for r in radii]
        tip = p3 + C.normalize(p3 - p2) * rr * 0.55
        V, F, UV = C.tube(np.array(pts), [(r, r * 0.88) for r in radii], n=n_f,
                          up_hint=back, cap_start="pole", cap_end=tuple(tip))
        fp = C.Part(f"{f}_{s}", V, F, UV, color=color)
        orient_outward(fp, nearest_on_polyline(pts + [tip]))
        chain = [p0 - d0 * 0.04, p0, p1, p2, p3]
        W = S.chain_weights(fp.V, chain, [f"hand_{s}", f"{f}_01_{s}", f"{f}_02_{s}", f"{f}_03_{s}"],
                            [0.006, 0.006, 0.005])
        fp.weights = W
        parts.append(fp)
        if claws:
            cd = C.normalize(p3 - p2)
            cl = _claw(p3 + cd * rr * 0.3, cd, back, rr * 0.9, rr * 2.6)
            cl.weights = {f"{f}_03_{s}": np.ones(len(cl.V))}
            parts.append(cl)
    return parts


def _claw(base, d, up, r, length, color="claw"):
    """Curved claw (cone bent towards the palm)."""
    n = 4
    pts = [base, base + d * length * 0.45 - up * length * 0.05, base + d * length * 0.85 - up * length * 0.22]
    radii = [r, r * 0.6, r * 0.2]
    tip = base + d * length - up * length * 0.42
    V, F, UV = C.tube(np.array(pts), radii, n=n, up_hint=up, cap_start="pole", cap_end=tuple(tip))
    part = C.Part("claw", V, F, UV, color=color)
    orient_outward(part, nearest_on_polyline(pts + [tip]))
    return part


# ------------------------------------------------------------------------------------------------
# legs
# ------------------------------------------------------------------------------------------------

def leg_part(J, s, garment, body=None, n=14):
    """Trouser leg (left) from the waist to the ankle hem. garment keys: fit (radius factor), length
    ('long' | 'shorts' | 'capri'), cuff ('rolled' | 'hem' | None), flare."""
    body = body or {}
    hip = J[f"thigh_{s}"]["head"]
    knee = J[f"calf_{s}"]["head"]
    ankle = J[f"foot_{s}"]["head"]
    waist_z = J["spine_01"]["head"][2] - 0.02
    fit = garment.get("fit", 1.0) * body.get("legs", 1.0)
    hips = body.get("hips", 1.0) * body.get("width", 1.0)
    length = garment.get("length", "long")
    hx = hip[0]
    rows = []
    # (z, cx, half width x, front, back, p)
    rows.append((waist_z, hx * 0.40, 0.082 * hips, 0.066, 0.080, 2.6))
    rows.append((hip[2] + 0.03, hx * 0.46, 0.090 * hips, 0.080, 0.100, 2.6))
    rows.append((hip[2] - 0.035, hx * 0.62, 0.094 * hips * fit, 0.090 * fit, 0.112 * fit, 2.4))
    rows.append((hip[2] - 0.10, hx * 0.86, 0.082 * fit, 0.078 * fit, 0.088 * fit, 2.2))
    rows.append((hip[2] - 0.20, hx * 0.95, 0.073 * fit, 0.072 * fit, 0.074 * fit, 2.1))
    rows.append((hip[2] - 0.30, hx * 0.97, 0.064 * fit, 0.064 * fit, 0.064 * fit, 2.0))
    rows.append((knee[2] + 0.04, knee[0], 0.058 * fit, 0.058 * fit, 0.056 * fit, 2.0))
    if length == "shorts":
        rows.append((knee[2] + 0.11, knee[0], 0.066 * fit, 0.066 * fit, 0.066 * fit, 2.0))
        rows = rows[:5] + [(hip[2] - 0.26, hx * 0.97, 0.074 * fit, 0.074 * fit, 0.074 * fit, 2.0)]
    else:
        rows.append((knee[2], knee[0], 0.056 * fit, 0.060 * fit, 0.054 * fit, 2.0))
        rows.append((knee[2] - 0.06, knee[0] * 0.99, 0.054 * fit, 0.055 * fit, 0.058 * fit, 2.0))
        rows.append((knee[2] - 0.17, knee[0] * 0.98, 0.052 * fit, 0.052 * fit, 0.060 * fit, 2.0))
        flare = garment.get("flare", 0.0)
        ank = ankle[2] + (0.06 if length == "long" else 0.13)
        rows.append((ank + 0.12, ankle[0], (0.050 + flare * 0.3) * fit, 0.050 * fit, 0.054 * fit, 2.0))
        rows.append((ank, ankle[0], (0.051 + flare) * fit, (0.051 + flare) * fit, (0.052 + flare) * fit, 2.0))
    # hem / cuff
    cuff = garment.get("cuff")
    z_end, cx_end, a_end = rows[-1][0], rows[-1][1], rows[-1][2]
    if cuff == "rolled":
        rows.append((z_end - 0.004, cx_end, a_end * 1.18, a_end * 1.18, a_end * 1.18, 2.0))
        rows.append((z_end - 0.040, cx_end, a_end * 1.18, a_end * 1.18, a_end * 1.18, 2.0))
        rows.append((z_end - 0.046, cx_end, a_end * 1.06, a_end * 1.06, a_end * 1.06, 2.0))
        rows.append((z_end - 0.030, cx_end, a_end * 0.80, a_end * 0.80, a_end * 0.80, 2.0))
    else:
        rows.append((z_end - 0.012, cx_end, a_end * 1.01, a_end * 1.01, a_end * 1.01, 2.0))
        rows.append((z_end - 0.010, cx_end, a_end * 0.80, a_end * 0.80, a_end * 0.80, 2.0))
    rings = []
    t = np.arange(n) / n * C.TAU
    c, sn = np.cos(t), np.sin(t)
    yoff = hip[1]
    for z, cx, a, f, b, p in rows:
        e = 2.0 / p
        x = np.sign(c) * np.abs(c) ** e * a + cx
        dep = np.where(sn > 0, b, f)
        y = np.sign(sn) * np.abs(sn) ** e * dep + yoff
        # inner side of the hip rows reaches past the middle (both legs overlap at the crotch seam)
        rings.append(np.stack([x, y, np.full(n, z)], axis=1))
    P = np.stack(rings)
    jag = garment.get("jag", 0.0)
    if jag:
        tt = np.arange(n) / n
        zz = jag * (np.abs(((tt * 6.0 + 0.2 * np.sin(tt * 19)) % 1.0) - 0.5) * 2.0)
        for r in range(len(P) - 3, len(P)):
            P[r, :, 2] -= zz
    # knee: slight forward bump
    kz = knee[2]
    w = np.exp(-((P[..., 2] - kz) / 0.05) ** 2) * np.clip(-np.sin(t), 0, 1)[None, :] ** 2
    P[..., 1] -= 0.008 * w
    circ = ring_perimeter(P[5])
    length_m = float(rows[0][0] - rows[-1][0]) + 0.05
    uu = np.arange(n) / n
    vv = (rows[0][0] - P[:, 0, 2]) / length_m
    uv = np.stack(np.meshgrid(uu, vv), axis=-1)
    V, F, UV = C.grid(P, wrap_u=True, uv=uv, cap_start="pole", cap_end="pole")
    part = C.Part(f"leg_{s}", V, F, UV, region=garment.get("region", "bottom"), color=garment.get("color"))
    _metric(part, circ, length_m)
    axis = [np.array((P[0, :, 0].mean(), yoff, rows[0][0] + 0.1)), hip, knee, ankle - np.array((0, 0, 0.1))]
    orient_outward(part, nearest_on_polyline(axis))
    part.weights = S.leg_weights(part.V, J, s, with_foot=False)
    return part


def bare_leg_part(J, s, top_z, color="skin", sock=None, body=None, n=10):
    """Bare lower leg (under shorts), optionally with a sock band (sock = (z_top, color))."""
    body = body or {}
    hip = J[f"thigh_{s}"]["head"]
    knee = J[f"calf_{s}"]["head"]
    ankle = J[f"foot_{s}"]["head"]
    k = body.get("legs", 1.0)
    pts = [np.array((hip[0] * 0.97, hip[1], top_z)), knee + np.array((0, 0, 0.06)), knee,
           knee + (ankle - knee) * 0.30, knee + (ankle - knee) * 0.62, ankle + np.array((0, 0, 0.03))]
    radii = [0.060 * k, 0.050 * k, 0.047 * k, 0.050 * k, 0.040 * k, 0.034 * k]
    V, F, UV = C.tube(np.array(pts), radii, n=n, up_hint=np.array((0, -1.0, 0)), cap_start="pole", cap_end="pole")
    part = C.Part(f"shin_{s}", V, F, UV, color=color)
    orient_outward(part, nearest_on_polyline(pts))
    part.weights = S.leg_weights(part.V, J, s, with_foot=True, hip_shift=False)
    parts = [part]
    if sock:
        z_top, scol = sock
        sp = [ankle + np.array((0, 0, 0.0)), ankle + np.array((0, 0, 0.06)), knee + (ankle - knee) * 0.62,
              np.array((ankle[0], ankle[1] - 0.004, z_top - 0.02)), np.array((ankle[0], ankle[1] - 0.004, z_top))]
        sr = [0.037 * k, 0.038 * k, 0.043 * k, 0.050 * k, 0.051 * k]
        V, F, UV = C.tube(np.array(sp), sr, n=n, up_hint=np.array((0, -1.0, 0)), cap_start="pole", cap_end="pole")
        sp_part = C.Part(f"sock_{s}", V, F, UV, region="sock")
        orient_outward(sp_part, nearest_on_polyline(sp))
        sp_part.weights = S.leg_weights(sp_part.V, J, s, with_foot=True, hip_shift=False)
        parts.append(sp_part)
    return parts


def boot_shaft(J, s, top_z, region="shoe", n=12, k=1.0):
    knee = J[f"calf_{s}"]["head"]
    ankle = J[f"foot_{s}"]["head"]
    pts = [ankle + np.array((0, 0.0, -0.03)), ankle + np.array((0, 0.0, 0.03)),
           np.array((ankle[0], ankle[1] - 0.004, top_z - 0.03)), np.array((ankle[0], ankle[1] - 0.004, top_z)),
           np.array((ankle[0], ankle[1] - 0.004, top_z + 0.004)), np.array((ankle[0], ankle[1] - 0.004, top_z - 0.012))]
    sr = [0.046 * k, 0.047 * k, 0.049 * k, 0.051 * k, 0.047 * k, 0.036 * k]
    V, F, UV = C.tube(np.array(pts), sr, n=n, up_hint=np.array((0, -1.0, 0)), cap_start="pole", cap_end="pole")
    part = C.Part(f"shaft_{s}", V, F, UV, region=region)
    part.tags["uv_rect"] = (0.0, 0.62, 1.0, 1.0)
    orient_outward(part, nearest_on_polyline(pts))
    part.weights = S.leg_weights(part.V, J, s, with_foot=True, hip_shift=False)
    return part


# ------------------------------------------------------------------------------------------------
# shoes
# ------------------------------------------------------------------------------------------------

def shoe_parts(J, s, style="sneaker", k=1.0):
    """Shoe of the left foot: upper (closed loft heel -> toe) + sole slab. style: sneaker | boot | hiker | flat."""
    ankle = J[f"foot_{s}"]["head"]
    ball = J[f"ball_{s}"]["head"]
    cx = (ankle[0] + ball[0]) * 0.5
    heel_y = ankle[1] + 0.065
    toe_y = ball[1] - 0.075
    L = heel_y - toe_y
    sole_h = 0.028 if style in ("boot", "hiker") else 0.024
    n = 12
    rows = []
    # along y from heel to toe: (frac, half width, top z, bottom z)
    if style in ("boot", "hiker"):
        prof = [(0.0, 0.036, 0.085, sole_h), (0.06, 0.044, 0.125, sole_h), (0.25, 0.048, 0.135, sole_h),
                (0.45, 0.050, 0.110, sole_h), (0.62, 0.053, 0.085, sole_h), (0.80, 0.053, 0.068, sole_h),
                (0.93, 0.045, 0.058, sole_h + 0.002), (1.0, 0.026, 0.048, sole_h + 0.006)]
    elif style == "flat":
        prof = [(0.0, 0.033, 0.065, sole_h), (0.07, 0.040, 0.085, sole_h), (0.28, 0.043, 0.090, sole_h),
                (0.50, 0.046, 0.075, sole_h), (0.70, 0.049, 0.058, sole_h), (0.88, 0.045, 0.050, sole_h),
                (1.0, 0.026, 0.040, sole_h + 0.004)]
    else:  # sneaker
        prof = [(0.0, 0.035, 0.080, sole_h), (0.07, 0.043, 0.105, sole_h), (0.25, 0.046, 0.110, sole_h),
                (0.45, 0.048, 0.092, sole_h), (0.64, 0.051, 0.072, sole_h), (0.82, 0.050, 0.060, sole_h),
                (0.94, 0.043, 0.052, sole_h + 0.002), (1.0, 0.024, 0.044, sole_h + 0.006)]
    rings = []
    t = np.arange(n) / n * C.TAU
    c, sn = np.cos(t), np.sin(t)
    for fr, hw, top, bot in prof:
        y = heel_y - fr * L
        zc = (top + bot) * 0.5
        hh = (top - bot) * 0.5
        e = 2.0 / 2.5
        x = np.sign(c) * np.abs(c) ** e * hw * k + cx
        z = np.sign(sn) * np.abs(sn) ** e * hh + zc
        z = np.maximum(z, bot - 0.002)
        rings.append(np.stack([x, np.full(n, y), z], axis=1))
    P = np.stack(rings)
    heel_pole = P[0].mean(axis=0) + np.array((0, 0.012, 0))
    toe_pole = P[-1].mean(axis=0) + np.array((0, -0.010, -0.004))
    uu = np.arange(n) / n
    vv = np.array([p[0] for p in prof])
    uv = np.stack(np.meshgrid(uu, vv), axis=-1)
    V, F, UV = C.grid(P, wrap_u=True, uv=uv, cap_start=tuple(heel_pole), cap_end=tuple(toe_pole))
    upper = C.Part(f"shoe_{s}", V, F, UV, region="shoe")
    upper.tags["uv_rect"] = (0.0, 0.0, 1.0, 0.6)
    orient_outward(upper, nearest_on_polyline([heel_pole + np.array((0, -0.02, 0)), toe_pole + np.array((0, 0.02, 0))]))
    # sole slab
    sp = []
    for fr, hw, top, bot in [(0.0, 0.034, 0, 0), (0.05, 0.045, 0, 0), (0.3, 0.050, 0, 0), (0.62, 0.056, 0, 0),
                             (0.92, 0.050, 0, 0), (1.0, 0.030, 0, 0)]:
        y = heel_y + 0.006 - fr * (L + 0.014)
        sp.append((y, hw * k + 0.003))
    ns = 8
    ts = np.arange(ns) / ns * C.TAU
    sole_rings = []
    for (y, hw) in sp:
        z = np.where(np.sin(ts) > 0, sole_h, 0.0)
        x = np.cos(ts) * hw + cx
        zz = 0.0 + (np.sin(ts) + 1) * 0.5 * sole_h
        zz = np.clip(np.sign(np.sin(ts)) * np.abs(np.sin(ts)) ** 0.35, -1, 1) * 0.5 * sole_h + 0.5 * sole_h
        sole_rings.append(np.stack([np.sign(np.cos(ts)) * np.abs(np.cos(ts)) ** 0.5 * hw + cx, np.full(ns, y), zz], 1))
    SP = np.stack(sole_rings)
    V2, F2, UV2 = C.grid(SP, wrap_u=True, cap_start="pole", cap_end="pole")
    sole = C.Part(f"sole_{s}", V2, F2, UV2, color="sole")
    orient_outward(sole, nearest_on_polyline([np.array((cx, heel_y + 0.1, sole_h / 2)), np.array((cx, toe_y - 0.1, sole_h / 2))]))
    out = []
    for p in (upper, sole):
        y = p.V[:, 1]
        wb = C.smoothstep(ball[1] + 0.025, ball[1] - 0.025, y)
        p.weights = {f"foot_{s}": 1 - wb, f"ball_{s}": wb}
        out.append(p)
    return out


def neck_part(J, H_size=1.0, color="skin", r=0.045, n=10):
    nk = J["neck_01"]["head"]
    hd = J["Head"]["head"]
    s3 = J["spine_03"]["head"]
    pts = [np.array((0, nk[1] + 0.005, nk[2] - 0.06)), np.array((0, nk[1], nk[2])),
           (nk + hd) / 2, hd + np.array((0, 0.0, 0.03))]
    radii = [r * 1.12, r * 1.04, r, r * 0.98]
    V, F, UV = C.tube(np.array(pts), radii, n=n, up_hint=np.array((0, -1.0, 0)), cap_start="pole", cap_end="pole")
    part = C.Part("neck", V, F, UV, color=color)
    orient_outward(part, nearest_on_polyline(pts))
    part.weights = S.neck_weights(part.V, J)
    return part
