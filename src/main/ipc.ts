import { BrowserWindow, ipcMain, net, safeStorage, shell, webContents, type BaseWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import type { TServerInput, TSettings, TTestResult, TVoiceReport } from '../shared/types';
import { isWayland, refreshOverlay, setOverlayHeight, setOverlayVoice } from './overlay';
import { getMainPage, popOutStream, setStreams } from './popout';
import { editCustomCss, refreshCustomCss, useExample } from './customcss';
import { currentLang, onLanguageChange, t } from './lang';
import { getAutoStart, isAutoStartSupported, setAutoStart } from './autostart';
import { basicHeaderFor } from './basic-auth';
import { getBridgeStatus, getBridgeToken } from './hotkeys/bridge';
import { isOwnPageUrl, ownPageOf } from './paths';
import { applySpellcheck } from './privacy';
import { buildExport, exportToFile, importFromFile, importShared, parseShared, toCode } from './share';
import {
  canExcludeOwnAudioOnWindows,
  describeScreenAudio,
  getScreenAudioMode,
  startPipeWireShare,
  stopPipeWireShare,
  unmutePipeWireShare,
  VIRTUAL_MIC_LABEL
} from './screen-audio';
import { addUnread, setTitleUnread, setVoiceState } from './tray';
import { diagnostics } from './diagnostics';
import { log } from './log';
import { getUpdateStatus, installUpdateNow, onUpdateStatus, openReleasePage, startUpdater, updatesFromStore } from './updater';
import {
  decryptPassword,
  findServerByUrl,
  getSettings,
  loginTokenFor,
  normalizeUrl,
  publicServers,
  recordTest,
  removeServer,
  saveSettings,
  setKeepLogin,
  setLoginToken,
  upsertServer
} from './settings';

type THandlers = { connectToServer: (id: string) => void; getMainWindow: () => BaseWindow | null; spellcheckAtStart: boolean };

let spellcheckAtStartup = false;

// the settings / servers api is the setup window's alone; the bar, prompt and picker have their
// own channels with their own sender checks
const trusted = (event: IpcMainInvokeEvent | IpcMainEvent) => ownPageOf(event.senderFrame?.url ?? '') === 'launcher';

const guard =
  <T extends unknown[], R>(fn: (event: IpcMainInvokeEvent, ...args: T) => R) =>
  (event: IpcMainInvokeEvent, ...args: T): R => {
    if (!trusted(event)) throw new Error('not allowed from this page');

    return fn(event, ...args);
  };

// only these keys, only these shapes, from our own launcher
const pickSettingsPatch = (patch: unknown): Partial<TSettings> => {
  const p = (patch ?? {}) as Record<string, unknown>;
  const out: Partial<TSettings> = {};

  if (typeof p.spellcheck === 'boolean') out.spellcheck = p.spellcheck;
  if (typeof p.checkUpdates === 'boolean') out.checkUpdates = p.checkUpdates;
  if (p.onClose === 'minimize' || p.onClose === 'tray' || p.onClose === 'quit') out.onClose = p.onClose;
  if (typeof p.notifyTray === 'boolean') out.notifyTray = p.notifyTray;
  if (typeof p.overlay === 'boolean') out.overlay = p.overlay;
  if (typeof p.overlayClickThrough === 'boolean') out.overlayClickThrough = p.overlayClickThrough;
  if (p.theme === 'none' || p.theme === 'jollyboat' || p.theme === 'custom') out.theme = p.theme;
  if (p.language === 'system' || p.language === 'en' || p.language === 'de' || p.language === 'pl') out.language = p.language;
  if (typeof p.overlayOpacity === 'number' && Number.isFinite(p.overlayOpacity)) out.overlayOpacity = Math.min(100, Math.max(0, Math.round(p.overlayOpacity)));
  if (p.autoConnectServerId === null) out.autoConnectServerId = null;
  if (typeof p.autoConnectServerId === 'string' && getSettings().servers.some((s) => s.id === p.autoConnectServerId)) {
    out.autoConnectServerId = p.autoConnectServerId;
  }

  return out;
};

const pickServerInput = (input: unknown): TServerInput => {
  const i = (input ?? {}) as Record<string, unknown>;
  const auth = i.basicAuth as Record<string, unknown> | null | undefined;

  return {
    id: typeof i.id === 'string' ? i.id : undefined,
    url: String(i.url ?? '').slice(0, 2000),
    name: String(i.name ?? '').slice(0, 100),
    basicAuth:
      auth && typeof auth.username === 'string'
        ? { username: auth.username.slice(0, 200), password: String(auth.password ?? '').slice(0, 500) }
        : null,
    ...(typeof i.keepLogin === 'boolean' ? { keepLogin: i.keepLogin } : {})
  };
};

const testServer = async (input: TServerInput): Promise<TTestResult> => {
  let origin: string;

  try {
    origin = normalizeUrl(input.url);
  } catch {
    return { ok: false, error: t('not a url') };
  }

  const headers: Record<string, string> = {};

  if (input.basicAuth?.username) {
    // an empty password on edit means "keep the stored one"
    let password = input.basicAuth.password;

    if (!password && input.id) {
      const stored = getSettings().servers.find((s) => s.id === input.id)?.basicAuth;
      if (stored) password = decryptPassword(stored.passwordEnc);
    }

    headers['Authorization'] = basicHeaderFor(input.basicAuth.username, password);
  }

  try {
    const res = await net.fetch(`${origin}/info`, { headers, signal: AbortSignal.timeout(8000) });

    if (res.status === 401) return { ok: false, status: 401, error: t('proxy login wrong or missing') };
    if (!res.ok) return { ok: false, status: res.status, error: `http ${res.status}` };

    const info = await res.json();

    if (typeof info?.serverId !== 'string') return { ok: false, error: t('not a sharkord server') };

    return { ok: true, info, version: res.headers.get('x-sharkord-version') ?? undefined };
  } catch (err) {
    return { ok: false, error: `${t('unreachable')} | ${(err as Error).message.toLowerCase().replace(/^net::err_/, '').replace(/_/g, ' ')}` };
  }
};

/** a message from a page: only honoured when the frame belongs to a saved server */
const fromSavedServer = (event: IpcMainEvent) => !!findServerByUrl(event.senderFrame?.url ?? '');

const idList = (ids: unknown): string[] | null =>
  Array.isArray(ids) ? ids.filter((i): i is string => typeof i === 'string') : null;

export const registerIpc = ({ connectToServer, getMainWindow, spellcheckAtStart }: THandlers) => {
  spellcheckAtStartup = spellcheckAtStart;

  // sync bootstrap for the preload. the bridge token and the capture patch go only to pages
  // of a saved server, never to whatever else the window may have been navigated to
  ipcMain.on('shell:bootstrap', (event) => {
    const url = event.senderFrame?.url ?? '';
    const own = isOwnPageUrl(url);
    const server = own ? undefined : findServerByUrl(url);
    const bridge = getBridgeStatus();

    event.returnValue = {
      ownPage: ownPageOf(url),
      isSavedServer: !!server,
      platform: process.platform,
      version: __APP_VERSION__,
      storeUpdates: updatesFromStore(),
      lang: currentLang(),
      wayland: isWayland(),
      bridge: server && bridge.ownedByUs ? { ownedByUs: true, token: getBridgeToken() } : null,
      // sharkord's own login, kept across launches (the page would hold it in localStorage anyway)
      login: server && server.keepLogin !== false ? { token: loginTokenFor(server) } : null,
      screenAudio: server
        ? {
            pipewire: getScreenAudioMode() === 'pipewire',
            virtualMic: VIRTUAL_MIC_LABEL,
            // windows before 22H2: loopbackWithoutChrome fails, so the restrict constraint is dropped
            dropRestrict: process.platform === 'win32' && !canExcludeOwnAudioOnWindows()
          }
        : null
    };
  });

  // from saved server pages only: voice state for the tray, and new-message notifications
  // the overlay page measured itself
  ipcMain.on('overlay:height', (event, h: unknown) => {
    if (ownPageOf(event.senderFrame?.url ?? '') !== 'overlay') return;
    setOverlayHeight(event.sender, Number(h));
  });
  // the overlay's buttons: sharkord's own mic / deafen buttons, or the stream pop-out
  ipcMain.on('overlay:action', (event, action: unknown) => {
    if (ownPageOf(event.senderFrame?.url ?? '') !== 'overlay') return;
    if (action === 'mic' || action === 'sound') getMainPage()?.send('shell:voice-action', action);
    else if (action === 'popout') void popOutStream();
  });
  ipcMain.on('server:voice', (event, state: TVoiceReport) => {
    if (!fromSavedServer(event)) return;

    const voice = {
      connected: state?.connected === true,
      inVoice: state?.inVoice === true,
      micMuted: state?.micMuted === true,
      deafened: state?.deafened === true,
      speaking: state?.speaking === true
    };
    setVoiceState(voice);

    // the page is not trusted with shapes: names are cut short, a call has at most 50 rows here
    const members = (Array.isArray(state?.members) ? state.members : []).slice(0, 50).map((m) => ({
      name: String(m?.name ?? '').slice(0, 64),
      self: m?.self === true,
      speaking: m?.speaking === true,
      micMuted: m?.micMuted === true,
      deafened: m?.deafened === true,
      sharing: m?.sharing === true,
      video: m?.video === true
    }));
    setOverlayVoice(voice, String(state?.channel ?? '').slice(0, 64), members, Math.max(0, Math.min(99, Number(state?.streams) || 0)));
    setStreams(voice.inVoice ? Math.max(0, Math.min(99, Number(state?.streams) || 0)) : 0);
  });
  ipcMain.on('server:notification', (event) => {
    if (!fromSavedServer(event) || !getSettings().notifyTray) return;

    const win = getMainWindow();
    if (!win || !win.isFocused() || !win.isVisible()) addUnread();
  });
  // pipewire screen-share audio, driven by the page's getDisplayMedia wrapper
  ipcMain.handle('server:screen-audio', (event, step: unknown) => {
    if (!findServerByUrl(event.senderFrame?.url ?? '')) return false;
    if (step === 'start') return startPipeWireShare();
    if (step === 'unmute') return unmutePipeWireShare(), true;
    if (step === 'stop') return stopPipeWireShare(), true;
    return false;
  });

  // the page reports sharkord's login token (or that the server rejected the held one)
  ipcMain.on('server:login', (event, token: unknown) => {
    const server = findServerByUrl(event.senderFrame?.url ?? '');
    if (!server) return;
    if (token === null) setLoginToken(server.id, null);
    else if (typeof token === 'string' && token.length > 0 && token.length <= 4096) setLoginToken(server.id, token);
  });

  // sharkord's title carries its own unread total: "name (3)"
  ipcMain.on('server:title', (event, title: unknown) => {
    if (!fromSavedServer(event) || typeof title !== 'string') return;
    const m = /\((\d+)\)\s*$/.exec(title);
    setTitleUnread(m ? Math.min(999, Number(m[1])) : 0);
  });

  // warnings from the page side, for diagnostics
  ipcMain.on('server:log', (event, text: unknown) => {
    if (!fromSavedServer(event) || typeof text !== 'string') return;
    log('page', text.slice(0, 500));
  });

  ipcMain.on('server:notification-click', (event) => {
    if (!fromSavedServer(event)) return;

    const win = getMainWindow();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });

  ipcMain.handle('settings:get', guard(() => ({ ...getSettings(), secureStorage: safeStorage.isEncryptionAvailable(), spellcheckAtStart: spellcheckAtStartup })));
  ipcMain.handle('settings:save', guard((_e, patch: unknown) => {
    const picked = pickSettingsPatch(patch);
    const saved = saveSettings(picked);
    if (picked.spellcheck !== undefined) applySpellcheck(saved.spellcheck);
    if (picked.checkUpdates === true) startUpdater();
    if (picked.overlay !== undefined || picked.overlayOpacity !== undefined || picked.overlayClickThrough !== undefined) refreshOverlay();
    if (picked.theme !== undefined) refreshCustomCss();
    if (picked.language !== undefined) onLanguageChange();
    return saved;
  }));
  ipcMain.handle('servers:list', guard(() => publicServers()));
  // saving also tests the connection and records the outcome on the entry
  ipcMain.handle('servers:save', guard(async (_e, input: unknown) => {
    const entry = upsertServer(pickServerInput(input));
    const test = await testServer({ ...pickServerInput(input), id: entry.id });

    recordTest(entry.id, { ok: test.ok, status: test.ok ? undefined : test.status });

    const saved = getSettings().servers.find((s) => s.id === entry.id)!;
    const { basicAuth, ...safe } = saved;

    return { server: { ...safe, basicAuth: basicAuth ? { username: basicAuth.username, passwordEnc: '' } : undefined }, test };
  }));
  ipcMain.handle('servers:remove', guard((_e, id: unknown) => removeServer(String(id))));
  ipcMain.handle('servers:keepLogin', guard((_e, id: unknown, keep: unknown) => setKeepLogin(String(id), keep === true)));
  ipcMain.handle('servers:connect', guard((_e, id: unknown) => connectToServer(String(id))));
  ipcMain.handle('bridge:status', guard(() => getBridgeStatus()));
  ipcMain.handle('css:edit', guard(() => editCustomCss()));
  ipcMain.handle('css:example', guard(() => useExample()));
  ipcMain.handle('screenAudio:info', guard(() => describeScreenAudio()));

  // sharing: ids null = every server; passwords only when asked
  ipcMain.handle('share:code', guard((_e, ids: unknown, withPasswords: unknown) => toCode(buildExport(idList(ids), withPasswords === true))));
  // file dialogs belong to the window that asked (the launcher)
  ipcMain.handle('share:exportFile', guard((e, ids: unknown, withPasswords: unknown) => exportToFile(BrowserWindow.fromWebContents(e.sender), buildExport(idList(ids), withPasswords === true))));
  ipcMain.handle('share:importText', guard((_e, text: unknown) => importShared(parseShared(String(text ?? '').slice(0, 200_000)))));
  ipcMain.handle('share:importFile', guard((e) => importFromFile(BrowserWindow.fromWebContents(e.sender))));
  ipcMain.handle('app:website', guard(() => shell.openExternal('https://innovativefluid.net')));
  ipcMain.handle('autostart:get', guard(() => ({ supported: isAutoStartSupported(), enabled: getAutoStart() })));
  ipcMain.handle('autostart:set', guard((_e, enabled: unknown) => setAutoStart(enabled === true)));
  ipcMain.handle('update:status', guard(() => getUpdateStatus()));
  ipcMain.handle('update:install', guard(() => installUpdateNow()));
  ipcMain.handle('update:open', guard(() => openReleasePage()));
  ipcMain.handle('diag:text', guard(() => diagnostics()));

  // update news goes to whichever of our pages are open (the launcher shows it)
  onUpdateStatus((status) => {
    for (const wc of webContents.getAllWebContents()) if (isOwnPageUrl(wc.getURL())) wc.send('update:status', status);
  });
};
