// window.sharkordDesktop on a saved server's page: Sharkord's desktop bridge, version 1 (sharkord's
// packages/shared/src/desktop.ts). The client connects once when it starts and from then on runs
// in desktop mode; main/desktop.ts answers the calls.

import { contextBridge, type IpcRenderer } from 'electron';

const VERSION = 1;

type TListener = (...args: never[]) => void;

export const exposeDesktopBridge = (ipc: IpcRenderer) => {
  // each kind of push from main, to whoever listens in the page
  const listeners = {
    hotkey: new Set<TListener>(),
    errors: new Set<TListener>(),
    click: new Set<TListener>(),
    list: new Set<TListener>()
  };
  const listen = (kind: keyof typeof listeners) => (listener: unknown) => {
    if (typeof listener !== 'function') return () => undefined;
    const l = listener as TListener;
    listeners[kind].add(l);
    return () => {
      listeners[kind].delete(l);
    };
  };
  const call = (kind: keyof typeof listeners, ...args: unknown[]) => {
    for (const l of listeners[kind]) {
      try {
        (l as (...a: unknown[]) => void)(...args);
      } catch (err) {
        console.error('[jollyboat] desktop listener', err);
      }
    }
  };
  ipc.on('desktop:hotkey', (_e, actionId: string, phase: 'down' | 'up') => call('hotkey', actionId, phase));
  ipc.on('desktop:hotkey-errors', (_e, errors: unknown) => call('errors', errors));
  ipc.on('desktop:notification-click', (_e, target: unknown) => call('click', target));
  ipc.on('desktop:list-visible', (_e, visible: unknown) => call('list', visible === true));

  const bridge = {
    getServerListVisible: () => ipc.invoke('desktop:list-visible') as Promise<boolean>,
    onServerListVisibleChange: listen('list'),
    toggleServerList: () => ipc.invoke('desktop:toggle-list') as Promise<void>,
    openSettings: () => ipc.invoke('desktop:settings') as Promise<void>,
    setUnreadState: (state: unknown) => ipc.send('desktop:unread', state),
    setConnectionState: (state: unknown) => ipc.send('desktop:connection', state),
    setVoiceActive: (active: unknown) => ipc.send('desktop:voice', active),
    startSystemAudio: () => ipc.invoke('desktop:system-audio', 'start') as Promise<boolean>,
    stopSystemAudio: () => ipc.invoke('desktop:system-audio', 'stop').then(() => undefined),
    showNotification: (notification: unknown) => ipc.send('desktop:notify', notification),
    setHotkeys: (bindings: unknown) => ipc.invoke('desktop:hotkeys', bindings),
    getHotkeyCapabilities: () => ipc.invoke('desktop:hotkey-caps'),
    onHotkey: listen('hotkey'),
    onHotkeyErrors: listen('errors'),
    onNotificationClick: listen('click')
  };

  contextBridge.exposeInMainWorld('sharkordDesktop', {
    version: VERSION,
    // another version: no bridge, the client runs as in a browser
    connect: (clientVersion: unknown) => (clientVersion === VERSION ? bridge : undefined)
  });
};
