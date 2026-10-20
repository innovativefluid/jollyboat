// The tray shows the voice state (mic muted, deafened) and whether there are unread messages,
// and lets the user toggle mic / deafen from its menu (the preload clicks the buttons).

import { app, Menu, nativeImage, Tray, type BrowserWindow } from 'electron';
import { join } from 'node:path';
import type { TVoiceState } from '../shared/types';

type TTrayActions = {
  show: () => void;
  showLauncher: () => void;
  quit: () => void;
  voiceAction: (action: 'mic' | 'sound') => void;
  getMainWindow: () => BrowserWindow | null;
};

const state: TVoiceState & { unread: number; serverName: string } = {
  connected: false,
  inVoice: false,
  micMuted: false,
  deafened: false,
  unread: 0,
  serverName: ''
};

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
    if (state.unread > 0) win.setOverlayIcon(iconFor('overlay-unread'), `${state.unread} new messages`);
    else win.setOverlayIcon(null, '');
  } else {
    app.setBadgeCount(state.unread);
  }
};

const iconName = () => {
  const base = state.deafened ? 'deafened' : state.micMuted ? 'muted' : 'normal';

  return state.unread > 0 ? `${base}-unread` : base;
};

const tooltip = () => {
  const parts = ['Jollyboat'];

  if (state.serverName) parts.push(state.serverName);
  if (state.inVoice) parts.push(state.deafened ? 'deafened' : state.micMuted ? 'mic muted' : 'in voice');
  if (state.unread > 0) parts.push(`${state.unread} new`);

  return parts.join(' | ');
};

const render = () => {
  if (!tray || !actions) return;

  if (process.env.JOLLYBOAT_DEBUG) console.log('[tray]', iconName(), '|', tooltip());

  const img = iconFor(iconName());

  tray.setImage(img.isEmpty() ? nativeImage.createEmpty() : img);
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

export const setVoiceState = (next: TVoiceState) => {
  Object.assign(state, next);
  render();
};

export const setServerName = (name: string) => {
  state.serverName = name;
  if (!name) Object.assign(state, { connected: false, inVoice: false, micMuted: false, deafened: false });
  render();
};

export const addUnread = () => {
  state.unread += 1;
  render();
  actions?.getMainWindow()?.flashFrame(true);
};

export const clearUnread = () => {
  if (state.unread === 0) return;
  state.unread = 0;
  render();
  actions?.getMainWindow()?.flashFrame(false);
};

export const hasTray = () => !!tray;
