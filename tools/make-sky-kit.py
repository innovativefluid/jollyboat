#!/usr/bin/env python3
"""The Pixel Sky theme's ui kit as css: every part (panel, pill, chip, well, check) is a little
pixel-art picture drawn on the design's grid (rounded insets from the circle formula, a 1 px
line, a 1 px top light, a 4 x 4 bayer-dithered drop shadow) and put on an element as a 9-slice
border-image, so corners stay stepped and shadows stay dithered at any size. One css pixel of
the design is --dot (2 px) on screen.

Writes the variables, night and day, between the `kit:start` and `kit:end` markers of
resources/themes/pixelsky.css (the Sharkord page) and src/renderer/theme/sky.css (the app's own
windows), each under its own selectors; the sunset palette's (sunset and dusk) into
resources/themes/pixelsky-sunset.css and, under [data-palette='sunset'], into sky.css.

  python3 tools/make-sky-kit.py
"""
import math
import re
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOT = 2  # css px per design pixel
BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]

SCHEMES = {
    'night': dict(panel='#141a4a', panelHi='#232b6c', edge='#5d66c6', ink='#f4f1ff', dim='#a9b0ea', mute='#7078bf', onFill='#141a4a',
                  focus='#ffd35c', well='#0c1036', track='#2b3380', shade='#03041a'),
    'day': dict(panel='#fbfdff', panelHi='#ffffff', edge='#5b74b8', ink='#1b2552', dim='#46568f', mute='#8796c8', onFill='#fbfdff',
                focus='#ff9a2e', well='#e7effc', track='#c4d4f0', shade='#24508f'),
    # the sunset palette: plum ink on warm cream under a rose and gold sky (light), and dusk:
    # peach ink on deep plum panels under an indigo to coral sky (dark)
    'sunset': dict(panel='#fff6ee', panelHi='#ffffff', edge='#c0607e', ink='#4a1838', dim='#7e3d63', mute='#b98aa3', onFill='#fff6ee',
                   focus='#ff7a1a', well='#fde8e0', track='#f4c6c6', shade='#8a2f5a'),
    'dusk': dict(panel='#24103a', panelHi='#3a1a52', edge='#b0507a', ink='#ffe9dc', dim='#e0a8bc', mute='#a06a92', onFill='#24103a',
                 focus='#ffb04a', well='#180a2a', track='#4a2258', shade='#0a0414'),
}


def insets(r):
    return [max(0, math.floor(r - math.sqrt(r * r - (r - i - 0.5) ** 2) + 0.3)) for i in range(r)]


def part(r, fill, line, hi=None, shade=None, lv=9, sh=(2, 3), mid=4):
    """a rounded box (2r + mid square) with its line, top light and dithered shadow; returns the
    border-image value: picture, slices, widths, outset, repeat"""
    W = H = 2 * r + mid
    sx, sy = sh if shade else (0, 0)
    ins = insets(r)

    def inside(x, y):
        if x < 0 or y < 0 or x >= W or y >= H:
            return False
        k = ins[y] if y < r else ins[H - 1 - y] if y >= H - r else 0
        return k <= x < W - k

    px = {}
    for y in range(H + sy):
        for x in range(W + sx):
            if inside(x, y):
                on_line = line and not (inside(x - 1, y) and inside(x + 1, y) and inside(x, y - 1) and inside(x, y + 1))
                px[(x, y)] = line if on_line else fill
            elif shade and inside(x - sx, y - sy) and BAYER[(y & 3) * 4 + (x & 3)] < lv:
                px[(x, y)] = shade
    if hi:
        for x in range(r, W - r):
            if px.get((x, 1)) == fill:
                px[(x, 1)] = hi
    # one path per colour keeps the picture small
    paths = {}
    for (x, y), c in sorted(px.items()):
        paths.setdefault(c, []).append(f'M{x} {y}h1v1h-1z')
    body = ''.join(f"<path fill='{c}' d='{''.join(d)}'/>" for c, d in paths.items())
    svg = f"<svg xmlns='http://www.w3.org/2000/svg' width='{W + sx}' height='{H + sy}' shape-rendering='crispEdges'>{body}</svg>"
    url = 'data:image/svg+xml,' + urllib.parse.quote(svg, safe="=:/' ")
    t, rr, b, l = r, r + sx, r + sy, r
    return f'url("{url}") {t} {rr} {b} {l} fill / {t * DOT}px {rr * DOT}px {b * DOT}px {l * DOT}px / 0 {sx * DOT}px {sy * DOT}px 0 repeat'


TICK = [(1, 4), (2, 5), (3, 6), (4, 5), (5, 4), (6, 3), (7, 2)]


def svg_url(pixels, w, h):
    paths = {}
    for (x, y), c in sorted(pixels.items()):
        paths.setdefault(c, []).append(f'M{x} {y}h1v1h-1z')
    body = ''.join(f"<path fill='{c}' d='{''.join(d)}'/>" for c, d in paths.items())
    svg = f"<svg xmlns='http://www.w3.org/2000/svg' width='{w}' height='{h}' shape-rendering='crispEdges'>{body}</svg>"
    return 'url("data:image/svg+xml,' + urllib.parse.quote(svg, safe="=:/' ") + '")'


def check_box(fill, line):
    """the 9-dot check box, radius 2, as a plain picture"""
    ins = insets(2)
    px = {}
    for y in range(9):
        k = ins[y] if y < 2 else ins[8 - y] if y > 6 else 0
        for x in range(k, 9 - k):
            px[(x, y)] = fill
    return svg_url(px, 9, 9)


def mask(r):
    """a rounded square with stepped corners, for -webkit-mask-box-image (avatars)"""
    v = part(r, '#000', '#000')
    url = v[: v.index('") ') + 2]
    return f'{url} {r} / {r * DOT}px stretch'


def kit(s):
    # (each picture's top and bottom slices must fit the smallest thing that wears it, or the
    # browser scales the slices and the lines break up: pills are at least 28 px tall, bar
    # chips 26, unread counts 20)
    return {
        'k-mask': mask(4),
        # a panel: radius 6, 1 px edge, 1 px top light, dithered shade +2/+3 at level 9
        'k-panel': part(6, s['panel'], s['edge'], s['panelHi'], s['shade'], 9, (2, 3)),
        # floating: a menu, a popover, a dialog (the same panel, the shade a little deeper)
        'k-float': part(6, s['panel'], s['edge'], s['panelHi'], s['shade'], 12, (2, 3)),
        # pill buttons: outline (panel + ink line), hovered (panelHi), filled (ink)
        'k-pill': part(6, s['panel'], s['ink'], None, s['shade'], 8, (1, 2)),
        'k-pill-hi': part(6, s['panelHi'], s['ink'], None, s['shade'], 8, (1, 2)),
        'k-pill-fill': part(6, s['ink'], s['ink'], None, s['shade'], 8, (1, 2)),
        # a quiet pill (a segment that is not chosen): its line in edge
        'k-seg': part(6, s['panel'], s['edge'], None, s['shade'], 8, (1, 2)),
        # chips: the edge line, a light shade
        'k-chip': part(5, s['panel'], s['edge'], None, s['shade'], 6, (1, 2)),
        'k-chip-hi': part(5, s['panelHi'], s['ink'], None, s['shade'], 6, (1, 2)),
        'k-chip-fill': part(5, s['ink'], s['ink'], None, s['shade'], 6, (1, 2)),
        # wells: recessed boxes (fields, the message box), no shade; focused, the line in focus
        'k-well': part(4, s['well'], s['edge']),
        'k-well-focus': part(4, s['well'], s['focus']),
        # a selected row: filled, no shade
        'k-row': part(4, s['ink'], s['ink']),
        'k-row-hi': part(4, s['panelHi'], s['panelHi']),
        # checks: radius 2
        'k-check': part(2, s['well'], s['ink']),
        'k-check-on': part(2, s['ink'], s['ink']),
        # a ticked box as two plain pictures (the tick on top draws itself in): box and tick
        'k-box-on': check_box(s['ink'], s['ink']),
        'k-tick': svg_url({p: s['onFill'] for p in TICK}, 9, 9),
    }


def block(selectors, s):
    vals = kit(s)
    lines = [f'{selectors} {{']
    for k, v in vals.items():
        lines.append(f'  --{k}: {v};')
    lines.append('}')
    return '\n'.join(lines)


def put(path, text):
    p = ROOT / path
    src = p.read_text()
    new = re.sub(r'(/\* kit:start[^*]*\*/\n).*?(/\* kit:end \*/)', lambda m: m.group(1) + text + '\n' + m.group(2), src, flags=re.S)
    if new == src and text not in src:
        raise SystemExit(f'{path}: no kit:start / kit:end markers')
    p.write_text(new)
    print(path, len(text), 'chars')


if __name__ == '__main__':
    page = '\n'.join([
        block('html:root, html .light', SCHEMES['day']),
        block('html.dark, html .dark', SCHEMES['night']),
    ])
    sunset_page = '\n'.join([
        block('html:root, html .light', SCHEMES['sunset']),
        block('html.dark, html .dark', SCHEMES['dusk']),
    ])
    sun = ":root[data-look='sky'][data-palette='sunset']"
    app = '\n'.join([
        block(":root[data-look='sky']", SCHEMES['day']),
        block(":root[data-look='sky'][data-theme='dark']", SCHEMES['night']),
        '@media (prefers-color-scheme: dark) {',
        block(":root[data-look='sky']:not([data-theme])", SCHEMES['night']),
        '}',
        block(sun, SCHEMES['sunset']),
        block(f"{sun}[data-theme='dark']", SCHEMES['dusk']),
        '@media (prefers-color-scheme: dark) {',
        block(f"{sun}:not([data-theme])", SCHEMES['dusk']),
        '}',
    ])
    put('resources/themes/pixelsky.css', page)
    put('resources/themes/pixelsky-sunset.css', sunset_page)
    put('src/renderer/theme/sky.css', app)
