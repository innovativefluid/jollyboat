// Updates. Windows (installed) and the Linux AppImage: electron-updater against GitHub Releases
// (latest.yml, latest-linux.yml, latest-linux-arm64.yml), downloads in the background and
// installs on quit (the AppImage replaces its own file). The portable exe updates itself too, in
// its own way (portable-update.ts: latest-portable.json, the file swapped next to itself). The
// .flatpak from GitHub and the mac build: only a notice that a newer release exists (a bundle
// file has no update channel; an unsigned mac app cannot update itself). The Flathub build
// checks nothing: Flathub delivers its updates. All run only in packaged builds, every six
// hours, behind the "check for updates" toggle.

import { app, net, shell } from 'electron';
import type { TUpdateStatus } from '../shared/types';
import { log } from './log';
import { getSettings } from './settings';
import { integrateAppImage } from './appimage';
import { refreshAutoStart } from './autostart';
import { downloadPortable, portableFile, portableInfo, restartPortable } from './portable-update';

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

/** the newest published release on github */
const latestRelease = async () => {
  const res = await net.fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`http ${res.status}`);
  const releases = (await res.json()) as { tag_name: string; draft: boolean; html_url: string }[];
  const latest = releases.find((r) => !r.draft && /^v\d+\.\d+\.\d+$/.test(r.tag_name));
  return latest ? { version: latest.tag_name.slice(1), url: latest.html_url } : null;
};

/** linux and mac: look at github, say so if there is something newer */
const checkGitHub = async () => {
  set({ state: 'checking' });

  try {
    const latest = await latestRelease();
    if (latest && newer(latest.version, app.getVersion())) set({ state: 'available', version: latest.version, url: latest.url });
    else set({ state: 'none' });
  } catch (err) {
    set({ state: 'error', message: (err as Error).message.toLowerCase() });
  }
};

/** the portable exe: a newer release's portable exe downloaded, checked and put in place */
let portableBusy = false;
const checkPortable = async () => {
  // (a new version already waiting for its start: nothing more to do)
  if (portableBusy || status.state === 'downloaded') return;
  portableBusy = true;
  set({ state: 'checking' });

  try {
    const latest = await latestRelease();
    if (!latest || !newer(latest.version, app.getVersion())) return set({ state: 'none' });
    const file = await portableInfo(latest.version);
    // a release from before the portable updates: the notice, as before
    if (!file) return set({ state: 'available', version: latest.version, url: latest.url });
    set({ state: 'available', version: latest.version });
    await downloadPortable(latest.version, file);
    set({ state: 'downloaded', version: latest.version });
  } catch (err) {
    set({ state: 'error', message: (err as Error).message.toLowerCase() });
  } finally {
    portableBusy = false;
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

/** builds that replace themselves: the installed windows app and the appimage */
export const canSelfUpdate = () =>
  (process.platform === 'win32' && !process.env.PORTABLE_EXECUTABLE_DIR) || (process.platform === 'linux' && !!process.env.APPIMAGE);

const startSelfUpdate = async () => {
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
  // the appimage's new file got the new version's name: the menu entry and autostart follow it
  (autoUpdater as unknown as NodeJS.EventEmitter).on('appimage-filename-updated', (path: string) => {
    process.env.APPIMAGE = path;
    integrateAppImage();
    refreshAutoStart();
  });

  return () => autoUpdater.checkForUpdates().catch(() => undefined);
};

/** the flathub build: updates come through flatpak, the app never looks at github */
export const updatesFromStore = () => process.env.JOLLYBOAT_CHANNEL === 'flathub';

export const startUpdater = async () => {
  if (started || !app.isPackaged || !getSettings().checkUpdates || updatesFromStore()) return;
  if (!['win32', 'linux', 'darwin'].includes(process.platform)) return;

  started = true;

  try {
    // the flatpak cannot replace itself: like mac it gets the notice (if the updater itself fails
    // to load, at least the notice still comes)
    const run = portableFile() ? checkPortable : canSelfUpdate() ? await startSelfUpdate().catch(() => checkGitHub) : checkGitHub;
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
  // the portable exe: the new file is in place already, it only has to start
  if (portableFile()) return restartPortable();

  (await loadAutoUpdater()).quitAndInstall();
};

export const openReleasePage = () => {
  const url = status.url && status.url.startsWith(`${RELEASES_PAGE}/`) ? status.url : RELEASES_PAGE;
  return shell.openExternal(url);
};
