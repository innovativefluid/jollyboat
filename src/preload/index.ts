// Single preload for every page. On our own pages (launcher, picker) it exposes the IPC API;
// on a saved Sharkord server page it injects the glue Sharkord needs (bridge pairing token,
// screen-share audio and quality, voice state for the tray, notification handling). The main
// process decides which kind of page this is from the frame URL.

import { contextBridge, ipcRenderer, webFrame } from 'electron';
import { ALL_PALETTES, LOOKS, type TLook, type TPalette } from '../shared/types';
import type { TBarState, TOverlayState, TPickerResult, TServerInput, TSettings, TUpdateStatus, TVoiceMember, TVoiceReport } from '../shared/types';
import { startPageWater } from './water';
import { startSaveButtons } from './save-buttons';
import { exposeDesktopBridge } from './desktop-bridge';
import { createT } from '../shared/i18n';

type TBootstrap = {
  ownPage: 'launcher' | 'picker' | 'prompt' | 'bar' | 'overlay' | null;
  isSavedServer: boolean;
  /** sharkord's desktop mode on this saved server (window.sharkordDesktop) */
  desktop: boolean;
  platform: NodeJS.Platform;
  version: string;
  /** flathub build: no update checks of our own */
  storeUpdates: boolean;
  wayland: boolean;
  lang: 'en' | 'de' | 'pl';
  bridge: { ownedByUs: boolean; token: string } | null;
  login: { token: string | null } | null;
  colorMode: 'auto' | 'dark' | 'light';
  /** the app's own windows: the lcd look or the water look */
  look: TLook;
  /** the retro look's colours */
  palette: TPalette;
  /** a saved server page with the water theme: the water runs behind it */
  water: boolean;
  /** tests: the water even on a software renderer */
  softGl: boolean;
  screenAudio: { pipewire: boolean; virtualMic: string; dropRestrict: boolean } | null;
};

const boot = ipcRenderer.sendSync('shell:bootstrap') as TBootstrap;

// the window's focus. the server window holds two views (the bar, the page) and only one of them
// has the keyboard, so document.hasFocus() says "blurred" in the other one; main tells both
let windowFocused: boolean | null = null;
ipcRenderer.on('shell:focus', (_e, focused: unknown) => {
  windowFocused = focused === true;
});
const hasFocus = () => windowFocused ?? document.hasFocus();

if (boot.ownPage) {
  // the look goes on <html> as data-look before anything is painted (the preload runs before
  // the document has an element: the parser's first insert is caught), then follows the setting
  // (the retro look's colours go along as data-palette)
  const markLook = (look: string, palette: TPalette) => {
    const root = document.documentElement;
    if (root) {
      root.dataset.look = look;
      root.dataset.palette = palette;
    }
    return !!root;
  };
  if (!markLook(boot.look, boot.palette)) {
    const watcher = new MutationObserver(() => markLook(boot.look, boot.palette) && watcher.disconnect());
    watcher.observe(document, { childList: true });
  }
  const lookListeners: ((look: TLook) => void)[] = [];
  ipcRenderer.on('shell:look', (_e, look: TLook, palette: TPalette) => {
    if (!LOOKS.includes(look)) return;
    markLook(look, ALL_PALETTES.includes(palette) ? palette : 'blue');
    for (const cb of lookListeners) cb(look);
  });

  // each of our pages gets only what it uses: the setup window the settings / servers api, the
  // picker, prompt and bar their one or two calls
  const common = {
    platform: boot.platform,
    version: boot.version,
    storeUpdates: boot.storeUpdates,
    wayland: boot.wayland,
    lang: boot.lang,
    look: boot.look,
    onLook: (cb: (look: TLook) => void) => {
      lookListeners.push(cb);
    }
  };
  const byPage = {
    launcher: {
      getSettings: () => ipcRenderer.invoke('settings:get') as Promise<TSettings>,
      saveSettings: (patch: Partial<TSettings>) => ipcRenderer.invoke('settings:save', patch),
      listServers: () => ipcRenderer.invoke('servers:list'),
      saveServer: (input: TServerInput) => ipcRenderer.invoke('servers:save', input),
      removeServer: (id: string) => ipcRenderer.invoke('servers:remove', id),
      connect: (id: string) => ipcRenderer.invoke('servers:connect', id),
      bridgeStatus: () => ipcRenderer.invoke('bridge:status'),
      screenAudioInfo: () => ipcRenderer.invoke('screenAudio:info'),
      openWebsite: () => ipcRenderer.invoke('app:website'),
      linksOwned: () => ipcRenderer.invoke('links:get') as Promise<boolean | null>,
      setLinksOwned: (on: boolean) => ipcRenderer.invoke('links:set', on) as Promise<boolean | null>,
      editCustomCss: () => ipcRenderer.invoke('css:edit') as Promise<string>,
      positionOverlay: () => ipcRenderer.invoke('overlay:position'),
      shareCode: (ids: string[] | null, withPasswords: boolean, invite?: string) => ipcRenderer.invoke('share:code', ids, withPasswords, invite ?? ''),
      importText: (text: string) => ipcRenderer.invoke('share:importText', text),
      getAutoStart: () => ipcRenderer.invoke('autostart:get'),
      setAutoStart: (enabled: boolean) => ipcRenderer.invoke('autostart:set', enabled),
      updateStatus: () => ipcRenderer.invoke('update:status'),
      installUpdate: () => ipcRenderer.invoke('update:install'),
      openReleasePage: () => ipcRenderer.invoke('update:open'),
      diagnostics: () => ipcRenderer.invoke('diag:text'),
      onUpdateStatus: (cb: (s: TUpdateStatus) => void) => {
        ipcRenderer.on('update:status', (_e, s) => cb(s));
      }
    },
    picker: {
      onPickerSources: (cb: (sources: unknown[], lastName: string | null, sound: unknown) => void) => {
        ipcRenderer.on('picker:sources', (_e, sources, lastName, sound) => cb(sources, lastName, sound));
      },
      pickerChoose: (result: TPickerResult) => ipcRenderer.send('picker:choose', result)
    },
    bar: {
      barAction: (action: string, at?: { x: number; y: number }, arg?: string | string[]) => ipcRenderer.send('bar:action', action, at, arg),
      barSize: (need: number) => ipcRenderer.send('bar:size', need),
      windowFocused: hasFocus,
      onBarState: (cb: (state: TBarState) => void) => {
        ipcRenderer.on('bar:state', (_e, state) => cb(state));
      }
    },
    prompt: {
      promptAnswer: (answer: boolean) => ipcRenderer.send('prompt:answer', answer)
    },
    overlay: {
      onOverlayState: (cb: (state: TOverlayState) => void) => {
        ipcRenderer.on('overlay:state', (_e, state) => cb(state));
      },
      overlayHeight: (h: number) => ipcRenderer.send('overlay:height', h),
      overlayDone: () => ipcRenderer.send('overlay:done')
    }
  };
  contextBridge.exposeInMainWorld('shell', { ...common, ...(boot.ownPage ? byPage[boot.ownPage] : {}) });
} else {
  contextBridge.exposeInMainWorld('jollyboat', {
    platform: boot.platform,
    version: boot.version,
    // saved servers only (main checks the frame again): pipewire screen-share audio steps
    ...(boot.isSavedServer ? { screenAudio: (step: string) => ipcRenderer.invoke('server:screen-audio', step) } : {})
  });
}

if (boot.isSavedServer) {
  // --- sharkord's desktop mode: before any of the page's scripts look for it --------------------
  if (boot.desktop) exposeDesktopBridge(ipcRenderer);

  // whether this server's tab is the one shown (a page in the background still runs, in a call
  // at full speed: its water rests)
  let shown = true;

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

  // --- stay logged in: sharkord keeps a 7-day token in localStorage but drops it on any disconnect.
  // we hold a copy, hand it back when the page starts without one, and pick up new logins.
  if (boot.login) {
    const FLAG = 'sharkord-auto-login';
    const SAVED = 'sharkord-auto-login-token';
    const SESSION = 'sharkord-token';
    let held = boot.login.token;
    let lastFlag: string | null = null;

    try {
      if (held && !localStorage.getItem(SAVED)) {
        localStorage.setItem(FLAG, 'true');
        localStorage.setItem(SAVED, held);
      }
      lastFlag = localStorage.getItem(FLAG);
    } catch {
      /* storage blocked */
    }

    setInterval(() => {
      try {
        const session = sessionStorage.getItem(SESSION);
        const flag = localStorage.getItem(FLAG);

        if (session && session !== held) {
          held = session;
          ipcRenderer.send('server:login', session);
        } else if (held && !session && lastFlag === 'true' && flag === 'false') {
          // sharkord flips the switch off itself when the server rejects the token (expired)
          held = null;
          ipcRenderer.send('server:login', null);
        }
        lastFlag = flag;
      } catch {
        /* storage blocked */
      }
    }, 2000);
  }

  // --- main-world patches: getDisplayMedia (screen-share audio) and Notification ----------------
  // screen quality (resolution, fps, bitrate, codec) stays Sharkord's own setting
  const screenAudio = JSON.stringify(boot.screenAudio);
  // messages from the injected script carry a nonce that lives in its closure; page scripts
  // cannot read it, so they cannot forge notifications, focus requests or log lines
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

  webFrame.executeJavaScript(`(() => {
    const md = navigator.mediaDevices;
    const cfg = ${screenAudio};
    const shell = window.jollyboat;
    const nonce = ${JSON.stringify(nonce)};
    const tell = (kind, extra) => { try { window.postMessage({ __jollyboat: kind, nonce, ...(extra || {}) }, '*'); } catch {} };
    const warn = (text, err) => {
      console.warn('[jollyboat] ' + text, err || '');
      tell('log', { text: text + (err ? ' | ' + (err.name || '') + ' ' + (err.message || '') : '') });
    };

    // pipewire: the page gets a video-only capture plus the virtual mic that carries every app's
    // sound except ours; the link is undone when the share stops
    // the share's own sound: after a capture without any, main says where it comes from
    const attachSound = async (stream) => {
      const how = await shell.screenAudio('start');
      if (how === 'pcm') return attachPcm(stream);
      if (how) return attachPipeWire(stream);
    };

    // sharkord stops shares with track.stop(), which fires no 'ended'; catch both ways
    const onStop = (stream, end) => {
      for (const t of stream.getTracks()) {
        const stop = t.stop.bind(t);
        t.stop = () => { stop(); end(); };
        t.addEventListener('ended', end, { once: true });
      }
    };

    // one app's sound (windows): main sends its pcm (48 khz stereo s16) and a track is made of it
    const attachPcm = (stream) => {
      if (typeof MediaStreamTrackGenerator !== 'function' || typeof AudioData !== 'function') {
        shell.screenAudio('stop');
        warn('no MediaStreamTrackGenerator: the app sound cannot be shared');
        return;
      }
      const track = new MediaStreamTrackGenerator({ kind: 'audio' });
      const writer = track.writable.getWriter();
      let at = 0;
      const onPcm = (e) => {
        if (e.source !== window || !e.data || e.data.__jollyboatPcm !== nonce) return;
        const buf = e.data.buf;
        const frames = (buf && buf.byteLength / 4) | 0;
        if (!frames) return;
        // nothing reads the track yet (or it lags): dropped, not piled up
        if (writer.desiredSize !== null && writer.desiredSize <= 0) { at += Math.round(frames * 1e6 / 48000); return; }
        try {
          writer.write(new AudioData({ format: 's16', sampleRate: 48000, numberOfFrames: frames, numberOfChannels: 2, timestamp: at, data: buf })).catch(() => {});
        } catch (err) {
          warn('app sound frame', err);
        }
        at += Math.round(frames * 1e6 / 48000);
      };
      window.addEventListener('message', onPcm);
      stream.addTrack(track);
      let done = false;
      onStop(stream, () => {
        if (done) return;
        done = true;
        window.removeEventListener('message', onPcm);
        try { writer.close().catch(() => {}); } catch {}
        try { track.stop(); } catch {}
        shell.screenAudio('stop');
      });
    };

    const attachPipeWire = async (stream) => {
      let device;
      for (let i = 0; i < 25 && !device; i++) {
        device = (await md.enumerateDevices()).find((d) => d.kind === 'audioinput' && d.label.toLowerCase().includes(cfg.virtualMic));
        if (!device) await new Promise((r) => setTimeout(r, 100));
      }
      if (!device) { shell.screenAudio('stop'); warn('the pipewire share source did not appear'); return; }
      const audio = await md.getUserMedia({ audio: {
        deviceId: { exact: device.deviceId },
        echoCancellation: false, noiseSuppression: false, autoGainControl: false,
        channelCount: 2, sampleRate: 48000
      } });
      const track = audio.getAudioTracks()[0];
      if (!track) { shell.screenAudio('stop'); return; }
      stream.addTrack(track);
      shell.screenAudio('unmute');

      let done = false;
      onStop(stream, () => { if (done) return; done = true; try { track.stop(); } catch {} shell.screenAudio('stop'); });
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

        // pipewire: the request still says it wants sound (the picker then offers its sound
        // menu); the capture comes back video-only and the sound is attached from the virtual mic
        if (cfg && cfg.pipewire && wantsAudio) {
          const stream = await original(c);
          if (!stream.getAudioTracks().length) {
            try { await attachSound(stream); } catch (err) { shell.screenAudio('stop'); warn('share sound failed', err); }
          }
          return stream;
        }

        try {
          const stream = await original(c);
          // a sound picked in the picker that chromium does not capture itself (one app's)
          if (wantsAudio && !stream.getAudioTracks().length) {
            try { await attachSound(stream); } catch (err) { shell.screenAudio('stop'); warn('share sound failed', err); }
          }
          return stream;
        } catch (err) {
          // a loopback device that cannot open must not cost the whole share: first without the
          // own-audio exclusion (some systems cannot do it), then without audio at all
          if (!wantsAudio || !err || err.name === 'NotAllowedError' || err.name === 'AbortError') throw err;
          if (c.audio && typeof c.audio === 'object' && 'restrictOwnAudio' in c.audio) {
            const { restrictOwnAudio, suppressLocalAudioPlayback, ...rest } = c.audio;
            try {
              warn('share audio without own-audio exclusion', err);
              return await original({ ...c, audio: Object.keys(rest).length ? rest : true });
            } catch (again) {
              err = again;
            }
          }
          warn('share with audio failed, sharing without audio', err);
          return original({ ...c, audio: false });
        }
      };
    }

    // notifications: tell the shell about each one (tray marker) and bring the window up on click
    const Orig = window.Notification;
    if (Orig && !Orig.__jollyboatPatched) {
      const Wrapped = function (title, options) {
        const n = new Orig(title, options);
        tell('notification');
        n.addEventListener('click', () => {
          tell('notification-click');
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

  // one app's sound for a share (windows): the chunks go on to the page's track (attachPcm)
  ipcRenderer.on('share:pcm', (_e, chunk: Uint8Array) => {
    if (!(chunk instanceof Uint8Array) || !chunk.byteLength) return;
    const buf = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength);
    window.postMessage({ __jollyboatPcm: nonce, buf }, '*', [buf]);
  });

  let lastClick = 0;
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || typeof e.data !== 'object') return;
    const data = e.data as { __jollyboat?: string; nonce?: string; text?: unknown };
    if (data.nonce !== nonce) return;
    if (data.__jollyboat === 'notification') ipcRenderer.send('server:notification');
    if (data.__jollyboat === 'log') ipcRenderer.send('server:log', String(data.text ?? '').slice(0, 500));
    if (data.__jollyboat === 'notification-click' && Date.now() - lastClick > 2000) {
      lastClick = Date.now();
      ipcRenderer.send('server:notification-click');
    }
  });

  // --- voice state for the tray: read from Sharkord's own controls ----------------------------
  // the mic and deafen buttons sit next to the user-settings trigger; lucide icons carry stable
  // class names, so this works in every language
  const controlBar = () => document.querySelector('[data-testid="user-settings-trigger"]')?.parentElement ?? null;
  let last = '';

  // own name, from the user control next to the buttons (the avatar's initials are a span too,
  // the name is the one in medium weight)
  const ownName = (bar: Element) => {
    const spans = Array.from(bar.parentElement?.querySelectorAll('span') ?? []);
    const name = spans.find((s) => s.className.includes('font-medium')) ?? spans[0];
    return name?.textContent?.trim() ?? '';
  };
  // sharkord puts speaking-effect-* on the avatar of whoever is talking; ours is the one whose
  // row (a few levels up at most) carries our name
  const ownSpeaking = (bar: Element) => {
    const name = ownName(bar);
    if (!name) return false;
    for (const el of Array.from(document.querySelectorAll('[class*="speaking-effect-"]'))) {
      let row: Element | null = el;
      for (let up = 0; up < 4 && row; up++) {
        if (Array.from(row.querySelectorAll('span')).some((s) => s.textContent?.trim() === name)) return true;
        row = row.parentElement;
      }
    }
    return false;
  };

  // a voice channel's people sit in the element right after its channel item, one row each:
  // avatar (with the speaking ring), name, then mic / headphone / screen / camera icons
  const readRow = (row: Element, own: string): TVoiceMember | null => {
    const nameEl = Array.from(row.querySelectorAll('span')).find((s) => s.className.includes('truncate'));
    const name = nameEl?.textContent?.trim();
    if (!name) return null;
    return {
      name,
      self: name === own,
      speaking: !!row.querySelector('[class*="speaking-effect-"]'),
      micMuted: !!row.querySelector('svg.lucide-mic-off'),
      deafened: !!row.querySelector('svg.lucide-headphone-off'),
      sharing: !!row.querySelector('svg.lucide-monitor'),
      video: !!row.querySelector('svg.lucide-video')
    };
  };
  const ownChannel = (bar: Element) => {
    const own = ownName(bar);
    if (!own) return null;
    for (const item of Array.from(document.querySelectorAll('[data-testid="channel-item"]'))) {
      const list = item.nextElementSibling;
      if (!list || item.parentElement !== list.parentElement) continue;
      const members = Array.from(list.children).flatMap((row) => readRow(row, own) ?? []);
      // the channel's name is its truncating span (the live waveform brings a <style> along)
      const name = Array.from(item.querySelectorAll('span')).find((s) => s.className.includes('truncate'))?.textContent?.trim() ?? '';
      if (members.some((m) => m.self)) return { channel: name, members };
    }
    return null;
  };

  // stream videos that are playing (a share or camera someone sends; the own preview counts too)
  const playingStreams = () =>
    Array.from(document.querySelectorAll('video')).filter((v) => v.srcObject && v.readyState >= 2 && v.videoWidth > 0).length;

  const readVoice = (): TVoiceReport => {
    const bar = controlBar();
    const inVoice = !!document.querySelector('svg.lucide-phone-off');
    const micMuted = !!bar?.querySelector('svg.lucide-mic-off');
    const room = inVoice && bar ? ownChannel(bar) : null;

    return {
      connected: !!bar,
      inVoice,
      micMuted,
      deafened: !!bar?.querySelector('svg.lucide-headphone-off'),
      speaking: inVoice && !micMuted && !!bar && ownSpeaking(bar),
      channel: room?.channel ?? '',
      members: room?.members ?? [],
      streams: inVoice ? playingStreams() : 0
    };
  };

  // a view sharkord renders anew brings its fixed "dark" back: put right once per frame at most
  let schemeQueued = false;
  const scheduleScheme = () => {
    if (schemeQueued) return;
    schemeQueued = true;
    requestAnimationFrame(() => {
      schemeQueued = false;
      enforceScheme();
    });
  };

  // --- one bar: sharkord's top bar in the middle of ours ------------------------------------
  // the server view's top bar (not the settings screen, which covers the page with its own)
  const TOPBAR = '.h-dvh > .bg-card.border-b';
  let lastTopbar: boolean | null = null;
  // a dialog's dark backdrop over the page: the bar's ends darken with it (merged, they would
  // stay bright beside its darkened middle)
  let lastModal = false;
  // covered by something of its own (a plugin's full-window view, like Jollyplay's games, or the
  // picture viewer): our bar's ends would show that through, so the bar goes back to its own row.
  // a dialog's backdrop does not count (the bar dims with it instead)
  // a sheet (sharkord's mod view, a side panel) or a dialog reaching up under the bar's ends: its
  // close button would sit under our window buttons, so the bar goes back to its own row as well.
  // menus and popovers do not count: they hang from what opened them and would move with the page
  const covered = (bar: Element) => {
    const r = bar.getBoundingClientRect();
    if (r.height < 4) return false;
    const css = getComputedStyle(document.documentElement);
    const endL = parseFloat(css.getPropertyValue('--jb-bar-l')) || 0;
    const endR = parseFloat(css.getPropertyValue('--jb-bar-r')) || 0;
    const width = document.documentElement.clientWidth;
    for (const c of Array.from(document.querySelectorAll('[data-state="open"]:is([data-slot="sheet-content"], [data-slot="dialog-content"], [data-slot="alert-dialog-content"])'))) {
      if (c.matches('[data-slot="sheet-content"]:not(.bottom-0)')) return true;
      const b = c.getBoundingClientRect();
      if (b.height > 0 && b.top < r.bottom + 8 && (b.left < endL + 8 || b.right > width - endR - 8)) return true;
    }
    // an open menu or dialog makes the page ignore the pointer (pointer-events: none on the body),
    // and a hit test with it would only find <html>: for the look, the body takes the pointer
    const body = document.body;
    const pe = body.style.pointerEvents;
    if (pe) body.style.pointerEvents = 'auto';
    try {
      return [r.left + 4, r.left + r.width / 2, r.right - 4].some((x) => {
        const el = document.elementFromPoint(x, r.top + r.height / 2);
        return !!el && el !== document.documentElement && el !== body && !bar.contains(el) && !el.closest('[data-slot$="-overlay"], [data-radix-popper-content-wrapper], [data-sonner-toaster]');
      });
    } finally {
      if (pe) body.style.pointerEvents = pe;
    }
  };
  const reportTopbar = () => {
    const bar = document.querySelector(TOPBAR);
    const on = !!bar && !document.querySelector('div:not(.relative) > .h-dvh.bg-background') && !covered(bar);
    const modal = !!document.querySelector('[data-slot$="-overlay"][data-state="open"]');
    if (modal !== lastModal) {
      lastModal = modal;
      ipcRenderer.send('server:modal', modal);
    }
    if (on === lastTopbar) return;
    lastTopbar = on;
    ipcRenderer.send('server:topbar', on);
  };
  // main says how much room our bar's two ends take, or null: the page is below the bar again.
  // the top bar takes the bar's height and draws its background (the look's, see the themes);
  // its own server-list and settings buttons go (the bar has them), the rest stays sharkord's
  const BAR_CSS = `
html[data-jb-bar] ${TOPBAR} {
  display: grid !important; grid-template-columns: auto minmax(0, 1fr) auto !important; column-gap: 8px !important;
  height: var(--jb-bar-h) !important; min-height: 0 !important; box-sizing: border-box !important;
  margin: 0 !important; width: 100% !important; border-radius: 0 !important;
  padding: 0 var(--jb-bar-r) 0 var(--jb-bar-l) !important;
}
/* its server-list button stays (it hides or shows our tabs); its settings button is ours already */
html[data-jb-bar] ${TOPBAR} > :first-child > :not(:first-child) { display: none !important; }
/* the window is dragged by the free space of the middle only: a drag region anywhere under the
   bar's own ends would take their clicks (the window's drag regions ignore which view is on top) */
html[data-jb-bar] ${TOPBAR} > * { min-width: 0; -webkit-app-region: drag; }
/* (the search keeps some of its column free: there the window can be dragged) */
html[data-jb-bar] ${TOPBAR} > * > * { -webkit-app-region: no-drag; }
html[data-jb-bar] ${TOPBAR} > :nth-child(2) > button { width: min(24rem, calc(100% - 64px)); min-width: 0; padding-top: 4px; padding-bottom: 4px; }
html[data-jb-bar='lcd'] ${TOPBAR} { background: #a6b08a !important; border: 0 !important; border-bottom: 2px solid #1a221c !important; box-shadow: none !important; }
html.dark[data-jb-bar='lcd'] ${TOPBAR} { background: #18201c !important; border-bottom-color: #c4d6a6 !important; }
`;
  ipcRenderer.on('shell:bar', (_e, bar: { look?: unknown; h?: unknown; l?: unknown; r?: unknown } | null) => {
    const root = document.documentElement;
    if (!root) return;
    if (!bar) {
      root.removeAttribute('data-jb-bar');
      return;
    }
    if (!document.getElementById('jb-bar')) {
      const style = document.createElement('style');
      style.id = 'jb-bar';
      style.textContent = BAR_CSS;
      (document.head ?? root).append(style);
    }
    const px = (v: unknown) => `${Math.max(0, Math.min(5000, Number(v) || 0))}px`;
    root.style.setProperty('--jb-bar-h', px(bar.h));
    root.style.setProperty('--jb-bar-l', px(bar.l));
    root.style.setProperty('--jb-bar-r', px(bar.r));
    root.setAttribute('data-jb-bar', bar.look === 'water' || bar.look === 'retro' ? bar.look : 'lcd');
  });

  // (a view shown by a class change brings no new nodes: looked at once a second as well)
  setInterval(() => document.body && reportTopbar(), 1000);

  let scheduled = false;
  const report = () => {
    scheduled = false;
    reportTopbar();
    const state = readVoice();
    const key = JSON.stringify(state);
    if (key === last) return;
    last = key;
    ipcRenderer.send('server:voice', state);
  };
  // a tab in the background gets no animation frames
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    if (document.hidden) setTimeout(report, 100);
    else requestAnimationFrame(report);
  };

  // --- light / dark: jollyboat's setting decides ------------------------------------------
  // sharkord reads its choice from localStorage when it starts and puts it on <html>; its main
  // view carries a fixed "dark" of its own. both are set here (before sharkord starts, and live
  // when the setting changes) and kept in step when sharkord renders a view anew
  let colorMode = boot.colorMode;
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
  const resolvedScheme = () => (colorMode === 'auto' ? (systemDark.matches ? 'dark' : 'light') : colorMode);
  try {
    localStorage.setItem('vite-ui-theme', colorMode === 'auto' ? 'system' : colorMode);
  } catch {
    /* storage refused: sharkord keeps its own choice */
  }
  const enforceScheme = () => {
    const want = resolvedScheme();
    const other = want === 'dark' ? 'light' : 'dark';
    const root = document.documentElement;
    if (!root.classList.contains(want) || root.classList.contains(other)) {
      root.classList.remove(other);
      root.classList.add(want);
    }
    for (const el of Array.from(document.querySelectorAll(`body .${other}`))) el.classList.replace(other, want);
  };
  systemDark.addEventListener('change', () => colorMode === 'auto' && enforceScheme());
  ipcRenderer.on('shell:color-mode', (_e, mode: 'auto' | 'dark' | 'light') => {
    if (mode !== 'auto' && mode !== 'dark' && mode !== 'light') return;
    colorMode = mode;
    try {
      localStorage.setItem('vite-ui-theme', mode === 'auto' ? 'system' : mode);
    } catch {
      /* see above */
    }
    enforceScheme();
  });

  // --- save buttons for pictures and files (no other browser needed) -----------------------
  window.addEventListener(
    'DOMContentLoaded',
    () => {
      const tr = createT(boot.lang);
      startSaveButtons({ save: tr('Save'), saveImage: tr('Save image'), saveFile: tr('Save file') }, (url) => ipcRenderer.send('server:save', url));
    },
    { once: true }
  );

  // --- the water theme: the water behind the page (the theme's css does the rest) ----------
  let pageWater: ReturnType<typeof startPageWater> = null;
  // while Jollyplay's game window is open (it marks <html data-jollyplay-playing>) the water
  // rests at a frame a second, so the game gets the gpu; it comes back when the mark goes. only
  // this page: the bar above keeps its water
  const PLAYING = 'data-jollyplay-playing';
  const playing = () => document.documentElement?.hasAttribute(PLAYING) ?? false;
  const watchPlaying = () =>
    new MutationObserver(() => pageWater?.rest(playing())).observe(document.documentElement, { attributes: true, attributeFilter: [PLAYING] });
  if (document.documentElement) watchPlaying();
  else window.addEventListener('DOMContentLoaded', watchPlaying, { once: true });

  const setWater = (want: boolean) => {
    const on = want && shown;
    if (on && !pageWater && document.body) {
      pageWater = startPageWater(boot.softGl, hasFocus, () => waterPalette);
      if (playing()) pageWater?.rest(true);
    }
    if (!on && pageWater) {
      pageWater.stop();
      pageWater = null;
    }
  };
  let wantWater = boot.water;
  // the water's colours (the theme's palette): read by the water every frame
  let waterPalette: TPalette = boot.palette;
  window.addEventListener('DOMContentLoaded', () => setWater(wantWater), { once: true });
  ipcRenderer.on('shell:water', (_e, on: unknown, palette: unknown) => {
    wantWater = on === true;
    if (ALL_PALETTES.includes(palette as TPalette)) waterPalette = palette as TPalette;
    if (document.body) setWater(wantWater);
  });
  ipcRenderer.on('shell:shown', (_e, on: unknown) => {
    shown = on !== false;
    if (document.body) setWater(wantWater);
  });

  // the page's light/dark sits as a class on <html>; the bar above takes it over
  let lastTheme = '';
  const reportTheme = () => {
    const c = document.documentElement.classList;
    const theme = c.contains('dark') ? 'dark' : c.contains('light') ? 'light' : '';
    if (theme === lastTheme) return;
    lastTheme = theme;
    ipcRenderer.send('server:theme', theme || null);
  };
  const watchTheme = () => {
    new MutationObserver(() => {
      enforceScheme();
      reportTheme();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    enforceScheme();
    reportTheme();
  };
  if (document.documentElement) watchTheme();
  else window.addEventListener('DOMContentLoaded', watchTheme, { once: true });

  // sharkord keeps its unread total in the title: "name (3)"
  let lastTitle = '';
  const reportTitle = () => {
    if (document.title === lastTitle) return;
    lastTitle = document.title;
    ipcRenderer.send('server:title', lastTitle);
  };

  // the mic/deafen bar is watched closely (class changes included); the in-voice marker sits
  // elsewhere in the sidebar, so any added/removed node in the document also re-reads the
  // state — once per animation frame at most, and only reported when it changed
  // the sidebar (channels, voice rows, the bar) is watched for class changes too: that is
  // where the speaking ring appears. the chat column is left alone
  let watchedBar: Element | null = null;
  const barObserver = new MutationObserver(schedule);
  const sidebarOf = (bar: Element) => {
    let el: Element | null = bar;
    while (el && !el.querySelector('[data-testid="channel-item"]')) el = el.parentElement;
    return el ?? bar;
  };
  const rescope = () => {
    const bar = controlBar();
    if (bar === watchedBar) return;
    barObserver.disconnect();
    watchedBar = bar;
    if (bar) barObserver.observe(sidebarOf(bar), { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  };

  window.addEventListener('DOMContentLoaded', () => {
    new MutationObserver(() => {
      rescope();
      schedule();
      scheduleScheme();
    }).observe(document.body, { subtree: true, childList: true });
    // a stream video starting or stopping is not a mutation
    for (const ev of ['playing', 'emptied', 'ended', 'loadeddata']) document.addEventListener(ev, schedule, true);
    rescope();
    schedule();
    const head = document.querySelector('head');
    if (head) new MutationObserver(reportTitle).observe(head, { subtree: true, childList: true, characterData: true });
    reportTitle();
    // sharkord's search dialog is at least 80rem wide on a wide screen, more than a window under
    // about 1300 px holds: its close button would be outside. it stays inside the window
    const fixes = document.createElement('style');
    fixes.id = 'jb-fixes';
    fixes.textContent = '[data-slot="dialog-content"][class*="min-w-7xl"] { min-width: min(80rem, calc(100% - 2rem)) !important; }';
    (head ?? document.documentElement).append(fixes);
  });

  // tray menu actions: click Sharkord's own buttons
  ipcRenderer.on('shell:voice-action', (_e, action: 'mic' | 'sound' | 'leave') => {
    if (action === 'leave') {
      document.querySelector('svg.lucide-phone-off')?.closest('button')?.click();
      return;
    }
    const bar = controlBar();
    if (!bar) return;
    const icon = action === 'mic' ? 'svg.lucide-mic, svg.lucide-mic-off' : 'svg.lucide-headphones, svg.lucide-headphone-off';
    bar.querySelector<SVGElement>(icon)?.closest('button')?.click();
  });
}
