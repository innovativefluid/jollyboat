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
  window.addEventListener('pointerdown', wake, { capture: true, passive: true });
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

  // the channel you are on is a pill of water: it fills when you pick it (overshooting, the
  // surface tilting back and forth), the one you left drains and fades
  type TPill = { lvl: TSpring; sl: TSpring; seed: number; jiggle: TRgba; clip: Element | null };
  const pills = new Map<HTMLElement, TPill>();
  let picked = false;
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

    // the channel pill
    if (look) {
      const next = document.querySelector<HTMLElement>('[data-testid="channel-item"].bg-accent');
      if (next !== current) {
        const before = current?.isConnected ? current.getBoundingClientRect() : null;
        current = next;
        if (next) {
          let p = pills.get(next);
          if (!p) pills.set(next, (p = { lvl: { x: 0, v: 0 }, sl: { x: 0, v: 0 }, seed: Math.random(), jiggle: [0, 0, -100, 0], clip: next.closest('.overflow-y-auto') }));
          const r = next.getBoundingClientRect();
          if (!picked) {
            // the page coming up: the channel is simply full
            p.lvl.x = 0.84;
          } else {
            // the surface tilts away from where you came from; a drop lands in the water under it
            p.sl.v += before ? Math.sign(r.top - before.top || 1) * 2.4 : 1.6;
            p.jiggle = [r.width / 2 + 16, r.height / 2 + 16, t, 0.6];
            water?.ripple(r.left + r.width / 2, r.top + r.height / 2, -0.7, 6);
          }
          picked = true;
        }
      }
    }
    for (const [el, p] of pills) {
      const on = el === current && el.isConnected;
      const lvl = calm ? (on ? 0.84 : 0) : spring(p.lvl, on ? 0.84 : 0, 2.2, 0.16, dt);
      const sl = calm ? 0 : spring(p.sl, 0, 1.4, 0.12, dt);
      if (!on && lvl < 0.015 && Math.abs(p.lvl.v) < 0.05) {
        pills.delete(el);
        continue;
      }
      if (!el.isConnected) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      const g = glassBase(tk, el, r, 16);
      const box = p.clip?.getBoundingClientRect();
      // a little deeper water than the buttons', so the white name on it reads
      const deepA = tk.liqA.map((c, i) => c * 0.62 + tk.liqB[i] * 0.38) as [number, number, number];
      Object.assign(g, {
        radii: [14, 9, 14, 9],
        bevel: Math.min(14, r.height / 2 - 1),
        refr: 8,
        frost: 0.6,
        tint: rgba(tk.btn, tk.btnA),
        gloss: 0.85,
        irid: tk.irid,
        wobble: 0.8,
        lift: 3,
        shade: rgba(tk.shade, tk.shadeA * 0.9),
        seed: p.seed,
        jiggle: p.jiggle,
        liqA: rgba(deepA),
        liquid: [Math.max(0, lvl), 1, 1.1 + 2.2 * Math.abs(sl), 0],
        slosh: sl * 0.55,
        alpha: on ? 1 : Math.min(1, Math.max(0, lvl) / 0.35),
        clip: box ? [box.left, box.top, box.right, box.bottom] : null
      });
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
      window.removeEventListener('pointerdown', wake, { capture: true });
      window.removeEventListener('keydown', onKey, { capture: true });
      window.removeEventListener('resize', wake);
      document.documentElement.classList.remove('jb-water');
    }
  };
};
