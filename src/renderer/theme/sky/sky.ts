// The Pixel Sky backdrop: a quiet sky over rolling hills, drawn on a real pixel grid and scaled
// by whole device pixels. Stars drift and twinkle, clouds pass, a shooting star crosses now and
// then, the moon shows tonight's real phase (by day a sun). No anti-aliasing, no alpha: every
// fade is a 4 x 4 bayer dither aligned to the canvas, so patterns never swim.
//
// Ported from the Pixel Sky design study (pixel-sky.html, design_handoff_pixelsky.md): the
// schemes, hills, moon, stars, clouds and shooting stars are its own; the cast and the ui kit
// stay in the study (the pages here draw their ui in css).
//
// One canvas per window, fixed behind the page. Shared by the Sharkord page (preload) and the
// app's own windows (theme/ui.ts).

import { frogFrame } from './frog';

export type TSkyScheme = 'night' | 'day';
export type TSky = {
  stop: () => void;
  /** stand still (a game open over the page, the page hidden): the sky is drawn once and waits */
  rest: (on: boolean) => void;
  /** a shooting star now, from a point of the window (css px) or anywhere */
  wish: (x?: number, y?: number) => void;
};

type TScheme = {
  sky: string[];
  hillFar: string; hillFarRim: string; hillMid: string; hillMidRim: string; hillNear: string; hillNearRim: string;
  tree: string; house: string; window: string;
  starFar: string[]; starMid: string[]; starNear: string; starArm: string; starWarm: string;
  meteor: string[];
  orb: string; orbDark: string; orbShadow: string; halo: string;
  cloud: string; cloudHi: string; cloudLo: string;
};

export const SKY_SCHEMES: Record<TSkyScheme, TScheme> = {
  night: {
    sky: ['#070920', '#0b0e2c', '#10153c', '#171d4e', '#1f2561', '#2a2c73', '#3a3583', '#4f3f91'],
    hillFar: '#2b2768', hillFarRim: '#3d3786', hillMid: '#1f1c52', hillMidRim: '#2c2867', hillNear: '#15123d', hillNearRim: '#221d55',
    tree: '#0e0b2e', house: '#1a1748', window: '#ffd88a',
    starFar: ['#2c3479', '#3e4793'], starMid: ['#7d86d8', '#b9c0ff', '#fff6d8'], starNear: '#fff6d8', starArm: '#9fb0ff', starWarm: '#ffd88a',
    meteor: ['#ffffff', '#fff6d8', '#b9c0ff', '#6c74c4'],
    orb: '#fff1c9', orbDark: '#e3cf9f', orbShadow: '#262c78', halo: '#2a3183',
    cloud: '#1b215f', cloudHi: '#252c73', cloudLo: '#141950'
  },
  day: {
    sky: ['#3e8ee4', '#4f9cea', '#62abf0', '#79baf5', '#92c9f8', '#acd7fa', '#c8e5fb', '#e6f2f5'],
    hillFar: '#a6d9c8', hillFarRim: '#c4ebdc', hillMid: '#79c3a4', hillMidRim: '#97d6b8', hillNear: '#55a888', hillNearRim: '#6dbd9c',
    tree: '#3c8a70', house: '#f4ead8', window: '#5b74b8',
    starFar: ['#a9d2f6', '#bfe0fa'], starMid: ['#cfe6fb', '#e8f4fe', '#ffffff'], starNear: '#ffffff', starArm: '#d6ecfc', starWarm: '#fff3c4',
    meteor: ['#ffffff', '#ffffff', '#e8f4fe', '#bfe0fa'],
    orb: '#fff6c2', orbDark: '#ffe28a', orbShadow: '#fff6c2', halo: '#a3d3fa',
    cloud: '#ffffff', cloudHi: '#ffffff', cloudLo: '#d9eafa'
  }
};

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const bay = (x: number, y: number) => BAYER[(y & 3) * 4 + (x & 3)];
const rng = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const hex = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/** tonight's moon: 0 new, 0.5 full (a synodic month from a known new moon) */
const moonPhase = () => {
  const d = Date.now() / 864e5 - 10962.76;
  return (((d / 29.530588) % 1) + 1) % 1;
};

type TStar = { x: number; y: number; L: 0 | 1 | 2; ph: number; sp: number; warm: boolean };
type TMeteor = { x: number; y: number; dx: number; dy: number; v: number; life: number; len: number; age: number; done?: boolean };
type TSpark = { x: number; y: number; vx: number; vy: number; age: number; life: number; col: string };
const CLOUDS = [
  { x: 40, y: 60, w: 54, s: 3 },
  { x: 250, y: 110, w: 70, s: 2.2 },
  { x: 430, y: 150, w: 46, s: 2.8 },
  { x: 600, y: 84, w: 38, s: 3.6 }
];

export type TSkyOptions = {
  scheme: () => TSkyScheme;
  /** frames a second while nothing flies (twinkles are steps anyway), and while a star shoots */
  fps?: { calm: number; busy: number };
  /** how far above the window's bottom the near hill sits (sky pixels); the study's 78 */
  ground?: number;
  /** shooting stars every 4-11 s (off: only wishes) */
  meteors?: boolean;
  /** the window is not the one in front: slower, and no shooting stars of its own */
  focused?: () => boolean;
  /** where the moon (or the sun) stands, as a share of the width (the study: 88 px from the right) */
  orb?: number;
  /** Pebble the frog hangs out on the near hill, this share of the width from the left */
  frog?: number;
};

const mk = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

export const createSky = (canvas: HTMLCanvasElement, o: TSkyOptions): TSky => {
  const g = canvas.getContext('2d', { alpha: false })!;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const fps = o.fps ?? { calm: 15, busy: 60 };
  let W = 640;
  let H = 360;
  let S = 1;
  let GROUND = o.ground ?? 78;
  let ORB = { x: 552, y: 56, r: 13 };
  let SC = SKY_SCHEMES[o.scheme()];
  let schemeName = o.scheme();
  let bg: HTMLCanvasElement | null = null;
  let stars: TStar[] = [];
  const clouds = new Map<string, HTMLCanvasElement>();
  const meteors: TMeteor[] = [];
  const sparks: TSpark[] = [];
  let nextMeteor = 2.5 + Math.random() * 3;
  let T = Math.random() * 1000; // the sky's own clock (s): stars drift with it
  let resting = false;
  let stopped = false;
  let raf = 0;
  let last = performance.now();
  let lastDraw = 0;

  const hillFar = (x: number) => H - GROUND - 50 + 9 * Math.sin(x * 0.012 + 1.1) + 6 * Math.sin(x * 0.031 + 2.3) + 3 * Math.sin(x * 0.07);
  const hillMid = (x: number) => H - GROUND - 24 + 8 * Math.sin(x * 0.01 + 3.0) + 5 * Math.sin(x * 0.024 + 0.4);
  const hillNear = (x: number) => H - GROUND + 7 * Math.sin(x * 0.008 + 0.6) + 5 * Math.sin(x * 0.019 + 1.9) + 2 * Math.sin(x * 0.045 + 0.3);

  // ---- Pebble: breath every ~1 s, a blink of 0.14 s every 4.2 s, happy while a star shoots;
  // clicked, a hop (6 px, a half sine over 0.38 s) and a wave
  const FROG_SEED = 0.79;
  let frogHop = -9;
  let frogWave = -9;
  const frogX = () => (o.frog === undefined || GROUND < -100 ? null : Math.round(W * o.frog));
  const frogFeet = (x: number) => Math.round(hillNear(x)) + 2;
  const frogBusy = (now: number) => now - frogHop < 0.38 || now - frogWave < 1.4;
  const drawFrog = (now: number) => {
    const x = frogX();
    if (x === null) return;
    const calm = reduce.matches || resting;
    const flying = meteors.length > 0;
    const waving = !calm && now - frogWave < 1.4;
    const frame = frogFrame({
      hd: calm ? 0 : ((T * 1.05 + FROG_SEED) % 1) < 0.5 ? 0 : 1,
      eyes: ((now + FROG_SEED * 3.1) % 4.2) < 0.14 ? 'closed' : flying || waving ? 'happy' : 'open',
      mouth: flying || waving ? 'open' : 'smile',
      arm: waving ? (((now * 3) % 1) < 0.5 ? 'up' : 'up2') : 'down'
    });
    const ht = now - frogHop;
    const hy = ht < 0.38 && !calm ? -Math.round(Math.sin((Math.PI * ht) / 0.38) * 6) : 0;
    g.drawImage(frame, x - 16, frogFeet(x) - 31 + hy);
  };

  // ---- the grid: the short side of the screen near 360 sky pixels, whole device pixels each
  // (the screen, not the window: every window of the app draws its sky in the same pixel size)
  const fit = () => {
    const dpr = window.devicePixelRatio || 1;
    const screenShort = Math.min(screen.width, screen.height) * dpr;
    S = Math.max(1, Math.round(screenShort / 360));
    const devW = Math.max(1, Math.round(window.innerWidth * dpr));
    const devH = Math.max(1, Math.round(window.innerHeight * dpr));
    W = Math.ceil(devW / S);
    H = Math.ceil(devH / S);
    // a short window (the bar) keeps the top of the sky: its hills would be off the window
    GROUND = H < 200 ? -400 : Math.min(o.ground ?? 78, Math.round(H * 0.22));
    ORB = { x: o.orb === undefined ? W - 88 : Math.round(W * o.orb), y: Math.min(56, Math.round(H * 0.16)), r: 13 };
    canvas.width = W;
    canvas.height = H;
    canvas.style.width = `${(W * S) / dpr}px`;
    canvas.style.height = `${(H * S) / dpr}px`;
    g.imageSmoothingEnabled = false;
    bg = null;
    clouds.clear();
    const r = rng(7);
    // (a short window keeps its stars inside it, a few more of them)
    const short = GROUND < -100;
    const n = Math.min(900, Math.max(short ? Math.round(W / 9) : 0, Math.round((280 * W * H) / 230400)));
    const span = short ? Math.max(1, H - 3) : Math.max(10, H - GROUND - 42);
    stars = [];
    for (let i = 0; i < n; i++) {
      const f = i / n;
      stars.push({ x: r() * W, y: (short ? 1 : 4) + r() * span, L: f < 0.64 ? 0 : f < 0.935 ? 1 : 2, ph: r() * 10, sp: 0.4 + r() * 1.2, warm: r() < 0.12 });
    }
  };

  const px = (c: CanvasRenderingContext2D, x: number, y: number, col: string) => {
    c.fillStyle = col;
    c.fillRect(Math.round(x), Math.round(y), 1, 1);
  };
  const sparkle = (x: number, y: number, size: number, core: string, arm: string) => {
    x = Math.round(x);
    y = Math.round(y);
    g.fillStyle = arm;
    for (let i = 1; i <= size; i++) {
      g.fillRect(x - i, y, 1, 1);
      g.fillRect(x + i, y, 1, 1);
      g.fillRect(x, y - i, 1, 1);
      g.fillRect(x, y + i, 1, 1);
    }
    g.fillStyle = core;
    g.fillRect(x, y, 1, 1);
    if (size >= 2) {
      g.fillRect(x - 1, y, 3, 1);
      g.fillRect(x, y - 1, 1, 3);
    }
  };

  // ---- the still part, drawn once per size and scheme: dithered bands, halo, moon or sun, hills
  const background = () => {
    if (bg) return bg;
    const c = mk(W, H);
    const x = c.getContext('2d')!;
    const skyEnd = Math.max(40, H - GROUND - 12);
    const img = x.createImageData(W, H);
    const d = img.data;
    const cols = SC.sky.map(hex);
    const n = cols.length;
    for (let y = 0; y < H; y++) {
      const t = Math.min(1, y / skyEnd) * (n - 1);
      const i = Math.min(n - 2, Math.floor(t));
      const f = t - i;
      for (let xx = 0; xx < W; xx++) {
        const col = bay(xx, y) < f * 16 ? cols[i + 1] : cols[i];
        const k = (y * W + xx) * 4;
        d[k] = col[0];
        d[k + 1] = col[1];
        d[k + 2] = col[2];
        d[k + 3] = 255;
      }
    }
    x.putImageData(img, 0, 0);
    const day = schemeName === 'day';
    const phase = moonPhase();
    // (no room for the moon in a short window: only its stars)
    if (H < 100) {
      bg = c;
      return c;
    }
    // the halo, dithered out, then the orb
    for (let y = ORB.y - 26; y <= ORB.y + 26; y++)
      for (let xx = ORB.x - 26; xx <= ORB.x + 26; xx++) {
        const dd = Math.hypot(xx + 0.5 - ORB.x, y + 0.5 - ORB.y);
        if (dd > ORB.r + 1 && dd < ORB.r + 12) {
          const lv = (1 - (dd - ORB.r - 1) / 11) * (day ? 10 : 7);
          if (bay(xx, y) < lv) px(x, xx, y, SC.halo);
        }
      }
    const craters = new Set(['-4,-3', '-3,-3', '3,4', '4,4', '4,5', '-2,6', '6,-5']);
    for (let y = -ORB.r; y < ORB.r; y++)
      for (let xx = -ORB.r; xx < ORB.r; xx++) {
        const X = xx + 0.5;
        const Y = y + 0.5;
        if (X * X + Y * Y > ORB.r * ORB.r) continue;
        let col = SC.orb;
        if (!day) {
          const k = Math.cos(2 * Math.PI * phase);
          const u = X / (ORB.r * Math.sqrt(Math.max(0.001, 1 - (Y / ORB.r) ** 2)));
          const lit = phase < 0.5 ? u > k : u < -k;
          if (!lit) col = SC.orbShadow;
          else if (craters.has(`${xx},${y}`)) col = SC.orbDark;
        } else if (X * 0.5 + Y * 0.85 > ORB.r * 0.62) col = SC.orbDark;
        px(x, ORB.x + xx, ORB.y + y, col);
      }
    if (GROUND > -100) {
      const hill = (fn: (x: number) => number, col: string, rim: string) => {
        for (let xx = 0; xx < W; xx++) {
          const y = Math.round(fn(xx));
          x.fillStyle = col;
          x.fillRect(xx, y, 1, H - y);
          x.fillStyle = rim;
          x.fillRect(xx, y, 1, 1);
        }
      };
      const tree = (tx: number, base: number, col: string) => {
        tx = Math.round(tx);
        const rows = [1, 1, 3, 3, 5, 3, 5, 7, 7];
        const top = base - rows.length - 1;
        x.fillStyle = col;
        rows.forEach((w, i) => x.fillRect(tx - (w >> 1), top + i, w, 1));
        x.fillRect(tx, base - 1, 1, 2);
      };
      hill(hillFar, SC.hillFar, SC.hillFarRim);
      hill(hillMid, SC.hillMid, SC.hillMidRim);
      const R = rng(11);
      for (let i = 0; i < Math.round((16 * W) / 640); i++) {
        const tx = R() * W;
        tree(tx, Math.round(hillMid(tx)) + 2, SC.hillNear);
      }
      for (const hx of [Math.round(W * 0.144), Math.round(W * 0.5875)]) {
        const by = Math.round(hillMid(hx)) + 1;
        x.fillStyle = SC.house;
        x.fillRect(hx - 4, by - 5, 9, 6);
        for (let i = 0; i < 4; i++) x.fillRect(hx - 5 + i, by - 6 - i, 11 - 2 * i, 1);
        x.fillStyle = SC.window;
        x.fillRect(hx - 2, by - 3, 1, 1);
        x.fillRect(hx + 2, by - 3, 1, 1);
      }
      hill(hillNear, SC.hillNear, SC.hillNearRim);
      for (let i = 0; i < Math.round((9 * W) / 640); i++) {
        const tx = 20 + R() * (W - 40);
        if (frogX() !== null && Math.abs(tx - frogX()!) < 24) continue;
        tree(tx, Math.round(hillNear(tx)) + 2, SC.tree);
      }
    }
    bg = c;
    return c;
  };

  const cloudSprite = (i: number) => {
    const key = `${schemeName}${i}`;
    const have = clouds.get(key);
    if (have) return have;
    const cl = CLOUDS[i];
    const r = rng(30 + i);
    const c = mk(cl.w + 4, 20);
    const x = c.getContext('2d')!;
    const blobs: [number, number, number][] = [];
    for (let k = 0; k < 5; k++) blobs.push([4 + ((cl.w - 8) * k) / 4, 14 - (k === 0 || k === 4 ? 2 : 4 + r() * 4), k === 0 || k === 4 ? 4 : 5 + r() * 3]);
    for (let y = 0; y < 20; y++)
      for (let xx = 0; xx < cl.w + 4; xx++) {
        let inside = blobs.some(([bx, by, br]) => (xx + 0.5 - bx) ** 2 + (y + 0.5 - by) ** 2 <= br * br);
        if (y > 16) inside = false;
        if (y >= 13 && y <= 16 && xx > 2 && xx < cl.w + 1) inside = true;
        if (!inside) continue;
        x.fillStyle = y >= 15 ? SC.cloudLo : y < 7 ? SC.cloudHi : SC.cloud;
        x.fillRect(xx, y, 1, 1);
      }
    clouds.set(key, c);
    return c;
  };

  const spawn = (x?: number, y?: number) => {
    const sign = Math.random() < 0.7 ? 1 : -1;
    const a = 0.25 + Math.random() * 0.35;
    meteors.push({
      x: x ?? 40 + Math.random() * (W - 80),
      y: y ?? 6 + Math.random() * Math.max(30, Math.min(H - GROUND - 150, H * 0.5)),
      dx: Math.cos(a) * sign,
      dy: Math.sin(a),
      v: 210 + Math.random() * 90,
      life: 0.6 + Math.random() * 0.4,
      len: 18 + Math.random() * 16,
      age: 0
    });
  };

  const streak = (hx: number, hy: number, dx: number, dy: number, len: number, bright: boolean) => {
    const m = SC.meteor;
    for (let k = Math.ceil(len); k >= 0; k--) {
      const f = k / len;
      const X = Math.round(hx - dx * k);
      const Y = Math.round(hy - dy * k);
      if (f > 0.62 && bay(X, Y) < ((f - 0.62) / 0.38) * 16) continue;
      px(g, X, Y, f < 0.1 ? m[0] : f < 0.35 ? m[1] : f < 0.65 ? m[2] : m[3]);
    }
    if (bright) sparkle(hx, hy, 1, m[0], m[1]);
  };

  const draw = () => {
    const now = o.scheme();
    if (now !== schemeName) {
      schemeName = now;
      SC = SKY_SCHEMES[now];
      bg = null;
      clouds.clear();
    }
    g.drawImage(background(), 0, 0);
    const day = schemeName === 'day';
    const t = T;
    for (const s of stars) {
      if (day && (s.L === 0 || s.ph > 4.5)) continue;
      const x = Math.round((((s.x - t * [0.25, 0.5, 0.9][s.L]) % W) + W) % W);
      const y = Math.round(s.y);
      if (GROUND > -100 && y > hillFar(x) - 3) continue;
      if (Math.hypot(x - ORB.x, y - ORB.y) < ORB.r + 6) continue;
      if (s.L === 0) px(g, x, y, SC.starFar[Math.floor(t * s.sp * 0.6 + s.ph) % 2]);
      else if (s.L === 1) {
        const v = Math.sin(t * s.sp * 2 + s.ph);
        const i = v > 0.55 ? 2 : v > -0.35 ? 1 : 0;
        px(g, x, y, s.warm && i ? SC.starWarm : SC.starMid[i]);
      } else {
        const f = Math.floor((t * s.sp * 1.4 + s.ph) % 4);
        if (f === 0) px(g, x, y, SC.starNear);
        else sparkle(x, y, f === 2 ? 2 : 1, s.warm ? SC.starWarm : SC.starNear, SC.starArm);
      }
    }
    const top = Math.max(0, H - GROUND - 90);
    CLOUDS.forEach((cl, i) => {
      const span = W + cl.w + 20;
      const x = Math.round((((cl.x + t * cl.s) % span) + span) % span) - cl.w - 10;
      g.drawImage(cloudSprite(i), x, Math.round((cl.y * Math.max(60, top)) / 192));
    });
    for (const m of meteors) {
      const p = m.age / m.life;
      const L = m.len * Math.min(1, m.age / 0.12) * (p > 0.7 ? (1 - p) / 0.3 : 1);
      streak(m.x, m.y, m.dx, m.dy, L, p < 0.85);
    }
    for (const s of sparks) {
      const p = s.age / s.life;
      const X = Math.round(s.x);
      const Y = Math.round(s.y);
      if (p > 0.55 && bay(X, Y) < ((p - 0.55) / 0.45) * 16) continue;
      px(g, X, Y, s.col);
    }
    drawFrog(performance.now() / 1000);
  };

  const update = (dt: number) => {
    T += dt;
    const allowed = !reduce.matches && o.meteors !== false && (o.focused?.() ?? true);
    if (allowed) {
      nextMeteor -= dt;
      if (nextMeteor <= 0) {
        spawn();
        nextMeteor = 4 + Math.random() * 7;
      }
    }
    for (const m of meteors) {
      m.age += dt;
      m.x += m.dx * m.v * dt;
      m.y += m.dy * m.v * dt;
      if (m.age >= m.life && !m.done) {
        m.done = true;
        for (let i = 0; i < 3; i++) {
          const a = Math.random() * Math.PI * 2;
          sparks.push({ x: m.x, y: m.y, vx: Math.cos(a) * 14, vy: Math.sin(a) * 14 - 6, age: 0, life: 0.6 + Math.random() * 0.4, col: i ? SC.starArm : SC.meteor[1] });
        }
      }
    }
    for (let i = meteors.length - 1; i >= 0; i--) if (meteors[i].age > meteors[i].life) meteors.splice(i, 1);
    for (const s of sparks) {
      s.age += dt;
      const k = Math.exp(-3.2 * dt);
      s.vx *= k;
      s.vy = s.vy * k - 14 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
    }
    for (let i = sparks.length - 1; i >= 0; i--) if (sparks[i].age > sparks[i].life) sparks.splice(i, 1);
  };

  const frame = (now: number) => {
    raf = 0;
    if (stopped) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const busy = meteors.length > 0 || sparks.length > 0 || frogBusy(now / 1000);
    const focused = o.focused?.() ?? true;
    const rate = busy ? fps.busy : focused ? fps.calm : Math.min(fps.calm, 6);
    update(dt);
    if (now - lastDraw >= 1000 / rate - 2) {
      lastDraw = now;
      draw();
    }
    schedule();
  };
  const schedule = () => {
    if (stopped || resting || reduce.matches || raf) return;
    raf = requestAnimationFrame(frame);
  };
  const still = () => {
    draw();
  };

  const onResize = () => {
    fit();
    still();
  };
  const onMotion = () => {
    if (reduce.matches) {
      meteors.length = 0;
      sparks.length = 0;
      still();
    } else {
      last = performance.now();
      schedule();
    }
  };
  // a scheme change (light / dark) shows at once, even while the sky rests
  const schemeWatch = window.setInterval(() => {
    if (o.scheme() !== schemeName && (resting || reduce.matches)) still();
  }, 500);

  fit();
  still();
  window.addEventListener('resize', onResize);
  reduce.addEventListener('change', onMotion);
  schedule();

  return {
    stop: () => {
      stopped = true;
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      reduce.removeEventListener('change', onMotion);
      window.clearInterval(schemeWatch);
    },
    rest: (on) => {
      if (on === resting) return;
      resting = on;
      if (on) {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        meteors.length = 0;
        sparks.length = 0;
        still();
      } else {
        last = performance.now();
        schedule();
      }
    },
    wish: (x, y) => {
      if (resting || reduce.matches) return;
      const dpr = window.devicePixelRatio || 1;
      // a click on Pebble: a hop and a wave instead of a shooting star
      const fx = frogX();
      if (fx !== null && x !== undefined && y !== undefined) {
        const sx = (x * dpr) / S;
        const sy = (y * dpr) / S;
        const feet = frogFeet(fx);
        if (Math.abs(sx - fx) <= 13 && sy >= feet - 30 && sy <= feet + 1) {
          const now = performance.now() / 1000;
          frogHop = now;
          frogWave = now;
          last = performance.now();
          schedule();
          return;
        }
      }
      spawn(x === undefined ? undefined : (x * dpr) / S, y === undefined ? undefined : (y * dpr) / S);
      schedule();
    }
  };
};
