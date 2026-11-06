// A built-in implementation of the Sharkord hotkey bridge protocol (v1), the same one the
// official Sharkord Bridge speaks (https://github.com/Sharkord/bridge). The Sharkord web app
// connects to ws://127.0.0.1:47821, pairs with a token, sends its bindings, and expects
// `event` messages with phase down/up. Keys come from the best source the system has (see
// sources.ts); when it reports releases we announce keyUp:true and Sharkord offers push-to-talk.
//
// If the port is already taken (the user runs the official bridge), we stay out of the way.
//
// Pages in desktop mode (desktop.ts, Sharkord's desktop bridge) bind their keys here too, without
// the websocket: every page's bindings go to the one key source together.

import { app } from 'electron';
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { BRIDGE_PORT, type TBridgeStatus } from '../../shared/types';
import { findServerByUrl } from '../settings';
import { log } from '../log';
import { t } from '../lang';
import { createKeySource, type TKeySource } from './sources';

const PROTOCOL_VERSION = 1;

// what sharkord's core actions are called in the desktop's shortcut settings (linux portal)
const describe = (id: string) =>
  id === 'core:push-to-talk' ? t('Push to talk') : id === 'core:toggle-mic' ? t('Mute or unmute the microphone') : id === 'core:toggle-sound' ? t('Deafen or undeafen') : id.slice(0, 64);

type TBinding = { id: string; combo: string };
type TClient = {
  /** the websocket of a page in web mode; none for a page in desktop mode */
  ws?: WebSocket;
  /** desktop mode: the page's webContents id */
  key?: number;
  /** the page's origin (websocket clients) */
  origin?: string;
  serverId: string;
  serverName: string;
  bindings: TBinding[];
  fire: (id: string, phase: 'down' | 'up') => void;
  /** the bindings that did not register, all of them, after every change */
  failed: (errors: { id: string; reason: string }[]) => void;
};

export type TDesktopHotkeyReason = 'unsupported' | 'needs-modifier' | 'taken' | 'declined';

/** a key source's reason in the words of sharkord's desktop bridge */
export const desktopReason = (reason: string): TDesktopHotkeyReason =>
  // (a modifier alone: 'unsupported', as sharkord's own app says since 0.0.30; 'needs-modifier'
  // leaves the bridge with its next version)
  /refused this key/.test(reason) ? 'taken'
  : /desktop|dialog|assigned/.test(reason) ? 'declined'
  : 'unsupported';

let httpServer: Server | null = null;
let token = '';
let ownedByUs = false;
const clients = new Set<TClient>();
let keys: TKeySource | null = null;
// the key source is looked for in the background (on linux it asks the desktop portal, which
// may take a moment): startup does not wait, a page's hello does
let keysReady: Promise<void> | null = null;

const tokenPath = () => join(app.getPath('userData'), 'bridge-token');

const loadOrCreateToken = () => {
  try {
    const existing = readFileSync(tokenPath(), 'utf8').trim();
    if (existing) {
      try {
        chmodSync(tokenPath(), 0o600); // files from older versions
      } catch {
        /* windows: acls, not modes */
      }
      return existing;
    }
  } catch {
    /* first run */
  }

  const fresh = randomBytes(24).toString('base64url');
  mkdirSync(app.getPath('userData'), { recursive: true });
  writeFileSync(tokenPath(), fresh, { mode: 0o600 });

  return fresh;
};

export const getBridgeToken = () => token || (token = loadOrCreateToken());

const send = (ws: WebSocket, payload: unknown) => {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
};

// several open servers may bind the same keys: only one of them gets a press, the one main
// ranks first (the server in a call, else the one shown). a release goes where its press went
let rank: (client: { key?: number; origin?: string }) => number = () => 0;
export const setHotkeyRanking = (fn: typeof rank) => {
  rank = fn;
};
const pressedBy = new Map<string, TClient>();

const fire = (combo: string, phase: 'down' | 'up') => {
  let target = phase === 'up' ? pressedBy.get(combo) : undefined;
  if (!target || !clients.has(target)) {
    let best = -Infinity;
    for (const client of clients) {
      if (!client.bindings.some((b) => b.combo === combo)) continue;
      const score = rank(client);
      if (score > best) {
        best = score;
        target = client;
      }
    }
  }
  if (!target) return;
  if (phase === 'down') pressedBy.set(combo, target);
  else pressedBy.delete(combo);
  for (const binding of target.bindings) if (binding.combo === combo) target.fire(binding.id, phase);
};

// every client's bindings go to the key source in one list; several servers may bind the same
// combo, an event then goes to each of them
let applying = 0;
const rebuildShortcuts = async () => {
  if (!keys) return;
  const round = ++applying;
  // (desktop clients hear about their failed keys every round: the list is the whole of them)
  // the description shows up in the desktop's shortcut dialog (linux): a page's own action
  // ids are cut short there
  const list = [...clients].flatMap((c) => c.bindings.map((b) => ({ combo: b.combo, description: describe(b.id) })));
  const failed = await keys.apply(list);
  if (round !== applying) return; // a newer list is on its way

  for (const client of clients) {
    client.failed(client.bindings.flatMap((b) => (failed.has(b.combo) ? [{ id: b.id, reason: failed.get(b.combo)! }] : [])));
  }
  if (failed.size) log('hotkeys', `${failed.size} key(s) not registered: ${[...new Set(failed.values())].join(', ')}`);
};

const handleConnection = (ws: WebSocket, req: { headers: { origin?: string } }) => {
  let client: TClient | null = null;

  ws.on('message', async (raw) => {
    let msg: Record<string, unknown>;

    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }

    if (msg.type === 'hello') {
      if (msg.v !== PROTOCOL_VERSION || msg.token !== getBridgeToken() || typeof msg.serverId !== 'string') {
        ws.close(4001, 'unauthorized');
        return;
      }

      // one tab per server: a newer hello for the same server takes over
      for (const other of clients) {
        if (other.ws && other.serverId === msg.serverId) {
          send(other.ws, { type: 'replaced' });
          other.ws.close();
          clients.delete(other);
        }
      }

      client = {
        ws,
        origin: req.headers.origin,
        serverId: msg.serverId,
        serverName: String(msg.serverName ?? ''),
        bindings: [],
        fire: (id, phase) => send(ws, { type: 'event', id, phase }),
        failed: (errors) => errors.forEach(({ id, reason }) => send(ws, { type: 'error', id, reason }))
      };
      clients.add(client);

      await keysReady;
      send(ws, { type: 'ready', v: PROTOCOL_VERSION, capabilities: { keyUp: keys?.keyUp ?? false }, platform: process.platform });
      return;
    }

    if (msg.type === 'bindings' && client && Array.isArray(msg.bindings)) {
      // a page binds a handful of keys; more than that is not a page we want keys from
      client.bindings = pickBindings(msg.bindings as unknown[], (b) => b.id);

      void rebuildShortcuts();
    }
  });

  ws.on('close', () => {
    if (client) {
      clients.delete(client);
      client = null;
      void rebuildShortcuts();
    }
  });
};

export const startBridge = async (): Promise<TBridgeStatus> => {
  getBridgeToken();

  if (httpServer) return getBridgeStatus();
  keysReady ??= createKeySource(fire).then((source) => {
    keys = source;
    void rebuildShortcuts(); // bindings that arrived meanwhile
  });

  const server = createServer((_req, res) => {
    res.writeHead(426).end('Jollyboat hotkey bridge');
  });
  // only sharkord pages from saved servers (inside jollyboat) talk to this bridge: any other site
  // in any browser on this machine could reach 127.0.0.1, so it is turned away before the token
  // even comes into it. a handful of connections at most
  const wss: WebSocketServer = new WebSocketServer({
    server,
    maxPayload: 64 * 1024,
    verifyClient: ({ origin }: { origin: string }) => !!origin && !!findServerByUrl(origin) && wss.clients.size < 8
  });

  wss.on('connection', handleConnection);

  await new Promise<void>((resolve) => {
    server.once('error', () => {
      // most likely EADDRINUSE: the official bridge is running, let it handle hotkeys
      ownedByUs = false;
      httpServer = null;
      resolve();
    });
    server.listen(BRIDGE_PORT, '127.0.0.1', () => {
      ownedByUs = true;
      httpServer = server;
      resolve();
    });
  });

  return getBridgeStatus();
};

const pickBindings = (list: unknown[], id: (b: Record<string, unknown>) => unknown) =>
  list
    .slice(0, 32)
    .map((b) => (b ?? {}) as Record<string, unknown>)
    .filter((b) => typeof id(b) === 'string' && typeof b.combo === 'string' && (id(b) as string).length <= 128 && (b.combo as string).length <= 64 && b.combo !== '')
    .map((b) => ({ id: id(b) as string, combo: b.combo as string }));

/** a page in desktop mode binds its keys (an empty list lets them go). resolves with the ones
 * that did not register; later changes reach it through onErrors */
export const setDesktopHotkeys = async (
  key: number,
  serverId: string,
  raw: unknown,
  onKey: (actionId: string, phase: 'down' | 'up') => void,
  onErrors: (errors: { actionId: string; reason: TDesktopHotkeyReason }[]) => void
) => {
  const bindings = pickBindings(Array.isArray(raw) ? raw : [], (b) => b.actionId);
  for (const c of clients) if (c.key === key) clients.delete(c);
  if (!bindings.length) {
    void rebuildShortcuts();
    return [];
  }
  let last: { actionId: string; reason: TDesktopHotkeyReason }[] = [];
  const client: TClient = {
    key,
    serverId,
    serverName: '',
    bindings,
    fire: onKey,
    failed: (errors) => {
      last = errors.map(({ id, reason }) => ({ actionId: id, reason: desktopReason(reason) }));
      onErrors(last);
    }
  };
  clients.add(client);
  await keysReady;
  await rebuildShortcuts();
  return last;
};

export const clearDesktopHotkeys = (key: number) => {
  let had = false;
  for (const c of clients) if (c.key === key) had = clients.delete(c);
  if (had) void rebuildShortcuts();
};

/** what sharkord's desktop bridge asks: releases too, and whether the desktop owns the keys */
export const hotkeyCapabilities = async () => {
  await keysReady;
  return { keyUp: keys?.keyUp ?? false, systemManaged: keys?.name === 'GlobalShortcuts portal' };
};

export const stopBridge = () => {
  keys?.stop();
  keys = null;
  keysReady = null;
  for (const client of clients) client.ws?.close();
  clients.clear();
  httpServer?.close();
  httpServer = null;
  ownedByUs = false;
};

export const getBridgeStatus = (): TBridgeStatus => ({
  running: ownedByUs,
  port: BRIDGE_PORT,
  ownedByUs,
  keyUp: keys?.keyUp ?? false,
  bindings: [...clients].flatMap((c) => c.bindings)
});
