// particles. the lcd look: bursts of dots and 3-cell rings, snapped to the 5 px cell grid. the
// water look: fizz, glass bubble sprites that shrink as they rise, with a few twinkles
// (design_handoff_aqua.md §7). the look of a burst is decided when it starts.

import { lcdScheme } from './scheme';
import { css, waterTokens } from './water/tokens';

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
  /** water: a bubble of this size, or a twinkle when 0 */
  size?: number;
  wander?: number;
};

const water = () => document.documentElement.dataset.look === 'water';

export const createSparks = (canvas: HTMLCanvasElement) => {
  const ctx = canvas.getContext('2d')!;
  const particles: TParticle[] = [];
  let last = performance.now();
  let raf = 0;
  let dpr = 1;
  let sprite: HTMLCanvasElement | null = null;
  let spriteKey = '';

  const resize = () => {
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
  };

  const rgb = (c: number[]) => `rgb(${c[0]},${c[1]},${c[2]})`;
  const snap = (v: number) => Math.round(v / CELL) * CELL;

  // one glass bubble, drawn once per scheme at 64 px and scaled
  const bubbleSprite = () => {
    const tk = waterTokens();
    const key = tk.bubble.join();
    if (sprite && key === spriteKey) return sprite;
    spriteKey = key;
    sprite = document.createElement('canvas');
    sprite.width = sprite.height = 64;
    const g = sprite.getContext('2d')!;
    const body = g.createRadialGradient(32, 32, 10, 32, 32, 31);
    body.addColorStop(0, css(tk.spark, 0.04));
    body.addColorStop(0.72, css(tk.spark, 0.14));
    body.addColorStop(0.92, css(tk.bubble, tk.bubbleA * 0.55));
    body.addColorStop(1, css(tk.bubble, 0));
    g.fillStyle = body;
    g.beginPath();
    g.arc(32, 32, 31, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = css(tk.spark, 0.75);
    g.lineWidth = 2.2;
    g.beginPath();
    g.arc(32, 32, 28.5, Math.PI * 1.05, Math.PI * 1.55);
    g.stroke();
    g.fillStyle = css(tk.spark, 0.92);
    g.beginPath();
    g.ellipse(22, 20, 7, 4.2, -0.6, 0, Math.PI * 2);
    g.fill();
    return sprite;
  };

  const drawTwinkle = (x: number, y: number, s: number, colour: string) => {
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.moveTo(x, y - s);
    ctx.quadraticCurveTo(x, y, x + s, y);
    ctx.quadraticCurveTo(x, y, x, y + s);
    ctx.quadraticCurveTo(x, y, x - s, y);
    ctx.quadraticCurveTo(x, y, x, y - s);
    ctx.fill();
  };

  const tick = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const scheme = lcdScheme();
    const tk = waterTokens();

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.age += dt;
      if (p.age >= p.life) {
        particles.splice(i, 1);
        continue;
      }
      const k = p.age / p.life;

      if (p.size !== undefined) {
        // fizz: friction 1.3, buoyancy 95 px/s² upward, a little wander
        p.vx -= p.vx * 1.3 * dt;
        p.vy -= p.vy * 1.3 * dt + 95 * dt;
        p.wander = (p.wander ?? 0) + dt * 3;
        p.x += (p.vx + Math.sin(p.wander * 2.3 + i) * 14) * dt;
        p.y += p.vy * dt;
        const alpha = k < 0.1 ? k / 0.1 : k > 0.75 ? (1 - k) / 0.25 : 1;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.globalAlpha = alpha;
        if (p.size > 0) {
          const s = p.size + (9 - p.size) * k;
          ctx.drawImage(bubbleSprite(), p.x - s / 2, p.y - s / 2, s, s);
        } else {
          drawTwinkle(p.x, p.y, 3.5 * (1 - Math.abs(0.5 - k)), css(tk.spark, 0.95));
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

  const burst = (x: number, y: number, n: number) => {
    if (water()) {
      for (let i = 0; i < n; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.max(20, 150 + (Math.random() * 2 - 1) * 110);
        particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 1 + Math.random(), age: 0, ring: false, spark: false, size: 13 + (Math.random() * 2 - 1) * 8 });
      }
      for (let i = 0; i < Math.max(1, Math.round(n / 3)); i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 60 + Math.random() * 120;
        particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 0.6 + Math.random() * 0.5, age: 0, ring: false, spark: true, size: 0 });
      }
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
      const speed = 120 + Math.random() * 80;
      particles.push({
        x: x + Math.cos(angle) * radius,
        y: y + Math.sin(angle) * radius,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1 + Math.random() * 0.8,
        age: 0,
        ring: false,
        spark: false,
        size: i % 4 === 0 ? 0 : 10 + Math.random() * 10
      });
    }
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
