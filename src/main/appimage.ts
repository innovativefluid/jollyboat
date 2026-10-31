// The AppImage in the app menu. An AppImage is a single file the user keeps anywhere, and unlike
// the Flatpak nothing installs it, so on every start Jollyboat puts its own menu entry and icon
// into the user's data folder (~/.local/share/applications, ~/.local/share/icons), pointing at the
// AppImage file. The entry also declares sharkord:// links. TryExec makes the desktop hide it
// once the file is gone. A self-update can rename the file (its name carries the version), so
// the entry is rewritten then too.
//
// Left alone: an entry an AppImage integrator wrote (AppImageLauncher, Gear Lever; no marker of
// ours), and the name of the Flatpak's entry when the Flatpak is installed too (a second name then,
// so the Flatpak's stays as it is).

import { app, nativeImage } from 'electron';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { log } from './log';
import { iconPath } from './paths';

const APP_ID = 'net.innovativefluid.Jollyboat';
const MARKER = 'X-Jollyboat-Generated=true';
const ICON_SIZES = [48, 64, 128, 256, 512];

const dataDir = () => process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');

/** the flatpak exports its entry under the app id; the appimage then takes a name of its own */
const flatpakInstalled = () =>
  [join(dataDir(), 'flatpak/exports/share/applications'), '/var/lib/flatpak/exports/share/applications'].some((dir) => existsSync(join(dir, `${APP_ID}.desktop`)));

const writeIfChanged = (file: string, content: string | Buffer) => {
  try {
    if (readFileSync(file).equals(Buffer.from(content))) return false;
  } catch {
    /* not there yet */
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  return true;
};

// desktop entry values: the path in quotes, with the characters the spec wants escaped
const quoted = (path: string) => `"${path.replace(/(["`$\\])/g, '\\$1')}"`;

/** puts the appimage into the app menu (or refreshes its entry); a no-op anywhere else */
export const integrateAppImage = () => {
  const image = process.env.APPIMAGE;
  if (process.platform !== 'linux' || !app.isPackaged || !image) return;

  const name = flatpakInstalled() ? `${APP_ID}.AppImage` : APP_ID;
  const file = join(dataDir(), 'applications', `${name}.desktop`);

  try {
    if (existsSync(file) && !readFileSync(file, 'utf8').includes(MARKER)) {
      log('appimage', 'menu entry from an integrator, left alone');
      return;
    }

    const source = nativeImage.createFromPath(iconPath());
    for (const size of ICON_SIZES) {
      writeIfChanged(join(dataDir(), 'icons/hicolor', `${size}x${size}`, 'apps', `${APP_ID}.png`), source.resize({ width: size, height: size, quality: 'best' }).toPNG());
    }

    const changed = writeIfChanged(
      file,
      [
        '[Desktop Entry]',
        'Type=Application',
        'Name=Jollyboat',
        'Comment=Sharkord client',
        `TryExec=${image}`,
        `Exec=${quoted(image)} %U`,
        `Icon=${APP_ID}`,
        'Terminal=false',
        'Categories=Network;Chat;InstantMessaging;',
        'Keywords=Sharkord;chat;voice;video;screen share;',
        `StartupWMClass=${APP_ID}`,
        'MimeType=x-scheme-handler/sharkord;',
        MARKER,
        ''
      ].join('\n')
    );

    if (changed) {
      log('appimage', 'menu entry written');
      // the desktop's cache of which app takes which link (missing tool: it notices later anyway)
      const refresh = spawn('update-desktop-database', [dirname(file)], { stdio: 'ignore', detached: true });
      refresh.on('error', () => undefined);
      refresh.unref();
    }
  } catch (err) {
    log('appimage', 'menu entry failed:', (err as Error).message);
  }
};
