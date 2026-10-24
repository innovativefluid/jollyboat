// the strip under the title. lcd: the plasma, 3 px cells, 3 rows, bg → fg by 0.55 + (v − .5)·1.1
// plus dither. water: the glass renderer draws it (a tube of water streaming along); only
// without webgl2 (html.no-gl) is it drawn here, as a flat tube.

import { lcdScheme } from './scheme';
import { css, waterTokens } from './water/tokens';

const CELL = 3;
const ROWS = 3;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

export const createStrip = (canvas: HTMLCanvasElement) => {
  const ctx = canvas.getContext('2d')!;
  const cells = document.createElement('canvas');
  const cctx = cells.getContext('2d')!;
  let image: ImageData | null = null;
  let cw = 0;
  let look = '';
  let dpr = 1;
  const start = performance.now();
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  const resize = () => {
    look = document.documentElement.dataset.look === 'water' ? 'water' : 'lcd';
    if (look === 'water') {
      dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round((canvas.clientWidth || 300) * dpr);
      canvas.height = Math.round((canvas.clientHeight || 9) * dpr);
      return;
    }
    canvas.width = canvas.clientWidth || 300;
    canvas.height = 7;
    cw = Math.ceil(canvas.width / CELL);
    cells.width = cw;
    cells.height = ROWS;
    image = cctx.createImageData(cw, ROWS);
  };

  const tube = (t: number) => {
    const tk = waterTokens();
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    const r = h / 2;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(0.5, 0.5, w - 1, h - 1, r);
    ctx.clip();

    const body = ctx.createLinearGradient(0, 0, 0, h);
    body.addColorStop(0, css(tk.liqA));
    body.addColorStop(1, css(tk.liqB));
    ctx.fillStyle = body;
    ctx.fillRect(0, 0, w, h);

    // the flow: lighter swirls drifting right at 34 px/s
    for (let i = 0; i < Math.ceil(w / 46) + 2; i++) {
      const x = ((i * 46 + t * 34) % (w + 46)) - 23;
      const g = ctx.createRadialGradient(x, h * 0.55, 0, x, h * 0.55, 18);
      g.addColorStop(0, css(tk.spark, 0.32));
      g.addColorStop(1, css(tk.spark, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x - 18, 0, 36, h);
    }
    // fizz riding along
    ctx.fillStyle = css(tk.spark, 0.8);
    for (let i = 0; i < Math.ceil(w / 30); i++) {
      const sp = 38 + ((i * 17) % 23);
      const x = ((i * 53 + t * sp) % (w + 10)) - 5;
      const y = h * (0.65 - 0.25 * (((x / w) * 3 + i * 0.37) % 1));
      ctx.beginPath();
      ctx.arc(x, y, 0.9 + (i % 3) * 0.35, 0, Math.PI * 2);
      ctx.fill();
    }
    // gloss on the upper half
    const gloss = ctx.createLinearGradient(0, 0, 0, h * 0.6);
    gloss.addColorStop(0, css(tk.spark, 0.75));
    gloss.addColorStop(1, css(tk.spark, 0));
    ctx.fillStyle = gloss;
    ctx.fillRect(r * 0.6, 1, w - r * 1.2, h * 0.5);
    ctx.restore();

    ctx.strokeStyle = css(tk.edge, Math.min(1, tk.edgeA * 1.4));
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(0.5, 0.5, w - 1, h - 1, r);
    ctx.stroke();
  };

  const frame = () => {
    const now = document.documentElement.dataset.look === 'water' ? 'water' : 'lcd';
    if (now !== look) resize();
    const t = ((performance.now() - start) / 1000) * (reduce.matches ? 0 : 1);

    if (look === 'water') {
      if (document.documentElement.classList.contains('gl')) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        window.setTimeout(() => requestAnimationFrame(frame), 500);
        return;
      }
      tube(t);
      requestAnimationFrame(frame);
      return;
    }
    if (!image) return;
    const tp = t * 0.6;
    const { bg, fg } = lcdScheme();
    const d = image.data;

    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < cw; x++) {
        const s = Math.sin(x * 0.085 + tp) + Math.sin(y * 0.11 - 0.7 * tp) + Math.sin(x * 0.06 + y * 0.07 + 0.5 * tp) + Math.sin(x * 0.09 - 0.9 * tp);
        const v = s / 8 + 0.5;
        let m = 0.55 + (v - 0.5) * 1.1 + (BAYER[(y & 3) * 4 + (x & 3)] / 15 - 0.5) * 0.08;
        m = m < 0 ? 0 : m > 1 ? 1 : m;
        const o = (y * cw + x) * 4;
        d[o] = bg[0] + (fg[0] - bg[0]) * m;
        d[o + 1] = bg[1] + (fg[1] - bg[1]) * m;
        d[o + 2] = bg[2] + (fg[2] - bg[2]) * m;
        d[o + 3] = 255;
      }
    }

    cctx.putImageData(image, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(cells, 0, 0, cw, ROWS, 0, 0, cw * CELL, ROWS * CELL);
    requestAnimationFrame(frame);
  };

  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(frame);
};
