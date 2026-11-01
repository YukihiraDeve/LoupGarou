"""Loup-Garou characters: per-character colour atlas (1024 px), painted with numpy.

Regions hold either a painted map for one part family (face, hair, torso garment, sleeves, trousers,
shoes, hat...) whose patterns are drawn at their real physical scale (the painter receives the size in
metres of the part that uses the region), or a palette of flat colour cells (32 px) for plain parts.
"""
from __future__ import annotations

import math

import numpy as np

import lg_core as C

SIZE = 1024
# x0, y0, x1, y1 in pixels, y from the top of the image
REGIONS = {
    "face": (0, 0, 256, 256),
    "hair": (256, 0, 512, 256),
    "top": (512, 0, 768, 256),
    "sleeve": (768, 0, 1024, 256),
    "bottom": (0, 256, 256, 512),
    "top2": (256, 256, 512, 512),
    "hat": (512, 256, 768, 512),
    "shoe": (768, 256, 1024, 512),
    "eye": (0, 512, 128, 640),
    "mouth": (128, 512, 192, 576),
    "lid": (192, 512, 256, 576),
    "sock": (128, 576, 256, 640),
    "extra": (256, 512, 512, 768),
    "extra2": (512, 512, 768, 768),
    "extra3": (768, 512, 1024, 768),
    "hair2": (0, 640, 256, 768),
}
PALETTE = (0, 768, 1024, 1024)
CELL = 32
INSET = 3  # px kept away from region borders (mip bleeding)


def hex2rgb(h):
    if isinstance(h, (tuple, list, np.ndarray)):
        return np.asarray(h, dtype=np.float64)
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)])


def mix(a, b, t):
    t = np.asarray(t, dtype=np.float64)
    return a + (b - a) * t[..., None]


def shade(c, k):
    return np.clip(hex2rgb(c) * k, 0, 1)


class Atlas:
    def __init__(self):
        self.img = np.zeros((SIZE, SIZE, 3), dtype=np.float64)
        self.img[:] = (0.5, 0.5, 0.5)
        self.cells = {}
        self.next_cell = 0

    # --- uv mapping -------------------------------------------------------------------------
    def region_uv(self, key, u, v, sub=None):
        x0, y0, x1, y1 = REGIONS[key]
        if sub is not None:
            su0, sv0, su1, sv1 = sub
            u = su0 + (su1 - su0) * u
            v = sv0 + (sv1 - sv0) * v
        u = np.clip(u, 0.0, 1.0)
        v = np.clip(v, 0.0, 1.0)
        w, h = x1 - x0, y1 - y0
        px = x0 + INSET + u * (w - 2 * INSET)
        py = y1 - INSET - v * (h - 2 * INSET)
        return px / SIZE, 1.0 - py / SIZE

    def cell_uv(self, name, color):
        key = name
        if key not in self.cells:
            i = self.next_cell
            self.next_cell += 1
            cols = (PALETTE[2] - PALETTE[0]) // CELL
            cx = PALETTE[0] + (i % cols) * CELL
            cy = PALETTE[1] + (i // cols) * CELL
            self.cells[key] = (cx, cy)
            self.img[cy:cy + CELL, cx:cx + CELL] = hex2rgb(color)
        cx, cy = self.cells[key]
        return (cx + CELL / 2) / SIZE, 1.0 - (cy + CELL / 2) / SIZE

    # --- painting ----------------------------------------------------------------------------
    def coords(self, key):
        x0, y0, x1, y1 = REGIONS[key]
        w, h = x1 - x0, y1 - y0
        xs = (np.arange(w) + 0.5 - INSET) / (w - 2 * INSET)
        ys = (np.arange(h) + 0.5 - INSET) / (h - 2 * INSET)
        U, Vtop = np.meshgrid(xs, ys)
        V = 1.0 - Vtop
        return U, V

    def put(self, key, rgb):
        x0, y0, x1, y1 = REGIONS[key]
        self.img[y0:y1, x0:x1] = np.clip(rgb, 0, 1)

    def to_pixels(self):
        """RGBA float32, rows bottom->top (Blender image layout)."""
        rgba = np.ones((SIZE, SIZE, 4), dtype=np.float32)
        rgba[..., :3] = self.img[::-1]
        return rgba


# ------------------------------------------------------------------------------------------------
# noise helpers
# ------------------------------------------------------------------------------------------------

def noise2(U, V, scale, seed=0):
    """Smooth value noise on a grid (bilinear between hashed lattice values) in [0, 1]."""
    x = U * scale
    y = V * scale
    xi = np.floor(x).astype(np.int64)
    yi = np.floor(y).astype(np.int64)
    fx = x - xi
    fy = y - yi
    fx = fx * fx * (3 - 2 * fx)
    fy = fy * fy * (3 - 2 * fy)

    def h(i, j):
        return C.hash_noise(i * 7919 + j * 104729, seed)
    a = h(xi, yi)
    b = h(xi + 1, yi)
    c = h(xi, yi + 1)
    d = h(xi + 1, yi + 1)
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def fbm(U, V, scale, seed=0, octaves=3):
    out = 0
    amp = 1.0
    tot = 0
    for o in range(octaves):
        out = out + amp * noise2(U, V, scale * 2 ** o, seed + o * 13)
        tot += amp
        amp *= 0.5
    return out / tot


def grain(U, V, seed=0, amount=0.05, scale=180.0):
    return 1.0 + (fbm(U, V, scale, seed, 2) - 0.5) * 2 * amount


def box(X, Y, x0, y0, x1, y1, soft=0.002):
    return C.smoothstep(x0 - soft, x0 + soft, X) * C.smoothstep(x1 + soft, x1 - soft, X) * \
        C.smoothstep(y0 - soft, y0 + soft, Y) * C.smoothstep(y1 + soft, y1 - soft, Y)


def outline(X, Y, x0, y0, x1, y1, w=0.003):
    return np.clip(box(X, Y, x0 - w, y0 - w, x1 + w, y1 + w, 0.001) - box(X, Y, x0 + w, y0 + w, x1 - w, y1 - w, 0.001), 0, 1)


def disc(X, Y, cx, cy, r, soft=0.0015):
    d = np.sqrt((X - cx) ** 2 + (Y - cy) ** 2)
    return C.smoothstep(r + soft, r - soft, d)


# ------------------------------------------------------------------------------------------------
# fabrics: f(X, Y) in metres -> rgb ; dims = (circumference, length) of the part
# ------------------------------------------------------------------------------------------------

def fabric(spec, X, Y, U, V, seed=0):
    kind = spec.get("kind", "solid")
    base = hex2rgb(spec.get("base", "#888888"))
    if kind == "tartan":
        sett = spec.get("sett", 0.12)
        dark = hex2rgb(spec.get("dark", "#1c1414"))
        line = hex2rgb(spec.get("line", "#000000"))
        lw = spec.get("line_w", 0.0)
        # buffalo check: half the sett base, half dark, in both directions
        bx = (np.mod(X / sett, 1.0) < 0.5).astype(float)
        by = (np.mod(Y / sett, 1.0) < 0.5).astype(float)
        warp = mix(base, dark, bx)
        weft = mix(base, dark, by)
        col = 0.5 * (warp + weft)
        both = bx * by
        col = mix(col, dark * 0.85, both * 0.6)
        if lw > 0:
            lx = (np.abs(np.mod(X / sett + 0.25, 1.0) - 0.5) < lw / sett).astype(float)
            ly = (np.abs(np.mod(Y / sett + 0.25, 1.0) - 0.5) < lw / sett).astype(float)
            col = mix(col, line, np.clip(lx + ly, 0, 1) * 0.55)
        # fabric weave texture
        tw = 0.94 + 0.06 * np.sin((X + Y) * 2 * math.pi / 0.004)
        col = col * tw[..., None] * grain(U, V, seed, 0.04)[..., None]
    elif kind == "denim":
        tw = 0.92 + 0.08 * np.sin((X * 0.7 + Y) * 2 * math.pi / 0.0035)
        streak = 0.9 + 0.2 * fbm(X * 3, Y * 0.2, 40, seed + 3)
        col = base[None, None] * (tw * streak)[..., None]
        col = col * grain(U, V, seed, 0.05)[..., None]
    elif kind == "knit":
        rib = spec.get("rib", 0.012)
        k = 0.82 + 0.18 * np.abs(np.sin(X / rib * math.pi)) ** 0.6
        st = 0.95 + 0.05 * np.sin(Y / 0.006 * math.pi * 2)
        col = base[None, None] * (k * st)[..., None] * grain(U, V, seed, 0.05)[..., None]
        if spec.get("cable"):
            # cable stripes
            cx = np.mod(X, 0.09) - 0.045
            cab = np.exp(-(cx / 0.012) ** 2) * (0.85 + 0.15 * np.sin(Y / 0.018 * math.pi * 2 + cx * 60))
            col = col * (1 + 0.12 * cab)[..., None]
    elif kind == "corduroy":
        k = 0.85 + 0.15 * np.abs(np.sin(X / 0.004 * math.pi))
        col = base[None, None] * k[..., None] * grain(U, V, seed, 0.04)[..., None]
    elif kind == "stripes":
        other = hex2rgb(spec.get("other", "#ffffff"))
        w = spec.get("width", 0.03)
        s = (np.mod(Y / w, 1.0) < 0.5).astype(float)
        col = mix(base, other, s) * grain(U, V, seed, 0.03)[..., None]
    elif kind == "fur":
        other = hex2rgb(spec.get("other", "#555555"))
        n1 = fbm(X * 0.6, Y * 0.12, 60, seed, 3)
        strand = 0.75 + 0.25 * np.sin(X / 0.006 * math.pi * 2 + n1 * 8)
        col = mix(base, other, n1)[..., :] * strand[..., None]
    else:  # solid / fleece / nylon / canvas
        amt = spec.get("grain", 0.05)
        col = base[None, None] * grain(U, V, seed, amt)[..., None]
        col = col * np.ones_like(X)[..., None]
    if col.ndim == 1:
        col = np.broadcast_to(col, X.shape + (3,)).copy()
    return col


def details_top(spec, X, Y, circ, length, col):
    """Garment details on the torso map. X along the circumference (front centre at 0.75 * circ),
    Y up from the hem."""
    front = 0.75 * circ
    dx = X - front
    for d in spec.get("details", []):
        kind = d[0]
        if kind == "placket":
            c = hex2rgb(d[1]) if len(d) > 1 else None
            m = C.smoothstep(0.016, 0.012, np.abs(dx))
            edge = C.smoothstep(0.003, 0.0, np.abs(np.abs(dx) - 0.014)) * 0.25
            col = col * (1 - edge)[..., None]
            if c is not None:
                col = mix(col, c, m)
        elif kind == "buttons":
            bc = hex2rgb(d[1])
            n = d[2] if len(d) > 2 else 6
            for i in range(n):
                y = length * (0.12 + 0.78 * i / max(n - 1, 1))
                m = disc(dx, Y, 0.0, y, 0.0065)
                col = mix(col, bc, m)
                col = col * (1 - 0.35 * disc(dx, Y, 0.0, y, 0.0022))[..., None]
        elif kind == "zip":
            zc = hex2rgb(d[1])
            m = C.smoothstep(0.006, 0.004, np.abs(dx))
            teeth = 0.8 + 0.2 * (np.mod(Y / 0.004, 1) < 0.5)
            col = mix(col, zc * teeth[..., None], m)
        elif kind == "pockets":
            # chest pockets with flaps (x offsets from the front centre)
            pc = hex2rgb(d[1]) if len(d) > 1 and d[1] else None
            for sx in (-1, 1):
                x0 = sx * 0.055 - 0.040
                x1 = sx * 0.055 + 0.040
                y1 = length * 0.80
                y0 = y1 - 0.10
                ol = outline(dx, Y, x0, y0, x1, y1, 0.0025)
                col = col * (1 - 0.45 * ol)[..., None]
                flap = box(dx, Y, x0, y1 - 0.032, x1, y1, 0.001)
                col = col * (1 - 0.18 * outline(dx, Y, x0, y1 - 0.032, x1, y1, 0.002))[..., None]
                if pc is not None:
                    col = mix(col, pc, flap * 0.5)
                col = mix(col, hex2rgb("#2a221c"), disc(dx, Y, (x0 + x1) / 2, y1 - 0.02, 0.005))
        elif kind == "kangaroo":
            pc = col * 0.85
            m = box(dx, Y, -0.13, 0.04, 0.13, 0.20, 0.002)
            ol = outline(dx, Y, -0.13, 0.04, 0.13, 0.20, 0.003)
            col = col * (1 - 0.12 * m - 0.35 * ol)[..., None]
        elif kind == "tree_print":
            tc = hex2rgb(d[1])
            yc = length * 0.66
            # a small pine: three stacked triangles + trunk
            m = np.zeros_like(X)
            for k, (w, h, y0) in enumerate(((0.050, 0.040, 0.0), (0.040, 0.036, 0.028), (0.028, 0.032, 0.054))):
                yy = Y - (yc + y0)
                tri = (yy > 0) & (yy < h) & (np.abs(dx) < w * (1 - yy / h))
                m = np.maximum(m, tri.astype(float))
            trunk = box(dx, Y, -0.007, yc - 0.014, 0.007, yc + 0.002, 0.001)
            m = np.maximum(m, trunk)
            col = mix(col, tc, m * 0.92)
        elif kind == "rib_hem":
            h = d[1] if len(d) > 1 else 0.05
            rib = 0.85 + 0.15 * np.abs(np.sin(X / 0.004 * math.pi))
            m = C.smoothstep(h + 0.004, h, Y)
            col = col * (1 - m * (1 - rib) - m * 0.06)[..., None]
        elif kind == "hem_line":
            m = C.smoothstep(0.004, 0.0, np.abs(Y - d[1]))
            col = col * (1 - 0.35 * m)[..., None]
        elif kind == "center_strip":
            # blouse visible between open cardigan fronts
            sc = hex2rgb(d[1])
            w = d[2]
            m = C.smoothstep(w + 0.004, w, np.abs(dx)) * C.smoothstep(length * 0.0, length * 0.08, Y)
            col = mix(col, sc * grain(X, Y, 3, 0.03)[..., None], m)
            edge = C.smoothstep(0.006, 0.0, np.abs(np.abs(dx) - w))
            col = col * (1 - 0.3 * edge)[..., None]
        elif kind == "panel":
            pc = hex2rgb(d[1])
            y0, y1 = d[2], d[3]
            m = C.smoothstep(y0 - 0.003, y0 + 0.003, Y) * C.smoothstep(y1 + 0.003, y1 - 0.003, Y)
            col = mix(col, pc, m)
        elif kind == "bib":
            # overall bib on the front of the torso (denim) and straps over the shoulders
            bc = hex2rgb(d[1])
            yb = d[2]
            den = fabric({"kind": "denim", "base": d[1]}, X, Y, X * 3, Y * 3)
            bib = box(dx, Y, -0.085, -1, 0.085, yb, 0.002)
            back = box(X - 0.25 * circ, Y, -0.10, -1, 0.10, yb - 0.05, 0.002)
            waist = C.smoothstep(length * 0.30 + 0.004, length * 0.30, Y)
            strap = np.zeros_like(X)
            for sx in (-1, 1):
                strap = np.maximum(strap, box(dx, Y, sx * 0.065 - 0.02, yb - 0.01, sx * 0.065 + 0.02, 10, 0.002))
                bx = X - (0.25 * circ + sx * 0.06)
                strap = np.maximum(strap, box(bx, Y, -0.02, yb - 0.08, 0.02, 10, 0.002))
            m = np.clip(bib + back + waist + strap, 0, 1)
            col = mix(col, den, m)
            ol = np.clip(outline(dx, Y, -0.085, -1, 0.085, yb, 0.003), 0, 1)
            col = col * (1 - 0.3 * ol)[..., None]
            # bib pocket and buttons
            col = col * (1 - 0.35 * outline(dx, Y, -0.045, yb - 0.10, 0.045, yb - 0.025, 0.0025))[..., None]
            for sx in (-1, 1):
                col = mix(col, hex2rgb("#c9a45a"), disc(dx, Y, sx * 0.068, yb - 0.018, 0.009))
    return col


def details_bottom(spec, X, Y, circ, length, col):
    """Trousers map: X around (outer side seam at 0, inner seam at circ/2, front at 0.75 circ),
    Y down from the waist (0) to the hem."""
    for d in spec.get("details", []):
        kind = d[0]
        if kind == "jeans":
            st = hex2rgb(d[1]) if len(d) > 1 else hex2rgb("#c98a3a")
            for xs in (0.0, circ * 0.5, circ):
                seam = C.smoothstep(0.004, 0.0, np.abs(X - xs))
                col = col * (1 - 0.3 * seam)[..., None]
                stitch = C.smoothstep(0.0012, 0.0, np.abs(np.abs(X - xs) - 0.006)) * (np.mod(Y / 0.006, 1) < 0.6)
                col = mix(col, st, stitch * 0.6)
            # waistband
            wb = C.smoothstep(0.042, 0.038, Y)
            col = col * (1 - 0.12 * wb)[..., None]
            col = mix(col, st, C.smoothstep(0.0012, 0.0, np.abs(Y - 0.040)) * 0.5)
            # front pocket curve
            fx = X - circ * 0.60
            curve = np.abs(np.sqrt(np.maximum(fx, 0) ** 2 + (Y * 0.9) ** 2) - 0.085) < 0.002
            col = col * (1 - 0.35 * (curve & (fx > 0) & (Y < 0.10)))[..., None]
            # fading on the thighs and knees (front)
            fr = np.exp(-((X - circ * 0.75) / (circ * 0.16)) ** 2)
            th = np.exp(-((Y - 0.30) / 0.14) ** 2) * 0.22 + np.exp(-((Y - spec.get("knee_y", 0.52)) / 0.06) ** 2) * 0.15
            col = col * (1 + fr * th)[..., None]
        elif kind == "cargo":
            pc = col * 0.9
            for xs in (0.0, circ):
                m = box(X - xs, Y, -0.065, 0.20, 0.065, 0.36, 0.002)
                ol = outline(X - xs, Y, -0.065, 0.20, 0.065, 0.36, 0.0025)
                col = col * (1 - 0.06 * m - 0.4 * ol)[..., None]
                col = col * (1 - 0.3 * outline(X - xs, Y, -0.065, 0.31, 0.065, 0.36, 0.002))[..., None]
            wb = C.smoothstep(0.04, 0.036, Y)
            col = col * (1 - 0.15 * wb)[..., None]
        elif kind == "hem_dark":
            m = C.smoothstep(length - 0.05, length - 0.01, Y)
            col = col * (1 - 0.15 * m)[..., None]
        elif kind == "seams":
            for xs in (0.0, circ * 0.5, circ):
                seam = C.smoothstep(0.004, 0.0, np.abs(X - xs))
                col = col * (1 - 0.3 * seam)[..., None]
            wb = C.smoothstep(0.04, 0.036, Y)
            col = col * (1 - 0.12 * wb)[..., None]
    return col


# ------------------------------------------------------------------------------------------------
# region painters
# ------------------------------------------------------------------------------------------------

def paint_face(atlas, spec):
    U, V = atlas.coords("face")
    col = spec["colors"]
    skin = hex2rgb(col["skin"])
    phi = U * C.TAU - math.pi
    theta = (1 - V) * math.radians(150)
    out = np.broadcast_to(skin, U.shape + (3,)).copy()
    out = out * grain(U, V, 5, 0.025)[..., None]
    blush = hex2rgb(col.get("blush", "#e0806a"))
    bk = spec.get("blush", 0.45)
    for sx in (1, -1):
        d = ((phi - sx * 0.62) / 0.30) ** 2 + ((theta - math.radians(104)) / math.radians(11)) ** 2
        out = mix(out, blush, np.exp(-d) * bk)
    # nose tip warmth, ears area, lips area
    d = (phi / 0.13) ** 2 + ((theta - math.radians(101)) / math.radians(7)) ** 2
    out = mix(out, blush, np.exp(-d) * 0.42)
    # warm, slightly darker eye sockets and philtrum shadow (less porcelain)
    for sx in (1, -1):
        d = ((phi - sx * 0.40) / 0.22) ** 2 + ((theta - math.radians(86)) / math.radians(7)) ** 2
        out = mix(out, skin * np.array((0.86, 0.74, 0.70)), np.exp(-d) * 0.35)
    # skin tone variation (warmer at the temples / jaw)
    out = mix(out, skin * np.array((0.95, 0.86, 0.80)), (1 - np.exp(-(phi / 1.1) ** 2)) * 0.35)
    # slightly darker under the jaw and on the nape
    out = out * (1 - 0.10 * C.smoothstep(math.radians(128), math.radians(148), theta))[..., None]

    if spec.get("werewolf"):
        fur = hex2rgb(col.get("fur", "#5a4a3e"))
        n1 = fbm(U * 1.0, V * 0.15, 80, 41, 3)
        strands = 0.75 + 0.25 * np.abs(np.sin(U * 2 * math.pi * 90 + n1 * 6))
        out = mix(out, fur, 0.5) * strands[..., None]
        # lighter muzzle / chin
        d = (phi / 0.45) ** 2 + ((theta - math.radians(112)) / math.radians(18)) ** 2
        out = mix(out, hex2rgb("#9a8a78"), np.exp(-d) * 0.6)
    if spec.get("stubble"):
        sc = hex2rgb(spec["stubble"])
        m = C.smoothstep(math.radians(108), math.radians(122), theta) * C.smoothstep(1.35, 1.0, np.abs(phi))
        # keep the lips area clear
        lips = np.exp(-((phi / 0.32) ** 2 + ((theta - math.radians(113)) / math.radians(5)) ** 2))
        out = mix(out, sc, m * (1 - lips) * 0.35 * (0.8 + 0.4 * noise2(U, V, 120, 9)))
    if spec.get("freckles"):
        fc = hex2rgb(spec["freckles"])
        n = noise2(U, V, 140, 21)
        area = np.exp(-((np.abs(phi) - 0.35) / 0.35) ** 2 - ((theta - math.radians(97)) / math.radians(10)) ** 2)
        dots = C.smoothstep(0.82, 0.9, n) * area
        out = mix(out, fc, dots * 0.6)
    if spec.get("wrinkles"):
        # soft smile lines + crow's feet shading
        for sx in (1, -1):
            d = ((phi - sx * 0.40) / 0.06) ** 2 + ((theta - math.radians(112)) / math.radians(9)) ** 2
            out = out * (1 - 0.10 * np.exp(-d))[..., None]
    atlas.put("face", out)


def paint_eye(atlas, spec):
    U, V = atlas.coords("eye")
    col = spec["colors"]
    X = U - 0.5
    Y = V - 0.5
    rho = np.sqrt(X ** 2 + Y ** 2)
    sclera = hex2rgb(col.get("sclera", "#f2ede6"))
    iris = hex2rgb(col.get("iris", "#5a3a20"))
    out = np.broadcast_to(sclera, U.shape + (3,)).copy()
    out = out * (1 - 0.18 * C.smoothstep(0.30, 0.5, rho))[..., None]
    ri = math.radians(spec.get("iris_deg", 35)) / math.radians(140)
    rp = ri * spec.get("pupil", 0.46)
    ang = np.arctan2(Y, X)
    fib = 0.85 + 0.15 * np.sin(ang * 23 + rho * 40)
    irc = mix(iris * 1.35, iris * 0.75, C.smoothstep(rp, ri, rho))
    irc = irc * fib[..., None]
    out = mix(out, irc, C.smoothstep(ri + 0.006, ri - 0.004, rho))
    out = mix(out, iris * 0.35, C.smoothstep(0.012, 0.0, np.abs(rho - ri + 0.004)) * 0.8)
    out = mix(out, hex2rgb("#0b0807"), C.smoothstep(rp + 0.006, rp - 0.004, rho))
    if spec.get("glow"):
        g = hex2rgb(spec["glow"])
        out = mix(out, g, C.smoothstep(ri + 0.03, ri - 0.004, rho) * (1 - C.smoothstep(rp + 0.004, rp - 0.004, rho) * 0.9))
    # highlights (upper outer)
    out = mix(out, np.array((1.0, 1.0, 1.0)), disc(X, Y, -0.062, 0.070, 0.046, 0.006))
    out = mix(out, np.array((1.0, 1.0, 1.0)), disc(X, Y, 0.050, -0.055, 0.018, 0.004) * 0.85)
    atlas.put("eye", out)


def paint_mouth(atlas, spec):
    U, V = atlas.coords("mouth")
    col = spec["colors"]
    X = U - 0.5
    Y = V - 0.5
    rho = np.sqrt(X ** 2 + Y ** 2)
    inside = hex2rgb(col.get("mouth", "#4a1616"))
    lip = hex2rgb(col.get("lip_line", "#5a2a22"))
    out = np.broadcast_to(inside, U.shape + (3,)).copy()
    out = mix(out, hex2rgb("#f4efe6"), C.smoothstep(0.16, 0.20, Y) * C.smoothstep(0.42, 0.36, rho))
    out = mix(out, hex2rgb("#b0464a"), C.smoothstep(-0.14, -0.22, Y) * C.smoothstep(0.42, 0.34, rho))
    out = mix(out, inside * 0.7, C.smoothstep(0.38, 0.48, rho))
    atlas.put("mouth", out)


def paint_lid(atlas, spec):
    U, V = atlas.coords("lid")
    col = spec["colors"]
    skin = hex2rgb(col["skin"])
    lash = hex2rgb(col.get("lash", "#1c120c"))
    lid = skin * np.array((0.95, 0.90, 0.88))
    out = mix(np.broadcast_to(lid, U.shape + (3,)), skin, C.smoothstep(0.25, 0.6, V))
    upper = U < 0.5
    k_up = spec.get("lash_up", 1.0)
    out = np.where(upper[..., None], mix(out, lash, C.smoothstep(0.19, 0.11, V) * k_up), out)
    out = np.where(upper[..., None], out, mix(out, lash * 1.6 + skin * 0.2, C.smoothstep(0.12, 0.05, V) * 0.65))
    atlas.put("lid", out)


def paint_hair(atlas, spec, key="hair", hair=None):
    U, V = atlas.coords(key)
    hair = hair or spec.get("hair", {})
    base = hex2rgb(hair.get("color", "#3a2416"))
    hi = hex2rgb(hair.get("hi", None) or (base * 1.45).clip(0, 1))
    lo = base * 0.55
    n1 = fbm(U * 1.0, V * 0.05, 60, 31, 2)
    n2 = fbm(U * 1.0, V * 0.10, 260, 37, 2)
    nclump = hair.get("clump_tex", 10)
    groove = np.abs(np.sin((U * nclump + n1 * 0.15) * math.pi))
    strands = (0.86 + 0.14 * n2) * (0.80 + 0.20 * groove ** 0.5)
    out = mix(lo, base, C.smoothstep(0.0, 0.35, V))  # roots darker
    sheen = np.exp(-((V - 0.42) / 0.12) ** 2) * (0.55 + 0.45 * noise2(U, V * 0.1, 40, 7))
    out = mix(out, hi, sheen * 0.45)
    out = out * strands[..., None]
    out = mix(out, lo, C.smoothstep(0.85, 1.0, V) * 0.35)
    atlas.put(key, out)


def paint_garment(atlas, key, fab, dims, seed=1, top_details=True):
    if fab is None:
        return
    U, V = atlas.coords(key)
    circ, length = dims
    X = U * circ
    Y = V * length
    col = fabric(fab, X, Y, U, V, seed)
    if key in ("top", "top2"):
        col = details_top(fab, X, Y, circ, length, col)
    elif key == "bottom":
        col = details_bottom(fab, X, length - Y, circ, length, col)
    elif key == "sleeve":
        for d in fab.get("sleeve_details", []):
            if d[0] == "cuff_band":
                h = d[1]
                m = C.smoothstep(length - h - 0.004, length - h, Y)
                cc = hex2rgb(d[2]) if len(d) > 2 else None
                rib = 0.85 + 0.15 * np.abs(np.sin(X / 0.004 * math.pi))
                if cc is not None:
                    col = mix(col, cc * rib[..., None], m)
                else:
                    col = col * (1 - m * (1 - rib))[..., None]
            elif d[0] == "elbow_patch":
                pc = hex2rgb(d[1])
                m = np.exp(-(((X - circ * 0.5) / 0.035) ** 2 + ((Y - length * 0.48) / 0.05) ** 2) ** 2)
                col = mix(col, pc, C.smoothstep(0.3, 0.5, m))
            elif d[0] == "stripe":
                pc = hex2rgb(d[1])
                m = C.smoothstep(0.012, 0.008, np.abs(X - circ * d[2]))
                col = mix(col, pc, m)
    atlas.put(key, col)


def paint_shoe(atlas, spec):
    sh = spec.get("shoe_paint", {})
    U, V = atlas.coords("shoe")
    kind = sh.get("kind", "sneaker")
    upper = hex2rgb(sh.get("upper", "#ffffff"))
    acc = hex2rgb(sh.get("accent", "#888888"))
    lace = hex2rgb(sh.get("lace", "#f0f0f0"))
    out = np.broadcast_to(upper, U.shape + (3,)).copy() * grain(U, V, 4, 0.04)[..., None]
    # shoe upper sub-rect: v in [0, 0.6]: vs 0 = heel -> 1 = toe ; u around (0 outer side, .25 top, .5 inner, .75 bottom)
    vs = V / 0.6
    top = np.exp(-((U - 0.25) / 0.06) ** 2)
    lace_zone = top * C.smoothstep(0.22, 0.30, vs) * C.smoothstep(0.70, 0.62, vs)
    bars = (np.mod(vs * 14, 1.0) < 0.45).astype(float)
    tongue = upper * 0.85
    shoe_part = V < 0.6
    sp = np.zeros_like(U)
    if kind in ("boot", "hiker"):
        toe = C.smoothstep(0.78, 0.86, vs)
        heel = C.smoothstep(0.12, 0.05, vs)
        out = mix(out, acc, np.clip(toe + heel, 0, 1) * shoe_part)
        out = mix(out, tongue, lace_zone * shoe_part)
        out = mix(out, lace, lace_zone * bars * shoe_part)
        # stitching line
        st = C.smoothstep(0.004, 0.0, np.abs(vs - 0.80)) * shoe_part
        out = out * (1 - 0.3 * st)[..., None]
    elif kind == "canvas":
        toe = C.smoothstep(0.86, 0.90, vs)
        out = mix(out, hex2rgb("#f2efe8"), toe * shoe_part)
        out = mix(out, lace, lace_zone * bars * shoe_part)
        stripe = C.smoothstep(0.02, 0.0, np.abs(U - 0.83)) + C.smoothstep(0.02, 0.0, np.abs(U - 0.67))
        out = mix(out, acc, np.clip(stripe, 0, 1) * shoe_part * 0.8)
    elif kind == "flat":
        out = mix(out, acc, C.smoothstep(0.85, 0.92, vs) * shoe_part * 0.5)
    else:  # sneaker
        swoosh = np.exp(-((np.abs(U - 0.5) - 0.48) / 0.05) ** 2) + np.exp(-((U - 0.0) / 0.05) ** 2)
        side = C.smoothstep(0.3, 0.4, vs) * C.smoothstep(0.85, 0.7, vs) * np.clip(swoosh, 0, 1)
        out = mix(out, acc, side * shoe_part * 0.9)
        out = mix(out, lace, lace_zone * bars * shoe_part)
        heel = C.smoothstep(0.10, 0.04, vs)
        out = mix(out, acc, heel * shoe_part * 0.8)
    # shaft (boots / high tops) v in [0.62, 1]: u 0.25 = front
    shaft = V > 0.62
    vv = (V - 0.62) / 0.38
    sh_col = hex2rgb(sh.get("shaft", sh.get("upper", "#7a4a2a")))
    sc = np.broadcast_to(sh_col, U.shape + (3,)) * grain(U, V, 6, 0.05)[..., None]
    fz = np.exp(-((U - 0.25) / 0.07) ** 2)
    sc = mix(sc, sh_col * 0.8, fz)
    sc = mix(sc, lace, fz * (np.mod(vv * 9, 1.0) < 0.35) * C.smoothstep(0.0, 0.1, vv))
    sc = mix(sc, hex2rgb(sh.get("collar", "#5a3a22")), C.smoothstep(0.82, 0.88, vv))
    out = np.where(shaft[..., None], sc, out)
    atlas.put("shoe", out)


def paint_hat(atlas, spec):
    hat = spec.get("hat") or {}
    hp = hat.get("paint", {})
    U, V = atlas.coords("hat")
    kind = hp.get("kind", "solid")
    base = hex2rgb(hp.get("base", "#888888"))
    if kind == "straw":
        w1 = np.sin(U * 2 * math.pi * 90) * np.sin(V * 2 * math.pi * 30)
        out = base[None, None] * (0.86 + 0.14 * (w1 > 0))[..., None] * grain(U, V, 8, 0.06)[..., None]
    elif kind == "knit":
        rib = 0.80 + 0.20 * np.abs(np.sin(U * math.pi * 64)) ** 0.6
        out = base[None, None] * rib[..., None] * grain(U, V, 9, 0.05)[..., None]
        if hp.get("stripe"):
            sc = hex2rgb(hp["stripe"])
            m = C.smoothstep(0.012, 0.0, np.abs(V - hp.get("stripe_v", 0.35)) - 0.03)
            out = mix(out, sc * rib[..., None], m)
    elif kind == "felt":
        out = base[None, None] * grain(U, V, 10, 0.05)[..., None] * np.ones(U.shape + (1,))
    elif kind == "cap":
        panels = 0.92 + 0.08 * (np.abs(np.sin(U * math.pi * 6)) > 0.97)
        out = base[None, None] * panels[..., None] * grain(U, V, 11, 0.04)[..., None]
    elif kind == "bandana":
        other = hex2rgb(hp.get("other", "#ffffff"))
        x = U * 20
        y = V * 8
        dots = disc(np.mod(x, 1.0), np.mod(y, 1.0), 0.5, 0.5, 0.18, 0.05)
        out = mix(np.broadcast_to(base, U.shape + (3,)), other, dots * 0.8) * grain(U, V, 12, 0.04)[..., None]
    else:
        out = base[None, None] * grain(U, V, 13, 0.04)[..., None] * np.ones(U.shape + (1,))
    # band colour in the lower part of the crown (v in band range)
    if hp.get("band"):
        bc = hex2rgb(hp["band"])
        v0, v1 = hp.get("band_v", (0.10, 0.22))
        m = C.smoothstep(v0 - 0.01, v0, V) * C.smoothstep(v1 + 0.01, v1, V)
        out = mix(out, bc * grain(U, V, 14, 0.04)[..., None], m)
    atlas.put("hat", out)


def paint_sock(atlas, spec):
    U, V = atlas.coords("sock")
    sp = spec.get("sock_paint", {"base": "#eeeeee"})
    base = hex2rgb(sp.get("base", "#eeeeee"))
    out = np.broadcast_to(base, U.shape + (3,)).copy()
    rib = 0.88 + 0.12 * np.abs(np.sin(U * math.pi * 40))
    out = out * rib[..., None]
    for c, v0, v1 in sp.get("stripes", []):
        m = C.smoothstep(v0 - 0.01, v0, V) * C.smoothstep(v1 + 0.01, v1, V)
        out = mix(out, hex2rgb(c) * rib[..., None], m)
    atlas.put("sock", out)


def paint_extra(atlas, key, fab, dims=(1.0, 1.0), seed=5):
    if fab is None:
        return
    U, V = atlas.coords(key)
    X = U * dims[0]
    Y = V * dims[1]
    col = fabric(fab, X, Y, U, V, seed)
    atlas.put(key, col)
