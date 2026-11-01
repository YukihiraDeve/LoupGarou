#!/usr/bin/env python3
"""Step 15: write client/public/assets/camp/camp_manifest.json from the final GLB (stdlib only).
   /usr/local/bin/python3 blender/scene/scripts/15_manifest.py"""
import json, math, os, sys
import importlib.util

ROOT = "/Users/valentinbour/Desktop/Git/LoupGarou"
GLB = ROOT + "/client/public/assets/camp/camp.glb"
OUT = ROOT + "/client/public/assets/camp/camp_manifest.json"
spec = importlib.util.spec_from_file_location("ig", ROOT + "/blender/scene/scripts/inspect_glb.py")
ig = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ig)

r = ig.analyse(GLB)
js, _, _ = ig.read_glb(GLB)


def r3(v):
    return [round(x, 3) for x in v]


markers = {"fire": None, "seats": [], "lights": {"lantern": [], "window": [], "string": []}, "cam_intro": None}
for m in r["markers"]:
    n = m["name"]
    if n == "fire":
        markers["fire"] = {"name": n, "position": r3(m["pos"])}
    elif n.startswith("seat_"):
        markers["seats"].append({"name": n, "position": r3(m["pos"]), "quaternion": m["rot"],
                                 "forward": r3(m["fwd_z"])})
    elif n.startswith("light_"):
        kind = n.split("_")[1]
        markers["lights"][kind].append({"name": n, "position": r3(m["pos"])})
    elif n == "cam_intro":
        cam = js["cameras"][0]["perspective"]
        f = ig.quat_rotate(m["rot"], (0, 0, -1))
        # target: where the view ray hits y = 0.3 (centre of the camp)
        t = (m["pos"][1] - 0.3) / -f[1]
        markers["cam_intro"] = {"name": n, "position": r3(m["pos"]), "quaternion": m["rot"],
                                "forward": r3(f), "target": r3([m["pos"][i] + f[i] * t for i in range(3)]),
                                "yfov_deg": round(math.degrees(cam["yfov"]), 2), "aspect": round(cam["aspectRatio"], 4)}
for k in markers["lights"]:
    markers["lights"][k].sort(key=lambda x: x["name"])
markers["seats"].sort(key=lambda x: x["name"])

emit = {}
for mat in js["materials"]:
    if mat["name"].startswith("EMIT_"):
        e = mat.get("emissiveFactor", [0, 0, 0])
        s = mat.get("extensions", {}).get("KHR_materials_emissive_strength", {}).get("emissiveStrength", 1.0)
        emit[mat["name"]] = {"emissive": r3(e), "emissiveIntensity_night": round(s, 3),
                             "baseColor": r3(mat.get("pbrMetallicRoughness", {}).get("baseColorFactor", [1, 1, 1, 1])[:3])}
EMIT_DESC = {
    "EMIT_embers": "braises du foyer + bouts incandescents des buches (pas de flamme : le client fait les flammes)",
    "EMIT_window": "fenetres des chalets et cabane de la tour de guet",
    "EMIT_bulbs": "ampoules des guirlandes",
    "EMIT_lantern": "verre des lanternes (poteaux, porche, tour, table, lanternes posees au sol)",
    "EMIT_tent": "toile de la tente cloche eclairee de l'interieur (tent_1) - ajout au contrat",
}
for k in emit:
    emit[k]["usage"] = EMIT_DESC.get(k, "")

manifest = {
    "file": "camp.glb",
    "generator": "blender/scene/scripts (Blender 5.2, glTF Transform 4.5)",
    "units": "metres, Y up (three.js); Blender -Y = three.js +Z",
    "file_size_bytes": os.path.getsize(GLB),
    "triangles": r["triangles"],
    "draw_calls_approx": r["draw_calls_approx"],
    "materials_count": r["n_materials"],
    "materials": r["materials"],
    "emissive_materials": emit,
    "instancing": {"nodes": r["instanced_nodes"], "instances": r["instances"],
                   "extension": "EXT_mesh_gpu_instancing"},
    "textures": [{"name": n, "mime": m} for n, m in r["images"]],
    "extensions_used": r["extensions_used"],
    "markers": markers,
    "seat_count": len(markers["seats"]),
    "seat_height_range": [min(s["position"][1] for s in markers["seats"]),
                          max(s["position"][1] for s in markers["seats"])],
    "notes": [
        "Chargement : GLTFLoader + MeshoptDecoder obligatoire (EXT_meshopt_compression, KHR_mesh_quantization) ; "
        "three.js r15x+ gere EXT_mesh_gpu_instancing (InstancedMesh) et EXT_texture_webp.",
        "Marqueurs = noeuds vides a la racine (aucun parent) : la position/rotation locale est la position monde.",
        "seat_XX : bassin du personnage assis (surface d'assise, 0,44-0,46 m), +Z local tourne vers le feu ; "
        "ordre trigonometrique vu du dessus, seat_00 en +Z (face a cam_intro qui est en -Z).",
        "Yeux du joueur assis : environ siege + (0, 0,70, 0) en Y, legerement avance de 0,05-0,1 m vers le feu.",
        "fire : centre du foyer au sol ; cercle de pierres rayon ~0,93 m, lit de braises rayon ~0,6 m, buches jusqu'a "
        "0,5 m de haut : les flammes du client peuvent occuper un cone de ~0,55 m de rayon x 1,4 m.",
        "Couleur de base = COLOR_0 (albedo x occlusion ambiante cuite) : garder material.vertexColors (fait "
        "automatiquement par GLTFLoader). Le sol (materiau 'ground') porte l'AO dans sa texture 2048 px.",
        "Materiau 'bark' = texture de detail d'ecorce (repeat) x COLOR_0 ; materiaux 'fabric' et 'grass' doubleSided.",
        "EMIT_* : emissiveIntensity exportee = valeur de nuit (KHR_materials_emissive_strength). Le jour, la "
        "multiplier par ~0,05-0,15 (EMIT_embers peut garder ~0,4).",
        "Lumieres ponctuelles conseillees : light_window_* (orange chaud ~#ffa04a, portee 6-8 m), "
        "light_lantern_* (~#ff9a40, portee 4-5 m), light_string_* (blanc chaud ~#ffc777, portee 4 m). "
        "Allumer les plus proches du joueur selon la qualite.",
        "Pas de ciel dans le GLB : 'camp_mountain' (silhouettes a 250-400 m) et 'treeline' (dans camp_foliage, "
        "anneau de silhouettes de sapins a ~66 m) ferment l'horizon ; prevoir camera.far >= 800 m et un brouillard "
        "teinte (le sol lointain monte en cuvette jusqu'a ~16 m).",
        "Ombres : seuls les objets proches meritent castShadow (camp_bark, camp_wood, camp_stone, camp_fabric, "
        "camp_paint, sapins proches) ; le sol 'camp_ground' doit receiveShadow.",
        "Aucun element de la scene dans un rayon de 2,6 m autour du feu hormis les pierres et les buches du foyer : "
        "l'espace devant les sieges (jambes) est plat (y = 0).",
    ],
}
json.dump(manifest, open(OUT, "w"), indent=1, ensure_ascii=False)
print(json.dumps({k: manifest[k] for k in ("file_size_bytes", "triangles", "materials_count", "seat_count",
                                            "seat_height_range")}))
print("lights:", {k: len(v) for k, v in markers["lights"].items()}, "cam:", markers["cam_intro"])
