// One block of text for bug reports: versions, platform, what the shell decided, recent log.
// No server addresses, names or passwords.

import { app } from 'electron';
import { release, type } from 'node:os';
import { getBridgeStatus } from './hotkeys/bridge';
import { recentLog } from './log';
import { getScreenAudioMode } from './screen-audio';
import { getSettings } from './settings';
import { getUpdateStatus } from './updater';

export const diagnostics = () => {
  const s = getSettings();
  const bridge = getBridgeStatus();
  const session =
    process.platform === 'linux'
      ? process.env.XDG_SESSION_TYPE || (process.env.WAYLAND_DISPLAY ? 'wayland' : 'x11')
      : '';

  return [
    `Jollyboat ${__APP_VERSION__} (${app.isPackaged ? 'packaged' : 'dev'})`,
    `electron ${process.versions.electron} | chromium ${process.versions.chrome} | node ${process.versions.node}`,
    `${process.platform} ${process.arch} | ${type()} ${release()}${session ? ` | ${session}` : ''}${process.env.FLATPAK_ID ? ' | flatpak' : ''}${process.env.XDG_CURRENT_DESKTOP ? ` | ${process.env.XDG_CURRENT_DESKTOP}` : ''}`,
    `screen audio: ${getScreenAudioMode()}`,
    `hotkey bridge: ${bridge.ownedByUs ? `ours on ${bridge.port}, ${bridge.bindings.length} bindings` : `port ${bridge.port} taken`}`,
    `updates: ${getUpdateStatus().state}${getUpdateStatus().version ? ` ${getUpdateStatus().version}` : ''}`,
    `settings: ${s.servers.length} servers | auto-connect ${s.autoConnectServerId ? 'on' : 'off'} | tray ${s.minimizeToTray} | notify ${s.notifyTray} | spellcheck ${s.spellcheck} | update checks ${s.checkUpdates}`,
    '',
    '--- log',
    ...recentLog()
  ].join('\n');
};
