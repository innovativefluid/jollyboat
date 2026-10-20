// the bar above a server page: which server, zoom, the way to the app's own window, and a menu
// for the rest. follows the system's light/dark setting (css), the mark too

import boatMap from '../../../build/pixel/icon-16.txt?raw';

const $ = (id: string) => document.getElementById(id)!;
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

const drawMark = (t = performance.now() / 1000) => {
  const bob = Math.sin((t * Math.PI * 2) / 3.2) > 0.2 ? 1 : 0; // down a pixel for part of each swell
  const drift = Math.floor(t * 2.5); // the water moves a pixel every 0.4 s

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
  drawMark();
};

repaint();
dark.addEventListener('change', repaint);
setInterval(() => {
  if (!document.hidden) drawMark();
}, 100);

$('settings').onclick = () => window.shell.barAction('settings');
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

window.shell.onBarState((state) => {
  if (state.theme) document.documentElement.dataset.theme = state.theme;
  else delete document.documentElement.dataset.theme;
  repaint();
  $('server').textContent = state.server;
  $('max-icon').querySelector('path')!.setAttribute('d', state.maximized ? RESTORE : MAXIMIZE);
  $('maximize').title = state.maximized ? 'restore' : 'maximize';
  $('zoom').textContent = `${Math.round(state.zoom * 100)}%`;
});
