"""Loup-Garou characters: the 10 campers + the werewolf (cosmetic avatars chosen in the lobby).

Each spec drives lg_character.build_parts(): body proportions (moderate, the skeleton keeps the same
bone directions), head shape, face colours, hair / beard / hat, garments and their painted fabrics.
"""
from __future__ import annotations

SKIN = {
    "fair": "#e6ad8a", "pink": "#e3a589", "light": "#d99a74", "medium": "#c98a62", "olive": "#bd8458",
    "tan": "#a96f48", "brown": "#8a5434", "dark": "#5e3a26",
}


def L(theta0, phi0, dtheta, dphi, steps=5, width=0.018, thick=0.007, base_off=0.02, lift=0.01, tip_drop=0.0):
    return dict(theta0=theta0, phi0=phi0, dtheta=dtheta, dphi=dphi, steps=steps, width=width, thick=thick,
                base_off=base_off, lift=lift, tip_drop=tip_drop)


TOM = dict(
    id="camper_01", name="Tom",
    description="Jeune homme brun, chemise à carreaux rouge de bûcheron, jean et bottes de rando.",
    scale=1.03,
    body=dict(shoulder=1.04, chest=1.03),
    head=dict(lid_up=29.0, jaw=1.06, chin=1.0, cheekbone=0.3),
    colors=dict(skin=SKIN["light"], blush="#de7f68", brow="#3a2416", iris="#6a4524", lash="#22150e",
                sole="#2b2420", lip_line="#6a2e26"),
    blush=0.35, stubble="#9c7058",
    hair=dict(color="#4a2c1a", hi="#8c5c38", clump_tex=10,
              cap=dict(hairline="short", thick=0.006, top=0.024, top_w=60, quiff=0.026, quiff_phi=-25, part_phi=45,
                       sweep=0.18, clumps=0.45, clump_n=11, side_volume=-0.002, lip=0.006, seed=3),
              locks=[L(18, -10, 8, -9, width=0.020, thick=0.008, base_off=0.022),
                     L(22, 12, 8, -10, width=0.018, base_off=0.020, lift=0.012),
                     L(26, -35, 7, -9, width=0.017, base_off=0.016, lift=0.008),
                     L(16, 35, 9, -6, steps=4, width=0.016, base_off=0.022)]),
    top=dict(collar="shirt", region="top", loose=0.008, sleeve="long", cuff=0.008),
    fabrics=dict(
        top=dict(kind="tartan", base="#b3222a", dark="#1e1416", sett=0.105,
                 details=[("placket",), ("buttons", "#2a1a16", 6), ("pockets", None)]),
        sleeve=dict(kind="tartan", base="#b3222a", dark="#1e1416", sett=0.105, sleeve_details=[("cuff_band", 0.05)]),
        bottom=dict(kind="denim", base="#33507a", details=[("jeans", "#c98a3a")]),
    ),
    legs=dict(fit=1.0, length="long", cuff="hem", flare=0.006),
    shoes=dict(style="boot", shaft=0.17),
    shoe_paint=dict(kind="boot", upper="#7b4b2a", accent="#4a2c1a", lace="#c9a46a", shaft="#7b4b2a", collar="#3a2416"),
)

LEA = dict(
    id="camper_02", name="Léa",
    description="Chapeau de paille, pull crème, jean retroussé, baskets en toile, cheveux châtains ondulés.",
    scale=0.96,
    body=dict(shoulder=0.92, chest=0.92, hips=1.06, bust=1.0, width=0.96, arm_thick=0.9, hand=1.02, neck_r=0.92),
    head=dict(eye_r=0.0225, lid_up=33.0, lid_low=30.0, lashes=True, jaw=0.96, chin=0.90, nose_len=0.8, nose_tip=0.9,
              nose_w=0.9, mouth_w=0.020, brow_thick=0.85, cheek=1.12),
    colors=dict(skin=SKIN["fair"], blush="#e8806e", brow="#5a301a", iris="#4d7a3a", lash="#1c110b", sole="#e9e4da",
                lip_line="#a0444a", mouth="#5a1a1e"),
    blush=0.55, freckles="#c07a58",
    hair=dict(color="#6b3a1e", hi="#a86a3c", clump_tex=12,
              cap=dict(hairline="long", thick=0.010, top=0.010, part_phi=-20, clumps=0.35, clump_n=12, lip=0.003, seed=7),
              long=dict(length=0.24, width=1.02, wave=0.010, span=220),
              locks=[L(48, -32, 10, -6, steps=6, width=0.020, base_off=0.012, lift=0.006, tip_drop=0.004),
                     L(48, 30, 10, 6, steps=6, width=0.020, base_off=0.012, lift=0.006, tip_drop=0.004)]),
    hat=dict(kind="straw", paint=dict(kind="straw", base="#d9b56a", band="#8a3a2a", band_v=(0.40, 0.47))),
    top=dict(collar="crew", region="top", loose=0.014, sleeve="long", cuff=0.012),
    fabrics=dict(
        top=dict(kind="knit", base="#efe3c8", rib=0.010, cable=True, details=[("rib_hem", 0.05)]),
        sleeve=dict(kind="knit", base="#efe3c8", rib=0.010, sleeve_details=[("cuff_band", 0.05)]),
        bottom=dict(kind="denim", base="#4a6a96", details=[("jeans", "#d0a060")]),
    ),
    legs=dict(fit=0.95, length="long", cuff="rolled"),
    shoes=dict(style="sneaker", k=0.92),
    shoe_paint=dict(kind="canvas", upper="#d65a4a", accent="#ffffff", lace="#f6f2ea"),
)

BRUNO = dict(
    id="camper_03", name="Bruno",
    description="Barbu jovial, chapeau de ranger, chemise kaki, carrure large.",
    scale=1.05,
    body=dict(shoulder=1.10, chest=1.10, belly=0.7, width=1.07, arm_thick=1.15, hand=1.18, neck_r=1.12, legs=1.08),
    head=dict(lid_up=26.0, lid_low=26.0, jaw=1.16, jaw_square=0.8, cran=1.02, nose_len=1.1, nose_tip=1.3, nose_w=1.2,
              cheek=1.15, brow_thick=1.45, mouth_w=0.023),
    colors=dict(skin=SKIN["tan"], blush="#c9725a", brow="#2e1c12", iris="#4a2e1a", lash="#1c120c", sole="#2b2622",
                lip_line="#5a2a20"),
    blush=0.3,
    hair=dict(color="#3a2416", hi="#6a4a30", clump_tex=14,
              cap=dict(hairline="under_hat", thick=0.007, top=0.0, clumps=0.3, clump_n=14, seed=9),
              beard=dict(kind="full", thick=0.016, mustache=True, m_thick=0.010),
              beard_paint=dict(color="#3a2416", hi="#5c4028")),
    hat=dict(kind="ranger", paint=dict(kind="felt", base="#8a6a42", band="#3e2a1a", band_v=(0.40, 0.46))),
    top=dict(collar="shirt", region="top", loose=0.010, sleeve="rolled"),
    fabrics=dict(
        top=dict(kind="solid", base="#8c8a5a", grain=0.06,
                 details=[("placket",), ("buttons", "#3a3220", 6), ("pockets", "#7a784c")]),
        sleeve=dict(kind="solid", base="#8c8a5a", grain=0.06),
        bottom=dict(kind="solid", base="#4e4a3a", grain=0.05, details=[("cargo",), ("seams",)]),
    ),
    legs=dict(fit=1.08, length="long", cuff="hem", flare=0.008),
    shoes=dict(style="boot", shaft=0.19, k=1.06),
    shoe_paint=dict(kind="boot", upper="#5a3a22", accent="#3a2416", lace="#b88a4a", shaft="#5a3a22", collar="#2a1a10"),
)

INES = dict(
    id="camper_04", name="Inès",
    description="Longs cheveux bruns, sweat clair, jean, baskets blanches.",
    scale=0.97,
    body=dict(shoulder=0.92, chest=0.92, hips=1.04, bust=0.8, width=0.96, arm_thick=0.9, hand=1.02, neck_r=0.92),
    head=dict(eye_r=0.0222, lid_up=32.0, lid_low=30.0, lashes=True, jaw=0.96, chin=0.92, nose_len=0.9, nose_w=0.92,
              mouth_w=0.020, brow_thick=0.95, brow_arch=1.3, cheekbone=0.4),
    colors=dict(skin=SKIN["olive"], blush="#c8705e", brow="#22140c", iris="#3a2414", lash="#120a06", sole="#f2f0ea",
                lip_line="#8a3a3a", mouth="#5a1a1e"),
    blush=0.4,
    hair=dict(color="#2a1a12", hi="#5a3a26", clump_tex=14,
              cap=dict(hairline="long", thick=0.011, top=0.008, part_phi=0, clumps=0.3, clump_n=14, lip=0.002, seed=11),
              long=dict(length=0.40, width=1.0, wave=0.004, span=230),
              locks=[L(46, -28, 11, -5, steps=7, width=0.022, base_off=0.012, lift=0.008, tip_drop=0.006),
                     L(46, 28, 11, 5, steps=7, width=0.022, base_off=0.012, lift=0.008, tip_drop=0.006)]),
    top=dict(collar="crew", region="top", loose=0.016, sleeve="long", cuff=0.012),
    fabrics=dict(
        top=dict(kind="solid", base="#dcd6ea", grain=0.05, details=[("rib_hem", 0.05)]),
        sleeve=dict(kind="solid", base="#dcd6ea", grain=0.05, sleeve_details=[("cuff_band", 0.05)]),
        bottom=dict(kind="denim", base="#2e4466", details=[("jeans", "#c99a5a")]),
    ),
    legs=dict(fit=0.94, length="long", cuff="hem"),
    shoes=dict(style="sneaker", k=0.92),
    shoe_paint=dict(kind="sneaker", upper="#f4f4f2", accent="#dcdcdc", lace="#ffffff"),
)

MATHIS = dict(
    id="camper_05", name="Mathis",
    description="Sweat à capuche bleu marine avec un petit sapin imprimé, cheveux en bataille.",
    scale=1.0,
    body=dict(shoulder=0.98, chest=0.97, width=0.98),
    head=dict(lid_up=30.0, jaw=1.0, nose_len=0.95, eye_r=0.0218, cheek=1.08),
    colors=dict(skin=SKIN["pink"], blush="#e6806c", brow="#6a4a28", iris="#3f6fa5", lash="#2a1a10", sole="#f0ece4",
                lip_line="#7a3a30"),
    blush=0.4,
    hair=dict(color="#8a6034", hi="#c49a5c", clump_tex=12,
              cap=dict(hairline="short", thick=0.010, top=0.020, top_w=55, clumps=0.5, clump_n=12, messy=0.010, lip=0.006, seed=13),
              locks=[L(14, -20, 7, -14, steps=4, width=0.024, base_off=0.022, lift=0.012),
                     L(18, 30, 6, 12, steps=4, width=0.024, base_off=0.022, lift=0.013),
                     L(30, -60, 8, -6, steps=4, width=0.022, base_off=0.016, lift=0.009),
                     L(10, 120, 8, 20, steps=4, width=0.024, base_off=0.022, lift=0.013),
                     L(24, 0, 9, -3, steps=4, width=0.026, base_off=0.022, lift=0.010),
                     L(32, 70, 8, 8, steps=4, width=0.022, base_off=0.016, lift=0.009),
                     L(12, -140, 8, -15, steps=4, width=0.024, base_off=0.022, lift=0.012)]),
    top=dict(collar="crew", region="top", loose=0.018, sleeve="long", cuff=0.014, hood=True),
    fabrics=dict(
        top=dict(kind="solid", base="#1f2a48", grain=0.06,
                 details=[("kangaroo",), ("tree_print", "#e8e4d4"), ("rib_hem", 0.06)]),
        sleeve=dict(kind="solid", base="#1f2a48", grain=0.06, sleeve_details=[("cuff_band", 0.06)]),
        bottom=dict(kind="denim", base="#3a3e48", details=[("jeans", "#8a8a80")]),
    ),
    legs=dict(fit=1.0, length="long", cuff="hem", flare=0.004),
    shoes=dict(style="sneaker"),
    shoe_paint=dict(kind="sneaker", upper="#3a3a40", accent="#e04a3a", lace="#eeeeee"),
)

JEANNE = dict(
    id="camper_06", name="Jeanne",
    description="Dame âgée au bonnet de laine, gros gilet tricoté, lunettes rondes.",
    scale=0.93,
    body=dict(shoulder=0.93, chest=0.98, belly=0.45, hips=1.10, width=1.0, torso=0.96, arm_thick=0.95, hand=1.0),
    head=dict(lid_up=25.0, lid_low=26.0, lid_tilt=-4.0, cheek=1.35, jaw=1.08, chin=0.88, nose_tip=1.2, nose_len=1.0,
              brow_thick=0.9, mouth_w=0.021, eye_r=0.0205, cran=1.02),
    brow_keep=True,
    colors=dict(skin=SKIN["pink"], blush="#e07a72", brow="#bdb6ac", iris="#6a8aa0", lash="#4a3a34", sole="#4a3e36",
                lip_line="#a04a4a", glasses="#7a4a2a"),
    blush=0.6, wrinkles=True,
    hair=dict(color="#cfcac2", hi="#f0ece6", clump_tex=16,
              cap=dict(hairline="under_hat", thick=0.010, top=0.0, clumps=0.4, clump_n=16, seed=15),
              bun=dict(pos=(0.0, 0.098, -0.020), r=0.030)),
    hat=dict(kind="beanie", pompom=True, cuff=True,
             paint=dict(kind="knit", base="#5a7a9a", stripe="#e8dcc4", stripe_v=0.30)),
    head_acc=["glasses"],
    top=dict(collar="crew", region="top", loose=0.004, sleeve="long", cuff=0.0,
             sleeve_region="sleeve",
             outer=dict(loose=0.026, collar="shawl")),
    fabrics=dict(
        top=dict(kind="solid", base="#f0e8dc", grain=0.03),
        top2=dict(kind="knit", base="#a8584a", rib=0.012, cable=True,
                  details=[("center_strip", "#f0e8dc", 0.030), ("buttons", "#e8d8b8", 5), ("rib_hem", 0.07)]),
        sleeve=dict(kind="knit", base="#a8584a", rib=0.012, sleeve_details=[("cuff_band", 0.07)]),
        bottom=dict(kind="corduroy", base="#6a5442", details=[("seams",)]),
    ),
    legs=dict(fit=1.06, length="long", cuff="hem", flare=0.006),
    shoes=dict(style="flat"),
    shoe_paint=dict(kind="flat", upper="#5a4030", accent="#3a2a20"),
)

KARIM = dict(
    id="camper_07", name="Karim",
    description="Casquette, doudoune sans manches orange, short cargo, chaussettes hautes.",
    scale=1.01,
    body=dict(shoulder=1.02, chest=1.0),
    head=dict(lid_up=28.0, jaw=1.04, chin=1.0, nose_len=1.1, nose_w=1.08, brow_thick=1.3, cheekbone=0.9),
    colors=dict(skin=SKIN["brown"], blush="#a85a44", brow="#160e0a", iris="#2e1c10", lash="#0e0806", sole="#ece8e0",
                lip_line="#4a2420"),
    blush=0.25, stubble="#3a2418",
    hair=dict(color="#1a1412", hi="#3a302a", clump_tex=18,
              cap=dict(hairline="under_hat", thick=0.005, top=0.0, clumps=0.15, clump_n=18, seed=17)),
    hat=dict(kind="cap", paint=dict(kind="cap", base="#2a3a5a")),
    top=dict(collar=None, region="top", loose=0.004, sleeve="long", cuff=0.006,
             outer=dict(loose=0.030, collar="high", puffs=6)),
    fabrics=dict(
        top=dict(kind="solid", base="#3c3c40", grain=0.04),
        top2=dict(kind="solid", base="#e8742a", grain=0.03, details=[("zip", "#2a2a2a")]),
        sleeve=dict(kind="solid", base="#3c3c40", grain=0.04, sleeve_details=[("cuff_band", 0.04)]),
        bottom=dict(kind="solid", base="#7a7458", grain=0.05, details=[("cargo",), ("seams",)]),
    ),
    legs=dict(fit=1.1, length="shorts", cuff="hem", sock=(0.33, "sock")),
    sock_paint=dict(base="#f2f0ea", stripes=[("#c43a2a", 0.80, 0.86), ("#2a3a6a", 0.90, 0.95)]),
    shoes=dict(style="sneaker", k=1.04),
    shoe_paint=dict(kind="sneaker", upper="#e8e6e0", accent="#2a3a5a", lace="#ffffff"),
)

ZOE = dict(
    id="camper_08", name="Zoé",
    description="Ado rousse à tresses, salopette en jean, bandana.",
    scale=0.92,
    body=dict(shoulder=0.86, chest=0.88, hips=0.98, width=0.94, torso=0.90, arm_thick=0.86, hand=0.95, neck_r=0.88),
    head=dict(size=0.97, eye_r=0.0232, lid_up=34.0, lid_low=31.0, lashes=True, jaw=0.98, chin=0.82, nose_len=0.75,
              nose_tip=0.85, nose_w=0.85, nose_up=0.6, mouth_w=0.019, brow_thick=0.85, cheek=1.25, face_len=0.94),
    colors=dict(skin=SKIN["fair"], blush="#ec8270", brow="#a8461c", iris="#4f8a4a", lash="#3a1a0c", sole="#e8e2d6",
                lip_line="#a8484a", mouth="#5a1a1e"),
    blush=0.6, freckles="#b8603a",
    hair=dict(color="#b5501e", hi="#e08a44", clump_tex=12,
              cap=dict(hairline="long", thick=0.010, top=0.006, part_phi=0, clumps=0.35, clump_n=12, lip=0.003, seed=19),
              braids=dict(length=0.20, r=0.017)),
    hat=dict(kind="bandana", z_front=0.072, z_back=0.030, width=0.032, clearance=0.014,
             paint=dict(kind="bandana", base="#1f7a7a", other="#f2eee2")),
    top=dict(collar="crew", region="top", loose=0.010, sleeve="long", cuff=0.008),
    fabrics=dict(
        top=dict(kind="stripes", base="#f2eee6", other="#c8423a", width=0.030,
                 details=[("bib", "#4a6e9a", 0.42)]),
        sleeve=dict(kind="stripes", base="#f2eee6", other="#c8423a", width=0.030),
        bottom=dict(kind="denim", base="#4a6e9a", details=[("jeans", "#d8a050")]),
    ),
    legs=dict(fit=0.96, length="long", cuff="rolled"),
    shoes=dict(style="sneaker", k=0.90, shaft=0.15),
    shoe_paint=dict(kind="canvas", upper="#e9c43a", accent="#ffffff", lace="#ffffff", shaft="#e9c43a", collar="#f2eee2"),
)

HUGO = dict(
    id="camper_09", name="Hugo",
    description="Grand et costaud, bonnet, veste de bûcheron verte, barbe courte.",
    scale=1.055,
    body=dict(shoulder=1.12, chest=1.12, width=1.08, belly=0.3, arm_thick=1.18, hand=1.2, torso=1.06, neck_r=1.12, legs=1.08),
    head=dict(lid_up=27.0, jaw=1.18, jaw_square=1.0, chin=1.05, nose_len=1.05, nose_w=1.1, brow_thick=1.45, cran=1.0),
    colors=dict(skin=SKIN["light"], blush="#d4765e", brow="#4a2c18", iris="#4a7aa8", lash="#20140c", sole="#2a2420",
                lip_line="#6a2e26"),
    blush=0.35,
    hair=dict(color="#5a3a20", hi="#8a5e38", clump_tex=14,
              cap=dict(hairline="under_hat", thick=0.006, top=0.0, clumps=0.2, clump_n=14, seed=21),
              beard=dict(kind="short", thick=0.008, mustache=True, m_thick=0.007),
              beard_paint=dict(color="#6a4428", hi="#946640")),
    hat=dict(kind="beanie", cuff=True, slouch=0.0, paint=dict(kind="knit", base="#2e3a46")),
    top=dict(collar="shirt", region="top", loose=0.020, sleeve="long", cuff=0.010),
    fabrics=dict(
        top=dict(kind="tartan", base="#2f6a3a", dark="#141a14", sett=0.12, line="#c8b04a", line_w=0.0025,
                 details=[("placket",), ("buttons", "#2a2018", 5), ("pockets", None)]),
        sleeve=dict(kind="tartan", base="#2f6a3a", dark="#141a14", sett=0.12, line="#c8b04a", line_w=0.0025,
                    sleeve_details=[("cuff_band", 0.05)]),
        bottom=dict(kind="solid", base="#6a5638", grain=0.05, details=[("seams",)]),
    ),
    legs=dict(fit=1.08, length="long", cuff="hem", flare=0.008),
    shoes=dict(style="boot", shaft=0.19, k=1.08),
    shoe_paint=dict(kind="boot", upper="#3e2a1c", accent="#2a1a10", lace="#c8a46a", shaft="#3e2a1c", collar="#6a4a30"),
)

NINA = dict(
    id="camper_10", name="Nina",
    description="Cheveux courts afro, coupe-vent jaune, lampe frontale.",
    scale=0.97,
    body=dict(shoulder=0.94, chest=0.94, hips=1.03, bust=0.7, width=0.97, arm_thick=0.92, hand=1.02, neck_r=0.94),
    head=dict(eye_r=0.0222, lid_up=32.0, lid_low=30.0, lashes=True, jaw=0.98, chin=0.92, nose_len=0.85, nose_w=1.18,
              nose_tip=1.05, mouth_w=0.021, brow_thick=1.0, cheekbone=0.9, lip=1.25),
    colors=dict(skin=SKIN["dark"], blush="#8a4a3a", brow="#120c08", iris="#2a1a10", lash="#0a0604", sole="#3a3634",
                lip_line="#3a1a18", mouth="#4a1418", lamp="#3a3a3e", lamp_lens="#fff6c8"),
    blush=0.25,
    hair=dict(color="#16100c", hi="#3a2c22", clump_tex=20,
              afro=dict(hairline="afro", thick=0.050, bump=0.014)),
    hat=dict(kind="headlamp", z_front=0.050, z_back=0.020, clearance=0.052,
             paint=dict(kind="solid", base="#2a2a2e")),
    top=dict(collar="high", region="top", loose=0.018, sleeve="long", cuff=0.010),
    fabrics=dict(
        top=dict(kind="solid", base="#f2c42a", grain=0.03,
                 details=[("zip", "#2a2a2a"), ("panel", "#d8a818", 0.0, 0.08)]),
        sleeve=dict(kind="solid", base="#f2c42a", grain=0.03, sleeve_details=[("cuff_band", 0.04, "#2a2a2e")]),
        bottom=dict(kind="solid", base="#2a2e36", grain=0.05, details=[("seams",)]),
    ),
    legs=dict(fit=0.96, length="long", cuff="hem"),
    shoes=dict(style="hiker", shaft=0.15, k=0.95),
    shoe_paint=dict(kind="hiker", upper="#6a7a5a", accent="#3a3a34", lace="#e04a2a", shaft="#6a7a5a", collar="#3a3a34"),
)

WEREWOLF = dict(
    id="werewolf", name="Loup-garou",
    description="Loup-garou stylisé : fourrure, museau, griffes, yeux jaunes luisants, lambeaux de chemise à carreaux.",
    werewolf=True, no_ears=True,
    scale=1.06,
    body=dict(shoulder=1.30, chest=1.30, width=1.22, belly=0.0, arm_thick=1.45, hand=1.35, torso=1.16, neck=0.9,
              neck_r=1.45, arm=1.10, legs=1.30),
    head=dict(size=1.12, muzzle=1.5, lid_up=22.0, lid_low=18.0, lid_tilt=6.0, eye_r=0.0185, eye_x=0.044, eye_z=0.022, brow_angry=12.0, lip=1.2,
              jaw=1.15, cran=0.98, nose_len=0.4, nose_tip=0.6, mouth_z=-0.061, mouth_w=0.030, mouth_smile=-0.002,
              brow_thick=1.8, brow_arch=0.4, cheek=1.2),
    brow_keep=True,
    colors=dict(skin="#6a5848", blush="#6a5848", brow="#2a2018", lip="#1a1212", ear="#5a4a3e", iris="#ffc21a", sclera="#2a1e0e", lash="#140e0a",
                sole="#2a221c", lip_line="#1a1010", mouth="#3a0e10", fur="#5a4a3e", fur_dark="#3a3028", paw="#4a3c32",
                paw_pad="#2a2220", nose="#141010", claw="#e8e0cc"),
    glow="#ffd23a", iris_deg=40, pupil=0.32,
    blush=0.0,
    hand_color="paw", forearm_color="fur", leg_color="fur",
    hair=dict(color="#4a3a30", hi="#7a6a5a", clump_tex=18,
              cap=dict(hairline="wolf", thick=0.014, top=0.008, clumps=0.7, clump_n=18, messy=0.012, seed=23),
              long=dict(top=-0.070, length=0.20, width=1.32, wave=0.014, span=300, n=13),
              locks=[L(95, -62, 7, -6, steps=3, width=0.020, base_off=0.010, lift=0.012),
                     L(95, 62, 7, 6, steps=3, width=0.020, base_off=0.010, lift=0.012),
                     L(110, -70, 6, -8, steps=3, width=0.018, base_off=0.008, lift=0.012),
                     L(110, 70, 6, 8, steps=3, width=0.018, base_off=0.008, lift=0.012),
                     L(30, 0, 12, 0, steps=4, width=0.024, base_off=0.016, lift=0.012)]),
    top=dict(collar="shirt", region="top", loose=0.012, sleeve="short", jag=0.05),
    fabrics=dict(
        top=dict(kind="tartan", base="#8a2a2a", dark="#1e1414", sett=0.13,
                 details=[("center_strip", "#5a4a3e", 0.075), ("buttons", "#2a1a16", 3)]),
        sleeve=dict(kind="tartan", base="#8a2a2a", dark="#1e1414", sett=0.13),
        bottom=dict(kind="denim", base="#2e3e58", details=[("jeans", "#9a7a4a")]),
    ),
    legs=dict(fit=1.15, length="capri", cuff="hem", jag=0.045),
    shoes=dict(style="flat", paw=True, k=1.25),
    roughness=0.85,
)

CHARACTERS = [TOM, LEA, BRUNO, INES, MATHIS, JEANNE, KARIM, ZOE, HUGO, NINA, WEREWOLF]


def by_id(cid):
    for c in CHARACTERS:
        if c["id"] == cid:
            return c
    raise KeyError(cid)
