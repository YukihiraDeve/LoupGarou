"""Loup-Garou characters: export characters.blend -> client/public/assets/characters (GLB + manifest).

  3DLib/tools/blender -b blender/characters/characters.blend --python blender/characters/scripts/lg_export.py

Raw exports go to blender/characters/export/, then gltf-transform (meshopt + WebP 1024) writes the web files.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402
import numpy as np  # noqa: E402

import lg_assemble  # noqa: E402
import lg_specs  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
RAW = os.path.join(ROOT, "blender", "characters", "export")
OUT = os.path.join(ROOT, "client", "public", "assets", "characters")
GT = os.path.join(ROOT, "3DLib", "tools", "node_modules", ".bin", "gltf-transform")
POST = os.path.join(HERE, "lg_postprocess.cjs")

HOLD = {"Sit_Point", "Sit_RaiseHand"}


def select_only(objs):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        o.hide_set(False)
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


def export_character(cid, path):
    arm = bpy.data.objects[f"{cid}_rig"]
    mesh = bpy.data.objects[cid]
    if arm.animation_data:
        arm.animation_data.action = None
    for pb in arm.pose.bones:
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)
    for kb in mesh.data.shape_keys.key_blocks:
        kb.value = 0.0
    select_only([arm, mesh])
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True, export_animations=False,
        export_skins=True, export_morph=True, export_morph_normal=True, export_morph_tangent=False,
        export_apply=False, export_yup=True, export_texcoords=True, export_normals=True, export_tangents=False,
        export_materials="EXPORT", export_image_format="AUTO", export_def_bones=False,
        export_extras=False, export_cameras=False, export_lights=False)


def export_anims(path):
    arm = bpy.data.objects["anims_rig"]
    select_only([arm])
    names = [a.name for a in bpy.data.actions if a.use_fake_user and not a.name.startswith(("A_", "Sitting", "Idle"))]
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True, export_animations=True,
        export_animation_mode="ACTIONS", export_force_sampling=True, export_frame_step=1,
        export_optimize_animation_size=False, export_anim_single_armature=True, export_skins=True,
        export_morph=False, export_bake_animation=False, export_reset_pose_bones=True,
        export_anim_slide_to_zero=True, export_def_bones=False, export_extras=False)
    return names


def seated_eye_offset(cid):
    """Eye midpoint relative to the pelvis bone in the Sit_Idle first frame, three.js axes (x, y up, z fwd)."""
    arm = bpy.data.objects[f"{cid}_rig"]
    act = bpy.data.actions.get("Sit_Idle")
    if act is None:
        return None
    arm.animation_data_create()
    arm.animation_data.action = act
    if hasattr(arm.animation_data, "action_slot") and len(act.slots):
        arm.animation_data.action_slot = act.slots[0]
    bpy.context.scene.frame_set(1)
    bpy.context.view_layer.update()
    mw = arm.matrix_world
    pel = mw @ arm.pose.bones["pelvis"].head
    e = (mw @ arm.pose.bones["eye_l"].head + mw @ arm.pose.bones["eye_r"].head) / 2
    d = e - pel
    arm.animation_data.action = None
    # Blender (x, y, z) -> three.js (x, z, -y)
    return [round(d.x, 4), round(d.z, 4), round(-d.y, 4)]


def run(cmd):
    print("RUN", " ".join(cmd))
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stdout, r.stderr)
        raise RuntimeError("command failed")
    return r.stdout


def main():
    os.makedirs(RAW, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    stats_path = os.path.join(ROOT, "blender", "characters", "build_stats.json")
    stats = json.load(open(stats_path)) if os.path.exists(stats_path) else {}
    entries = []
    wolf = None
    eye_offsets = {}
    for spec in lg_specs.CHARACTERS:
        cid = spec["id"]
        if f"{cid}_rig" not in bpy.data.objects:
            print("skip", cid)
            continue
        eye_offsets[cid] = seated_eye_offset(cid)
        raw = os.path.join(RAW, f"{cid}.glb")
        export_character(cid, raw)
        out = os.path.join(OUT, f"{cid}.glb")
        run([GT, "optimize", raw, out, "--compress", "meshopt", "--texture-compress", "webp", "--texture-size", "1024",
             "--flatten", "false", "--join", "false", "--instance", "false", "--palette", "false", "--simplify", "false",
             "--prune-solid-textures", "false"])
        st = stats.get(cid, {})
        e = dict(id=cid, name=spec["name"], description=spec["description"],
                 height=round(st.get("height", 0.0), 3), file=f"{cid}.glb",
                 scale=spec.get("scale", 1.0), triangles=st.get("tris"), bones=st.get("bones"),
                 bytes=os.path.getsize(out), sitPelvisHeight=round(0.45 * spec.get("scale", 1.0), 3),
                 seatedEyeOffset=eye_offsets[cid])
        if spec.get("werewolf"):
            e["emissiveMaterials"] = ["EMIT_eyes"]
            wolf = e
        else:
            entries.append(e)
    clips = []
    if "anims_rig" in bpy.data.objects:
        raw = os.path.join(RAW, "anims.glb")
        export_anims(raw)
        tmp = os.path.join(RAW, "anims_clean.glb")
        run(["node", POST, "anims", raw, tmp])
        out = os.path.join(OUT, "anims.glb")
        run([GT, "optimize", tmp, out, "--compress", "meshopt", "--flatten", "false", "--join", "false",
             "--instance", "false", "--palette", "false", "--simplify", "false"])
        for c in stats.get("_clips", []):
            clips.append(dict(name=c["name"], duration=c["duration"], loop=c["loop"],
                              hold=c["name"] in HOLD))
    manifest = dict(
        version=1,
        characters=entries,
        werewolf=wolf,
        anims="anims.glb",
        clips=clips,
        morphTargets=list(lg_assemble.MORPHS),
        lookBones=dict(neck="neck_01", head="Head", eyes=["eye_l", "eye_r"],
                       note="In the bind pose these bones' local axes match the model axes (+X = character's left, "
                            "+Y = up, +Z = forward): yaw = rotation about local Y, pitch about local X."),
        seat=dict(bone="pelvis", seatHeight=0.45,
                  note="In every Sit_* clip the pelvis joint is ON the seat surface (0.45 m for scale 1) with the feet "
                       "flat on the ground; align the pelvis bone world position with the seat_XX marker. "
                       "With the character scale the seated pelvis sits at sitPelvisHeight above the feet "
                       "(0.414-0.477 m), so on a 0.45 m seat the feet float/sink by up to ~4 cm; "
                       "Sit_Stand ends standing ~0.24 m in front of the seat point, Stand_Sit starts there."),
        firstPerson=dict(hideBone="Head",
                         note="Scale the Head bone to 0 on your own avatar; seatedEyeOffset = eye midpoint relative to "
                              "the pelvis bone in Sit_Idle (three.js axes, metres, character scale included)."),
        orientation="Origin on the ground between the feet, facing +Z, 1 unit = 1 m.",
        compression="EXT_meshopt_compression + KHR_mesh_quantization + EXT_texture_webp: "
                    "GLTFLoader.setMeshoptDecoder(MeshoptDecoder) is required.",
        clipsNotes={
            "Sit_Point": "right arm extended straight forward, index finger; hold the last frame, rotate the torso towards the target",
            "Sit_RaiseHand": "right hand raised; hold the last frame",
            "Sit_Death": "ends lying on the ground in front of the seat (clampWhenFinished)",
            "Wolf_Howl": "drive the MouthOpen morph target during the howl (0.6 s .. 3.0 s)",
            "Stand_Idle": "retargeted from Quaternius UAL Idle_Loop (CC0)",
            "Walk": "in place, retargeted from Quaternius UAL Walk_Loop (CC0)",
        },
    )
    with open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
    print("MANIFEST written", len(entries), "characters", len(clips), "clips")


if __name__ == "__main__":
    main()
