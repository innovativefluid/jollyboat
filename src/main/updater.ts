// Updates. Windows: electron-updater against GitHub Releases, downloads in the background and
// installs on quit. Linux: only a notice that a newer release exists (a .flatpak file has no
// update channel; Flathub will). Both run only in packaged builds, every six hours, behind the
// "check for updates" toggle. 0.x releases are pre-releases, so those count.

import { app, net, shell } from 'electron';
import type { TUpdateStatus } from '../shared/types';
import { log } from './log';
import { getSettings } from './settings';

const RELEASES_API = 'https://api.github.com/repos/innovativefluid/jollyboat/releases?per_page=10';
const RELEASES_PAGE = 'https://github.com/innovativefluid/jollyboat/releases';
const INTERVAL = 6 * 60 * 60 * 1000;

let status: TUpdateStatus = { state: 'idle' };
let started = false;
const listeners = new Set<(s: TUpdateStatus) => void>();

const set = (next: TUpdateStatus) => {
  status = next;
  log('updater', next.state, next.version ?? '', next.message ?? '');
  listeners.forEach((l) => l(status));
};

export const getUpdateStatus = () => status;
export const onUpdateStatus = (l: (s: TUpdateStatus) => void) => listeners.add(l);

const newer = (a: string, b: string) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
};

/** linux: look at github, say so if there is something newer */
const checkLinux = async () => {
  set({ state: 'checking' });

  try {
    const res = await net.fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`http ${res.status}`);

    const releases = (await res.json()) as { tag_name: string; draft: boolean; html_url: string }[];
    const latest = releases.find((r) => !r.draft && /^v\d+\.\d+\.\d+$/.test(r.tag_name));
    const version = latest?.tag_name.slice(1);

    if (version && newer(version, app.getVersion())) set({ state: 'available', version, url: latest!.html_url });
    else set({ state: 'none' });
  } catch (err) {
    set({ state: 'error', message: (err as Error).message.toLowerCase() });
  }
};

const startWindows = async () => {
  const { autoUpdater } = await import('electron-updater');

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = true;
  autoUpdater.logger = null;

  autoUpdater.on('checking-for-update', () => set({ state: 'checking' }));
  autoUpdater.on('update-available', (info) => set({ state: 'available', version: info.version }));
  autoUpdater.on('update-not-available', () => set({ state: 'none' }));
  autoUpdater.on('update-downloaded', (info) => set({ state: 'downloaded', version: info.version }));
  autoUpdater.on('error', (err) => set({ state: 'error', message: err.message.toLowerCase() }));

  return () => autoUpdater.checkForUpdates().catch(() => undefined);
};

export const startUpdater = async () => {
  if (started || !app.isPackaged || !getSettings().checkUpdates) return;
  if (process.platform !== 'win32' && process.platform !== 'linux') return;

  started = true;

  try {
    const run = process.platform === 'win32' ? await startWindows() : checkLinux;
    // the toggle is read on every round, so turning it off stops the next check
    const check = () => (getSettings().checkUpdates ? run() : undefined);

    check();
    setInterval(check, INTERVAL);
  } catch (err) {
    set({ state: 'error', message: (err as Error).message.toLowerCase() });
  }
};

export const installUpdateNow = async () => {
  if (status.state !== 'downloaded') return;

  const { autoUpdater } = await import('electron-updater');

  autoUpdater.quitAndInstall();
};

export const openReleasePage = () => shell.openExternal(status.url ?? RELEASES_PAGE);
