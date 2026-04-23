"""
Generate sprite reference PNGs for Aseprite hat/accessory drawing.
Use as an overlay layer so you can see exactly where the head sits.

hub_reference.png  — hub + alley scenes  (20x40 content, centered in 64x64)
room_reference.png — room scene          (24x60 content, centered in 64x64)

All coordinates match the renderer 1:1.
"""
import zlib, struct, os

def save_png(path, pixels, w, h):
    def chunk(t, d):
        c = t + d
        return struct.pack('>I', len(d)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    sig  = b'\x89PNG\r\n\x1a\n'
    ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
    raw  = b''.join(b'\x00' + bytes([v for px in row for v in px]) for row in pixels)
    idat = chunk(b'IDAT', zlib.compress(raw, 9))
    iend = chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(sig + ihdr + idat + iend)

W, H = 64, 64

def make_pixels():
    return [[(0, 0, 0, 0)] * W for _ in range(H)]

def fill(pixels, px, py, w, h, color):
    for y in range(py, py + h):
        for x in range(px, px + w):
            if 0 <= x < W and 0 <= y < H:
                pixels[y][x] = color

SKIN = (180, 160, 160, 255)
BODY = (120, 120, 135, 255)
FOOT = ( 80,  80,  95, 255)
EYE  = (255, 255, 255, 180)

base = os.path.dirname(os.path.abspath(__file__))

# ══════════════════════════════════════════════════════════════════════════
# HUB / ALLEY  —  renderHubSprite: 20x40 canvas, s=2, cx=10, headY=4
# Content centered in 64x64: ox=(64-20)//2=22, oy=(64-40)//2=12
# ══════════════════════════════════════════════════════════════════════════
p = make_pixels()
ox = (64 - 20) // 2   # 22
oy = (64 - 40) // 2   # 12
s  = 2
cx = 10
headY = 4

# Head  — fillRect(7,6,6,2)  fillRect(6,8,8,6)
fill(p, ox+7,  oy+headY+s,   3*s, s,   SKIN)   # top narrow row
fill(p, ox+6,  oy+headY+2*s, 4*s, 3*s, SKIN)   # wide middle
fill(p, ox+7,  oy+headY+5*s, 3*s, s,   SKIN)   # chin/neck connector

# Body (top area) — fillRect(5,16,10,14)  tw=2.5*s=5 → x=cx-tw=5..cx+tw=15
fill(p, ox+5,  oy+headY+6*s,  10, 7*s, BODY)   # torso + arms

# Legs — fillRect(6,28,3,14) and fillRect(11,28,3,14)
fill(p, ox+6,  oy+headY+12*s, 3,  7*s, BODY)   # left leg
fill(p, ox+11, oy+headY+12*s, 3,  7*s, BODY)   # right leg

# Eyes — ey=headY+3*s=10; fillRect(7,10,2,2) and fillRect(11,10,2,2)
fill(p, ox+7,  oy+headY+3*s, 2, 2, EYE)
fill(p, ox+11, oy+headY+3*s, 2, 2, EYE)

out = os.path.join(base, 'hub_reference.png')
save_png(out, p, W, H)
print(f'Saved: {out}')
print(f'  Content area : x={ox}–{ox+19}, y={oy}–{oy+39}')
print(f'  Head top     : y={oy+headY+s}  (headY={headY}, s={s})')
print(f'  Eye level    : y={oy+headY+3*s}')
print(f'  Shoulder     : y={oy+headY+6*s}')
print(f'  Waist        : y={oy+headY+12*s}')
print(f'  Feet bottom  : y={oy+headY+19*s}')

# ══════════════════════════════════════════════════════════════════════════
# ROOM  —  renderRoomSprite: 24x60 canvas, oY=10
# Content centered in 64x64: ox=(64-24)//2=20, oy=(64-60)//2=2
# ══════════════════════════════════════════════════════════════════════════
p = make_pixels()
ox = (64 - 24) // 2   # 20
oy = (64 - 60) // 2   # 2
oY = 10                # head top, same as renderer

# Head — fillRect(7,oY,10,4)  fillRect(5,oY+2,14,8)  fillRect(7,oY+10,10,2)
fill(p, ox+7,  oy+oY+0,  10, 4, SKIN)
fill(p, ox+5,  oy+oY+2,  14, 8, SKIN)
fill(p, ox+7,  oy+oY+10, 10, 2, SKIN)

# Neck — fillRect(9,oY+12,6,2)
fill(p, ox+9,  oy+oY+12, 6, 2, SKIN)

# Arms — fillRect(4,oY+14,2,14) and fillRect(18,oY+14,2,14)
fill(p, ox+4,  oy+oY+14, 2, 14, BODY)
fill(p, ox+18, oy+oY+14, 2, 14, BODY)

# Torso — fillRect(6,oY+14,12,14)
fill(p, ox+6,  oy+oY+14, 12, 14, BODY)

# Legs — fillRect(7,oY+28,4,16) and fillRect(13,oY+28,4,16)
fill(p, ox+7,  oy+oY+28, 4, 16, BODY)
fill(p, ox+13, oy+oY+28, 4, 16, BODY)

# Feet — fillRect(5,oY+44,6,3) and fillRect(13,oY+44,6,3)
fill(p, ox+5,  oy+oY+44, 6, 3, FOOT)
fill(p, ox+13, oy+oY+44, 6, 3, FOOT)

# Eyes — fillRect(7,oY+5,2,2) and fillRect(14,oY+5,2,2)
fill(p, ox+7,  oy+oY+5, 2, 2, EYE)
fill(p, ox+14, oy+oY+5, 2, 2, EYE)

out = os.path.join(base, 'room_reference.png')
save_png(out, p, W, H)
print(f'Saved: {out}')
print(f'  Content area : x={ox}–{ox+23}, y={oy}–{oy+59}')
print(f'  Head top     : y={oy+oY}   (oY={oY})')
print(f'  Eye level    : y={oy+oY+5}')
print(f'  Shoulder     : y={oy+oY+14}')
print(f'  Waist        : y={oy+oY+28}')
print(f'  Feet         : y={oy+oY+44}')
