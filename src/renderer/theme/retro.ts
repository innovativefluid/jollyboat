// the retro look's desktop behind the windows: a pastel pink (night: deep purple) desktop with a
// faint pixel check, little pixel hearts and stars scattered over it, a few of them twinkling,
// and (in the setup window) the boat as a desktop icon in the corner. drawn on a canvas at css
// pixels; the scene is painted once per size and colour scheme, the twinkles four times a
// second; nothing while hidden or for anyone who asked for less motion.

import boatMap from '../../../build/pixel/icon-32.txt?raw';

const HEART = ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'];
const STAR = ['..#..', '..#..', '#####', '..#..', '..#..'];
const TWINKLE = ['.#.', '###', '.#.'];

type TPoint = { x: number; y: number; kind: 'heart' | 'star'; tone: number; blink: number };

const cssVar = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

export const createDesk = (canvas: HTMLCanvasElement, opts: { boat?: boolean } = {}) => {
  const ctx = canvas.getContext('2d')!;
  const scene = document.createElement('canvas');
  const sctx = scene.getContext('2d')!;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const dark = window.matchMedia('(prefers-color-scheme: dark)');
  let points: TPoint[] = [];
  let timer = 0;
  let running = true;
  let key = '';
  let twinkle = '#ffffff';

  // the same scatter every time for a size (a little hash, no randomness on resize)
  const scatter = (w: number, h: number) => {
    const out: TPoint[] = [];
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const n = Math.round((w * h) / 26000);
    for (let i = 0; i < n; i++) out.push({ x: Math.round((rnd() * w) / 2) * 2, y: Math.round((rnd() * h) / 2) * 2, kind: rnd() < 0.55 ? 'heart' : 'star', tone: Math.floor(rnd() * 3), blink: rnd() });
    return out;
  };

  const sprite = (c: CanvasRenderingContext2D, map: string[], x: number, y: number, size: number, colour: string) => {
    c.fillStyle = colour;
    map.forEach((row, j) => [...row].forEach((ch, i) => ch === '#' && c.fillRect(x + i * size, y + j * size, size, size)));
  };

  const paintScene = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const desk = cssVar('--r-desk', '#f9c9e4');
    const desk2 = cssVar('--r-desk2', '#e2c6ff');
    const check = cssVar('--r-check', 'rgba(255,255,255,0.18)');
    const tones = [cssVar('--r-dot-a', '#ffffff'), cssVar('--r-dot-b', '#ff8cc6'), cssVar('--r-dot-c', '#b38cff')];
    twinkle = tones[0];
    scene.width = w;
    scene.height = h;
    const g = sctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, desk);
    g.addColorStop(1, desk2);
    sctx.fillStyle = g;
    sctx.fillRect(0, 0, w, h);
    // a faint check of 16 px squares
    sctx.fillStyle = check;
    for (let y = 0; y < h; y += 16) for (let x = (y / 16) % 2 ? 16 : 0; x < w; x += 32) sctx.fillRect(x, y, 16, 16);
    points = scatter(w, h);
    for (const p of points) sprite(sctx, p.kind === 'heart' ? HEART : STAR, p.x, p.y, 2, tones[p.tone]);

    if (opts.boat) {
      // the boat as a desktop icon: a 64 px tile, its name under it like a file
      const x = 22;
      const y = h - 176;
      const face = cssVar('--r-face', '#ffeaf5');
      const ink = { '#': cssVar('--r-ink', '#3a1530'), g: cssVar('--r-dim', '#7a4568'), w: cssVar('--r-accent-hi', '#ff8cc6') } as Record<string, string>;
      sctx.fillStyle = cssVar('--r-dark', '#6e2d5c');
      sctx.fillRect(x - 2, y - 2, 68, 68);
      sctx.fillStyle = face;
      sctx.fillRect(x, y, 64, 64);
      boatMap
        .split('\n')
        .filter((r) => r)
        .forEach((row, j) => [...row].forEach((ch, i) => {
          if (!ink[ch]) return;
          sctx.fillStyle = ink[ch];
          sctx.fillRect(x + 4 + i * 2, y + 4 + j * 2, 2, 2);
        }));
      sctx.font = "15px 'DotGothic16', 'Pixelify Sans', monospace";
      sctx.textBaseline = 'top';
      const label = 'jollyboat.exe';
      const tw = Math.ceil(sctx.measureText(label).width);
      sctx.fillStyle = cssVar('--r-sel', '#ff4fa3');
      sctx.fillRect(x + 32 - tw / 2 - 4, y + 72, tw + 8, 20);
      sctx.fillStyle = cssVar('--r-sel-ink', '#ffffff');
      sctx.fillText(label, x + 32 - tw / 2, y + 74);
    }
  };

  const draw = () => {
    if (!running) return;
    const nextKey = `${window.innerWidth}x${window.innerHeight}|${dark.matches}|${document.documentElement.dataset.theme ?? ''}|${document.documentElement.dataset.palette ?? ''}`;
    if (nextKey !== key) {
      key = nextKey;
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      paintScene();
    }
    ctx.drawImage(scene, 0, 0);
    // a few stars twinkle: a small plus over some of them, on and off
    if (!reduce.matches) {
      const t = Math.floor(performance.now() / 250);
      for (const p of points) {
        if (p.kind !== 'star' || p.blink > 0.5) continue;
        if ((t + Math.floor(p.blink * 40)) % 6 < 2) sprite(ctx, TWINKLE, p.x + 2, p.y + 2, 2, twinkle);
      }
    }
  };

  const loop = () => {
    if (!running) return;
    if (!document.hidden) draw();
    timer = window.setTimeout(loop, reduce.matches ? 1000 : 250);
  };
  const repaint = () => {
    key = '';
    draw();
  };
  const fonts = document.fonts?.ready.then(repaint);
  void fonts;
  window.addEventListener('resize', draw);
  dark.addEventListener('change', repaint);
  loop();

  return {
    stop: () => {
      running = false;
      clearTimeout(timer);
      window.removeEventListener('resize', draw);
      dark.removeEventListener('change', repaint);
    },
    repaint
  };
};
