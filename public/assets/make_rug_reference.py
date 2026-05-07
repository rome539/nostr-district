"""
Generate a floor rug perspective reference for Aseprite.
The game floor is orthographic (no foreshortening) — tiles draw as 22x22 squares.

rug_reference.png  — 280x104, matches the standard rug bounds
                     Load as a layer in Aseprite and draw your rug on top.
"""
import zlib, struct, os

RW, RH = 280, 104   # rug canvas — matches FURNITURE_BOUNDS['rug']

TILE   = 22         # floor tile size (from roomWalls.ts neon grid / tile style)

# colors
BG          = ( 26,  10,  62, 255)   # floor color (dark purple)
GRID_MAJOR  = ( 93, 202, 165,  60)   # teal grid lines (every tile)
GRID_MINOR  = (255, 255, 255,  18)   # faint sub-grid (every 4px)
BORDER_SAFE = (250, 212, 128, 180)   # amber — inner safe zone (fringe goes here)
CENTER      = (255,  80,  80,  90)   # center cross
EDGE        = (200, 200, 200, 120)   # canvas edge

def make_pixels():
    return [[(0, 0, 0, 0)] * RW for _ in range(RH)]

def blend(base, over):
    br, bg, bb, ba = base
    or_, og, ob, oa = over
    fa = oa / 255
    return (
        int(br * (1 - fa) + or_ * fa),
        int(bg * (1 - fa) + og * fa),
        int(bb * (1 - fa) + ob * fa),
        min(255, ba + oa),
    )

def fill(pix, px, py, w, h, col):
    for y in range(max(0, py), min(RH, py + h)):
        for x in range(max(0, px), min(RW, px + w)):
            pix[y][x] = blend(pix[y][x], col)

def hline(pix, y, col, x0=0, x1=RW):
    for x in range(max(0, x0), min(RW, x1)):
        if 0 <= y < RH:
            pix[y][x] = blend(pix[y][x], col)

def vline(pix, x, col, y0=0, y1=RH):
    for y in range(max(0, y0), min(RH, y1)):
        if 0 <= x < RW:
            pix[y][x] = blend(pix[y][x], col)

def save_png(path, pixels):
    def chunk(t, d):
        c = t + d
        return struct.pack('>I', len(d)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    sig  = b'\x89PNG\r\n\x1a\n'
    ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', RW, RH, 8, 6, 0, 0, 0))
    raw  = b''.join(b'\x00' + bytes([v for px in row for v in px]) for row in pixels)
    idat = chunk(b'IDAT', zlib.compress(raw, 9))
    iend = chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(sig + ihdr + idat + iend)

p = make_pixels()

# ── floor background ──────────────────────────────────────────────────────
fill(p, 0, 0, RW, RH, BG)

# ── tile grid (22x22, matching game floor) ────────────────────────────────
for gx in range(0, RW, TILE):
    vline(p, gx, GRID_MAJOR)
for gy in range(0, RH, TILE):
    hline(p, gy, GRID_MAJOR)

# ── sub-pixel grid every 4px (faint) ─────────────────────────────────────
for gx in range(0, RW, 4):
    if gx % TILE != 0:
        vline(p, gx, GRID_MINOR)
for gy in range(0, RH, 4):
    if gy % TILE != 0:
        hline(p, gy, GRID_MINOR)

# ── fringe/border margin guide (6px inset) ───────────────────────────────
FRINGE = 6
hline(p, FRINGE,      BORDER_SAFE)
hline(p, RH - FRINGE, BORDER_SAFE)
vline(p, FRINGE,      BORDER_SAFE)
vline(p, RW - FRINGE, BORDER_SAFE)

# ── center cross ─────────────────────────────────────────────────────────
cx, cy = RW // 2, RH // 2
hline(p, cy, CENTER, cx - 20, cx + 20)
vline(p, cx, CENTER, cy - 20, cy + 20)

# ── canvas edge ──────────────────────────────────────────────────────────
hline(p, 0,      EDGE)
hline(p, RH - 1, EDGE)
vline(p, 0,      EDGE)
vline(p, RW - 1, EDGE)

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'rug_reference.png')
save_png(out, p)
print(f'Saved: {out}  ({RW}x{RH})')
print()
print('Drawing guide:')
print(f'  Canvas           : {RW} x {RH} px  (use this exact size)')
print(f'  Floor tile grid  : every {TILE}px  (teal lines)')
print(f'  Fringe/border    : stay within 6px of edge')
print(f'  Center mark      : red cross at ({cx},{cy})')
print()
print('The floor is FLAT ORTHOGRAPHIC — no foreshortening.')
print('Draw your rug as if looking straight down from above.')
print()
print('Anatomy:')
print('  - Outer fringe/tassel row : ~4-6px from edge, top & bottom')
print('  - Border stripe           : ~8-12px inset from edge all around')
print('  - Main field pattern      : center area, your main design')
print('  - Keep it GRAYSCALE       : game applies tint color on top')
