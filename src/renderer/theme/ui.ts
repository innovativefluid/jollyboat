// small shared pieces: boot (the backdrop, sparks, strip), feedback on clicks, toast, hints, the
// page coming in.
//
// the backdrop follows the look live: the lcd paper (2d canvas) or the water (webgl2); without
// webgl2 the water look keeps its css gradient and css glass (html.no-gl).

import { createPaper } from './paper';
import { createSparks } from './sparks';
import { createStrip } from './strip';
import { createWater, type TWater } from './water/engine';
import { createGlassDom, type TGlassDom } from './water/glass-dom';
import { waterTokens } from './water/tokens';

type TLook = 'lcd' | 'water';
type TBackdrop = { stop: () => void; water?: TWater; dom?: TGlassDom };

// the hook a toast uses to make its bubble jiggle when it pops in
let onToast: ((el: Element) => void) | null = null;
const allowSoftGl = () => {
  try {
    return localStorage.getItem('jollyboat-soft-gl') === '1';
  } catch {
    return false;
  }
};

const lookNow = (): TLook => (document.documentElement.dataset.look === 'water' ? 'water' : 'lcd');

export const bootTheme = ({ boat = false, fps, pool }: { boat?: boolean; fps?: { focused: number; blurred: number }; pool?: () => { view: [number, number]; offset: [number, number] } } = {}) => {
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
    document.documentElement.classList.remove('no-gl', 'gl');
    const canvas = document.createElement('canvas');
    document.body.prepend(canvas);

    if (look === 'water') {
      canvas.className = 'water';
      const dom = createGlassDom({ boat });
      // an air bubble popped: fizz when clicked, a little for a big one surfacing
      const water = createWater(canvas, {
        tokens: waterTokens,
        scene: dom.scene,
        fps,
        pool,
        allowSoftware: allowSoftGl(),
        onPop: (x, y, strong, r) => (strong ? fx.burst(x, y, 10) : r > 10 && fx.burst(x, y, 4))
      });
      if (!water) {
        canvas.remove();
        document.documentElement.classList.add('no-gl');
        return;
      }
      dom.setPointer(water.pointer);
      document.documentElement.classList.add('gl');
      backdrop = { stop: water.stop, water, dom };
      onToast = (el) => {
        const r = el.getBoundingClientRect();
        dom.poke(el, r.width / 2, r.height / 2, 1);
      };
    } else {
      onToast = null;
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
    backdrop?.water?.ripple(r.left + r.width / 2, r.top + r.height / 2, amp, 7);
  };
  const poke = (el: Element, e: MouseEvent, strength: number) => {
    const r = el.getBoundingClientRect();
    backdrop?.dom?.poke(el, e.detail ? e.clientX - r.left : r.width / 2, e.detail ? e.clientY - r.top : r.height / 2, strength);
  };

  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const control = target.closest('.pill, .seg button, .chip');
    if (control) {
      if ((control as HTMLButtonElement).disabled) return;
      fx.burstAt(control, 5);
      if (control.matches('.pill')) rippleUnder(control, -0.45);
      poke(control, e, control.matches('.seg button') ? 0.8 : 1);
      return;
    }
    const box = target.closest('.check')?.querySelector('input');
    if (box && target instanceof HTMLInputElement) {
      fx.burstAt(box, 4);
      backdrop?.dom?.poke(box, 10, 10, 0.9);
      return;
    }
    // a tap on a panel: its membrane jiggles
    const panel = target.closest('.panel, .footer, .source');
    if (panel && !target.closest('button, input, label, a')) {
      poke(panel, e, 0.55);
      return;
    }
    // a tap on open water: pop an air bubble, else a drop
    const water = backdrop?.water;
    if (water && !target.closest('button, input, label, .footer, .title-block, .toast, a')) {
      if (!water.popAt(e.clientX, e.clientY)) water.ripple(e.clientX, e.clientY, -1.0, 5);
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

  // ---- the page comes in ---------------------------------------------------------------------

  const page = document.querySelector<HTMLElement>('.page');
  const enter = () => {
    if (!page) return;
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

  enter();

  return { fx, ripple: (x: number, y: number, amp: number) => backdrop?.water?.ripple(x, y, amp) };
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
  onToast?.(toastEl);
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
