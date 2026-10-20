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

export const getSettings = (): TSettings => {
  if (cache) return cache;

  try {
    const raw = JSON.parse(readFileSync(filePath(), 'utf8'));
    cache = { ...DEFAULTS, ...raw };
  } catch {
    cache = { ...DEFAULTS };
  }

  return cache!;
};

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

  return entry;
};

export const removeServer = (id: string) => {
  const settings = getSettings();

  saveSettings({
    servers: settings.servers.filter((s) => s.id !== id),
    autoConnectServerId: settings.autoConnectServerId === id ? null : settings.autoConnectServerId
  });
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
