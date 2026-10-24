// the water theme on a sharkord page: the study's water behind the page, its layout as glass
// slabs over it (the top bar, the sidebars, the chat as a floating panel). the theme's css
// (resources/themes/water.css) makes those parts transparent while html.jb-water is set; without
// webgl2, or on a software renderer, it keeps its own css water instead.
//
// the parts fill the window, so the water has to show through them: lightly frosted, thinner
// tint, the pointer's wake (softer) under them too. the glass does not follow the pointer. the
// channel you are on is a glass pill of water; a sent message drops into the water, and whoever
// talks sends rings out under their avatar.
// 60 frames a second while the window has focus, 30 without, none while hidden; the water at
// 60 % of the glass's resolution (the rims stay sharp), fewer air bubbles; still with reduced
// motion.

import { createWater, type TGlass, type TRgba, type TScene, type TWater } from '../renderer/theme/water/engine';
import { DAY, DEEP } from '../renderer/theme/water/tokens';

const rgba = (c: [number, number, number], a = 1): TRgba => [c[0] / 255, c[1] / 255, c[2] / 255, a];
const tokens = () => (document.documentElement.classList.contains('dark') ? DEEP : DAY);

type TSlab = 'top' | 'left' | 'right' | 'main';

// how much of the water shows through: frost 0..1 (the study's panels: 1), the tint's alpha
// against the token's (the day's a little more: dark small print on bright, moving water)
const FROST = 0.15;

// the buttons the theme's css draws as glass bubbles (the ghost and icon ones stay quiet)
const BUTTONS =
  ':is([data-slot="button"], button:where(.inline-flex.whitespace-nowrap:not([data-slot]))):is(.bg-primary, .bg-secondary, .bg-background, .border):not(.bg-destructive)';
const tintOf = (tk: typeof DAY) => tk.glassA + (tk === DAY ? -0.08 : -0.12);

// the parts of sharkord's layout, as the theme's css knows them too
type TPart = { el: HTMLElement; kind: TSlab; radii: TRgba };
const radiiOf = (el: Element): TRgba => {
  const cs = getComputedStyle(el);
  return [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius].map((v) => parseFloat(v) || 0) as TRgba;
};
const findParts = (): TPart[] => {
  const out: TPart[] = [];
  const root = document.querySelector<HTMLElement>('.h-dvh');
  if (!root) return out;
  const add = (el: HTMLElement | null, kind: TSlab) => el && out.push({ el, kind, radii: radiiOf(el) });
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('.bg-card.border-r:not(.w-0)'))) add(el, 'left');
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('.bg-card.border-l:not(.w-0)'))) add(el, 'right');
  add(root.querySelector<HTMLElement>('main.bg-background'), 'main');
  add(root.querySelector<HTMLElement>(':scope > .bg-card.border-b'), 'top');
  return out;
};

type TSpring = { x: number; v: number };
/** qml's SpringAnimation, roughly (as in glass-dom.ts) */
const spring = (s: TSpring, target: number, k: number, damping: number, dt: number) => {
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

export const startPageWater = (allowSoftware: boolean, focused: () => boolean): TWater | null => {
  const canvas = document.createElement('canvas');
  canvas.className = 'jb-water';
  canvas.style.cssText = 'position:fixed;left:0;top:0;z-index:-1;pointer-events:none;';
  document.body.prepend(canvas);
  const seeds = new WeakMap<Element, number>();
  const seed = (el: Element) => {
    let s = seeds.get(el);
    if (s === undefined) seeds.set(el, (s = Math.random()));
    return s;
  };
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  // the layout and the channel you are on are looked up twice a second, and for a few frames
  // after every click or key (sharkord's dom changes all the time; a mutation observer would
  // fire for every message and presence change)
  let parts: TPart[] = [];
  let partsAt = -1e9;
  let current: HTMLElement | null = null;
  let eager = 0;
  const wake = () => (eager = 24);
  window.addEventListener('resize', wake);
  // a message sent: a drop falls into the water under the message box
  const onKey = (e: KeyboardEvent) => {
    wake();
    const box = (e.target as Element | null)?.closest?.('.tiptap');
    if (!box || e.key !== 'Enter' || e.shiftKey || e.isComposing || !box.textContent?.trim()) return;
    const r = (box.parentElement ?? box).getBoundingClientRect();
    water?.ripple(r.left + Math.min(60, r.width / 2), r.top + r.height / 2, -0.9, 7);
  };
  window.addEventListener('keydown', onKey, { capture: true, passive: true });

  // glass controls drawn with the water, reacting to the pointer like the bar's buttons: the
  // channel you are on and the voice channel you are in are pills of water (filling as you pick or
  // join them, overshooting, the surface tilting; the one you left drains and fades), sharkord's
  // buttons in the layout are glass bubbles, the main ones holding water. under the pointer the
  // water rises and leans its way and the glass lights up; pressed it squashes, a click sets it
  // jiggling. the elements themselves turn transparent (data-jb-glass, the theme's css)
  type TKind = 'channel' | 'voice' | 'button';
  type TCtl = { kind: TKind; major: boolean; radii: TRgba; hv: TSpring; pr: TSpring; lvl: TSpring; sl: TSpring; seed: number; jiggle: TRgba; clip: Element | null; wanted: boolean };
  const ctls = new Map<HTMLElement, TCtl>();
  let picked = false;
  let currentText: HTMLElement | null = null;
  let lastT = 0;
  let water: TWater | null = null;
  // whoever is talking sends small rings out under their avatar, stronger as they get louder
  let talkAt = 0;
  const talking = (t: number) => {
    if (t - talkAt < 0.55) return;
    talkAt = t;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('[class*="speaking-effect-"]'))) {
      const r = el.getBoundingClientRect();
      if (r.width < 4) continue;
      const level = el.className.includes('speaking-effect-high') ? 0.75 : el.className.includes('speaking-effect-medium') ? 0.55 : 0.35;
      water?.ripple(r.left + r.width / 2, r.top + r.height / 2, -level, 4 + level * 3);
    }
  };

  const glassBase = (tk: typeof DAY, el: Element, r: DOMRect, pad: number): TGlass => ({
    type: 'glass',
    kind: 0,
    x: r.left,
    y: r.top,
    w: r.width,
    h: r.height,
    pad,
    radii: [0, 0, 0, 0],
    bevel: 12,
    refr: 13,
    frost: FROST,
    tint: rgba(tk.glass, tintOf(tk)),
    edge: rgba(tk.edge, tk.edgeA),
    gloss: 0.3,
    streaks: 0,
    irid: tk.irid * 0.8,
    shade: rgba(tk.shade, tk.shadeA),
    lift: 4,
    glow: rgba(tk.glow, tk.glowA * 0.5),
    halo: 0,
    inset: 0,
    hover: 0,
    press: 0,
    seed: seed(el),
    wobble: 0,
    jiggle: [0, 0, -100, 0],
    liqA: rgba(tk.liqA),
    liqB: rgba(tk.liqB),
    liquid: [0, 0, 1, 0],
    slosh: 0,
    flow: 0,
    alpha: 1,
    clip: null
  });

  const ctlOf = (el: HTMLElement, kind: TKind, t: number) => {
    let c = ctls.get(el);
    if (!c) {
      const z = () => ({ x: 0, v: 0 });
      const radii = kind === 'button' ? radiiOf(el) : ([14, 9, 14, 9] as TRgba);
      c = { kind, major: false, radii, hv: z(), pr: z(), lvl: z(), sl: z(), seed: Math.random(), jiggle: [0, 0, -100, 0], clip: el.closest('.overflow-y-auto, .overflow-auto'), wanted: true };
      ctls.set(el, c);
      el.setAttribute('data-jb-glass', '');
      // the page coming up: what is already there is simply full
      if (!picked) c.lvl.x = kind === 'button' ? 0.86 : 0.84;
      else if (kind !== 'button') {
        const r = el.getBoundingClientRect();
        c.jiggle = [r.width / 2 + 16, r.height / 2 + 16, t, 0.6];
        water?.ripple(r.left + r.width / 2, r.top + r.height / 2, -0.7, 6);
      }
    }
    c.wanted = true;
    return c;
  };
  const lookControls = (t: number) => {
    for (const c of ctls.values()) c.wanted = false;
    const text = document.querySelector<HTMLElement>('[data-testid="channel-item"].bg-accent');
    const voice = document.querySelector<HTMLElement>('[data-testid="channel-item"]:is(.text-green-500, .text-blue-500)');
    if (text) {
      const fresh = !ctls.has(text);
      const c = ctlOf(text, 'channel', t);
      // a new pick: the surface tilts away from where you came from
      if (fresh && picked && currentText?.isConnected) c.sl.v += Math.sign(text.getBoundingClientRect().top - currentText.getBoundingClientRect().top || 1) * 2.4;
    }
    if (voice) ctlOf(voice, 'voice', t);
    currentText = text;
    // sharkord's own buttons in the layout (and plugins' ones made like them): the ones the theme
    // draws as bubbles
    for (const { el: part } of parts) {
      for (const b of Array.from(part.querySelectorAll<HTMLElement>(BUTTONS))) {
        if (b === text || b === voice || !b.getClientRects().length) continue;
        const c = ctlOf(b, 'button', t);
        c.major = b.classList.contains('bg-primary');
        c.radii = radiiOf(b);
      }
    }
    for (const [el, c] of ctls) {
      if (c.wanted && el.isConnected) continue;
      el.removeAttribute('data-jb-glass');
      if (c.kind === 'button' || !el.isConnected) ctls.delete(el);
    }
    picked = true;
  };
  // a click on one of them: it jiggles, and a drop falls in the water under it
  const onDown = (e: PointerEvent) => {
    wake();
    const el = (e.target as Element | null)?.closest?.('[data-jb-glass]') as HTMLElement | null;
    const c = el && ctls.get(el);
    if (!el || !c || !water) return;
    const r = el.getBoundingClientRect();
    const pad = c.kind === 'button' ? 18 : 16;
    c.jiggle = [e.clientX - r.left + pad, e.clientY - r.top + pad, water.time(), c.kind === 'button' ? 1 : 0.7];
    water.ripple(r.left + r.width / 2, r.top + r.height / 2, -0.45, 7);
  };
  window.addEventListener('pointerdown', onDown, { capture: true, passive: true });

  const scene = (t: number): TScene => {
    const dt = Math.min(0.05, Math.max(0, t - lastT)) || 1 / 60;
    lastT = t;
    const calm = reduce.matches;
    const tk = tokens();
    const items: TGlass[] = [];
    const solid: TRgba[] = [];
    const now = performance.now();
    const look = eager > 0 || now - partsAt > 500;
    if (eager > 0) eager--;
    if (look) {
      parts = findParts();
      partsAt = now;
    }

    // every part floats apart like the study's panels: thick-rimmed, its membrane wobbling a
    // little; frosted only lightly and tinted thinner than the study's, so the caustics and
    // ripples read through (the tint still carries the text)
    for (const { el, kind, radii } of parts) {
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      solid.push([r.left, r.top, r.right, r.bottom]);
      const big = kind !== 'top';
      const g = glassBase(tk, el, r, 30);
      Object.assign(g, {
        radii,
        bevel: big ? 18 : 12,
        gloss: big ? 0.38 : 0.3,
        streaks: 0.45,
        wobble: big ? 1.4 : 0.9,
        lift: big ? 7 : 5,
        shade: rgba(tk.shade, tk.shadeA * 1.05)
      });
      items.push(g);
    }
    // (in the order findParts gives: sidebars, the chat, then the top bar over them)

    if (look) lookControls(t);
    const ptr = water?.pointer() ?? { x: -9999, y: -9999 };
    // water that white words sit on: a little deeper than the study's
    const deepA = rgba(tk.liqA.map((c, i) => c * 0.62 + tk.liqB[i] * 0.38) as [number, number, number]);
    for (const [el, c] of ctls) {
      const pill = c.kind !== 'button';
      if (!c.wanted && !pill) continue;
      const r = el.getBoundingClientRect();
      const shown = el.isConnected && r.width >= 4 && r.height >= 4;
      const hot = shown && c.wanted && !(el as HTMLButtonElement).disabled && ((ptr.x >= r.left && ptr.x <= r.right && ptr.y >= r.top && ptr.y <= r.bottom) || el.matches(':focus-visible'));
      const pressed = hot && el.matches(':active');
      const hv = calm ? (hot ? 1 : 0) : spring(c.hv, hot ? 1 : 0, 4, 0.22, dt);
      const pr = calm ? (pressed ? 1 : 0) : spring(c.pr, pressed ? 1 : 0, 6, 0.3, dt);
      const side = hot ? Math.max(-1, Math.min(1, ((ptr.x - r.left) / r.width - 0.5) * 2)) : 0;
      const sl = calm ? 0 : spring(c.sl, side, 2.2, 0.08, dt);
      const full = c.wanted && (pill || c.major) ? (pressed ? 0.97 : 0.84 + 0.08 * hv) : 0;
      const lvl = calm ? full : spring(c.lvl, full, pill ? 2.2 : 3, pill ? 0.16 : 0.18, dt);
      if (pill && !c.wanted && lvl < 0.015 && Math.abs(c.lvl.v) < 0.05) {
        ctls.delete(el);
        continue;
      }
      if (!shown) continue;
      const g = glassBase(tk, el, r, pill ? 16 : 18);
      const box = c.clip?.getBoundingClientRect();
      const h = r.height;
      Object.assign(g, {
        radii: pill ? [14, 9, 14, 9] : c.radii,
        bevel: Math.min(pill ? 14 : 16, h / 2 - 1),
        refr: pill ? 8 : 9,
        frost: pill ? 0.6 : 0.75,
        tint: rgba(tk.btn, tk.btnA),
        gloss: pill ? 0.85 : 0.95,
        irid: tk.irid,
        wobble: pill ? 0.8 : 1,
        hover: hv,
        press: pr,
        lift: pill || c.major ? 3.2 : 2.5,
        shade: rgba(tk.shade, tk.shadeA * (pill || c.major ? 1 : 0.7)),
        glow: rgba(tk.glow, tk.glowA),
        seed: c.seed,
        jiggle: c.jiggle,
        liqA: deepA,
        liquid: [Math.max(0, lvl), pill || c.major ? 1 : 0, 1.1 + 1.6 * Math.abs(sl), 0],
        slosh: sl * 0.55,
        alpha: c.wanted ? 1 : Math.min(1, Math.max(0, lvl) / 0.35),
        clip: box ? [box.left, box.top, box.right, box.bottom] : null
      });
      if ((el as HTMLButtonElement).disabled) g.alpha *= 0.45;
      items.push(g);
    }
    if (!calm) talking(t);
    return { stage: [], items, solid };
  };

  water = createWater(canvas, { tokens, scene, waterScale: 0.6, fps: { focused: 60, blurred: 30 }, focused, glassWake: 0.6, bubbles: 8, allowSoftware });
  if (!water) {
    canvas.remove();
    return null;
  }
  document.documentElement.classList.add('jb-water');
  const stop = water.stop;
  return {
    ...water,
    stop: () => {
      stop();
      canvas.remove();
      window.removeEventListener('pointerdown', onDown, { capture: true });
      for (const el of ctls.keys()) el.removeAttribute('data-jb-glass');
      window.removeEventListener('keydown', onKey, { capture: true });
      window.removeEventListener('resize', wake);
      document.documentElement.classList.remove('jb-water');
    }
  };
};
