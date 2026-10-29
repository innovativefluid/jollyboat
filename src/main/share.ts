// Import / export of server configs so people can share them.
// Two forms of the same document: a JSON file, or a one-line code `jollyboat1:<base64url json>`
// that survives a chat message. Passwords are only included when asked for. A share of one server
// can carry a Sharkord invite too: the friend pastes one code and lands on the sign-up screen.

import { dialog, type BrowserWindow } from 'electron';
import { t } from './lang';
import { readFile, writeFile } from 'node:fs/promises';
import type { TServerInput } from '../shared/types';
import { decryptPassword, getSettings, normalizeUrl, upsertServer } from './settings';
import { INVITE_CODE, parseInvite } from '../shared/invite';

const CODE_PREFIX = 'jollyboat1:';
const FORMAT = 1;

type TShared = {
  jollyboat: number;
  servers: { name: string; url: string; basicAuth?: { username: string; password?: string }; invite?: string }[];
};

export const buildExport = (ids: string[] | null, includePasswords: boolean, invite?: string): TShared => {
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
        : {}),
      ...(invite && servers.length === 1 ? { invite } : {})
    }))
  };
};

/** the invite to put in a share: a link of that server or a bare code; '' for none */
export const shareInvite = (text: unknown, serverUrl: string | undefined) => {
  const s = String(text ?? '').trim();
  if (!s) return undefined;
  const inv = parseInvite(s, true);
  if (!inv) throw new Error(t('not an invite link or code'));
  if (inv.url && serverUrl && inv.url !== serverUrl) throw new Error(t('that invite is for another server'));
  return inv.code;
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
    throw new Error(t('not a share code'));
  }

  const doc = parsed as Partial<TShared>;

  if (doc?.jollyboat !== FORMAT || !Array.isArray(doc.servers)) {
    throw new Error('not a Jollyboat share');
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
        : {}),
      ...(typeof s.invite === 'string' && INVITE_CODE.test(s.invite) ? { invite: s.invite } : {})
    };
  });

  if (servers.length === 0) throw new Error(t('no servers in it'));

  return { jollyboat: FORMAT, servers };
};

/** adds or updates (matched by url); returns the names that were imported, and the ids of those
 * that sit behind a proxy login but came without its password (none stored either) */
export const importShared = (doc: TShared) => {
  const existing = getSettings().servers;
  const missing: string[] = [];

  const names = doc.servers.map((s) => {
    const current = existing.find((e) => e.url === s.url);
    const input: TServerInput = {
      id: current?.id,
      name: s.name || current?.name || '',
      url: s.url,
      basicAuth: s.basicAuth
        ? { username: s.basicAuth.username, password: s.basicAuth.password ?? '' } // empty keeps a stored one
        : null,
      ...(s.invite ? { invite: s.invite } : {})
    };

    const saved = upsertServer(input);
    if (saved.basicAuth && decryptPassword(saved.basicAuth.passwordEnc) === '') missing.push(saved.id);
    return `${saved.name} (${new URL(saved.url).host})`;
  });

  return { names, missing, invited: doc.servers.some((s) => s.invite) };
};

/** a plain Sharkord invite link pasted where a share code goes: the server is added (or the
 * saved one gets the invite) and asked once whether it sits behind a proxy login, which a link
 * can't carry. returns like importShared, plus the ids whose proxy wants a login */
export const importInvite = async (text: string, probe: (url: string) => Promise<number | null>) => {
  const inv = parseInvite(text);
  if (!inv?.url) return null;
  const current = getSettings().servers.find((e) => e.url === inv.url);
  const saved = upsertServer({
    id: current?.id,
    name: current?.name ?? '',
    url: inv.url,
    basicAuth: current?.basicAuth ? { username: current.basicAuth.username, password: '' } : null,
    invite: inv.code
  });
  const status = current?.basicAuth ? null : await probe(saved.url);
  return {
    names: [`${saved.name} (${new URL(saved.url).host})`],
    missing: current?.basicAuth && decryptPassword(current.basicAuth.passwordEnc) === '' ? [saved.id] : [],
    invited: true,
    needsLogin: status === 401 ? [saved.id] : []
  };
};

export const exportToFile = async (win: BrowserWindow | null, doc: TShared) => {
  const { filePath, canceled } = await dialog.showSaveDialog(win ?? undefined as never, {
    title: t('save server file'),
    defaultPath: 'jollyboat-servers.json',
    filters: [{ name: t('sharkord servers'), extensions: ['json'] }]
  });

  if (canceled || !filePath) return null;

  await writeFile(filePath, JSON.stringify(doc, null, 2), { mode: 0o600 }); // may hold passwords

  return filePath;
};

export const importFromFile = async (win: BrowserWindow | null) => {
  const { filePaths, canceled } = await dialog.showOpenDialog(win ?? undefined as never, {
    title: t('open server file'),
    properties: ['openFile'],
    filters: [{ name: t('sharkord servers'), extensions: ['json'] }, { name: t('all files'), extensions: ['*'] }]
  });

  if (canceled || !filePaths[0]) return null;

  const text = await readFile(filePaths[0], 'utf8');

  if (text.length > 200_000) throw new Error(t('file too large'));

  return importShared(parseShared(text));
};
