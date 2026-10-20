// Import / export of server configs so people can share them.
// Two forms of the same document: a JSON file, or a one-line code `jollyboat1:<base64url json>`
// that survives a chat message. Passwords are only included when asked for.

import { dialog, type BrowserWindow } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import type { TServerInput } from '../shared/types';
import { decryptPassword, getSettings, normalizeUrl, upsertServer } from './settings';

const CODE_PREFIX = 'jollyboat1:';
const FORMAT = 1;

type TShared = {
  jollyboat: number;
  servers: { name: string; url: string; basicAuth?: { username: string; password?: string } }[];
};

export const buildExport = (ids: string[] | null, includePasswords: boolean): TShared => {
  const servers = getSettings().servers.filter((s) => !ids || ids.includes(s.id));

  return {
    jollyboat: FORMAT,
    servers: servers.map((s) => ({
      name: s.name,
      url: s.url,
      ...(s.basicAuth
        ? {
            basicAuth: {
              username: s.basicAuth.username,
              ...(includePasswords ? { password: decryptPassword(s.basicAuth.passwordEnc) } : {})
            }
          }
        : {})
    }))
  };
};

export const toCode = (doc: TShared) => CODE_PREFIX + Buffer.from(JSON.stringify(doc), 'utf8').toString('base64url');

export const parseShared = (text: string): TShared => {
  const trimmed = text.trim();
  const json = trimmed.startsWith(CODE_PREFIX)
    ? Buffer.from(trimmed.slice(CODE_PREFIX.length), 'base64url').toString('utf8')
    : trimmed;

  let parsed: unknown;

  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('not a share code');
  }

  const doc = parsed as Partial<TShared>;

  if (doc?.jollyboat !== FORMAT || !Array.isArray(doc.servers)) {
    throw new Error('not a jollyboat share');
  }

  const servers = doc.servers.slice(0, 50).map((raw) => {
    const s = (raw ?? {}) as Record<string, unknown>;
    const auth = s.basicAuth as Record<string, unknown> | undefined;
    const url = normalizeUrl(String(s.url ?? '')); // throws on garbage

    return {
      name: String(s.name ?? '').slice(0, 100),
      url,
      ...(auth && typeof auth.username === 'string'
        ? {
            basicAuth: {
              username: auth.username.slice(0, 200),
              ...(typeof auth.password === 'string' ? { password: auth.password.slice(0, 500) } : {})
            }
          }
        : {})
    };
  });

  if (servers.length === 0) throw new Error('no servers in it');

  return { jollyboat: FORMAT, servers };
};

/** adds or updates (matched by url); returns the names that were imported */
export const importShared = (doc: TShared) => {
  const existing = getSettings().servers;

  return doc.servers.map((s) => {
    const current = existing.find((e) => e.url === s.url);
    const input: TServerInput = {
      id: current?.id,
      name: s.name || current?.name || '',
      url: s.url,
      basicAuth: s.basicAuth
        ? { username: s.basicAuth.username, password: s.basicAuth.password ?? '' } // empty keeps a stored one
        : null
    };

    return upsertServer(input).name;
  });
};

export const exportToFile = async (win: BrowserWindow | null, doc: TShared) => {
  const { filePath, canceled } = await dialog.showSaveDialog(win ?? undefined as never, {
    title: 'save server file',
    defaultPath: 'jollyboat-servers.json',
    filters: [{ name: 'sharkord servers', extensions: ['json'] }]
  });

  if (canceled || !filePath) return null;

  await writeFile(filePath, JSON.stringify(doc, null, 2));

  return filePath;
};

export const importFromFile = async (win: BrowserWindow | null) => {
  const { filePaths, canceled } = await dialog.showOpenDialog(win ?? undefined as never, {
    title: 'open server file',
    properties: ['openFile'],
    filters: [{ name: 'sharkord servers', extensions: ['json'] }, { name: 'all files', extensions: ['*'] }]
  });

  if (canceled || !filePaths[0]) return null;

  const text = await readFile(filePaths[0], 'utf8');

  if (text.length > 200_000) throw new Error('file too large');

  return importShared(parseShared(text));
};
