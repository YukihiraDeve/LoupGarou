"""Loup-Garou characters: preview boards rendered with EEVEE (command line) into docs/previews/char_*.png.

  3DLib/tools/blender -b blender/characters/characters.blend --python blender/characters/scripts/lg_previews.py -- [boards]

boards: lineup, night, faces, firstperson, clips (default: all)
"""
from __future__ import annotations

import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Vector  # noqa: E402

import lg_render as R  # noqa: E402
import lg_specs  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT = os.path.join(ROOT, "docs", "previews")
TMP = os.path.join(ROOT, "blender", "characters", "export", "tmp_previews")
IDS = [c["id"] for c in lg_specs.CHARACTERS]
CAMPERS = [i for i in IDS if i.startswith("camper")]
SEAT = 0.45


def rig(cid):
    return bpy.data.objects[f"{cid}_rig"]


def set_action(cid, name, t):
    a = rig(cid)
    act = bpy.data.actions[name]
    a.animation_data_create()
    a.animation_data.action = act
    if hasattr(a.animation_data, "action_slot") and len(act.slots):
        a.animation_data.action_slot = act.slots[0]
    # each rig evaluates its own action at the scene frame: use an NLA-free offset via action frame range
    a["_t"] = t


def show_only(ids):
    for c in bpy.data.collections:
        if c.name in IDS or c.name == "anims":
            c.hide_render = c.name not in ids


def reset_rigs():
    for cid in IDS:
        a = rig(cid)
        a.location = (0, 0, 0)
        a.rotation_euler = (0, 0, 0)
        if a.animation_data:
            a.animation_data.action = None
        for pb in a.pose.bones:
            pb.rotation_quaternion = (1, 0, 0, 0)
            pb.location = (0, 0, 0)
            pb.scale = (1, 1, 1)
        me = bpy.data.objects[cid]
        for kb in me.data.shape_keys.key_blocks:
            kb.value = 0.0


def pose_at(cid, name, t):
    """Bake the pose of clip `name` at time t into the rig (pose bones), then drop the action."""
    a = rig(cid)
    act = bpy.data.actions[name]
    a.animation_data_create()
    a.animation_data.action = act
    if hasattr(a.animation_data, "action_slot") and len(act.slots):
        a.animation_data.action_slot = act.slots[0]
    frame = 1 + t * 30.0
    bpy.context.scene.frame_set(int(frame), subframe=frame - int(frame))
    vals = {pb.name: (pb.rotation_quaternion.copy(), pb.location.copy()) for pb in a.pose.bones}
    a.animation_data.action = None
    for pb in a.pose.bones:
        q, l = vals[pb.name]
        pb.rotation_quaternion = q
        pb.location = l
    bpy.context.view_layer.update()


def place_on_seat(cid, angle, radius, seat=SEAT):
    """Seat marker on a circle facing the centre: the pelvis bone lands on the marker (contract)."""
    a = rig(cid)
    s = a.scale[0]
    # pelvis in seated clips is at (0, 0, 0.45) in armature space
    a.rotation_euler = (0, 0, angle - math.pi / 2)
    a.location = (math.cos(angle) * radius, math.sin(angle) * radius, seat - SEAT * s)


def add_log(angle, radius, length=1.0, name="PV_log"):
    bpy.ops.mesh.primitive_cylinder_add(radius=0.21, depth=length, vertices=16,
                                        location=(math.cos(angle) * radius, math.sin(angle) * radius, 0.24))
    o = bpy.context.active_object
    o.name = name
    o.rotation_euler = (math.pi / 2, 0, angle + math.pi / 2)
    o.rotation_euler = (0, math.pi / 2, angle + math.pi / 2)
    mat = bpy.data.materials.get("PV_wood") or bpy.data.materials.new("PV_wood")
    mat.use_nodes = True
    mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.22, 0.13, 0.07, 1)
    mat.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.9
    o.data.materials.append(mat)
    return o


def fire():
    mat = bpy.data.materials.get("PV_fire") or bpy.data.materials.new("PV_fire")
    mat.use_nodes = True
    b = mat.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (1, 0.5, 0.1, 1)
    b.inputs["Emission Color"].default_value = (1.0, 0.45, 0.08, 1)
    b.inputs["Emission Strength"].default_value = 18.0
    for i in range(5):
        a = i / 5 * math.tau
        bpy.ops.mesh.primitive_cone_add(radius1=0.12, depth=0.55 + 0.15 * (i % 2), vertices=8,
                                        location=(math.cos(a) * 0.08, math.sin(a) * 0.08, 0.3))
        o = bpy.context.active_object
        o.name = f"PV_flame{i}"
        o.data.materials.append(mat)
    R.add_light("fire", "POINT", (0, 0, 0.55), 900, (1.0, 0.55, 0.22), size=0.25)
    R.add_light("fire2", "POINT", (0, 0, 1.1), 250, (1.0, 0.62, 0.3), size=0.4)
    sun = R.add_light("moon", "SUN", (0, 0, 10), 0.25, (0.55, 0.65, 1.0))
    sun.rotation_euler = (math.radians(50), 0, math.radians(30))


def clear_props():
    for o in list(bpy.data.objects):
        if o.name.startswith("PV_"):
            bpy.data.objects.remove(o, do_unlink=True)


def compose(files, out, cols, scale=1.0):
    imgs = []
    for f in files:
        im = bpy.data.images.load(f)
        w, h = im.size
        px = np.array(im.pixels[:], dtype=np.float32).reshape(h, w, 4)
        imgs.append(px)
        bpy.data.images.remove(im)
    h, w = imgs[0].shape[:2]
    rows = (len(imgs) + cols - 1) // cols
    board = np.zeros((rows * h, cols * w, 4), dtype=np.float32)
    board[..., 3] = 1
    for i, px in enumerate(imgs):
        r, c = divmod(i, cols)
        # pixel rows are bottom-up in Blender
        y0 = (rows - 1 - r) * h
        board[y0:y0 + h, c * w:(c + 1) * w] = px
    img = bpy.data.images.new("board", cols * w, rows * h, alpha=True)
    img.pixels.foreach_set(board.ravel())
    img.filepath_raw = out
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)


# ------------------------------------------------------------------------------------------------

def board_lineup():
    reset_rigs()
    clear_props()
    show_only(IDS)
    R.setup_scene(res=(2600, 1000))
    R.studio_lights((0, 0, 1.0), scale=2.4)
    R.ground()
    for i, cid in enumerate(IDS):
        pose_at(cid, "Stand_Idle" if cid != "werewolf" else "Wolf_Idle", 0.4 + 0.2 * i)
        rig(cid).location.x = (i - 5) * 0.72
        rig(cid).rotation_euler.z = math.radians(-12 + 2.4 * i)
    R.add_camera((0.15, -12.4, 1.5), (0.15, 0, 0.95), lens=50)
    R.render(os.path.join(OUT, "char_lineup.png"))


def board_night(name="char_night.png", cam=None):
    reset_rigs()
    clear_props()
    show_only(IDS)
    R.setup_scene(res=(2200, 1250), night=True, samples=48)
    R.ground(color=(0.10, 0.075, 0.055, 1))
    fire()
    poses = {
        "camper_01": ("Sit_Talk", 1.2), "camper_02": ("Sit_Idle", 0.5), "camper_03": ("Sit_Idle", 2.0),
        "camper_04": ("Sit_Awake_Night", 1.0), "camper_05": ("Sit_Point", 0.9), "camper_06": ("Sit_Sleep", 1.0),
        "camper_07": ("Sit_RaiseHand", 0.8), "camper_08": ("Sit_Idle", 3.0), "camper_09": ("Sit_Shocked", 0.5),
        "camper_10": ("Sit_Nod", 0.4), "werewolf": ("Sit_Awake_Night", 2.5),
    }
    radius = 2.3
    n = len(IDS)
    for i, cid in enumerate(IDS):
        ang = -math.pi / 2 + (i + 0.5) / n * math.tau + math.pi
        clip, t = poses[cid]
        pose_at(cid, clip, t)
        place_on_seat(cid, ang, radius)
        add_log(ang, radius, 0.95, f"PV_log{i}")
    if cam is None:
        R.add_camera((0.0, -5.6, 2.6), (0, 0.2, 0.75), lens=32)
    else:
        R.add_camera(*cam)
    R.render(os.path.join(OUT, name))


def board_faces():
    show_only(IDS)
    files = []
    for cid in ["camper_01", "camper_02", "camper_08", "camper_10", "camper_06", "werewolf"]:
        reset_rigs()
        clear_props()
        show_only([cid])
        R.setup_scene(res=(520, 560))
        R.studio_lights((0, 0, 1.6))
        me = bpy.data.objects[cid]
        a = rig(cid)
        hc = a.matrix_world @ a.pose.bones["Head"].head
        eye = (a.matrix_world @ a.pose.bones["eye_l"].head + a.matrix_world @ a.pose.bones["eye_r"].head) / 2
        tgt = Vector((0, eye.y, eye.z - 0.03))
        for state in ("", "Blink", "EyesHalf", "Smile", "MouthOpen", "Worried"):
            for kb in me.data.shape_keys.key_blocks[1:]:
                kb.value = 1.0 if kb.name == state else 0.0
            R.clear_lights_cameras("PV_cam")
            R.add_camera((0.16, eye.y - 0.62, eye.z + 0.02), tgt, lens=85)
            f = os.path.join(TMP, f"face_{cid}_{state or 'open'}.png")
            R.render(f)
            files.append(f)
    compose(files, os.path.join(OUT, "char_faces.png"), 6)


def board_night7m():
    """Night, seen from a seat on the far side of a 3.5 m radius circle (~7 m away), at seated eye height:
    left = game-like field of view, right = 3x zoom on the same faces."""
    reset_rigs()
    clear_props()
    show_only(IDS)
    R.setup_scene(res=(1300, 900), night=True, samples=48)
    R.ground(color=(0.10, 0.075, 0.055, 1))
    fire()
    radius = 3.5
    opp = ["camper_02", "camper_08", "camper_01", "camper_10", "camper_09", "werewolf", "camper_04"]
    poses = [("Sit_Idle", 0.3), ("Sit_Talk", 1.1), ("Sit_Idle", 1.6), ("Sit_Nod", 0.3), ("Sit_Idle", 2.4),
             ("Sit_Awake_Night", 1.0), ("Sit_Idle", 3.2)]
    show_only(opp)
    for i, cid in enumerate(opp):
        ang = math.pi / 2 + (i - 3) * (math.tau / 16)
        pose_at(cid, *poses[i])
        place_on_seat(cid, ang, radius)
        add_log(ang, radius, 0.95, f"PV_log{i}")
    eye = (0.0, -radius + 0.12, 1.24)
    files = []
    for k, lens in (("wide", 18), ("zoom", 54)):
        R.clear_lights_cameras("PV_cam")
        R.add_camera(eye, (0.0, radius, 1.05 if k == "wide" else 1.15), lens=lens)
        f = os.path.join(TMP, f"night7m_{k}.png")
        R.render(f)
        files.append(f)
    compose(files, os.path.join(OUT, "char_night_7m.png"), 2)


def board_firstperson():
    """Own avatar seated, Head scaled to 0, camera at the eyes looking at the fire."""
    board_night_setup_only = True
    reset_rigs()
    clear_props()
    show_only(IDS)
    R.setup_scene(res=(1600, 900), night=True, samples=48)
    R.ground(color=(0.10, 0.075, 0.055, 1))
    fire()
    radius = 2.3
    n = len(IDS)
    poses = {cid: ("Sit_Idle", 0.3 * i) for i, cid in enumerate(IDS)}
    poses["camper_04"] = ("Sit_Talk", 1.0)
    for i, cid in enumerate(IDS):
        ang = -math.pi / 2 + (i + 0.5) / n * math.tau + math.pi
        pose_at(cid, *poses[cid])
        place_on_seat(cid, ang, radius)
        add_log(ang, radius, 0.95, f"PV_log{i}")
    me_id = "camper_01"
    a = rig(me_id)
    a.pose.bones["Head"].scale = (0.0, 0.0, 0.0)
    bpy.context.view_layer.update()
    mw = a.matrix_world
    eye = (mw @ a.pose.bones["eye_l"].head + mw @ a.pose.bones["eye_r"].head) / 2
    # the eye bones are collapsed with the head: use the rest offset from the neck instead
    a.pose.bones["Head"].scale = (1, 1, 1)
    bpy.context.view_layer.update()
    eye = (mw @ a.pose.bones["eye_l"].head + mw @ a.pose.bones["eye_r"].head) / 2
    a.pose.bones["Head"].scale = (0.0, 0.0, 0.0)
    bpy.context.view_layer.update()
    to_fire = Vector((0, 0, eye.z)) - eye
    look = eye + to_fire.normalized() * 1.0
    look.z = eye.z - math.tan(math.radians(44))
    cam = R.add_camera(tuple(eye), tuple(look), lens=15)
    cam.data.clip_start = 0.05
    R.render(os.path.join(OUT, "char_firstperson.png"))
    a.pose.bones["Head"].scale = (1, 1, 1)


def board_clips():
    clips = ["Sit_Idle", "Sit_Talk", "Sit_Sleep", "Sit_Awake_Night", "Sit_Point", "Sit_RaiseHand", "Sit_Nod",
             "Sit_Shake", "Sit_Shocked", "Sit_Death", "Sit_Stand", "Stand_Sit", "Stand_Idle", "Walk", "Wolf_Idle",
             "Wolf_Howl"]
    times = {"Sit_Point": 0.9, "Sit_RaiseHand": 0.8, "Sit_Nod": 0.35, "Sit_Shake": 0.45, "Sit_Shocked": 0.5,
             "Sit_Death": 3.0, "Sit_Stand": 0.55, "Stand_Sit": 0.55, "Walk": 0.3, "Wolf_Howl": 1.6, "Sit_Talk": 1.0}
    files = []
    for clip in clips:
        cid = "werewolf" if clip.startswith("Wolf") else "camper_05"
        reset_rigs()
        clear_props()
        show_only([cid])
        R.setup_scene(res=(520, 560))
        R.studio_lights((0, 0, 0.9))
        R.ground()
        pose_at(cid, clip, times.get(clip, 0.5))
        if clip.startswith("Sit") and clip != "Sit_Stand":
            add_log(math.pi / 2, -0.02, 0.9, "PV_log")
            bpy.data.objects["PV_log"].location = (0, 0.02, 0.24)
            bpy.data.objects["PV_log"].rotation_euler = (0, math.pi / 2, 0)
        R.add_camera((1.55, -2.0, 1.25), (0, -0.22, 0.72), lens=33)
        f = os.path.join(TMP, f"clip_{clip}.png")
        R.render(f)
        files.append(f)
    compose(files, os.path.join(OUT, "char_clips.png"), 8)


def main(argv):
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(TMP, exist_ok=True)
    bpy.context.scene.render.fps = 30
    boards = argv or ["lineup", "night", "faces", "firstperson", "clips"]
    for b in boards:
        globals()[f"board_{b}"]()


if __name__ == "__main__":
    main(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
