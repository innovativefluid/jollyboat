// Updates. Windows (installed): electron-updater against GitHub Releases, downloads in the
// background and installs on quit. The portable exe gets the notice described next. The .flatpak from GitHub and the experimental mac build: only a notice that a
// newer release exists (a bundle file has no update channel; an unsigned mac app cannot update
// itself). The Flathub build checks nothing: Flathub delivers its updates. All run only in
// packaged builds, every six hours, behind the "check for updates" toggle.

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

/** linux and mac: look at github, say so if there is something newer */
const checkGitHub = async () => {
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

// electron-updater is commonjs: imported from our esm bundle its exports sit on `default`
// (a named import came back undefined, and every installed copy up to 0.3.8 failed its update
// check with "cannot set properties of undefined (setting 'autoDownload')")
type TUpdater = typeof import('electron-updater');
export const loadAutoUpdater = async () => {
  const mod = (await import('electron-updater')) as TUpdater & { default?: TUpdater };
  const autoUpdater = mod.autoUpdater ?? mod.default?.autoUpdater;
  if (!autoUpdater) throw new Error('electron-updater did not load');
  return autoUpdater;
};

const startWindows = async () => {
  const autoUpdater = await loadAutoUpdater();

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = true; // a release published as pre-release still reaches everyone
  autoUpdater.logger = null;

  autoUpdater.on('checking-for-update', () => set({ state: 'checking' }));
  autoUpdater.on('update-available', (info) => set({ state: 'available', version: info.version }));
  autoUpdater.on('update-not-available', () => set({ state: 'none' }));
  autoUpdater.on('update-downloaded', (info) => set({ state: 'downloaded', version: info.version }));
  autoUpdater.on('error', (err) => set({ state: 'error', message: err.message.toLowerCase() }));

  return () => autoUpdater.checkForUpdates().catch(() => undefined);
};

/** the flathub build: updates come through flatpak, the app never looks at github */
export const updatesFromStore = () => process.env.JOLLYBOAT_CHANNEL === 'flathub';

export const startUpdater = async () => {
  if (started || !app.isPackaged || !getSettings().checkUpdates || updatesFromStore()) return;
  if (!['win32', 'linux', 'darwin'].includes(process.platform)) return;

  started = true;

  try {
    // the portable exe cannot replace itself: like linux and mac it gets the notice
    const portable = !!process.env.PORTABLE_EXECUTABLE_DIR;
    // (if the updater itself fails to load, at least the notice still comes)
    const run = process.platform === 'win32' && !portable ? await startWindows().catch(() => checkGitHub) : checkGitHub;
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

  (await loadAutoUpdater()).quitAndInstall();
};

export const openReleasePage = () => {
  const url = status.url && status.url.startsWith(`${RELEASES_PAGE}/`) ? status.url : RELEASES_PAGE;
  return shell.openExternal(url);
};
