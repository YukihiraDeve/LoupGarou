"""Loup-Garou characters: the shared skeleton (Unreal-mannequin bone names + eye_l / eye_r).

Every character (and the werewolf) uses the SAME bone directions and rolls, so the glTF rest rotations
are identical and one `anims.glb` drives them all. Characters only differ by bone lengths that are not
animated (torso, neck, shoulder width, arm length, hip width) and by the armature object scale.
Leg lengths are fixed (the seated clips put the feet on the ground for a 0.45 m seat).

The `pelvis` joint is placed at the seat contact point (below and slightly behind the hip joints), so in
the seated clips the pelvis bone is exactly on the seat surface, as the contract requires.

Bone frames: spine, neck, Head and the eyes point straight up with roll 0, which gives them, in glTF /
three.js, local axes aligned with the model (+X = character's left, +Y = up, +Z = forward).
"""
from __future__ import annotations

import math

import bpy
import numpy as np
from mathutils import Matrix, Vector

import lg_core as C

# fixed leg layout (metres, scale 1)
HIP_Z = 0.880
KNEE_Z = 0.475
ANKLE_Z = 0.085
SEAT_DROP = 0.090      # pelvis joint below the hip joints
SEAT_BACK = 0.025      # ... and behind them
A_POSE = math.radians(47.0)   # upper arm angle below horizontal... measured from vertical: 90-47

FINGERS = ("thumb", "index", "middle", "ring", "pinky")

BONE_ORDER = (
    ["root", "pelvis", "spine_01", "spine_02", "spine_03", "neck_01", "Head", "eye_l", "eye_r"]
    + [f"{b}_{s}" for s in ("l", "r") for b in ("clavicle", "upperarm", "lowerarm", "hand")]
    + [f"{f}_0{i}_{s}" for s in ("l", "r") for f in FINGERS for i in (1, 2, 3)]
    + [f"{b}_{s}" for s in ("l", "r") for b in ("thigh", "calf", "foot", "ball")]
)

PARENT = {
    "root": None, "pelvis": "root", "spine_01": "pelvis", "spine_02": "spine_01", "spine_03": "spine_02",
    "neck_01": "spine_03", "Head": "neck_01", "eye_l": "Head", "eye_r": "Head",
}
for s in ("l", "r"):
    PARENT.update({
        f"clavicle_{s}": "spine_03", f"upperarm_{s}": f"clavicle_{s}", f"lowerarm_{s}": f"upperarm_{s}",
        f"hand_{s}": f"lowerarm_{s}",
        f"thigh_{s}": "pelvis", f"calf_{s}": f"thigh_{s}", f"foot_{s}": f"calf_{s}", f"ball_{s}": f"foot_{s}",
    })
    for f in FINGERS:
        PARENT[f"{f}_01_{s}"] = f"hand_{s}"
        PARENT[f"{f}_02_{s}"] = f"{f}_01_{s}"
        PARENT[f"{f}_03_{s}"] = f"{f}_02_{s}"

DEFAULT_BODY = dict(
    torso=1.0,        # spine length factor
    neck=1.0,         # neck length factor
    shoulder=1.0,     # shoulder half width factor
    arm=1.0,          # arm length factor
    hip=1.0,          # hip half width factor
    hand=1.12,        # hand size factor
    head=1.0,         # head size factor (geometry only)
    eye_dx=0.0365,    # eye centre offset from the head centre (x), set by the head builder
    eye_dy=-0.071,
    eye_dz=0.010,
)


def mirror_x(p):
    return np.array((-p[0], p[1], p[2]))


def layout(body: dict | None = None) -> dict:
    """Joint layout: name -> dict(head, tail, z) in armature space (scale 1)."""
    b = dict(DEFAULT_BODY)
    b.update(body or {})
    J = {}
    up = np.array((0.0, 0.0, 1.0))
    fwd = np.array((0.0, -1.0, 0.0))

    def bone(name, head, tail, z):
        J[name] = dict(head=np.asarray(head, float), tail=np.asarray(tail, float), z=np.asarray(z, float))

    def upright(name, head, length=0.08):
        h = np.asarray(head, float)
        bone(name, h, h + up * length, fwd)

    hip_x = 0.092 * b["hip"]
    upright("root", (0, 0, 0), 0.12)
    pelvis = np.array((0.0, SEAT_BACK, HIP_Z - SEAT_DROP))
    upright("pelvis", pelvis, 0.10)
    t = b["torso"]
    s1 = np.array((0.0, 0.020, HIP_Z + 0.085 * t))
    s2 = s1 + np.array((0.0, 0.006, 0.120 * t))
    s3 = s2 + np.array((0.0, -0.004, 0.130 * t))
    nk = s3 + np.array((0.0, 0.010, 0.195 * t))
    hd = nk + np.array((0.0, -0.016, 0.080 * b["neck"]))
    upright("spine_01", s1, 0.10)
    upright("spine_02", s2, 0.10)
    upright("spine_03", s3, 0.12)
    upright("neck_01", nk, 0.07)
    upright("Head", hd, 0.12)
    hc = head_center({"Head": {"head": hd}}, b)
    for s, sx in (("l", 1), ("r", -1)):
        e = hc + np.array((sx * b["eye_dx"], b["eye_dy"], b["eye_dz"])) * b["head"]
        upright(f"eye_{s}", e, 0.03)

    # arms (left, then mirrored)
    sh_x = 0.172 * b["shoulder"]
    clav_h = np.array((0.022, -0.005, nk[2] - 0.030))
    shoulder = np.array((sh_x, 0.028, nk[2] - 0.048))
    ang = math.radians(43.0)  # A pose: upper arm 43 deg below horizontal
    ad = C.normalize(np.array((math.cos(ang), -0.05, -math.sin(ang))))
    la = 0.285 * b["arm"]
    lf = 0.255 * b["arm"]
    elbow = shoulder + ad * la
    fd = C.normalize(ad + np.array((0.0, -0.06, 0.0)))
    wrist = elbow + fd * lf
    hand_len = 0.085 * b["hand"]
    knuckle = wrist + fd * hand_len
    # back of the hand normal (palm faces the thigh in the A pose)
    back = C.normalize(np.array((math.sin(ang), 0.0, math.cos(ang))))
    side = C.normalize(np.cross(fd, back))  # points forward-ish (thumb side) for the left hand
    if side[1] > 0:
        side = -side
    arm_z = fwd
    L = {}
    L["clavicle"] = (clav_h, shoulder, up)
    L["upperarm"] = (shoulder, elbow, arm_z)
    L["lowerarm"] = (elbow, wrist, arm_z)
    L["hand"] = (wrist, knuckle, back)
    # fingers: (base offset along hand, across (thumb side +), length of 3 phalanges, splay deg)
    hs = b["hand"]
    fspec = {
        "index": (0.0, 0.026, (0.036, 0.024, 0.020), 4.0),
        "middle": (0.004, 0.008, (0.040, 0.026, 0.021), 0.0),
        "ring": (0.0, -0.010, (0.037, 0.024, 0.019), -4.0),
        "pinky": (-0.008, -0.026, (0.029, 0.019, 0.017), -9.0),
    }
    for f, (along, across, lens, splay) in fspec.items():
        base = knuckle + fd * along * hs + side * across * hs - back * 0.004 * hs
        d = C.normalize(np.asarray(fd) @ C.rot_axis(back, math.radians(splay)).T)
        p = base
        for i, ln in enumerate(lens, start=1):
            q = p + d * ln * hs
            L[f"{f}_0{i}"] = (p, q, back)
            p = q
    # thumb: from the wrist on the palm side, pointing forward and along the hand
    tb = wrist + fd * 0.022 * hs + side * 0.024 * hs - back * 0.018 * hs
    td = C.normalize(fd * 0.85 + side * 0.50 - back * 0.30)
    tz = C.normalize(np.cross(td, fd) * -1.0 + back * 0.3)
    p = tb
    for i, ln in enumerate((0.028, 0.022, 0.019), start=1):
        q = p + td * ln * hs
        L[f"thumb_0{i}"] = (p, q, tz)
        p = q
        td = C.normalize(td + fd * 0.25)

    for name, (h, tl, z) in L.items():
        bone(f"{name}_l", h, tl, z)
        bone(f"{name}_r", mirror_x(h), mirror_x(tl), mirror_x(z))

    # legs
    for s, sx in (("l", 1), ("r", -1)):
        hip = np.array((sx * hip_x, 0.0, HIP_Z))
        knee = np.array((sx * hip_x * 0.97, -0.006, KNEE_Z))
        ankle = np.array((sx * hip_x * 0.95, 0.018, ANKLE_Z))
        ball = np.array((sx * hip_x * 1.02, -0.105, 0.022))
        toe = np.array((sx * hip_x * 1.04, -0.170, 0.022))
        bone(f"thigh_{s}", hip, knee, fwd)
        bone(f"calf_{s}", knee, ankle, fwd)
        bone(f"foot_{s}", ankle, ball, up)
        bone(f"ball_{s}", ball, toe, up)
    J["_body"] = b
    J["_head_center"] = hc
    return J


def head_center(J, body):
    """Centre of the head SDF (origin of the radial projection), relative to the Head joint."""
    hd = np.asarray(J["Head"]["head"], float)
    return hd + np.array((0.0, -0.010, 0.078)) * body.get("head", 1.0)


def build_armature(name: str, J: dict, coll=None) -> bpy.types.Object:
    arm_data = bpy.data.armatures.new(name)
    arm = bpy.data.objects.new(name, arm_data)
    (coll or bpy.context.scene.collection).objects.link(arm)
    arm_data.display_type = "STICK"
    view = bpy.context.view_layer
    prev_active = view.objects.active
    view.objects.active = arm
    for o in view.objects:
        o.select_set(False)
    arm.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    ebs = {}
    for bn in BONE_ORDER:
        d = J[bn]
        eb = arm_data.edit_bones.new(bn)
        eb.head = Vector(d["head"])
        eb.tail = Vector(d["tail"])
        eb.align_roll(Vector(d["z"]))
        ebs[bn] = eb
    for bn in BONE_ORDER:
        p = PARENT[bn]
        if p:
            ebs[bn].parent = ebs[p]
            ebs[bn].use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    view.objects.active = prev_active
    return arm
