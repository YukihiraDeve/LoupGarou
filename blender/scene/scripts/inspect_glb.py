#!/usr/bin/env python3
"""Inspect a camp GLB (stdlib only): nodes, markers, materials, triangles, instancing, seat orientation.
Usage: python3 inspect_glb.py file.glb [--json]"""
import json, struct, sys, math


def read_glb(path):
    data = open(path, "rb").read()
    magic, version, length = struct.unpack_from("<III", data, 0)
    assert magic == 0x46546C67, "not a GLB"
    off = 12
    js, binc = None, None
    while off < length:
        clen, ctype = struct.unpack_from("<II", data, off)
        chunk = data[off + 8: off + 8 + clen]
        if ctype == 0x4E4F534A:
            js = json.loads(chunk)
        elif ctype == 0x004E4942:
            binc = chunk
        off += 8 + clen
    return js, binc, len(data)


def quat_rotate(q, v):
    x, y, z, w = q
    # v' = q v q*
    ix = w * v[0] + y * v[2] - z * v[1]
    iy = w * v[1] + z * v[0] - x * v[2]
    iz = w * v[2] + x * v[1] - y * v[0]
    iw = -x * v[0] - y * v[1] - z * v[2]
    return (ix * w + iw * -x + iy * -z - iz * -y,
            iy * w + iw * -y + iz * -x - ix * -z,
            iz * w + iw * -z + ix * -y - iy * -x)


def analyse(path):
    js, binc, size = read_glb(path)
    nodes = js.get("nodes", [])
    meshes = js.get("meshes", [])
    acc = js.get("accessors", [])
    mats = js.get("materials", [])

    def prim_tris(p):
        if "indices" in p:
            return acc[p["indices"]]["count"] // 3
        return acc[p["attributes"]["POSITION"]]["count"] // 3

    mesh_tris = [sum(prim_tris(p) for p in m["primitives"]) for m in meshes]
    total = 0
    draws = 0
    inst_nodes = 0
    instances = 0
    for n in nodes:
        if "mesh" in n:
            k = 1
            ext = n.get("extensions", {}).get("EXT_mesh_gpu_instancing")
            if ext:
                k = acc[list(ext["attributes"].values())[0]]["count"]
                inst_nodes += 1
                instances += k
            total += mesh_tris[n["mesh"]] * k
            draws += len(meshes[n["mesh"]]["primitives"])
    # parents (to compose transforms of markers, all markers are expected at root)
    parent = {}
    for i, n in enumerate(nodes):
        for c in n.get("children", []):
            parent[c] = i
    markers = []
    for i, n in enumerate(nodes):
        nm = n.get("name", "")
        if nm.startswith(("seat_", "light_", "fire", "cam_intro")):
            t = n.get("translation", [0, 0, 0])
            q = n.get("rotation", [0, 0, 0, 1])
            fwd = quat_rotate(q, (0, 0, 1))
            markers.append({"name": nm, "pos": [round(x, 3) for x in t], "rot": [round(x, 5) for x in q],
                            "fwd_z": [round(x, 3) for x in fwd], "has_parent": i in parent,
                            "camera": "camera" in n})
    seats_ok = []
    for m in markers:
        if m["name"].startswith("seat_"):
            px, py, pz = m["pos"]
            to_fire = (-px, -pz)
            L = math.hypot(*to_fire)
            f = m["fwd_z"]
            dot = (f[0] * to_fire[0] + f[2] * to_fire[1]) / L
            seats_ok.append((m["name"], round(dot, 4), py))
    return {
        "file_size": size,
        "triangles": total,
        "draw_calls_approx": draws,
        "materials": [m.get("name") for m in mats],
        "n_materials": len(mats),
        "instanced_nodes": inst_nodes,
        "instances": instances,
        "extensions_used": js.get("extensionsUsed", []),
        "markers": markers,
        "seat_facing_dot": seats_ok,
        "images": [(im.get("name"), im.get("mimeType")) for im in js.get("images", [])],
        "cameras": js.get("cameras", []),
        "root_nodes": [nodes[i].get("name") for i in js["scenes"][0]["nodes"]][:12],
        "mesh_nodes": [(n.get("name"), mesh_tris[n["mesh"]]) for n in nodes if "mesh" in n and
                       "EXT_mesh_gpu_instancing" not in n.get("extensions", {})],
    }


if __name__ == "__main__":
    r = analyse(sys.argv[1])
    if "--json" in sys.argv:
        print(json.dumps(r, indent=1))
    else:
        for k, v in r.items():
            if k == "markers":
                print("markers:", len(v), [m["name"] for m in v][:6], "...")
            else:
                print(k, ":", v)
