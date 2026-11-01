"""Loup-Garou characters: build every character (and the shared animation rig) into characters.blend.

Usage (command line Blender, from anywhere):
  3DLib/tools/blender -b --factory-startup --python blender/characters/scripts/lg_build.py -- [--only camper_01,werewolf] [--no-anims]
"""
from __future__ import annotations

import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402

import lg_anims as AN  # noqa: E402
import lg_character as CH  # noqa: E402
import lg_clips as CL  # noqa: E402
import lg_skeleton as SK  # noqa: E402
import lg_specs  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
BLEND = os.path.join(ROOT, "blender", "characters", "characters.blend")


def main(argv):
    only = None
    anims = True
    if "--only" in argv:
        only = argv[argv.index("--only") + 1].split(",")
    if "--no-anims" in argv:
        anims = False
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.fps = AN.FPS
    stats = {}
    for spec in lg_specs.CHARACTERS:
        if only and spec["id"] not in only:
            continue
        t0 = time.time()
        coll = bpy.data.collections.new(spec["id"])
        sc.collection.children.link(coll)
        arm, obj, st, info = CH.build_character(spec, coll)
        st["time"] = round(time.time() - t0, 2)
        stats[spec["id"]] = st
        print("BUILT", spec["id"], st)
    if anims:
        coll = bpy.data.collections.new("anims")
        sc.collection.children.link(coll)
        ref = SK.build_armature("anims_rig", SK.layout({}), coll)
        rig = AN.Rig(ref)
        clips = CL.make_all(rig, use_source=True)
        meta = []
        for c in clips:
            AN.bake_clip(rig, c)
            meta.append(dict(name=c.name, duration=round(c.duration, 4), loop=c.loop))
        stats["_clips"] = meta
        print("CLIPS", meta)
    bpy.ops.wm.save_as_mainfile(filepath=BLEND, compress=True)
    with open(os.path.join(ROOT, "blender", "characters", "build_stats.json"), "w") as f:
        json.dump(stats, f, indent=1, ensure_ascii=False)


if __name__ == "__main__":
    main(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
