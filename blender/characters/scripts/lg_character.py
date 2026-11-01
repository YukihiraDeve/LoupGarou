"""Loup-Garou characters: spec -> parts (armature space, weighted, with morphs) -> Blender objects."""
from __future__ import annotations

import math

import bpy
import numpy as np

import lg_assemble as A
import lg_body as B
import lg_core as C
import lg_hair as HR
import lg_head as HD
import lg_skeleton as SK
import lg_skin as S
import lg_texture as T


def to_arm(part, hc, size):
    part.V = part.V * size + hc
    for k in part.morphs:
        part.morphs[k] = part.morphs[k] * size
    return part


def build_parts(spec):
    H = HD.head_params(spec.get("head"))
    size = H["size"]
    eyes_local = HD.eye_centers(H)
    body = dict(spec.get("body", {}))
    body["head"] = size
    body["eye_dx"], body["eye_dy"], body["eye_dz"] = eyes_local[0]
    J = SK.layout(body)
    hc = J["_head_center"]
    head_parts, design = HD.build_head(H)
    f = design["f_plain"]
    parts = []
    info = {"J": J, "H": H, "hc": hc, "size": size}

    def head_rigid(p, bone="Head"):
        to_arm(p, hc, size)
        p.weights = {bone: np.ones(len(p.V))}
        parts.append(p)
        return p

    # --- head ---------------------------------------------------------------------------------
    hp = head_parts["head"]
    to_arm(hp, hc, size)
    hp.weights = S.head_weights(hp.V, J)
    parts.append(hp)
    head_rigid(head_parts["eye_l"], "eye_l")
    head_rigid(head_parts["eye_r"], "eye_r")
    for k in ("lids", "brows", "mouth", "lips", "ear_l", "ear_r"):
        if k.startswith("ear") and spec.get("no_ears"):
            continue
        head_rigid(head_parts[k])
    if spec.get("werewolf"):
        head_rigid(HD.wolf_ear(H, 1))
        head_rigid(HD.wolf_ear(H, -1))
        head_rigid(HD.wolf_nose(H, f))
        for p in HD.wolf_fangs(H, f):
            head_rigid(p)

    # --- hair / beard / hat -------------------------------------------------------------------
    hair = spec.get("hair", {})
    for p in hair_parts(H, f, design, hair, spec):
        head_rigid(p)
    hat = spec.get("hat")
    if hat:
        for p in hat_parts(H, f, design, hat, spec):
            head_rigid(p)
    for acc in spec.get("head_acc", []):
        if acc == "glasses":
            for p in HR.glasses(H, f, design["eyes"]):
                head_rigid(p)

    # --- neck / torso -------------------------------------------------------------------------
    parts.append(B.neck_part(J, size, r=0.044 * spec.get("body", {}).get("neck_r", 1.0)))
    top = spec["top"]
    torso = B.torso_part(J, body, top, n=16 if top.get("outer") else 24)
    parts.append(torso)
    info["top_dims"] = torso.tags["uv_scale"]
    if top.get("collar"):
        parts.append(B.collar_part(J, body, top["collar"], color=top.get("collar_color"),
                                   region=None if top.get("collar_color") else top.get("region", "top")))
        if not top.get("collar_color"):
            parts[-1].tags["uv_rect"] = (0.70, 0.9, 0.80, 1.0)
    if top.get("hood"):
        hp2 = B.hood_part(J, body, region=top.get("region", "top"))
        hp2.tags["uv_rect"] = (0.15, 0.6, 0.35, 0.95)
        parts.append(hp2)
    if top.get("outer"):
        o = top["outer"]
        g = dict(o)
        g.setdefault("region", "top2")
        op = B.torso_part(J, body, g)
        op.name = "outer"
        parts.append(op)
        info["top2_dims"] = op.tags["uv_scale"]
        if o.get("collar"):
            parts.append(B.collar_part(J, body, o["collar"], region="top2"))
            parts[-1].tags["uv_rect"] = (0.70, 0.9, 0.80, 1.0)

    # --- arms -----------------------------------------------------------------------------------
    sl = B.sleeve_part(J, "l", top, body=body)
    parts += [sl, sl.mirrored("sleeve_r")]
    info["sleeve_dims"] = sl.tags["uv_scale"]
    if top.get("sleeve") in ("rolled", "short"):
        fa = B.forearm_skin(J, "l", start=0.55 if top.get("sleeve") == "short" else 0.95,
                            color=spec.get("forearm_color", "skin"), k=body.get("arm_thick", 1.0))
        parts += [fa, fa.mirrored("forearm_r")]
    hands = B.hand_part(J, "l", body=body, claws=spec.get("werewolf", False), color=spec.get("hand_color", "skin"))
    for h in hands:
        parts += [h, h.mirrored(h.name.replace("_l", "_r"))]

    # --- legs / feet ----------------------------------------------------------------------------
    legs = spec["legs"]
    lp = B.leg_part(J, "l", legs, body=body)
    parts += [lp, lp.mirrored("leg_r")]
    info["bottom_dims"] = lp.tags["uv_scale"]
    if legs.get("length") in ("shorts", "capri"):
        top_z = J["thigh_l"]["head"][2] - (0.18 if legs.get("length") == "shorts" else 0.36)
        bl = B.bare_leg_part(J, "l", top_z, sock=legs.get("sock"), body=body, color=spec.get("leg_color", "skin"))
        for p in bl:
            parts += [p, p.mirrored(p.name.replace("_l", "_r"))]
    shoes = spec.get("shoes", {"style": "sneaker"})
    for p in B.shoe_parts(J, "l", shoes.get("style", "sneaker"), k=shoes.get("k", 1.0)):
        if shoes.get("paw"):
            p.region = None
            p.color = "paw" if p.name.startswith("shoe") else "paw_pad"
        parts += [p, p.mirrored(p.name.replace("_l", "_r"))]
    if shoes.get("paw"):
        ball = J["ball_l"]["head"]
        for i, dx in enumerate((-0.030, -0.010, 0.010, 0.030)):
            base = np.array((ball[0] + dx * shoes.get("k", 1.0), ball[1] - 0.085, 0.030))
            cl = B._claw(base, np.array((0, -1.0, -0.15)), np.array((0, 0, 1.0)), 0.008, 0.035)
            cl.weights = {"ball_l": np.ones(len(cl.V))}
            parts += [cl, cl.mirrored("claw")]
    if shoes.get("shaft"):
        sp = B.boot_shaft(J, "l", shoes["shaft"], k=shoes.get("k", 1.0))
        parts += [sp, sp.mirrored("shaft_r")]

    # --- extra body pieces (scarf, straps...) ---------------------------------------------------
    for fn in spec.get("_extra_body", []):
        for p in fn(J, body, info):
            parts.append(p)
    return parts, J, info


def hair_parts(H, f, design, hair, spec):
    out = []
    style = hair.get("style", "cap")
    if style == "none":
        return out
    cap = hair.get("cap")
    if cap:
        under = cap.get("hairline") == "under_hat"
        hatted = bool(spec.get("hat")) or spec.get("werewolf")
        out.append(HR.hair_cap(H, f, cap, n_phi=24 if under else (26 if hatted else 30), n_s=7 if under else (9 if hatted else 10)))
    if hair.get("afro"):
        a = hair["afro"]
        out.append(HR.bumpy_shell(H, f, a.get("hairline", "afro"), a.get("thick", 0.045), a.get("bump", 0.010)))
    if hair.get("long"):
        out.append(HR.long_hair(H, f, hair["long"]))
    if hair.get("braids"):
        b = hair["braids"]
        for sx in (1, -1):
            start = np.array((sx * 0.080, 0.035, -0.030))
            d = np.array((sx * 0.25, -0.25, -1.0))
            bp = HR.braid(start, d, b.get("length", 0.20), r=b.get("r", 0.016), side=sx)
            out.append(bp)
    if hair.get("tufts"):
        t = hair["tufts"]
        out += HR.tufts(H, f, t.get("count", 10), t.get("seed", 1), t.get("length", 0.035), t.get("r", 0.012),
                        tuple(t.get("theta", (0, 70))), tuple(t.get("phi", (-180, 180))))
    for lk in hair.get("locks", []):
        out.append(HR.lock(f, **lk))
    if hair.get("bun"):
        b = hair["bun"]
        c = np.array(b.get("pos", (0.0, 0.085, 0.060)))
        V, F, UV = C.lathe([(0.0, -1.0), (0.75, -0.7), (1.0, 0.0), (0.75, 0.7), (0.0, 1.0)], n=12)
        V = np.asarray(V) * b.get("r", 0.035) + c
        bp = C.Part("bun", V, F, UV, region="hair")
        bp.UV = [[(u, 0.3 + 0.4 * v) for (u, v) in fu] for fu in UV]
        HD.orient_outward(bp, lambda X: np.repeat(c[None, :], len(X), 0))
        out.append(bp)
    if hair.get("beard"):
        bd = hair["beard"]
        out.append(HR.beard(H, f, bd.get("kind", "full"), bd.get("thick", 0.012)))
        if bd.get("mustache", True):
            out.append(HR.mustache(H, f, bd.get("m_thick", 0.008)))
        # beard follows the jaw when the mouth opens
        for p in out[-2:]:
            p.morphs["MouthOpen"] = HD.jaw_drop(p.V, H, 0.0055)
    return out


def hat_parts(H, f, design, hat, spec):
    kind = hat["kind"]
    if kind == "straw":
        return [HR.straw_hat(f)]
    if kind == "ranger":
        return [HR.ranger_hat(f)]
    if kind == "beanie":
        return HR.beanie(f, cuff=hat.get("cuff", True), pompom=hat.get("pompom", False), slouch=hat.get("slouch", 0.0))
    if kind == "cap":
        return HR.cap(f, backwards=hat.get("backwards", False))
    if kind == "bandana":
        return [HR.head_band(f, z_front=hat.get("z_front", 0.070), z_back=hat.get("z_back", 0.040),
                             width=hat.get("width", 0.030), thick=0.006, clearance=hat.get("clearance", 0.014))]
    if kind == "headlamp":
        parts = [HR.head_band(f, z_front=hat.get("z_front", 0.060), z_back=hat.get("z_back", 0.030), width=0.020,
                              thick=0.005, clearance=hat.get("clearance", 0.016), name="lamp_strap")]
        parts += HR.headlamp(f, z_front=hat.get("z_front", 0.060))
        for p in parts[1:]:
            p.V[:, 1] -= hat.get("clearance", 0.016) - 0.004
        return parts
    raise ValueError(kind)


def paint_atlas(spec, info):
    atlas = T.Atlas()
    T.paint_face(atlas, spec)
    T.paint_eye(atlas, spec)
    T.paint_mouth(atlas, spec)
    T.paint_lid(atlas, spec)
    T.paint_hair(atlas, spec, "hair", spec.get("hair"))
    if spec.get("hair", {}).get("beard"):
        T.paint_hair(atlas, spec, "hair2", spec["hair"].get("beard_paint", spec.get("hair")))
    fab = spec.get("fabrics", {})
    T.paint_garment(atlas, "top", fab.get("top"), info.get("top_dims", (1, 1)))
    T.paint_garment(atlas, "sleeve", fab.get("sleeve", fab.get("top")), info.get("sleeve_dims", (0.35, 0.6)))
    T.paint_garment(atlas, "bottom", fab.get("bottom"), info.get("bottom_dims", (0.5, 1.0)))
    if fab.get("top2"):
        T.paint_garment(atlas, "top2", fab.get("top2"), info.get("top2_dims", (1, 1)))
    T.paint_shoe(atlas, spec)
    T.paint_hat(atlas, spec)
    T.paint_sock(atlas, spec)
    for key in ("extra", "extra2", "extra3"):
        if fab.get(key):
            T.paint_extra(atlas, key, fab[key])
    return atlas


def build_character(spec, coll):
    """Create armature + mesh for spec in collection coll. Returns (arm, mesh, stats)."""
    parts, J, info = build_parts(spec)
    cid = spec["id"]
    arm = SK.build_armature(f"{cid}_rig", J, coll)
    arm.scale = (spec.get("scale", 1.0),) * 3
    colors = derived_colors(spec)
    spec = dict(spec)
    spec["colors"] = colors
    atlas = paint_atlas(spec, info)
    obj, stats = A.assemble(cid, parts, arm, atlas, colors, [], coll)
    img = A.make_image(f"{cid}_atlas", atlas)
    mats = [A.make_material(f"M_{cid}", img, roughness=spec.get("roughness", 0.78))]
    if spec.get("werewolf"):
        mats.append(A.make_material("EMIT_eyes", img, roughness=0.3, emissive=True, emissive_strength=4.0))
    else:
        # slight self-illumination keeps the eyes readable at night across the fire
        mats.append(A.make_material(f"M_{cid}_eyes", img, roughness=0.12, spec=0.8, emissive=True,
                                    emissive_strength=0.12))
    for m in mats:
        obj.data.materials.append(m)
    stats["bones"] = len(arm.data.bones)
    stats["parts"] = len(parts)
    stats["height"] = float(obj_height(parts) * spec.get("scale", 1.0))
    return arm, obj, stats, info


def _hex(c):
    c = c.lstrip("#")
    return np.array([int(c[i:i + 2], 16) / 255.0 for i in (0, 2, 4)])


def _tohex(v):
    v = np.clip(v, 0, 1)
    return "#" + "".join(f"{int(round(x * 255)):02x}" for x in v)


def derived_colors(spec):
    """Colours derived from skin / hair unless the spec overrides them: lips, ears, brows."""
    col = dict(spec["colors"])
    skin = _hex(col["skin"])
    blush = _hex(col.get("blush", "#e07a6a"))
    lum = float(skin.mean())
    if "lip" not in col:
        tint = _hex("#b45454") if lum > 0.45 else _hex("#7a3a34")
        col["lip"] = _tohex(skin * 0.62 + tint * 0.38 if lum > 0.45 else skin * 0.75 + tint * 0.25)
    if "ear" not in col:
        col["ear"] = _tohex(skin * 0.82 + blush * 0.18)
    hair = spec.get("hair", {}).get("color")
    if hair and not spec.get("brow_keep"):
        col["brow"] = _tohex(_hex(hair) * 0.85)
    return col


def obj_height(parts):
    return max(float(p.V[:, 2].max()) for p in parts)
