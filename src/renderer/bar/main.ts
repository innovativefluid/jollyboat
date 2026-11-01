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
// two views can show this page: the whole bar (or, merged with sharkord's top bar, its left end:
// mark, tabs, +), and the right end (zoom, settings, window buttons) while merged
const part = new URLSearchParams(location.search).get('part') === 'right' ? 'right' : 'main';
document.body.classList.add(`part-${part}`);
// merged, the page under the bar draws its background (the water too): ours is see-through
let mergedNow = part === 'right';
document.body.classList.toggle('merged', mergedNow);
let lookNow = window.shell.look;

let waterAs = '';
const startWater = (look: 'lcd' | 'water' | 'retro') => {
  lookNow = look;
  // (already running as wanted: left alone)
  const as = `${look}:${mergedNow}`;
  if (as === waterAs && (water || look !== 'water')) return;
  waterAs = as;
  water?.stop();
  waterCanvas?.remove();
  water = null;
  waterCanvas = null;
  document.documentElement.classList.remove('gl', 'no-gl');
  // merged, the page under the bar draws the bar's glass slab over its own water: this end
  // draws only its buttons' glass (with their water) on a see-through canvas
  document.querySelector('.bar')?.classList.toggle('slab', !mergedNow);
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
    transparent: mergedNow,
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

// a tab being dragged: the bar's state waits until it is dropped
let dragging: { el: HTMLElement; id: string; x0: number; moved: boolean; pending: TTab[] | null } | null = null;

const renderTabs = (list: TTab[]) => {
  if (dragging) {
    dragging.pending = list;
    return;
  }
  tabList = list;
  const els = new Map([...tabsEl.querySelectorAll<HTMLButtonElement>('.tab')].map((el) => [el.dataset.id!, el]));
  list.forEach((tab, i) => {
    let el = els.get(tab.id);
    els.delete(tab.id);
    if (!el) {
      el = document.createElement('button');
      el.className = 'chip tab';
      el.dataset.id = tab.id;
      el.innerHTML = `<span class="ico"></span><span class="tname"></span><span class="mark"></span><span class="x" role="button" aria-label="${t('Close tab')}" title="${t('Close tab')}"><svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 2l6 6M8 2l-6 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg></span>`;
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
// what the tabs would take if all of them showed (the merged bar's left end asks for it)
let naturalTabs = 0;
const fitTabs = () => {
  const els = [...tabsEl.querySelectorAll<HTMLButtonElement>('.tab')];
  els.forEach((el) => (el.hidden = false));
  moreTabs.hidden = true;
  tabsEl.style.minWidth = '';
  naturalTabs = 0;
  if (!document.body.classList.contains('tabs-on')) return reportSize();
  naturalTabs = els.reduce((n, el) => n + el.getBoundingClientRect().width + 6, 0);
  // the one shown always has its room
  const shownTab = els.find((el) => el.classList.contains('fill'));
  if (shownTab) tabsEl.style.minWidth = `${Math.ceil(shownTab.getBoundingClientRect().width / (parseFloat(document.documentElement.style.zoom) || 1)) + 2}px`;
  const room = tabsEl.getBoundingClientRect().width;
  const total = tabsEl.scrollWidth;
  if (total <= room + 1) return reportSize();
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
  reportSize();
};
window.addEventListener('resize', fitTabs);
void document.fonts.ready.then(() => fitTabs());

// merged, each end of the bar is a view as wide as what it shows: it tells main what it needs
// (window px; css zoom may or may not scale the rects, the root's rect against the window says)
let lastNeed = -1;
const reportSize = () => {
  const bar = document.querySelector<HTMLElement>('.bar')!;
  const k = window.innerWidth / (document.documentElement.getBoundingClientRect().width || window.innerWidth);
  const shown = [...bar.children].filter((el) => el.getClientRects().length > 0 && !el.classList.contains('spacer')) as HTMLElement[];
  if (!shown.length) return;
  // the natural width: every shown part at its own size (they do not shrink), the tabs as if all
  // of them showed, the server name unclipped
  // (rects come zoomed, computed lengths not: scale is the css zoom)
  const scale = (document.documentElement.getBoundingClientRect().width || window.innerWidth) / (bar.offsetWidth || 1);
  const cs = getComputedStyle(bar);
  const gap = parseFloat(cs.columnGap) || 0;
  let need = ((parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0) + gap * (shown.length - 1)) * scale;
  for (const el of shown) {
    const m = getComputedStyle(el);
    const w = el === tabsEl ? naturalTabs : el.classList.contains('name') ? el.scrollWidth * scale : el.getBoundingClientRect().width;
    need += w + ((parseFloat(m.marginLeft) || 0) + (parseFloat(m.marginRight) || 0)) * scale;
  }
  need += 4 * scale;
  need = Math.ceil(need * k);
  if (need === lastNeed) return;
  lastNeed = need;
  window.shell.barSize(need);
};

// a click that ended a drag is not a click
let swallowClick = false;
tabsEl.addEventListener('click', (e) => {
  if (swallowClick) {
    swallowClick = false;
    return;
  }
  const el = (e.target as HTMLElement).closest<HTMLElement>('.tab');
  if (!el) return;
  if ((e.target as HTMLElement).closest('.x')) window.shell.barAction('tab-close', undefined, el.dataset.id);
  else window.shell.barAction('tab', undefined, el.dataset.id);
});

// dragging a tab along the bar puts it elsewhere: the others make room as it passes; dropped,
// main takes the new order (and keeps it for the next start)
const shownTabs = () => [...tabsEl.querySelectorAll<HTMLElement>('.tab')].filter((el) => !el.hidden);
tabsEl.addEventListener('pointerdown', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('.tab');
  if (!el || e.button !== 0 || (e.target as HTMLElement).closest('.x')) return;
  dragging = { el, id: el.dataset.id!, x0: e.clientX, moved: false, pending: null };
});
// the new order while dragging: the others by their resting place, the dragged one by where it is now
const orderNow = () => {
  if (!dragging) return [];
  const d = dragging;
  const els = shownTabs();
  const centre = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const shift = el === d.el ? 0 : new DOMMatrixReadOnly(getComputedStyle(el).transform).m41 * (r.width / (el.offsetWidth || 1));
    return r.left - shift + r.width / 2;
  };
  return els.map((el) => ({ el, c: centre(el) })).sort((a, b) => a.c - b.c).map((x) => x.el);
};
tabsEl.addEventListener('pointermove', (e) => {
  const d = dragging;
  if (!d) return;
  const dx = e.clientX - d.x0;
  if (!d.moved) {
    if (Math.abs(dx) < 6) return;
    d.moved = true;
    d.el.setPointerCapture(e.pointerId);
    d.el.classList.add('dragging');
    tabsEl.classList.add('dragging');
  }
  // (transforms are css px, the pointer is zoomed)
  const z = parseFloat(document.documentElement.style.zoom) || 1;
  d.el.style.transform = `translateX(${dx / z}px)`;
  // the others slide to their places in the new order
  const els = shownTabs();
  const lefts = els.map((el) => el.offsetLeft);
  const order = orderNow();
  let x = Math.min(...lefts);
  for (const el of order) {
    if (el !== d.el) el.style.transform = `translateX(${x - el.offsetLeft}px)`;
    x += el.offsetWidth + 6;
  }
});
const endDrag = () => {
  const d = dragging;
  if (!d) return;
  if (d.moved) {
    const order = orderNow().map((el) => el.dataset.id!);
    swallowClick = true;
    setTimeout(() => (swallowClick = false), 0);
    // the tabs that are in the » menu keep their places among the rest
    const all = tabList.map((t) => t.id);
    const shownIds = new Set(order);
    let i = 0;
    const next = all.map((id) => (shownIds.has(id) ? order[i++]! : id));
    window.shell.barAction('tab-move', undefined, next);
  }
  for (const el of tabsEl.querySelectorAll<HTMLElement>('.tab')) el.style.transform = '';
  d.el.classList.remove('dragging');
  tabsEl.classList.remove('dragging');
  dragging = null;
  if (d.pending) renderTabs(d.pending);
};
tabsEl.addEventListener('pointerup', endDrag);
tabsEl.addEventListener('pointercancel', endDrag);
tabsEl.addEventListener('lostpointercapture', endDrag);
// (a press that never became a drag may be let go anywhere)
window.addEventListener('pointerup', endDrag);
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

window.shell.onBarState((state: TBarState) => {
  const merge = part === 'right' || state.merged;
  if (merge !== mergedNow) {
    mergedNow = merge;
    document.body.classList.toggle('merged', merge);
    startWater(lookNow);
  }
  document.body.classList.toggle('dim', state.dim);
  document.body.classList.toggle('tabs-on', state.showTabs && state.tabs.length > 0);
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
