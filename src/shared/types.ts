// Types shared by main, preload and renderer. Keep this file free of imports.

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
  };
};

export type TServerInput = {
  id?: string;
  name: string;
  url: string;
  basicAuth?: { username: string; password: string } | null;
};

export type TSettings = {
  servers: TServerEntry[];
  /** server opened at startup instead of the launcher; null = show the launcher */
  autoConnectServerId: string | null;
  minimizeToTray: boolean;
  /** spellcheck in text fields; off by default because the dictionaries come from google's cdn */
  spellcheck: boolean;
  /** windows: look for updates on github releases */
  checkUpdates: boolean;
  /** flash the window, badge and tray on a new message while the window is in the background */
  notifyTray: boolean;
  /** last main window bounds, restored on start when they still fit a display */
  windowBounds: { x: number; y: number; width: number; height: number } | null;
  /** name of the last shared screen/window, preselected in the picker */
  lastSourceName: string | null;
};

export type TVoiceState = { connected: boolean; inVoice: boolean; micMuted: boolean; deafened: boolean };

export type TUpdateStatus = { state: 'idle' | 'checking' | 'available' | 'downloaded' | 'none' | 'error'; version?: string; message?: string; url?: string };

export type TServerInfo = {
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
