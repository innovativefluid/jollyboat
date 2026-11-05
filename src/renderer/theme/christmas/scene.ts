// The Christmas theme's backdrop, in the "Frutiger Jolly" way: the glossy, glowing Christmas of
// mid-2000s desktops (Frutiger Aero dressed for the season). A deep glow, soft light beams, bokeh
// drifting up, sparkles twinkling, and glass baubles hanging on gold strings that sway on their
// own and swing when the pointer brushes past. Each palette brings its own scenery:
//
//   classic  red and green: pine branches at the right, strings of lights chasing down the sides
//   gold     black into gold: ribbons of light flowing along the bottom, spiral trees of sparkles
//   snow     a snowy hill with two snowmen and falling snow; by day a blue sky with the sun's rays
//            and a lens flare, at night deep blue with a spiral tree of light
//
// Light or dark follows the page. One canvas behind the page (or the app's window), drawn at no
// more than 1.25 device pixels per css pixel (it is all soft light); the still parts are drawn
// once per size into a layer. 60 frames a second in front, 30 behind (the water's); it rests while a game is
// open over the page, and stands still with reduced motion.

export type TXmasPalette = 'classic' | 'gold' | 'snow';
export type TXmasScene = {
  stop: () => void;
  rest: (on: boolean) => void;
  /** the pointer moved (css px): baubles it brushes swing */
  pointer: (x: number, y: number) => void;
  /** for tuning: the average time of a drawn frame lately (ms, the script's part) and the frames
   *  drawn in the last second */
  cost: () => { ms: number; fps: number };
};
export type TXmasOptions = {
  palette: () => string;
  dark: () => boolean;
  focused?: () => boolean;
  /** where the baubles hang, as shares of the width (the page keeps them over the chat) */
  hang?: number[];
  /** their strings' length and their radius, css px (default: long strings, big baubles) */
  len?: [number, number];
  size?: [number, number];
};

type TBaubleKind = 'red' | 'gold' | 'green' | 'silver' | 'ice';
type TDecor = 'pine' | 'gold' | 'snow';
type TCfg = {
  base: [string, string];
  vertical?: boolean;
  glow: { x: number; y: number; r: number; color: string };
  glow2?: { x: number; y: number; r: number; color: string };
  bokeh: string[];
  bokehA: number;
  sparkle: string;
  beams: string | null;
  lights: boolean;
  baubles: TBaubleKind[];
  decor: TDecor;
  snow: boolean;
  spiral: string | null;
  sun: boolean;
  hill?: [string, string];
  snowmanShade?: string;
};

const CFG: Record<TXmasPalette, { dark: TCfg; light: TCfg }> = {
  classic: {
    dark: {
      base: ['#03200b', '#0d541c'],
      glow: { x: 0.66, y: 0.42, r: 0.62, color: 'rgba(132, 228, 98, 0.62)' },
      glow2: { x: 0.18, y: 0.8, r: 0.5, color: 'rgba(40, 140, 50, 0.35)' },
      bokeh: ['#7ee35f', '#b8f58a', '#3fae3a', '#e2ffc0'],
      bokehA: 0.34,
      sparkle: '#fff4c8',
      beams: 'rgba(200, 255, 170, 0.12)',
      lights: true,
      baubles: ['gold', 'red', 'gold', 'red', 'green'],
      decor: 'pine',
      snow: false,
      spiral: null,
      sun: false
    },
    light: {
      base: ['#2f8a2c', '#9ad877'],
      glow: { x: 0.64, y: 0.4, r: 0.66, color: 'rgba(244, 255, 226, 0.7)' },
      glow2: { x: 0.15, y: 0.85, r: 0.5, color: 'rgba(120, 210, 90, 0.4)' },
      bokeh: ['#e9ffd6', '#c6f5a0', '#ffffff', '#9fe07a'],
      bokehA: 0.4,
      sparkle: '#fffbe6',
      beams: 'rgba(255, 255, 240, 0.16)',
      lights: true,
      baubles: ['gold', 'red', 'gold', 'red', 'green'],
      decor: 'pine',
      snow: false,
      spiral: null,
      sun: false
    }
  },
  gold: {
    dark: {
      base: ['#070401', '#3b2508'],
      glow: { x: 0.74, y: 0.36, r: 0.72, color: 'rgba(255, 210, 110, 0.72)' },
      bokeh: ['#ffd36a', '#fff0b8', '#e8a93a', '#ffe7a0'],
      bokehA: 0.36,
      sparkle: '#fff1c0',
      beams: 'rgba(255, 228, 150, 0.1)',
      lights: false,
      baubles: ['green', 'gold', 'red', 'gold', 'green'],
      decor: 'gold',
      snow: false,
      spiral: '#ffe8a8',
      sun: false
    },
    light: {
      base: ['#b07a22', '#f2cf80'],
      glow: { x: 0.7, y: 0.36, r: 0.72, color: 'rgba(255, 249, 226, 0.8)' },
      bokeh: ['#fff6d8', '#ffe39a', '#ffffff', '#f5c860'],
      bokehA: 0.4,
      sparkle: '#fffdf0',
      beams: 'rgba(255, 250, 230, 0.14)',
      lights: false,
      baubles: ['green', 'gold', 'red', 'gold', 'green'],
      decor: 'gold',
      snow: false,
      spiral: '#fff6d0',
      sun: false
    }
  },
  snow: {
    dark: {
      base: ['#04113a', '#1a4cb4'],
      vertical: true,
      glow: { x: 0.62, y: 0.36, r: 0.6, color: 'rgba(96, 170, 255, 0.5)' },
      bokeh: ['#9fd0ff', '#d8ecff', '#5aa9ff', '#ffffff'],
      bokehA: 0.3,
      sparkle: '#e6f4ff',
      beams: null,
      lights: false,
      baubles: ['ice', 'silver', 'ice'],
      decor: 'snow',
      snow: true,
      spiral: '#cfe8ff',
      sun: false,
      hill: ['#c9dbf4', '#5f82c4'],
      snowmanShade: '#7d9bd8'
    },
    light: {
      base: ['#3d8fd6', '#d8eefc'],
      vertical: true,
      glow: { x: 0.74, y: 0.1, r: 0.55, color: 'rgba(255, 255, 255, 0.85)' },
      bokeh: ['#ffffff', '#e2f3ff', '#bfe2ff'],
      bokehA: 0.32,
      sparkle: '#ffffff',
      beams: null,
      lights: false,
      baubles: ['silver', 'ice', 'silver'],
      decor: 'snow',
      snow: true,
      spiral: null,
      sun: true,
      hill: ['#ffffff', '#c3daf0'],
      snowmanShade: '#c9dcef'
    }
  }
};

const BAUBLE: Record<TBaubleKind, { stops: [string, string, string]; deco: 'swirl' | 'glitter' | 'flower' | 'bands' | 'flake' }> = {
  red: { stops: ['#ff6a52', '#c8140e', '#4a0303'], deco: 'swirl' },
  gold: { stops: ['#fff0a8', '#e2a82c', '#5e3a04'], deco: 'glitter' },
  green: { stops: ['#9cf08e', '#2f9e3a', '#083a12'], deco: 'flower' },
  silver: { stops: ['#ffffff', '#c6d4e2', '#4f6276'], deco: 'bands' },
  ice: { stops: ['#e4f7ff', '#4fa8ec', '#0b2f6a'], deco: 'flake' }
};

const rng = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
const mk = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
};

// ---- sprites --------------------------------------------------------------------------------

const spriteCache = new Map<string, HTMLCanvasElement>();
const cached = (key: string, make: () => HTMLCanvasElement) => {
  let c = spriteCache.get(key);
  if (!c) spriteCache.set(key, (c = make()));
  return c;
};

/** a bokeh disc: soft, its rim a little brighter */
const bokehSprite = (color: string) =>
  cached(`bokeh${color}`, () => {
    const c = mk(128, 128);
    const x = c.getContext('2d')!;
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 63);
    g.addColorStop(0, `${color}88`);
    g.addColorStop(0.78, `${color}aa`);
    g.addColorStop(0.92, `${color}dd`);
    g.addColorStop(1, `${color}00`);
    x.fillStyle = g;
    x.beginPath();
    x.arc(64, 64, 63, 0, Math.PI * 2);
    x.fill();
    return c;
  });

/** a sparkle: a four-pointed star of light with a soft glow and two thin diagonals */
const sparkleSprite = (color: string) =>
  cached(`sparkle${color}`, () => {
    const c = mk(96, 96);
    const x = c.getContext('2d')!;
    const glow = x.createRadialGradient(48, 48, 0, 48, 48, 22);
    glow.addColorStop(0, `${color}ff`);
    glow.addColorStop(0.25, `${color}aa`);
    glow.addColorStop(1, `${color}00`);
    x.fillStyle = glow;
    x.fillRect(0, 0, 96, 96);
    const ray = (angle: number, len: number, width: number, alpha: number) => {
      x.save();
      x.translate(48, 48);
      x.rotate(angle);
      const g = x.createLinearGradient(-len, 0, len, 0);
      g.addColorStop(0, `${color}00`);
      g.addColorStop(0.5, color);
      g.addColorStop(1, `${color}00`);
      x.globalAlpha = alpha;
      x.fillStyle = g;
      x.beginPath();
      x.moveTo(-len, 0);
      x.lineTo(0, -width);
      x.lineTo(len, 0);
      x.lineTo(0, width);
      x.closePath();
      x.fill();
      x.restore();
    };
    ray(0, 47, 2.4, 1);
    ray(Math.PI / 2, 47, 2.4, 1);
    ray(Math.PI / 4, 22, 1.2, 0.6);
    ray(-Math.PI / 4, 22, 1.2, 0.6);
    x.fillStyle = '#ffffff';
    x.beginPath();
    x.arc(48, 48, 3, 0, Math.PI * 2);
    x.fill();
    return c;
  });

/** a beam of light: a horizontal profile, one pixel tall, stretched over the window's height */
const beamSprite = (color: string) =>
  cached(`beam${color}`, () => {
    const c = mk(64, 1);
    const x = c.getContext('2d')!;
    const g = x.createLinearGradient(0, 0, 64, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.5, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 64, 1);
    return c;
  });

/** a small soft dot of light (the spiral trees, the strings of lights) */
const dotSprite = (color: string) =>
  cached(`dot${color}`, () => {
    const c = mk(16, 16);
    const x = c.getContext('2d')!;
    const g = x.createRadialGradient(8, 8, 0, 8, 8, 8);
    g.addColorStop(0, color);
    g.addColorStop(0.45, color);
    g.addColorStop(0.62, `${color}88`);
    g.addColorStop(1, `${color}00`);
    x.fillStyle = g;
    x.fillRect(0, 0, 16, 16);
    return c;
  });

/** a lens flare's ring of light */
const flareSprite = (rgb: string) =>
  cached(`flare${rgb}`, () => {
    const c = mk(64, 64);
    const x = c.getContext('2d')!;
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, `rgba(${rgb},0.18)`);
    g.addColorStop(0.7, `rgba(${rgb},0.1)`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    x.fillStyle = g;
    x.fillRect(0, 0, 64, 64);
    return c;
  });

/** a snow crystal: six arms with side branches */
const flakeSprite = (color: string) =>
  cached(`flake${color}`, () => {
    const c = mk(64, 64);
    const x = c.getContext('2d')!;
    x.translate(32, 32);
    x.strokeStyle = color;
    x.lineCap = 'round';
    x.lineWidth = 2.6;
    for (let i = 0; i < 6; i++) {
      x.save();
      x.rotate((i * Math.PI) / 3);
      x.beginPath();
      x.moveTo(0, 0);
      x.lineTo(0, -28);
      for (const [y, l] of [
        [-11, 7],
        [-19, 6],
        [-25, 3.5]
      ]) {
        x.moveTo(0, y);
        x.lineTo(-l, y - l * 0.8);
        x.moveTo(0, y);
        x.lineTo(l, y - l * 0.8);
      }
      x.stroke();
      x.restore();
    }
    return c;
  });

/** a glass bauble with its decoration, gloss, gold cap and loop; the string ties on at (w/2, 0) */
const baubleSprite = (kind: TBaubleKind, R: number, seed: number) =>
  cached(`bauble${kind}${Math.round(R)}${seed}`, () => {
    const capH = R * 0.24;
    const loop = R * 0.12;
    const w = R * 2 + 8;
    const h = R * 2 + capH + loop * 2 + 8;
    const c = mk(w, h);
    const x = c.getContext('2d')!;
    const cx = w / 2;
    const cy = loop * 2 + capH * 0.8 + R + 2;
    const k = BAUBLE[kind];
    const r = rng(seed);
    // the glass
    const body = x.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.06, cx, cy, R);
    body.addColorStop(0, k.stops[0]);
    body.addColorStop(0.5, k.stops[1]);
    body.addColorStop(1, k.stops[2]);
    x.fillStyle = body;
    x.beginPath();
    x.arc(cx, cy, R, 0, Math.PI * 2);
    x.fill();
    // the decoration, inside the glass
    x.save();
    x.beginPath();
    x.arc(cx, cy, R - 0.5, 0, Math.PI * 2);
    x.clip();
    const goldLine = (width: number) => {
      const g = x.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
      g.addColorStop(0, '#fff2b0');
      g.addColorStop(0.5, '#e6b23c');
      g.addColorStop(1, '#a8741a');
      x.strokeStyle = g;
      x.lineWidth = width;
      x.lineCap = 'round';
    };
    const star = (sx: number, sy: number, s: number) => {
      x.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 ? s * 0.45 : s;
        x.lineTo(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr);
      }
      x.closePath();
      x.fillStyle = '#ffe6a0';
      x.fill();
    };
    if (k.deco === 'swirl') {
      goldLine(Math.max(1.2, R * 0.035));
      for (let i = 0; i < 6; i++) {
        const y0 = cy - R * 0.7 + i * R * 0.28;
        x.beginPath();
        x.moveTo(cx - R * 1.1, y0 + R * 0.5);
        x.bezierCurveTo(cx - R * 0.3, y0 - R * 0.3, cx + R * 0.2, y0 + R * 0.4, cx + R * 1.1, y0 - R * 0.35);
        x.stroke();
      }
      for (let i = 0; i < 5; i++) star(cx + (r() - 0.5) * R * 1.3, cy + (r() - 0.6) * R * 1.2, R * (0.07 + r() * 0.06));
    } else if (k.deco === 'glitter') {
      for (let i = 0; i < R * 9; i++) {
        const a = r() * Math.PI * 2;
        const d = Math.sqrt(r()) * R;
        x.fillStyle = `rgba(255, ${235 + r() * 20}, ${180 + r() * 60}, ${0.25 + r() * 0.6})`;
        x.fillRect(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 1 + r() * 1.4, 1 + r() * 1.4);
      }
      for (let i = 0; i < 4; i++) star(cx + (r() - 0.5) * R * 1.2, cy + (r() - 0.5) * R * 1.2, R * (0.06 + r() * 0.05));
    } else if (k.deco === 'flower') {
      goldLine(Math.max(1.2, R * 0.04));
      const fx = cx - R * 0.25;
      const fy = cy - R * 0.25;
      for (let i = 0; i < 5; i++) {
        x.save();
        x.translate(fx, fy);
        x.rotate((i * 2 * Math.PI) / 5);
        x.beginPath();
        x.ellipse(0, -R * 0.2, R * 0.1, R * 0.2, 0, 0, Math.PI * 2);
        x.stroke();
        x.restore();
      }
      x.beginPath();
      for (let a = 0; a < Math.PI * 4; a += 0.2) x.lineTo(cx - R * 0.45 + Math.cos(a) * a * R * 0.02, cy + R * 0.4 + Math.sin(a) * a * R * 0.02);
      x.stroke();
      x.beginPath();
      x.moveTo(cx + R * 0.15, cy + R * 0.7);
      x.quadraticCurveTo(cx + R * 0.7, cy + R * 0.1, cx + R * 0.45, cy - R * 0.45);
      x.quadraticCurveTo(cx + R * 0.15, cy + R * 0.1, cx + R * 0.15, cy + R * 0.7);
      x.stroke();
    } else if (k.deco === 'bands') {
      for (const [dy, a] of [
        [-0.25, 0.28],
        [0.18, 0.2]
      ] as const) {
        x.fillStyle = `rgba(80, 100, 130, ${a})`;
        x.beginPath();
        x.moveTo(cx - R, cy + dy * R);
        for (let t = 0; t <= 1; t += 0.05) x.lineTo(cx - R + t * 2 * R, cy + dy * R + Math.sin(t * Math.PI * 3) * R * 0.08);
        for (let t = 1; t >= 0; t -= 0.05) x.lineTo(cx - R + t * 2 * R, cy + dy * R + R * 0.16 + Math.sin(t * Math.PI * 3 + 0.6) * R * 0.08);
        x.closePath();
        x.fill();
      }
      x.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      x.lineWidth = Math.max(1, R * 0.03);
      x.beginPath();
      for (let t = 0; t <= 1; t += 0.05) x.lineTo(cx - R + t * 2 * R, cy + R * 0.02 + Math.sin(t * Math.PI * 4) * R * 0.06);
      x.stroke();
    } else {
      const s = R * 0.9;
      x.save();
      x.globalAlpha = 0.85;
      x.drawImage(flakeSprite('#ffffff'), cx - s / 2 - R * 0.08, cy - s / 2 + R * 0.05, s, s);
      x.restore();
    }
    // the glass's own shadow at the far rim
    const shade = x.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.5, cx, cy, R * 1.05);
    shade.addColorStop(0, 'rgba(0, 0, 0, 0)');
    shade.addColorStop(1, 'rgba(0, 0, 0, 0.42)');
    x.fillStyle = shade;
    x.fillRect(cx - R, cy - R, R * 2, R * 2);
    x.restore();
    // gloss: a soft window reflection at the top left, a hard spark in it, a rim of light below
    const gloss = x.createRadialGradient(cx - R * 0.38, cy - R * 0.45, 0, cx - R * 0.38, cy - R * 0.45, R * 0.55);
    gloss.addColorStop(0, 'rgba(255, 255, 255, 0.85)');
    gloss.addColorStop(0.45, 'rgba(255, 255, 255, 0.25)');
    gloss.addColorStop(1, 'rgba(255, 255, 255, 0)');
    x.fillStyle = gloss;
    x.beginPath();
    x.ellipse(cx - R * 0.38, cy - R * 0.45, R * 0.5, R * 0.36, -0.6, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = 'rgba(255, 255, 255, 0.95)';
    x.beginPath();
    x.ellipse(cx - R * 0.45, cy - R * 0.5, R * 0.08, R * 0.05, -0.6, 0, Math.PI * 2);
    x.fill();
    x.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    x.lineWidth = Math.max(1, R * 0.04);
    x.beginPath();
    x.arc(cx, cy, R * 0.88, Math.PI * 0.15, Math.PI * 0.75);
    x.stroke();
    // the cap: ribbed gold, a crown at its lower edge, the loop above it
    const capW = R * 0.36;
    const capY = cy - R - capH * 0.6;
    const cap = x.createLinearGradient(cx - capW / 2, 0, cx + capW / 2, 0);
    cap.addColorStop(0, '#6e4a0c');
    cap.addColorStop(0.3, '#ffe9a0');
    cap.addColorStop(0.55, '#b88420');
    cap.addColorStop(0.8, '#ffe39a');
    cap.addColorStop(1, '#6e4a0c');
    x.fillStyle = cap;
    x.beginPath();
    x.moveTo(cx - capW / 2, capY);
    x.lineTo(cx + capW / 2, capY);
    x.lineTo(cx + capW / 2, capY + capH);
    for (let i = 4; i >= 0; i--) x.lineTo(cx - capW / 2 + (i * capW) / 4, capY + capH + (i % 2 ? capH * 0.3 : 0));
    x.closePath();
    x.fill();
    x.strokeStyle = 'rgba(80, 50, 5, 0.5)';
    x.lineWidth = 1;
    for (let i = 1; i < 5; i++) {
      x.beginPath();
      x.moveTo(cx - capW / 2 + (i * capW) / 5, capY + 1);
      x.lineTo(cx - capW / 2 + (i * capW) / 5, capY + capH - 1);
      x.stroke();
    }
    x.strokeStyle = '#d8a83a';
    x.lineWidth = Math.max(1.2, R * 0.04);
    x.beginPath();
    x.ellipse(cx, capY - loop * 0.8, loop * 0.7, loop, 0, 0, Math.PI * 2);
    x.stroke();
    return c;
  });

// ---- the scene --------------------------------------------------------------------------------

type TBauble = { kind: TBaubleKind; ax: number; len: number; R: number; seed: number; amp: number; period: number; phase: number; d: number; v: number };
type TBokeh = { x: number; y: number; r: number; color: string; a: number; vx: number; vy: number; ph: number };
type TSparkle = { x: number; y: number; s: number; sp: number; ph: number; vy: number };
type TFlake = { x: number; y: number; r: number; v: number; sway: number; ph: number; crystal: boolean; rot: number };

export const createXmasScene = (canvas: HTMLCanvasElement, o: TXmasOptions): TXmasScene => {
  const g = canvas.getContext('2d', { alpha: false })!;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  let W = 0;
  let H = 0;
  let res = 1;
  let short = false;
  let key = '';
  let cfg: TCfg = CFG.classic.dark;
  let still: HTMLCanvasElement | null = null;
  // the sun's rays, drawn once at a quarter of the size (they are soft) and turned as a whole
  let rays: HTMLCanvasElement | null = null;
  // the gold ribbons' fills, made once per size
  let ribbonFills: CanvasGradient[] = [];
  let baubles: TBauble[] = [];
  let bokeh: TBokeh[] = [];
  let sparkles: TSparkle[] = [];
  let flakes: TFlake[] = [];
  let resting = false;
  let stopped = false;
  let raf = 0;
  let last = performance.now();
  let T = 0;
  let px = -1e4;
  let py = -1e4;
  let pt = 0;

  const paletteNow = (): TXmasPalette => {
    const p = o.palette();
    return p === 'gold' || p === 'snow' ? p : 'classic';
  };

  const hillY = (x: number) => H * 0.8 - Math.sin((x / W) * Math.PI * 1.2 + 0.4) * H * 0.06 - Math.sin((x / W) * Math.PI * 3.1 + 1.3) * H * 0.02;

  // ---- the still layer: the glow, and the scenery that does not move -----------------------------
  const buildStill = () => {
    const c = mk(W, H);
    const x = c.getContext('2d')!;
    const base = cfg.vertical ? x.createLinearGradient(0, 0, 0, H) : x.createLinearGradient(0, 0, W, H);
    base.addColorStop(0, cfg.base[0]);
    base.addColorStop(1, cfg.base[1]);
    x.fillStyle = base;
    x.fillRect(0, 0, W, H);
    const glow = (gl: TCfg['glow']) => {
      const R = gl.r * Math.max(W, H);
      const gg = x.createRadialGradient(gl.x * W, gl.y * H, 0, gl.x * W, gl.y * H, R);
      gg.addColorStop(0, gl.color);
      gg.addColorStop(1, gl.color.replace(/[\d.]+\)$/, '0)'));
      x.fillStyle = gg;
      x.fillRect(0, 0, W, H);
    };
    glow(cfg.glow);
    if (cfg.glow2) glow(cfg.glow2);
    if (short) return c;
    // the sun's rings of light, arcs across the upper left (the sun itself turns in the frame)
    if (cfg.sun) {
      x.globalAlpha = 0.25;
      x.strokeStyle = '#ffffff';
      x.lineWidth = 1.2 * res;
      for (let i = 0; i < 16; i++) {
        x.beginPath();
        x.arc(W * 0.02, -H * 0.15, H * (0.25 + i * 0.022), 0.05, Math.PI * 0.45);
        x.stroke();
      }
      x.globalAlpha = 1;
    }

    const r = rng(17);
    if (cfg.decor === 'pine') {
      // pine branches reaching in from the right: a stem, needles both ways, lighter tips
      const branches: [number, number, number, number][] = [
        [W + 20, H * 0.02, W * 0.8, H * 0.18],
        [W + 30, H * 0.22, W * 0.76, H * 0.3],
        [W + 20, H * 0.46, W * 0.79, H * 0.5],
        [W + 30, H * 0.68, W * 0.77, H * 0.72],
        [W + 20, H * 0.9, W * 0.82, H * 0.88],
        [W * 0.96, -20, W * 0.86, H * 0.08]
      ];
      const sc = Math.min(W, H) / 900 + 0.4;
      for (const [x0, y0, x1, y1] of branches) {
        const steps = 90;
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const bx = x0 + (x1 - x0) * t;
          const by = y0 + (y1 - y0) * t + Math.sin(t * Math.PI) * 18 * sc;
          const ang = Math.atan2(y1 - y0, x1 - x0);
          for (let n = 0; n < 7; n++) {
            const side = n % 2 ? 1 : -1;
            const a = ang + side * (0.7 + r() * 0.6) + (r() - 0.5) * 0.3;
            const len = (24 + r() * 26) * sc * (1 - t * 0.35);
            const shade = r();
            x.strokeStyle = shade > 0.8 ? '#4fbf4a' : shade > 0.45 ? '#1f7a2a' : '#0c4518';
            x.lineWidth = 1.3 * sc;
            x.beginPath();
            x.moveTo(bx, by);
            x.lineTo(bx + Math.cos(a) * len, by + Math.sin(a) * len);
            x.stroke();
          }
        }
        x.strokeStyle = '#3a2410';
        x.lineWidth = 3 * sc;
        x.beginPath();
        x.moveTo(x0, y0);
        x.quadraticCurveTo((x0 + x1) / 2, (y0 + y1) / 2 + 18 * sc, x1, y1);
        x.stroke();
      }
    } else if (cfg.decor === 'snow') {
      // two drifts of snow, the near one brighter
      for (const [k, off, a] of [
        [0.92, -H * 0.05, 0.75],
        [1, 0, 1]
      ] as const) {
        const hg = x.createLinearGradient(0, H * 0.7, 0, H);
        hg.addColorStop(0, cfg.hill![0]);
        hg.addColorStop(1, cfg.hill![1]);
        x.globalAlpha = a;
        x.fillStyle = hg;
        x.beginPath();
        x.moveTo(0, H);
        for (let xx = 0; xx <= W; xx += 8) x.lineTo(xx, hillY(xx * k + W * (1 - k)) + off);
        x.lineTo(W, H);
        x.closePath();
        x.fill();
      }
      x.globalAlpha = 1;
      // glints in the snow
      for (let i = 0; i < (W * H) / 9000; i++) {
        const sx = r() * W;
        const sy = hillY(sx) + r() * (H - hillY(sx));
        x.fillStyle = `rgba(255, 255, 255, ${0.3 + r() * 0.6})`;
        x.fillRect(sx, sy, 1.5, 1.5);
      }
      // the snowmen, standing on the near drift
      const S = Math.min(H * 0.32, W * 0.22, 320);
      snowman(x, W * 0.5, hillY(W * 0.5) + S * 0.05, S, cfg.snowmanShade!, false);
      snowman(x, W * 0.66, hillY(W * 0.66) + S * 0.04, S * 0.72, cfg.snowmanShade!, true);
    }
    return c;
  };

  const snowman = (x: CanvasRenderingContext2D, cx: number, ground: number, S: number, shade: string, small: boolean) => {
    const ball = (bx: number, by: number, br: number) => {
      const gg = x.createRadialGradient(bx - br * 0.35, by - br * 0.4, br * 0.1, bx, by, br);
      gg.addColorStop(0, '#ffffff');
      gg.addColorStop(0.65, '#f4f9ff');
      gg.addColorStop(1, shade);
      x.fillStyle = gg;
      x.beginPath();
      x.arc(bx, by, br, 0, Math.PI * 2);
      x.fill();
    };
    const r1 = S * 0.26;
    const r2 = S * 0.19;
    const r3 = S * 0.14;
    const y1 = ground - r1 * 0.85;
    const y2 = y1 - r1 - r2 * 0.7;
    const y3 = y2 - r2 - r3 * 0.7;
    // arms: twigs, behind the body
    x.strokeStyle = '#5b3a1c';
    x.lineCap = 'round';
    x.lineWidth = Math.max(2, S * 0.018);
    for (const side of [-1, 1]) {
      x.beginPath();
      x.moveTo(cx + side * r2 * 0.6, y2);
      x.lineTo(cx + side * r2 * 2.1, y2 - r2 * (side < 0 ? 0.7 : 0.9));
      x.moveTo(cx + side * r2 * 1.6, y2 - r2 * 0.55);
      x.lineTo(cx + side * r2 * 1.9, y2 - r2 * 1.1);
      x.stroke();
    }
    ball(cx, y1, r1);
    ball(cx, y2, r2);
    ball(cx, y3, r3);
    // coal buttons, eyes, a smile of coal; a carrot
    x.fillStyle = '#1a1a1e';
    for (const k of [-0.35, 0.05, 0.45]) {
      x.beginPath();
      x.arc(cx, y2 + k * r2, r2 * 0.085, 0, Math.PI * 2);
      x.fill();
    }
    for (const side of [-1, 1]) {
      x.beginPath();
      x.arc(cx + side * r3 * 0.36, y3 - r3 * 0.18, r3 * 0.09, 0, Math.PI * 2);
      x.fill();
    }
    for (let i = 0; i < 6; i++) {
      const a = Math.PI * (0.2 + (i / 5) * 0.6);
      x.beginPath();
      x.arc(cx + Math.cos(a) * r3 * 0.5, y3 + r3 * 0.12 + Math.sin(a) * r3 * 0.32, r3 * 0.05, 0, Math.PI * 2);
      x.fill();
    }
    const cg = x.createLinearGradient(cx, y3, cx + r3 * 0.9, y3);
    cg.addColorStop(0, '#ff8a24');
    cg.addColorStop(1, '#d4520a');
    x.fillStyle = cg;
    x.beginPath();
    x.moveTo(cx - r3 * 0.02, y3 - r3 * 0.06);
    x.lineTo(cx + r3 * 0.85, y3 + r3 * 0.08);
    x.lineTo(cx - r3 * 0.02, y3 + r3 * 0.16);
    x.closePath();
    x.fill();
    // the scarf: knitted blue with stripes, one end hanging
    const sg = x.createLinearGradient(cx - r3, 0, cx + r3, 0);
    sg.addColorStop(0, small ? '#6d8fb3' : '#4f86b8');
    sg.addColorStop(0.5, small ? '#9ab6d4' : '#7fb0dd');
    sg.addColorStop(1, small ? '#5a7a9c' : '#3c6e9e');
    x.fillStyle = sg;
    const sy = y3 + r3 * 0.82;
    x.beginPath();
    x.ellipse(cx, sy, r3 * 1.02, r3 * 0.24, 0, 0, Math.PI * 2);
    x.fill();
    x.beginPath();
    x.moveTo(cx + r3 * 0.25, sy);
    x.lineTo(cx + r3 * 0.6, sy + r3 * 1.1);
    x.lineTo(cx + r3 * 0.25, sy + r3 * 1.15);
    x.lineTo(cx, sy);
    x.closePath();
    x.fill();
    x.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    x.lineWidth = Math.max(1, r3 * 0.06);
    for (const k of [0.45, 0.75]) {
      x.beginPath();
      x.moveTo(cx + r3 * (0.13 + k * 0.3), sy + r3 * k * 1.05);
      x.lineTo(cx + r3 * (0.38 + k * 0.33), sy + r3 * k * 1.05);
      x.stroke();
    }
    // the top hat: a brim, a crown, a band
    const hw = r3 * (small ? 1.1 : 1.2);
    const hh = r3 * (small ? 0.9 : 1.15);
    const hy = y3 - r3 * 0.72;
    const hg = x.createLinearGradient(cx - hw, 0, cx + hw, 0);
    hg.addColorStop(0, '#2a2c30');
    hg.addColorStop(0.35, '#6a6e76');
    hg.addColorStop(1, '#1e2024');
    x.fillStyle = hg;
    x.beginPath();
    x.ellipse(cx, hy, hw, r3 * 0.16, -0.08, 0, Math.PI * 2);
    x.fill();
    x.fillRect(cx - hw * 0.62, hy - hh, hw * 1.24, hh);
    x.beginPath();
    x.ellipse(cx, hy - hh, hw * 0.62, r3 * 0.1, 0, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = small ? '#8aa8c6' : '#5a7a9a';
    x.fillRect(cx - hw * 0.62, hy - hh * 0.32, hw * 1.24, hh * 0.18);
  };

  // ---- size, palette, everything that moves ------------------------------------------------------
  const fit = () => {
    // (all soft light: at most 1.25 device pixels per css pixel, and at most ~2.4 million in all)
    res = Math.min(window.devicePixelRatio || 1, 1.25, Math.sqrt(2.4e6 / Math.max(1, window.innerWidth * window.innerHeight)));
    W = Math.max(1, Math.round(window.innerWidth * res));
    H = Math.max(1, Math.round(window.innerHeight * res));
    short = window.innerHeight < 200;
    canvas.width = W;
    canvas.height = H;
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    key = '';
  };

  const setup = () => {
    const pal = paletteNow();
    const dark = o.dark();
    const want = `${pal}:${dark}:${W}x${H}`;
    if (want === key) return;
    const fresh = !key.startsWith(`${pal}:`) || !key.endsWith(`${W}x${H}`);
    key = want;
    cfg = CFG[pal][dark ? 'dark' : 'light'];
    still = buildStill();
    rays = null;
    if (cfg.sun && !short) {
      const L = Math.max(W, H) * 0.7;
      const q = Math.ceil(L / 4);
      rays = mk(q * 2, q * 2);
      const x = rays.getContext('2d')!;
      x.translate(q, q);
      for (let i = 0; i < 14; i++) {
        x.rotate((Math.PI * 2) / 14);
        const rg = x.createLinearGradient(0, 0, q, 0);
        rg.addColorStop(0, 'rgba(255,255,255,0.35)');
        rg.addColorStop(1, 'rgba(255,255,255,0)');
        x.globalAlpha = i % 2 ? 0.55 : 1;
        x.fillStyle = rg;
        x.beginPath();
        x.moveTo(0, 0);
        x.lineTo(q, -q * 0.06);
        x.lineTo(q, q * 0.06);
        x.closePath();
        x.fill();
      }
    }
    ribbonFills = [];
    if (cfg.decor === 'gold') {
      for (let i = 0; i < 3; i++) {
        const y0 = H * (0.78 + i * 0.05);
        const amp = H * (0.04 + i * 0.012);
        const thick = H * (0.012 + i * 0.01);
        const rg = g.createLinearGradient(0, y0 - amp, 0, y0 + amp + thick);
        rg.addColorStop(0, '#fff6d8');
        rg.addColorStop(1, '#e0a83a');
        ribbonFills.push(rg);
      }
    }
    const r = rng(29);
    const area = (W * H) / (res * res);
    bokeh = [];
    for (let i = 0; i < Math.min(46, Math.round(area / 30000) + 6); i++) {
      bokeh.push({
        x: r() * W,
        y: r() * H,
        r: (short ? 6 + r() * 14 : 14 + r() * 70) * res,
        color: cfg.bokeh[i % cfg.bokeh.length],
        a: cfg.bokehA * (0.4 + r() * 0.8),
        vx: (r() - 0.5) * 6 * res,
        vy: -(3 + r() * 9) * res,
        ph: r() * 10
      });
    }
    sparkles = [];
    const nS = Math.min(110, Math.round(area / 14000) + 8);
    for (let i = 0; i < nS; i++) {
      // most of them where the scenery is: the right side (classic, gold), or anywhere
      const right = cfg.decor !== 'snow' && r() < 0.6;
      sparkles.push({ x: (right ? 0.6 + r() * 0.4 : r()) * W, y: r() * H, s: (6 + r() * (short ? 10 : 22)) * res, sp: 0.6 + r() * 1.8, ph: r() * 10, vy: -(1 + r() * 4) * res });
    }
    flakes = [];
    if (cfg.snow) {
      for (let i = 0; i < Math.min(220, Math.round(area / 7000) + 10); i++) {
        flakes.push({ x: r() * W, y: r() * H, r: (0.8 + r() * 2.4) * res, v: (18 + r() * 40) * res, sway: (6 + r() * 16) * res, ph: r() * 10, crystal: r() < 0.08, rot: r() * 6 });
      }
    }
    // the baubles: on gold strings from the top edge (none in a short window, the bar)
    if (fresh) {
      baubles = [];
      if (!short) {
        const hang = o.hang ?? [0.62, 0.7, 0.79, 0.88, 0.95];
        const between = (range: [number, number]) => (range[0] + r() * (range[1] - range[0])) * res;
        hang.forEach((ax, i) => {
          const kind = cfg.baubles[i % cfg.baubles.length];
          const Rr = o.size ? between(o.size) : (32 + r() * 26) * res * Math.min(1.4, Math.max(0.7, H / res / 900));
          const len = o.len ? between(o.len) : H * (0.12 + r() * 0.26);
          baubles.push({ kind, ax, len: len | 0, R: Rr, seed: 100 + i, amp: 0.025 + r() * 0.03, period: 3.2 + r() * 2.2, phase: r() * 6, d: 0, v: 0 });
        });
      }
    }
  };

  // ---- one frame ----------------------------------------------------------------------------------
  let costSum = 0;
  let costN = 0;
  const draw = () => {
    const t0 = performance.now();
    drawFrame();
    costSum += performance.now() - t0;
    if (++costN > 120) {
      costSum /= 2;
      costN /= 2;
    }
  };
  const drawFrame = () => {
    setup();
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.drawImage(still!, 0, 0);
    const t = T;

    // soft beams of light, slowly breathing
    if (cfg.beams && !short) {
      g.globalCompositeOperation = 'screen';
      const beam = beamSprite(cfg.beams);
      for (let i = 0; i < 4; i++) {
        const bx = W * (0.3 + i * 0.17) + Math.sin(t * 0.07 + i) * W * 0.03;
        const bw = W * (0.04 + (i % 2) * 0.05);
        g.globalAlpha = 0.6 + 0.4 * Math.sin(t * 0.3 + i * 1.7);
        g.drawImage(beam, bx - bw, 0, bw * 2, H);
      }
    }

    // bokeh drifting up, each breathing a little
    g.globalCompositeOperation = 'screen';
    for (const b of bokeh) {
      g.globalAlpha = Math.max(0, b.a * (0.75 + 0.25 * Math.sin(t * 0.5 + b.ph)));
      g.drawImage(bokehSprite(b.color), b.x - b.r, b.y - b.r, b.r * 2, b.r * 2);
    }

    // the gold palette: ribbons of light along the bottom, spiral trees of sparkles
    if (cfg.decor === 'gold' && !short) {
      for (let i = 0; i < 3; i++) {
        const y0 = H * (0.78 + i * 0.05);
        const amp = H * (0.04 + i * 0.012);
        const thick = H * (0.012 + i * 0.01);
        g.globalAlpha = 0.5 - i * 0.1;
        g.fillStyle = ribbonFills[i];
        g.beginPath();
        for (let xx = 0; xx <= W; xx += 12) g.lineTo(xx, y0 + Math.sin(xx / W * Math.PI * 2 + t * 0.25 + i) * amp);
        for (let xx = W; xx >= 0; xx -= 12) g.lineTo(xx, y0 + thick * (0.3 + 0.7 * (xx / W)) + Math.sin(xx / W * Math.PI * 2 + t * 0.25 + i + 0.35) * amp);
        g.closePath();
        g.fill();
      }
    }
    if (cfg.spiral && !short) {
      const trees = cfg.decor === 'gold' ? [[0.16, 0.86, 0.34], [0.44, 0.9, 0.22]] : [[0.8, 0.8, 0.55]];
      for (const [tx, tb, th] of trees) spiral(tx * W, tb * H, th * H, t);
    }

    // strings of little lights down the sides, a light running along them
    if (cfg.lights && !short) {
      // (three passes, one per brightness: one path each instead of one per light)
      g.fillStyle = '#fffbe8';
      const step = Math.floor(t * 5);
      for (const [level, alpha, rr] of [
        [0, 1, 2.6],
        [1, 0.7, 1.8],
        [2, 0.35, 1.8]
      ] as const) {
        g.globalAlpha = alpha;
        g.beginPath();
        for (const lx of [W * 0.025, W * 0.975]) {
          for (let i = 0, y = 6 * res; y < H; i++, y += 11 * res) {
            const on = (i + step) % 7;
            if (Math.min(on, 2) !== level) continue;
            g.moveTo(lx + rr * res, y);
            g.arc(lx, y, rr * res, 0, Math.PI * 2);
          }
        }
        g.fill();
      }
    }

    // the sun (snow, day): turning rays, a lens flare toward the middle
    if (cfg.sun && !short) {
      const sx = W * 0.74;
      const sy = H * 0.08;
      if (rays) {
        g.save();
        g.translate(sx, sy);
        g.rotate(t * 0.02);
        g.globalAlpha = 0.8 + 0.2 * Math.sin(t * 0.4);
        g.drawImage(rays, -rays.width * 2, -rays.height * 2, rays.width * 4, rays.height * 4);
        g.restore();
      }
      const fx = W * 0.5 - sx;
      const fy = H * 0.55 - sy;
      g.globalAlpha = 1;
      for (const [k, rr, col] of [
        [0.35, 26, '255,255,255'],
        [0.6, 14, '180,220,255'],
        [0.85, 40, '200,235,255'],
        [1.15, 18, '255,240,200']
      ] as const) {
        const R = rr * res;
        g.drawImage(flareSprite(col), sx + fx * k - R, sy + fy * k - R, R * 2, R * 2);
      }
    }

    // the baubles, swaying on their strings
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    if (baubles.length) {
      g.strokeStyle = 'rgba(214, 170, 70, 0.9)';
      g.lineWidth = 1.4 * res;
      g.beginPath();
      for (const b of baubles) {
        const ang = b.amp * Math.sin((t * Math.PI * 2) / b.period + b.phase) + b.d;
        g.moveTo(b.ax * W, -2);
        g.lineTo(b.ax * W + Math.sin(ang) * b.len, Math.cos(ang) * b.len);
      }
      g.stroke();
    }
    for (const b of baubles) {
      const ang = b.amp * Math.sin((t * Math.PI * 2) / b.period + b.phase) + b.d;
      const sprite = baubleSprite(b.kind, b.R, b.seed);
      g.setTransform(Math.cos(ang), -Math.sin(ang), Math.sin(ang), Math.cos(ang), b.ax * W + Math.sin(ang) * b.len, Math.cos(ang) * b.len);
      g.drawImage(sprite, -sprite.width / 2, 0);
    }
    g.setTransform(1, 0, 0, 1, 0, 0);

    // falling snow
    if (flakes.length) {
      // (the round flakes in one path; the few crystals as pictures, turning)
      g.fillStyle = '#ffffff';
      g.globalAlpha = 0.85;
      g.beginPath();
      for (const f of flakes) {
        if (f.crystal) continue;
        const fx = f.x + Math.sin(t * 0.8 + f.ph) * f.sway;
        g.moveTo(fx + f.r, f.y);
        g.arc(fx, f.y, f.r, 0, Math.PI * 2);
      }
      g.fill();
      const crystal = flakeSprite('#ffffff');
      for (const f of flakes) {
        if (!f.crystal) continue;
        const fx = f.x + Math.sin(t * 0.8 + f.ph) * f.sway;
        const s = f.r * 6;
        const a = f.rot + t * 0.3;
        g.setTransform(Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), fx, f.y);
        g.drawImage(crystal, -s / 2, -s / 2, s, s);
      }
      g.setTransform(1, 0, 0, 1, 0, 0);
    }

    // sparkles twinkling, drifting up a little
    g.globalCompositeOperation = 'screen';
    const sp = sparkleSprite(cfg.sparkle);
    for (const s of sparkles) {
      const k = Math.max(0, Math.sin(t * s.sp + s.ph));
      if (k < 0.05) continue;
      const size = s.s * (0.5 + k * 0.7);
      g.globalAlpha = k;
      g.drawImage(sp, s.x - size, s.y - size, size * 2, size * 2);
    }
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
  };

  // a cone of light: dots along a helix turning slowly, the near ones bright, a star on top
  const spiral = (cx: number, base: number, h: number, t: number) => {
    const n = Math.round(h / (2.2 * res));
    const w = h * 0.36;
    g.globalCompositeOperation = 'screen';
    const dot = dotSprite(cfg.spiral!);
    for (let i = 0; i < n; i++) {
      const u = i / n;
      const a = u * Math.PI * 2 * 5.5 + t * 0.5;
      const depth = Math.sin(a);
      const x = cx + Math.cos(a) * w * (1 - u);
      const y = base - u * h + depth * h * 0.03 * (1 - u);
      const r = (0.9 + (depth + 1) * 0.9) * res * 1.6;
      g.globalAlpha = (0.3 + 0.7 * ((depth + 1) / 2)) * (0.6 + 0.4 * Math.sin(t * 3 + i));
      g.drawImage(dot, x - r, y - r, r * 2, r * 2);
    }
    const top = sparkleSprite('#ffffff');
    const s = h * 0.12 * (0.85 + 0.15 * Math.sin(t * 2));
    g.globalAlpha = 1;
    g.drawImage(top, cx - s, base - h - s, s * 2, s * 2);
  };

  const update = (dt: number) => {
    T += dt;
    for (const b of bokeh) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.y < -b.r) b.y = H + b.r;
      if (b.x < -b.r) b.x = W + b.r;
      if (b.x > W + b.r) b.x = -b.r;
    }
    for (const s of sparkles) {
      s.y += s.vy * dt;
      if (s.y < -20) s.y = H + 20;
    }
    for (const f of flakes) {
      f.y += f.v * dt;
      if (f.y > H + 10) {
        f.y = -10;
        f.x = Math.random() * W;
      }
    }
    // each bauble's own swing (from a nudge) dies down: a damped spring on top of its sway
    // (a pendulum: the longer the string, the slower the swing; it dies down in a few seconds)
    for (const b of baubles) {
      const w = Math.sqrt(9.81 / Math.max(0.15, (b.len + b.R * 1.4) / res / 400));
      b.v += (-w * w * b.d - 0.9 * b.v) * dt;
      b.d += b.v * dt;
      b.d = Math.max(-0.6, Math.min(0.6, b.d));
    }
  };

  // frames are budgeted like the water's, not skipped by a fixed gap: 60 a second in front, 30
  // behind (on a 144 hz screen 60 stay 60, and a 60 hz screen's jitter drops none)
  let budget = 0;
  let prevTick = 0;
  let drawn = 0;
  let drawnSince = performance.now();
  let fpsNow = 0;
  const frame = (now: number) => {
    raf = 0;
    if (stopped) return;
    schedule();
    const rate = (o.focused?.() ?? true) ? 60 : 30;
    const interval = 1000 / rate;
    budget = Math.min(budget + (prevTick ? now - prevTick : interval), interval * 2);
    prevTick = now;
    if (budget < interval - 1.5) return;
    budget = Math.max(0, budget - interval);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    draw();
    drawn++;
    if (now - drawnSince >= 1000) {
      fpsNow = (drawn * 1000) / (now - drawnSince);
      drawn = 0;
      drawnSince = now;
    }
  };
  const schedule = () => {
    if (stopped || resting || reduce.matches || raf) return;
    raf = requestAnimationFrame(frame);
  };

  const onResize = () => {
    fit();
    draw();
  };
  const onMotion = () => {
    draw();
    last = performance.now();
    schedule();
  };
  // a palette or light / dark change shows at once, even while it rests
  const watch = window.setInterval(() => {
    const want = `${paletteNow()}:${o.dark()}:${W}x${H}`;
    if (want !== key && (resting || reduce.matches)) draw();
  }, 500);

  fit();
  draw();
  window.addEventListener('resize', onResize);
  reduce.addEventListener('change', onMotion);
  schedule();

  return {
    stop: () => {
      stopped = true;
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      reduce.removeEventListener('change', onMotion);
      window.clearInterval(watch);
    },
    rest: (on) => {
      if (on === resting) return;
      resting = on;
      if (on) {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        draw();
      } else {
        last = performance.now();
        prevTick = 0;
        schedule();
      }
    },
    cost: () => ({ ms: costN ? costSum / costN : 0, fps: fpsNow }),
    pointer: (x, y) => {
      const now = performance.now();
      const X = x * res;
      const Y = y * res;
      const dt = Math.max(0.008, (now - pt) / 1000);
      const vx = (X - px) / dt;
      if (pt && now - pt < 200 && !resting && !reduce.matches) {
        const t = T;
        for (const b of baubles) {
          const ang = b.amp * Math.sin((t * Math.PI * 2) / b.period + b.phase) + b.d;
          const tx = b.ax * W + Math.sin(ang) * b.len;
          const cy = Math.cos(ang) * b.len + b.R * 1.45;
          if (Math.hypot(X - tx, Y - cy) < b.R * 1.15) b.v = Math.max(-0.8, Math.min(0.8, b.v + (vx / (b.len + b.R * 1.4)) * 0.2));
        }
        schedule();
      }
      px = X;
      py = Y;
      pt = now;
    }
  };
};
