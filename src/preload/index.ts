// Single preload for every page. On our own pages (launcher, picker) it exposes the IPC API;
// on a saved Sharkord server page it injects the glue Sharkord needs (bridge pairing token,
// screen-share audio and quality, voice state for the tray, notification handling). The main
// process decides which kind of page this is from the frame URL.

import { contextBridge, ipcRenderer, webFrame } from 'electron';
import type { TPickerResult, TServerInput, TSettings, TUpdateStatus, TVoiceState } from '../shared/types';

type TBootstrap = {
  isOwnPage: boolean;
  isSavedServer: boolean;
  platform: NodeJS.Platform;
  version: string;
  bridge: { ownedByUs: boolean; token: string } | null;
  screenAudio: { pipewire: boolean; virtualMic: string; dropRestrict: boolean } | null;
};

const boot = ipcRenderer.sendSync('shell:bootstrap') as TBootstrap;

if (boot.isOwnPage) {
  contextBridge.exposeInMainWorld('shell', {
    platform: boot.platform,
    version: boot.version,
    getSettings: () => ipcRenderer.invoke('settings:get') as Promise<TSettings>,
    saveSettings: (patch: Partial<TSettings>) => ipcRenderer.invoke('settings:save', patch),
    listServers: () => ipcRenderer.invoke('servers:list'),
    saveServer: (input: TServerInput) => ipcRenderer.invoke('servers:save', input),
    removeServer: (id: string) => ipcRenderer.invoke('servers:remove', id),
    testServer: (input: TServerInput) => ipcRenderer.invoke('servers:test', input),
    connect: (id: string) => ipcRenderer.invoke('servers:connect', id),
    bridgeStatus: () => ipcRenderer.invoke('bridge:status'),
    screenAudioInfo: () => ipcRenderer.invoke('screenAudio:info'),
    quit: () => ipcRenderer.invoke('app:quit'),
    shareCode: (ids: string[] | null, withPasswords: boolean) => ipcRenderer.invoke('share:code', ids, withPasswords),
    exportFile: (ids: string[] | null, withPasswords: boolean) => ipcRenderer.invoke('share:exportFile', ids, withPasswords),
    importText: (text: string) => ipcRenderer.invoke('share:importText', text),
    importFile: () => ipcRenderer.invoke('share:importFile'),
    getAutoStart: () => ipcRenderer.invoke('autostart:get'),
    setAutoStart: (enabled: boolean) => ipcRenderer.invoke('autostart:set', enabled),
    updateStatus: () => ipcRenderer.invoke('update:status'),
    installUpdate: () => ipcRenderer.invoke('update:install'),
    onUpdateStatus: (cb: (s: TUpdateStatus) => void) => {
      ipcRenderer.on('update:status', (_e, s) => cb(s));
    },
    // picker window
    onPickerSources: (cb: (sources: unknown[], lastName: string | null) => void) => {
      ipcRenderer.on('picker:sources', (_e, sources, lastName) => cb(sources, lastName));
    },
    pickerChoose: (result: TPickerResult) => ipcRenderer.send('picker:choose', result)
  });
} else {
  contextBridge.exposeInMainWorld('jollyboat', {
    platform: boot.platform,
    version: boot.version,
    // saved servers only (main checks the frame again): pipewire screen-share audio steps
    ...(boot.isSavedServer ? { screenAudio: (step: string) => ipcRenderer.invoke('server:screen-audio', step) } : {})
  });
}

if (boot.isSavedServer) {
  // --- hotkey bridge pairing: Sharkord reads these keys from localStorage ---------------------
  if (boot.bridge?.ownedByUs) {
    try {
      localStorage.setItem('sharkord-hotkey-bridge-token', boot.bridge.token);
      if (localStorage.getItem('sharkord-hotkeys-enabled') === null) {
        localStorage.setItem('sharkord-hotkeys-enabled', 'true');
      }
    } catch {
      /* storage blocked, hotkeys stay unpaired */
    }
  }

  // --- main-world patches: getDisplayMedia (screen-share audio) and Notification ----------------
  // screen quality (resolution, fps, bitrate, codec) stays Sharkord's own setting
  const screenAudio = JSON.stringify(boot.screenAudio);

  webFrame.executeJavaScript(`(() => {
    const md = navigator.mediaDevices;
    const cfg = ${screenAudio};
    const shell = window.jollyboat;

    // pipewire: the page gets a video-only capture plus the virtual mic that carries every app's
    // sound except ours; the link is undone when the share stops
    const attachPipeWire = async (stream) => {
      if (!(await shell.screenAudio('start'))) return;
      let device;
      for (let i = 0; i < 25 && !device; i++) {
        device = (await md.enumerateDevices()).find((d) => d.kind === 'audioinput' && d.label.toLowerCase().includes(cfg.virtualMic));
        if (!device) await new Promise((r) => setTimeout(r, 100));
      }
      if (!device) { shell.screenAudio('stop'); console.warn('[jollyboat] the pipewire share source did not appear'); return; }
      const audio = await md.getUserMedia({ audio: {
        deviceId: { exact: device.deviceId },
        echoCancellation: false, noiseSuppression: false, autoGainControl: false,
        channelCount: 2, sampleRate: 48000
      } });
      const track = audio.getAudioTracks()[0];
      if (!track) { shell.screenAudio('stop'); return; }
      stream.addTrack(track);
      shell.screenAudio('unmute');

      // sharkord stops shares with track.stop(), which fires no 'ended'; catch both ways
      let done = false;
      const end = () => { if (done) return; done = true; try { track.stop(); } catch {} shell.screenAudio('stop'); };
      for (const t of stream.getTracks()) {
        const stop = t.stop.bind(t);
        t.stop = () => { stop(); end(); };
        t.addEventListener('ended', end, { once: true });
      }
    };

    if (md && !md.__jollyboatPatched) {
      md.__jollyboatPatched = true;
      const original = md.getDisplayMedia.bind(md);

      md.getDisplayMedia = async (constraints) => {
        const c = { ...(constraints || {}) };
        const wantsAudio = !!c.audio;

        // windows before 22H2 cannot open the own-audio-excluding loopback
        if (cfg && cfg.dropRestrict && c.audio && typeof c.audio === 'object') {
          const { restrictOwnAudio, suppressLocalAudioPlayback, ...rest } = c.audio;
          c.audio = rest;
        }

        if (cfg && cfg.pipewire && wantsAudio) {
          const stream = await original({ ...c, audio: false });
          try { await attachPipeWire(stream); } catch (err) { shell.screenAudio('stop'); console.warn('[jollyboat] pipewire audio failed', err); }
          return stream;
        }

        try {
          return await original(c);
        } catch (err) {
          // a loopback device that cannot open must not cost the whole share
          if (wantsAudio && err && err.name !== 'NotAllowedError' && err.name !== 'AbortError') {
            console.warn('[jollyboat] share with audio failed, sharing without audio', err);
            return original({ ...c, audio: false });
          }
          throw err;
        }
      };
    }

    // notifications: tell the shell about each one (tray marker) and bring the window up on click
    const Orig = window.Notification;
    if (Orig && !Orig.__jollyboatPatched) {
      const Wrapped = function (title, options) {
        const n = new Orig(title, options);
        try { window.postMessage({ __jollyboat: 'notification', title: String(title) }, '*'); } catch {}
        n.addEventListener('click', () => {
          try { window.postMessage({ __jollyboat: 'notification-click' }, '*'); } catch {}
        });
        return n;
      };
      Wrapped.prototype = Orig.prototype;
      Wrapped.__jollyboatPatched = true;
      Object.defineProperty(Wrapped, 'permission', { get: () => Orig.permission });
      Object.defineProperty(Wrapped, 'maxActions', { get: () => Orig.maxActions });
      Wrapped.requestPermission = (...args) => Orig.requestPermission(...args);
      window.Notification = Wrapped;
    }
  })();`);

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || typeof e.data !== 'object') return;
    const kind = (e.data as { __jollyboat?: string }).__jollyboat;
    if (kind === 'notification') ipcRenderer.send('server:notification');
    if (kind === 'notification-click') ipcRenderer.send('server:notification-click');
  });

  // --- voice state for the tray: read from Sharkord's own controls ----------------------------
  // the mic and deafen buttons sit next to the user-settings trigger; lucide icons carry stable
  // class names, so this works in every language
  const controlBar = () => document.querySelector('[data-testid="user-settings-trigger"]')?.parentElement ?? null;
  let last = '';

  const readVoice = (): TVoiceState => {
    const bar = controlBar();

    return {
      connected: !!bar,
      inVoice: !!document.querySelector('svg.lucide-phone-off'),
      micMuted: !!bar?.querySelector('svg.lucide-mic-off'),
      deafened: !!bar?.querySelector('svg.lucide-headphone-off')
    };
  };

  let scheduled = false;
  const report = () => {
    scheduled = false;
    const state = readVoice();
    const key = JSON.stringify(state);
    if (key === last) return;
    last = key;
    ipcRenderer.send('server:voice', state);
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(report);
  };

  window.addEventListener('DOMContentLoaded', () => {
    new MutationObserver(schedule).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    schedule();
  });

  // tray menu actions: click Sharkord's own buttons
  ipcRenderer.on('shell:voice-action', (_e, action: 'mic' | 'sound') => {
    const bar = controlBar();
    if (!bar) return;
    const icon = action === 'mic' ? 'svg.lucide-mic, svg.lucide-mic-off' : 'svg.lucide-headphones, svg.lucide-headphone-off';
    bar.querySelector<SVGElement>(icon)?.closest('button')?.click();
  });
}
