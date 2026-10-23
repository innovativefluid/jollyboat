// The voice overlay (opt-in): a small always-on-top window listing who is in our voice channel,
// who talks, who is muted. It shows while we are in a call and the server window is not the
// focused one (you see Sharkord itself then). Clicks always go through it to whatever is
// underneath; "set position" in the settings makes it draggable once, until its done button.
//
// Wayland: the desktop places windows and decides about "always on top" (an app can neither
// move its window nor learn where it is), so there is no "set position" there; KDE can keep
// it above and in place with a window rule.

import { BrowserWindow, screen } from 'electron';
import type { TOverlayState, TVoiceMember, TVoiceState } from '../shared/types';
import { t } from './lang';
import { iconPath, pageUrl, preloadPath } from './paths';
import { getSettings, saveSettings } from './settings';

const WIDTH = 240;

let win: BrowserWindow | null = null;
let inVoice = false;
let positioning = false;
let channel = '';
let members: TVoiceMember[] = [];
let theme: 'light' | 'dark' = 'light';
let hostFocused = false;
let height = 60;
let lastSent = '';

export const isWayland = () => process.platform === 'linux' && (process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY);

const wanted = () => getSettings().overlay && (positioning || (inVoice && !hostFocused));

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

// while it is being placed outside a call: a stand-in row, so it has its usual size
const sample = (): TVoiceMember[] => [{ name: t('you'), self: false, speaking: true, micMuted: false, deafened: false, sharing: false, video: false }];

const state = (): TOverlayState => ({
  channel: positioning && !inVoice ? t('voice') : channel,
  members: positioning && !members.length ? sample() : members,
  theme,
  opacity: getSettings().overlayOpacity,
  positioning
});

/** clicks pass through, except while it is being placed */
const applyMouse = () => win?.setIgnoreMouseEvents(!positioning, { forward: false });

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
    applyMouse();
    send();
    if (wanted()) (positioning ? win?.show() : win?.showInactive());
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
    positioning = false;
    win?.destroy();
    win = null;
    return;
  }
  if (!wanted()) {
    win?.hide();
    return;
  }
  if (!win) return create();
  applyMouse();
  send();
  if (!win.isVisible()) win.showInactive();
};

export const setOverlayVoice = (next: TVoiceState, name: string, list: TVoiceMember[]) => {
  inVoice = next.inVoice;
  channel = name;
  members = inVoice ? list : [];
  refreshOverlay();
};

/** "set position": shown and draggable until its done button (not on wayland, see above) */
export const startPositioning = () => {
  if (!getSettings().overlay || isWayland()) return;
  positioning = true;
  if (!win) return create();
  applyMouse();
  send();
  win.show();
  win.focus();
};

export const finishPositioning = (sender: Electron.WebContents) => {
  if (!positioning || !win || sender !== win.webContents) return;
  positioning = false;
  if (win) {
    const [x, y] = win.getPosition();
    saveSettings({ overlayPosition: { x: x!, y: y! } });
  }
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
  `overlay: ${getSettings().overlay ? `on, ${getSettings().overlayOpacity}% background${getSettings().overlayPosition ? ', placed' : ''}${win?.isVisible() ? ', showing' : ''}${isWayland() ? ', wayland' : ''}` : 'off'}`;
