// particles. the lcd look: bursts of dots and 3-cell rings, snapped to the 5 px cell grid. the
// water look: fizz as in the design study (Sparks.qml): glass bubble sprites that burst out,
// float up, wander and shrink, with a third as many twinkles. the look of a burst is decided
// when it starts.

import { lcdScheme } from './scheme';
import bubbleUrl from './water/img/bubble.png';
import glintUrl from './water/img/glint.png';

const CELL = 5;

type TParticle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  age: number;
  ring: boolean;
  spark: boolean;
  /** water: a bubble from this size to 9 px, or a twinkle (glint) from this size to 4 */
  size?: number;
  glint?: boolean;
  ay?: number;
  rot?: number;
  spin?: number;
  wander?: number;
};

const water = () => document.documentElement.dataset.look === 'water';
const image = (src: string) => {
  const img = new Image();
  img.src = src;
  return img;
};
const bubbleImg = image(bubbleUrl);
const glintImg = image(glintUrl);
const vary = (base: number, v: number) => base + (Math.random() * 2 - 1) * v;

export const createSparks = (canvas: HTMLCanvasElement) => {
  const ctx = canvas.getContext('2d')!;
  const particles: TParticle[] = [];
  let last = performance.now();
  let raf = 0;
  let dpr = 1;

  const resize = () => {
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
  };

  const rgb = (c: number[]) => `rgb(${c[0]},${c[1]},${c[2]})`;
  const snap = (v: number) => Math.round(v / CELL) * CELL;

  const tick = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const scheme = lcdScheme();

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.age += dt;
      if (p.age >= p.life) {
        particles.splice(i, 1);
        continue;
      }
      const k = p.age / p.life;

      if (p.size !== undefined) {
        // friction 1.3, buoyancy upward, a wander from side to side
        p.vx -= p.vx * 1.3 * dt;
        p.vy -= p.vy * 1.3 * dt;
        if (!p.glint) {
          p.vy += (p.ay ?? -95) * dt;
          p.wander = (p.wander ?? Math.random() * 6) + dt * 2.2;
          p.vx += Math.sin(p.wander) * 40 * dt * 2;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (p.glint) {
          const s = p.size + (4 - p.size) * k;
          p.rot = (p.rot ?? 0) + (p.spin ?? 0) * dt;
          ctx.globalAlpha = k < 0.25 ? k / 0.25 : 1 - (k - 0.25) / 0.75;
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.drawImage(glintImg, -s / 2, -s / 2, s, s);
        } else {
          // entry: the bubble scales in
          const grow = Math.min(1, p.age / 0.12);
          const s = (p.size + (9 - p.size) * k) * grow;
          ctx.globalAlpha = 0.95 * (k > 0.8 ? (1 - k) / 0.2 : 1);
          ctx.drawImage(bubbleImg, p.x - s / 2, p.y - s / 2, s, s);
        }
        continue;
      }

      p.vx -= p.vx * 1.2 * dt;
      p.vy = p.vy - p.vy * 1.2 * dt + 90 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      const alpha = k < 0.15 ? k / 0.15 : k > 0.7 ? (1 - k) / 0.3 : 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = alpha;
      const colour = rgb(p.spark ? scheme.spark : scheme.fg);
      const x = snap(p.x);
      const y = snap(p.y);

      ctx.fillStyle = colour;
      if (p.ring) {
        // a 3-cell ring: the 8 cells around a centre
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) if (dx || dy) ctx.fillRect(x + dx * CELL, y + dy * CELL, CELL, CELL);
      } else {
        ctx.fillRect(x, y, CELL, CELL);
      }
    }

    ctx.globalAlpha = 1;
    raf = particles.length ? requestAnimationFrame(tick) : 0;
  };

  const kick = () => {
    if (!raf) {
      last = performance.now();
      raf = requestAnimationFrame(tick);
    }
  };

  // the study's emitters: fizz 1.5 ± .5 s, 13 ± 8 px to 9, 150 ± 110 px/s any way, buoyancy
  // 95 ± 30 px/s² up; glints .7 ± .3 s, 18 ± 8 px to 4, 90 ± 60 px/s, turning
  const fizz = (x: number, y: number) => {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.max(0, vary(150, 110));
    particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: vary(1.5, 0.5), age: 0, ring: false, spark: false, size: Math.max(4, vary(13, 8)), ay: -vary(95, 30) });
  };
  const glint = (x: number, y: number) => {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.max(0, vary(90, 60));
    particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: vary(0.7, 0.3), age: 0, ring: false, spark: false, size: vary(18, 8), glint: true, rot: Math.random() * 0.8, spin: vary(0, 1.6) });
  };

  const burst = (x: number, y: number, n: number) => {
    if (water()) {
      for (let i = 0; i < n; i++) fizz(x, y);
      for (let i = 0; i < Math.max(1, Math.round(n / 3)); i++) glint(x, y);
      kick();
      return;
    }
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * Math.PI * 2 + Math.random() * 0.6;
      const speed = 60 + Math.random() * 200;
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 65,
        life: 0.9 + Math.random() * 0.7,
        age: 0,
        ring: i % 2 === 0,
        spark: i % 3 === 0
      });
    }
    kick();
  };

  /** water: a ring of fizz (the intro's pop) */
  const ring = (x: number, y: number, n: number, radius: number) => {
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * Math.PI * 2;
      fizz(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
    }
    for (let i = 0; i < Math.round(n / 4); i++) glint(x, y);
    kick();
  };

  const burstAt = (el: Element, n: number) => {
    const r = el.getBoundingClientRect();
    burst(r.left + r.width / 2, r.top + r.height / 2, n);
  };

  window.addEventListener('resize', resize);
  resize();

  return { burst, burstAt, ring };
};
