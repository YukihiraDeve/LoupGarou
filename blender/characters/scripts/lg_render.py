"""Loup-Garou characters: EEVEE preview renders (command line)."""
from __future__ import annotations

import math

import bpy
from mathutils import Vector, Euler


def setup_scene(res=(1200, 900), night=False, samples=32, transparent=False):
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = transparent
    try:
        sc.eevee.taa_render_samples = samples
    except Exception:
        pass
    try:
        sc.view_settings.view_transform = "AgX"
        sc.view_settings.look = "AgX - Base Contrast" if not night else "None"
    except Exception:
        pass
    world = bpy.data.worlds.get("PreviewWorld") or bpy.data.worlds.new("PreviewWorld")
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if night:
        bg.inputs[0].default_value = (0.012, 0.018, 0.045, 1)
        bg.inputs[1].default_value = 1.0
    else:
        bg.inputs[0].default_value = (0.55, 0.58, 0.64, 1)
        bg.inputs[1].default_value = 0.55
    sc.world = world
    return sc


def clear_lights_cameras(prefix="PV_"):
    for o in list(bpy.data.objects):
        if o.name.startswith(prefix):
            bpy.data.objects.remove(o, do_unlink=True)


def add_light(name, kind, loc, energy, color=(1, 1, 1), size=1.0, rot=None):
    ld = bpy.data.lights.new("PV_" + name, kind)
    ld.energy = energy
    ld.color = color
    if kind == "AREA":
        ld.size = size
    elif kind in ("POINT", "SPOT"):
        ld.shadow_soft_size = size
    lo = bpy.data.objects.new("PV_" + name, ld)
    bpy.context.scene.collection.objects.link(lo)
    lo.location = loc
    if rot is not None:
        lo.rotation_euler = rot
    return lo


def look_at(obj, target):
    d = Vector(target) - obj.location
    obj.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def add_camera(loc, target, lens=50, ortho=None):
    cd = bpy.data.cameras.new("PV_cam")
    cd.lens = lens
    if ortho:
        cd.type = "ORTHO"
        cd.ortho_scale = ortho
    cd.clip_start = 0.01
    co = bpy.data.objects.new("PV_cam", cd)
    bpy.context.scene.collection.objects.link(co)
    co.location = loc
    look_at(co, target)
    bpy.context.scene.camera = co
    return co


def studio_lights(center=(0, 0, 1.0), scale=1.0):
    add_light("key", "AREA", (center[0] - 2.2 * scale, center[1] - 3.0 * scale, center[2] + 1.6 * scale), 420 * scale ** 2,
              (1.0, 0.95, 0.88), size=2.5 * scale)
    look_at(bpy.data.objects["PV_key"], center)
    add_light("fill", "AREA", (center[0] + 3.0 * scale, center[1] - 2.0 * scale, center[2] + 0.4), 160 * scale ** 2,
              (0.8, 0.88, 1.0), size=3.0 * scale)
    look_at(bpy.data.objects["PV_fill"], center)
    add_light("rim", "AREA", (center[0] + 0.5, center[1] + 3.0 * scale, center[2] + 1.5), 380 * scale ** 2, (1.0, 0.9, 0.8),
              size=2.0 * scale)
    look_at(bpy.data.objects["PV_rim"], center)


def ground(size=40, color=(0.30, 0.27, 0.24, 1), name="PV_ground"):
    me = bpy.data.meshes.new(name)
    s = size / 2
    me.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = color
    mat.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.95
    me.materials.append(mat)
    return ob


def render(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
