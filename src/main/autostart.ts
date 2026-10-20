// Start with the system. Windows: the login item API. Linux: an XDG autostart desktop entry
// (KDE, GNOME and friends read ~/.config/autostart). Inside Flatpak that directory is reachable
// through the --filesystem=xdg-config/autostart:create permission in the manifest.
// The app is started with --hidden so it only shows up in the tray.

import { app } from 'electron';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DESKTOP_FILE = 'jollyboat.desktop';

const autostartDir = () => join(process.env.XDG_CONFIG_HOME || join(app.getPath('home'), '.config'), 'autostart');

const linuxExec = () => {
  if (process.env.FLATPAK_ID) return `flatpak run ${process.env.FLATPAK_ID} --hidden`;

  // packaged: the binary; dev: electron + the main script
  const parts = app.isPackaged ? [process.execPath] : [process.execPath, process.argv[1] ?? ''];

  return [...parts.map((p) => `"${p}"`), '--hidden'].join(' ');
};

export const getAutoStart = (): boolean => {
  if (process.platform === 'win32' || process.platform === 'darwin') return app.getLoginItemSettings().openAtLogin;
  if (process.platform === 'linux') return existsSync(join(autostartDir(), DESKTOP_FILE));

  return false;
};

export const setAutoStart = (enabled: boolean) => {
  if (process.platform === 'win32') {
    app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] });
    return getAutoStart();
  }

  if (process.platform === 'darwin') {
    app.setLoginItemSettings({ openAtLogin: enabled });
    return getAutoStart();
  }

  if (process.platform === 'linux') {
    const file = join(autostartDir(), DESKTOP_FILE);

    if (!enabled) {
      if (existsSync(file)) unlinkSync(file);
      return false;
    }

    mkdirSync(autostartDir(), { recursive: true });
    writeFileSync(
      file,
      [
        '[Desktop Entry]',
        'Type=Application',
        'Name=Jollyboat',
        'Comment=Starts Jollyboat in the tray',
        `Exec=${linuxExec()}`,
        'Icon=io.github.innovativefluid.Jollyboat',
        'Terminal=false',
        'X-GNOME-Autostart-enabled=true',
        'X-KDE-autostart-after=panel',
        ''
      ].join('\n')
    );

    return true;
  }

  return false;
};

export const isAutoStartSupported = () => ['win32', 'linux', 'darwin'].includes(process.platform);
