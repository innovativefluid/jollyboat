// the bar above a server page: which server, zoom, the way to the app's own window, and a menu
// for the rest. follows the system's light/dark setting (css), the mark too

import boatMap from '../../../build/pixel/icon-16.txt?raw';

const $ = (id: string) => document.getElementById(id)!;
const dark = window.matchMedia('(prefers-color-scheme: dark)');

const drawMark = () => {
  const canvas = document.querySelector<HTMLCanvasElement>('canvas.mark')!;
  const ctx = canvas.getContext('2d')!;
  const css = getComputedStyle(document.documentElement);
  const colours: Record<string, string> = {
    '#': css.getPropertyValue('--fg').trim(),
    g: css.getPropertyValue('--dim').trim(),
    w: css.getPropertyValue('--spark').trim()
  };
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  boatMap.split('\n').forEach((row, y) =>
    [...row].forEach((c, x) => {
      if (!colours[c]) return;
      ctx.fillStyle = colours[c];
      ctx.fillRect(x, y, 1, 1);
    })
  );
};

drawMark();
dark.addEventListener('change', drawMark);

$('settings').onclick = () => window.shell.barAction('settings');
$('zoom-in').onclick = () => window.shell.barAction('zoom-in');
$('zoom-out').onclick = () => window.shell.barAction('zoom-out');
$('zoom').onclick = () => window.shell.barAction('zoom-reset');
$('more').onclick = () => {
  const r = $('more').getBoundingClientRect();
  window.shell.barAction('menu', { x: Math.round(r.left), y: Math.round(r.bottom) });
};

window.shell.onBarState((state) => {
  if (state.theme) document.documentElement.dataset.theme = state.theme;
  else delete document.documentElement.dataset.theme;
  drawMark();
  $('server').textContent = state.server;
  $('zoom').textContent = `${Math.round(state.zoom * 100)}%`;
});
