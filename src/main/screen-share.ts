// Screen sharing with audio.
//  Video: our own picker on Windows and X11, the xdg-desktop-portal dialog on Wayland.
//  Audio: see screen-audio.ts — chromium loopback where it can leave our own sound out (windows)
//         or as the linux fallback; pipewire shares are video-only here and get their audio
//         track from the virtual mic in the preload.

import { BrowserWindow, desktopCapturer, ipcMain, session, type BaseWindow } from 'electron';
import type { TCaptureSource, TPickerResult, TPickerSound } from '../shared/types';
import { log } from './log';
import { t } from './lang';
import { getScreenAudioMode, listSoundApps, loopbackForRequest, markShareGranted, setShareSound, soundAppsSupported } from './screen-audio';
import { getSettings, saveSettings } from './settings';
import { pageUrl, preloadPath, iconPath } from './paths';
import { windowBackground } from './look';

const isWaylandSession = () =>
  process.platform === 'linux' && (!!process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === 'wayland');

let pickerWindow: BrowserWindow | null = null;
let resolvePick: ((r: TPickerResult) => void) | null = null;

const openPicker = (parent: BaseWindow | undefined, sources: TCaptureSource[], sound: TPickerSound | null) =>
  new Promise<TPickerResult>((resolve) => {
    resolvePick = resolve;

    // (only the sound: the desktop's own dialog picks the screen or window afterwards)
    const only = !!sound?.only;
    pickerWindow = new BrowserWindow({
      width: only ? 460 : 760,
      height: only ? 170 : 560,
      useContentSize: only,
      parent,
      modal: !!parent,
      show: false,
      autoHideMenuBar: true,
      icon: iconPath(),
      title: t('Share your screen'),
      backgroundColor: windowBackground(),
      webPreferences: { preload: preloadPath(), sandbox: true, contextIsolation: true }
    });

    pickerWindow.once('ready-to-show', () => pickerWindow?.show());
    pickerWindow.webContents.once('did-finish-load', () => {
      pickerWindow?.webContents.send('picker:sources', sources, getSettings().lastSourceName, sound);
    });
    pickerWindow.on('closed', () => {
      pickerWindow = null;
      resolvePick?.(null);
      resolvePick = null;
    });

    pickerWindow.loadURL(pageUrl('picker'));
  });

ipcMain.on('picker:choose', (event, result: TPickerResult) => {
  if (event.sender !== pickerWindow?.webContents) return;

  resolvePick?.(result);
  resolvePick = null;
  pickerWindow?.close();
});

// every screen and window with a preview. on windows a window whose preview can't be captured
// (windows graphics capture refusing it, e.g. some overlays, games, other apps' special windows)
// can make the previewed list come back short or fail as a whole, so the plain list (names only,
// no capture, cheap) is fetched alongside and anything missing from the previews is still offered
const listSources = async (): Promise<TCaptureSource[]> => {
  const [withPreviews, plain] = await Promise.all([
    desktopCapturer
      .getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 200 }, fetchWindowIcons: true })
      .catch((err) => {
        log('screen-share', 'previews failed', String(err));
        return [];
      }),
    process.platform === 'win32'
      ? desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } }).catch(() => [])
      : Promise.resolve([])
  ]);
  const seen = new Set(withPreviews.map((s) => s.id));
  const all = [...withPreviews, ...plain.filter((s) => !seen.has(s.id))];

  const out: TCaptureSource[] = all.map((s) => ({
    id: s.id,
    name: s.name,
    kind: s.id.startsWith('screen') ? 'screen' : 'window',
    thumbnail: !s.thumbnail || s.thumbnail.isEmpty() ? '' : s.thumbnail.toDataURL(),
    appIcon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : undefined
  }));
  // counts only: window titles can be private
  const windows = out.filter((s) => s.kind === 'window');
  log(
    'screen-share',
    `sources: ${out.length - windows.length} screens, ${windows.length} windows (${windows.filter((s) => !s.thumbnail).length} without preview, ${all.length - withPreviews.length} only in the plain list, ${windows.filter((s) => /jollyboat/i.test(s.name)).length} of ours)`
  );
  return out;
};

// the picker's sound menu when the page wants sound: everything but our call, nothing, or (where
// the system lets us) one of the apps playing right now; the last choice comes preselected
const soundMenu = async (audioRequested: boolean, only = false): Promise<TPickerSound | null> => {
  if (!audioRequested || getScreenAudioMode() === 'none') return null;
  const perApp = soundAppsSupported();
  const apps = perApp ? await listSoundApps() : [];
  const last = getSettings().lastSound;
  const known = last === 'all' || last === 'none' || apps.some((a) => `app:${a.id}` === last);
  return { apps, perApp, last: known ? last : 'all', only };
};

const pickedSound = (sound: string | undefined, menu: TPickerSound | null) => {
  if (!menu) return 'all';
  const ok = sound === 'all' || sound === 'none' || (typeof sound === 'string' && menu.apps.some((a) => `app:${a.id}` === sound));
  const out = ok ? sound! : 'all';
  saveSettings({ lastSound: out });
  log('screen-share', `sound: ${out.startsWith('app:') ? 'one app' : out}`);
  return out;
};

// electron refuses an audio key that is there but undefined: it is left out unless loopback
const withAudio = (source: Electron.DesktopCapturerSource, audioRequested: boolean) => {
  const audio = loopbackForRequest(audioRequested);
  return audio ? { video: source, audio } : { video: source };
};

export const installDisplayMediaHandler = (getMainWindow: () => BaseWindow | null) => {
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    log('screen-share', `request (audio ${request.audioRequested ? 'asked' : 'not asked'}, ${isWaylandSession() ? 'portal' : 'own picker'})`);
    setShareSound('all');
    try {
      if (isWaylandSession()) {
        // the sound first, in a small picker of its own (the portal cannot ask): only where
        // there is a choice beyond everything or nothing
        const menu = soundAppsSupported() ? await soundMenu(request.audioRequested, true) : null;
        if (menu) {
          const pick = await openPicker(getMainWindow() ?? undefined, [], menu);
          if (!pick) return callback({});
          setShareSound(pickedSound(pick.sound, menu));
        }
        // wayland / pipewire: the portal dialog is shown by getSources itself and the user's
        // pick comes back as the only entry (none if they cancelled). on x11 every screen and
        // window comes back instead, so that path falls through to our own picker.
        // no thumbnail: it would cost a captured frame nobody sees
        const [source] = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } });

        if (source) markShareGranted();
        return callback(source ? withAudio(source, request.audioRequested) : {});
      }

      const [sources, menu] = await Promise.all([listSources(), soundMenu(request.audioRequested)]);
      const pick = await openPicker(getMainWindow() ?? undefined, sources, menu);

      if (!pick) return callback({});
      setShareSound(pickedSound(pick.sound, menu));

      // only the id is needed now: no thumbnails, which would capture every window again
      const raw = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } });
      const source = raw.find((s) => s.id === pick.sourceId);

      log('screen-share', `picked a ${pick.sourceId.startsWith('screen') ? 'screen' : 'window'}${source ? '' : ', gone by now'}`);
      if (!source) return callback({});

      saveSettings({ lastSourceName: source.name });
      markShareGranted();

      callback(withAudio(source, request.audioRequested));
    } catch (err) {
      log('screen-share', 'failed', String(err));
      callback({});
    }
  });
};
