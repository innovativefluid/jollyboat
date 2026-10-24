// Types shared by main, preload and renderer. Keep this file free of imports.

/** the look of the app's own windows */
export type TLook = 'lcd' | 'water' | 'retro';
export const LOOKS: readonly TLook[] = ['lcd', 'water', 'retro'];

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
  /** keep Sharkord's login token across launches (default on) */
  keepLogin?: boolean;
  /** Sharkord's 7-day login token, encrypted like the password; only handed to that server's page */
  loginEnc?: string;
};

export type TServerInput = {
  id?: string;
  name: string;
  url: string;
  basicAuth?: { username: string; password: string } | null;
  keepLogin?: boolean;
};

export type TSettings = {
  servers: TServerEntry[];
  /** server opened at startup instead of the launcher; null = show the launcher */
  autoConnectServerId: string | null;
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
  /** where the overlay was left (top-left corner), null = top left of the main display */
  overlayPosition: { x: number; y: number } | null;
  /** flatpak: what the background portal last granted for starting at login (the portal's
   *  autostart file is outside the sandbox, so the app remembers it) */
  autostart: boolean;
  /** last main window bounds, restored on start when they still fit a display */
  windowBounds: { x: number; y: number; width: number; height: number } | null;
  /** name of the last shared screen/window, preselected in the picker */
  lastSourceName: string | null;
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

export type TPickerResult = { sourceId: string } | null;

export type TBridgeStatus = {
  running: boolean;
  port: number;
  /** false when another bridge (e.g. the official Sharkord Bridge) owns the port */
  ownedByUs: boolean;
  keyUp: boolean;
  bindings: { id: string; combo: string }[];
};

export const BRIDGE_PORT = 47821;
