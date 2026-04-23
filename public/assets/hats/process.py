import zlib, struct, os

def paeth(a, b, c):
    p = a + b - c
    pa, pb, pc = abs(p-a), abs(p-b), abs(p-c)
    if pa <= pb and pa <= pc: return a
    if pb <= pc: return b
    return c

def read_png(path):
    with open(path, 'rb') as f:
        data = f.read()
    pos = 8
    idat = b''
    ihdr = None
    while pos < len(data):
        length = struct.unpack('>I', data[pos:pos+4])[0]
        ctype  = data[pos+4:pos+8]
        cdata  = data[pos+8:pos+8+length]
        if ctype == b'IHDR': ihdr = cdata
        if ctype == b'IDAT': idat += cdata
        pos += 12 + length

    w, h   = struct.unpack('>II', ihdr[:8])
    bd, ct = ihdr[8], ihdr[9]
    bpp    = 4 if ct == 6 else 3 if ct == 2 else 1
    raw    = zlib.decompress(idat)
    stride = w * bpp

    pixels = []
    prev   = bytes(stride)
    rpos   = 0
    for _ in range(h):
        ft   = raw[rpos]; rpos += 1
        row  = list(raw[rpos:rpos+stride]); rpos += stride
        recon = []
        for i, v in enumerate(row):
            a = recon[i-bpp] if i >= bpp else 0
            b = prev[i]
            c = prev[i-bpp] if i >= bpp else 0
            if   ft == 0: recon.append(v)
            elif ft == 1: recon.append((v + a) % 256)
            elif ft == 2: recon.append((v + b) % 256)
            elif ft == 3: recon.append((v + (a+b)//2) % 256)
            elif ft == 4: recon.append((v + paeth(a,b,c)) % 256)
        prev = bytes(recon)
        if ct == 6:
            pixels.append([(recon[i],recon[i+1],recon[i+2],recon[i+3]) for i in range(0,stride,4)])
        elif ct == 2:
            pixels.append([(recon[i],recon[i+1],recon[i+2],255) for i in range(0,stride,3)])
        else:
            pixels.append([(v,v,v,255) for v in recon])
    return pixels, w, h

def save_png(path, pixels, w, h):
    def chunk(t, d):
        c = t+d
        return struct.pack('>I',len(d))+c+struct.pack('>I',zlib.crc32(c)&0xffffffff)
    sig  = b'\x89PNG\r\n\x1a\n'
    ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
    raw  = b''.join(b'\x00'+bytes([v for px in row for v in px]) for row in pixels)
    idat = chunk(b'IDAT', zlib.compress(raw, 9))
    iend = chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(sig+ihdr+idat+iend)

def remove_black_bg(pixels, threshold=20):
    out = []
    for row in pixels:
        new_row = []
        for (r,g,b,a) in row:
            if r <= threshold and g <= threshold and b <= threshold:
                # black/near-black background → transparent
                new_row.append((r,g,b,0))
            else:
                # keep art pixels as-is (white fill stays white)
                new_row.append((r,g,b,a))
        out.append(new_row)
    return out

def crop_to_content(pixels, h, w, padding=2):
    min_x, min_y, max_x, max_y = w, h, 0, 0
    for y, row in enumerate(pixels):
        for x, (_,_,_,a) in enumerate(row):
            if a > 10:
                if x < min_x: min_x = x
                if x > max_x: max_x = x
                if y < min_y: min_y = y
                if y > max_y: max_y = y
    min_x = max(0, min_x - padding)
    min_y = max(0, min_y - padding)
    max_x = min(w-1, max_x + padding)
    max_y = min(h-1, max_y + padding)
    cropped = [row[min_x:max_x+1] for row in pixels[min_y:max_y+1]]
    nw = max_x - min_x + 1
    nh = max_y - min_y + 1
    print(f'  Cropped to {nw}x{nh} (from {min_x},{min_y} to {max_x},{max_y})')
    return cropped, nw, nh

base = os.path.dirname(os.path.abspath(__file__))

for src, dst in [
    ('Halo_orig.png',        'halo.png'),
    ('headphones_orig.png',  'headphones.png'),
]:
    pixels, w, h = read_png(os.path.join(base, src))
    pixels = remove_black_bg(pixels)
    pixels, w, h = crop_to_content(pixels, h, w)
    save_png(os.path.join(base, dst), pixels, w, h)
    print(f'Saved {dst} ({w}x{h})')
