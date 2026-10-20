#!/usr/bin/env python3
"""Regenerates every icon from the pixel maps in build/pixel/ (needs Pillow).

- build/pixel/icon-32.txt  the jolly boat (sail, hull, water) on a 28 px grid inside a 32 px lcd glass
- build/pixel/icon-16.txt  a simplified boat for 16 and 24 px
- build/pixel/tray-32.txt  the tray mark (same boat; muted/deafened cuts and the unread dot are drawn here)

Legend: '#' ink, 'g' dim, 'w' spark, '.' glass. Colours are the lcd scheme from the design spec.
Everything is scaled nearest-neighbour; nothing is ever smoothed.
"""
import io
import struct
from pathlib import Path

from PIL import Image

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

    # tray: the fin mark with muted / deafened cuts and the unread dot
    tray = ROOT / 'resources' / 'tray'
    tray.mkdir(parents=True, exist_ok=True)

    def fin():
        return stamp(glass(32, 2, 6, 5), 'tray-32.txt', 2)

    def slash(img, d):
        px = img.load()
        for t in range(6, 27):
            x, y = t, (t if d == 1 else 32 - t)
            for k in (-1, 0, 1):
                if 3 <= x + k <= 28 and 3 <= y <= 28:
                    px[x + k, y] = BG
                if 3 <= x <= 28 and 3 <= y + k <= 28:
                    px[x, y + k] = BG
        return img

    def dot(img):
        px = img.load()
        for y in range(2, 12):
            for x in range(2, 12):
                r2 = (x - 7) ** 2 + (y - 7) ** 2
                if r2 <= 9:
                    px[x, y] = SPARK
                elif r2 <= 16:
                    px[x, y] = FG
        return img

    def sail(img):
        # in voice: the sail fills with ink
        px = img.load()
        for y in range(32):
            for x in range(32):
                if px[x, y] == SPARK:
                    px[x, y] = FG
        return img

    variants = {
        'normal': lambda i: i,
        'voice': sail,
        'muted': lambda i: slash(sail(i), 1),
        'deafened': lambda i: slash(slash(sail(i), 1), -1),
    }
    for name, f in variants.items():
        for suffix, g in (('', lambda i: i), ('-unread', dot)):
            img = g(f(fin()))
            img.save(tray / f'{name}{suffix}.png')
            ico([nearest(img, 16), img, nearest(img, 64)], tray / f'{name}{suffix}.ico')

    overlay = Image.new('RGBA', (16, 16), CLEAR)
    px = overlay.load()
    for y in range(16):
        for x in range(16):
            r2 = (x - 8) ** 2 + (y - 8) ** 2
            if r2 <= 16:
                px[x, y] = SPARK
            elif r2 <= 30:
                px[x, y] = FG
    overlay.save(tray / 'overlay-unread.png')
    print('icons written')


if __name__ == '__main__':
    main()
