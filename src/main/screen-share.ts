// Screen sharing with audio.
//  Video: our own picker on Windows and X11, the xdg-desktop-portal dialog on Wayland.
//  Audio: see screen-audio.ts — chromium loopback where it can leave our own sound out (windows)
//         or as the linux fallback; pipewire shares are video-only here and get their audio
//         track from the virtual mic in the preload.

import { BrowserWindow, desktopCapturer, ipcMain, session } from 'electron';
import type { TCaptureSource, TPickerResult } from '../shared/types';
import { log } from './log';
import { loopbackForRequest, markShareGranted } from './screen-audio';
import { getSettings, saveSettings } from './settings';
import { pageUrl, preloadPath, iconPath } from './paths';

const isWaylandSession = () =>
  process.platform === 'linux' && (!!process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === 'wayland');

let pickerWindow: BrowserWindow | null = null;
let resolvePick: ((r: TPickerResult) => void) | null = null;

const openPicker = (parent: BrowserWindow | undefined, sources: TCaptureSource[]) =>
  new Promise<TPickerResult>((resolve) => {
    resolvePick = resolve;

    pickerWindow = new BrowserWindow({
      width: 760,
      height: 560,
      parent,
      modal: !!parent,
      show: false,
      autoHideMenuBar: true,
      icon: iconPath(),
      title: 'Share your screen',
      webPreferences: { preload: preloadPath(), sandbox: true, contextIsolation: true }
    });

    pickerWindow.once('ready-to-show', () => pickerWindow?.show());
    pickerWindow.webContents.once('did-finish-load', () => {
      pickerWindow?.webContents.send('picker:sources', sources, getSettings().lastSourceName);
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

const listSources = async (withThumbnails: boolean): Promise<TCaptureSource[]> => {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: withThumbnails ? { width: 320, height: 200 } : { width: 0, height: 0 },
    fetchWindowIcons: withThumbnails
  });

  return sources.map((s) => ({
    id: s.id,
    name: s.name,
    kind: s.id.startsWith('screen') ? 'screen' : 'window',
    thumbnail: withThumbnails && !s.thumbnail.isEmpty() ? s.thumbnail.toDataURL() : '',
    appIcon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : undefined
  }));
};

export const installDisplayMediaHandler = (getMainWindow: () => BrowserWindow | null) => {
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      if (isWaylandSession()) {
        // wayland / pipewire: the portal dialog is shown by getSources itself and the user's
        // pick comes back as the only entry (none if they cancelled). on x11 every screen and
        // window comes back instead, so that path falls through to our own picker
        const [source] = await desktopCapturer.getSources({ types: ['screen', 'window'] });

        if (source) markShareGranted();
        return callback(source ? { video: source, audio: loopbackForRequest(request.audioRequested) } : {});
      }

      const sources = await listSources(true);
      const pick = await openPicker(getMainWindow() ?? undefined, sources);

      if (!pick) return callback({});

      const raw = await desktopCapturer.getSources({ types: ['screen', 'window'] });
      const source = raw.find((s) => s.id === pick.sourceId);

      if (!source) return callback({});

      saveSettings({ lastSourceName: source.name });
      markShareGranted();

      callback({ video: source, audio: loopbackForRequest(request.audioRequested) });
    } catch (err) {
      log('screen-share', 'failed', String(err));
      callback({});
    }
  });
};
