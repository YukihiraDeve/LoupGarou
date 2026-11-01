"""Loup-Garou characters: procedural skin weights.

Weights are computed analytically from the rest joints (no automatic weights, no bone heat), so they are
reproducible and tuned for the poses that matter: seated (hips and knees at ~90 deg), hands on the knees,
pointing / raised arm, head turns.

- chain(): weights along a straight chain of joints (arc length with smooth blends at each joint)
- torso(): vertical spine chain + shoulder blend towards clavicle / upper arm
- rigid(): one bone
"""
from __future__ import annotations

import numpy as np

import lg_core as C


def rigid(part, bone):
    part.weights = {bone: np.ones(len(part.V))}
    return part


def _project_chain(V, pts):
    """Arc-length coordinate of each vertex projected on the polyline pts (clamped)."""
    pts = np.asarray(pts, dtype=np.float64)
    seg = pts[1:] - pts[:-1]
    L = np.linalg.norm(seg, axis=1)
    S = np.concatenate([[0.0], np.cumsum(L)])
    best_d = np.full(len(V), np.inf)
    best_s = np.zeros(len(V))
    for i in range(len(seg)):
        d = seg[i] / max(L[i], 1e-9)
        t = (V - pts[i]) @ d
        t_c = np.clip(t, 0.0 if i > 0 else -10.0, L[i] if i < len(seg) - 1 else L[i] + 10.0)
        q = pts[i] + np.outer(t_c, d)
        dist = np.linalg.norm(V - q, axis=1)
        better = dist < best_d
        best_d = np.where(better, dist, best_d)
        best_s = np.where(better, S[i] + t_c, best_s)
    return best_s, S


def chain_weights(V, pts, bones, blends, shift=None):
    """pts: joint positions [P0 .. Pn] (bone i spans Pi -> Pi+1, the last bone extends beyond Pn).

    blends: half width of the blend at each interior joint (len n-1). shift: optional (N, n-1) per-vertex
    offsets of the blend centres (positive = later along the chain).
    """
    s, S = _project_chain(V, pts)
    n = len(bones)
    c = [np.ones(len(V))]
    for k in range(1, n):
        ctr = S[k] + (0.0 if shift is None else shift[:, k - 1])
        h = blends[k - 1]
        c.append(C.smoothstep(ctr - h, ctr + h, s))
    c.append(np.zeros(len(V)))
    W = {}
    for i, b in enumerate(bones):
        w = c[i] - c[i + 1]
        W[b] = W.get(b, 0) + np.clip(w, 0, 1)
    return W


def add_weights(W, extra, factor=1.0):
    for k, v in extra.items():
        W[k] = W.get(k, 0) + v * factor
    return W


def scale_weights(W, f):
    return {k: v * f for k, v in W.items()}


def torso_weights(V, J, arm_blend=True, low_bone="pelvis"):
    """Spine chain by height + shoulders blended to clavicle / upper arm."""
    z = V[:, 2]
    zs = [J["spine_01"]["head"][2], J["spine_02"]["head"][2], J["spine_03"]["head"][2], J["neck_01"]["head"][2]]
    hip = J["thigh_l"]["head"][2]
    pts = np.array([[0, 0, hip - 0.2], [0, 0, zs[0]], [0, 0, zs[1]], [0, 0, zs[2]], [0, 0, zs[3]], [0, 0, zs[3] + 0.2]])
    W = chain_weights(np.stack([np.zeros_like(z), np.zeros_like(z), z], 1), pts,
                      [low_bone, "spine_01", "spine_02", "spine_03", "neck_01"],
                      [0.05, 0.05, 0.06, 0.035])
    if arm_blend:
        for s, sx in (("l", 1), ("r", -1)):
            sh = J[f"upperarm_{s}"]["head"]
            x = V[:, 0] * sx
            d = np.linalg.norm(V - sh, axis=1)
            lat = C.smoothstep(sh[0] * 0.62, sh[0] * 0.98, x)
            w_up = (1.0 - C.smoothstep(0.035, 0.12, d)) * lat * 0.55
            w_cl = (1.0 - C.smoothstep(0.06, 0.19, d)) * C.smoothstep(sh[0] * 0.2, sh[0] * 0.7, x) * 0.55 * (1 - w_up)
            keep = 1.0 - w_up - w_cl
            for k in list(W):
                W[k] = W[k] * keep
            W[f"clavicle_{s}"] = W.get(f"clavicle_{s}", 0) + w_cl
            W[f"upperarm_{s}"] = W.get(f"upperarm_{s}", 0) + w_up
    return W


def arm_chain_weights(V, J, s, start_bone="clavicle", include_hand=True):
    sh = J[f"upperarm_{s}"]["head"]
    el = J[f"lowerarm_{s}"]["head"]
    wr = J[f"hand_{s}"]["head"]
    kn = J[f"hand_{s}"]["tail"]
    d0 = C.normalize(sh - el)
    pts = [sh + d0 * 0.10, sh, el, wr, kn]
    bones = [f"clavicle_{s}", f"upperarm_{s}", f"lowerarm_{s}", f"hand_{s}"]
    W = chain_weights(V, pts, bones, [0.035, 0.045, 0.03])
    # twist of the forearm: let the upper arm keep a little of the elbow region
    return W


def leg_weights(V, J, s, with_foot=True, hip_shift=True):
    """Pelvis -> thigh -> calf -> foot, with a hip blend that is higher at the groin and lower at the
    buttock (the seat keeps its shape when the thigh rotates 90 deg forward)."""
    hip = J[f"thigh_{s}"]["head"]
    knee = J[f"calf_{s}"]["head"]
    ankle = J[f"foot_{s}"]["head"]
    ball = J[f"ball_{s}"]["head"]
    top = hip + np.array((0, 0, 0.25))
    if with_foot:
        pts = [top, hip, knee, ankle, ball]
        bones = ["pelvis", f"thigh_{s}", f"calf_{s}", f"foot_{s}"]
        blends = [0.075, 0.055, 0.03]
    else:
        pts = [top, hip, knee, ankle]
        bones = ["pelvis", f"thigh_{s}", f"calf_{s}"]
        blends = [0.075, 0.055]
    shift = None
    if hip_shift:
        y = V[:, 1] - hip[1]
        # positive shift = blend centre further down the chain (towards the knee)
        sh0 = np.clip(y / 0.10, -1.2, 1.2) * 0.045 + 0.005
        shift = np.zeros((len(V), len(bones) - 1))
        shift[:, 0] = sh0
    return chain_weights(V, pts, bones, blends, shift=shift)


def head_weights(V, J, neck_blend=True):
    """Head rigid, with the lowest part (under the jaw / nape) blending into the neck."""
    hd = J["Head"]["head"]
    if not neck_blend:
        return {"Head": np.ones(len(V))}
    z = V[:, 2]
    w = C.smoothstep(hd[2] - 0.035, hd[2] + 0.01, z)
    return {"Head": w, "neck_01": 1.0 - w}


def neck_weights(V, J):
    z = V[:, 2]
    nk = J["neck_01"]["head"][2]
    hd = J["Head"]["head"][2]
    s3 = J["spine_03"]["head"][2]
    pts = np.array([[0, 0, s3], [0, 0, nk], [0, 0, hd], [0, 0, hd + 0.1]])
    return chain_weights(np.stack([np.zeros_like(z), np.zeros_like(z), z], 1), pts,
                         ["spine_03", "neck_01", "Head"], [0.03, 0.03])


def normalize_weights(W, n_verts, max_influences=4, min_w=0.01):
    """Normalise, drop tiny influences, keep the 4 strongest."""
    names = list(W)
    if not names:
        return W
    M = np.stack([np.broadcast_to(np.asarray(W[k], dtype=np.float64), (n_verts,)) for k in names], axis=1)
    M = np.clip(M, 0, None)
    s = M.sum(axis=1, keepdims=True)
    M = M / np.maximum(s, 1e-9)
    M[M < min_w] = 0
    if M.shape[1] > max_influences:
        idx = np.argsort(-M, axis=1)
        mask = np.zeros_like(M, dtype=bool)
        np.put_along_axis(mask, idx[:, :max_influences], True, axis=1)
        M = np.where(mask, M, 0)
    s = M.sum(axis=1, keepdims=True)
    M = M / np.maximum(s, 1e-9)
    return {k: M[:, i] for i, k in enumerate(names) if M[:, i].max() > 0}
