import { app, BaseWindow, BrowserWindow, ipcMain, Menu, nativeTheme, screen, session, shell, WebContentsView } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { installBasicAuth, refreshBasicAuth } from './basic-auth';
import { getBridgeStatus, setHotkeyRanking, startBridge, stopBridge } from './hotkeys/bridge';
import { registerIpc } from './ipc';
import { iconPath, isOwnPageUrl, originOf, pageUrl, preloadPath } from './paths';
import { currentLook, windowBackground } from './look';
import { installDisplayMediaHandler } from './screen-share';
import { installContextMenu, installDownloads, isServerFile, saveUrl } from './downloads';
import { allowsHid, installControllers } from './controllers';
import { integrateAppImage } from './appimage';
import { refreshAutoStart } from './autostart';
import { claimLinksIfFree, findDeepLink, parseDeepLink, PROTOCOL } from './deeplinks';
import { findServerByUrl, getSettings, onServersChanged, saveSettings } from './settings';
import { log } from './log';
import { addUnread, clearUnread, createTray, hasTray, setServerName, setTitleUnread, setVoiceState } from './tray';
import { installDesktopBridge, sendListVisible, type TConnection } from './desktop';
import type { TBarState, TTab, TVoiceMember, TVoiceState } from '../shared/types';
import { applySpellcheck, blockDictionaryDownloads } from './privacy';
import { initScreenAudio, soundAppsSupported, stopPipeWireShare } from './screen-audio';
import { canSelfUpdate, loadAutoUpdater, startUpdater } from './updater';
import { cleanPortableLeftovers, portableFile, swapPortable } from './portable-update';
import { askPrompt } from './prompt';
import { t } from './lang';
import { setOverlayHostFocused, setOverlayTheme, setOverlayVoice } from './overlay';
import { bindMainPage, onStreams, popOutStream, setStreams, streamCount } from './popout';
import { installCustomCss } from './customcss';
import { applyColorMode } from './colormode';

// windows: toast notifications and taskbar grouping need the same AppUserModelId the installer
// writes into the start-menu shortcut (electron-builder uses appId)
if (process.platform === 'win32') app.setAppUserModelId('net.innovativefluid.Jollyboat');

// GlobalShortcutsPortal: lets globalShortcut work on Wayland through xdg-desktop-portal
// (KDE Plasma, newer GNOME). WebRTCPipeWireCapturer: screen capture through the portal.
// PulseaudioLoopbackForScreenShare: system audio for screen shares on linux when pipewire/venmic
// is not available (see screen-audio.ts). AcceleratedVideoEncoder: on linux, screen shares (and
// webcams) are encoded on the gpu through VA-API when the driver can do the codec sharkord picked;
// otherwise chromium falls back to software. hardware decoding is already chromium's default.
// WebRtcPipeWireCamera (flatpak): webcams through the camera portal instead of /dev/video*,
// which the sandbox does not open.
// (chromium honours only the last --enable-features, so everything goes in this one)
app.commandLine.appendSwitch(
  'enable-features',
  [
    'GlobalShortcutsPortal',
    'WebRTCPipeWireCapturer',
    'PulseaudioLoopbackForScreenShare',
    ...(process.platform === 'linux' ? ['AcceleratedVideoEncoder'] : []),
    ...(process.env.FLATPAK_ID ? ['WebRtcPipeWireCamera'] : [])
  ].join(',')
);
// privacy: nothing talks to google or anyone else in the background. electron already ships
// without safe browsing, sync, variations or crash upload; these close what is left
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-features', 'MediaRouter,DialMediaRouteProvider,CastMediaRouteProvider,OptimizationHints');

// a plain chrome user agent: servers, identity providers and embeds see a browser, not "Electron/44 jollyboat/0.1.0"
app.userAgentFallback = app.userAgentFallback.replace(/\s(jollyboat|Electron)\/\S+/g, '');


// smoke runs in CI: a mac runner has no one to answer a keychain dialog
if (process.env.JOLLYBOAT_SMOKE && process.platform === 'darwin') app.commandLine.appendSwitch('use-mock-keychain');

// dev runs would otherwise share ~/.config/Electron with every other electron app in development
if (!app.isPackaged) app.setPath('userData', join(app.getPath('appData'), 'jollyboat-dev'));

// the portable windows build keeps everything in a folder next to the exe (the exe itself runs
// from a temporary copy). passwords stay encrypted for this windows user only, as always
const PORTABLE = process.platform === 'win32' && !!process.env.PORTABLE_EXECUTABLE_DIR;
if (PORTABLE) app.setPath('userData', join(process.env.PORTABLE_EXECUTABLE_DIR!, 'Jollyboat-data'));

// spellcheck off (the default): google's dictionary host cannot even be resolved
const spellcheckAtStart = getSettings().spellcheck;
if (!spellcheckAtStart) blockDictionaryDownloads();

// two windows. the server window is a frame holding our bar on top and the server pages below,
// one per open server (a tab in the bar). every open server stays loaded: a call goes on in one
// while another is shown, and each one reports its unread messages. pages are never unloaded for
// the settings; the launcher (servers + settings) is its own window
let mainWindow: BaseWindow | null = null;
let barView: WebContentsView | null = null;
// the bar's right end (zoom, settings, window buttons) on its own while the bar is merged with
// sharkord's top bar; otherwise hidden and the main bar view holds everything
let barRight: WebContentsView | null = null;
let launcherWindow: BrowserWindow | null = null;
let quitting = false;
// the action sharkord's in-call guard interrupted, re-run with the guard waived after "leave"
let interrupted: (() => void) | null = null;
let waiveGuard = false;

const BAR_HEIGHT = 34;

type TServerView = {
  id: string;
  view: WebContentsView;
  wc: Electron.WebContents;
  /** the page's light/dark (sharkord has its own switch) */
  theme: 'light' | 'dark' | null;
  /** browser mode: the unread total from the page's title */
  titled: number;
  /** desktop mode: what the client says */
  unread: { count: number; mentioned: boolean } | null;
  connection: TConnection | null;
  /** read from sharkord's controls (both modes) */
  voice: TVoiceState;
  channel: string;
  members: TVoiceMember[];
  streams: number;
  /** desktop mode: the client says it is in a call */
  desktopVoice: boolean;
  /** when it joined its call (the latest one leads the tray and overlay) */
  voiceAt: number;
  loading: boolean;
  /** a tab in the background that could not load: loaded again when it is shown */
  failed: string | null;
  crashes: number[];
  /** chromium's background throttling (off while in a call) */
  throttled: boolean;
  /** the page shows sharkord's top bar (its server view, not its settings screen) */
  topbar: boolean;
  /** what the page was last told about the merged bar */
  barSent: string;
  /** a dialog's backdrop covers the page */
  modal: boolean;
};

const NO_VOICE: TVoiceState = { connected: false, inVoice: false, micMuted: false, deafened: false, speaking: false };

// in tab order
const views = new Map<string, TServerView>();
let activeId: string | null = null;
// logos as data urls, kept while the app runs (a tab opened again does not fetch it again)
const logos = new Map<string, string>();

const active = () => (activeId ? views.get(activeId) : undefined);
const alive = (v: TServerView | undefined) => (v && !v.wc.isDestroyed() ? v : undefined);
// the shown server page's contents, if there is one
const page = () => alive(active())?.wc ?? null;
const viewOf = (wc: Electron.WebContents) => [...views.values()].find((v) => v.wc === wc);
const serverOf = (id: string) => getSettings().servers.find((s) => s.id === id);
const inCall = (v: TServerView) => v.voice.inVoice || v.desktopVoice;
// the server we are in a call on (the latest joined, when several)
const voiceView = () => [...views.values()].filter(inCall).sort((a, b) => b.voiceAt - a.voiceAt)[0];
// the one the tray, the overlay and the pop-out follow: the call, else the one shown
const followed = () => alive(voiceView()) ?? alive(active());

// last bounds are reused only when they still land on a display
const restoredBounds = () => {
  const b = getSettings().windowBounds;

  if (!b) return {};

  const area = screen.getDisplayMatching(b).workArea;
  const fits = b.x + 60 < area.x + area.width && b.y + 40 < area.y + area.height && b.x + b.width > area.x + 60 && b.y + b.height > area.y + 40;

  return fits ? b : {};
};

let boundsTimer: NodeJS.Timeout | null = null;
const rememberBounds = () => {
  if (!mainWindow || mainWindow.isMinimized() || mainWindow.isFullScreen()) return;
  if (boundsTimer) clearTimeout(boundsTimer);
  boundsTimer = setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) saveSettings({ windowBounds: mainWindow.getNormalBounds() });
  }, 400);
};

// the bar is the title bar on top; full screen hides it so a stream gets the whole screen. a
// restored window keeps a 1 px edge in the bar's colour around the page, since a frameless
// window has no border of its own
// the bar grows with the page's zoom (its page scales its contents to match, see bar/main.ts)
const barHeight = () => Math.round(BAR_HEIGHT * (page()?.getZoomFactor() ?? 1));

// one bar instead of two: a page showing sharkord's top bar fills the window from the top, and
// its top bar becomes the middle of ours (search, plugin buttons, voice buttons, member list).
// our bar's two ends lie over that top bar's empty ends as transparent views; the page is told
// how much room to leave (in its own css px) and draws the bar's background (shell:bar)
// (and only while the row has room for both ends and some middle: at a big zoom in a small
// window the bar stays a row of its own)
const LEFT_MIN = 200;
const roomy = () => {
  if (!mainWindow) return false;
  const z = page()?.getZoomFactor() ?? 1;
  return (rightNeed || 430 * z) + (LEFT_MIN + MIDDLE_MIN) * z <= mainWindow.getContentBounds().width;
};
const canMerge = (v: TServerView | undefined) => !!v && v.topbar && !v.loading && !v.failed && !mainWindow?.isFullScreen() && roomy();
const merged = () => canMerge(alive(active()));
// what the two ends of the bar need (window px), as they measured themselves (bar:size)
let leftNeed = 0;
let rightNeed = 0;
// the least the middle keeps for sharkord's own buttons and search (css px of the bar)
const MIDDLE_MIN = 260;

let lastJoin = false;
const layout = () => {
  if (!mainWindow || !barView) return;
  const { width, height } = mainWindow.getContentBounds();
  const full = mainWindow.isFullScreen();
  const edge = full || mainWindow.isMaximized() ? 0 : 1;
  const bar = full ? 0 : barHeight();
  const zoomNow = page()?.getZoomFactor() ?? 1;
  // mac: the traffic lights stay in the middle of the bar
  if (process.platform === 'darwin' && !full) mainWindow.setWindowButtonPosition({ x: 12, y: Math.max(4, Math.round((bar - 16) / 2)) });
  const join = merged();
  // the bars learn it with their state (a resize or zoom can change it)
  if (join !== lastJoin) {
    lastJoin = join;
    queueMicrotask(sendBarState);
  }
  // (the right end keeps its size while hidden: it measures itself there)
  const right = Math.min(width, Math.ceil(rightNeed || 430 * zoomNow));
  const left = join ? Math.max(Math.round(90 * zoomNow), Math.min(Math.ceil(leftNeed || 300 * zoomNow), width - right - Math.round(MIDDLE_MIN * zoomNow))) : width;
  barView.setBounds({ x: 0, y: 0, width: left, height: bar });
  barView.setBackgroundColor(join ? '#00000000' : windowBackground(barDark()));
  if (barRight) {
    barRight.setBounds({ x: width - right, y: 0, width: right, height: bar });
    barRight.setVisible(join);
  }
  // every page keeps the size it would be shown at; only the active one is visible
  for (const v of views.values()) {
    const m = canMerge(v) && !full;
    v.view.setBounds({ x: edge, y: m ? 0 : bar, width: Math.max(0, width - 2 * edge), height: Math.max(0, height - (m ? 0 : bar) - edge) });
    v.view.setVisible(v.id === activeId);
    // the room our ends take, in the page's css px (it is zoomed like the bar)
    const z = v.wc.isDestroyed() ? 1 : v.wc.getZoomFactor();
    const leftAt = join ? left : Math.max(Math.round(90 * zoomNow), Math.min(Math.ceil(leftNeed || 300 * zoomNow), width - right - Math.round(MIDDLE_MIN * zoomNow)));
    const told = m ? JSON.stringify({ look: currentLook(), h: BAR_HEIGHT, l: Math.max(0, Math.round((leftAt - edge) / z)), r: Math.max(0, Math.round((right - edge) / z)) }) : 'null';
    if (told !== v.barSent && !v.wc.isDestroyed()) {
      v.barSent = told;
      v.wc.send('shell:bar', JSON.parse(told));
    }
  }
};

// the bar takes the theme of the sharkord page under it (sharkord has its own light/dark switch);
// until the page says, the system's
const pageTheme = () => active()?.theme ?? null;
const barDark = () => (pageTheme() ? pageTheme() === 'dark' : nativeTheme.shouldUseDarkColors);

const tabs = (): TTab[] =>
  [...views.values()].map((v) => ({
    id: v.id,
    name: serverOf(v.id)?.name ?? '',
    logo: logos.get(v.id) ?? null,
    active: v.id === activeId,
    unread: v.unread ? v.unread.count : v.titled,
    mentioned: !!v.unread?.mentioned,
    voice: inCall(v),
    connection: v.connection,
    loading: v.loading || !!v.failed
  }));

const sendBarState = () => {
  const wc = barView?.webContents;
  if (!wc || wc.isDestroyed()) return;
  const state: TBarState = {
    merged: merged(),
    dim: merged() && !!active()?.modal,
    server: serverOf(activeId ?? '')?.name ?? '',
    zoom: page()?.getZoomFactor() ?? 1,
    theme: pageTheme(),
    maximized: !!mainWindow?.isMaximized(),
    streams: streamCount(),
    tabs: tabs(),
    showTabs: getSettings().serverTabs
  };
  wc.send('bar:state', state);
  const rw = barRight?.webContents;
  if (rw && !rw.isDestroyed()) rw.send('bar:state', state);
  layout();
  setOverlayTheme(barDark() ? 'dark' : 'light');
  mainWindow?.setBackgroundColor(windowBackground(barDark()));
  if (launcherWindow && !launcherWindow.isDestroyed()) launcherWindow.setBackgroundColor(windowBackground());
};
ipcMain.on('server:theme', (event, theme: unknown) => {
  const v = viewOf(event.sender);
  if (!v || !findServerByUrl(event.senderFrame?.url ?? '')) return;
  const next = theme === 'dark' || theme === 'light' ? theme : null;
  if (next === v.theme) return;
  v.theme = next;
  if (v.id === activeId) sendBarState();
});
nativeTheme.on('updated', sendBarState);
// a page shows sharkord's top bar or not (its settings screen, the login, a page from before)
ipcMain.on('server:topbar', (event, on: unknown) => {
  const v = viewOf(event.sender);
  if (!v || !findServerByUrl(event.senderFrame?.url ?? '') || v.topbar === (on === true)) return;
  v.topbar = on === true;
  if (v.id === activeId) sendBarState();
  else layout();
});
ipcMain.on('server:modal', (event, on: unknown) => {
  const v = viewOf(event.sender);
  if (!v || !findServerByUrl(event.senderFrame?.url ?? '') || v.modal === (on === true)) return;
  v.modal = on === true;
  if (v.id === activeId) sendBarState();
});
// the bar's two ends measured what they need
ipcMain.on('bar:size', (event, need: unknown) => {
  const n = Number(need);
  if (!Number.isFinite(n) || n < 0 || n > 10_000) return;
  if (barView && event.sender === barView.webContents) {
    if (Math.abs(n - leftNeed) < 1) return;
    leftNeed = n;
  } else if (barRight && event.sender === barRight.webContents) {
    if (Math.abs(n - rightNeed) < 1) return;
    rightNeed = n;
  } else return;
  sendBarState();
});
onStreams(sendBarState);

// the tray's unread count: every open server's, together
const refreshUnread = () => {
  setTitleUnread(Math.min(999, [...views.values()].reduce((n, v) => n + (v.unread ? v.unread.count : v.titled), 0)));
  sendBarState();
};

// the tray, the overlay and the pop-out follow the server we are in a call on, else the one shown.
// a page in a call runs at full speed in the background (its voice rows, the overlay)
let followedId: string | null = null;
const follow = () => {
  const v = followed();
  const name = v ? (serverOf(v.id)?.name ?? '') : '';
  if (followedId !== (v?.id ?? null)) {
    followedId = v?.id ?? null;
    setServerName(name);
  }
  setVoiceState(v ? v.voice : NO_VOICE);
  setOverlayVoice(v && inCall(v) ? v.voice : NO_VOICE, v?.channel ?? '', v && inCall(v) ? v.members : []);
  setStreams(v && inCall(v) ? v.streams : 0);
  refreshOverlayHost();
  for (const each of views.values()) {
    if (each.wc.isDestroyed() || each.throttled === !inCall(each)) continue;
    each.throttled = !inCall(each);
    each.wc.setBackgroundThrottling(each.throttled);
  }
};

// the overlay stays away while the call's own page is in front: the window has focus and shows
// the server we are in a call on (another tab in front: the overlay shows the call)
const refreshOverlayHost = () => {
  const call = voiceView();
  setOverlayHostFocused(!!mainWindow?.isFocused() && (!call || call.id === activeId));
};

const markCall = (v: TServerView, was: boolean) => {
  if (!was && inCall(v)) v.voiceAt = Date.now();
};

// the zoom steps of a browser, up to 300 %; in and out go to the next one
const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const zoom = (direction: 1 | -1) => {
  const wc = page();
  if (!wc) return;
  const now = wc.getZoomFactor();
  const next =
    direction > 0
      ? (ZOOM_STEPS.find((f) => f > now + 0.001) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]!)
      : ([...ZOOM_STEPS].reverse().find((f) => f < now - 0.001) ?? ZOOM_STEPS[0]!);
  wc.setZoomFactor(next);
  sendBarState();
};
const zoomReset = () => {
  page()?.setZoomLevel(0);
  sendBarState();
};
const toggleFullScreen = () => mainWindow?.setFullScreen(!mainWindow.isFullScreen());

// runs an action that may unload a server page, remembering it for the in-call prompt
const guarded = (action: () => void) => {
  interrupted = action;
  action();
  setTimeout(() => (interrupted = null), 1000);
};
const reloadPage = (id = activeId) => {
  const v = id ? alive(views.get(id)) : undefined;
  if (v) guarded(() => v.wc.reload());
};

const webPreferences = { preload: preloadPath(), sandbox: true, contextIsolation: true, nodeIntegration: false };

// the tab n places along (wrapping), or tab number n
const tabAt = (n: number) => [...views.keys()][n];
const cycleTab = (step: 1 | -1) => {
  const ids = [...views.keys()];
  if (ids.length < 2) return;
  const i = ids.indexOf(activeId ?? '');
  switchTo(ids[(i + step + ids.length) % ids.length]!);
};

// the app's shortcuts, on the server pages and the bar (there is no application menu)
const handleShortcuts = (wc: Electron.WebContents) =>
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const ctrl = input.control || input.meta;
    const key = input.key.toLowerCase();
    // ctrl+1..9: that tab (9: the last), by the key's place, whatever the layout puts on it
    const digit = ctrl && !input.shift && !input.alt && /^Digit[1-9]$/.test(input.code) ? Number(input.code.slice(5)) : 0;
    const action =
      ctrl && input.shift && key === 's' ? () => showLauncher()
      : ctrl && input.shift && key === 'p' ? () => void popOutStream()
      : ctrl && input.shift && key === 'i' ? () => page()?.toggleDevTools()
      : (ctrl && !input.shift && key === 'r') || input.key === 'F5' ? () => reloadPage()
      : ctrl && (key === '=' || key === '+') ? () => zoom(1)
      : ctrl && key === '-' ? () => zoom(-1)
      : ctrl && key === '0' ? zoomReset
      : digit && views.size ? () => switchTo(digit === 9 ? tabAt(views.size - 1)! : (tabAt(digit - 1) ?? activeId!))
      : ctrl && input.key === 'Tab' ? () => cycleTab(input.shift ? -1 : 1)
      : ctrl && (input.key === 'PageDown' || input.key === 'PageUp') ? () => cycleTab(input.key === 'PageDown' ? 1 : -1)
      : input.key === 'F11' ? toggleFullScreen
      : ctrl && !input.shift && key === 'q' ? quit
      : null;

    if (action) {
      event.preventDefault();
      action();
    }
  });

// both views of what is shown learn the window's focus (each one's own document focus says only
// which of them has the keyboard): the water runs at full rate while the window is in front
const sendFocus = (focused: boolean) => {
  const all = [barView?.webContents, barRight?.webContents, ...[...views.values()].map((v) => v.wc)];
  for (const c of all) if (c && !c.isDestroyed()) c.send('shell:focus', focused);
};

const createMainWindow = () => {
  const dark = barDark();

  const win = new BaseWindow({
    width: 1360,
    height: 860,
    ...restoredBounds(),
    minWidth: 1120,
    minHeight: 720,
    show: false,
    // no system title bar: our bar is the title bar, with its own window buttons. on mac the
    // native traffic lights stay, centred in our bar, and the bar leaves room for them
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hidden' as const, trafficLightPosition: { x: 12, y: 10 } } : { frame: false }),
    icon: iconPath(),
    title: 'Jollyboat',
    backgroundColor: windowBackground(dark)
  });
  const barv = new WebContentsView({ webPreferences });
  mainWindow = win;
  barView = barv;
  barv.setBackgroundColor(windowBackground(dark));
  win.contentView.addChildView(barv);
  const barr = new WebContentsView({ webPreferences });
  barRight = barr;
  barr.setBackgroundColor('#00000000');
  barr.setVisible(false);
  win.contentView.addChildView(barr);
  layout();

  const bar = barv.webContents;
  const barEnd = barr.webContents;

  bar.loadURL(pageUrl('bar'));
  barEnd.loadURL(`${pageUrl('bar')}?part=right`);
  for (const wc of [bar, barEnd]) {
    wc.on('did-finish-load', sendBarState);
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-navigate', (event) => event.preventDefault());
    handleShortcuts(wc);
    wc.on('did-finish-load', () => sendFocus(win.isFocused()));
  }

  // reading the window clears the unread marker; typing goes to the page, not the bar
  win.on('focus', () => {
    clearUnread();
    page()?.focus();
    refreshOverlayHost();
    sendFocus(true);
  });
  win.on('blur', () => {
    setOverlayHostFocused(false);
    sendFocus(false);
  });
  win.on('hide', () => setOverlayHostFocused(false));
  win.on('resize', () => {
    layout();
    rememberBounds();
  });
  win.on('move', rememberBounds);
  win.on('enter-full-screen', sendBarState);
  win.on('leave-full-screen', sendBarState);
  const onMaximizeChange = () => {
    layout();
    sendBarState();
  };
  win.on('maximize', onMaximizeChange);
  win.on('unmaximize', onMaximizeChange);

  // closing: minimize (default), hide into the tray, or quit. quitting closes the pages first so
  // sharkord's in-call guard gets its say; the frame follows once they are gone
  win.on('close', (event) => {
    if (quitting) {
      const open = [...views.values()].filter((v) => !v.wc.isDestroyed());
      if (open.length) {
        event.preventDefault();
        for (const v of open) v.wc.close({ waitForBeforeUnload: true });
      }
      return;
    }

    const { onClose } = getSettings();
    event.preventDefault();

    if (onClose === 'minimize') win.minimize();
    else if (onClose === 'tray' && hasTray()) win.hide();
    else quit();
  });

  win.on('closed', () => {
    if (!bar.isDestroyed()) bar.close();
    if (!barEnd.isDestroyed()) barEnd.close();
    barRight = null;
    for (const v of views.values()) if (!v.wc.isDestroyed()) v.wc.close();
    views.clear();
    activeId = null;
    mainWindow = null;
    barView = null;
  });

  return win;
};

// the tabs that are open, for the next start
const rememberTabs = () => {
  if (!quitting) saveSettings({ openServers: [...views.keys()] });
};

// a server's logo for its tab: /info names the file. fetched through the app's session, so a
// proxy login comes along; small files only
const fetchLogo = async (id: string) => {
  const server = serverOf(id);
  if (!server || logos.has(id)) return;
  try {
    const info = (await (await session.defaultSession.fetch(`${server.url}/info`, { signal: AbortSignal.timeout(8000) })).json()) as { logo?: { name?: unknown } | null };
    const name = info?.logo?.name;
    if (typeof name !== 'string' || !name) return;
    const res = await session.defaultSession.fetch(`${server.url}/public/${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(8000) });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !/^image\/(png|jpeg|webp|gif|avif)/.test(type)) return;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 512 * 1024) return;
    logos.set(id, `data:${type.split(';')[0]};base64,${buf.toString('base64')}`);
    sendBarState();
  } catch {
    /* no logo: the tab shows the initials */
  }
};

const createServerView = (id: string): TServerView => {
  const win = mainWindow ?? createMainWindow();
  const view = new WebContentsView({ webPreferences });
  const wc = view.webContents;
  const v: TServerView = {
    id,
    view,
    wc,
    theme: null,
    titled: 0,
    unread: null,
    connection: null,
    voice: { ...NO_VOICE },
    channel: '',
    members: [],
    streams: 0,
    desktopVoice: false,
    voiceAt: 0,
    loading: true,
    failed: null,
    crashes: [],
    throttled: true,
    topbar: false,
    barSent: '',
    modal: false
  };
  views.set(id, v);
  view.setBackgroundColor('#0a0a0a');
  view.setVisible(false);
  // under the bar (the bar stays on top for its menus' sake)
  win.contentView.addChildView(view, 0);

  // a server's zoom is remembered per address: the bar picks it up when the page loads
  wc.on('did-finish-load', () => {
    v.loading = false;
    wc.send('shell:shown', id === activeId);
    wc.send('shell:focus', win.isFocused());
    sendBarState();
    void fetchLogo(id);
  });
  handleShortcuts(wc);
  wc.on('zoom-changed', (_e, direction) => id === activeId && zoom(direction === 'in' ? 1 : -1));
  installCustomCss(wc);
  installContextMenu(wc, win);
  wc.on('page-title-updated', (_e, title) => id === activeId && win.setTitle(`${title} — Jollyboat`));

  // links Sharkord opens in a new window go to the system browser; the server's own files from a
  // server behind a proxy login are saved here instead (the browser doesn't have the login)
  let lastExternal = 0;
  wc.setWindowOpenHandler(({ url }) => {
    if (url.toLowerCase().startsWith(`${PROTOCOL}://`)) {
      handleDeepLink(url);
      return { action: 'deny' };
    }
    if (findServerByUrl(wc.getURL())?.basicAuth && isServerFile(url, wc.getURL())) {
      saveUrl(wc, url);
      return { action: 'deny' };
    }
    // at most one external tab per second, so a page cannot flood the browser
    if (/^https?:/i.test(url) && Date.now() - lastExternal > 1000) {
      lastExternal = Date.now();
      shell.openExternal(url);
    }

    return { action: 'deny' };
  });

  // a new document: nothing it said before counts (a pipewire share never outlives its page)
  wc.on('did-start-navigation', (details) => {
    if (!details.isMainFrame || details.isSameDocument) return;
    if (inCall(v)) stopPipeWireShare();
    Object.assign(v, { loading: true, unread: null, titled: 0, connection: null, desktopVoice: false, voice: { ...NO_VOICE }, members: [], streams: 0, topbar: false, barSent: '', modal: false });
    follow();
    refreshUnread();
  });
  // a crashed or hung page comes back on its own; three crashes in two minutes go to the launcher
  wc.on('render-process-gone', (_e, details) => {
    if (inCall(v)) stopPipeWireShare();
    log('window', 'renderer gone:', details.reason, details.exitCode);

    if (details.reason === 'clean-exit' || details.reason === 'killed' || quitting) return;

    const now = Date.now();
    v.crashes = v.crashes.filter((t) => now - t < 120_000).concat(now);

    const url = wc.getURL();
    if (v.crashes.length >= 3 || !findServerByUrl(url)) failServer(id, t('page crashed ({reason})', { reason: details.reason }));
    else wc.loadURL(url);
  });

  let hangTimer: NodeJS.Timeout | null = null;
  wc.on('unresponsive', () => {
    log('window', 'unresponsive');
    hangTimer = setTimeout(() => {
      log('window', 'still unresponsive after 30 s, reloading');
      wc.forcefullyCrashRenderer();
    }, 30_000);
  });
  wc.on('responsive', () => {
    if (hangTimer) clearTimeout(hangTimer);
    hangTimer = null;
  });

  // the server page only ever shows http(s). an OIDC login may bounce through the identity
  // provider, so other https origins are allowed in-window; anything else is not
  wc.on('will-navigate', (event, url) => {
    if (!/^https?:/i.test(url)) event.preventDefault();
    // sharkord's own "add to desktop app" link, and any other sharkord:// link on the page
    if (url.toLowerCase().startsWith(`${PROTOCOL}://`)) handleDeepLink(url);
  });

  // sharkord guards leaving while in a call (beforeunload). electron would silently stay, which
  // looked like a lost click. the page stays for now and our own prompt asks; "leave" re-runs
  // whatever was interrupted with the guard waived. applies to reload, closing a tab, quitting
  wc.on('will-prevent-unload', (event) => {
    if (waiveGuard) {
      waiveGuard = false;
      event.preventDefault();
      return;
    }

    log('window', 'page asks to stay (beforeunload)');
    const wasQuitting = quitting;
    const again = interrupted ?? (wasQuitting ? quit : () => wc.reload());
    interrupted = null;
    quitting = false;
    // the prompt is about this server: it is shown while asking
    switchTo(id);

    askPrompt(win, { message: t('still in a call'), detail: wasQuitting ? t('leave it and quit?') : t('leave it?'), yes: t('leave'), no: t('stay') }).then((leave) => {
      if (!leave) return;
      waiveGuard = true;
      again();
      // nothing asked after all (the call ended meanwhile): forget the waiver
      setTimeout(() => (waiveGuard = false), 2000);
    });
  });

  // a server that cannot be reached: the tab goes and the launcher says why (a tab in the
  // background is tried again when it is shown)
  wc.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
    // no address in the log: diagnostics promise no server names or urls
    log('window', 'load failed', code, description, isMainFrame ? 'main frame' : 'subframe', findServerByUrl(url) ? 'of a saved server' : 'elsewhere');
    if (!isMainFrame || code === -3 /* aborted: a new navigation started */) return;

    const text = description.toLowerCase().replace(/^err_/, '').replace(/_/g, ' ');
    failServer(id, text === 'too many retries' ? t('proxy login refused | check the proxy login') : text);
  });

  // an http error page from the server itself (did-fail-load does not fire for those)
  wc.on('did-navigate', (_e, url, httpResponseCode) => {
    if (!findServerByUrl(url) || httpResponseCode < 400) return;
    log('window', 'server answered', httpResponseCode, 'for the page');
    if (httpResponseCode === 401 || httpResponseCode === 407) failServer(id, t('proxy login refused | check the proxy login'));
    else if (httpResponseCode >= 500) failServer(id, t('server error {code}', { code: httpResponseCode }));
  });

  wc.on('destroyed', () => removeView(id));

  return v;
};

/** a page went away (its tab closed, a failure, quitting) */
const removeView = (id: string, quiet = false) => {
  const v = views.get(id);
  if (!v) return;
  // the tab to show instead: the one after it, else the one before
  const order = [...views.keys()];
  const neighbour = order[order.indexOf(id) + 1] ?? order[order.indexOf(id) - 1];
  views.delete(id);
  if (!v.wc.isDestroyed()) v.wc.close();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.contentView.removeChildView(v.view);
  if (inCall(v)) stopPipeWireShare();

  if (quitting) {
    if (!views.size && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.destroy();
      app.quit();
    }
    return;
  }

  rememberTabs();
  if (activeId === id) {
    activeId = null;
    if (neighbour) switchTo(neighbour);
  }
  follow();
  refreshUnread();
  // the last tab: the window goes, the launcher comes
  if (!views.size && mainWindow) {
    mainWindow.hide();
    mainWindow.setTitle('Jollyboat');
    if (!quiet) showLauncher();
  }
};

/** shows a tab (and with it the window's title, the bar, the zoom) */
const switchTo = (id: string) => {
  const v = alive(views.get(id));
  if (!v) return;
  const changed = activeId !== id;
  activeId = id;
  if (changed && !quitting && getSettings().lastActiveServerId !== id) saveSettings({ lastActiveServerId: id });
  for (const each of views.values()) if (!each.wc.isDestroyed()) each.wc.send('shell:shown', each.id === id);
  layout();
  sendBarState();
  follow();
  if (!changed) return;
  const title = v.wc.getTitle();
  mainWindow?.setTitle(v.loading || !title || /^https?:/.test(title) ? `${serverOf(id)?.name ?? ''} — Jollyboat` : `${title} — Jollyboat`);
  if (mainWindow?.isFocused()) v.wc.focus();
  if (v.failed) {
    const server = serverOf(id);
    v.failed = null;
    if (server) v.wc.loadURL(server.url);
  }
};

/** a page that could not load: shown, its tab goes and the launcher says why; in the
 * background, the tab stays and is tried again when shown */
const failServer = (id: string, reason: string) => {
  const v = views.get(id);
  if (!v) return;
  if (id !== activeId) {
    v.failed = reason;
    sendBarState();
    return;
  }
  const visible = !!mainWindow?.isVisible() || !!launcherWindow?.isVisible();
  log('window', 'server tab closed:', reason);
  removeView(id, true);
  showLauncher(reason, id, visible);
};

const closeServer = (id: string) => {
  const v = alive(views.get(id));
  if (v) guarded(() => v.wc.close({ waitForBeforeUnload: true }));
};

const focusWindow = (win: BaseWindow) => {
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
};

// a server page is open in the server window
const hasServer = () => views.size > 0;

// second instance / dock: the server window if there is a server, otherwise the launcher
const showWindow = () => {
  if (mainWindow && hasServer()) focusWindow(mainWindow);
  else showLauncher();
};

// tray click: show, or put it away when it is already in front
const toggleWindow = () => {
  const win = mainWindow && hasServer() ? mainWindow : launcherWindow;
  if (win && win.isVisible() && !win.isMinimized() && win.isFocused()) {
    if (win === mainWindow && getSettings().onClose !== 'tray') win.minimize();
    else win.hide();
  } else {
    showWindow();
  }
};

/** a page's tab and the window come up (a notification was clicked) */
const bringUp = (wc: Electron.WebContents) => {
  const v = viewOf(wc);
  if (!v || !mainWindow) return;
  switchTo(v.id);
  focusWindow(mainWindow);
};

const createLauncherWindow = () => {
  const win = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 1000,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    icon: iconPath(),
    title: 'Jollyboat',
    backgroundColor: windowBackground(),
    webPreferences
  });
  launcherWindow = win;
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!isOwnPageUrl(url)) event.preventDefault();
  });
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && (input.control || input.meta) && input.key.toLowerCase() === 'q') {
      event.preventDefault();
      quit();
    }
  });
  win.on('closed', () => {
    launcherWindow = null;
  });

  return win;
};

const showLauncher = (error?: string, serverId?: string, show = true, addUrl?: string) => {
  if (!show && !error && !launcherWindow) return;

  const win = launcherWindow ?? createLauncherWindow();
  const query = new URLSearchParams();

  if (error) query.set('error', error);
  if (error && serverId) query.set('server', serverId);
  // a sharkord:// link: the editor opens with its address
  if (addUrl) query.set('add', addUrl);

  const fresh = !win.webContents.getURL().startsWith(pageUrl('launcher'));

  // an open launcher is only reloaded when there is something new to say
  if (error || addUrl || fresh) win.loadURL(query.size ? `${pageUrl('launcher')}?${query}` : pageUrl('launcher'));
  if (!show) return;
  if (fresh) win.webContents.once('did-finish-load', () => focusWindow(win));
  else focusWindow(win);
};

/** a sharkord:// link (from the system, a second start, or the server page): the setup window
 * with its server address, ready to save (or the saved server under that address) */
const handleDeepLink = (link: string) => {
  const server = parseDeepLink(link);
  log('links', server ? 'add-server link' : 'a sharkord:// link that is not one we know');
  if (server) showLauncher(undefined, undefined, true, server);
  else showWindow();
};

const WEBSITE = 'https://innovativefluid.net';

// the bar's ⋯ menu: everything the old menu bar had that the bar does not show
const barMenu = () =>
  Menu.buildFromTemplate([
    { label: t('Reload'), accelerator: 'CommandOrControl+R', click: () => reloadPage() },
    { label: t('Full screen'), accelerator: 'F11', click: toggleFullScreen },
    { label: getSettings().serverTabs ? t('Hide server tabs') : t('Show server tabs'), click: toggleTabs },
    { type: 'separator' },
    { label: t('Jollyboat on GitHub'), click: () => shell.openExternal('https://github.com/innovativefluid/jollyboat') },
    { label: t('Releases'), click: () => shell.openExternal('https://github.com/innovativefluid/jollyboat/releases') },
    { label: 'innovativefluid.net', click: () => shell.openExternal(WEBSITE) },
    { label: `Version ${__APP_VERSION__}`, enabled: false },
    { type: 'separator' },
    { label: t('Quit'), accelerator: 'CommandOrControl+Q', click: quit }
  ]);

/** a tab dragged elsewhere: the bar sends the whole new order */
const moveTabs = (order: unknown[]) => {
  const ids = order.filter((x): x is string => typeof x === 'string');
  if (ids.length !== views.size || !ids.every((id) => views.has(id)) || new Set(ids).size !== ids.length) return;
  const entries = ids.map((id) => [id, views.get(id)!] as const);
  views.clear();
  for (const [id, v] of entries) views.set(id, v);
  rememberTabs();
  sendBarState();
};

// a tab's own menu (right click)
const tabMenu = (id: string) =>
  Menu.buildFromTemplate([
    { label: t('Reload'), click: () => reloadPage(id) },
    { label: t('Close tab'), click: () => closeServer(id) }
  ]);

// the + chip: the saved servers that are not open, and the way to add one
const addMenu = () => {
  const closed = getSettings().servers.filter((s) => !views.has(s.id));
  return Menu.buildFromTemplate([
    ...closed.map((s) => ({ label: s.name, click: () => connectToServer(s.id) })),
    ...(closed.length ? [{ type: 'separator' as const }] : []),
    { label: t('Add a server…'), click: () => showLauncher() }
  ]);
};

// tabs that do not fit the bar
const overflowMenu = (ids: string[]) =>
  Menu.buildFromTemplate(
    ids.flatMap((id) => {
      const tab = tabs().find((x) => x.id === id);
      return tab ? [{ label: `${tab.name}${tab.voice ? ' 🔊' : tab.unread ? ` (${tab.unread})` : ''}`, type: 'checkbox' as const, checked: tab.active, click: () => switchTo(id) }] : [];
    })
  );

/** the server tabs on or off (sharkord's own "server list" button in desktop mode does this too) */
const toggleTabs = () => {
  const visible = !getSettings().serverTabs;
  saveSettings({ serverTabs: visible });
  sendListVisible([...views.values()].map((v) => v.wc), visible);
  sendBarState();
};

ipcMain.on('bar:action', (event, action: unknown, at: unknown, arg: unknown) => {
  const from = [barView, barRight].find((b) => b && event.sender === b.webContents);
  if (!from) return;
  if (action !== 'tab') log('bar', String(action));
  const p = (at ?? {}) as { x?: unknown; y?: unknown };
  // menus open under the button; the right end of the bar is a view of its own further along
  const pos = { x: (typeof p.x === 'number' ? p.x : 0) + from.getBounds().x, y: typeof p.y === 'number' ? p.y : barHeight() };
  const id = typeof arg === 'string' && views.has(arg) ? arg : null;

  if (action === 'settings') showLauncher();
  else if (action === 'zoom-in') zoom(1);
  else if (action === 'zoom-out') zoom(-1);
  else if (action === 'zoom-reset') zoomReset();
  else if (action === 'minimize') mainWindow?.minimize();
  else if (action === 'maximize') mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize();
  else if (action === 'close') mainWindow?.close();
  else if (action === 'popout') void popOutStream();
  else if (action === 'tab' && id) switchTo(id);
  else if (action === 'tab-close' && id) closeServer(id);
  else if (action === 'tab-move' && Array.isArray(arg)) moveTabs(arg);
  else if (!mainWindow) return;
  else if (action === 'menu') barMenu().popup({ window: mainWindow, ...pos });
  else if (action === 'tab-menu' && id) tabMenu(id).popup({ window: mainWindow, ...pos });
  else if (action === 'add') addMenu().popup({ window: mainWindow, ...pos });
  else if (action === 'overflow' && Array.isArray(arg)) overflowMenu(arg.filter((x): x is string => typeof x === 'string')).popup({ window: mainWindow, ...pos });
});

/** opens a server in its tab (or shows its tab when it is open already) */
const connectToServer = (id: string, show = true, background = false) => {
  const server = serverOf(id);
  if (!server) return;

  const win = mainWindow ?? createMainWindow();
  let v = alive(views.get(id));

  if (!v) {
    v = createServerView(id);
    const loadStart = performance.now();
    v.wc.once('did-finish-load', () => log('start', `server page loaded in ${Math.round(performance.now() - loadStart)} ms (${Math.round(process.uptime() * 1000)} ms since launch)`));
    // with an invite still to use, sharkord's connect screen gets it as ?invite= (it reads it from there)
    v.wc.loadURL(server.invite ? `${server.url}/?invite=${encodeURIComponent(server.invite)}` : server.url);
    rememberTabs();
  }
  if (!background || !activeId) switchTo(id);
  if (show) focusWindow(win);
  // the launcher has done its job; it comes back from the bar or the tray
  if (!background) launcherWindow?.close();
};

// what a page says about itself: its voice controls, its title, its notifications
const pageHandlers = {
  onVoice: (wc: Electron.WebContents, voice: TVoiceState, channel: string, members: TVoiceMember[], streams: number) => {
    const v = viewOf(wc);
    if (!v) return;
    const was = inCall(v);
    Object.assign(v, { voice, channel, members, streams });
    markCall(v, was);
    if (was !== inCall(v)) sendBarState();
    follow();
  },
  onTitle: (wc: Electron.WebContents, count: number) => {
    const v = viewOf(wc);
    if (!v || v.titled === count) return;
    v.titled = count;
    refreshUnread();
  },
  // the tray's marker: a message while the window is in the background
  onNotification: (_wc: Electron.WebContents) => {
    if (!getSettings().notifyTray) return;
    if (!mainWindow || !mainWindow.isFocused() || !mainWindow.isVisible()) addUnread();
  },
  onNotificationClick: bringUp
};

// sharkord's desktop mode
const installPageBridge = () => installDesktopBridge({
  setUnread: (wc, count, mentioned) => {
    const v = viewOf(wc);
    if (!v) return;
    v.unread = { count, mentioned };
    refreshUnread();
  },
  setConnection: (wc, state) => {
    const v = viewOf(wc);
    if (!v || v.connection === state) return;
    v.connection = state;
    sendBarState();
  },
  setVoice: (wc, on) => {
    const v = viewOf(wc);
    if (!v) return;
    const was = inCall(v);
    v.desktopVoice = on;
    markCall(v, was);
    sendBarState();
    follow();
  },
  notified: pageHandlers.onNotification,
  clicked: bringUp,
  listVisible: () => getSettings().serverTabs,
  toggleList: toggleTabs,
  openSettings: () => showLauncher()
});

// a server renamed or removed in the launcher: its tab follows
onServersChanged(() => {
  for (const id of [...views.keys()]) if (!serverOf(id)) closeServer(id);
  sendBarState();
});

const quit = () => {
  quitting = true;
  app.quit();
};

// CI only (JOLLYBOAT_SMOKE=1): the packaged app starts, renders the setup window and the server
// window's bar, prints what it is running on and exits 0 — or 1 if something did not come up
const runSmokeTest = async () => {
  const timer = setTimeout(() => {
    console.error('[smoke] timed out');
    app.exit(1);
  }, 60_000);

  // progress lines, so a hang in CI shows where it stopped
  const step = (text: string) => console.log(`[smoke-step] ${Math.round(process.uptime() * 1000)} ms ${text}`);

  try {
    step('ready');
    createMainWindow();
    step('server window created');
    const launcher = createLauncherWindow();
    const loaded = (name: string, wc: Electron.WebContents) =>
      new Promise<void>((resolve) => wc.once('did-finish-load', () => (step(`${name} loaded`), resolve())));
    const ready = Promise.all([loaded('bar', barView!.webContents), loaded('setup window', launcher.webContents)]);

    launcher.loadURL(pageUrl('launcher'));
    await ready;

    const panels = await launcher.webContents.executeJavaScript("typeof window.shell === 'object' ? document.querySelectorAll('.panel').length : -1");
    const bar = await barView!.webContents.executeJavaScript("document.getElementById('settings') ? 'ok' : 'missing'");

    const keys = getBridgeStatus().keyUp ? 'push-to-talk' : 'presses only';
    // the installed windows build updates itself: its updater has to load (0.3.1–0.3.8 shipped
    // one that did not)
    const updater = canSelfUpdate() ? await loadAutoUpdater().then(() => 'ok', (err: Error) => `failed: ${err.message}`) : 'n/a';
    // the portable update's swap, tried for real by CI (JOLLYBOAT_SMOKE_SWAP: a copy of the exe that
    // takes the running exe's place while it runs; the next start clears the old one away)
    let swap = '';
    const swapWith = process.env.JOLLYBOAT_SMOKE_SWAP;
    if (PORTABLE && swapWith) {
      try {
        swapPortable(portableFile()!, swapWith);
        swap = ' | swap ok';
      } catch (err) {
        swap = ` | swap failed: ${(err as Error).message}`;
      }
    }
    const line = `[smoke] ${process.platform} ${process.arch} | electron ${process.versions.electron} | jollyboat ${__APP_VERSION__} | setup panels ${panels} | bar ${bar} | keys ${keys} | updater ${updater}${PORTABLE ? ' | portable' : ''}${swap}${process.env.APPIMAGE ? ' | appimage' : ''}${process.platform === 'win32' ? ` | app sound ${soundAppsSupported() ? 'ok' : 'n/a'}` : ''}`;
    console.log(line);
    // the portable launcher does not pass the app's output on: the line also goes next to the data
    if (PORTABLE) writeFileSync(join(app.getPath('userData'), 'smoke.log'), `${line}\n`);
    clearTimeout(timer);
    app.exit(panels >= 3 && bar === 'ok' && (updater === 'ok' || updater === 'n/a') ? 0 : 1);
  } catch (err) {
    console.error('[smoke] failed', err);
    app.exit(1);
  }
};

// every web contents, whatever made it: no <webview>, no bluetooth chooser, no new windows unless
// a window says otherwise (the server window sends links to the browser), and our own pages
// never navigate away from our own pages
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.on('select-bluetooth-device', (event, _devices, callback) => {
    event.preventDefault();
    callback('');
  });
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, url) => {
    if (isOwnPageUrl(contents.getURL()) && !isOwnPageUrl(url)) event.preventDefault();
  });
});

// a sharkord:// link that started the app (windows, linux), or that macos sent before it was ready
let startLink = findDeepLink(process.argv);
let ready = false;
app.on('open-url', (event, url) => {
  event.preventDefault();
  if (ready) handleDeepLink(url);
  else startLink = url;
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // a second start: a link it was given, else just the window
  app.on('second-instance', (_e, argv) => {
    const link = findDeepLink(argv);
    if (link) handleDeepLink(link);
    else showWindow();
  });

  app.whenReady().then(async () => {
    // a portable copy that updated itself: the old exe (it ran until the last quit) goes
    cleanPortableLeftovers();
    // dev only: JOLLYBOAT_NETLOG=/path/log.json records every request; SIGUSR2 writes it out
    if (!app.isPackaged && process.env.JOLLYBOAT_NETLOG) {
      const { netLog } = await import('electron');
      await netLog.startLogging(process.env.JOLLYBOAT_NETLOG, { captureMode: 'default' });
      process.on('SIGUSR2', () => netLog.stopLogging().then(() => console.log('[netlog] written')));
    }

    // mic / camera / screen / notifications only for our own pages and saved servers;
    // Sharkord's own UI does the asking, so there is no second prompt. no clipboard reading:
    // sharkord never reads it through the api, and a page should not do so silently
    const allowedPermissions = ['media', 'display-capture', 'notifications', 'clipboard-sanitized-write', 'fullscreen'];
    const isTrustedOrigin = (url: string) => isOwnPageUrl(url) || !!findServerByUrl(url);

    session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
      const url = details.requestingUrl || wc.getURL();
      // a link to another app's scheme asks to open it outside: sharkord:// from a saved server's
      // page is ours to handle (sharkord's "add to desktop app"); nothing goes to the system
      if (permission === 'openExternal') {
        const external = 'externalURL' in details ? String(details.externalURL ?? '') : '';
        if (external.toLowerCase().startsWith(`${PROTOCOL}://`) && isTrustedOrigin(url)) handleDeepLink(external);
        return callback(false);
      }
      callback(allowedPermissions.includes(permission) && isTrustedOrigin(url));
    });
    session.defaultSession.setPermissionCheckHandler((wc, permission, origin) => {
      const url = originOf(origin) ?? wc?.getURL() ?? '';
      return (allowedPermissions.includes(permission) && isTrustedOrigin(url)) || allowsHid(permission, url);
    });
    // hardware access: sony controllers over hid for saved servers (controllers.ts, the light bar
    // for plugins like jollyplay); serial, usb and any other hid device never. electron would
    // otherwise hand a page the first device in a chooser nobody sees
    installControllers();
    session.defaultSession.on('select-serial-port', (event, _ports, _wc, callback) => {
      event.preventDefault();
      callback('');
    });
    session.defaultSession.on('select-usb-device', (event, _details, callback) => {
      event.preventDefault();
      callback();
    });

    // dns: the operating system's resolver (hosts file, mdns .local names, vpn split dns), no doh upgrade
    app.configureHostResolver({ enableBuiltInResolver: false, secureDnsMode: 'off' });
    applySpellcheck(getSettings().spellcheck);
    applyColorMode();
    const audioStart = performance.now();
    log('start', `ready after ${Math.round(process.uptime() * 1000)} ms`);
    log('start', `screen audio: ${initScreenAudio()} in ${Math.round(performance.now() - audioStart)} ms`);

    installBasicAuth();
    installDownloads();
    onServersChanged(refreshBasicAuth);
    installDisplayMediaHandler(() => mainWindow);
    bindMainPage(() => followed()?.wc ?? null);
    await startBridge();
    registerIpc({
      connectToServer: (id) => connectToServer(id),
      getMainWindow: () => mainWindow,
      spellcheckAtStart,
      onLookChange: sendBarState,
      ...pageHandlers
    });
    installPageBridge();
    // keys bound by several servers go to the one in a call, else the one shown
    setHotkeyRanking(({ key, origin }) => {
      const v = key !== undefined ? [...views.values()].find((x) => !x.wc.isDestroyed() && x.wc.id === key) : [...views.values()].find((x) => x.id === findServerByUrl(origin ?? '')?.id);
      if (!v) return 0;
      return (v === voiceView() ? 2 : 0) + (v.id === activeId ? 1 : 0);
    });
    // no application menu: the bar above the server page and its shortcuts replace it. a mac
    // needs one anyway (cmd+c / cmd+v in text fields go through the edit menu)
    Menu.setApplicationMenu(
      process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null
    );
    createTray({
      toggle: toggleWindow,
      show: showWindow,
      showLauncher: () => showLauncher(),
      quit,
      voiceAction: (action) => followed()?.wc.send('shell:voice-action', action),
      getMainWindow: () => mainWindow
    });
    if (process.env.JOLLYBOAT_SMOKE) return runSmokeTest();

    startUpdater();

    // the tabs from last time come back (a setting), the one shown last in front; with none, the
    // setup window. --hidden (autostart): stay in the tray until the user asks for a window
    const hidden = process.argv.includes('--hidden');
    const { reopenTabs, openServers, lastActiveServerId } = getSettings();
    const reopen = reopenTabs ? openServers : [];

    claimLinksIfFree();
    // the appimage: into the app menu, autostart pointing at its current file
    integrateAppImage();
    refreshAutoStart();
    ready = true;
    // started by a sharkord:// link: the setup window with it, nothing else
    if (startLink) handleDeepLink(startLink);
    else if (reopen.length) {
      for (const id of reopen) connectToServer(id, false, true);
      connectToServer(reopen.includes(lastActiveServerId ?? '') ? lastActiveServerId! : reopen[0]!, !hidden);
    } else showLauncher(undefined, undefined, !hidden);
  });

  app.on('before-quit', () => {
    stopPipeWireShare();
    quitting = true;
    stopBridge();
  });

  app.on('window-all-closed', () => {
    // keep running in the tray; Quit is in the tray menu
    if (!hasTray()) app.quit();
  });

  app.on('activate', showWindow);
}
