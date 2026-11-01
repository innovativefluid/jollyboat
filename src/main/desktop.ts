// Sharkord's desktop mode (sharkord 0.0.29+). A server's client looks for window.sharkordDesktop
// when it starts; the preload puts it there on saved servers (desktop-bridge.ts), and with it the
// client hands its notifications, unread and mention counts, connection state, whether it is in
// a call, and its hotkeys to the app instead of doing them in the page. The calls arrive here.
//
// Bridge version 1 only: a client of another version gets nothing back from connect() and runs
// as in a browser (the old hotkey bridge, the page's own notifications), as do servers from
// before the desktop mode.

import { ipcMain, nativeImage, Notification, session, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { clearDesktopHotkeys, hotkeyCapabilities, setDesktopHotkeys } from './hotkeys/bridge';
import { log } from './log';
import { findServerByUrl, getSettings } from './settings';

export const DESKTOP_BRIDGE_VERSION = 1;

export type TConnection = 'connecting' | 'connected' | 'signed-out' | 'disconnected';
type TTarget = { type: 'message'; channelId: number; messageId: number; parentMessageId?: number; isDm: boolean } | { type: 'plugin'; pluginId: string; data?: unknown };

type THandlers = {
  setUnread: (wc: WebContents, count: number, mentioned: boolean) => void;
  setConnection: (wc: WebContents, state: TConnection) => void;
  setVoice: (wc: WebContents, active: boolean) => void;
  /** a notification went up (the tray's marker) */
  notified: (wc: WebContents) => void;
  /** one was clicked: the window and that server's tab come up */
  clicked: (wc: WebContents) => void;
  listVisible: () => boolean;
  toggleList: () => void;
  openSettings: () => void;
};

/** a call from a saved server's page in desktop mode */
const allowed = (event: IpcMainEvent | IpcMainInvokeEvent) => !!findServerByUrl(event.senderFrame?.url ?? '');

const MAX_ICON = 2 * 1024 * 1024;
const DATA_ICON = /^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i;

const loadIcon = async (icon: unknown) => {
  if (typeof icon !== 'string' || icon.length > 700_000) return undefined;
  if (DATA_ICON.test(icon)) {
    const img = nativeImage.createFromDataURL(icon);
    return img.isEmpty() ? undefined : img;
  }
  if (!/^https?:\/\//i.test(icon)) return undefined;
  try {
    // the app's session: a server behind a proxy login gets its login along
    const res = await session.defaultSession.fetch(icon, { signal: AbortSignal.timeout(2000) });
    if (!res.ok || Number(res.headers.get('content-length') ?? 0) > MAX_ICON) return undefined;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_ICON) return undefined;
    const img = nativeImage.createFromBuffer(buf);
    return img.isEmpty() ? undefined : img;
  } catch {
    return undefined;
  }
};

const cut = (v: unknown, n: number) => {
  const s = typeof v === 'string' ? v : '';
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

const pickTarget = (raw: unknown): TTarget | undefined => {
  const t = (raw ?? null) as Record<string, unknown> | null;
  if (!t) return undefined;
  const int = (v: unknown) => typeof v === 'number' && Number.isInteger(v);
  if (t.type === 'message' && int(t.channelId) && int(t.messageId) && typeof t.isDm === 'boolean') {
    return {
      type: 'message',
      channelId: t.channelId as number,
      messageId: t.messageId as number,
      isDm: t.isDm,
      ...(int(t.parentMessageId) ? { parentMessageId: t.parentMessageId as number } : {})
    };
  }
  if (t.type === 'plugin' && typeof t.pluginId === 'string' && t.pluginId.length > 0 && t.pluginId.length <= 128) {
    let data: unknown;
    try {
      data = t.data === undefined || JSON.stringify(t.data).length > 4096 ? undefined : JSON.parse(JSON.stringify(t.data));
    } catch {
      data = undefined;
    }
    return { type: 'plugin', pluginId: t.pluginId, ...(data !== undefined ? { data } : {}) };
  }
  return undefined;
};

// pages whose key bindings go when the page does
const hooked = new Set<number>();

// shown notifications are kept until clicked or closed (else they can be collected and lose their click)
const shown = new Set<Notification>();

export const installDesktopBridge = (h: THandlers) => {
  ipcMain.on('desktop:unread', (event, state: unknown) => {
    if (!allowed(event)) return;
    const s = (state ?? {}) as Record<string, unknown>;
    const count = Number.isInteger(s.count) && (s.count as number) >= 0 ? Math.min(99_999, s.count as number) : 0;
    h.setUnread(event.sender, count, s.mentioned === true);
  });
  ipcMain.on('desktop:connection', (event, state: unknown) => {
    if (!allowed(event)) return;
    if (state === 'connecting' || state === 'connected' || state === 'signed-out' || state === 'disconnected') h.setConnection(event.sender, state);
  });
  ipcMain.on('desktop:voice', (event, active: unknown) => {
    if (allowed(event) && typeof active === 'boolean') h.setVoice(event.sender, active);
  });

  ipcMain.on('desktop:notify', async (event, raw: unknown) => {
    if (!allowed(event)) return;
    const sender = event.sender;
    h.notified(sender);
    if (!Notification.isSupported()) return;
    const n = (raw ?? {}) as Record<string, unknown>;
    const target = pickTarget(n.target);
    const note = new Notification({
      title: cut(n.title, 200),
      body: cut(n.body, 1000),
      icon: await loadIcon(n.icon),
      // sharkord plays its own sound
      silent: true
    });
    const release = () => shown.delete(note);
    note.on('click', () => {
      release();
      log('desktop', 'notification clicked');
      if (sender.isDestroyed()) return;
      h.clicked(sender);
      if (target) sender.send('desktop:notification-click', target);
    });
    note.on('close', release);
    shown.add(note);
    note.show();
    log('desktop', `notification${target ? ` (${target.type})` : ''}`);
  });

  ipcMain.handle('desktop:hotkeys', async (event, bindings: unknown) => {
    if (!allowed(event)) return [];
    const wc = event.sender;
    const server = findServerByUrl(event.senderFrame?.url ?? '')!;
    if (!hooked.has(wc.id)) {
      hooked.add(wc.id);
      const drop = () => {
        hooked.delete(wc.id);
        clearDesktopHotkeys(wc.id);
      };
      wc.once('destroyed', drop);
      // a new page in the same view starts without keys
      wc.on('did-start-navigation', (d) => d.isMainFrame && !d.isSameDocument && clearDesktopHotkeys(wc.id));
    }
    return setDesktopHotkeys(
      wc.id,
      server.id,
      bindings,
      (actionId, phase) => !wc.isDestroyed() && wc.send('desktop:hotkey', actionId, phase),
      (errors) => !wc.isDestroyed() && wc.send('desktop:hotkey-errors', errors)
    );
  });
  ipcMain.handle('desktop:hotkey-caps', (event) => (allowed(event) ? hotkeyCapabilities() : { keyUp: false, systemManaged: false }));

  ipcMain.handle('desktop:list-visible', (event) => allowed(event) && h.listVisible());
  ipcMain.handle('desktop:toggle-list', (event) => {
    if (allowed(event)) h.toggleList();
  });
  ipcMain.handle('desktop:settings', (event) => {
    if (allowed(event)) h.openSettings();
  });
  // the screen share's system audio: the page's getDisplayMedia already carries it where the
  // system can (pipewire, windows and mac loopback, see preload/index.ts), so there is nothing
  // more to start
  ipcMain.handle('desktop:system-audio', () => false);

  log('desktop', `desktop bridge v${DESKTOP_BRIDGE_VERSION}`);
};

/** every server page in desktop mode hears whether the server list (our tabs) shows */
export const sendListVisible = (pages: WebContents[], visible: boolean) => {
  for (const wc of pages) if (!wc.isDestroyed()) wc.send('desktop:list-visible', visible);
};
