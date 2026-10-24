// the app's own pages as a glass scene: every panel, pill, segment, check, well, slider, toast,
// the strip, the title and pearl strings become glass elements drawn under the dom, with the
// settings of the design study's components (Panel.qml, Pill.qml, Seg.qml, Check.qml, Well.qml,
// Slide.qml, Toast.qml, Strip.qml, TitleGlass.qml, Pearls.qml). the dom keeps the words and the
// clicks; the elements themselves turn transparent (water.css, html.gl).
//
// motion is springs, as in the study: hover, press, the water level and its slosh per element.

import type { TGlass, TItem, TPearls, TRgba, TScene, TTitle } from './engine';
import { waterTokens, type TWaterTokens } from './tokens';

type TSpring = { x: number; v: number };
type TState = { hv: TSpring; pr: TSpring; lvl: TSpring; sl: TSpring; halo: TSpring; shown: TSpring; vel: number; seed: number; jiggle: TRgba; last: number; fresh: boolean };

const states = new WeakMap<Element, TState>();
const stateOf = (el: Element): TState => {
  let s = states.get(el);
  if (!s) {
    const z = () => ({ x: 0, v: 0 });
    s = { hv: z(), pr: z(), lvl: z(), sl: z(), halo: z(), shown: { x: -1, v: 0 }, vel: 0, seed: Math.random(), jiggle: [0, 0, -100, 0], last: 0, fresh: true };
    states.set(el, s);
  }
  return s;
};

/** qml's SpringAnimation, roughly: spring sets the pace, damping how much it overshoots */
const spring = (s: TSpring, target: number, k: number, damping: number, dt: number, calm: boolean) => {
  if (calm) {
    s.x = target;
    s.v = 0;
    return s.x;
  }
  const w = k * 2.2;
  const z = damping * 1.6;
  const steps = Math.ceil(dt / 0.008);
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    s.v += (w * w * (target - s.x) - 2 * z * w * s.v) * h;
    s.x += s.v * h;
  }
  return s.x;
};

/** a water level: an element seen for the first time starts full (white words on empty glass
 * would not read while it filled); after that it fills and drains with the spring */
const level = (s: TState, target: number, k: number, damping: number, dt: number, calm: boolean) => {
  if (s.fresh) {
    s.fresh = false;
    s.lvl.x = target;
  }
  return spring(s.lvl, target, k, damping, dt, calm);
};

const rgba = (c: [number, number, number], a = 1): TRgba => [c[0] / 255, c[1] / 255, c[2] / 255, a];

export type TGlassDom = {
  scene: (t: number) => TScene;
  /** a click on an element: the membrane jiggles, a ring runs across it */
  poke: (el: Element, x: number, y: number, strength: number) => void;
  setPointer: (get: () => { x: number; y: number }) => void;
};

export const createGlassDom = (opts: { boat?: boolean } = {}): TGlassDom => {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  let lastT = 0;
  let pointer = () => ({ x: -9999, y: -9999 });
  let shipX = -1;
  let time = 0;

  // ---- what is on the page, read once and kept until the dom changes ------------------------
  // (the scene is built every frame; reading computed styles for every element and its parents
  // each time cost a millisecond or two a frame. lists, opacities, radii and fonts are kept
  // until a mutation, a resize or a running animation says otherwise)
  let dirty = true;
  const lists = new Map<string, HTMLElement[]>();
  const alphas = new Map<Element, number>();
  const radiiCache = new Map<Element, TRgba>();
  const cols = new Map<Element, Element | null>();
  const observer = new MutationObserver(() => (dirty = true));
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden', 'style', 'disabled', 'type', 'open', 'data-look', 'data-theme'] });
  window.addEventListener('resize', () => (dirty = true));
  let colRects = new Map<Element, TRgba>();

  const shown = (el: HTMLElement) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  /** the shown elements matching a selector */
  const q = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document): T[] => {
    const key = root === document ? sel : `${sel}@${stateOf(root as Element).seed}`;
    let list = lists.get(key);
    if (!list) lists.set(key, (list = Array.from(root.querySelectorAll<HTMLElement>(sel)).filter(shown)));
    return list as T[];
  };
  const opacityOf = (el: Element) => {
    let a = alphas.get(el);
    if (a === undefined) {
      a = 1;
      for (let p: Element | null = el; p && p !== document.documentElement; p = p.parentElement) a *= parseFloat(getComputedStyle(p).opacity) || 0;
      alphas.set(el, a);
    }
    return a;
  };
  const radiiOf = (el: Element): TRgba => {
    let r = radiiCache.get(el);
    if (!r) {
      const cs = getComputedStyle(el);
      r = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius].map((v) => parseFloat(v) || 0) as TRgba;
      radiiCache.set(el, r);
    }
    return r;
  };
  const clipOf = (el: Element): TRgba | null => {
    let col = cols.get(el);
    if (col === undefined) cols.set(el, (col = el.closest('.col, .grid')));
    if (!col) return null;
    let r = colRects.get(col);
    if (!r) {
      const b = col.getBoundingClientRect();
      colRects.set(col, (r = [b.left - 14, b.top - 14, b.right + 14, b.bottom + 14]));
    }
    return r;
  };
  const fading = new WeakMap<Animation, boolean>();
  const fades = (a: Animation) => {
    let f = fading.get(a);
    if (f === undefined) fading.set(a, (f = !!(a.effect as KeyframeEffect | null)?.getKeyframes().some((k) => 'opacity' in k)));
    return f;
  };
  const refresh = () => {
    if (dirty) {
      dirty = false;
      lists.clear();
      alphas.clear();
      radiiCache.clear();
      cols.clear();
      fontKey = '';
    }
    // an animation or transition of opacity running (a panel coming in, the toast): opacities
    // move (the panels' slow breathing moves them, which their rects follow anyway)
    else if (document.getAnimations().some((a) => a.playState === 'running' && fades(a))) alphas.clear();
    colRects = new Map();
  };
  const isHot = (el: Element) => el.matches(':hover') || el.matches(':focus-visible');

  const base = (tk: TWaterTokens, el: Element, r: DOMRect, pad: number): TGlass => {
    const s = stateOf(el);
    return {
      type: 'glass',
      kind: 0,
      x: r.left,
      y: r.top,
      w: r.width,
      h: r.height,
      pad,
      radii: [14, 14, 14, 14],
      bevel: Math.min(16, Math.min(r.width, r.height) / 2),
      refr: 7,
      frost: 0.55,
      tint: rgba(tk.btn, tk.btnA),
      edge: rgba(tk.edge, tk.edgeA),
      gloss: 0.9,
      streaks: 0,
      irid: tk.irid,
      shade: rgba(tk.shade, tk.shadeA),
      lift: 3,
      glow: rgba(tk.glow, tk.glowA),
      halo: 0,
      inset: 0,
      hover: 0,
      press: 0,
      seed: s.seed,
      wobble: 1.2,
      jiggle: s.jiggle,
      liqA: rgba(tk.liqA),
      liqB: rgba(tk.liqB),
      liquid: [0, 0, 1.2, 0],
      slosh: 0,
      flow: 0,
      alpha: opacityOf(el),
      clip: clipOf(el)
    };
  };

  // the side of a control the pointer is on, -1..1, for the water's slosh
  const side = (r: DOMRect) => {
    const p = pointer();
    return p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom ? Math.max(-1, Math.min(1, ((p.x - r.left) / r.width - 0.5) * 2)) : 0;
  };

  // ---- the title mask: the dom text drawn white at 2 × device px -------------------------

  const mask = document.createElement('canvas');
  let maskKey = '';
  let fontKey = '';
  let font = '';
  let padLeft = 0;
  let fontsReady = false;
  void document.fonts.ready.then(() => (fontsReady = true));
  const titleItem = (tk: TWaterTokens, el: HTMLElement): TTitle | null => {
    if (!fontsReady) return null;
    const r = el.getBoundingClientRect();
    const pad = 14;
    if (!fontKey) {
      const cs = getComputedStyle(el);
      font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      padLeft = parseFloat(cs.paddingLeft || '0');
      fontKey = font;
    }
    const text = el.dataset.text || el.textContent || '';
    const k = 2 * (window.devicePixelRatio || 1);
    const key = `${text}|${font}|${r.width}|${r.height}|${k}`;
    if (key !== maskKey) {
      maskKey = key;
      mask.width = Math.ceil((r.width + 2 * pad) * k);
      mask.height = Math.ceil((r.height + 2 * pad) * k);
      const ctx = mask.getContext('2d')!;
      ctx.clearRect(0, 0, mask.width, mask.height);
      ctx.scale(k, k);
      ctx.font = font;
      ctx.fillStyle = '#fff';
      ctx.textBaseline = 'alphabetic';
      const m = ctx.measureText(text);
      const asc = m.fontBoundingBoxAscent;
      const desc = m.fontBoundingBoxDescent;
      ctx.fillText(text, pad + padLeft, pad + (r.height - (asc + desc)) / 2 + asc);
    }
    const deep = tk.poolMid[0] < 40;
    return {
      type: 'title',
      x: r.left - pad,
      y: r.top - pad,
      w: r.width + 2 * pad,
      h: r.height + 2 * pad,
      pad,
      mask,
      maskKey,
      level: 0.52,
      slosh: Math.sin(time * 0.7) * 0.6,
      alpha: opacityOf(el),
      glassCol: deep ? [0.78, 0.92, 1, 1] : [0.86, 0.95, 1, 1],
      liqA: rgba(tk.liqA),
      liqB: rgba(tk.liqB),
      haloCol: deep ? rgba(tk.glow, 0.55) : [1, 1, 1, 0.85],
      shadeCol: rgba(tk.shade, deep ? 0.7 : 0.55),
      edgeCol: deep ? rgba(tk.glow, 0.7) : [0.05, 0.3, 0.58, 0.85],
      clip: null
    };
  };

  // ---- the boat and its waves --------------------------------------------------------------

  const stage = (tk: TWaterTokens, t: number, dt: number): TGlass[] => {
    if (!opts.boat) return [];
    const W = window.innerWidth;
    const H = window.innerHeight;
    // (low enough that the boat rides below the panels of a window of the default size)
    const baseY = H * 0.845 + 10 * Math.sin(t * 0.25);
    const waveY = (k: number, x: number) => baseY + k * 15 + 8 * Math.sin(x * 0.018 + t * 0.6 + k * 1.3) + 4 * Math.sin(x * 0.046 - t * 0.9 + k);
    const out: TGlass[] = [];
    const common = (x: number, y: number, w: number, h: number, pad: number): TGlass => ({
      ...base(tk, document.body, new DOMRect(x, y, w, h), pad),
      alpha: 1,
      clip: null,
      wobble: 0,
      jiggle: [0, 0, -100, 0]
    });

    // the boat eases toward the pointer, staying on screen
    const p = pointer();
    const target = Math.min(W - 70, Math.max(70, p.x > -1000 ? p.x : W / 2));
    if (shipX < 0) shipX = W / 2;
    shipX += (target - shipX) * Math.min(1, dt * 0.35);
    const S = 4;
    const slope = (waveY(0, shipX + 6) - waveY(0, shipX - 6)) / 12;
    const rot = Math.atan(slope) * 0.6 + 0.04 * Math.sin(t * 0.5);
    const pivot = { x: shipX, y: waveY(0, shipX) + 1.5 * Math.sin(t * 1.2) };
    const part = (cx: number, cy: number, w: number, h: number) => {
      const dx = (cx - 14) * S;
      const dy = (cy - 21.2) * S;
      const c = Math.cos(rot);
      const s = Math.sin(rot);
      return { x: pivot.x + c * dx - s * dy, y: pivot.y + s * dx + c * dy, w: w * S, h: h * S };
    };
    const deep = tk.poolMid[0] < 40;

    // the mast: a thin rod
    const m = part(14.4, 9.4, 0.9, 15.6);
    out.push({ ...common(m.x - m.w / 2, m.y - m.h / 2, m.w, m.h, 8), radii: [m.w / 2, m.w / 2, m.w / 2, m.w / 2], bevel: m.w / 2, frost: 0, refr: 2, gloss: 0.5, lift: 1.5, tint: rgba(tk.dim, 0.9), shade: rgba(tk.shade, tk.shadeA * 0.5) });
    // the sail: frosted clear glass
    const sl = part(19.7, 8.7, 10, 12.8);
    out.push({ ...common(sl.x - sl.w / 2, sl.y - sl.h / 2, sl.w, sl.h, 14), kind: 2, shapeA: [S, 19.7, 8.7, rot], bevel: 7, frost: 0.7, refr: 6, gloss: 0.9, irid: tk.irid * 1.2, tint: [1, 1, 1, deep ? 0.12 : 0.3], lift: 2, shade: rgba(tk.shade, tk.shadeA * 0.5) });
    // the hull: glass holding water that stays level as it rocks
    const hl = part(14.4, 19.8, 25.4, 6.6);
    out.push({ ...common(hl.x - hl.w / 2, hl.y - hl.h / 2, hl.w, hl.h, 16), kind: 1, shapeA: [S, 14.4, 19.8, rot], bevel: 9, frost: 0.3, refr: 8, gloss: 0.8, lift: 3, shade: rgba(tk.shade, tk.shadeA * 0.8), liquid: [0.62, 1, 1.0, 0], slosh: -rot * 2.5 });

    // three wave lines: tubes of water streaming along, the first in front of the hull
    for (let k = 2; k >= 0; k--) {
      const th = 3.2 - 0.5 * k;
      const y0 = baseY + k * 15 - 18;
      const g = common(0, y0, W, 36, 10);
      g.kind = 3;
      g.wave = [g.x - g.pad, baseY - (g.y - g.pad), k, th];
      g.bevel = th;
      g.frost = 0.4;
      g.refr = 6;
      g.gloss = 0;
      g.lift = 2;
      g.shade = rgba(tk.shade, tk.shadeA * 0.55);
      g.liquid = [1, 2, 0.6, 0];
      g.flow = 30 + 8 * k;
      g.alpha = 1 - 0.25 * k;
      out.push(g);
    }
    return out;
  };

  // ---- the scene ---------------------------------------------------------------------------

  const scene = (t: number): TScene => {
    const dt = Math.min(0.05, Math.max(0, t - lastT)) || 1 / 60;
    lastT = t;
    time = t;
    const calm = reduce.matches;
    const tk = waterTokens();
    const items: TItem[] = [];
    const solid: TRgba[] = [];
    refresh();
    // water that white words sit on: a little deeper than the study's, so they read on it
    const liqText = rgba(tk.liqA.map((c, i) => c * 0.65 + tk.liqB[i] * 0.35) as [number, number, number]);

    // panels: frosted, thick-rimmed, wobbling; they do not follow the pointer (only a source
    // card, which is clicked, lights up under it)
    for (const el of q('.panel, .footer, .source')) {
      const r = el.getBoundingClientRect();
      const s = stateOf(el);
      const g = base(tk, el, r, 30);
      g.radii = radiiOf(el);
      const small = !el.classList.contains('panel');
      g.bevel = small ? 10 : 18;
      g.frost = small ? 0.9 : 1;
      g.refr = small ? 7 : 13;
      g.tint = rgba(tk.glass, tk.glassA + (small ? 0.08 : 0));
      g.gloss = small ? 0.3 : 0.38;
      g.streaks = small ? 0 : 1;
      g.irid = tk.irid * 0.8;
      g.wobble = small ? 0.9 : 2;
      g.lift = small ? 3 : 7;
      g.hover = el.classList.contains('source') ? spring(s.hv, el.matches(':hover') ? 1 : 0, 4, 0.22, dt, calm) * 0.4 : 0;
      g.shade = rgba(tk.shade, tk.shadeA * (small ? 0.8 : 1.05));
      g.glow = rgba(tk.glow, tk.glowA * 0.5);
      g.halo = el.classList.contains('source') && el.classList.contains('on') ? 1 : 0;
      items.push(g);
      solid.push([r.left, r.top, r.right, r.bottom]);
    }

    // a slab: glass across a whole bar, its rims beyond the window but for the bottom one; it
    // fills the bar, so it is frosted only lightly and the water shows through
    for (const el of q('.slab')) {
      const r = el.getBoundingClientRect();
      const g = base(tk, el, new DOMRect(r.left - 40, r.top - 40, r.width + 80, r.height + 40 - 1), 20);
      Object.assign(g, { radii: [0, 0, 10, 10], bevel: 8, frost: 0.15, refr: 9, tint: rgba(tk.glass, tk.glassA - 0.02), gloss: 0, streaks: 0.6, irid: tk.irid * 0.6, wobble: 0, lift: 2, shade: rgba(tk.shade, tk.shadeA * 0.8), clip: null });
      items.push(g);
      solid.push([r.left, r.top, r.right, r.bottom]);
    }

    // the title, the strip under it, pearl strings
    const titleEl = q('.title')[0];
    if (titleEl) {
      const ti = titleItem(tk, titleEl);
      if (ti) items.push(ti);
    }
    for (const el of q('canvas.strip')) {
      const g = base(tk, el, el.getBoundingClientRect(), 12);
      Object.assign(g, { radii: [4.5, 4.5, 4.5, 4.5], bevel: 4.5, frost: 0.5, refr: 4, gloss: 0.9, wobble: 0.5, lift: 1.5, liquid: [1, 2, 0.6, 0], flow: 34, shade: rgba(tk.shade, tk.shadeA * 0.6) });
      items.push(g);
    }
    for (const el of q('.pearls')) {
      const r = el.getBoundingClientRect();
      const deep = tk.poolMid[0] < 40;
      const pearl: TPearls = {
        type: 'pearls',
        x: r.left,
        y: r.top - 12,
        w: r.width,
        h: r.height + 24,
        seed: stateOf(el).seed,
        drift: 7,
        alpha: opacityOf(el),
        rimCol: rgba(tk.edge, deep ? 0.55 : 0.5),
        bodyCol: deep ? [0.75, 0.9, 1, 0.14] : [1, 1, 1, 0.45],
        fillCol: rgba(tk.liqB, 0.16),
        clip: clipOf(el)
      };
      items.push(pearl);
    }

    // the server dots: small beads, full of water when the server answered
    for (const el of q('.dot')) {
      if (el.classList.contains('none')) continue;
      const g = base(tk, el, el.getBoundingClientRect(), 8);
      const rr = g.w / 2;
      Object.assign(g, { radii: [rr, rr, rr, rr], bevel: rr, frost: 0.5, refr: 3, gloss: 0.9, wobble: 0, lift: 1, liquid: [el.classList.contains('ok') ? 1 : 0, 1, 0.3, 0], tint: rgba(tk.btn, tk.btnA + 0.25), shade: rgba(tk.shade, tk.shadeA * 0.5) });
      items.push(g);
    }

    // pills (and the bar's chips): bubbles, the major ones holding water
    for (const el of q<HTMLButtonElement>('.pill, .chip')) {
      const r = el.getBoundingClientRect();
      const s = stateOf(el);
      const h = r.height;
      const major = el.classList.contains('chip') ? el.classList.contains('fill') : !el.classList.contains('minor');
      const alt = el.classList.contains('alt') || (el.classList.contains('chip') && [...(el.parentElement?.children ?? [])].indexOf(el) % 2 === 1);
      const active = !el.disabled;
      const hv = spring(s.hv, active && isHot(el) ? 1 : 0, 4, 0.22, dt, calm);
      const pr = spring(s.pr, active && el.matches(':active') ? 1 : 0, 6, 0.3, dt, calm);
      const sl = spring(s.sl, side(r), 2.2, 0.08, dt, calm);
      const lvl = level(s, major ? (el.matches(':active') ? 0.97 : 0.86 + 0.08 * hv) : 0, 3, 0.18, dt, calm);
      const g = base(tk, el, r, 18);
      Object.assign(g, {
        radii: alt ? [h * 0.34, h / 2, h * 0.34, h / 2] : [h / 2, h * 0.34, h / 2, h * 0.34],
        bevel: h / 2 - 1,
        hover: hv,
        press: pr,
        frost: 0.75,
        refr: 9,
        gloss: 0.95,
        wobble: 1,
        liquid: [lvl, major ? 1 : 0, 1.3 + 1.2 * Math.abs(sl), 0],
        liqA: liqText,
        slosh: sl * 0.5,
        lift: major ? 3.5 : 2.5,
        shade: rgba(tk.shade, tk.shadeA * (major ? 1.1 : 0.7))
      });
      if (!active) g.alpha *= 0.45;
      items.push(g);
    }

    // segments: the chosen one fills with water, the one it leaves drains
    for (const row of q('.seg')) {
      q<HTMLButtonElement>('button', row).forEach((el, i) => {
        const r = el.getBoundingClientRect();
        const s = stateOf(el);
        const sel = el.classList.contains('on');
        const hv = spring(s.hv, isHot(el) ? 1 : 0, 4, 0.22, dt, calm);
        const pr = spring(s.pr, el.matches(':active') ? 1 : 0, 6, 0.3, dt, calm);
        const lvl = level(s, sel ? 0.9 : 0, 2.4, 0.2, dt, calm);
        const sl = spring(s.sl, side(r), 2, 0.08, dt, calm);
        const a = i % 2 ? 9 : 15;
        const b = i % 2 ? 15 : 9;
        const g = base(tk, el, r, 16);
        Object.assign(g, { radii: [a, b, a, b], bevel: 12, hover: hv, press: pr, frost: 0.75, refr: 8, wobble: 0.9, liquid: [lvl, 1, 1.1 + Math.abs(sl), 0], liqA: liqText, slosh: sl * 0.5, lift: sel ? 3 : 2, shade: rgba(tk.shade, tk.shadeA * (sel ? 1 : 0.6)) });
        items.push(g);
      });
    }

    // checks: a small glass cube that fills with water when on
    for (const el of q<HTMLInputElement>('.check input[type=checkbox]')) {
      const s = stateOf(el);
      const hv = spring(s.hv, isHot(el) || !!el.closest('.check')?.matches(':hover') ? 1 : 0, 4, 0.22, dt, calm);
      const lvl = level(s, el.checked ? 0.88 : 0, 2.6, 0.2, dt, calm);
      const g = base(tk, el, el.getBoundingClientRect(), 14);
      Object.assign(g, { radii: [7, 5, 7, 5], bevel: 7, hover: hv, press: el.matches(':active') ? 1 : 0, frost: 0.6, refr: 5, wobble: 0.6, lift: 2, liquid: [lvl, 1, 0.9, 0], shade: rgba(tk.shade, tk.shadeA * 0.7) });
      if (el.disabled) g.alpha *= 0.45;
      items.push(g);
    }

    // wells: recessed glass for text, glowing at the rim while focused
    for (const el of q<HTMLInputElement>('input[type=text], input[type=password], input[type=url]')) {
      const s = stateOf(el);
      const lit = document.activeElement === el;
      const hv = spring(s.hv, el.matches(':hover') ? 1 : 0, 4, 0.22, dt, calm);
      const halo = spring(s.halo, lit ? 1 : 0, 5, 0.7, dt, calm);
      const g = base(tk, el, el.getBoundingClientRect(), 16);
      Object.assign(g, { radii: [11, 17, 11, 17], bevel: 6, inset: 1, frost: 0.85, refr: 4, gloss: 0.18, tint: rgba(tk.well, tk.wellA), lift: 0, shade: rgba(tk.shade, 0), hover: hv * 0.5, halo: Math.max(0, halo), wobble: 0.6 + (lit ? 0.8 : 0), irid: 0 });
      items.push(g);
    }

    // sliders: a glass tube that fills with water up to a glass marble
    for (const el of q<HTMLInputElement>('input[type=range]')) {
      const r = el.getBoundingClientRect();
      const s = stateOf(el);
      const min = Number(el.min || 0);
      const max = Number(el.max || 100);
      const value = (Number(el.value) - min) / (max - min || 1);
      if (s.shown.x < 0) s.shown.x = value;
      const before = s.shown.x;
      const v = spring(s.shown, value, 5, 0.32, dt, calm);
      const speed = Math.min(1, Math.abs(v - before) / dt * 0.5);
      s.vel += (speed - s.vel) * Math.min(1, dt * 6);
      const dir = Math.max(-1, Math.min(1, (v - before) / dt * 0.5));
      const knob = 22;
      const span = Math.max(1, r.width - knob);
      const hv = spring(s.hv, isHot(el) ? 1 : 0, 4, 0.22, dt, calm);
      const pr = spring(s.pr, el.matches(':active') ? 1 : 0, 6, 0.25, dt, calm);
      const cy = r.top + r.height / 2;
      const tube = base(tk, el, new DOMRect(r.left, cy - 5, r.width, 10), 14);
      Object.assign(tube, { radii: [5, 5, 5, 5], bevel: 5, frost: 0.6, refr: 5, gloss: 0.8, hover: hv * 0.4, wobble: 0.35, lift: 1.5, liquid: [(v * span + knob / 2) / Math.max(1, r.width), 2, 0.9, s.vel], shade: rgba(tk.shade, tk.shadeA * 0.6) });
      items.push(tube);
      const marble = base(tk, el, new DOMRect(r.left + v * span, cy - knob / 2, knob, knob), 16);
      Object.assign(marble, { radii: [11, 11, 11, 11], bevel: knob / 2 - 1, hover: hv, press: pr, frost: 0.4, refr: 8, gloss: 1, wobble: 0.7, lift: 3, liquid: [0.72 + 0.1 * pr, 1, 1.4 + 2 * s.vel, 0], slosh: -dir * 0.9, seed: s.seed + 0.5 });
      items.push(marble);
    }

    // the toast: a water bubble that pops in at the top
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('.toast'))) {
      const a = opacityOf(el);
      if (a < 0.01) continue;
      const g = base(tk, el, el.getBoundingClientRect(), 18);
      Object.assign(g, { radii: [19, 9, 19, 9], bevel: 18, frost: 0.5, refr: 9, liquid: [0.92, 1, 1.6, 0], liqA: liqText, lift: 5, alpha: a, clip: null });
      items.push(g);
    }

    return { stage: stage(tk, t, dt), items, solid };
  };

  return {
    scene,
    poke: (el, x, y, strength) => {
      const s = stateOf(el);
      const pad = el.matches('.panel, .footer, .source') ? 30 : el.matches('.seg button, input[type=text], input[type=password], input[type=url]') ? 16 : el.matches('.check input') ? 14 : 18;
      s.jiggle = [x + pad, y + pad, time, strength];
    },
    setPointer: (get) => {
      pointer = get;
    }
  };
};
