"""Loup-Garou characters: the contract clips (frames generated with lg_anims)."""
from __future__ import annotations

import math

import numpy as np

import lg_anims as AN
import lg_core as C
import lg_skeleton as SK
from lg_anims import FPS, Clip, ease, solve_pose, sit_base, hands_on_knees

TAU = 2 * math.pi


def frames(duration):
    n = int(round(duration * FPS)) + 1
    return [i / FPS for i in range(n)]


def sit_frame(rig, t_breath, breath_amp=1.0, look=(0, 0), lean=0.0, mods=None):
    P = sit_base(rig, breath=math.sin(t_breath) * breath_amp, look=look, lean=lean)
    if mods:
        mods(P)
    hands_on_knees(rig, P, lift=0.004 * math.sin(t_breath))
    return P


# ------------------------------------------------------------------------------------------------
# seated loops
# ------------------------------------------------------------------------------------------------

def sit_idle(rig):
    D = 4.0
    out = []
    for t in frames(D):
        ph = TAU * t / D
        P = sit_base(rig, breath=math.sin(ph), look=(3.0 * math.sin(ph * 1 + 0.5), 1.5 * math.sin(ph * 2)),
                     lean=0.6 * math.sin(ph))
        P["spine_02"] = (P["spine_02"][0], 1.0 * math.sin(ph), 0.8 * math.sin(ph + 1))
        hands_on_knees(rig, P, lift=0.003 * math.sin(ph))
        out.append(solve_pose(rig, P))
    return Clip("Sit_Idle", True, out)


def sit_talk(rig):
    """Seated talking: alternating hand gestures, small nods and torso involvement (4 s loop)."""
    D = 4.0
    out = []
    for t in frames(D):
        ph = TAU * t / D
        P = sit_base(rig, breath=math.sin(ph * 2) * 0.7, look=(4.0 * math.sin(ph), 3.0 * math.sin(ph * 4)))
        P["spine_02"] = (P["spine_02"][0] + 2.0 * math.sin(ph * 2), 3.0 * math.sin(ph), 0)
        P["Head"] = (P["Head"][0] + 3.0 * math.sin(ph * 4 + 0.3), P["Head"][1] + 4 * math.sin(ph + 1), 3.0 * math.sin(ph * 2))
        hands_on_knees(rig, P)
        rot, pos = solve_pose(rig, P)
        # gesture envelopes: right hand in the first half, left in the second, both briefly in the middle
        gr = ease(min(1, max(0, (t - 0.15) / 0.45))) * (1 - ease(min(1, max(0, (t - 2.0) / 0.5))))
        gl = ease(min(1, max(0, (t - 1.7) / 0.45))) * (1 - ease(min(1, max(0, (t - 3.4) / 0.5))))
        for s, g, sx, phase in (("r", gr, -1, 0.0), ("l", gl, 1, 1.7)):
            if g <= 0:
                continue
            A = P[f"arm_{s}"]
            sh = pos[f"upperarm_{s}"]
            beat = math.sin(TAU * (t - phase) * 1.5)
            gw = sh + np.array((sx * 0.02 + sx * 0.03 * beat, -0.27, -0.24 + 0.03 * beat))
            A["wrist"] = A["wrist"] + (gw - A["wrist"]) * g
            hd0 = np.array(A["hand_dir"])
            hd1 = np.array((-sx * 0.35, -1.0, 0.35))
            A["hand_dir"] = hd0 + (hd1 - hd0) * g
            b0 = np.array(A["back"])
            b1 = np.array((-sx * 0.65, 0.3, 0.7))
            A["back"] = b0 + (b1 - b0) * g
            P[f"fingers_{s}"] = 0.42 - 0.30 * g
        out.append(solve_pose(rig, P))
    return Clip("Sit_Talk", True, out)


def sit_sleep(rig):
    D = 5.0
    out = []
    for t in frames(D):
        ph = TAU * t / D
        b = math.sin(ph)
        P = sit_base(rig, breath=b * 1.6)
        P["pelvis"] = (-9.0, 0, 0)
        P["spine_01"] = (9.0 + b * 0.8, 0, 1.0)
        P["spine_02"] = (10.0 - b * 1.5, 0, 1.5)
        P["spine_03"] = (9.0 - b * 1.5, 0, 1.0)
        P["neck_01"] = (16.0 + b * 1.0, 0, 3.0)
        P["Head"] = (22.0 + b * 2.0, 6.0, 7.0)
        P["clav_l"] = (-4.0 + b * 1.5, 0, -6.0)
        P["clav_r"] = (-4.0 + b * 1.5, 0, -6.0)
        P["eyes"] = (0, 0)
        hands_on_knees(rig, P, lift=-0.01, fwd=-0.06, side_k=1.5)
        P["fingers_l"] = P["fingers_r"] = 0.55
        out.append(solve_pose(rig, P))
    return Clip("Sit_Sleep", True, out)


def sit_awake_night(rig):
    """Awake at night: tense, leaning forward, hands clasped between the knees, glancing around."""
    D = 6.0
    out = []
    for t in frames(D):
        ph = TAU * t / D
        look_yaw = 14.0 * math.sin(ph) + 6.0 * math.sin(ph * 3 + 1)
        P = sit_base(rig, breath=math.sin(ph * 4) * 0.8, look=(look_yaw, -4.0))
        P["spine_01"] = (10.0, 0, 0)
        P["spine_02"] = (8.0, look_yaw * 0.15, 0)
        P["spine_03"] = (4.0, look_yaw * 0.15, 0)
        P["clav_l"] = (5.0 + math.sin(ph * 4) * 0.8, 0, 3.0)
        P["clav_r"] = (5.0 + math.sin(ph * 4) * 0.8, 0, 3.0)
        rot, pos = solve_pose(rig, P)
        kl, kr = pos["calf_l"], pos["calf_r"]
        mid = 0.5 * (kl + kr) + np.array((0, 0.10, -0.02))
        for s, sx in (("l", 1), ("r", -1)):
            P[f"arm_{s}"] = dict(wrist=mid + np.array((sx * 0.035, 0.0, 0.03)),
                                 pole=pos[f"upperarm_{s}"] + np.array((sx * 0.8, 0.2, -0.5)),
                                 hand_dir=(-sx * 0.75, -0.55, -0.35), back=(sx * 0.3, -0.5, 0.8))
            P[f"fingers_{s}"] = 0.75
            P[f"thumb_{s}"] = 0.5
        out.append(solve_pose(rig, P))
    return Clip("Sit_Awake_Night", True, out)


# ------------------------------------------------------------------------------------------------
# seated gestures
# ------------------------------------------------------------------------------------------------

def sit_point(rig):
    """Right arm extended straight forward, index pointing (hold the last frame)."""
    D = 0.9
    out = []
    for t in frames(D):
        g = ease(t / 0.55)
        P = sit_base(rig, breath=0.0)
        P["spine_02"] = (4.0 - 2 * g, -4.0 * g, 0)
        P["spine_03"] = (2.0, -4.0 * g, 0)
        hands_on_knees(rig, P)
        rot, pos = solve_pose(rig, P)
        sh = pos["upperarm_r"]
        A = P["arm_r"]
        target = sh + np.array((0.06, -0.50, 0.04))
        A["wrist"] = A["wrist"] + (target - A["wrist"]) * g
        A["pole"] = sh + np.array((-0.5, 0.3, -0.6))
        hd0 = np.array(A["hand_dir"])
        A["hand_dir"] = hd0 + (np.array((0.08, -1.0, 0.04)) - hd0) * g
        b0 = np.array(A["back"])
        A["back"] = b0 + (np.array((-0.25, 0.0, 1.0)) - b0) * g
        f = 0.42 + (0.95 - 0.42) * g
        P["fingers_r"] = {"index": 0.42 * (1 - g) + 0.02 * g, "middle": f, "ring": f, "pinky": f}
        P["thumb_r"] = 0.25 + 0.45 * g
        out.append(solve_pose(rig, P))
    return Clip("Sit_Point", False, out)


def sit_raise_hand(rig):
    D = 0.8
    out = []
    for t in frames(D):
        g = ease(t / 0.55)
        P = sit_base(rig, breath=0.0)
        P["spine_02"] = (4.0 - 3 * g, 0, -3.0 * g)
        P["clav_r"] = (10.0 * g, 0, 0)
        hands_on_knees(rig, P)
        rot, pos = solve_pose(rig, P)
        sh = pos["upperarm_r"]
        A = P["arm_r"]
        target = sh + np.array((-0.10, -0.08, 0.50))
        # path: pass in front of the body
        mid = sh + np.array((-0.05, -0.35, 0.10))
        if g < 0.5:
            tgt = A["wrist"] + (mid - A["wrist"]) * (g / 0.5)
        else:
            tgt = mid + (target - mid) * ((g - 0.5) / 0.5)
        A["wrist"] = tgt
        A["pole"] = sh + np.array((-0.8, 0.2, -0.2))
        hd0 = np.array(A["hand_dir"])
        A["hand_dir"] = hd0 + (np.array((0.05, -0.15, 1.0)) - hd0) * g
        b0 = np.array(A["back"])
        A["back"] = b0 + (np.array((0.0, 1.0, 0.1)) - b0) * g
        P["fingers_r"] = 0.42 * (1 - g) + 0.06 * g
        P["thumb_r"] = 0.25 * (1 - g) + 0.1 * g
        out.append(solve_pose(rig, P))
    return Clip("Sit_RaiseHand", False, out)


def sit_nod(rig):
    D = 1.3
    out = []
    for t in frames(D):
        env = math.sin(math.pi * min(1, t / D))
        nod = math.sin(TAU * t / D * 2.0) * 14.0 * env
        P = sit_base(rig)
        P["neck_01"] = (2.0 + nod * 0.35, 0, 0)
        P["Head"] = (-2.0 + max(nod, -6) * 0.75 + 4 * env, 0, 0)
        hands_on_knees(rig, P)
        out.append(solve_pose(rig, P))
    return Clip("Sit_Nod", False, out)


def sit_shake(rig):
    D = 1.4
    out = []
    for t in frames(D):
        env = math.sin(math.pi * min(1, t / D))
        sh = math.sin(TAU * t / D * 2.5) * 22.0 * env
        P = sit_base(rig)
        P["neck_01"] = (2.0, sh * 0.35, 0)
        P["Head"] = (-1.0 + 2 * env, sh * 0.65, 0)
        P["spine_03"] = (2.0, sh * 0.08, 0)
        hands_on_knees(rig, P)
        out.append(solve_pose(rig, P))
    return Clip("Sit_Shake", False, out)


def sit_shocked(rig):
    """Jolt back, hands up to the chest, hold, then slowly settle back (2.4 s)."""
    D = 2.4
    out = []
    for t in frames(D):
        a = ease(t / 0.22)
        r = ease((t - 1.3) / 1.1)
        g = a * (1 - r * 0.85)
        P = sit_base(rig)
        P["pelvis"] = (-6.0 - 5.0 * g, 0, 0)
        P["spine_01"] = (5.0 - 4.0 * g, 0, 0)
        P["spine_02"] = (4.0 - 6.0 * g, 0, 0)
        P["spine_03"] = (2.0 - 3.0 * g, 0, 0)
        P["neck_01"] = (2.0 + 6.0 * g, 0, 0)
        P["Head"] = (-2.0 - 8.0 * g + 3 * math.sin(t * 30) * a * (1 - ease(t / 0.6)), 0, 0)
        P["clav_l"] = (12.0 * g, 0, 4.0 * g)
        P["clav_r"] = (12.0 * g, 0, 4.0 * g)
        hands_on_knees(rig, P)
        rot, pos = solve_pose(rig, P)
        chest = pos["spine_03"] + rot["spine_03"] @ np.array((0.0, 0.10, 0.0))
        for s, sx in (("l", 1), ("r", -1)):
            A = P[f"arm_{s}"]
            target = pos["spine_03"] + np.array((sx * 0.07, -0.20, 0.10))
            A["wrist"] = A["wrist"] + (target - A["wrist"]) * g
            A["pole"] = pos[f"upperarm_{s}"] + np.array((sx * 0.7, 0.3, -0.6))
            hd0 = np.array(A["hand_dir"])
            A["hand_dir"] = hd0 + (np.array((-sx * 0.2, -0.3, 1.0)) - hd0) * g
            b0 = np.array(A["back"])
            A["back"] = b0 + (np.array((sx * 0.2, -1.0, 0.1)) - b0) * g
            P[f"fingers_{s}"] = 0.42 - 0.25 * g
        out.append(solve_pose(rig, P))
    return Clip("Sit_Shocked", False, out)


def sit_death(rig):
    """Clutch the chest, slump, slide off the log and collapse on the right side in front of it (3.0 s)."""
    D = 3.0
    out = []
    # key poses as functions of the phase
    for t in frames(D):
        clutch = ease(t / 0.35) * (1 - ease((t - 1.6) / 0.6))
        slump = ease((t - 0.35) / 0.65)
        fall = ease((t - 1.0) / 1.0) ** 1.4
        land = ease((t - 1.9) / 0.5)
        P = sit_base(rig)
        # pelvis slides forward and down to the ground, rolls onto its right side
        p0 = np.array((0.0, 0.0, AN.SEAT_H))
        p1 = np.array((-0.02, -0.30, 0.165))
        pos_p = p0 + (p1 - p0) * fall
        pos_p[2] += 0.04 * math.sin(math.pi * min(1, fall)) * (1 - land)
        P["pelvis_pos"] = pos_p
        roll = -78.0 * ease((t - 1.15) / 1.1)
        P["pelvis"] = (-6.0 + 10.0 * slump - 18.0 * fall, 0.0, roll)
        P["spine_01"] = (5.0 + 10.0 * slump - 14.0 * land, 0, -4 * fall)
        P["spine_02"] = (4.0 + 12.0 * slump - 14.0 * land, 0, -4 * fall)
        P["spine_03"] = (2.0 + 8.0 * slump - 8.0 * land, 0, -2 * fall)
        P["neck_01"] = (2.0 + 15.0 * slump - 10 * land, 0, 6 * land)
        P["Head"] = (-6.0 * clutch + 20.0 * slump - 12 * land, 8.0 * slump, 14 * land)
        P["clav_l"] = (6.0 * clutch, 0, 6.0 * clutch)
        P["clav_r"] = (6.0 * clutch, 0, 6.0 * clutch)
        rot, pos = solve_pose(rig, P)
        # legs: from seated to lying folded on the side
        pr = rot["pelvis"]
        for s, sx in (("l", 1), ("r", -1)):
            hip = pos[f"thigh_{s}"]
            seated = P[f"leg_{s}"]
            # lying target: knees bent, ankles towards the front-right on the ground
            lie_ank = hip + pr @ np.array((sx * 0.05, -0.22, -0.55)) * np.array((1, 1, 1))
            lie_ank[2] = max(lie_ank[2], 0.08 + (0.12 if s == "l" else 0.0))
            a0 = seated["ankle"]
            k = fall
            ank = a0 + (lie_ank - a0) * k
            ank[2] = max(ank[2], 0.06)
            pole = hip + pr @ np.array((sx * 0.1, -1.0, 0.3)) + np.array((0, 0, 0.6 if s == "r" else 0.2))
            fd0 = np.array(seated["foot_dir"])
            fd1 = pr @ np.array((0, -0.6, -1.0))
            P[f"leg_{s}"] = dict(ankle=ank, pole=pole + (seated["pole"] - pole) * (1 - k),
                                 foot_dir=fd0 + (fd1 - fd0) * k, ball_dir=fd0 + (fd1 - fd0) * k,
                                 foot_up=C.normalize(np.array((0, 0, 1.0)) * (1 - k) + (pr @ np.array((0, 0, 1.0))) * k + 1e-3))
        hands_on_knees(rig, P)
        rot, pos = solve_pose(rig, P)
        for s, sx in (("l", 1), ("r", -1)):
            A = P[f"arm_{s}"]
            chest = pos["spine_03"] + rot["spine_03"] @ np.array((sx * 0.05, -0.12, 0.0))
            A["wrist"] = A["wrist"] + (chest - A["wrist"]) * clutch
            # limp arms on the ground at the end
            if fall > 0:
                sh = pos[f"upperarm_{s}"]
                limp = sh + rot["spine_03"] @ np.array((sx * 0.08, -0.30, -0.32))
                pole = sh + rot["spine_03"] @ np.array((sx * 0.5, 0.4, -0.3))
                if s == "r":
                    limp = sh + np.array((-0.06, -0.36, -0.02))
                    pole = sh + np.array((0.0, -0.25, 0.8))
                limp[2] = max(limp[2], 0.07)
                A["wrist"] = A["wrist"] + (limp - A["wrist"]) * fall
                A["pole"] = A["pole"] + (pole - A["pole"]) * fall
                A["hand_dir"] = np.array(A["hand_dir"]) * (1 - fall) + (limp - sh) * 3 * fall
            P[f"fingers_{s}"] = 0.42 + 0.2 * fall
        out.append(solve_pose(rig, P))
    return Clip("Sit_Death", False, out)


# ------------------------------------------------------------------------------------------------
# retargeted clips
# ------------------------------------------------------------------------------------------------

def retargeted(rig, src, setup, action, name, loop, dur=None, shift=None, fps_scale=1.0):
    D = dur or src.duration(action)
    out = []
    for t in frames(D / fps_scale):
        rot, pos = AN.retarget_frame(rig, src, setup, action, min(t * fps_scale, D))
        if shift is not None:
            pos = dict(pos)
            pos["pelvis"] = pos["pelvis"] + shift
            rot, pos = rig.fk(rot, pos["pelvis"])
        out.append((rot, pos))
    return Clip(name, loop, out)


def blend_into(rig, clip, pose_frame, t0, t1, at_end=True):
    """Blend clip frames into a fixed frame (rot, pos) between times t0..t1 (end) or out of it (start)."""
    out = []
    for i, (rot, pos) in enumerate(clip.frames):
        t = i / FPS
        if at_end:
            k = ease((t - t0) / max(t1 - t0, 1e-6))
        else:
            k = 1 - ease((t - t0) / max(t1 - t0, 1e-6))
        if k <= 0:
            out.append((rot, pos))
            continue
        r2, p2 = pose_frame
        rot_b = {b: AN.slerp_rot(rot[b], r2[b], k) for b in rot}
        pel = pos["pelvis"] + (p2["pelvis"] - pos["pelvis"]) * k
        out.append(rig.fk(rot_b, pel))
    clip.frames = out
    return clip


def fix_loop(clip, blend_frames=6):
    """Make the last frame equal the first (cross-blend the tail)."""
    n = len(clip.frames)
    first = clip.frames[0]
    out = list(clip.frames)
    for j in range(blend_frames):
        i = n - blend_frames + j
        k = (j + 1) / blend_frames
        rot, pos = clip.frames[i]
        rot_b = {b: AN.slerp_rot(rot[b], first[0][b], k) for b in rot}
        pel = pos["pelvis"] + (first[1]["pelvis"] - pos["pelvis"]) * k
        out[i] = (rot_b, {**pos, "pelvis": pel})
    clip.frames = out
    return clip


def stand_idle(rig):
    """Relaxed standing idle (lobby / reveals): breathing, slow weight shift, arms hanging (4 s loop)."""
    D = 4.0
    out = []
    rest_p = rig.rest_pos["pelvis"]
    for t in frames(D):
        ph = TAU * t / D
        sh = math.sin(ph)
        b = math.sin(ph * 2)
        P = AN.default_pose()
        P["pelvis_pos"] = rest_p + np.array((0.012 * sh, 0.0, -0.012 - 0.004 * abs(sh)))
        P["pelvis"] = (0.0, 2.0 * sh, -2.0 * sh)
        P["spine_01"] = (1.0, 0, 1.2 * sh)
        P["spine_02"] = (0.5 - 0.8 * b, 0, 0.8 * sh)
        P["spine_03"] = (-0.5 - 0.8 * b, 0, 0)
        P["neck_01"] = (2.0, 2.0 * math.sin(ph + 1), 0)
        P["Head"] = (0.0, 3.0 * math.sin(ph + 1), -1.0 * sh)
        P["clav_l"] = (0.8 * b, 0, 0)
        P["clav_r"] = (0.8 * b, 0, 0)
        for s, sx in (("l", 1), ("r", -1)):
            P[f"leg_{s}"] = dict(ankle=np.array((sx * 0.115, 0.012, SK.ANKLE_Z)), pole=np.array((sx * 0.12, -1.0, 0.5)),
                                 foot_dir=(sx * 0.12, -1.0, -0.55), ball_dir=(sx * 0.12, -1.0, 0.0))
        rot, pos = solve_pose(rig, P)
        for s, sx in (("l", 1), ("r", -1)):
            shp = pos[f"upperarm_{s}"]
            P[f"arm_{s}"] = dict(wrist=shp + np.array((sx * 0.075, -0.045, -0.50 + 0.004 * b)),
                                 pole=shp + np.array((sx * 0.2, 0.8, -0.3)),
                                 hand_dir=(sx * 0.05, -0.12, -1.0), back=(sx * 1.0, 0.15, 0.0))
            P[f"fingers_{s}"] = 0.35
            P[f"thumb_{s}"] = 0.3
        out.append(solve_pose(rig, P))
    return Clip("Stand_Idle", True, out)


# ------------------------------------------------------------------------------------------------
# werewolf
# ------------------------------------------------------------------------------------------------

def wolf_crouch(rig, t, heave=0.0, howl=0.0):
    P = AN.default_pose()
    rest_p = rig.rest_pos["pelvis"]
    P["pelvis_pos"] = rest_p + np.array((0.0, 0.03, -0.10 + 0.01 * heave + 0.05 * howl))
    P["pelvis"] = (14.0 - 12.0 * howl, 0, 0)
    P["spine_01"] = (8.0 - 8.0 * howl, 0, 0)
    P["spine_02"] = (10.0 - 2.0 * heave - 14.0 * howl, 0, 0)
    P["spine_03"] = (8.0 - 2.0 * heave - 10.0 * howl, 0, 0)
    P["neck_01"] = (-12.0 - 22.0 * howl, 0, 0)
    P["Head"] = (-14.0 - 30.0 * howl, 0, 0)
    P["clav_l"] = (6.0 + 3.0 * heave + 6 * howl, 0, -8.0)
    P["clav_r"] = (6.0 + 3.0 * heave + 6 * howl, 0, -8.0)
    for s, sx in (("l", 1), ("r", -1)):
        P[f"leg_{s}"] = dict(ankle=np.array((sx * 0.16, 0.06 - 0.04 * sx, SK.ANKLE_Z)), pole=np.array((sx * 0.6, -1.0, 0.6)),
                             foot_dir=(sx * 0.25, -1.0, -0.55), ball_dir=(sx * 0.25, -1.0, 0.0))
    rot, pos = solve_pose(rig, P)
    for s, sx in (("l", 1), ("r", -1)):
        sh = pos[f"upperarm_{s}"]
        w = sh + np.array((sx * (0.22 + 0.12 * howl), -0.20 - 0.05 * howl, -0.42 + 0.03 * heave + 0.12 * howl))
        P[f"arm_{s}"] = dict(wrist=w, pole=sh + np.array((sx * 0.8, 0.6, -0.2)),
                             hand_dir=(sx * 0.35, -0.6, -0.75), back=(sx * 0.7, -0.4, 0.4))
        P[f"fingers_{s}"] = 0.55 + 0.25 * howl
        P[f"thumb_{s}"] = 0.4
    return solve_pose(rig, P)


def wolf_idle(rig):
    D = 3.0
    out = []
    for t in frames(D):
        heave = math.sin(TAU * t / D * 2)
        out.append(wolf_crouch(rig, t, heave=heave))
    return Clip("Wolf_Idle", True, out)


def wolf_howl(rig):
    D = 3.6
    out = []
    for t in frames(D):
        h = ease(t / 0.7) * (1 - ease((t - 2.9) / 0.7))
        heave = math.sin(TAU * t * 1.5) * (1 - h) * 0.6 + 0.3 * math.sin(TAU * t * 6) * h * 0.2
        out.append(wolf_crouch(rig, t, heave=heave, howl=h))
    return Clip("Wolf_Howl", False, out)


# ------------------------------------------------------------------------------------------------
# all clips
# ------------------------------------------------------------------------------------------------

def make_all(rig, use_source=True):
    clips = [sit_idle(rig), sit_talk(rig), sit_sleep(rig), sit_awake_night(rig), sit_point(rig),
             sit_raise_hand(rig), sit_nod(rig), sit_shake(rig), sit_shocked(rig), sit_death(rig)]
    if use_source:
        src = AN.Source()
        setup = AN.retarget_setup(rig, src)
        base = solve_pose(rig, hands_on_knees(rig, sit_base(rig)))
        # seated alignment: move the source so its seated pelvis lands on ours
        probe = AN.retarget_frame(rig, src, setup, "Sitting_Idle_Loop", 0.0)
        shift = base[1]["pelvis"] - probe[1]["pelvis"]
        shift[0] = 0.0
        stand_sit = retargeted(rig, src, setup, "Sitting_Enter", "Stand_Sit", False, shift=shift)
        blend_into(rig, stand_sit, base, stand_sit.duration * 0.62, stand_sit.duration)
        sit_stand = retargeted(rig, src, setup, "Sitting_Exit", "Sit_Stand", False, shift=shift)
        blend_into(rig, sit_stand, base, 0.0, sit_stand.duration * 0.35, at_end=False)
        idle = stand_idle(rig)
        walk = fix_loop(retargeted(rig, src, setup, "Walk_Loop", "Walk", True), 3)
        clips += [sit_stand, stand_sit, idle, walk]
        src.cleanup()
    clips += [wolf_howl(rig), wolf_idle(rig)]
    return clips
