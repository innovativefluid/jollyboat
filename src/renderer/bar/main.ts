// the bar above a server page: which server, zoom, the way to the app's own window, and a menu
// for the rest. follows the system's light/dark setting (css), the mark too

import boatMap from '../../../build/pixel/icon-16.txt?raw';
import { t, translatePage } from '../i18n';
import { createWater, type TWater } from '../theme/water/engine';
import { createGlassDom } from '../theme/water/glass-dom';
import { waterTokens } from '../theme/water/tokens';
import type { TBarState, TTab } from '../../shared/types';

const $ = (id: string) => document.getElementById(id)!;
translatePage();

// the water look: the bar is a glass slab over the same pool as the page below (its gradient
// spans a window, not 34 px), the chips glass bubbles. 60 frames a second while the window has
// focus (the page below usually holds the keyboard: the window's focus counts, not the bar's),
// 30 without; the mark moves with every frame
let water: TWater | null = null;
let waterCanvas: HTMLCanvasElement | null = null;
const glassDom = createGlassDom();
document.addEventListener('click', (e) => {
  const chip = (e.target as HTMLElement).closest('.chip');
  if (!chip || !water) return;
  const r = chip.getBoundingClientRect();
  glassDom.poke(chip, e.clientX - r.left, e.clientY - r.top, 1);
});
const startWater = (look: 'lcd' | 'water' | 'retro') => {
  water?.stop();
  waterCanvas?.remove();
  water = null;
  waterCanvas = null;
  document.documentElement.classList.remove('gl', 'no-gl');
  if (look !== 'water') return;
  waterCanvas = document.createElement('canvas');
  waterCanvas.className = 'water';
  document.body.prepend(waterCanvas);
  const dom = glassDom;
  let soft = false;
  try {
    soft = localStorage.getItem('jollyboat-soft-gl') === '1';
  } catch {
    /* storage blocked */
  }
  water = createWater(waterCanvas, {
    tokens: waterTokens,
    scene: dom.scene,
    fps: { focused: 60, blurred: 30 },
    focused: window.shell.windowFocused,
    glassWake: 0.6,
    onFrame: () => drawWaterMark(performance.now() / 1000, true),
    bubbles: 4,
    allowSoftware: soft,
    pool: () => ({ view: [window.innerWidth, 900], offset: [0, 0] }),
    zoom: () => parseFloat(document.documentElement.style.zoom) || 1
  });
  if (!water) {
    waterCanvas.remove();
    waterCanvas = null;
    document.documentElement.classList.add('no-gl');
    return;
  }
  dom.setPointer(water.pointer);
  document.documentElement.classList.add('gl');
};
startWater(window.shell.look);
window.shell.onLook(startWater);
if (window.shell.platform === 'darwin') document.body.classList.add('mac');
const dark = window.matchMedia('(prefers-color-scheme: dark)');

// the mark: the boat from the icon map bobbing a pixel on a line of water that drifts by.
// a few redraws a second of a 14 px canvas; nothing while the window is hidden
const rows = boatMap.split('\n');
const boat = rows.slice(0, 12);
let colours: Record<string, string> = {};

const readColours = () => {
  const css = getComputedStyle(document.documentElement);
  colours = {
    '#': css.getPropertyValue('--fg').trim(),
    g: css.getPropertyValue('--dim').trim(),
    w: css.getPropertyValue('--spark').trim()
  };
};

const canvas = document.querySelector<HTMLCanvasElement>('canvas.mark')!;
const ctx = canvas.getContext('2d')!;

let shown = '';

const drawMark = (t = performance.now() / 1000, force = false) => {
  const bob = Math.sin((t * Math.PI * 2) / 3.2) > 0.2 ? 1 : 0; // down a pixel for part of each swell
  const drift = Math.floor(t * 2.5); // the water moves a pixel every 0.4 s

  // only an actual change is drawn: about three frames a second instead of ten
  const key = `${bob}:${drift % 4}`;
  if (key === shown && !force) return;
  shown = key;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  boat.forEach((row, y) =>
    [...row].forEach((c, x) => {
      if (!colours[c]) return;
      ctx.fillStyle = colours[c];
      ctx.fillRect(x, y + bob, 1, 1);
    })
  );
  ctx.fillStyle = colours['#'];
  for (let x = 0; x < canvas.width; x++) if ((x + drift) % 4 < 2) ctx.fillRect(x, 13, 1, 1);
};

const repaint = () => {
  readColours();
  drawMark(undefined, true);
};

repaint();
dark.addEventListener('change', repaint);
// the water look's mark: the svg boat rocks and bobs, the water line drifts. with the css water
// a pixel at a time, only an actual change drawn, about three times a second (an svg animation
// in css would make the page tick every frame); with the gl water smoothly, once per its frame
const bob = document.querySelector<SVGGElement>('.mark-water .bob')!;
const flow = document.querySelector<SVGPathElement>('.mark-water .flow')!;
const calm = window.matchMedia('(prefers-reduced-motion: reduce)');
let shownWater = '';
const drawWaterMark = (t = performance.now() / 1000, smooth = false) => {
  const wave = Math.sin((t * Math.PI * 2) / 3.2) * 3; // -3..3
  const swell = smooth ? Math.round(wave * 20) / 20 : Math.round(wave);
  const drift = calm.matches ? 0 : smooth ? Math.round(((t * 2.5) % 8) * 20) / 20 : Math.floor(t * 2.5) % 8;
  const key = calm.matches ? 'still' : `${swell}:${drift}`;
  if (key === shownWater) return;
  shownWater = key;
  const s = calm.matches ? 0 : swell;
  bob.setAttribute('transform', `translate(0 ${((s + 3) / 6).toFixed(2)}) rotate(${s} 14 21)`);
  flow.setAttribute('transform', `translate(${-drift} 0)`);
};

setInterval(() => {
  if (document.hidden) return;
  if (document.documentElement.dataset.look === 'water') {
    if (!water) drawWaterMark();
  }
  else drawMark();
}, 100);
window.shell.onLook(repaint);

$('settings').onclick = () => window.shell.barAction('settings');
$('popout').onclick = () => window.shell.barAction('popout');
$('zoom-in').onclick = () => window.shell.barAction('zoom-in');
$('zoom-out').onclick = () => window.shell.barAction('zoom-out');
$('zoom').onclick = () => window.shell.barAction('zoom-reset');
$('minimize').onclick = () => window.shell.barAction('minimize');
$('maximize').onclick = () => window.shell.barAction('maximize');
$('close').onclick = () => window.shell.barAction('close');

const MAXIMIZE = 'M1 1h10v10H1z M3 3v6h6V3z';
const RESTORE = 'M3 1h8v8H9V3H3z M1 4h7v7H1z M3 6v3h3V6z';

$('more').onclick = () => {
  const r = $('more').getBoundingClientRect();
  window.shell.barAction('menu', { x: Math.round(r.left), y: Math.round(r.bottom) });
};

// --- the server tabs ------------------------------------------------------------------------
const tabsEl = $('tabs');
const moreTabs = $('more-tabs');
const VOICE = '<svg class="voice" viewBox="0 0 12 12" aria-hidden="true"><path d="M1 4h2l3-3v10L3 8H1z M8 3.5q2 2.5 0 5 M9.5 2q3.5 4 0 8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" /></svg>';
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => [...w][0]!.toUpperCase())
    .join('') || '?';

let tabList: TTab[] = [];
const at = (el: Element) => {
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left), y: Math.round(r.bottom) };
};

const renderTabs = (list: TTab[]) => {
  tabList = list;
  const els = new Map([...tabsEl.querySelectorAll<HTMLButtonElement>('.tab')].map((el) => [el.dataset.id!, el]));
  list.forEach((tab, i) => {
    let el = els.get(tab.id);
    els.delete(tab.id);
    if (!el) {
      el = document.createElement('button');
      el.className = 'chip tab';
      el.dataset.id = tab.id;
      el.innerHTML = '<span class="ico"></span><span class="tname"></span><span class="mark"></span>';
    }
    tabsEl.append(el); // in order
    el.classList.toggle('fill', tab.active);
    el.classList.toggle('off', tab.loading || tab.connection === 'disconnected' || tab.connection === 'signed-out');
    const ico = el.querySelector<HTMLElement>('.ico')!;
    if (tab.logo) {
      const img = ico.querySelector('img');
      if (img?.getAttribute('src') !== tab.logo) ico.innerHTML = `<img alt="" src="${tab.logo}">`;
    } else if (ico.textContent !== initials(tab.name) || ico.querySelector('img')) ico.textContent = initials(tab.name);
    el.querySelector('.tname')!.textContent = tab.name;
    const mark = el.querySelector<HTMLElement>('.mark')!;
    const markHtml = (tab.voice ? VOICE : '') + (tab.mentioned ? `<span class="count">${tab.unread > 99 ? '99+' : tab.unread || '@'}</span>` : !tab.active && tab.unread ? '<span class="unread"></span>' : '');
    if (mark.innerHTML !== markHtml) mark.innerHTML = markHtml;
    mark.style.display = markHtml ? 'contents' : 'none';
    const key = i < 8 ? `ctrl+${i + 1}` : i === list.length - 1 ? 'ctrl+9' : '';
    el.title = [tab.name, tab.unread ? t('{n} new', { n: tab.unread }) : '', key].filter(Boolean).join(' · ');
  });
  for (const el of els.values()) el.remove();
  fitTabs();
};

// the tabs that do not fit go into the » menu (the one shown always stays in the bar)
const fitTabs = () => {
  const els = [...tabsEl.querySelectorAll<HTMLButtonElement>('.tab')];
  els.forEach((el) => (el.hidden = false));
  moreTabs.hidden = true;
  tabsEl.style.minWidth = '';
  if (!document.body.classList.contains('tabs-on')) return;
  // the one shown always has its room
  const shownTab = els.find((el) => el.classList.contains('fill'));
  if (shownTab) tabsEl.style.minWidth = `${Math.ceil(shownTab.getBoundingClientRect().width / (parseFloat(document.documentElement.style.zoom) || 1)) + 2}px`;
  const room = tabsEl.getBoundingClientRect().width;
  const total = tabsEl.scrollWidth;
  if (total <= room + 1) return;
  moreTabs.hidden = false;
  // the room left with the » chip in the bar
  const budget = tabsEl.getBoundingClientRect().width;
  const gap = 6;
  const widths = els.map((el) => el.getBoundingClientRect().width + gap);
  const activeIdx = els.findIndex((el) => el.classList.contains('fill'));
  let used = activeIdx >= 0 ? widths[activeIdx]! : 0;
  const hidden: string[] = [];
  els.forEach((el, i) => {
    if (i === activeIdx) return;
    if (used + widths[i]! <= budget) used += widths[i]!;
    else {
      el.hidden = true;
      hidden.push(el.dataset.id!);
    }
  });
  moreTabs.dataset.ids = hidden.join(',');
  moreTabs.textContent = `» ${hidden.length}`;
};
window.addEventListener('resize', fitTabs);

tabsEl.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('.tab');
  if (el) window.shell.barAction('tab', undefined, el.dataset.id);
});
// middle click closes a tab, right click has its menu
tabsEl.addEventListener('auxclick', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('.tab');
  if (el && e.button === 1) window.shell.barAction('tab-close', undefined, el.dataset.id);
});
tabsEl.addEventListener('mousedown', (e) => e.button === 1 && e.preventDefault());
tabsEl.addEventListener('contextmenu', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('.tab');
  if (!el) return;
  e.preventDefault();
  window.shell.barAction('tab-menu', at(el), el.dataset.id);
});
moreTabs.onclick = () => window.shell.barAction('overflow', at(moreTabs), (moreTabs.dataset.ids ?? '').split(',').filter(Boolean));
$('add').onclick = () => window.shell.barAction('add', at($('add')));
$('tabs-toggle').onclick = () => window.shell.barAction('toggle-tabs');

window.shell.onBarState((state: TBarState) => {
  document.body.classList.toggle('tabs-on', state.showTabs && state.tabs.length > 0);
  $('tabs-toggle').textContent = state.showTabs ? '◂' : '▸';
  $('tabs-toggle').hidden = !state.tabs.length;
  // with the tabs the shown one is filled; the main button steps back
  $('settings').classList.toggle('fill', !(state.showTabs && state.tabs.length > 0));
  renderTabs(state.tabs);
  if (state.theme) document.documentElement.dataset.theme = state.theme;
  else delete document.documentElement.dataset.theme;
  repaint();
  $('server').textContent = state.server;
  $('max-icon').querySelector('path')!.setAttribute('d', state.maximized ? RESTORE : MAXIMIZE);
  $('maximize').title = state.maximized ? t('restore') : t('maximize');
  $('zoom').textContent = `${Math.round(state.zoom * 100)}%`;
  // the bar zooms with the page under it. css zoom, not the page zoom: chromium shares page zoom
  // between all pages of one origin, and the setup window, picker and overlay share ours
  document.documentElement.style.zoom = String(state.zoom);
  water?.resize();
  $('popout').hidden = !state.streams;
  fitTabs();
});
