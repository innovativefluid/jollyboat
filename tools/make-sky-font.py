#!/usr/bin/env python3
"""The Pixel Sky theme's type: the design study's 5 x 7 bitmap face (tools/sky-glyphs.json, rows
0-6 caps, 7-8 descenders) as three fonts in src/renderer/fonts:

  JollyboatSky.ttf         the face
  JollyboatSkyBold.ttf     bold: each glyph smeared one pixel right, except where that would
                           close a one-pixel counter (m, w stay open)
  JollyboatSkyDisplay.ttf  display: the face through scale2x, which rounds diagonals instead of
                           making blocks (titles and big numbers)

One pixel is 125 units of a 1000 em, so a font-size of 8 px draws each pixel 1 px, 16 px 2 px.
Letters the study does not have (German, Polish, a few more) are built here from it.

  python3 tools/make-sky-font.py      (needs fontTools)
"""
import json
from pathlib import Path
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

ROOT = Path(__file__).resolve().parent.parent
TABLE = json.loads((ROOT / 'tools/sky-glyphs.json').read_text())

# ---- glyphs the study does not have: rows as in the study ('/' between rows, '.' off, '#' on)
EXTRA = {
    '$': '..#../.####/#.#../.###./..#.#/####./..#..',
    '{': '..#/.#./.#./#../.#./.#./..#',
    '}': '#../.#./.#./..#/.#./.#./#..',
    '\\': '#..../.#.../.#.../..#../...#./...#./....#',
    '`': '#./.#',
    '–': '///####',
    '—': '///#######',
    '‘': '.#/#./##', '’': '##/.#/#.', '‚': '//////##/.#/#.',
    '“': '.#.#/#.#./##.##', '”': '##.##/.#.#/#.#.', '„': '//////##.##/.#..#/#..#.',
    '€': '..###/.#.../####./.#.../####./.#.../..###',
    '£': '..##./.#..#/.#.../###../.#.../.#.../#####',
    'ß': '.##./#..#/#..#/#.#./#..#/#..#/#.#.',
    '¡': '#//#/#/#/#/#', '¿': '..#..//..#../.#.../#..../#...#/.###.',
    '§': '.###/#.../.##./#..#/.##./...#/###.',
    '©': '.###./#...#/#.###/#.#.#/#.###/#...#/.###.',
    '±': '/.#./.#./###/.#./.#./###',
    '÷': '/.#.//###//.#.',
    '•': '//.##/####/####/.##.',
    '→': '//...#./#####/...#.', '←': '//.#.../#####/.#...',
    '♥': '/.#.#./#####/#####/.###./..#..',
    ' ': '...',
}
# accents: rows above (negative) or below a base glyph, columns from the glyph's left
LOWER_MARKS = {'diaeresis': [(-0 + 1, 0), (3, 0)], 'acute': [(3, -0), (2, 1)], 'grave': [(1, 0), (2, 1)],
               'dot': [(2, 0)], 'tilde': [(0, 1), (1, 0), (2, 1), (3, 0)], 'circumflex': [(1, 1), (2, 0), (3, 1)],
               'ring': [(2, 0)]}
UPPER_MARKS = {'diaeresis': [(1, -2), (3, -2)], 'acute': [(3, -3), (2, -2)], 'grave': [(1, -3), (2, -2)],
               'dot': [(2, -2)], 'tilde': [(0, -2), (1, -3), (2, -2), (3, -3)], 'circumflex': [(1, -2), (2, -3), (3, -2)],
               'ring': [(2, -2)]}
COMPOSED = {
    'ä': ('a', 'diaeresis'), 'ö': ('o', 'diaeresis'), 'ü': ('u', 'diaeresis'), 'ë': ('e', 'diaeresis'), 'ï': ('ı', 'diaeresis'),
    'Ä': ('A', 'diaeresis'), 'Ö': ('O', 'diaeresis'), 'Ü': ('U', 'diaeresis'),
    'á': ('a', 'acute'), 'é': ('e', 'acute'), 'ó': ('o', 'acute'), 'ú': ('u', 'acute'), 'ć': ('c', 'acute'), 'ń': ('n', 'acute'),
    'ś': ('s', 'acute'), 'ź': ('z', 'acute'), 'í': ('ı', 'acute'),
    'Á': ('A', 'acute'), 'É': ('E', 'acute'), 'Ó': ('O', 'acute'), 'Ú': ('U', 'acute'), 'Ć': ('C', 'acute'), 'Ń': ('N', 'acute'),
    'Ś': ('S', 'acute'), 'Ź': ('Z', 'acute'),
    'à': ('a', 'grave'), 'è': ('e', 'grave'), 'ò': ('o', 'grave'), 'ù': ('u', 'grave'),
    'â': ('a', 'circumflex'), 'ê': ('e', 'circumflex'), 'ô': ('o', 'circumflex'), 'û': ('u', 'circumflex'),
    'ñ': ('n', 'tilde'), 'ã': ('a', 'tilde'), 'õ': ('o', 'tilde'), 'Ñ': ('N', 'tilde'),
    'ż': ('z', 'dot'), 'Ż': ('Z', 'dot'), 'å': ('a', 'ring'), 'Å': ('A', 'ring'),
}
# a dotless i, for i with accents
TABLE_EXTRA_BASE = {'ı': '//#/#/#/#/#'}
OGONEK = {'ą': 'a', 'ę': 'e', 'Ą': 'A', 'Ę': 'E'}
CEDILLA = {'ç': 'c', 'Ç': 'C'}
STROKE = {'ł': '.#./.#./.##/##./.#./.#./..#', 'Ł': '.#.../.#.../.#.##/.##../##.../.#.../.####'}


def parse(rows):
    """rows 'r0/r1/...' -> {(x, y)} with y from 0 (cap top); width"""
    r = rows.split('/')
    w = max(1, *(len(x) for x in r))
    return {(x, y) for y, row in enumerate(r) for x, c in enumerate(row) if c == '#'}, w


def build_bits():
    glyphs = {}
    for k, v in {**TABLE, **EXTRA, **TABLE_EXTRA_BASE}.items():
        glyphs[k] = parse(v)
    for k, (base, mark) in COMPOSED.items():
        bits, w = glyphs[base]
        marks = (UPPER_MARKS if base.isupper() else LOWER_MARKS)[mark]
        off = (w - 5) // 2 if w >= 5 else -1 if w <= 2 else (w - 5) // 2
        if w == 1:  # the dotless i: the mark centred over its one column
            pts = {(x - 2, y) for x, y in marks}
            pts = {(max(-1, min(1, x)), y) for x, y in pts}
            bits = bits | {p for p in pts if p[0] >= 0} if mark != 'diaeresis' else bits | {(0, 0)}
            glyphs[k] = (bits | ({(x, y) for x, y in pts if 0 <= x < w}), w) if mark != 'diaeresis' else (bits, w)
            continue
        glyphs[k] = (bits | {(x + off, y) for x, y in marks}, w)
    for k, base in OGONEK.items():
        bits, w = glyphs[base]
        glyphs[k] = (bits | {(w - 2, 7), (w - 1, 8)}, w)
    for k, base in CEDILLA.items():
        bits, w = glyphs[base]
        glyphs[k] = (bits | {(w // 2, 7), (w // 2 - 1, 8)}, w)
    for k, v in STROKE.items():
        glyphs[k] = parse(v)
    return glyphs


def bold(bits, w):
    out = set(bits)
    for x, y in bits:
        if (x + 1, y) not in bits and not (x + 2 < w and (x + 2, y) in bits):
            out.add((x + 1, y))
    return out, w + 1


def scale2x(bits, w):
    ys = [y for _, y in bits] or [0]
    y0, y1 = min(min(ys), 0), max(max(ys), 8)
    at = lambda x, y: (x, y) in bits
    out = set()
    for y in range(y0, y1 + 1):
        for x in range(w):
            P, A, B, C, D = at(x, y), at(x, y - 1), at(x + 1, y), at(x - 1, y), at(x, y + 1)
            e0 = A if (C == A and C != D and A != B) else P
            e1 = B if (A == B and A != C and B != D) else P
            e2 = C if (D == C and D != B and C != A) else P
            e3 = D if (B == D and B != A and D != C) else P
            for (dx, dy), on in (((0, 0), e0), ((1, 0), e1), ((0, 1), e2), ((1, 1), e3)):
                if on:
                    out.add((2 * x + dx, 2 * y + dy))
    return out, 2 * w


def outline(bits, unit):
    """one rectangle per horizontal run; y grows down from the cap top (row 0), baseline under row 6"""
    pen = TTGlyphPen(None)
    rows = {}
    for x, y in bits:
        rows.setdefault(y, []).append(x)
    for y, xs in rows.items():
        xs.sort()
        start = prev = xs[0]
        runs = []
        for x in xs[1:] + [None]:
            if x is not None and x == prev + 1:
                prev = x
                continue
            runs.append((start, prev))
            if x is not None:
                start = prev = x
        top = (CAP_ROWS(unit) - y) * unit
        for a, b in runs:
            x0, x1 = a * unit, (b + 1) * unit
            pen.moveTo((x0, top - unit)); pen.lineTo((x0, top)); pen.lineTo((x1, top)); pen.lineTo((x1, top - unit)); pen.closePath()
    return pen.glyph()


PIX = 125
CAP_ROWS = lambda unit: 7 * PIX // unit  # rows above the baseline at this pixel size


def make(name, style, glyphs, unit, path):
    order = ['.notdef'] + [f'uni{ord(k):04X}' for k in glyphs]
    fb = FontBuilder(1000, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap({ord(k): f'uni{ord(k):04X}' for k in glyphs})
    pen = TTGlyphPen(None)
    pen.moveTo((0, 0)); pen.lineTo((0, 875)); pen.lineTo((500, 875)); pen.lineTo((500, 0)); pen.closePath()
    pen.moveTo((125, 125)); pen.lineTo((375, 125)); pen.lineTo((375, 750)); pen.lineTo((125, 750)); pen.closePath()
    glyf = {'.notdef': pen.glyph()}
    metrics = {'.notdef': (625, 0)}
    for k, (bits, w) in glyphs.items():
        n = f'uni{ord(k):04X}'
        glyf[n] = outline(bits, unit)
        adv = (w * unit) + PIX  # one pixel of tracking at the face's own size
        metrics[n] = (adv, 0)
    fb.setupGlyf(glyf)
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=1125, descent=-250)
    fb.setupOS2(sTypoAscender=1125, sTypoDescender=-250, sTypoLineGap=0, usWinAscent=1125, usWinDescent=250, sxHeight=625, sCapHeight=875,
                usWeightClass=700 if style == 'Bold' else 400, fsSelection=0x20 if style == 'Bold' else 0x40)
    fb.setupNameTable({'familyName': name, 'styleName': style, 'uniqueFontIdentifier': f'{name} {style}', 'fullName': f'{name} {style}',
                       'psName': f'{name.replace(" ", "")}-{style}', 'version': 'Version 1.0',
                       'licenseDescription': 'MIT (Jollyboat): the Pixel Sky design study\'s 5 x 7 face'})
    fb.setupPost()
    fb.setupHead(unitsPerEm=1000, macStyle=1 if style == 'Bold' else 0)
    fb.save(path)
    print(path, len(glyphs), 'glyphs')


if __name__ == '__main__':
    g = build_bits()
    out = ROOT / 'src/renderer/fonts'
    make('Jollyboat Sky', 'Regular', g, PIX, out / 'JollyboatSky.ttf')
    make('Jollyboat Sky', 'Bold', {k: bold(*v) for k, v in g.items()}, PIX, out / 'JollyboatSkyBold.ttf')
    make('Jollyboat Sky Display', 'Regular', {k: scale2x(*v) for k, v in g.items()}, PIX // 2, out / 'JollyboatSkyDisplay.ttf')
