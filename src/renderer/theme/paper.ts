// the glass: one fragment per 5×5 px cell, scaled up with nearest filtering. plasma + bayer dither
// + sheared lattice + a glare band that crosses every ~24 s, then ink on top: the jolly boat riding
// slow horizontal waves, drifting toward the pointer.
//
// performance: the canvas is one pixel per cell and css scales it up (image-rendering: pixelated),
// so nothing full-size is drawn per frame; 60 fps with focus, 30 without.
// the plasma is four sines, but none of them is evaluated per cell per frame.
// sin(a + b) = sin a·cos b + cos a·sin b, so the two separable terms become per-column and
// per-row tables rebuilt each frame (O(w + h) trig), and the radial term uses sin/cos(r·.09)
// tables built once per resize. the per-cell loop is multiplies and adds only.

import { LCD } from './scheme';
import boatMap from '../../../build/pixel/icon-32.txt?raw';

const CELL = 5;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

// the boat from the icon map (sail and hull only; the icon's own water line is left out).
// '#' ink, 'g' dim, 'w' spark — as ink units, spark brightens
const BOAT = boatMap
  .split('\n')
  .slice(0, 23)
  .map((row) => [...row].map((c) => (c === '#' ? 60 : c === 'g' ? 32 : c === 'w' ? -22 : 0)));
const BOAT_W = Math.max(...BOAT.map((r) => r.length));
const BOAT_H = BOAT.length;
const WAVES = 3;

export const createPaper = (canvas: HTMLCanvasElement) => {
  const ctx = canvas.getContext('2d')!;

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

  let pointerX: number | null = null; // in cells
  let shipX = 0;
  let lastT = 0;
  const params = LCD;
  let raf = 0;
  let running = true;
  let frameCost = 0; // ms, exponential average, for the dev console
  let frames = 0;

  const resize = () => {
    cw = Math.ceil(window.innerWidth / CELL);
    ch = Math.ceil(window.innerHeight / CELL);
    canvas.width = cw;
    canvas.height = ch;
    canvas.style.width = `${cw * CELL}px`;
    canvas.style.height = `${ch * CELL}px`;
    image = ctx.createImageData(cw, ch);

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

  const put = (x: number, y: number, amount: number) => {
    if (x >= 0 && x < cw && y >= 0 && y < ch) ink[y * cw + x] += amount;
  };

  // water level breathes over ~25 s; each wave line is two slow sines, the lines fan out downward
  const waterY = (t: number) => ch * 0.8 + 2.5 * Math.sin(t * 0.25);
  const waveY = (k: number, x: number, t: number) =>
    waterY(t) + k * 3 + 1.6 * Math.sin(x * 0.09 + t * 0.6 + k * 1.3) + 0.8 * Math.sin(x * 0.23 - t * 0.9 + k);

  const drawInk = (t: number) => {
    ink.fill(0);

    const dt = Math.min(0.1, t - lastT);
    lastT = t;

    // the boat eases toward the pointer, staying on screen
    const target = Math.min(cw - BOAT_W / 2, Math.max(BOAT_W / 2, pointerX ?? cw / 2));
    shipX += (target - shipX) * Math.min(1, dt * 0.35);

    for (let k = 0; k < WAVES; k++) {
      const amount = 30 - k * 7;
      let prev = Math.round(waveY(k, 0, t));
      for (let x = 0; x < cw; x++) {
        const y = Math.round(waveY(k, x, t));
        // keep the line connected on steep bits
        for (let yy = Math.min(prev, y); yy <= Math.max(prev, y); yy++) put(x, yy, amount);
        prev = y;
      }
    }

    // hull sits on the first wave at the boat's centre, with a slight sway
    const sway = Math.sin(t * 0.5) * 0.8;
    const left = Math.round(shipX - BOAT_W / 2 + sway);
    const top = Math.round(waveY(0, shipX, t)) - BOAT_H + 1;
    for (let r = 0; r < BOAT_H; r++) {
      const row = BOAT[r];
      for (let c = 0; c < row.length; c++) if (row[c]) put(left + c, top + r, row[c]);
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

    ctx.putImageData(image, 0, 0);

    frameCost = frameCost * 0.9 + (performance.now() - t0) * 0.1;
    frames++;
  };

  const start = performance.now();
  const now = () => (performance.now() - start) / 1000;

  let last = 0;
  const loop = (ms: number) => {
    if (!running) return;
    // every frame with focus, every other frame while another window has it
    const gap = document.hasFocus() ? 0 : 1000 / 30;
    if (ms - last >= gap - 2) {
      last = ms;
      frame(now());
    }
    raf = requestAnimationFrame(loop);
  };

  // the boat follows the pointer's horizontal position; it stays put when the pointer leaves
  window.addEventListener('pointermove', (e) => {
    pointerX = e.clientX / CELL;
  });

  // the page is hidden (tray, other tab): nothing to draw. rAF already pauses, this resumes it
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && running && !raf) raf = requestAnimationFrame(loop);
  });

  window.addEventListener('resize', resize);

  resize();
  shipX = cw / 2;
  raf = requestAnimationFrame(loop);

  return {
    /** average ms spent per frame on the paper, for tuning */
    cost: () => frameCost,
    /** frames drawn so far, for tuning */
    frames: () => frames,
    stop: () => {
      running = false;
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };
};
