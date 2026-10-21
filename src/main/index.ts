import { app, BaseWindow, BrowserWindow, clipboard, ipcMain, Menu, nativeTheme, screen, session, shell, WebContentsView } from 'electron';
import { join } from 'node:path';
import { installBasicAuth, refreshBasicAuth } from './basic-auth';
import { startBridge, stopBridge } from './hotkeys/bridge';
import { registerIpc } from './ipc';
import { iconPath, isOwnPageUrl, originOf, pageUrl, preloadPath } from './paths';
import { installDisplayMediaHandler } from './screen-share';
import { findServerByUrl, getSettings, onServersChanged, saveSettings } from './settings';
import { log } from './log';
import { diagnostics } from './diagnostics';
import { clearUnread, createTray, hasTray, setServerName } from './tray';
import { applySpellcheck, blockDictionaryDownloads } from './privacy';
import { initScreenAudio, stopPipeWireShare } from './screen-audio';
import { startUpdater } from './updater';
import { askPrompt } from './prompt';

// windows: toast notifications and taskbar grouping need the same AppUserModelId the installer
// writes into the start-menu shortcut (electron-builder uses appId)
if (process.platform === 'win32') app.setAppUserModelId('io.github.innovativefluid.Jollyboat');

// GlobalShortcutsPortal: lets globalShortcut work on Wayland through xdg-desktop-portal
// (KDE Plasma, newer GNOME). WebRTCPipeWireCapturer: screen capture through the portal.
// PulseaudioLoopbackForScreenShare: system audio for screen shares on linux when pipewire/venmic
// is not available (see screen-audio.ts). AcceleratedVideoEncoder: on linux, screen shares (and
// webcams) are encoded on the gpu through VA-API when the driver can do the codec sharkord picked;
// otherwise chromium falls back to software. hardware decoding is already chromium's default.
// (chromium honours only the last --enable-features, so everything goes in this one)
app.commandLine.appendSwitch(
  'enable-features',
  ['GlobalShortcutsPortal', 'WebRTCPipeWireCapturer', 'PulseaudioLoopbackForScreenShare', ...(process.platform === 'linux' ? ['AcceleratedVideoEncoder'] : [])].join(',')
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

// spellcheck off (the default): google's dictionary host cannot even be resolved
const spellcheckAtStart = getSettings().spellcheck;
if (!spellcheckAtStart) blockDictionaryDownloads();

// two windows. the server window is a frame holding our bar on top and the server page below;
// the page is never unloaded for settings. the launcher (servers + settings) is its own window
let mainWindow: BaseWindow | null = null;
let serverView: WebContentsView | null = null;
let barView: WebContentsView | null = null;
let launcherWindow: BrowserWindow | null = null;
let quitting = false;
let crashes: number[] = [];
// the action sharkord's in-call guard interrupted, re-run with the guard waived after "leave"
let interrupted: (() => void) | null = null;
let waiveGuard = false;

const BAR_HEIGHT = 34;

// the server page's contents, while there is a server window
const page = () => (serverView && !serverView.webContents.isDestroyed() ? serverView.webContents : null);

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
const layout = () => {
  if (!mainWindow || !serverView || !barView) return;
  const { width, height } = mainWindow.getContentBounds();
  const full = mainWindow.isFullScreen();
  const edge = full || mainWindow.isMaximized() ? 0 : 1;
  const bar = full ? 0 : BAR_HEIGHT;
  barView.setBounds({ x: 0, y: 0, width, height: bar });
  serverView.setBounds({ x: edge, y: bar, width: Math.max(0, width - 2 * edge), height: Math.max(0, height - bar - edge) });
};

let serverName = '';
// the bar takes the theme of the sharkord page under it (sharkord has its own light/dark switch);
// until the page says, the system's
let pageTheme: 'light' | 'dark' | null = null;
const barDark = () => (pageTheme ? pageTheme === 'dark' : nativeTheme.shouldUseDarkColors);
const sendBarState = () => {
  const wc = barView?.webContents;
  if (!wc || wc.isDestroyed()) return;
  wc.send('bar:state', { server: serverName, zoom: page()?.getZoomFactor() ?? 1, theme: pageTheme, maximized: !!mainWindow?.isMaximized() });
  const bg = barDark() ? '#18201c' : '#a6b08a';
  barView?.setBackgroundColor(bg);
  mainWindow?.setBackgroundColor(bg);
};
ipcMain.on('server:theme', (event, theme: unknown) => {
  if (event.sender !== page() || !findServerByUrl(event.senderFrame?.url ?? '')) return;
  const next = theme === 'dark' || theme === 'light' ? theme : null;
  if (next === pageTheme) return;
  pageTheme = next;
  sendBarState();
});
nativeTheme.on('updated', sendBarState);

const zoom = (delta: number) => {
  const wc = page();
  if (!wc) return;
  wc.setZoomLevel(Math.max(-3, Math.min(3, wc.getZoomLevel() + delta)));
  sendBarState();
};
const zoomReset = () => {
  page()?.setZoomLevel(0);
  sendBarState();
};
const toggleFullScreen = () => mainWindow?.setFullScreen(!mainWindow.isFullScreen());

// runs an action that may unload the server page, remembering it for the in-call prompt
const guarded = (action: () => void) => {
  interrupted = action;
  action();
  setTimeout(() => (interrupted = null), 1000);
};
const reloadPage = () => guarded(() => page()?.reload());

const webPreferences = { preload: preloadPath(), sandbox: true, contextIsolation: true, nodeIntegration: false };

// the app's shortcuts, on the server page and the bar (there is no application menu)
const handleShortcuts = (wc: Electron.WebContents) =>
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const ctrl = input.control || input.meta;
    const key = input.key.toLowerCase();
    const action =
      ctrl && input.shift && key === 's' ? () => showLauncher()
      : ctrl && input.shift && key === 'i' ? () => page()?.toggleDevTools()
      : (ctrl && !input.shift && key === 'r') || input.key === 'F5' ? reloadPage
      : ctrl && (key === '=' || key === '+') ? () => zoom(+0.5)
      : ctrl && key === '-' ? () => zoom(-0.5)
      : ctrl && key === '0' ? zoomReset
      : input.key === 'F11' ? toggleFullScreen
      : ctrl && !input.shift && key === 'q' ? quit
      : null;

    if (action) {
      event.preventDefault();
      action();
    }
  });

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
    backgroundColor: dark ? '#18201c' : '#a6b08a'
  });
  const server = new WebContentsView({ webPreferences });
  const barv = new WebContentsView({ webPreferences });
  mainWindow = win;
  serverView = server;
  barView = barv;
  server.setBackgroundColor('#0a0a0a');
  barv.setBackgroundColor(dark ? '#18201c' : '#a6b08a');
  win.contentView.addChildView(server);
  win.contentView.addChildView(barv);
  layout();

  const wc = server.webContents;
  const bar = barv.webContents;

  bar.loadURL(pageUrl('bar'));
  bar.on('did-finish-load', sendBarState);
  bar.setWindowOpenHandler(() => ({ action: 'deny' }));
  bar.on('will-navigate', (event) => event.preventDefault());
  handleShortcuts(wc);
  handleShortcuts(bar);

  // reading the window clears the unread marker; typing goes to the page, not the bar
  win.on('focus', () => {
    clearUnread();
    if (!wc.isDestroyed()) wc.focus();
  });
  win.on('resize', () => {
    layout();
    rememberBounds();
  });
  win.on('move', rememberBounds);
  win.on('enter-full-screen', layout);
  win.on('leave-full-screen', layout);
  const onMaximizeChange = () => {
    layout();
    sendBarState();
  };
  win.on('maximize', onMaximizeChange);
  win.on('unmaximize', onMaximizeChange);
  wc.on('zoom-changed', (_e, direction) => zoom(direction === 'in' ? +0.5 : -0.5));
  wc.on('page-title-updated', (_e, title) => win.setTitle(`${title} — Jollyboat`));

  // links Sharkord opens in a new window go to the system browser
  let lastExternal = 0;
  wc.setWindowOpenHandler(({ url }) => {
    // at most one external tab per second, so a page cannot flood the browser
    if (/^https?:/i.test(url) && Date.now() - lastExternal > 1000) {
      lastExternal = Date.now();
      shell.openExternal(url);
    }

    return { action: 'deny' };
  });

  // a pipewire share never outlives the page that started it
  wc.on('did-start-navigation', (details) => details.isMainFrame && !details.isSameDocument && stopPipeWireShare());
  // a crashed or hung page comes back on its own; three crashes in two minutes go to the launcher
  wc.on('render-process-gone', (_e, details) => {
    stopPipeWireShare();
    log('window', 'renderer gone:', details.reason, details.exitCode);

    if (details.reason === 'clean-exit' || details.reason === 'killed' || quitting) return;

    const now = Date.now();
    crashes = crashes.filter((t) => now - t < 120_000).concat(now);

    const url = wc.getURL();
    const saved = findServerByUrl(url);

    if (crashes.length >= 3 || !saved) dropServer(`page crashed (${details.reason})`, saved?.id);
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
  });

  // sharkord guards leaving while in a call (beforeunload). electron would silently stay, which
  // looked like a lost click. the page stays for now and our own prompt asks; "leave" re-runs
  // whatever was interrupted with the guard waived. applies to reload, switching servers, quitting
  wc.on('will-prevent-unload', (event) => {
    if (waiveGuard) {
      waiveGuard = false;
      event.preventDefault();
      return;
    }

    log('window', 'page asks to stay (beforeunload)');
    const wasQuitting = quitting;
    const again = interrupted ?? (wasQuitting ? quit : reloadPage);
    interrupted = null;
    quitting = false;

    askPrompt(win, { message: 'still in a call', detail: wasQuitting ? 'leave it and quit?' : 'leave it?', yes: 'leave', no: 'stay' }).then((leave) => {
      if (!leave) return;
      waiveGuard = true;
      again();
      // nothing asked after all (the call ended meanwhile): forget the waiver
      setTimeout(() => (waiveGuard = false), 2000);
    });
  });

  // a server that cannot be reached bounces back to the launcher with the reason
  wc.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
    // no address in the log: diagnostics promise no server names or urls
    log('window', 'load failed', code, description, isMainFrame ? 'main frame' : 'subframe', findServerByUrl(url) ? 'of a saved server' : 'elsewhere');
    if (!isMainFrame || code === -3 /* aborted: a new navigation started */) return;

    const text = description.toLowerCase().replace(/^err_/, '').replace(/_/g, ' ');
    dropServer(text === 'too many retries' ? 'proxy login refused | check the proxy login' : text, findServerByUrl(url)?.id);
  });

  // an http error page from the server itself (did-fail-load does not fire for those)
  wc.on('did-navigate', (_e, url, httpResponseCode) => {
    const saved = findServerByUrl(url);
    if (!saved || httpResponseCode < 400) return;
    log('window', 'server answered', httpResponseCode, 'for the page');
    if (httpResponseCode === 401 || httpResponseCode === 407) dropServer('proxy login refused | check the proxy login', saved.id);
    else if (httpResponseCode >= 500) dropServer(`server error ${httpResponseCode}`, saved.id);
  });

  // closing: minimize (default), hide into the tray, or quit. quitting closes the page first so
  // sharkord's in-call guard gets its say; the frame follows once the page is gone
  win.on('close', (event) => {
    if (quitting) {
      if (!wc.isDestroyed()) {
        event.preventDefault();
        wc.close({ waitForBeforeUnload: true });
      }
      return;
    }

    const { onClose } = getSettings();
    event.preventDefault();

    if (onClose === 'minimize') win.minimize();
    else if (onClose === 'tray' && hasTray()) win.hide();
    else quit();
  });
  wc.on('destroyed', () => {
    if (!quitting || win.isDestroyed()) return;
    win.destroy();
    app.quit();
  });

  win.on('closed', () => {
    if (!bar.isDestroyed()) bar.close();
    if (!wc.isDestroyed()) wc.close();
    mainWindow = null;
    serverView = null;
    barView = null;
  });

  return win;
};

const focusWindow = (win: BaseWindow) => {
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
};

// a server page is loaded (or loading) in the server window
const hasServer = () => !!findServerByUrl(page()?.getURL() ?? '');

// second instance / dock: the server if there is one, otherwise the launcher
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
    backgroundColor: '#a6b08a',
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

const showLauncher = (error?: string, serverId?: string, show = true) => {
  if (!show && !error && !launcherWindow) return;

  const win = launcherWindow ?? createLauncherWindow();
  const query = new URLSearchParams();

  if (error) query.set('error', error);
  if (error && serverId) query.set('server', serverId);

  const fresh = !win.webContents.getURL().startsWith(pageUrl('launcher'));

  // an open launcher is only reloaded when there is something new to say
  if (error || fresh) win.loadURL(query.size ? `${pageUrl('launcher')}?${query}` : pageUrl('launcher'));
  if (!show) return;
  if (fresh) win.webContents.once('did-finish-load', () => focusWindow(win));
  else focusWindow(win);
};

// a server page that failed: the window goes away and the launcher says why (it pops up only
// when the server window was on screen; a start into the tray stays there)
const dropServer = (reason: string, serverId?: string) => {
  const visible = !!mainWindow?.isVisible() || !!launcherWindow?.isVisible();

  if (mainWindow) {
    mainWindow.hide();
    mainWindow.setTitle('Jollyboat');
    page()?.loadURL('about:blank');
  }
  serverName = '';
  setServerName('');
  showLauncher(reason, serverId, visible);
};

const WEBSITE = 'https://innovativefluid.net';

// the bar's ⋯ menu: everything the old menu bar had that the bar does not show
const barMenu = () =>
  Menu.buildFromTemplate([
    { label: 'Reload', accelerator: 'CommandOrControl+R', click: reloadPage },
    { label: 'Full screen', accelerator: 'F11', click: toggleFullScreen },
    { label: 'Developer tools', accelerator: 'CommandOrControl+Shift+I', click: () => page()?.toggleDevTools() },
    { type: 'separator' },
    { label: 'Copy diagnostics', click: () => clipboard.writeText(diagnostics()) },
    { label: 'Jollyboat on GitHub', click: () => shell.openExternal('https://github.com/innovativefluid/jollyboat') },
    { label: 'Releases', click: () => shell.openExternal('https://github.com/innovativefluid/jollyboat/releases') },
    { label: 'innovativefluid.net', click: () => shell.openExternal(WEBSITE) },
    { label: `Version ${__APP_VERSION__}`, enabled: false },
    { type: 'separator' },
    { label: 'Quit', accelerator: 'CommandOrControl+Q', click: quit }
  ]);

ipcMain.on('bar:action', (event, action: unknown, at: unknown) => {
  if (!barView || event.sender !== barView.webContents) return;
  log('bar', String(action));

  if (action === 'settings') showLauncher();
  else if (action === 'zoom-in') zoom(+0.5);
  else if (action === 'zoom-out') zoom(-0.5);
  else if (action === 'zoom-reset') zoomReset();
  else if (action === 'minimize') mainWindow?.minimize();
  else if (action === 'maximize') mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize();
  else if (action === 'close') mainWindow?.close();
  else if (action === 'menu' && mainWindow) {
    const p = (at ?? {}) as { x?: unknown; y?: unknown };
    barMenu().popup({ window: mainWindow, x: typeof p.x === 'number' ? p.x : 0, y: typeof p.y === 'number' ? p.y : BAR_HEIGHT });
  }
});

const connectToServer = (id: string, show = true) => {
  const server = getSettings().servers.find((s) => s.id === id);

  if (!server) return;
  interrupted = () => connectToServer(id);
  setTimeout(() => (interrupted = null), 1000);

  const win = mainWindow ?? createMainWindow();

  win.setTitle(`${server.name} — Jollyboat`);
  const loadStart = performance.now();
  page()?.once('did-finish-load', () => log('start', `server page loaded in ${Math.round(performance.now() - loadStart)} ms (${Math.round(process.uptime() * 1000)} ms since launch)`));
  serverName = server.name;
  setServerName(server.name);
  sendBarState();
  page()?.loadURL(server.url);
  if (show) focusWindow(win);
  // the launcher has done its job; it comes back from the bar or the tray
  launcherWindow?.close();
};

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

    console.log(`[smoke] ${process.platform} ${process.arch} | electron ${process.versions.electron} | jollyboat ${__APP_VERSION__} | setup panels ${panels} | bar ${bar}`);
    clearTimeout(timer);
    app.exit(panels >= 3 && bar === 'ok' ? 0 : 1);
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

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);

  app.whenReady().then(async () => {
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
      callback(allowedPermissions.includes(permission) && isTrustedOrigin(url));
    });
    session.defaultSession.setPermissionCheckHandler((wc, permission, origin) => {
      const url = originOf(origin) ?? wc?.getURL() ?? '';
      return allowedPermissions.includes(permission) && isTrustedOrigin(url);
    });
    // hardware access (hid, serial, usb, bluetooth): never. electron would otherwise hand a page
    // the first device in a chooser nobody sees
    session.defaultSession.setDevicePermissionHandler(() => false);
    session.defaultSession.on('select-hid-device', (event, _details, callback) => {
      event.preventDefault();
      callback();
    });
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
    const audioStart = performance.now();
    log('start', `ready after ${Math.round(process.uptime() * 1000)} ms`);
    log('start', `screen audio: ${initScreenAudio()} in ${Math.round(performance.now() - audioStart)} ms`);

    installBasicAuth();
    onServersChanged(refreshBasicAuth);
    installDisplayMediaHandler(() => mainWindow);
    await startBridge();
    registerIpc({
      connectToServer,
      getMainWindow: () => mainWindow,
      spellcheckAtStart
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
      voiceAction: (action) => page()?.send('shell:voice-action', action),
      getMainWindow: () => mainWindow
    });
    if (process.env.JOLLYBOAT_SMOKE) return runSmokeTest();

    startUpdater();

    // auto-connect is chosen in the launcher; a lone server opens without being asked.
    // --hidden (autostart): stay in the tray until the user asks for a window
    const hidden = process.argv.includes('--hidden');
    const { autoConnectServerId, servers } = getSettings();
    const auto = servers.find((s) => s.id === autoConnectServerId) ?? (servers.length === 1 ? servers[0] : undefined);

    if (auto) connectToServer(auto.id, !hidden);
    else showLauncher(undefined, undefined, !hidden);
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
