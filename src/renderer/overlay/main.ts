// the voice overlay page: who is in the call, who talks (filled row), who is muted

import type { TOverlayState, TVoiceMember } from '../../shared/types';
import { t, translatePage } from '../i18n';

// 12×12 pixel icons, drawn like the bar's window buttons
const ICONS = {
  micOff:
    '<svg viewBox="0 0 12 12"><path d="M4 1h4v6H4zM2 5h1v2H2zM9 5h1v2H9zM3 7h1v1H3zM8 7h1v1H8zM4 8h4v1H4zM5 9h2v1H5zM3 10h6v1H3z" fill="currentColor" opacity=".55"/><path d="M0 0h2v2H0zM2 2h2v2H2zM4 4h2v2H4zM6 6h2v2H6zM8 8h2v2H8zM10 10h2v2h-2z" fill="currentColor"/></svg>',
  deafened:
    '<svg viewBox="0 0 12 12"><path d="M3 2h6v1H3zM2 3h1v3H2zM9 3h1v3H9zM1 6h3v4H1zM8 6h3v4H8z" fill="currentColor" opacity=".55"/><path d="M0 0h2v2H0zM2 2h2v2H2zM4 4h2v2H4zM6 6h2v2H6zM8 8h2v2H8zM10 10h2v2h-2z" fill="currentColor"/></svg>',
  sharing: '<svg viewBox="0 0 12 12"><path d="M0 1h12v8H0zM2 3v4h8V3zM4 10h4v1H4z" fill="currentColor" fill-rule="evenodd"/></svg>',
  video: '<svg viewBox="0 0 12 12"><path d="M0 3h8v6H0zM8 5h1v2H8zM9 4h1v4H9zM10 3h2v6h-2z" fill="currentColor"/></svg>'
};

// sharkord's speaking ring flickers between words; a row stays filled a little longer
const HOLD_MS = 350;
const lastSpoke = new Map<string, number>();
let state: TOverlayState | null = null;

translatePage();
const card = document.getElementById('card')!;
const mic = document.getElementById('mic') as HTMLButtonElement;
const sound = document.getElementById('sound') as HTMLButtonElement;
const popout = document.getElementById('popout') as HTMLButtonElement;
mic.onclick = () => window.shell.overlayAction('mic');
sound.onclick = () => window.shell.overlayAction('sound');
popout.onclick = () => window.shell.overlayAction('popout');
const rows = document.getElementById('rows')!;
const channel = document.getElementById('channel')!;

const rowFor = (m: TVoiceMember, now: number) => {
  if (m.speaking) lastSpoke.set(m.name, now);
  const talking = !m.micMuted && !m.deafened && now - (lastSpoke.get(m.name) ?? 0) < HOLD_MS;

  const row = document.createElement('div');
  row.className = `row${talking ? ' talking' : ''}${m.micMuted || m.deafened ? ' quiet' : ''}`;
  const dot = document.createElement('span');
  dot.className = 'dot';
  const who = document.createElement('span');
  who.className = 'who';
  who.textContent = m.name;
  if (m.self) {
    const you = document.createElement('span');
    you.className = 'self';
    you.textContent = ` (${t('you')})`;
    who.append(you);
  }
  const icons = document.createElement('span');
  icons.className = 'icons';
  icons.innerHTML = [m.sharing && ICONS.sharing, m.video && ICONS.video, m.deafened ? ICONS.deafened : m.micMuted && ICONS.micOff].filter(Boolean).join('');
  row.append(dot, who, icons);
  return row;
};

let holdTimer = 0;
const render = () => {
  if (!state) return;
  const now = Date.now();
  document.documentElement.dataset.theme = state.theme;
  document.documentElement.style.setProperty('--alpha', String(state.opacity / 100));
  channel.textContent = state.channel ? `> ${state.channel}` : `> ${t('voice')}`;
  document.documentElement.classList.toggle('click-through', state.clickThrough);
  mic.classList.toggle('on', state.micMuted);
  mic.title = state.micMuted ? t('unmute') : t('mute');
  sound.classList.toggle('on', state.deafened);
  sound.title = state.deafened ? t('undeafen') : t('deafen');
  popout.hidden = !state.streams;
  rows.replaceChildren(...state.members.map((m) => rowFor(m, now)));
  if (!state.members.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = t('in a call');
    rows.append(empty);
  }
  // re-render once the hold of someone who just stopped runs out
  clearTimeout(holdTimer);
  if (state.members.some((m) => !m.speaking && now - (lastSpoke.get(m.name) ?? 0) < HOLD_MS)) holdTimer = window.setTimeout(render, HOLD_MS);
};

window.shell.onOverlayState((next) => {
  state = next;
  render();
});

new ResizeObserver(() => window.shell.overlayHeight(card.offsetHeight + 8)).observe(card);
