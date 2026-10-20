// particles: bursts of dots and 3-cell rings, snapped to the 5 px cell grid.

import { LCD } from './scheme';

const CELL = 5;

type TParticle = { x: number; y: number; vx: number; vy: number; life: number; age: number; ring: boolean; spark: boolean };

export const createSparks = (canvas: HTMLCanvasElement) => {
  const ctx = canvas.getContext('2d')!;
  const particles: TParticle[] = [];
  let last = performance.now();
  let raf = 0;

  const resize = () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  };

  const rgb = (c: number[]) => `rgb(${c[0]},${c[1]},${c[2]})`;
  const snap = (v: number) => Math.round(v / CELL) * CELL;

  const tick = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const scheme = LCD;

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.age += dt;
      if (p.age >= p.life) {
        particles.splice(i, 1);
        continue;
      }
      p.vx -= p.vx * 1.2 * dt;
      p.vy = p.vy - p.vy * 1.2 * dt + 90 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      const k = p.age / p.life;
      const alpha = k < 0.15 ? k / 0.15 : k > 0.7 ? (1 - k) / 0.3 : 1;
      ctx.globalAlpha = alpha;
      const colour = rgb(p.spark ? scheme.spark : scheme.fg);
      const x = snap(p.x);
      const y = snap(p.y);

      if (p.ring) {
        // a 3-cell ring: the 8 cells around a centre
        ctx.fillStyle = colour;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) if (dx || dy) ctx.fillRect(x + dx * CELL, y + dy * CELL, CELL, CELL);
      } else {
        ctx.fillStyle = colour;
        ctx.fillRect(x, y, CELL, CELL);
      }
    }

    ctx.globalAlpha = 1;
    raf = particles.length ? requestAnimationFrame(tick) : 0;
  };

  const burst = (x: number, y: number, n: number) => {
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

    if (!raf) {
      last = performance.now();
      raf = requestAnimationFrame(tick);
    }
  };

  const burstAt = (el: Element, n: number) => {
    const r = el.getBoundingClientRect();
    burst(r.left + r.width / 2, r.top + r.height / 2, n);
  };

  window.addEventListener('resize', resize);
  resize();

  // every pill and segment click bursts 5
  document.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest('.pill, .seg button');
    if (target && !(target as HTMLButtonElement).disabled) burstAt(target, 5);
  });

  return { burst, burstAt };
};
