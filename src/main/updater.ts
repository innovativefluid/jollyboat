// Auto-update on Windows through electron-updater and GitHub Releases (needs the NSIS installer;
// the MSI cannot update itself). Linux updates come through Flatpak. Checked once at startup
// and every six hours; downloaded updates install on quit.

import { app } from 'electron';
import { getSettings } from './settings';
import type { TUpdateStatus } from '../shared/types';

let status: TUpdateStatus = { state: 'idle' };
let started = false;
const listeners = new Set<(s: TUpdateStatus) => void>();

const set = (next: TUpdateStatus) => {
  status = next;
  listeners.forEach((l) => l(status));
};

export const getUpdateStatus = () => status;
export const onUpdateStatus = (l: (s: TUpdateStatus) => void) => listeners.add(l);

export const startUpdater = async () => {
  if (started || process.platform !== 'win32' || !app.isPackaged || !getSettings().checkUpdates) return;

  started = true;

  try {
    const { autoUpdater } = await import('electron-updater');

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = null;

    autoUpdater.on('checking-for-update', () => set({ state: 'checking' }));
    autoUpdater.on('update-available', (info) => set({ state: 'available', version: info.version }));
    autoUpdater.on('update-not-available', () => set({ state: 'none' }));
    autoUpdater.on('update-downloaded', (info) => set({ state: 'downloaded', version: info.version }));
    autoUpdater.on('error', (err) => set({ state: 'error', message: err.message.toLowerCase() }));

    // the toggle is read on every round, so turning it off stops the next check
    const check = () => (getSettings().checkUpdates ? autoUpdater.checkForUpdates().catch(() => undefined) : undefined);

    check();
    setInterval(check, 6 * 60 * 60 * 1000);
  } catch (err) {
    set({ state: 'error', message: (err as Error).message.toLowerCase() });
  }
};

export const installUpdateNow = async () => {
  if (status.state !== 'downloaded') return;

  const { autoUpdater } = await import('electron-updater');

  autoUpdater.quitAndInstall();
};
