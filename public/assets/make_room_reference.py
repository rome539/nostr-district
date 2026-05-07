"""
Generate a room layout reference PNG for Aseprite item placement.
Open as a separate layer to see exactly where zones are.

room_reference_layout.png — 800x480, matches the game canvas 1:1
"""
import zlib, struct, os

W, H = 800, 480
FY   = 300   # floor line y
DESK = (558, 242, 196, 58)   # x, y, w, h  (top of desk surface to floor)
DOOR = (340, 350, 120, 130)  # x, y, w, h

# ── colors (R, G, B, A) ───────────────────────────────────────────────────
WALL_BG     = (18,  8,  40, 255)   # dark purple wall
FLOOR_BG    = (26, 10,  62, 220)   # slightly lighter floor
FLOOR_LINE  = (93, 202, 165, 255)  # teal — the y=300 constraint line
BASEBOARD   = (60,  40, 120, 255)  # accent strip above floor line
DESK_BLOCK  = (255, 68,  68, 160)  # red — nothing can be placed here
DESK_BORDER = (255, 68,  68, 255)
DOOR_FILL   = (139, 90,  43, 130)  # brown door
DOOR_BORDER = (200, 140,  80, 200)
GRID        = (255, 255, 255,  18)  # faint white grid
LABEL_BG    = (  0,   0,   0, 180)
WALL_LABEL  = (93, 202, 165, 200)   # teal text bg indicator
FLOOR_LABEL = (250, 212, 128, 200)  # amber

def make_pixels():
    return [[(0, 0, 0, 0)] * W for _ in range(H)]

def fill(pix, px, py, w, h, col):
    r, g, b, a = col
    for y in range(max(0, py), min(H, py + h)):
        for x in range(max(0, px), min(W, px + w)):
            er, eg, eb, ea = pix[y][x]
            # simple alpha composite over existing
            fa = a / 255
            pix[y][x] = (
                int(er * (1 - fa) + r * fa),
                int(eg * (1 - fa) + g * fa),
                int(eb * (1 - fa) + b * fa),
                min(255, ea + a),
            )

def hline(pix, y, col, x0=0, x1=W):
    for x in range(x0, x1):
        if 0 <= y < H:
            pix[y][x] = col

def vline(pix, x, col, y0=0, y1=H):
    for y in range(y0, y1):
        if 0 <= x < W:
            pix[y][x] = col

def border(pix, px, py, w, h, col):
    hline(pix, py,         col, px, px + w)
    hline(pix, py + h - 1, col, px, px + w)
    vline(pix, px,         col, py, py + h)
    vline(pix, px + w - 1, col, py, py + h)

def save_png(path, pixels):
    def chunk(t, d):
        c = t + d
        return struct.pack('>I', len(d)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    sig  = b'\x89PNG\r\n\x1a\n'
    ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', W, H, 8, 6, 0, 0, 0))
    raw  = b''.join(b'\x00' + bytes([v for px in row for v in px]) for row in pixels)
    idat = chunk(b'IDAT', zlib.compress(raw, 9))
    iend = chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(sig + ihdr + idat + iend)

p = make_pixels()

# ── wall background ────────────────────────────────────────────────────────
fill(p, 0, 0, W, FY, WALL_BG)

# ── floor background ───────────────────────────────────────────────────────
fill(p, 0, FY, W, H - FY, FLOOR_BG)

# ── faint 100px grid ──────────────────────────────────────────────────────
for gx in range(0, W, 100):
    vline(p, gx, GRID)
for gy in range(0, H, 100):
    hline(p, gy, GRID)

# ── baseboard strip (y 288–300) ────────────────────────────────────────────
fill(p, 0, 288, W, 12, BASEBOARD)

# ── floor line at y=300 (2px thick, bright) ───────────────────────────────
hline(p, FY,     FLOOR_LINE)
hline(p, FY + 1, FLOOR_LINE)

# ── desk blocked zone ─────────────────────────────────────────────────────
dx, dy, dw, dh = DESK
fill(p, dx, dy, dw, dh, DESK_BLOCK)
border(p, dx, dy, dw, dh, DESK_BORDER)
# inner X mark
for i in range(min(dw, dh) // 2):
    if 0 <= dy + i < H and 0 <= dx + i < W:
        p[dy + i][dx + i] = DESK_BORDER
    if 0 <= dy + i < H and 0 <= dx + dw - 1 - i < W:
        p[dy + i][dx + dw - 1 - i] = DESK_BORDER

# ── door zone ─────────────────────────────────────────────────────────────
ox, oy2, ow, oh = DOOR
fill(p, ox, oy2, ow, oh, DOOR_FILL)
border(p, ox, oy2, ow, oh, DOOR_BORDER)

# ── tick marks every 50px on edges for measurement ────────────────────────
TICK = (200, 200, 200, 120)
for gx in range(0, W + 1, 50):
    for ty in range(0, 6):
        if 0 <= gx < W and 0 <= ty < H:
            p[ty][gx] = TICK
        if 0 <= gx < W and H - 1 - ty >= 0:
            p[H - 1 - ty][gx] = TICK
for gy in range(0, H + 1, 50):
    for tx in range(0, 6):
        if tx < W and 0 <= gy < H:
            p[gy][tx] = TICK
        if W - 1 - tx >= 0 and 0 <= gy < H:
            p[gy][W - 1 - tx] = TICK

# ── wall zone safe area indicator (left of desk) ──────────────────────────
# Thin bright border around left-wall safe zone: x0-550, y0-288
border(p, 0, 0, 550, 288, (93, 202, 165, 80))

# Right wall safe zone: x558-800, y0-242
border(p, 558, 0, 242, 242, (93, 202, 165, 80))

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'room_reference_layout.png')
save_png(out, p)
print(f'Saved: {out}')
print()
print('Zone reference:')
print(f'  Canvas          : {W} x {H}')
print(f'  Wall zone       : x=0–{W}, y=0–{FY}  (items hang here)')
print(f'  Floor line      : y={FY}  (teal line)')
print(f'  Baseboard       : y=288–{FY}')
print(f'  Floor zone      : x=0–{W}, y={FY}–{H}')
print(f'  Desk BLOCKED    : x={dx}–{dx+dw}, y={dy}–{dy+dh}  (red)')
print(f'  Door zone       : x={ox}–{ox+ow}, y={oy2}–{oy2+oh}  (brown)')
print()
print('Safe wall placement:')
print(f'  Left wall       : x=0–550,  y=0–288')
print(f'  Right wall      : x=558–800, y=0–242  (above desk only)')
print(f'  Full width      : x=0–800,  y=0–160   (above desk entirely)')
