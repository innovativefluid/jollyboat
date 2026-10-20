// Screen-share audio without a setup choice.
//
//  Windows  Chromium loopback. Electron ≥ 43.4 honours `restrictOwnAudio` (Sharkord asks for it by
//           default) and captures through `loopbackWithoutChrome`, so participants never hear
//           themselves. That device needs Windows 10 22H2 (build 19045) or newer; on older builds
//           the preload drops the constraint and plain loopback is used.
//  Linux    PipeWire through venmic: a virtual mic that carries every app's sound except this
//           app's own (matched by audio-service pid, app name and binary). Chromium cannot leave its
//           own audio out on Linux, so this is the only echo-free path.
//           Without PipeWire (or if venmic cannot load): Chromium's PulseAudio loopback of the
//           default output, which includes Sharkord's own sound.

import { app } from 'electron';
import { createRequire } from 'node:module';
import { basename } from 'node:path';
import { release } from 'node:os';
import { log } from './log';

export type TScreenAudioMode = 'loopback-own-excluded' | 'loopback' | 'pipewire' | 'none';

type TPatchBay = {
  link(data: Record<string, unknown>): boolean;
  unlink(): void;
  unmute(): void;
};

let mode: TScreenAudioMode = 'none';
let patchBay: TPatchBay | null = null;
let linked = false;

export const VIRTUAL_MIC_LABEL = 'vencord-screen-share';

const windowsBuild = () => Number(release().split('.')[2] ?? 0);

/** windows builds before 22H2 cannot open loopbackWithoutChrome */
export const canExcludeOwnAudioOnWindows = () => process.platform === 'win32' && windowsBuild() >= 19045;

export const initScreenAudio = () => {
  if (process.platform === 'win32') {
    mode = canExcludeOwnAudioOnWindows() ? 'loopback-own-excluded' : 'loopback';
    return mode;
  }

  if (process.platform === 'linux') {
    // dev only: pretend pipewire is there so the page side can be tested headless
    if (!app.isPackaged && process.env.JOLLYBOAT_FAKE_PIPEWIRE) {
      const fake = (m: string) => () => (log('screen-audio', `fake ${m}`), true);
      patchBay = { link: fake('link'), unlink: fake('unlink'), unmute: fake('unmute') } as unknown as TPatchBay;
      mode = 'pipewire';
      return mode;
    }

    try {
      // loaded at runtime: an optional, linux-only native module (MPL-2.0)
      const venmic = createRequire(import.meta.url)('@vencord/venmic') as {
        PatchBay: { new (): TPatchBay; hasPipeWire(): boolean };
      };

      if (venmic.PatchBay.hasPipeWire()) {
        patchBay = new venmic.PatchBay();
        mode = 'pipewire';
        return mode;
      }
    } catch (err) {
      log('screen-audio', 'venmic unavailable:', (err as Error).message);
    }

    mode = 'loopback';
    return mode;
  }

  mode = 'none';
  return mode;
};

export const getScreenAudioMode = () => mode;

/** what the display-media handler should ask chromium for when a page wants audio */
export const loopbackForRequest = (audioRequested: boolean): 'loopback' | undefined =>
  audioRequested && (mode === 'loopback' || mode === 'loopback-own-excluded') ? 'loopback' : undefined;

// --- pipewire / venmic ------------------------------------------------------------------------

const ownNodes = () => {
  const audioService = app.getAppMetrics().find((p) => p.name === 'Audio Service');
  const nodes: Record<string, string>[] = [
    { 'application.name': app.getName() },
    { 'application.process.binary': basename(process.execPath) },
    { 'media.class': 'Stream/Input/Audio' }
  ];

  if (audioService) nodes.unshift({ 'application.process.id': String(audioService.pid) });

  return nodes;
};

/** links every app's output except ours into the virtual mic */
export const startPipeWireShare = () => {
  if (mode !== 'pipewire' || !patchBay) return false;

  if (linked) patchBay.unlink();

  linked = patchBay.link({
    exclude: ownNodes(),
    ignore_devices: true,
    only_speakers: true,
    only_default_speakers: true
  });

  log('screen-audio', 'pipewire link', linked, ownNodes());

  return linked;
};

export const unmutePipeWireShare = () => {
  if (linked) patchBay?.unmute();
};

export const stopPipeWireShare = () => {
  if (!linked) return;

  patchBay?.unlink();
  linked = false;

  log('screen-audio', 'pipewire unlinked');
};

/** one line for the launcher */
export const describeScreenAudio = () =>
  ({
    'loopback-own-excluded': { ok: true, text: 'share audio ready' },
    loopback:
      process.platform === 'win32'
        ? { ok: false, text: 'share audio | others may hear themselves (windows older than 10 22h2)' }
        : { ok: false, text: 'share audio | others may hear themselves (no pipewire)' },
    pipewire: { ok: true, text: 'share audio ready' },
    none: { ok: false, text: 'share audio unavailable' }
  })[mode];
