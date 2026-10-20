// The tray shows the voice state (mic muted, deafened) and whether there are unread messages,
// and lets the user toggle mic / deafen from its menu (the preload clicks the buttons).

import { app, Menu, nativeImage, Tray, type BrowserWindow } from 'electron';
import { join } from 'node:path';
import type { TVoiceState } from '../shared/types';
import { log } from './log';

type TTrayActions = {
  show: () => void;
  showLauncher: () => void;
  quit: () => void;
  voiceAction: (action: 'mic' | 'sound') => void;
  getMainWindow: () => BrowserWindow | null;
};

// unread has two sources: notifications that arrived while the window was in the background
// (cleared when it gets focus) and the count Sharkord puts in its page title, "name (3)", which
// Sharkord itself clears as channels are read. The marker shows the larger of the two.
const state: TVoiceState & { notified: number; titled: number; serverName: string } = {
  connected: false,
  inVoice: false,
  micMuted: false,
  deafened: false,
  speaking: false,
  notified: 0,
  titled: 0,
  serverName: ''
};

const unread = () => Math.max(state.notified, state.titled);

let tray: Tray | null = null;
let actions: TTrayActions | null = null;
const icons = new Map<string, Electron.NativeImage>();

// windows wants an .ico (several sizes, no smoothing); everywhere else the png is fine
const iconFor = (name: string) => {
  let img = icons.get(name);

  if (!img) {
    const ext = process.platform === 'win32' ? 'ico' : 'png';
    img = nativeImage.createFromPath(join(__dirname, `../../resources/tray/${name}.${ext}`));
    icons.set(name, img);
  }

  return img;
};

// the unread marker outside the tray: a taskbar overlay on windows, a launcher badge elsewhere
const renderBadge = () => {
  const win = actions?.getMainWindow();

  if (process.platform === 'win32') {
    if (!win) return;
    if (unread() > 0) win.setOverlayIcon(iconFor('overlay-unread'), `${unread()} new messages`);
    else win.setOverlayIcon(null, '');
  } else {
    app.setBadgeCount(unread());
  }
};

const iconName = () => {
  const base = state.deafened ? 'deafened' : state.micMuted ? 'muted' : state.inVoice ? (state.speaking ? 'talking' : 'voice') : 'normal';

  return unread() > 0 ? `${base}-unread` : base;
};

const tooltip = () => {
  const parts = ['Jollyboat'];

  if (state.serverName) parts.push(state.serverName);
  if (state.inVoice) parts.push(state.deafened ? 'deafened' : state.micMuted ? 'mic muted' : 'in voice');
  if (unread() > 0) parts.push(`${unread()} new`);

  return parts.join(' | ');
};

// the icon alone: talking flips many times a minute and needs no new menu or tooltip
let shownIcon = '';
const renderIcon = () => {
  if (!tray) return;
  const name = iconName();
  if (name === shownIcon) return;
  shownIcon = name;
  log('tray', 'icon', name);
  const img = iconFor(name);
  tray.setImage(img.isEmpty() ? nativeImage.createEmpty() : img);
};

const render = () => {
  if (!tray || !actions) return;

  log('tray', tooltip());
  renderIcon();
  tray.setToolTip(tooltip());
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: state.serverName ? `Show ${state.serverName}` : 'Show Jollyboat', click: actions.show },
      { label: 'Servers…', click: actions.showLauncher },
      { type: 'separator' },
      {
        label: state.micMuted ? 'Unmute microphone' : 'Mute microphone',
        enabled: state.connected,
        click: () => actions?.voiceAction('mic')
      },
      {
        label: state.deafened ? 'Undeafen' : 'Deafen',
        enabled: state.connected,
        click: () => actions?.voiceAction('sound')
      },
      { type: 'separator' },
      { label: 'Quit', click: actions.quit }
    ])
  );

  renderBadge();
};

export const createTray = (a: TTrayActions) => {
  actions = a;
  tray = new Tray(nativeImage.createEmpty());
  tray.on('click', a.show);
  render();

  return tray;
};

// the sail stays filled for a moment after the voice stops, so pauses between words do not flicker
let releaseTimer: NodeJS.Timeout | null = null;

export const setVoiceState = (next: TVoiceState) => {
  const { speaking, ...rest } = next;
  const onlySpeaking = (Object.keys(rest) as (keyof typeof rest)[]).every((k) => state[k] === rest[k]);

  if (releaseTimer) clearTimeout(releaseTimer);
  releaseTimer = null;

  if (speaking || !state.speaking || !onlySpeaking) {
    Object.assign(state, next);
    if (onlySpeaking) renderIcon();
    else render();
    return;
  }

  Object.assign(state, rest);
  releaseTimer = setTimeout(() => {
    state.speaking = false;
    renderIcon();
  }, 400);
};

export const setServerName = (name: string) => {
  state.serverName = name;
  if (!name) Object.assign(state, { connected: false, inVoice: false, micMuted: false, deafened: false, titled: 0 });
  render();
};

export const addUnread = () => {
  state.notified += 1;
  render();
  actions?.getMainWindow()?.flashFrame(true);
};

export const setTitleUnread = (count: number) => {
  if (state.titled === count) return;
  state.titled = count;
  render();
};

/** the window got focus: notification-driven marks are seen; the title count is Sharkord's to clear */
export const clearUnread = () => {
  if (state.notified === 0) return;
  state.notified = 0;
  render();
  actions?.getMainWindow()?.flashFrame(false);
};

export const hasTray = () => !!tray;

/** one line for diagnostics */
export const describeTray = () =>
  `tray: ${tray ? 'created' : 'none'} | icon ${iconName()} | page ${state.connected ? 'controls found' : 'no controls'} | voice ${state.inVoice} | talking ${state.speaking} | mic muted ${state.micMuted} | deafened ${state.deafened} | unread ${unread()}`;
