// One block of text for bug reports: versions, platform, what the shell decided, recent log.
// No server addresses, names or passwords.

import { app } from 'electron';
import { release, type } from 'node:os';
import { getBridgeStatus } from './hotkeys/bridge';
import { recentLog } from './log';
import { getScreenAudioMode } from './screen-audio';
import { getSettings } from './settings';
import { getUpdateStatus } from './updater';
import { describeTray } from './tray';

// what chromium decided about the gpu: compositing and video decode/encode (screen shares)
const gpuLine = () => {
  const f = app.getGPUFeatureStatus() as unknown as Record<string, string>;
  return ['gpu_compositing', 'video_decode', 'video_encode'].map((k) => `${k.replace('gpu_', '')} ${f[k] ?? '?'}`).join(' | ');
};

export const diagnostics = () => {
  const s = getSettings();
  const bridge = getBridgeStatus();
  const session =
    process.platform === 'linux'
      ? process.env.XDG_SESSION_TYPE || (process.env.WAYLAND_DISPLAY ? 'wayland' : 'x11')
      : '';

  return [
    `Jollyboat ${__APP_VERSION__} (${app.isPackaged ? 'packaged' : 'dev'}${process.platform === 'darwin' ? ', experimental mac build' : ''})`,
    `electron ${process.versions.electron} | chromium ${process.versions.chrome} | node ${process.versions.node}`,
    `${process.platform} ${process.arch} | ${type()} ${release()}${session ? ` | ${session}` : ''}${process.env.FLATPAK_ID ? ` | flatpak${process.env.JOLLYBOAT_CHANNEL ? ` (${process.env.JOLLYBOAT_CHANNEL})` : ''}` : ''}${process.env.XDG_CURRENT_DESKTOP ? ` | ${process.env.XDG_CURRENT_DESKTOP}` : ''}`,
    `screen audio: ${getScreenAudioMode()}`,
    `gpu: ${gpuLine()}`,
    `hotkey bridge: ${bridge.ownedByUs ? `ours on ${bridge.port}, ${bridge.bindings.length} bindings` : `port ${bridge.port} taken`}`,
    describeTray(),
    `updates: ${getUpdateStatus().state}${getUpdateStatus().version ? ` ${getUpdateStatus().version}` : ''}`,
    `settings: ${s.servers.length} servers | auto-connect ${s.autoConnectServerId ? 'on' : 'off'} | on close ${s.onClose} | notify ${s.notifyTray} | spellcheck ${s.spellcheck} | update checks ${s.checkUpdates}`,
    '',
    '--- log',
    ...recentLog()
  ].join('\n');
};
