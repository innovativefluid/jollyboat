// the glass: one fragment per 5×5 px cell, scaled up with nearest filtering. plasma + bayer dither
// + sheared lattice + a glare band that crosses every ~24 s, then ink (bubbles, ripples) on top.
//
// performance: the plasma is four sines, but none of them is evaluated per cell per frame.
// sin(a + b) = sin a·cos b + cos a·sin b, so the two separable terms become per-column and
// per-row tables rebuilt each frame (O(w + h) trig), and the radial term uses sin/cos(r·.09)
// tables built once per resize. the per-cell loop is multiplies and adds only.

import { LCD } from './scheme';

const CELL = 5;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const BUBBLES = 26;
const RIPPLE_SLOTS = 40;
const RIPPLE_LIFE = 2.1;

type TRipple = { x: number; y: number; start: number };

const hash = (a: number, b: number) => {
  const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return v - Math.floor(v);
};

export const createPaper = (canvas: HTMLCanvasElement) => {
  const ctx = canvas.getContext('2d')!;
  const cells = document.createElement('canvas');
  const cctx = cells.getContext('2d')!;

  let cw = 0;
  let ch = 0;
  let image: ImageData | null = null;
  let ink = new Float32Array(0);
  // per-resize tables
  let sinR = new Float32Array(0);
  let cosR = new Float32Array(0);
  let lattice = new Uint8Array(0);
  let dither = new Float32Array(0);
  let diag = new Float32Array(0); // (x + y) / (cw + ch)
  // per-frame tables
  let colA = new Float32Array(0); // sin(x·.085 + t')
  let colS = new Float32Array(0); // sin(x·.06)
  let colC = new Float32Array(0); // cos(x·.06)
  let rowB = new Float32Array(0); // sin(y·.11 − .7t')
  let rowS = new Float32Array(0); // sin(y·.07 + .5t')
  let rowC = new Float32Array(0); // cos(y·.07 + .5t')

  const ripples: TRipple[] = [];
  let rippleHead = 0;
  let lastPointer = { x: 0, y: 0, t: 0 };
  const params = LCD;
  let raf = 0;
  let running = true;
  let frameCost = 0; // ms, exponential average, for the dev console

  const resize = () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    cw = Math.ceil(canvas.width / CELL);
    ch = Math.ceil(canvas.height / CELL);
    cells.width = cw;
    cells.height = ch;
    image = cctx.createImageData(cw, ch);

    const n = cw * ch;
    ink = new Float32Array(n);
    sinR = new Float32Array(n);
    cosR = new Float32Array(n);
    lattice = new Uint8Array(n);
    dither = new Float32Array(n);
    diag = new Float32Array(n);
    colA = new Float32Array(cw);
    colS = new Float32Array(cw);
    colC = new Float32Array(cw);
    rowB = new Float32Array(ch);
    rowS = new Float32Array(ch);
    rowC = new Float32Array(ch);

    const cx = cw / 2;
    const cy = ch / 2;

    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const i = y * cw + x;
        const r = Math.hypot(x - cx, y - cy) * 0.09;
        sinR[i] = Math.sin(r);
        cosR[i] = Math.cos(r);
        lattice[i] = y % 4 === 0 || (x + Math.floor(0.3 * y)) % 4 === 0 ? 1 : 0;
        dither[i] = (BAYER[(y & 3) * 4 + (x & 3)] / 15 - 0.5) * 0.02;
        diag[i] = (x + y) / (cw + ch);
      }
    }

    for (let x = 0; x < cw; x++) {
      colS[x] = Math.sin(x * 0.06);
      colC[x] = Math.cos(x * 0.06);
    }
  };

  const stamp = (cx: number, cy: number, r: number, amount: number) => {
    const x0 = Math.max(0, Math.floor(cx - r - 1));
    const x1 = Math.min(cw - 1, Math.ceil(cx + r + 1));
    const y0 = Math.max(0, Math.floor(cy - r - 1));
    const y1 = Math.min(ch - 1, Math.ceil(cy + r + 1));

    for (let y = y0; y <= y1; y++) {
      const dy = y - cy;
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > r - 0.6 && d < r + 0.6) ink[y * cw + x] += amount;
      }
    }
  };

  const drawInk = (t: number) => {
    ink.fill(0);

    for (let i = 0; i < BUBBLES; i++) {
      const seed = i * 7.31;
      const speed = 1.3 + hash(seed, 1) * 1.9; // cells per second
      const r = 1 + Math.floor(hash(seed, 2) * 4);
      const span = ch + 10;
      const travelled = t * speed + hash(seed, 3) * span;
      const wrap = Math.floor(travelled / span);
      const y = ch + 5 - (travelled % span);
      const x = hash(seed, 4 + wrap) * cw + Math.sin(t * 0.5 + seed) * (2 + hash(seed, 5) * 3);
      stamp(x, y, r, 22);
    }

    for (const rp of ripples) {
      const age = t - rp.start;
      if (age < 0 || age > RIPPLE_LIFE) continue;
      stamp(rp.x, rp.y, 1 + 33 * age, 60 * Math.pow(0.95, 30 * age));
    }
  };

  const frame = (t: number) => {
    if (!image) return;

    const t0 = performance.now();
    const { bg, bgLum, lift, amp, lattice: latticeAmt, glare, inkDir } = params;
    const tp = t * 0.6;
    const glareU = ((t % 24) / 24) * 1.24 - 0.12;
    const data = image.data;
    const ampK = amp / 8;
    const inkK = inkDir / 255;
    const base = bgLum + lift;
    const sinRt = Math.sin(-0.9 * tp);
    const cosRt = Math.cos(-0.9 * tp);
    const r0 = bg[0] / bgLum;
    const g0 = bg[1] / bgLum;
    const b0 = bg[2] / bgLum;

    for (let x = 0; x < cw; x++) colA[x] = Math.sin(x * 0.085 + tp);
    for (let y = 0; y < ch; y++) {
      rowB[y] = Math.sin(y * 0.11 - 0.7 * tp);
      rowS[y] = Math.sin(y * 0.07 + 0.5 * tp);
      rowC[y] = Math.cos(y * 0.07 + 0.5 * tp);
    }

    drawInk(t);

    for (let y = 0; y < ch; y++) {
      const rb = rowB[y];
      const rs = rowS[y];
      const rc = rowC[y];
      const row = y * cw;

      for (let x = 0; x < cw; x++) {
        const i = row + x;
        // sin(x·.06 + y·.07 + .5t') and sin(r·.09 − .9t') by angle addition
        const s = colA[x] + rb + (colS[x] * rc + colC[x] * rs) + (sinR[i] * cosRt + cosR[i] * sinRt);

        let l = base + dither[i] + s * ampK;
        if (lattice[i]) l += latticeAmt;

        const u = diag[i] - glareU;
        if (u > 0 && u < 0.12) l += glare * Math.sin((Math.PI * u) / 0.12);

        l += inkK * ink[i];
        l = l < 0 ? 0 : l > 1 ? 1 : l;

        const o = i << 2;
        const rr = r0 * l;
        const gg = g0 * l;
        const bb = b0 * l;
        data[o] = rr > 255 ? 255 : rr;
        data[o + 1] = gg > 255 ? 255 : gg;
        data[o + 2] = bb > 255 ? 255 : bb;
        data[o + 3] = 255;
      }
    }

    cctx.putImageData(image, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(cells, 0, 0, cw, ch, 0, 0, cw * CELL, ch * CELL);

    frameCost = frameCost * 0.9 + (performance.now() - t0) * 0.1;
  };

  const start = performance.now();
  const now = () => (performance.now() - start) / 1000;

  let tick = 0;
  const loop = () => {
    if (!running) return;
    // half rate while another window has focus: the glass still breathes, at half the cost
    if (document.hasFocus() || (tick++ & 1) === 0) frame(now());
    raf = requestAnimationFrame(loop);
  };

  const ripple = (px: number, py: number) => {
    ripples[rippleHead] = { x: px / CELL, y: py / CELL, start: now() };
    rippleHead = (rippleHead + 1) % RIPPLE_SLOTS;
  };

  // a tap on empty paper adds one; the pointer leaves one every 48 px, at most one per 120 ms
  const onPaper = (e: PointerEvent) => !(e.target as HTMLElement).closest('.panel, .pill, .header .right');

  window.addEventListener('pointerdown', (e) => onPaper(e) && ripple(e.clientX, e.clientY));
  window.addEventListener('pointermove', (e) => {
    if (!onPaper(e)) return;
    const ms = performance.now();
    if (ms - lastPointer.t < 120) return;
    if (Math.hypot(e.clientX - lastPointer.x, e.clientY - lastPointer.y) < 48) return;
    lastPointer = { x: e.clientX, y: e.clientY, t: ms };
    ripple(e.clientX, e.clientY);
  });

  // the page is hidden (tray, other tab): nothing to draw. rAF already pauses, this resumes it
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && running && !raf) raf = requestAnimationFrame(loop);
  });

  window.addEventListener('resize', resize);

  resize();
  raf = requestAnimationFrame(loop);

  return {
    ripple,
    /** average ms spent per frame on the paper, for tuning */
    cost: () => frameCost,
    stop: () => {
      running = false;
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };
};
