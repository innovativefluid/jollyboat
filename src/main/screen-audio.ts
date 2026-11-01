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

import { app, type WebContents } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join } from 'node:path';
import { release } from 'node:os';
import { log } from './log';
import { t } from './lang';

type TScreenAudioMode = 'loopback-own-excluded' | 'loopback' | 'pipewire' | 'none';

type TPatchBay = {
  link(data: Record<string, unknown>): boolean;
  unlink(): void;
  unmute(): void;
  list(props?: string[]): Record<string, string>[];
};

/** an app playing sound, as the picker's sound menu offers it */
export type TSoundApp = { id: string; name: string };

// what the next share carries: 'all' (everything but our own call), 'none', or 'app:<id>' (one
// app, see listSoundApps); chosen in the picker for each share
let shareSound = 'all';
export const setShareSound = (sound: string) => {
  shareSound = sound;
};

let mode: TScreenAudioMode = 'none';
let patchBay: TPatchBay | null = null;
let linked = false;
let shareGrantedAt = 0;

/** the display-media handler just handed a page a capture; a pipewire link may follow */
export const markShareGranted = () => {
  shareGrantedAt = Date.now();
};

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
      const fake = (m: string) => (data?: unknown) => (log('screen-audio', `fake ${m}`, data ? JSON.stringify(data) : ''), true);
      patchBay = {
        link: fake('link'),
        unlink: fake('unlink'),
        unmute: fake('unmute'),
        list: () => [
          { 'application.name': 'Firefox', 'application.process.binary': 'firefox', 'node.name': 'Firefox' },
          { 'application.name': 'Firefox', 'application.process.binary': 'firefox', 'node.name': 'Firefox' },
          { 'application.name': 'Spotify', 'application.process.binary': 'spotify', 'node.name': 'spotify' },
          { 'application.name': app.getName(), 'application.process.binary': basename(process.execPath), 'node.name': 'Chromium' }
        ]
      } as unknown as TPatchBay;
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

  // macos: system audio through the screen-capture loopback, macos 13+.
  // whether chromium can leave our own call out of it there is untested
  if (process.platform === 'darwin') {
    mode = 'loopback';
    return mode;
  }

  mode = 'none';
  return mode;
};

export const getScreenAudioMode = () => mode;

/** what the display-media handler should ask chromium for when a page wants audio */
export const loopbackForRequest = (audioRequested: boolean): 'loopback' | undefined =>
  audioRequested && shareSound === 'all' && (mode === 'loopback' || mode === 'loopback-own-excluded') ? 'loopback' : undefined;

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

const LIST_PROPS = ['application.name', 'application.process.binary', 'application.process.id', 'node.name'];
const isOurs = (n: Record<string, string>) =>
  ownNodes().some((own) => Object.entries(own).every(([k, v]) => k !== 'media.class' && n[k] === v));
const keyOf = (n: Record<string, string>) =>
  n['application.process.binary'] ? `bin:${n['application.process.binary']}` : n['application.name'] ? `name:${n['application.name']}` : '';

// --- one app's sound as pcm (windows: the jollyboat-audio helper, process loopback) ------------
//
// windows 10 2004 (build 19041) and newer can record one process tree's sound. the helper
// (native/win-audio) lists the apps playing and records one of them as 48 khz stereo s16 on its
// stdout; the chunks go to the page that shares, which makes an audio track of them (preload)

const appAudioHelper = () => {
  if (process.platform !== 'win32') return null;
  const file = app.isPackaged
    ? join(process.resourcesPath, 'jollyboat-audio.exe')
    : join(app.getAppPath(), 'build', 'win-audio', process.arch, 'jollyboat-audio.exe');
  return existsSync(file) ? file : null;
};
// dev only: a tone instead of an app, to try the page side anywhere
const fakeAppAudio = () => !app.isPackaged && !!process.env.JOLLYBOAT_FAKE_APPAUDIO;
const pcmSupported = () => fakeAppAudio() || (!!appAudioHelper() && windowsBuild() >= 19041);

const runHelper = (args: string[], timeout = 3000) =>
  new Promise<string>((resolve) => {
    const file = appAudioHelper();
    if (!file) return resolve('');
    const child = spawn(file, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString('utf8')));
    const timer = setTimeout(() => child.kill(), timeout);
    child.on('error', () => resolve(''));
    child.on('close', () => {
      clearTimeout(timer);
      resolve(out);
    });
  });

const listPcmApps = async (): Promise<TSoundApp[]> => {
  if (fakeAppAudio()) return [{ id: 'pid:1', name: 'Test tone' }];
  const ours = new Set(app.getAppMetrics().map((m) => m.pid));
  const byExe = new Map<string, { pid: number; name: string; active: boolean }>();
  for (const line of (await runHelper(['sessions'])).split('\n')) {
    let s: { pid?: unknown; exe?: unknown; name?: unknown; active?: unknown };
    try {
      s = JSON.parse(line);
    } catch {
      continue;
    }
    const pid = Number(s.pid);
    const exe = String(s.exe ?? '');
    if (!pid || !exe || ours.has(pid) || pid === process.pid) continue;
    const name = String(s.name ?? '') || exe.replace(/\.exe$/i, '');
    const known = byExe.get(exe.toLowerCase());
    // (an app with several sessions: the one playing)
    if (!known || (!known.active && s.active === true)) byExe.set(exe.toLowerCase(), { pid, name, active: s.active === true });
  }
  return [...byExe.values()].map((a) => ({ id: `pid:${a.pid}`, name: a.name.slice(0, 80) }));
};

let pcm: { child: ChildProcess | null; timer: NodeJS.Timeout | null; wc: WebContents } | null = null;

const stopPcm = () => {
  if (!pcm) return;
  pcm.child?.stdin?.end();
  pcm.child?.kill();
  if (pcm.timer) clearInterval(pcm.timer);
  pcm = null;
  log('screen-audio', 'app sound stopped');
};

const startPcm = (wc: WebContents, id: string) => {
  stopPcm();
  const pid = Number(id.replace(/^pid:/, ''));
  if (!pid) return false;
  const send = (chunk: Buffer) => {
    if (wc.isDestroyed()) return stopPcm();
    wc.send('share:pcm', new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
  };
  if (fakeAppAudio()) {
    // a 440 hz tone, 10 ms at a time
    let phase = 0;
    const timer = setInterval(() => {
      const frames = 480;
      const buf = Buffer.alloc(frames * 4);
      for (let i = 0; i < frames; i++) {
        const v = Math.round(Math.sin(phase) * 8000);
        phase += (2 * Math.PI * 440) / 48000;
        buf.writeInt16LE(v, i * 4);
        buf.writeInt16LE(v, i * 4 + 2);
      }
      send(buf);
    }, 10);
    pcm = { child: null, timer, wc };
    log('screen-audio', 'app sound started (fake)');
    return true;
  }
  const file = appAudioHelper();
  if (!file) return false;
  const child = spawn(file, ['capture', String(pid)], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let rest = Buffer.alloc(0);
  child.stdout.on('data', (d: Buffer) => {
    // whole frames only (4 bytes each)
    const all = rest.length ? Buffer.concat([rest, d]) : d;
    const whole = all.length - (all.length % 4);
    rest = Buffer.from(all.subarray(whole));
    if (whole) send(all.subarray(0, whole));
  });
  child.stderr.on('data', (d: Buffer) => log('screen-audio', 'helper:', d.toString('utf8').trim().slice(0, 200)));
  child.on('error', (err) => log('screen-audio', 'helper failed:', err.message));
  child.on('exit', (code) => {
    if (pcm?.child === child) {
      log('screen-audio', 'helper ended', code);
      pcm = null;
    }
  });
  pcm = { child, timer: null, wc };
  log('screen-audio', 'app sound started');
  return true;
};

/** the page asks for the share's sound after its capture came back without any: pipewire's
 * virtual mic, one app's pcm, or nothing. only right after a share the user picked */
export const startShareSound = (wc: WebContents): 'pipewire' | 'pcm' | false => {
  if (Date.now() - shareGrantedAt > 15_000) {
    log('screen-audio', 'sound refused: no share was granted recently');
    return false;
  }
  if (mode === 'pipewire') return startPipeWireShare() ? 'pipewire' : false;
  if (shareSound.startsWith('app:') && pcmSupported()) return startPcm(wc, shareSound.slice(4)) ? 'pcm' : false;
  return false;
};

/** whether the picker can offer single apps' sound on this system */
export const soundAppsSupported = () => (mode === 'pipewire' && !!patchBay) || pcmSupported();

/** the apps playing sound right now (not us), one entry per app */
export const listSoundApps = async (): Promise<TSoundApp[]> => {
  if (mode !== 'pipewire' && pcmSupported()) return listPcmApps();
  if (mode !== 'pipewire' || !patchBay) return [];
  let nodes: Record<string, string>[] = [];
  try {
    nodes = patchBay.list(LIST_PROPS);
  } catch (err) {
    log('screen-audio', 'list failed:', (err as Error).message);
  }
  const apps = new Map<string, TSoundApp>();
  for (const n of nodes) {
    const key = keyOf(n);
    if (!key || isOurs(n) || apps.has(key)) continue;
    apps.set(key, { id: key, name: (n['application.name'] || n['application.process.binary'] || n['node.name'] || key).slice(0, 80) });
  }
  return [...apps.values()].sort((a, b) => a.name.localeCompare(b.name));
};

/** links every app's output except ours into the virtual mic (or the one app the picker chose) */
export const startPipeWireShare = () => {
  if (mode !== 'pipewire' || !patchBay) return false;
  // only right after a share the user picked; a page cannot route system audio on its own
  if (Date.now() - shareGrantedAt > 15_000) {
    log('screen-audio', 'link refused: no share was granted recently');
    return false;
  }

  if (linked) patchBay.unlink();
  if (shareSound === 'none') {
    log('screen-audio', 'share without sound (picked)');
    return false;
  }

  const one = shareSound.startsWith('app:') ? shareSound.slice(4) : '';
  const include = one.startsWith('bin:') ? [{ 'application.process.binary': one.slice(4) }] : one.startsWith('name:') ? [{ 'application.name': one.slice(5) }] : [];
  linked = patchBay.link({
    ...(include.length ? { include } : {}),
    exclude: ownNodes(),
    ignore_devices: true,
    only_speakers: true,
    only_default_speakers: true
  });

  // (which app is not logged: diagnostics carry no names)
  log('screen-audio', 'pipewire link', linked, include.length ? 'one app' : 'everything but us');

  return linked;
};

export const unmutePipeWireShare = () => {
  if (linked) patchBay?.unmute();
};

export const stopPipeWireShare = () => {
  stopPcm();
  if (!linked) return;

  patchBay?.unlink();
  linked = false;

  log('screen-audio', 'pipewire unlinked');
};

/** one line for the launcher */
export const describeScreenAudio = () =>
  ({
    'loopback-own-excluded': { ok: true, text: t('share audio ready') },
    loopback:
      process.platform === 'win32'
        ? { ok: false, text: t('share audio | others may hear themselves (windows older than 10 22h2)') }
        : process.platform === 'darwin'
          ? { ok: false, text: t('share audio | on mac, others may hear themselves') }
          : { ok: false, text: t('share audio | others may hear themselves (no pipewire)') },
    pipewire: { ok: true, text: t('share audio ready') },
    none: { ok: false, text: t('share audio unavailable') }
  })[mode];
