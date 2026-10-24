// The tray shows the voice state (mic muted, deafened) and whether there are unread messages,
// and lets the user toggle mic / deafen from its menu (the preload clicks the buttons).

import { app, Menu, nativeImage, Tray, type BaseWindow } from 'electron';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TVoiceState } from '../shared/types';
import { log } from './log';
import { t, whenLanguageChanges } from './lang';
import { getSettings } from './settings';

type TTrayActions = {
  toggle: () => void;
  show: () => void;
  showLauncher: () => void;
  quit: () => void;
  voiceAction: (action: 'mic' | 'sound' | 'leave') => void;
  getMainWindow: () => BaseWindow | null;
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

// one set of icons per theme, each from the theme's dark scheme (tools/make-icons.py): the lcd
// pixel boat for the Jollyboat theme, the same boat in Sharkord's greys for Sharkord itself (and
// custom css), a glass tile of water for the Water theme
type TTraySet = 'lcd' | 'sharkord' | 'water';
const traySet = (): TTraySet => {
  const theme = getSettings().theme;
  return theme === 'water' ? 'water' : theme === 'jollyboat' ? 'lcd' : 'sharkord';
};

// windows wants an .ico (several sizes); everywhere else the png is fine
const iconFor = (name: string) => {
  const set = traySet();
  const key = `${set}/${name}`;
  let img = icons.get(key);

  if (!img) {
    const ext = process.platform === 'win32' ? 'ico' : 'png';
    const path = join(__dirname, `../../resources/tray/${set}/${name}.${ext}`);
    // the mac menu bar is 16 pt tall: the 32 px icon goes in as its @2x
    img = process.platform === 'darwin' ? nativeImage.createFromBuffer(readFileSync(path), { scaleFactor: 2 }) : nativeImage.createFromPath(path);
    icons.set(key, img);
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
  if (state.inVoice) parts.push(state.deafened ? t('deafened') : state.micMuted ? t('mic muted') : t('in voice'));
  if (unread() > 0) parts.push(t('{n} new', { n: unread() }));

  return parts.join(' | ');
};

// the icon alone: talking flips many times a minute and needs no new menu or tooltip
let shownIcon = '';
const renderIcon = () => {
  if (!tray) return;
  const name = iconName();
  const key = `${traySet()}/${name}`;
  if (key === shownIcon) return;
  shownIcon = key;
  log('tray', 'icon', key);
  const img = iconFor(name);
  tray.setImage(img.isEmpty() ? nativeImage.createEmpty() : img);
};

const render = () => {
  if (!tray || !actions) return;

  // the state without the server's name: diagnostics carry no server names
  log('tray', [state.inVoice ? (state.deafened ? 'deafened' : state.micMuted ? 'mic muted' : 'in voice') : state.serverName ? 'connected' : 'no server', unread() ? `${unread()} new` : ''].filter(Boolean).join(' | '));
  renderIcon();
  tray.setToolTip(tooltip());
  tray.setContextMenu(
    Menu.buildFromTemplate([
      ...(state.serverName ? [{ label: state.serverName, enabled: false }] : []),
      { label: t('Show'), click: actions.show },
      { label: t('Servers and settings…'), click: actions.showLauncher },
      { type: 'separator' },
      {
        label: state.micMuted ? t('Unmute microphone') : t('Mute microphone'),
        enabled: state.connected,
        click: () => actions?.voiceAction('mic')
      },
      {
        label: state.deafened ? t('Undeafen') : t('Deafen'),
        enabled: state.connected,
        click: () => actions?.voiceAction('sound')
      },
      ...(state.inVoice ? [{ label: t('Leave call'), click: () => actions?.voiceAction('leave') }] : []),
      { type: 'separator' },
      { label: t('Quit'), click: actions.quit }
    ])
  );

  renderBadge();
};

export const createTray = (a: TTrayActions) => {
  actions = a;
  tray = new Tray(nativeImage.createEmpty());
  // left click shows the window, or puts it away when it is already in front
  tray.on('click', a.toggle);
  render();
  whenLanguageChanges(render);

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

/** the theme changed: its icons (the tray's, the taskbar overlay) */
export const refreshTrayTheme = () => {
  if (!tray) return;
  renderIcon();
  renderBadge();
};

export const hasTray = () => !!tray;

/** one line for diagnostics */
export const describeTray = () =>
  `tray: ${tray ? 'created' : 'none'} | icon ${traySet()}/${iconName()} | page ${state.connected ? 'controls found' : 'no controls'} | voice ${state.inVoice} | talking ${state.speaking} | mic muted ${state.micMuted} | deafened ${state.deafened} | unread ${unread()}`;
