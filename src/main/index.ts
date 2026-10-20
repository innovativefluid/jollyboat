import { app, BrowserWindow, clipboard, dialog, Menu, screen, session, shell } from 'electron';
import { join } from 'node:path';
import { installBasicAuth, refreshBasicAuth } from './basic-auth';
import { startBridge, stopBridge } from './hotkeys/bridge';
import { registerIpc } from './ipc';
import { isOwnPageUrl, originOf, pageUrl, preloadPath } from './paths';
import { installDisplayMediaHandler } from './screen-share';
import { findServerByUrl, getSettings, onServersChanged, saveSettings } from './settings';
import { log } from './log';
import { diagnostics } from './diagnostics';
import { clearUnread, createTray, hasTray, setServerName } from './tray';
import { applySpellcheck, blockDictionaryDownloads } from './privacy';
import { initScreenAudio, stopPipeWireShare } from './screen-audio';
import { startUpdater } from './updater';

// windows: toast notifications and taskbar grouping need the same AppUserModelId the installer
// writes into the start-menu shortcut (electron-builder uses appId)
if (process.platform === 'win32') app.setAppUserModelId('io.github.innovativefluid.Jollyboat');

// GlobalShortcutsPortal: lets globalShortcut work on Wayland through xdg-desktop-portal
// (KDE Plasma, newer GNOME). WebRTCPipeWireCapturer: screen capture through the portal.
// PulseaudioLoopbackForScreenShare: system audio for screen shares on linux when pipewire/venmic
// is not available (see screen-audio.ts)
app.commandLine.appendSwitch('enable-features', 'GlobalShortcutsPortal,WebRTCPipeWireCapturer,PulseaudioLoopbackForScreenShare');
// privacy: nothing talks to google or anyone else in the background. electron already ships
// without safe browsing, sync, variations or crash upload; these close what is left
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-features', 'MediaRouter,DialMediaRouteProvider,CastMediaRouteProvider,OptimizationHints');

// a plain chrome user agent: servers, identity providers and embeds see a browser, not "Electron/44 jollyboat/0.1.0"
app.userAgentFallback = app.userAgentFallback.replace(/\s(jollyboat|Electron)\/\S+/g, '');


// dev runs would otherwise share ~/.config/Electron with every other electron app in development
if (!app.isPackaged) app.setPath('userData', join(app.getPath('appData'), 'jollyboat-dev'));

// spellcheck off (the default): google's dictionary host cannot even be resolved
const spellcheckAtStart = getSettings().spellcheck;
if (!spellcheckAtStart) blockDictionaryDownloads();

// two windows: the server page lives in mainWindow and is never unloaded for settings;
// the launcher (servers + settings) is its own small window, opened on demand
let mainWindow: BrowserWindow | null = null;
let launcherWindow: BrowserWindow | null = null;
let quitting = false;
let crashes: number[] = [];
// --hidden (autostart): stay in the tray until the user asks for the window
let startHidden = process.argv.includes('--hidden');

const iconPath = () => join(__dirname, '../../resources/icon.png');

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

const createMainWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    ...restoredBounds(),
    minWidth: 1120,
    minHeight: 720,
    show: false,
    autoHideMenuBar: false,
    icon: iconPath(),
    title: 'Jollyboat',
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: preloadPath(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.once('ready-to-show', () => {
    if (startHidden) startHidden = false;
    else mainWindow?.show();
  });

  // reading the window clears the unread marker
  mainWindow.on('focus', clearUnread);
  mainWindow.on('resize', rememberBounds);
  mainWindow.on('move', rememberBounds);

  // links Sharkord opens in a new window go to the system browser
  let lastExternal = 0;
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // at most one external tab per second, so a page cannot flood the browser
    if (/^https?:/i.test(url) && Date.now() - lastExternal > 1000) {
      lastExternal = Date.now();
      shell.openExternal(url);
    }

    return { action: 'deny' };
  });

  // the window only ever shows our pages and http(s). an OIDC login may bounce through the
  // identity provider, so other https origins are allowed in-window; anything else is not
  // a pipewire share never outlives the page that started it
  mainWindow.webContents.on('did-start-navigation', (details) => details.isMainFrame && !details.isSameDocument && stopPipeWireShare());
  // a crashed or hung page comes back on its own; three crashes in two minutes go to the launcher
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    stopPipeWireShare();
    log('window', 'renderer gone:', details.reason, details.exitCode);

    if (details.reason === 'clean-exit' || details.reason === 'killed') return;

    const now = Date.now();
    crashes = crashes.filter((t) => now - t < 120_000).concat(now);

    const url = mainWindow?.webContents.getURL() ?? '';
    const server = findServerByUrl(url);

    if (crashes.length >= 3 || !server) dropServer(`${server ? `${server.name} | ` : ''}page crashed (${details.reason})`);
    else mainWindow?.loadURL(url);
  });

  let hangTimer: NodeJS.Timeout | null = null;
  mainWindow.on('unresponsive', () => {
    log('window', 'unresponsive');
    hangTimer = setTimeout(() => {
      log('window', 'still unresponsive after 30 s, reloading');
      mainWindow?.webContents.forcefullyCrashRenderer();
    }, 30_000);
  });
  mainWindow.on('responsive', () => {
    if (hangTimer) clearTimeout(hangTimer);
    hangTimer = null;
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!/^https?:/i.test(url)) event.preventDefault();
  });

  // sharkord guards leaving while in a call (beforeunload). electron would silently stay, which
  // looked like a lost click; ask instead. applies to reload, switching servers and quitting
  mainWindow.webContents.on('will-prevent-unload', (event) => {
    log('window', 'page asks to stay (beforeunload)');
    const choice = dialog.showMessageBoxSync(mainWindow!, {
      type: 'question',
      buttons: ['Leave', 'Stay'],
      defaultId: 1,
      cancelId: 1,
      message: 'Still in a call',
      detail: quitting ? 'Leave it and quit?' : 'Leave it?'
    });

    if (choice === 0) event.preventDefault();
    else quitting = false;
  });

  // a server that cannot be reached bounces back to the launcher with the reason
  mainWindow.webContents.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
    log('window', 'load failed', code, description, isMainFrame ? 'main' : 'sub', url.slice(0, 80));
    if (!isMainFrame || code === -3 /* aborted: a new navigation started */) return;

    const server = findServerByUrl(url);
    const text = description.toLowerCase().replace(/^err_/, '').replace(/_/g, ' ');
    const reason = `${server ? `${server.name} | ` : ''}${text === 'too many retries' ? 'proxy login refused, check the basic auth fields' : text}`;

    dropServer(reason);
  });

  // an http error page from the server itself (did-fail-load does not fire for those)
  mainWindow.webContents.on('did-navigate', (_e, url, httpResponseCode) => {
    const server = findServerByUrl(url);
    if (!server || httpResponseCode < 400) return;
    log('window', 'server answered', httpResponseCode, 'for the page');
    if (httpResponseCode === 401 || httpResponseCode === 407) dropServer(`${server.name} | proxy login refused, check the basic auth fields`);
    else if (httpResponseCode >= 500) dropServer(`${server.name} | server error ${httpResponseCode}`);
  });

  mainWindow.on('close', (event) => {
    if (!quitting && getSettings().minimizeToTray && hasTray()) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
};

const focusWindow = (win: BrowserWindow) => {
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
};

// a server page is loaded (or loading) in the main window
const hasServer = () => !!mainWindow && !!findServerByUrl(mainWindow.webContents.getURL());

// tray click / second instance: the server if there is one, otherwise the launcher
const showWindow = () => {
  if (mainWindow && hasServer()) focusWindow(mainWindow);
  else showLauncher();
};

const createLauncherWindow = () => {
  launcherWindow = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 1000,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    icon: iconPath(),
    title: 'Jollyboat',
    backgroundColor: '#a6b08a',
    webPreferences: {
      preload: preloadPath(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  launcherWindow.setMenuBarVisibility(false);
  launcherWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  launcherWindow.webContents.on('will-navigate', (event, url) => {
    if (!isOwnPageUrl(url)) event.preventDefault();
  });
  launcherWindow.on('closed', () => {
    launcherWindow = null;
  });

  return launcherWindow;
};

const showLauncher = (error?: string) => {
  const win = launcherWindow ?? createLauncherWindow();
  const url = error ? `${pageUrl('launcher')}?error=${encodeURIComponent(error)}` : pageUrl('launcher');

  const fresh = !win.webContents.getURL().startsWith(pageUrl('launcher'));

  // an open launcher is only reloaded when there is something new to say
  if (error || fresh) win.loadURL(url);
  if (startHidden) return;
  if (fresh) win.webContents.once('did-finish-load', () => focusWindow(win));
  else focusWindow(win);
};

// a server page that failed: the window goes away and the launcher says why
const dropServer = (reason: string) => {
  if (mainWindow) {
    mainWindow.hide();
    mainWindow.setTitle('Jollyboat');
    mainWindow.loadURL('about:blank');
  }
  setServerName('');
  showLauncher(reason);
};

const WEBSITE = 'https://innovativefluid.net';

const zoom = (delta: number) => {
  const wc = mainWindow?.webContents;
  if (wc) wc.setZoomLevel(Math.max(-3, Math.min(3, wc.getZoomLevel() + delta)));
};

// shown while a server page is open (the way back to the app's own screens); hidden on the setup screen
const createMenu = () => {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: '&Jollyboat',
        submenu: [
          { label: '&Servers and settings…', accelerator: 'CommandOrControl+Shift+S', click: () => showLauncher() },
          { type: 'separator' },
          { label: 'Copy &diagnostics', click: () => clipboard.writeText(diagnostics()) },
          { type: 'separator' },
          { label: '&Quit', accelerator: 'CommandOrControl+Q', click: quit }
        ]
      },
      {
        label: '&View',
        submenu: [
          { label: '&Reload', accelerator: 'CommandOrControl+R', click: () => mainWindow?.webContents.reload() },
          { type: 'separator' },
          { label: 'Zoom &in', accelerator: 'CommandOrControl+=', click: () => zoom(+0.5) },
          { label: 'Zoom &out', accelerator: 'CommandOrControl+-', click: () => zoom(-0.5) },
          { label: '&Actual size', accelerator: 'CommandOrControl+0', click: () => mainWindow?.webContents.setZoomLevel(0) },
          { type: 'separator' },
          { label: '&Full screen', accelerator: 'F11', click: () => mainWindow?.setFullScreen(!mainWindow.isFullScreen()) },
          { label: 'Developer &tools', accelerator: 'CommandOrControl+Shift+I', click: () => mainWindow?.webContents.toggleDevTools() }
        ]
      },
      {
        label: '&Help',
        submenu: [
          { label: 'Jollyboat on &GitHub', click: () => shell.openExternal('https://github.com/innovativefluid/jollyboat') },
          { label: '&Releases', click: () => shell.openExternal('https://github.com/innovativefluid/jollyboat/releases') },
          { label: 'innovativefluid.&net', click: () => shell.openExternal(WEBSITE) },
          { type: 'separator' },
          { label: `Version ${__APP_VERSION__}`, enabled: false }
        ]
      }
    ])
  );
};

const connectToServer = (id: string) => {
  const server = getSettings().servers.find((s) => s.id === id);

  if (!server) return;

  const win = mainWindow ?? createMainWindow();

  win.setTitle(`${server.name} — Jollyboat`);
  setServerName(server.name);
  win.loadURL(server.url);
  if (!startHidden) focusWindow(win);
  // the launcher has done its job; it comes back from the menu bar or the tray
  launcherWindow?.close();
};

const quit = () => {
  quitting = true;
  app.quit();
};

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
    // Sharkord's own UI does the asking, so there is no second prompt
    const allowedPermissions = ['media', 'display-capture', 'notifications', 'clipboard-read', 'fullscreen'];
    const isTrustedOrigin = (url: string) => isOwnPageUrl(url) || !!findServerByUrl(url);

    session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
      const url = details.requestingUrl || wc.getURL();
      callback(allowedPermissions.includes(permission) && isTrustedOrigin(url));
    });
    session.defaultSession.setPermissionCheckHandler((wc, permission, origin) => {
      const url = originOf(origin) ?? wc?.getURL() ?? '';
      return allowedPermissions.includes(permission) && isTrustedOrigin(url);
    });

    // dns: the operating system's resolver (hosts file, mdns .local names, vpn split dns), no doh upgrade
    app.configureHostResolver({ enableBuiltInResolver: false, secureDnsMode: 'off' });
    applySpellcheck(getSettings().spellcheck);
    initScreenAudio();

    installBasicAuth();
    onServersChanged(refreshBasicAuth);
    installDisplayMediaHandler(() => mainWindow);
    await startBridge();
    registerIpc({
      connectToServer,
      getMainWindow: () => mainWindow,
      quit,
      spellcheckAtStart
    });
    createMenu();
    createTray({
      show: showWindow,
      showLauncher: () => showLauncher(),
      quit,
      voiceAction: (action) => mainWindow?.webContents.send('shell:voice-action', action),
      getMainWindow: () => mainWindow
    });
    startUpdater();

    // auto-connect is chosen in the launcher; a lone server opens without being asked
    const { autoConnectServerId, servers } = getSettings();
    const auto = servers.find((s) => s.id === autoConnectServerId) ?? (servers.length === 1 ? servers[0] : undefined);

    if (auto) connectToServer(auto.id);
    else showLauncher();
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
