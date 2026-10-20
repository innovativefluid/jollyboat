import { app, BrowserWindow, Menu, screen, session, shell } from 'electron';
import { join } from 'node:path';
import { installBasicAuth } from './basic-auth';
import { startBridge, stopBridge } from './hotkeys/bridge';
import { registerIpc } from './ipc';
import { isOwnPageUrl, originOf, pageUrl, preloadPath } from './paths';
import { installDisplayMediaHandler } from './screen-share';
import { findServerByUrl, getSettings, saveSettings } from './settings';
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

let mainWindow: BrowserWindow | null = null;
let quitting = false;
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
    autoHideMenuBar: true,
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
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);

    return { action: 'deny' };
  });

  // the window only ever shows our pages and http(s). an OIDC login may bounce through the
  // identity provider, so other https origins are allowed in-window; anything else is not
  // a pipewire share never outlives the page that started it
  mainWindow.webContents.on('did-start-navigation', (details) => details.isMainFrame && !details.isSameDocument && stopPipeWireShare());
  mainWindow.webContents.on('render-process-gone', stopPipeWireShare);

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isOwnPageUrl(url) && !/^https?:/i.test(url)) event.preventDefault();
  });

  // a server that cannot be reached bounces back to the launcher with the reason
  mainWindow.webContents.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
    if (!isMainFrame || code === -3 /* aborted: a new navigation started */) return;

    const server = findServerByUrl(url);
    const reason = `${server ? `${server.name} | ` : ''}${description.toLowerCase().replace(/^err_/, '').replace(/_/g, ' ')}`;

    showLauncher(reason);
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

const showWindow = () => {
  const win = mainWindow ?? createMainWindow();

  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
};

const showLauncher = (error?: string) => {
  const win = mainWindow ?? createMainWindow();

  win.setTitle('Jollyboat');
  setServerName('');
  win.loadURL(error ? `${pageUrl('launcher')}?error=${encodeURIComponent(error)}` : pageUrl('launcher'));
  if (!startHidden) showWindow();
};

// the menu bar stays hidden; this exists for its accelerators
const createMenu = () => {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Jollyboat',
        submenu: [
          { label: 'Servers…', accelerator: 'CommandOrControl+Shift+S', click: () => showLauncher() },
          { label: 'Reload', accelerator: 'CommandOrControl+R', click: () => mainWindow?.webContents.reload() },
          { label: 'Toggle developer tools', accelerator: 'CommandOrControl+Shift+I', click: () => mainWindow?.webContents.toggleDevTools() },
          { type: 'separator' },
          { label: 'Quit', accelerator: 'CommandOrControl+Q', click: quit }
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
  if (!startHidden) showWindow();
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
      return allowedPermissions.includes(permission) && isTrustedOrigin(wc?.getURL() ?? originOf(origin) ?? '');
    });

    // dns: the operating system's resolver (hosts file, mdns .local names, vpn split dns), no doh upgrade
    app.configureHostResolver({ enableBuiltInResolver: false, secureDnsMode: 'off' });
    applySpellcheck(getSettings().spellcheck);
    initScreenAudio();

    installBasicAuth();
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

    // auto-connect is an explicit choice made in the launcher; otherwise it opens first
    const { autoConnectServerId, servers } = getSettings();
    const auto = servers.find((s) => s.id === autoConnectServerId);

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

  app.on('activate', () => {
    if (!mainWindow) showLauncher();
  });
}
