// The voice overlay (opt-in): a small always-on-top window listing who is in our voice channel,
// who talks, who is muted. It shows while we are in a call and the server window is not the
// focused one (you see Sharkord itself then), and remembers where it was dragged to.
//
// Wayland: the desktop places windows and decides about "always on top", so there the overlay is
// a normal small window (KDE can keep it above with a window rule).

import { BrowserWindow, screen } from 'electron';
import type { TOverlayState, TVoiceMember } from '../shared/types';
import { iconPath, pageUrl, preloadPath } from './paths';
import { getSettings, saveSettings } from './settings';

const WIDTH = 240;

let win: BrowserWindow | null = null;
let inVoice = false;
let channel = '';
let members: TVoiceMember[] = [];
let theme: 'light' | 'dark' = 'light';
let hostFocused = false;
let height = 60;
let lastSent = '';

export const isWayland = () => process.platform === 'linux' && (process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY);

const wanted = () => getSettings().overlay && inVoice && !hostFocused;

/** the saved position, if it is still on a display; else the top left of the main display */
const position = () => {
  const saved = getSettings().overlayPosition;
  if (saved) {
    const area = screen.getDisplayMatching({ x: saved.x, y: saved.y, width: WIDTH, height }).workArea;
    if (saved.x >= area.x - WIDTH / 2 && saved.x < area.x + area.width - 20 && saved.y >= area.y - 10 && saved.y < area.y + area.height - 20) return saved;
  }
  const area = screen.getPrimaryDisplay().workArea;
  return { x: area.x + 24, y: area.y + 24 };
};

const state = (): TOverlayState => ({ channel, members, theme, opacity: getSettings().overlayOpacity });

const send = () => {
  if (!win || win.isDestroyed()) return;
  const next = JSON.stringify(state());
  if (next === lastSent) return;
  lastSent = next;
  win.webContents.send('overlay:state', state());
};

const create = () => {
  const { x, y } = position();

  win = new BrowserWindow({
    x,
    y,
    width: WIDTH,
    height,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: 'Jollyboat voice',
    icon: iconPath(),
    webPreferences: { preload: preloadPath(), sandbox: true, contextIsolation: true, backgroundThrottling: false }
  });

  // above fullscreen games and on every workspace, where the system allows it
  win.setAlwaysOnTop(true, 'screen-saver');
  // left out of screen captures (windows 10 2004+, mac): a shared screen does not carry the
  // overlay along, and the others in the call do not see the list twice
  win.setContentProtection(true);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.on('did-finish-load', () => {
    lastSent = '';
    send();
    if (wanted()) win?.showInactive();
  });
  // a drag fires this many times: the spot is written once it comes to rest
  let moveTimer: NodeJS.Timeout | null = null;
  win.on('moved', () => {
    if (moveTimer) clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
      moveTimer = null;
      if (!win) return;
      const [nx, ny] = win.getPosition();
      saveSettings({ overlayPosition: { x: nx!, y: ny! } });
    }, 400);
  });
  win.on('closed', () => {
    win = null;
    lastSent = '';
  });

  win.loadURL(pageUrl('overlay'));
};

/** show, hide or update the overlay after anything it depends on changed */
export const refreshOverlay = () => {
  if (!getSettings().overlay) {
    win?.destroy();
    win = null;
    return;
  }
  if (!wanted()) {
    win?.hide();
    return;
  }
  if (!win) return create();
  send();
  if (!win.isVisible()) win.showInactive();
};

export const setOverlayVoice = (voice: boolean, name: string, list: TVoiceMember[]) => {
  inVoice = voice;
  channel = name;
  members = voice ? list : [];
  refreshOverlay();
};

export const setOverlayTheme = (next: 'light' | 'dark') => {
  theme = next;
  if (win) send();
};

/** the server window got or lost focus */
export const setOverlayHostFocused = (focused: boolean) => {
  hostFocused = focused;
  if (getSettings().overlay) refreshOverlay();
};

/** the page measured its content */
export const setOverlayHeight = (sender: Electron.WebContents, h: number) => {
  if (!win || sender !== win.webContents || !Number.isFinite(h)) return;
  height = Math.min(800, Math.max(30, Math.ceil(h)));
  const [w] = win.getContentSize();
  win.setContentSize(w ?? WIDTH, height);
};

export const describeOverlay = () =>
  `overlay: ${getSettings().overlay ? `on, ${getSettings().overlayOpacity}% background${win?.isVisible() ? ', showing' : ''}${isWayland() ? ', wayland' : ''}` : 'off'}`;
