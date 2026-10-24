// Single preload for every page. On our own pages (launcher, picker) it exposes the IPC API;
// on a saved Sharkord server page it injects the glue Sharkord needs (bridge pairing token,
// screen-share audio and quality, voice state for the tray, notification handling). The main
// process decides which kind of page this is from the frame URL.

import { contextBridge, ipcRenderer, webFrame } from 'electron';
import { LOOKS, type TLook, type TPalette } from '../shared/types';
import type { TOverlayState, TPickerResult, TServerInput, TSettings, TUpdateStatus, TVoiceMember, TVoiceReport } from '../shared/types';
import { startPageWater } from './water';

type TBootstrap = {
  ownPage: 'launcher' | 'picker' | 'prompt' | 'bar' | 'overlay' | null;
  isSavedServer: boolean;
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
    markLook(look, palette === 'green' ? 'green' : 'pink');
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
      setKeepLogin: (id: string, keep: boolean) => ipcRenderer.invoke('servers:keepLogin', id, keep),
      connect: (id: string) => ipcRenderer.invoke('servers:connect', id),
      bridgeStatus: () => ipcRenderer.invoke('bridge:status'),
      screenAudioInfo: () => ipcRenderer.invoke('screenAudio:info'),
      openWebsite: () => ipcRenderer.invoke('app:website'),
      editCustomCss: () => ipcRenderer.invoke('css:edit') as Promise<string>,
      positionOverlay: () => ipcRenderer.invoke('overlay:position'),
      useCssExample: () => ipcRenderer.invoke('css:example'),
      shareCode: (ids: string[] | null, withPasswords: boolean) => ipcRenderer.invoke('share:code', ids, withPasswords),
      exportFile: (ids: string[] | null, withPasswords: boolean) => ipcRenderer.invoke('share:exportFile', ids, withPasswords),
      importText: (text: string) => ipcRenderer.invoke('share:importText', text),
      importFile: () => ipcRenderer.invoke('share:importFile'),
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
      onPickerSources: (cb: (sources: unknown[], lastName: string | null) => void) => {
        ipcRenderer.on('picker:sources', (_e, sources, lastName) => cb(sources, lastName));
      },
      pickerChoose: (result: TPickerResult) => ipcRenderer.send('picker:choose', result)
    },
    bar: {
      barAction: (action: string, at?: { x: number; y: number }) => ipcRenderer.send('bar:action', action, at),
      windowFocused: hasFocus,
      onBarState: (cb: (state: { server: string; zoom: number; theme: 'light' | 'dark' | null; maximized: boolean }) => void) => {
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
    const attachPipeWire = async (stream) => {
      if (!(await shell.screenAudio('start'))) return;
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
          try { await attachPipeWire(stream); } catch (err) { shell.screenAudio('stop'); warn('pipewire audio failed', err); }
          return stream;
        }

        try {
          return await original(c);
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

  // --- the water theme: the water behind the page (the theme's css does the rest) ----------
  let pageWater: ReturnType<typeof startPageWater> = null;
  const setWater = (on: boolean) => {
    if (on && !pageWater && document.body) pageWater = startPageWater(boot.softGl, hasFocus);
    if (!on && pageWater) {
      pageWater.stop();
      pageWater = null;
    }
  };
  let wantWater = boot.water;
  window.addEventListener('DOMContentLoaded', () => setWater(wantWater), { once: true });
  ipcRenderer.on('shell:water', (_e, on: unknown) => {
    wantWater = on === true;
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
