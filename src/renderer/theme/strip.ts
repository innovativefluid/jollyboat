// the plasma strip under the title: 3 px cells, 3 rows, bg → fg by 0.55 + (v − .5)·1.1 plus dither.

import { LCD } from './scheme';

const CELL = 3;
const ROWS = 3;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

export const createStrip = (canvas: HTMLCanvasElement) => {
  const ctx = canvas.getContext('2d')!;
  const cells = document.createElement('canvas');
  const cctx = cells.getContext('2d')!;
  let image: ImageData | null = null;
  let cw = 0;
  const start = performance.now();

  const resize = () => {
    canvas.width = canvas.clientWidth || 300;
    canvas.height = 7;
    cw = Math.ceil(canvas.width / CELL);
    cells.width = cw;
    cells.height = ROWS;
    image = cctx.createImageData(cw, ROWS);
  };

  const frame = () => {
    if (!image) return;
    const t = ((performance.now() - start) / 1000) * 0.6;
    const { bg, fg } = LCD;
    const d = image.data;

    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < cw; x++) {
        const s = Math.sin(x * 0.085 + t) + Math.sin(y * 0.11 - 0.7 * t) + Math.sin(x * 0.06 + y * 0.07 + 0.5 * t) + Math.sin(x * 0.09 - 0.9 * t);
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
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(cells, 0, 0, cw, ROWS, 0, 0, cw * CELL, ROWS * CELL);
    requestAnimationFrame(frame);
  };

  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(frame);
};
