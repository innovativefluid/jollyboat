import { app, safeStorage } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TServerEntry, TServerInput, TSettings } from '../shared/types';

const DEFAULTS: TSettings = {
  servers: [],
  autoConnectServerId: null,
  minimizeToTray: true,
  spellcheck: false,
  checkUpdates: true,
  notifyTray: true,
  windowBounds: null,
  lastSourceName: null
};

const filePath = () => join(app.getPath('userData'), 'settings.json');

let cache: TSettings | null = null;

// settings.json is user-writable: keep only values of the right shape
const sanitize = (raw: unknown): TSettings => {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: TSettings = { ...DEFAULTS };

  if (Array.isArray(r.servers)) {
    out.servers = r.servers.flatMap((s): TServerEntry[] => {
      const e = (s ?? {}) as Record<string, unknown>;
      if (typeof e.id !== 'string' || typeof e.url !== 'string') return [];
      try {
        new URL(e.url);
      } catch {
        return [];
      }
      const auth = e.basicAuth as Record<string, unknown> | undefined;
      const test = e.lastTest as Record<string, unknown> | undefined;
      return [
        {
          id: e.id,
          url: e.url,
          name: typeof e.name === 'string' ? e.name : new URL(e.url).host,
          ...(auth && typeof auth.username === 'string' && typeof auth.passwordEnc === 'string'
            ? { basicAuth: { username: auth.username, passwordEnc: auth.passwordEnc } }
            : {}),
          ...(test && typeof test.ok === 'boolean' && typeof test.at === 'number'
            ? { lastTest: { ok: test.ok, at: test.at, ...(typeof test.status === 'number' ? { status: test.status } : {}) } }
            : {})
        }
      ];
    });
  }

  if (typeof r.autoConnectServerId === 'string' && out.servers.some((s) => s.id === r.autoConnectServerId)) {
    out.autoConnectServerId = r.autoConnectServerId;
  }
  for (const key of ['minimizeToTray', 'spellcheck', 'checkUpdates', 'notifyTray'] as const) {
    if (typeof r[key] === 'boolean') out[key] = r[key] as boolean;
  }
  const b = r.windowBounds as Record<string, unknown> | undefined;
  if (b && ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(b[k]))) {
    out.windowBounds = { x: b.x as number, y: b.y as number, width: Math.max(300, b.width as number), height: Math.max(200, b.height as number) };
  }
  if (typeof r.lastSourceName === 'string') out.lastSourceName = r.lastSourceName.slice(0, 200);

  return out;
};

export const getSettings = (): TSettings => {
  if (cache) return cache;

  try {
    cache = sanitize(JSON.parse(readFileSync(filePath(), 'utf8')));
  } catch {
    cache = { ...DEFAULTS };
  }

  return cache!;
};

const serverListeners = new Set<() => void>();
/** called after any change to the server list (basic-auth filter follows it) */
export const onServersChanged = (l: () => void) => serverListeners.add(l);

export const saveSettings = (patch: Partial<TSettings>) => {
  const next = { ...getSettings(), ...patch };

  mkdirSync(app.getPath('userData'), { recursive: true });
  writeFileSync(filePath(), JSON.stringify(next, null, 2));
  cache = next;

  return next;
};

const encrypt = (value: string) =>
  safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(value).toString('base64')
    : Buffer.from(value, 'utf8').toString('base64');

export const decryptPassword = (enc: string) => {
  const buf = Buffer.from(enc, 'base64');

  try {
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8');
  } catch {
    return buf.toString('utf8');
  }
};

export const normalizeUrl = (input: string) => {
  const withScheme = /^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`;
  const url = new URL(withScheme);

  return url.origin;
};

export const upsertServer = (input: TServerInput): TServerEntry => {
  const settings = getSettings();
  const existing = input.id ? settings.servers.find((s) => s.id === input.id) : undefined;

  const entry: TServerEntry = {
    id: existing?.id ?? randomUUID(),
    name: input.name.trim() || new URL(normalizeUrl(input.url)).host,
    url: normalizeUrl(input.url),
    ...(existing?.lastTest && existing.url === normalizeUrl(input.url) ? { lastTest: existing.lastTest } : {})
  };

  if (input.basicAuth && input.basicAuth.username) {
    entry.basicAuth = {
      username: input.basicAuth.username,
      // an empty password on edit keeps the stored one
      passwordEnc:
        input.basicAuth.password || !existing?.basicAuth
          ? encrypt(input.basicAuth.password)
          : existing.basicAuth.passwordEnc
    };
  }

  const servers = existing
    ? settings.servers.map((s) => (s.id === entry.id ? entry : s))
    : [...settings.servers, entry];

  saveSettings({ servers });
  serverListeners.forEach((l) => l());

  return entry;
};

export const removeServer = (id: string) => {
  const settings = getSettings();

  saveSettings({
    servers: settings.servers.filter((s) => s.id !== id),
    autoConnectServerId: settings.autoConnectServerId === id ? null : settings.autoConnectServerId
  });
  serverListeners.forEach((l) => l());
};

export const recordTest = (id: string, result: { ok: boolean; status?: number }) => {
  const settings = getSettings();

  saveSettings({
    servers: settings.servers.map((s) => (s.id === id ? { ...s, lastTest: { ...result, at: Date.now() } } : s))
  });
};

export const findServerByUrl = (url: string) => {
  let origin: string;

  try {
    origin = new URL(url).origin;
  } catch {
    return undefined;
  }

  return getSettings().servers.find((s) => s.url === origin);
};

/** Servers as shown to the renderer: no secrets, only whether auth is set. */
export const publicServers = () =>
  getSettings().servers.map(({ basicAuth, ...rest }) => ({
    ...rest,
    basicAuth: basicAuth ? { username: basicAuth.username, passwordEnc: '' } : undefined
  }));
