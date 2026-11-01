"""Loup-Garou characters: animation clips for the shared skeleton (anims.glb).

Every clip is produced as a sequence of frames; a frame is {bone: world rotation 3x3} + the pelvis
world position (armature space, scale 1). A small FK solver converts that to Blender pose-bone local
quaternions (rotation keys on every bone, location keys only on `pelvis`).

Sources:
- Retargeted from the Quaternius Universal Animation Library (CC0, Godot/Rigify bone names): Idle_Loop,
  Walk_Loop, Sitting_Enter / Sitting_Exit (blended into our own seated pose). Retargeting copies each
  bone's world-space rotation relative to the source's rest pose after aligning bone directions, so the
  source T pose maps on our A pose; the pelvis translation is scaled by the leg-length ratio.
- Hand-made (procedural): every seated clip, the seated death, the werewolf clips.

Seated contract: the pelvis joint is ON the seat (0.45 m), feet flat on the ground, back straight.
"""
from __future__ import annotations

import math

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

import lg_core as C
import lg_skeleton as SK

FPS = 30
SEAT_H = 0.45
UAL1 = "/Users/valentinbour/Desktop/Git/LoupGarou/3DLib/assets/animations/quaternius/universal-animation-library/Godot/AnimationLibrary_Godot_Standard.glb"

SRC_MAP = {
    "DEF-hips": "pelvis", "DEF-spine.001": "spine_01", "DEF-spine.002": "spine_02", "DEF-spine.003": "spine_03",
    "DEF-neck": "neck_01", "DEF-head": "Head",
}
for _S, _s in (("L", "l"), ("R", "r")):
    SRC_MAP.update({
        f"DEF-shoulder.{_S}": f"clavicle_{_s}", f"DEF-upper_arm.{_S}": f"upperarm_{_s}",
        f"DEF-forearm.{_S}": f"lowerarm_{_s}", f"DEF-hand.{_S}": f"hand_{_s}",
        f"DEF-thigh.{_S}": f"thigh_{_s}", f"DEF-shin.{_S}": f"calf_{_s}", f"DEF-foot.{_S}": f"foot_{_s}",
        f"DEF-toe.{_S}": f"ball_{_s}",
    })
    for _f in ("index", "middle", "ring", "pinky"):
        for _i in (1, 2, 3):
            SRC_MAP[f"DEF-f_{_f}.0{_i}.{_S}"] = f"{_f}_0{_i}_{_s}"
    for _i in (1, 2, 3):
        SRC_MAP[f"DEF-thumb.0{_i}.{_S}"] = f"thumb_0{_i}_{_s}"


# ------------------------------------------------------------------------------------------------
# rig model (numpy)
# ------------------------------------------------------------------------------------------------

class Rig:
    def __init__(self, arm):
        self.arm = arm
        self.names = [b.name for b in arm.data.bones]
        self.rest = {b.name: np.array(b.matrix_local) for b in arm.data.bones}
        self.parent = {b.name: (b.parent.name if b.parent else None) for b in arm.data.bones}
        self.order = []
        seen = set()
        for n in SK.BONE_ORDER:
            self.order.append(n)
        self.rest_rot = {k: v[:3, :3].copy() for k, v in self.rest.items()}
        self.rest_pos = {k: v[:3, 3].copy() for k, v in self.rest.items()}
        self.length = {b.name: b.length for b in arm.data.bones}

    def fk(self, wrot, pelvis_pos):
        """World rotations for every bone (missing -> follow parent rigidly) -> world positions."""
        pos = {}
        rot = {}
        for n in self.order:
            p = self.parent[n]
            if p is None:
                rot[n] = wrot.get(n, self.rest_rot[n])
                pos[n] = self.rest_pos[n]
                continue
            # offset of n in parent's rest frame
            off = self.rest_rot[p].T @ (self.rest_pos[n] - self.rest_pos[p])
            if n == "pelvis" and pelvis_pos is not None:
                pos[n] = np.asarray(pelvis_pos, dtype=np.float64)
            else:
                pos[n] = pos[p] + rot[p] @ off
            if n in wrot:
                rot[n] = wrot[n]
            else:
                rot[n] = rot[p] @ (self.rest_rot[p].T @ self.rest_rot[n])
        return rot, pos

    def to_basis(self, rot, pos):
        """World rotations/positions -> pose-bone local quaternions (+ pelvis location)."""
        out = {}
        for n in self.order:
            p = self.parent[n]
            if p is None:
                R = self.rest_rot[n].T @ rot[n]
            else:
                # M_n = M_p @ inv(Rest_p) @ Rest_n @ B  -> B = inv(Rest_n) Rest_p inv(M_p) M_n
                R = self.rest_rot[n].T @ self.rest_rot[p] @ rot[p].T @ rot[n]
            q = Matrix(R.tolist()).to_quaternion()
            out[n] = [q.w, q.x, q.y, q.z]
        # pelvis translation in its own rest frame (parent root is static at rest)
        pr = self.rest_rot["pelvis"]
        loc = pr.T @ (pos["pelvis"] - self.rest_pos["pelvis"])
        out["_pelvis_loc"] = loc.tolist()
        return out


def aim_frame(y, z_hint):
    y = C.normalize(np.asarray(y, dtype=np.float64))
    z = np.asarray(z_hint, dtype=np.float64)
    z = z - np.dot(z, y) * y
    if np.linalg.norm(z) < 1e-6:
        z = np.array((0.0, -1.0, 0.0)) - np.dot((0.0, -1.0, 0.0), y) * y
    z = C.normalize(z)
    x = np.cross(y, z)
    return np.stack([x, y, z], axis=1)


def rot_euler_local(base, rx=0.0, ry=0.0, rz=0.0):
    """base world rotation (3x3) @ local XYZ euler (degrees)."""
    R = C.rot_x(math.radians(rx)) @ C.rot_y(math.radians(ry)) @ C.rot_z(math.radians(rz))
    return base @ R


def slerp_rot(A, B, t):
    qa = Matrix(A.tolist()).to_quaternion()
    qb = Matrix(B.tolist()).to_quaternion()
    if qa.dot(qb) < 0:
        qb = -qb
    q = qa.slerp(qb, float(t))
    return np.array(q.to_matrix())


def two_bone_ik(a, l1, l2, target, pole):
    """Joint position of a two-bone chain rooted at a reaching target, bending towards pole."""
    a = np.asarray(a, float)
    t = np.asarray(target, float)
    d = t - a
    dist = np.linalg.norm(d)
    dist = min(max(dist, abs(l1 - l2) + 1e-4), l1 + l2 - 1e-4)
    dn = C.normalize(d)
    t = a + dn * dist
    cos_a = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist)
    ang = math.acos(max(-1.0, min(1.0, cos_a)))
    pv = np.asarray(pole, float) - a
    pv = pv - np.dot(pv, dn) * dn
    if np.linalg.norm(pv) < 1e-6:
        pv = np.array((0, -1.0, 0))
    pv = C.normalize(pv)
    j = a + dn * math.cos(ang) * l1 + pv * math.sin(ang) * l1
    return j, t


# ------------------------------------------------------------------------------------------------
# procedural pose description -> world rotations
# ------------------------------------------------------------------------------------------------

def default_pose():
    return dict(
        pelvis_pos=None,          # world position of the pelvis joint (None = rest)
        pelvis=(0, 0, 0),         # local euler (deg) of each upright bone
        spine_01=(0, 0, 0), spine_02=(0, 0, 0), spine_03=(0, 0, 0), neck_01=(0, 0, 0), Head=(0, 0, 0),
        clav_l=(0, 0, 0), clav_r=(0, 0, 0),
        arm_l=None, arm_r=None,   # dict(wrist=, pole=, hand_dir=, back=) world targets
        leg_l=None, leg_r=None,   # dict(ankle=, pole=, foot_dir=)
        fingers_l=0.35, fingers_r=0.35,   # curl 0..1 (or dict per finger)
        thumb_l=0.3, thumb_r=0.3,
        eyes=(0, 0),
    )


def solve_pose(rig, P):
    """P: pose dict (see default_pose) -> (world rotations, world positions)."""
    w = {}
    rr = rig.rest_rot
    up_bones = ["pelvis", "spine_01", "spine_02", "spine_03", "neck_01", "Head"]
    cur = rr["root"]
    parent_world = np.eye(3)
    for b in up_bones:
        # upright bones: rest world frame is aligned with the model axes; chain local eulers
        # (pitch +forward, yaw +towards the character's left, roll +tilt to the left), model axes
        parent_world = parent_world @ (C.rot_x(math.radians(P[b][0])) @ C.rot_z(math.radians(P[b][1])) @ C.rot_y(math.radians(P[b][2])))
        w[b] = parent_world @ rr[b]
    for e in ("eye_l", "eye_r"):
        yaw, pitch = P.get("eyes", (0, 0))
        w[e] = w["Head"] @ C.rot_y(math.radians(yaw)) @ C.rot_x(math.radians(pitch))
    rot, pos = rig.fk(w, P["pelvis_pos"])
    for s in ("l", "r"):
        cx, cy, cz = P[f"clav_{s}"]
        if s == "r":
            cy, cz = -cy, -cz
        w[f"clavicle_{s}"] = w["spine_03"] @ (rr["spine_03"].T @ rr[f"clavicle_{s}"]) @ C.rot_x(math.radians(cx)) @ C.rot_y(math.radians(cy)) @ C.rot_z(math.radians(cz))
    rot, pos = rig.fk(w, P["pelvis_pos"])
    for s in ("l", "r"):
        A = P.get(f"arm_{s}")
        if A is not None:
            sh = pos[f"upperarm_{s}"]
            l1 = rig.length[f"upperarm_{s}"]
            l2 = rig.length[f"lowerarm_{s}"]
            el, wr = two_bone_ik(sh, l1, l2, A["wrist"], A["pole"])
            u = C.normalize(el - sh)
            f = C.normalize(wr - el)
            perp = f - np.dot(f, u) * u
            if np.linalg.norm(perp) < 1e-4:
                perp = np.asarray(A.get("bend_hint", (0, -1.0, 0)))
            z = C.normalize(perp - np.dot(perp, u) * u)
            Ru = aim_frame(u, z)
            x = Ru[:, 0]
            Rf = np.stack([x, f, np.cross(x, f)], axis=1)
            # forearm twist towards the hand orientation
            w[f"upperarm_{s}"] = Ru
            w[f"lowerarm_{s}"] = Rf
            hd = A.get("hand_dir", f)
            back = A.get("back", (0, 0, 1.0))
            w[f"hand_{s}"] = aim_frame(hd, back)
            # partial forearm twist so the wrist does not candy-wrap: rotate lowerarm around its axis
            Rh = w[f"hand_{s}"]
            zf = Rf[:, 2]
            zt = Rh[:, 2] - np.dot(Rh[:, 2], f) * f
            if np.linalg.norm(zt) > 1e-4:
                zt = C.normalize(zt)
                ang = math.atan2(np.dot(np.cross(zf, zt), f), np.dot(zf, zt))
                w[f"lowerarm_{s}"] = C.rot_axis(f, ang * 0.5) @ Rf
        L = P.get(f"leg_{s}")
        if L is not None:
            hip = pos[f"thigh_{s}"]
            l1 = rig.length[f"thigh_{s}"]
            l2 = rig.length[f"calf_{s}"]
            kn, an = two_bone_ik(hip, l1, l2, L["ankle"], L["pole"])
            u = C.normalize(kn - hip)
            c = C.normalize(an - kn)
            perp = c - np.dot(c, u) * u
            if np.linalg.norm(perp) < 1e-4:
                z = np.array((0, -1.0, 0))
            else:
                z = -C.normalize(perp)
            Rt = aim_frame(u, z)
            x = Rt[:, 0]
            Rc = np.stack([x, c, np.cross(x, c)], axis=1)
            w[f"thigh_{s}"] = Rt
            w[f"calf_{s}"] = Rc
            fd = L.get("foot_dir", (0, -1.0, -0.55))
            w[f"foot_{s}"] = aim_frame(fd, L.get("foot_up", (0, 0, 1.0)))
            bd = L.get("ball_dir", (0, -1.0, 0.0))
            w[f"ball_{s}"] = aim_frame(bd, (0, 0, 1.0))
        rot, pos = rig.fk(w, P["pelvis_pos"])
        # fingers
        curl = P.get(f"fingers_{s}", 0.3)
        for fname in ("index", "middle", "ring", "pinky"):
            c = curl[fname] if isinstance(curl, dict) else curl
            for i, k in ((1, 0.8), (2, 1.0), (3, 0.7)):
                b = f"{fname}_0{i}_{s}"
                par = rig.parent[b]
                base = w.get(par, rot[par]) @ (rr[par].T @ rr[b])
                w[b] = base @ C.rot_x(math.radians(-80.0 * c * k))
        tc = P.get(f"thumb_{s}", 0.3)
        for i, k in ((1, 0.3), (2, 0.6), (3, 0.6)):
            b = f"thumb_0{i}_{s}"
            par = rig.parent[b]
            base = w.get(par, rot[par]) @ (rr[par].T @ rr[b])
            w[b] = base @ C.rot_x(math.radians(-60.0 * tc * k))
    rot, pos = rig.fk(w, P["pelvis_pos"])
    return rot, pos


# ------------------------------------------------------------------------------------------------
# seated base pose
# ------------------------------------------------------------------------------------------------

def sit_base(rig, breath=0.0, look=(0.0, 0.0), lean=0.0):
    """Upright seated pose: pelvis on the seat at SEAT_H, feet flat, hands resting on the knees."""
    P = default_pose()
    P["pelvis_pos"] = np.array((0.0, 0.0, SEAT_H))
    P["pelvis"] = (-6.0 + lean, 0, 0)
    P["spine_01"] = (5.0 + breath * 0.6, 0, 0)
    P["spine_02"] = (4.0 - breath * 1.2, 0, 0)
    P["spine_03"] = (2.0 - breath * 1.5, 0, 0)
    P["neck_01"] = (2.0 + look[1] * 0.4, look[0] * 0.4, 0)
    P["Head"] = (-2.0 + look[1] * 0.6, look[0] * 0.6, 0)
    P["clav_l"] = (breath * 1.2, 0, 0)
    P["clav_r"] = (breath * 1.2, 0, 0)
    for s, sx in (("l", 1), ("r", -1)):
        P[f"leg_{s}"] = dict(ankle=np.array((sx * 0.130, -0.405, SK.ANKLE_Z)), pole=np.array((sx * 0.25, -1.0, 1.4)),
                             foot_dir=(sx * 0.08, -1.0, -0.62), ball_dir=(sx * 0.08, -1.0, 0.0))
    return P


def knee_positions(rig, P):
    rot, pos = solve_pose(rig, P)
    return pos["calf_l"], pos["calf_r"], rot, pos


def hands_on_knees(rig, P, lift=0.0, fwd=0.0, side_k=1.0):
    kl, kr, rot, pos = knee_positions(rig, P)
    for s, kn, sx in (("l", kl, 1), ("r", kr, -1)):
        wrist = kn + np.array((sx * 0.012 * side_k, 0.095 - fwd, 0.085 + lift))
        P[f"arm_{s}"] = dict(wrist=wrist, pole=pos[f"upperarm_{s}"] + np.array((sx * 0.6, 0.5, -0.4)),
                             hand_dir=(sx * -0.10, -1.0, -0.42), back=(sx * 0.12, -0.25, 1.0))
        P[f"fingers_{s}"] = 0.42
        P[f"thumb_{s}"] = 0.55
    return P


# ------------------------------------------------------------------------------------------------
# clip containers
# ------------------------------------------------------------------------------------------------

class Clip:
    def __init__(self, name, loop, frames=None):
        self.name = name
        self.loop = loop
        self.frames = frames or []   # list of (rot, pos)

    @property
    def duration(self):
        return (len(self.frames) - 1) / FPS


def bake_clip(rig, clip):
    """Create a Blender action from clip frames."""
    arm = rig.arm
    act = bpy.data.actions.get(clip.name)
    if act is not None:
        bpy.data.actions.remove(act)
    act = bpy.data.actions.new(clip.name)
    act.use_fake_user = True
    arm.animation_data_create()
    arm.animation_data.action = act
    n = len(clip.frames)
    data = [rig.to_basis(r, p) for (r, p) in clip.frames]
    frames = np.arange(n, dtype=np.float64) + 1.0
    # fcurves through keyframe_insert once to create the channels / slot, then bulk set
    for b in rig.order:
        pb = arm.pose.bones[b]
        pb.rotation_mode = "QUATERNION"
    for b in rig.order:
        pb = arm.pose.bones[b]
        pb.rotation_quaternion = data[0][b]
        pb.keyframe_insert("rotation_quaternion", frame=1, group=b)
        if b == "pelvis":
            pb.location = data[0]["_pelvis_loc"]
            pb.keyframe_insert("location", frame=1, group=b)
    fcs = _action_fcurves(act)
    for fc in fcs:
        path = fc.data_path
        bname = path.split('"')[1]
        idx = fc.array_index
        if path.endswith("rotation_quaternion"):
            vals = np.array([d[bname][idx] for d in data])
        elif path.endswith("location"):
            vals = np.array([d["_pelvis_loc"][idx] for d in data])
        else:
            continue
        # quaternion sign continuity
        kp = fc.keyframe_points
        if len(kp) < n:
            kp.add(n - len(kp))
        co = np.stack([frames, vals], axis=1).ravel()
        kp.foreach_set("co", co)
        for k in kp:
            k.interpolation = "LINEAR"
        fc.update()
    arm.animation_data.action = None
    return act


def _action_fcurves(act):
    if hasattr(act, "fcurves") and len(getattr(act, "fcurves", [])):
        return list(act.fcurves)
    out = []
    for layer in getattr(act, "layers", []):
        for strip in layer.strips:
            for cb in strip.channelbags:
                out += list(cb.fcurves)
    return out


def fix_quat_continuity(clip_frames_basis):
    pass


# ------------------------------------------------------------------------------------------------
# retargeting from UAL
# ------------------------------------------------------------------------------------------------

class Source:
    def __init__(self, path=UAL1):
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=path)
        new = [o for o in bpy.data.objects if o not in before]
        self.objs = new
        self.arm = [o for o in new if o.type == "ARMATURE"][0]
        for o in new:
            if o.type == "MESH":
                o.hide_render = True
        self.fps = bpy.context.scene.render.fps / bpy.context.scene.render.fps_base
        a = self.arm
        mw = np.array(a.matrix_world)
        self.rest = {b.name: mw @ np.array(b.matrix_local) for b in a.data.bones}

    def sample(self, action_name, t):
        a = self.arm
        act = bpy.data.actions[action_name]
        a.animation_data_create()
        if a.animation_data.action != act:
            a.animation_data.action = act
            if hasattr(a.animation_data, "action_slot") and len(act.slots):
                a.animation_data.action_slot = act.slots[0]
        f0 = act.frame_range[0]
        fr = f0 + t * self.fps
        bpy.context.scene.frame_set(int(math.floor(fr)), subframe=fr - math.floor(fr))
        mw = np.array(a.matrix_world)
        return {pb.name: mw @ np.array(pb.matrix) for pb in a.pose.bones}

    def duration(self, action_name):
        act = bpy.data.actions[action_name]
        return (act.frame_range[1] - act.frame_range[0]) / self.fps

    def cleanup(self):
        for o in self.objs:
            bpy.data.objects.remove(o, do_unlink=True)


def retarget_setup(rig, src):
    """Per-bone constant offsets O_b such that target_world = source_world @ O_b."""
    O = {}
    for sname, tname in SRC_MAP.items():
        if sname not in src.rest or tname not in rig.rest_rot:
            continue
        Rs = src.rest[sname][:3, :3]
        Rs = Rs / np.linalg.norm(Rs, axis=0, keepdims=True)
        Rt = rig.rest_rot[tname]
        ds = C.normalize(Rs[:, 1])
        dt = C.normalize(Rt[:, 1])
        if tname in ("pelvis", "spine_01", "spine_02", "spine_03", "neck_01", "Head"):
            A = np.eye(3)
        else:
            A = rotation_between(ds, dt)
        O[tname] = Rs.T @ A.T @ Rt
    # leg scale and hip centres
    s_hip = 0.5 * (src.rest["DEF-thigh.L"][:3, 3] + src.rest["DEF-thigh.R"][:3, 3])
    s_ank = src.rest["DEF-foot.L"][:3, 3]
    t_hip = 0.5 * (rig.rest_pos["thigh_l"] + rig.rest_pos["thigh_r"])
    t_ank = rig.rest_pos["foot_l"]
    k = (t_hip[2] - t_ank[2]) / (s_hip[2] - s_ank[2])
    return dict(O=O, k=k, t_hip=t_hip, s_hip=s_hip)


def rotation_between(a, b):
    a = C.normalize(a)
    b = C.normalize(b)
    v = np.cross(a, b)
    c = float(np.dot(a, b))
    if np.linalg.norm(v) < 1e-8:
        return np.eye(3) if c > 0 else C.rot_axis(np.array((0, 0, 1.0)), math.pi)
    return C.rot_axis(v, math.atan2(np.linalg.norm(v), c))


def retarget_frame(rig, src, setup, action, t, finger_override=None):
    S = src.sample(action, t)
    w = {}
    for sname, tname in SRC_MAP.items():
        if tname not in setup["O"]:
            continue
        Rs = S[sname][:3, :3]
        Rs = Rs / np.linalg.norm(Rs, axis=0, keepdims=True)
        w[tname] = Rs @ setup["O"][tname]
    for e in ("eye_l", "eye_r"):
        w[e] = w["Head"] @ (rig.rest_rot["Head"].T @ rig.rest_rot[e])
    # pelvis position from the source hip centre
    hip_c = 0.5 * (S["DEF-thigh.L"][:3, 3] + S["DEF-thigh.R"][:3, 3])
    hip_t = hip_c * setup["k"]
    dR = w["pelvis"] @ rig.rest_rot["pelvis"].T
    off = rig.rest_pos["pelvis"] - setup["t_hip"]
    ppos = hip_t + dR @ off
    rot, pos = rig.fk(w, ppos)
    return rot, pos


def blend_frames(fa, fb, t):
    ra, pa = fa
    rb, pb = fb
    rot = {k: slerp_rot(ra[k], rb[k], t) for k in ra}
    return rot, {"pelvis": pa["pelvis"] + (pb["pelvis"] - pa["pelvis"]) * t, **{k: v for k, v in pa.items() if k != "pelvis"}}


def frame_from_pose(rig, P):
    rot, pos = solve_pose(rig, P)
    return rot, pos


def ease(t):
    t = min(max(t, 0.0), 1.0)
    return t * t * (3 - 2 * t)
