// the water theme on a sharkord page: the study's water behind the page, its layout as glass
// slabs over it (the top bar, the sidebars, the chat as a floating panel). the theme's css
// (resources/themes/water.css) makes those parts transparent while html.jb-water is set; without
// webgl2, or on a software renderer, it keeps its own css water instead.
//
// the parts fill the window, so the water has to show through them: lightly frosted, thinner
// tint, the pointer's wake (softer) under them too. the glass does not follow the pointer.
// 60 frames a second while the window has focus, 30 without, none while hidden; the water at
// 60 % of the glass's resolution (the rims stay sharp), fewer air bubbles; still with reduced
// motion.

import { createWater, type TGlass, type TRgba, type TScene, type TWater } from '../renderer/theme/water/engine';
import { DAY, DEEP } from '../renderer/theme/water/tokens';

const rgba = (c: [number, number, number], a = 1): TRgba => [c[0] / 255, c[1] / 255, c[2] / 255, a];
const tokens = () => (document.documentElement.classList.contains('dark') ? DEEP : DAY);

type TSlab = 'top' | 'left' | 'right' | 'main';

// how much of the water shows through: frost 0..1 (the study's panels: 1), the tint's alpha
// against the token's
const FROST = 0.15;
const TINT = -0.12;

// the parts of sharkord's layout, as the theme's css knows them too
const parts = (): { el: HTMLElement; kind: TSlab }[] => {
  const out: { el: HTMLElement; kind: TSlab }[] = [];
  const root = document.querySelector<HTMLElement>('.h-dvh');
  if (!root) return out;
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('.bg-card.border-r:not(.w-0)'))) out.push({ el, kind: 'left' });
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('.bg-card.border-l:not(.w-0)'))) out.push({ el, kind: 'right' });
  const main = root.querySelector<HTMLElement>('main.bg-background');
  if (main) out.push({ el: main, kind: 'main' });
  const top = root.querySelector<HTMLElement>(':scope > .bg-card.border-b');
  if (top) out.push({ el: top, kind: 'top' });
  return out;
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

  const scene = (): TScene => {
    const tk = tokens();
    const items: TGlass[] = [];
    const solid: TRgba[] = [];
    for (const { el, kind } of parts()) {
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || !el.getClientRects().length) continue;
      solid.push([r.left, r.top, r.right, r.bottom]);
      const g: TGlass = {
        type: 'glass',
        kind: 0,
        x: r.left,
        y: r.top,
        w: r.width,
        h: r.height,
        pad: 30,
        radii: [0, 0, 0, 0],
        bevel: 12,
        refr: 11,
        frost: 1,
        tint: rgba(tk.glass, tk.glassA + 0.07),
        edge: rgba(tk.edge, tk.edgeA),
        gloss: 0.3,
        streaks: 0.7,
        irid: tk.irid * 0.6,
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
      };
      // every part floats apart like the study's panels: thick-rimmed, its membrane wobbling a
      // little; frosted only lightly and tinted thinner than the study's, so the caustics and
      // ripples read through (the tint still carries the text)
      const cs = getComputedStyle(el);
      const big = kind !== 'top';
      Object.assign(g, {
        radii: [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius].map((v) => parseFloat(v) || 0),
        bevel: big ? 18 : 12,
        refr: 13,
        frost: FROST,
        tint: rgba(tk.glass, tk.glassA + TINT),
        gloss: big ? 0.38 : 0.3,
        streaks: 0.45,
        irid: tk.irid * 0.8,
        wobble: big ? 1.4 : 0.9,
        lift: big ? 7 : 5,
        shade: rgba(tk.shade, tk.shadeA * 1.05)
      });
      items.push(g);
    }
    // in the order parts() gives: sidebars, the chat, then the top bar over them
    return { stage: [], items, solid };
  };

  const water = createWater(canvas, { tokens, scene, waterScale: 0.6, fps: { focused: 60, blurred: 30 }, focused, glassWake: 0.6, bubbles: 8, allowSoftware });
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
      document.documentElement.classList.remove('jb-water');
    }
  };
};
