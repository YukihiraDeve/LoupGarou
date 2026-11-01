# Rebuild the whole camp scene (geometry + markers) in the interactive Blender (Blender MCP):
#   p = ".../blender/scene/scripts/build_all.py"; exec(compile(open(p).read(), p, "exec"))
# Full pipeline:
#   1. build_all.py                  (01..10: setup, terrain, fire+benches+seats, tents, chalets, tower, lights,
#                                     forest, props, markers)            ~5 s
#   2. 12_bake.py                    AO bake (Cycles, vertex colours + ground texture) ~15 s; save camp.blend
#      (COMBINE_ONLY=True in the exec globals re-applies AO strength/gamma without re-baking)
#   3. Blender -b blender/scene/camp.blend --python blender/scene/scripts/13_export.py -- --out blender/scene/tmp/camp_raw.glb
#   4. node blender/scene/scripts/14_optimize.mjs blender/scene/tmp/camp_raw.glb client/public/assets/camp/camp.glb
#   5. node blender/scene/scripts/check_glb.mjs blender/scene/tmp/camp_raw.glb client/public/assets/camp/camp.glb
#   6. python3 blender/scene/scripts/15_manifest.py   (+ inspect_glb.py for a quick report)
# Previews: 11_preview.py (render_view("seat_08", "night", path), view_intro(), ...).
LIB = "/Users/valentinbour/Desktop/Git/LoupGarou/blender/scene/scripts/_lib.py"
exec(compile(open(LIB).read(), LIB, "exec"))
import time
STEPS = ["01_setup.py", "02_terrain.py", "03_fire_benches.py", "04_tents.py", "05_chalets.py", "06_tower.py",
         "07_lights.py", "08_forest.py", "09_props.py", "10_markers.py"]
report = {}
for s in STEPS:
    t0 = time.time()
    g = run_step(s)
    report[s] = {"result": g.get("result"), "seconds": round(time.time() - t0, 2)}
result = report
