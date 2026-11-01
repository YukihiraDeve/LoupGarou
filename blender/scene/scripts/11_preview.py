# Preview rendering helpers (EEVEE). Lights / world / cameras here are for previews only and live in the
# "preview" collection, which is never exported. Usage after exec: render_view("seat_08", "night", path)
LIB = "/Users/valentinbour/Desktop/Git/LoupGarou/blender/scene/scripts/_lib.py"
exec(compile(open(LIB).read(), LIB, "exec"))

pcoll = get_coll("preview")
scn = bpy.context.scene


def _light(name, kind, loc, energy, color, radius=0.1, rot=(0, 0, 0)):
    ld = bpy.data.lights.get(name)
    if ld is None or ld.type != kind:
        if ld is not None:
            bpy.data.lights.remove(ld)
        ld = bpy.data.lights.new(name, kind)
    ld.energy = energy
    ld.color = color
    if kind == "SUN":
        ld.angle = radians(1.0)
    else:
        ld.shadow_soft_size = radius
    # marker lights (pl_*) do not cast shadows, like the client's cheap point lights
    ld.use_shadow = not name.startswith("pl_")
    o = bpy.data.objects.get(name)
    if o is None:
        o = bpy.data.objects.new(name, ld)
        pcoll.objects.link(o)
    o.data = ld
    o.location = Vector(loc)
    o.rotation_euler = Euler(rot)
    return o


def _clear_marker_lights():
    for o in list(pcoll.objects):
        if o.name.startswith("pl_"):
            ld = o.data
            bpy.data.objects.remove(o, do_unlink=True)
            if ld and ld.users == 0:
                bpy.data.lights.remove(ld)


def _world(color, strength):
    w = bpy.data.worlds.get("preview_world") or bpy.data.worlds.new("preview_world")
    scn.world = w
    nt = w.node_tree
    if nt is None:
        w.use_nodes = True
        nt = w.node_tree
    bg = [n for n in nt.nodes if n.type == "BACKGROUND"]
    if not bg:
        nt.nodes.clear()
        out = nt.nodes.new("ShaderNodeOutputWorld")
        b = nt.nodes.new("ShaderNodeBackground")
        nt.links.new(b.outputs[0], out.inputs[0])
        bg = [b]
    bg[0].inputs["Color"].default_value = (*color, 1)
    bg[0].inputs["Strength"].default_value = strength
    return w


def setup_lighting(mode):
    _clear_marker_lights()
    if mode == "night":
        _world((0.02, 0.03, 0.07), 1.0)
        _light("moon", "SUN", (0, 0, 50), 0.7, (0.55, 0.65, 1.0), rot=(radians(50), 0, radians(-35)))
        _light("fire_light", "POINT", (0, 0, 0.55), 900.0, (1.0, 0.48, 0.16), radius=0.3)
        _light("fire_light2", "POINT", (0.1, -0.05, 1.1), 300.0, (1.0, 0.6, 0.25), radius=0.5)
        kinds = {"light_lantern_": (40.0, (1.0, 0.6, 0.28)), "light_window_": (90.0, (1.0, 0.62, 0.3)),
                 "light_string_": (18.0, (1.0, 0.72, 0.42))}
        for o in bpy.data.objects:
            for pre, (e, c) in kinds.items():
                if o.name.startswith(pre):
                    _light("pl_" + o.name, "POINT", o.matrix_world.translation, e, c, radius=0.15)
        set_emission(EMIT_NIGHT)
    else:
        _world((0.42, 0.56, 0.78), 0.9)
        _light("moon", "SUN", (0, 0, 50), 4.5, (1.0, 0.95, 0.86), rot=(radians(52), 0, radians(-40)))
        _light("fire_light", "POINT", (0, 0, 0.55), 150.0, (1.0, 0.5, 0.2), radius=0.3)
        _light("fire_light2", "POINT", (0, 0, 1.1), 0.0, (1.0, 0.6, 0.25), radius=0.5)
        for m in ("EMIT_embers", "EMIT_window", "EMIT_bulbs", "EMIT_lantern", "EMIT_tent"):
            _emit(m, 0.12 if m != "EMIT_embers" else 0.25)


def _emit(name, strength):
    m = bpy.data.materials.get(name)
    if m:
        for n in m.node_tree.nodes:
            if n.type == "BSDF_PRINCIPLED":
                n.inputs["Emission Strength"].default_value = strength


def _camera():
    cd = bpy.data.cameras.get("preview_cam") or bpy.data.cameras.new("preview_cam")
    o = bpy.data.objects.get("preview_cam")
    if o is None:
        o = bpy.data.objects.new("preview_cam", cd)
        pcoll.objects.link(o)
    scn.camera = o
    cd.clip_start = 0.05
    cd.clip_end = 1500
    return o


def look_at(cam, eye, target):
    eye, target = Vector(eye), Vector(target)
    d = (target - eye).normalized()
    cam.location = eye
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def view_seat(i, yaw_offset=0.0, pitch=-10.0, lens=20.0):
    s = bpy.data.objects[f"seat_{i:02d}"]
    pos = s.matrix_world.translation.copy()
    fwd = (Vector((0, 0, 0)) - pos)
    fwd.z = 0
    fwd.normalize()
    eye = pos + fwd * 0.08 + Vector((0, 0, 0.70))
    yaw = atan2(fwd.y, fwd.x) + radians(yaw_offset)
    target = eye + Vector((cos(yaw), sin(yaw), 0)) * 10 + Vector((0, 0, 10 * math.tan(radians(pitch))))
    cam = _camera()
    look_at(cam, eye, target)
    cam.data.lens = lens
    cam.data.sensor_width = 36


def view_intro():
    c = bpy.data.objects.get("cam_intro")
    cam = _camera()
    cam.matrix_world = c.matrix_world.copy()
    cam.data.lens = c.data.lens
    cam.data.sensor_width = c.data.sensor_width


def view_free(eye, target, lens=24):
    cam = _camera()
    look_at(cam, eye, target)
    cam.data.lens = lens


def render_to(path, res=(1280, 720), samples=24):
    r = scn.render
    r.engine = "BLENDER_EEVEE"
    r.resolution_x, r.resolution_y = res
    r.resolution_percentage = 100
    r.image_settings.file_format = "PNG"
    r.film_transparent = False
    try:
        scn.eevee.taa_render_samples = samples
        scn.eevee.use_shadows = True
        scn.eevee.use_raytracing = False
    except Exception:
        pass
    scn.view_settings.view_transform = "AgX"
    try:
        scn.view_settings.look = "AgX - Medium High Contrast"
    except Exception:
        pass
    r.filepath = path
    bpy.ops.render.render(write_still=True)
    return path


def render_view(view, mode, path, **kw):
    setup_lighting(mode)
    if view == "intro":
        view_intro()
    elif view.startswith("seat_"):
        view_seat(int(view[5:]), **kw)
    elif view == "free":
        view_free(**kw)
    return render_to(path)
