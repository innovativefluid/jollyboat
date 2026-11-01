// Types shared by main, preload and renderer. Keep this file free of imports.

/** the look of the app's own windows */
export type TLook = 'lcd' | 'water' | 'retro';
export const LOOKS: readonly TLook[] = ['lcd', 'water', 'retro'];
/** a theme's colours (theme tints): the same theme in a few palettes, picked beside the theme
 *  menu. the first of each list is the theme's own (the default) */
export const PALETTES = { retro: ['pink', 'green', 'grey'], water: ['blue', 'pink', 'mono'] } as const;
export type TTintedTheme = keyof typeof PALETTES;
export type TPalettes = { [K in TTintedTheme]: (typeof PALETTES)[K][number] };
export type TPalette = TPalettes[TTintedTheme];
export const ALL_PALETTES: readonly TPalette[] = [...new Set<TPalette>([...PALETTES.retro, ...PALETTES.water])];
export const isTinted = (theme: string): theme is TTintedTheme => theme in PALETTES;

export type TServerEntry = {
  id: string;
  name: string;
  /** Origin only, e.g. https://chat.example.com */
  url: string;
  /** result of the last connection test (done on every save) */
  lastTest?: { ok: boolean; status?: number; at: number };
  basicAuth?: {
    username: string;
    /** Encrypted with Electron safeStorage, base64. Never leaves the main process. */
    passwordEnc: string;
    /** pages only: whether a password is stored (a share code without one leaves it empty) */
    hasPassword?: boolean;
  };
  /** Sharkord's 7-day login token, encrypted like the password; only handed to that server's page */
  loginEnc?: string;
  /** a Sharkord invite code (from an invite link or a share code): the page opens with it until
   *  someone logs in there */
  invite?: string;
};

/** what an import did: names, ids still without their proxy password, ids whose proxy wants a
 *  login (an invite link can't carry one), and whether an invite came along */
export type TImported = { names: string[]; missing: string[]; needsLogin?: string[]; invited?: boolean };

export type TServerInput = {
  id?: string;
  name: string;
  url: string;
  basicAuth?: { username: string; password: string } | null;
  /** an invite code; null drops a stored one (an invite link as the url brings its own) */
  invite?: string | null;
};

export type TSettings = {
  servers: TServerEntry[];
  /** at start the tabs open last time come back (otherwise, and with none, the setup window) */
  reopenTabs: boolean;
  /** the tab shown last, shown again when the tabs come back */
  lastActiveServerId: string | null;
  /** what closing the server window does */
  onClose: 'minimize' | 'tray' | 'quit';
  /** spellcheck in text fields; off by default because the dictionaries come from google's cdn */
  spellcheck: boolean;
  /** windows: look for updates on github releases */
  checkUpdates: boolean;
  /** flash the window, badge and tray on a new message while the window is in the background */
  notifyTray: boolean;
  /** the voice overlay: an always-on-top list of who is in the call and who talks */
  overlay: boolean;
  /** the overlay's background, 0 (see-through) to 100 (solid); the text stays solid */
  overlayOpacity: number;
  /** the app's own language: follow the system, or one of ours */
  language: 'system' | 'en' | 'de' | 'pl';
  /** light or dark for every window: the server page, its bar, the overlay and the app's own
   *  windows; auto follows the system */
  colorMode: 'auto' | 'dark' | 'light';
  /** a theme on the server page: none, the app's own lcd look, the water look, the retro look,
   *  or custom.css next to the settings. the app's own windows take the water look with 'water',
   *  the retro look with 'retro', else the lcd one */
  theme: 'none' | 'jollyboat' | 'water' | 'retro' | 'custom';
  /** each tintable theme's palette */
  palettes: TPalettes;
  /** where the overlay was left (top-left corner), null = top left of the main display */
  overlayPosition: { x: number; y: number } | null;
  /** flatpak: what the background portal last granted for starting at login (the portal's
   *  autostart file is outside the sandbox, so the app remembers it) */
  autostart: boolean;
  /** last main window bounds, restored on start when they still fit a display */
  windowBounds: { x: number; y: number; width: number; height: number } | null;
  /** name of the last shared screen/window, preselected in the picker */
  lastSourceName: string | null;
  /** the sound picked for the last share ('all', 'none', 'app:<id>'), preselected when it is there again */
  lastSound: string;
  /** the server tabs in the bar (off: the bar names the server shown) */
  serverTabs: boolean;
  /** the servers open in tabs, in their order; opened again at start (reopenTabs) */
  openServers: string[];
};

/** a server tab in the bar */
export type TTab = {
  id: string;
  name: string;
  /** the server's logo as a data url, once fetched */
  logo: string | null;
  active: boolean;
  /** unread messages (sharkord's count) and whether one of them mentions us */
  unread: number;
  mentioned: boolean;
  /** in a call there */
  voice: boolean;
  /** desktop mode only: what the page says about its connection */
  connection: 'connecting' | 'connected' | 'signed-out' | 'disconnected' | null;
  loading: boolean;
};

export type TBarState = {
  /** the bar shares its row with sharkord's top bar: both ends transparent, the middle is the page */
  merged: boolean;
  /** merged, and a dialog's backdrop darkens the page: the bar's ends darken too */
  dim: boolean;
  server: string;
  zoom: number;
  theme: 'light' | 'dark' | null;
  maximized: boolean;
  streams: number;
  tabs: TTab[];
  showTabs: boolean;
};

export type TVoiceState = { connected: boolean; inVoice: boolean; micMuted: boolean; deafened: boolean; speaking: boolean };

/** someone in our voice channel, as Sharkord's sidebar shows them */
export type TVoiceMember = { name: string; self: boolean; speaking: boolean; micMuted: boolean; deafened: boolean; sharing: boolean; video: boolean };

/** what the page reports: the tray's state plus the channel for the overlay */
export type TVoiceReport = TVoiceState & { channel: string; members: TVoiceMember[]; /** playing stream videos (screen shares, cameras) that could be popped out */ streams: number };

/** what the overlay window shows */
export type TOverlayState = { channel: string; members: TVoiceMember[]; theme: 'light' | 'dark'; opacity: number; /** being placed: draggable, with a done button */ positioning: boolean };

export type TUpdateStatus = { state: 'idle' | 'checking' | 'available' | 'downloaded' | 'none' | 'error'; version?: string; message?: string; url?: string };

type TServerInfo = {
  serverId: string;
  name: string;
  description: string;
  allowNewUsers: boolean;
  version?: string;
  oidcEnabled: boolean;
};

export type TTestResult =
  | { ok: true; info: TServerInfo; version?: string }
  | { ok: false; status?: number; error: string };

export type TCaptureSource = {
  id: string;
  name: string;
  kind: 'screen' | 'window';
  thumbnail: string; // data URL
  appIcon?: string;
};

/** the picker's answer: what to share, and its sound ('all' but our call, 'none', 'app:<id>') */
export type TPickerResult = { sourceId: string; sound?: string } | null;

/** the picker's sound menu: shown when the page asked for sound */
export type TPickerSound = { apps: { id: string; name: string }[]; perApp: boolean; last: string; only?: boolean };

export type TBridgeStatus = {
  running: boolean;
  port: number;
  /** false when another bridge (e.g. the official Sharkord Bridge) owns the port */
  ownedByUs: boolean;
  keyUp: boolean;
  bindings: { id: string; combo: string }[];
};

export const BRIDGE_PORT = 47821;
