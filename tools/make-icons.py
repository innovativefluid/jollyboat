#!/usr/bin/env python3
"""Regenerates every icon from the pixel maps in build/pixel/ (needs Pillow).

- build/pixel/icon-32.txt  the jolly boat (sail, hull, water) on a 28 px grid inside a 32 px lcd glass
- build/pixel/icon-16.txt  a simplified boat for 16 and 24 px
- build/pixel/tray-32.txt  the tray mark (same boat; muted/deafened cuts and the unread dot are drawn here)

Legend: '#' ink, 'g' dim, 'w' spark, '.' glass. Colours are the lcd scheme from the design spec.
The app icon and the pixel tray sets are scaled nearest-neighbour; nothing is ever smoothed.

The tray has one set per theme, each from the theme's dark scheme (resources/tray/<set>/):
- lcd       the Jollyboat theme: the pixel boat in the lcd's dark colours
- sharkord  Sharkord itself (and custom css): the same pixel boat in Sharkord's dark greys, its
            green for talking and its red for a muted mic
- water     the Water theme: a smooth glass tile of deep water with a glass boat on two waves,
            drawn at 8x and scaled down for every size (not pixel art)
States: normal, voice (in a call: the sail hollow), talking (the sail lit / full of water),
muted (a bar across), deafened (a cross), each also -unread (a dot / bubble top left), and
overlay-unread (the windows taskbar overlay).
"""
import io
import struct
from pathlib import Path

import math

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
BG = (0xA6, 0xB0, 0x8A, 255)
FG = (0x1A, 0x22, 0x1C, 255)
DIM = (0x46, 0x50, 0x3E, 255)
SPARK = (0xEC, 0xF4, 0xD4, 255)
CLEAR = (0, 0, 0, 0)
INK = {'#': FG, 'g': DIM, 'w': SPARK}


def rrect(px, x0, y0, x1, y1, r, c):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            dx = max(x0 + r - x, 0, x - (x1 - r))
            dy = max(y0 + r - y, 0, y - (y1 - r))
            if dx * dx + dy * dy <= r * r + r:
                px[x, y] = c


def glass(size, border, radius, inner):
    img = Image.new('RGBA', (size, size), CLEAR)
    px = img.load()
    rrect(px, 0, 0, size - 1, size - 1, radius, FG)
    rrect(px, border, border, size - 1 - border, size - 1 - border, inner, BG)
    return img


def stamp(img, mapfile, off):
    px = img.load()
    rows = [r for r in (ROOT / 'build' / 'pixel' / mapfile).read_text().split('\n') if r]
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch in INK:
                px[off + x, off + y] = INK[ch]
    return img


def nearest(img, size):
    return img.resize((size, size), Image.NEAREST)


def ico(frames, path):
    data = b''
    entries = b''
    offset = 6 + 16 * len(frames)
    for im in frames:
        buf = io.BytesIO()
        im.save(buf, 'PNG')
        png = buf.getvalue()
        w, h = im.size
        entries += struct.pack('<BBBBHHII', w % 256, h % 256, 0, 0, 1, 32, len(png), offset)
        data += png
        offset += len(png)
    path.write_bytes(struct.pack('<HHH', 0, 1, len(frames)) + entries + data)


# ---- tray: the pixel sets -------------------------------------------------------------------------

def hexc(h, a=255):
    return (int(h[1:3], 16), int(h[3:5], 16), int(h[5:7], 16), a)


# frame + boat outline (ink), the glass inside (bg), the hull (hull), the sail at rest / in a call
# while talking (sail / talk), the bar of a muted mic (cut), the unread dot and the ring that
# separates it (dot / ring)
PIXEL_SETS = {
    # the lcd's dark scheme (theme.css [data-theme=dark]): the sail at rest in the dim ink, lit
    # in the spark colour while you talk
    'lcd': dict(bg=hexc('#18201c'), ink=hexc('#c4d6a6'), hull=hexc('#5e6c52'), sail=hexc('#94a47e'), talk=hexc('#ecf8ce'),
                cut=hexc('#ecf8ce'), dot=hexc('#ecf8ce'), ring=hexc('#18201c')),
    # sharkord's dark theme (neutral greys: card #171717, foreground #fafafa, muted #a1a1a1), the
    # green of its speaking glow and the red of its muted mic
    'sharkord': dict(bg=hexc('#171717'), ink=hexc('#e5e5e5'), hull=hexc('#525252'), sail=hexc('#fafafa'), talk=hexc('#86efac'),
                     cut=hexc('#ef4444'), dot=hexc('#fafafa'), ring=hexc('#0a0a0a')),
}


def tray_pixel(out, c):
    out.mkdir(parents=True, exist_ok=True)

    def fin():
        img = Image.new('RGBA', (32, 32), CLEAR)
        px = img.load()
        rrect(px, 0, 0, 31, 31, 6, c['ink'])
        rrect(px, 1, 1, 30, 30, 5, c['bg'])
        ink = {'#': c['ink'], 'g': c['hull'], 'w': c['sail']}
        rows = [r for r in (ROOT / 'build' / 'pixel' / 'tray-32.txt').read_text().split('\n') if r]
        for y, row in enumerate(rows):
            for x, ch in enumerate(row):
                if ch in ink:
                    px[x, y] = ink[ch]
        return img

    def slash(img, d):
        # a bold bar corner to corner with a glass-coloured outline, so it reads over anything
        px = img.load()
        for width, colour in ((3, c['bg']), (1, c['cut'])):
            for t in range(4, 28):
                x, y = t, (t if d == 1 else 31 - t)
                for k in range(-width, width + 1):
                    for (xx, yy) in ((x + k, y), (x, y + k)):
                        if 2 <= xx <= 29 and 2 <= yy <= 29:
                            px[xx, yy] = colour
        return img

    def dot(img):
        # unread: a bright dot with a ring of the dark in the empty top-left corner
        px = img.load()
        for y in range(1, 14):
            for x in range(1, 14):
                r2 = (x - 7) ** 2 + (y - 7) ** 2
                if r2 <= 13:
                    px[x, y] = c['dot']
                elif r2 <= 25:
                    px[x, y] = c['ring']
        return img

    def sail(img, colour):
        px = img.load()
        for y in range(32):
            for x in range(32):
                if px[x, y] == c['sail']:
                    px[x, y] = colour
        return img

    variants = {
        'normal': lambda i: i,
        'voice': lambda i: sail(i, c['bg']),
        'talking': lambda i: sail(i, c['talk']),
        'muted': lambda i: slash(sail(i, c['bg']), 1),
        'deafened': lambda i: slash(slash(sail(i, c['bg']), 1), -1),
    }
    for name, f in variants.items():
        for suffix, g in (('', lambda i: i), ('-unread', dot)):
            img = g(f(fin()))
            img.save(out / f'{name}{suffix}.png')
            ico([nearest(img, 16), img, nearest(img, 64)], out / f'{name}{suffix}.ico')

    overlay = Image.new('RGBA', (16, 16), CLEAR)
    px = overlay.load()
    for y in range(16):
        for x in range(16):
            r2 = (x - 8) ** 2 + (y - 8) ** 2
            if r2 <= 16:
                px[x, y] = c['dot']
            elif r2 <= 30:
                px[x, y] = c['ring']
    overlay.save(out / 'overlay-unread.png')


# ---- tray: the water set --------------------------------------------------------------------------
# drawn in a 32-unit square (the pixel map's grid), at 8x the target size, then scaled down with
# lanczos. at 16 px the thin parts (mast, outlines) keep at least one pixel.

W_DEEP_TOP = hexc('#14497d')
W_DEEP_BOT = hexc('#031428')
W_EDGE = hexc('#8fd8ff')
W_LIQ_A = hexc('#4fcfff')
W_LIQ_B = hexc('#0a48a6')
W_SPARK = hexc('#e8fbff')
W_GLOW = hexc('#3fd4ff')
W_WARM = hexc('#ff6b7d')
W_DARK = hexc('#020c1a')

HULL = [(2.2, 17.0), (26.6, 17.0), (26.2, 19.8), (24.4, 22.6), (7.4, 22.6)]
SAIL = [(15.2, 2.8), (24.2, 12.6), (23.4, 14.4), (15.2, 14.6)]


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(4))


def vgradient(size, top, bottom, y0=0.0, y1=1.0):
    g = Image.new('RGBA', (1, 256))
    for y in range(256):
        t = min(1.0, max(0.0, (y / 255 - y0) / max(1e-6, y1 - y0)))
        g.putpixel((0, y), lerp(top, bottom, t))
    return g.resize(size, Image.BILINEAR)


def shape_mask(size, draw_fn):
    m = Image.new('L', size, 0)
    draw_fn(ImageDraw.Draw(m))
    return m


def water_icon(n, state, unread):
    ss = 8
    S = n * ss
    u = S / 32.0  # px per unit at the supersampled size
    thin = max(1.0, 32.0 / n * 0.5)  # outlines: never under a pixel at the target size

    def P(pts, dx=0.0, dy=0.0):
        return [((x + dx) * u, (y + dy) * u) for (x, y) in pts]

    def W(units, min_px=1.0):
        return max(units * u, min_px * ss)

    img = Image.new('RGBA', (S, S), CLEAR)

    # the tile: deep water under glass, a rim of light, a gloss cap
    tile = shape_mask((S, S), lambda d: d.rounded_rectangle([0.4 * u, 0.4 * u, S - 0.4 * u, S - 0.4 * u], radius=7 * u, fill=255))
    img.paste(vgradient((S, S), W_DEEP_TOP, W_DEEP_BOT), (0, 0), tile)
    cap = Image.new('RGBA', (S, S), CLEAR)
    capg = vgradient((S, S), (255, 255, 255, 70), (255, 255, 255, 0), 0.0, 0.42)
    capm = shape_mask((S, S), lambda d: d.rounded_rectangle([1.4 * u, 1.2 * u, S - 1.4 * u, 15 * u], radius=6 * u, fill=255))
    cap.paste(capg, (0, 0), capm)
    img = Image.alpha_composite(img, cap)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0.4 * u, 0.4 * u, S - 0.4 * u, S - 0.4 * u], radius=7 * u, outline=W_EDGE[:3] + (190,), width=int(W(1.0)))

    # two waves of water along the bottom
    for k, (y, a) in enumerate(((26.2, 255), (29.0, 170))):
        pts = []
        for i in range(0, 65):
            x = 1.5 + i * 29.0 / 64
            pts.append((x * u, (y + 0.9 * math.sin(x * 0.55 + k * 1.7)) * u))
        d.line(pts, fill=W_LIQ_A[:3] + (a,), width=int(W(1.5 - 0.3 * k)), joint='curve')

    # the hull: glass holding water, a bright edge
    hull = shape_mask((S, S), lambda m: m.polygon(P(HULL, 0, 0.6), fill=255))
    img.paste(vgradient((S, S), W_LIQ_A, W_LIQ_B, 17.6 / 32, 23.2 / 32), (0, 0), hull)
    d = ImageDraw.Draw(img)
    d.polygon(P(HULL, 0, 0.6), outline=W_SPARK, width=int(W(0.9)))

    # the mast
    d.line([(14.6 * u, 2.6 * u), (14.6 * u, 17.6 * u)], fill=W_SPARK, width=int(W(1.1)))

    # the sail: white glass at rest, empty glass in a call, full of bright water while you talk
    sail_pts = P(SAIL, 0.6, 0)
    if state == 'talking':
        sm = shape_mask((S, S), lambda m: m.polygon(sail_pts, fill=255))
        img.paste(vgradient((S, S), hexc('#b8f2ff'), hexc('#16a4ec'), 3 / 32, 14.6 / 32), (0, 0), sm)
        d = ImageDraw.Draw(img)
        d.polygon(sail_pts, outline=W_SPARK, width=int(W(0.9)))
    elif state == 'normal':
        d.polygon(sail_pts, fill=W_SPARK, outline=W_SPARK)
    else:
        d.polygon(sail_pts, outline=W_SPARK, width=int(W(1.3, 1.0)))

    # muted: a warm bar across; deafened: two
    def bar(a, b):
        for w, col in ((W(4.6, 3.0), W_DARK), (W(2.4, 1.6), W_WARM)):
            d.line([(a[0] * u, a[1] * u), (b[0] * u, b[1] * u)], fill=col, width=int(w))
            for (x, y) in (a, b):
                r = w / 2
                d.ellipse([x * u - r, y * u - r, x * u + r, y * u + r], fill=col)
    if state in ('muted', 'deafened'):
        bar((5.0, 5.0), (27.0, 27.0))
    if state == 'deafened':
        bar((5.0, 27.0), (27.0, 5.0))

    # unread: an air bubble in the top-left corner, lit, with a dark ring around it
    if unread:
        cx, cy = 7.0 * u, 7.0 * u
        for r, col in ((6.4, W_DARK), (5.3, W_GLOW), (4.2, W_SPARK)):
            d.ellipse([cx - r * u, cy - r * u, cx + r * u, cy + r * u], fill=col)
        hr = 1.3 * u
        d.ellipse([cx - 2.0 * u - hr, cy - 2.0 * u - hr, cx - 2.0 * u + hr, cy - 2.0 * u + hr], fill=(255, 255, 255, 255))

    return img.resize((n, n), Image.LANCZOS)


def tray_water(out):
    out.mkdir(parents=True, exist_ok=True)
    for name in ('normal', 'voice', 'talking', 'muted', 'deafened'):
        for suffix, unread in (('', False), ('-unread', True)):
            big = water_icon(32, name, unread)
            big.save(out / f'{name}{suffix}.png')
            ico([water_icon(16, name, unread), water_icon(24, name, unread), big, water_icon(64, name, unread)], out / f'{name}{suffix}.ico')
    # the taskbar overlay: the bubble alone
    ss = 8
    S = 16 * ss
    o = Image.new('RGBA', (S, S), CLEAR)
    d = ImageDraw.Draw(o)
    for r, col in ((7.6, W_DARK), (6.2, W_GLOW), (4.8, W_SPARK)):
        d.ellipse([S / 2 - r * ss, S / 2 - r * ss, S / 2 + r * ss, S / 2 + r * ss], fill=col)
    d.ellipse([S / 2 - 3.6 * ss, S / 2 - 3.6 * ss, S / 2 - 1.2 * ss, S / 2 - 1.2 * ss], fill=(255, 255, 255, 255))
    o.resize((16, 16), Image.LANCZOS).save(out / 'overlay-unread.png')


def main():
    big = stamp(glass(32, 2, 6, 5), 'icon-32.txt', 2)
    small = stamp(glass(16, 1, 3, 2), 'icon-16.txt', 1)

    icons = ROOT / 'build' / 'icons'
    icons.mkdir(parents=True, exist_ok=True)
    for s in (16, 24, 32, 48, 64, 96, 128, 256, 512):
        nearest(small if s < 32 else big, s).save(icons / f'{s}x{s}.png')
    nearest(big, 512).save(ROOT / 'build' / 'icon.png')
    nearest(big, 512).save(ROOT / 'resources' / 'icon.png')
    ico([small, nearest(small, 24), big] + [nearest(big, s) for s in (48, 64, 128, 256)], ROOT / 'build' / 'icon.ico')

    tray = ROOT / 'resources' / 'tray'
    for old in tray.glob('*.*'):
        old.unlink()
    for name, colours in PIXEL_SETS.items():
        tray_pixel(tray / name, colours)
    tray_water(tray / 'water')
    print('icons written')


if __name__ == '__main__':
    main()
