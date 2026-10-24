// small shared pieces: boot (the backdrop, sparks, strip), feedback on clicks, toast, hints, intro.
//
// the backdrop follows the look live: the lcd paper (2d canvas) or the water (webgl2); without
// webgl2 the water look keeps its css gradient and css glass (html.no-gl).

import { createPaper } from './paper';
import { createSparks } from './sparks';
import { createStrip } from './strip';
import { createWater, type TWater } from './water/water';
import { waterTokens } from './water/tokens';

type TLook = 'lcd' | 'water';
type TBackdrop = { stop: () => void; water?: TWater };

const lookNow = (): TLook => (document.documentElement.dataset.look === 'water' ? 'water' : 'lcd');

export const bootTheme = ({ intro = 'quick' }: { intro?: 'bubble' | 'quick' } = {}) => {
  const sparksCanvas = document.createElement('canvas');
  sparksCanvas.className = 'sparks';
  document.body.append(sparksCanvas);
  const fx = createSparks(sparksCanvas);

  let backdrop: TBackdrop | null = null;
  let backdropCanvas: HTMLCanvasElement | null = null;

  const startBackdrop = (look: TLook) => {
    backdrop?.stop();
    backdropCanvas?.remove();
    backdrop = null;
    backdropCanvas = null;
    document.documentElement.classList.remove('no-gl');
    const canvas = document.createElement('canvas');
    document.body.prepend(canvas);

    if (look === 'water') {
      canvas.className = 'water';
      // an air bubble surfacing: a couple of twinkles
      const water = createWater(canvas, { onPop: (x, y) => fx.burst(x, y, 1) });
      if (!water) {
        canvas.remove();
        document.documentElement.classList.add('no-gl');
        return;
      }
      backdrop = { stop: water.stop, water };
    } else {
      canvas.className = 'paper';
      const paper = createPaper(canvas);
      // for tuning from devtools: window.__paperCost(), window.__paperFrames()
      Object.assign(window, { __paperCost: () => paper.cost(), __paperFrames: () => paper.frames() });
      backdrop = { stop: paper.stop };
    }
    backdropCanvas = canvas;
  };

  startBackdrop(lookNow());
  window.shell.onLook((look) => startBackdrop(look));

  document.querySelectorAll<HTMLCanvasElement>('canvas.strip').forEach(createStrip);

  // ---- feedback: fizz or sparks on every control, and in the water a ripple under it -------

  const rippleUnder = (el: Element, amp: number) => {
    const r = el.getBoundingClientRect();
    backdrop?.water?.ripple(r.left + r.width / 2, r.top + r.height / 2, amp, 4);
  };
  const jiggle = (el: Element) => {
    if (lookNow() !== 'water') return;
    el.classList.remove('jiggle');
    void (el as HTMLElement).offsetWidth;
    el.classList.add('jiggle');
    el.addEventListener('animationend', () => el.classList.remove('jiggle'), { once: true });
  };

  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const control = target.closest('.pill, .seg button');
    if (control) {
      if ((control as HTMLButtonElement).disabled) return;
      fx.burstAt(control, 5);
      rippleUnder(control, -0.45);
      jiggle(control);
      return;
    }
    const box = target.closest('.check')?.querySelector('input');
    if (box && target instanceof HTMLInputElement) {
      fx.burstAt(box, 4);
      jiggle(box);
      return;
    }
    // a tap on open water: pop an air bubble, else a drop
    const water = backdrop?.water;
    if (water && !target.closest('.panel, button, input, label, .footer, .title-block, .toast, a')) {
      if (water.popAt(e.clientX, e.clientY)) fx.burst(e.clientX, e.clientY, 10);
      else water.ripple(e.clientX, e.clientY, -1.0, 5);
    }
  });
  // a slider let go: three bubbles at the marble
  document.addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement;
    if (el.type !== 'range') return;
    const r = el.getBoundingClientRect();
    const k = (Number(el.value) - Number(el.min || 0)) / ((Number(el.max || 100) - Number(el.min || 0)) || 1);
    fx.burst(r.left + 11 + k * (r.width - 22), r.top + r.height / 2, 3);
  });

  // ---- the intro ---------------------------------------------------------------------------

  const page = document.querySelector<HTMLElement>('.page');
  const enter = () => {
    if (!page) return;
    page.classList.remove('hidden');
    page.classList.add('enter');
    const done = (e: AnimationEvent) => {
      if (e.target !== page) return;
      page.classList.remove('enter');
      page.removeEventListener('animationend', done);
    };
    page.addEventListener('animationend', done);
    // panels stream in 30 ms apart (water: they rise 18 px)
    document.querySelectorAll<HTMLElement>('.panel').forEach((panel, i) => {
      panel.classList.add('enter');
      panel.style.animationDelay = `${i * 30}ms, 0ms`;
      const done = (e: AnimationEvent) => {
        if (e.target !== panel || !e.animationName.endsWith('panel-in')) return;
        panel.classList.remove('enter');
        panel.style.animationDelay = '';
        panel.removeEventListener('animationend', done);
      };
      panel.addEventListener('animationend', done);
    });
  };

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const startWater = (backdrop as TBackdrop | null)?.water;
  if (intro === 'bubble' && lookNow() === 'water' && startWater && !reduce) soapBubble(page, enter, startWater, fx);
  else enter();

  return { fx, ripple: (x: number, y: number, amp: number) => backdrop?.water?.ripple(x, y, amp) };
};

// the water look's intro (§7): a clear soap bubble swells at the centre to 210 px over 520 ms,
// holds 180 ms and pops into two ripples and a ring of fizz; then the page comes in. a click skips
// to the pop, and 2.5 s is the most it can take
const soapBubble = (page: HTMLElement | null, enter: () => void, water: TWater, fx: ReturnType<typeof createSparks>) => {
  page?.classList.add('hidden');
  const canvas = document.createElement('canvas');
  canvas.className = 'intro';
  document.body.append(canvas);
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  const ctx = canvas.getContext('2d')!;
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  const R = 105;
  const start = performance.now();
  let popped = false;

  const pop = () => {
    if (popped) return;
    popped = true;
    canvas.remove();
    water.ripple(cx, cy, -1.3, 9);
    water.ripple(cx + 34, cy - 22, -0.6, 5);
    fx.ring(cx, cy, 30, R * 0.9);
    enter();
  };

  const draw = (now: number) => {
    if (popped) return;
    const ms = now - start;
    if (ms > 700) return pop();
    const k = Math.min(1, ms / 520);
    const r = Math.max(2, R * (1 - Math.pow(1 - k, 3)));
    const tk = waterTokens();
    const rgba = (c: number[], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // the body: nearly clear, a little lighter toward the rim
    const body = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r);
    body.addColorStop(0, rgba(tk.spark, 0.02));
    body.addColorStop(0.8, rgba(tk.spark, 0.08));
    body.addColorStop(1, rgba(tk.spark, 0.22));
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    // the full thin-film rim, its colours turning
    const film = ctx.createConicGradient(ms / 600, cx, cy);
    ['#ff9ad5', '#ffe08a', '#8affd6', '#8ab8ff', '#d79aff', '#ff9ad5'].forEach((c, i, a) => film.addColorStop(i / (a.length - 1), c));
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = film;
    ctx.lineWidth = Math.max(1, r * 0.08);
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.955, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = rgba(tk.spark, 0.85);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    // the window highlight and a smaller one opposite
    ctx.fillStyle = rgba(tk.spark, 0.9);
    ctx.beginPath();
    ctx.ellipse(cx - r * 0.38, cy - r * 0.42, r * 0.22, r * 0.12, -0.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgba(tk.spark, 0.4);
    ctx.beginPath();
    ctx.ellipse(cx + r * 0.42, cy + r * 0.46, r * 0.1, r * 0.05, -0.7, 0, Math.PI * 2);
    ctx.fill();
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
  window.addEventListener('pointerdown', pop, { once: true });
  window.setTimeout(pop, 2500);
};

let toastEl: HTMLDivElement | null = null;
let toastTimer = 0;

export const toast = (text: string) => {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'toast';
    document.body.append(toastEl);
  }
  toastEl.textContent = text;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl?.classList.remove('show'), 2500);
};

export const hint = (el: HTMLElement, text: string, kind: 'good' | 'bad' | '' = '') => {
  el.textContent = text;
  el.className = `hint ${kind}`;
  if (kind === 'bad') {
    el.classList.add('shake');
    el.addEventListener('animationend', () => el.classList.remove('shake'), { once: true });
  }
};

/** mounts a segment row into `el`; returns a setter */
export const segment = <T extends string>(el: HTMLElement, options: { value: T; label: string }[], value: T, onChange: (v: T) => void) => {
  el.className = 'seg';
  el.innerHTML = '';
  const buttons = options.map((o) => {
    const b = document.createElement('button');
    b.textContent = o.label;
    b.onclick = () => { set(o.value); onChange(o.value); };
    el.append(b);
    return { b, v: o.value };
  });
  const set = (v: T) => buttons.forEach(({ b, v: bv }) => b.classList.toggle('on', bv === v));
  set(value);
  return set;
};
