// Start with the system. Windows and mac: the login item API. Flatpak: the Background portal
// writes the autostart entry for us (the sandbox cannot reach ~/.config/autostart). Linux
// outside Flatpak (dev runs): an XDG autostart desktop entry.
// The app is started with --hidden so it only shows up in the tray.

import { app } from 'electron';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { log } from './log';
import { requestAutostart } from './portal';
import { getSettings, saveSettings } from './settings';

const DESKTOP_FILE = 'jollyboat.desktop';

const portableExe = () => process.env.PORTABLE_EXECUTABLE_FILE || undefined;

const autostartDir = () => join(process.env.XDG_CONFIG_HOME || join(app.getPath('home'), '.config'), 'autostart');

const linuxExec = () => {
  // packaged: the binary; dev: electron + the main script
  const parts = app.isPackaged ? [process.execPath] : [process.execPath, process.argv[1] ?? ''];

  return [...parts.map((p) => `"${p}"`), '--hidden'].join(' ');
};

export const getAutoStart = (): boolean => {
  if (process.platform === 'win32') return app.getLoginItemSettings(portableExe() ? { path: portableExe() } : undefined).openAtLogin;
  if (process.platform === 'darwin') return app.getLoginItemSettings().openAtLogin;
  if (process.platform === 'linux') return process.env.FLATPAK_ID ? getSettings().autostart : existsSync(join(autostartDir(), DESKTOP_FILE));

  return false;
};

export const setAutoStart = async (enabled: boolean) => {
  if (process.platform === 'win32') {
    // portable: the exe the user keeps, not the temporary copy that runs
    app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'], ...(portableExe() ? { path: portableExe() } : {}) });
    return getAutoStart();
  }

  if (process.platform === 'darwin') {
    app.setLoginItemSettings({ openAtLogin: enabled });
    return getAutoStart();
  }

  if (process.platform === 'linux' && process.env.FLATPAK_ID) {
    try {
      // the command runs inside the sandbox: our launcher script in /app/bin
      const granted = await requestAutostart(enabled, ['jollyboat', '--hidden']);
      saveSettings({ autostart: enabled && granted });
    } catch (err) {
      log('autostart', 'portal:', (err as Error).message);
    }
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
        'Icon=net.innovativefluid.Jollyboat',
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
