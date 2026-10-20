// small shared pieces: boot (paper, sparks, strip), toast, hints, intro.

import { createPaper } from './paper';
import { createSparks } from './sparks';
import { createStrip } from './strip';

export type TFx = ReturnType<typeof createSparks>;

export const bootTheme = () => {
  const paperCanvas = document.createElement('canvas');
  paperCanvas.className = 'paper';
  document.body.prepend(paperCanvas);
  const paper = createPaper(paperCanvas);

  const sparksCanvas = document.createElement('canvas');
  sparksCanvas.className = 'sparks';
  document.body.append(sparksCanvas);
  const fx = createSparks(sparksCanvas);

  document.querySelectorAll<HTMLCanvasElement>('canvas.strip').forEach(createStrip);

  // for tuning from devtools: window.__paperCost()
  (window as unknown as { __paperCost: () => number }).__paperCost = () => paper.cost();

  // intro: the page fades in while scaling from .96, panels stream in 30 ms apart
  const page = document.querySelector<HTMLElement>('.page');
  if (page) {
    page.classList.add('enter');
    document.querySelectorAll<HTMLElement>('.panel').forEach((panel, i) => {
      panel.classList.add('enter');
      panel.style.animationDelay = `${i * 30}ms, 0ms`;
      panel.addEventListener('animationend', () => { panel.classList.remove('enter'); panel.style.animationDelay = ''; }, { once: true });
    });
  }

  return { paper, fx };
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
