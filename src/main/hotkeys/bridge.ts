// A built-in implementation of the Sharkord hotkey bridge protocol (v1), the same one the
// official Sharkord Bridge speaks (https://github.com/Sharkord/bridge). The Sharkord web app
// connects to ws://127.0.0.1:47821, pairs with a token, sends its bindings, and expects
// `event` messages with phase down/up. Keys come from the best source the system has (see
// sources.ts); when it reports releases we announce keyUp:true and Sharkord offers push-to-talk.
//
// If the port is already taken (the user runs the official bridge), we stay out of the way.

import { app } from 'electron';
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { BRIDGE_PORT, type TBridgeStatus } from '../../shared/types';
import { findServerByUrl } from '../settings';
import { log } from '../log';
import { createKeySource, type TKeySource } from './sources';

const PROTOCOL_VERSION = 1;

// what sharkord's core actions are called in the desktop's shortcut settings (linux portal)
const DESCRIPTIONS: Record<string, string> = {
  'core:push-to-talk': 'Push to talk',
  'core:toggle-mic': 'Mute or unmute the microphone',
  'core:toggle-sound': 'Deafen or undeafen'
};

type TBinding = { id: string; combo: string };
type TClient = { ws: WebSocket; serverId: string; serverName: string; bindings: TBinding[] };

let httpServer: Server | null = null;
let token = '';
let ownedByUs = false;
const clients = new Set<TClient>();
let keys: TKeySource | null = null;

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

const fire = (combo: string, phase: 'down' | 'up') => {
  for (const client of clients) {
    for (const binding of client.bindings) {
      if (binding.combo === combo) send(client.ws, { type: 'event', id: binding.id, phase });
    }
  }
};

// every client's bindings go to the key source in one list; several servers may bind the same
// combo, an event then goes to each of them
let applying = 0;
const rebuildShortcuts = async () => {
  if (!keys) return;
  const round = ++applying;
  const list = [...clients].flatMap((c) => c.bindings.map((b) => ({ combo: b.combo, description: DESCRIPTIONS[b.id] ?? b.id })));
  const failed = await keys.apply(list);
  if (round !== applying) return; // a newer list is on its way

  for (const client of clients) {
    for (const binding of client.bindings) {
      const reason = failed.get(binding.combo);
      if (reason) send(client.ws, { type: 'error', id: binding.id, reason });
    }
  }
  if (failed.size) log('hotkeys', `${failed.size} key(s) not registered: ${[...new Set(failed.values())].join(', ')}`);
};

const handleConnection = (ws: WebSocket) => {
  let client: TClient | null = null;

  ws.on('message', (raw) => {
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
        if (other.serverId === msg.serverId) {
          send(other.ws, { type: 'replaced' });
          other.ws.close();
          clients.delete(other);
        }
      }

      client = { ws, serverId: msg.serverId, serverName: String(msg.serverName ?? ''), bindings: [] };
      clients.add(client);

      send(ws, { type: 'ready', v: PROTOCOL_VERSION, capabilities: { keyUp: keys?.keyUp ?? false }, platform: process.platform });
      return;
    }

    if (msg.type === 'bindings' && client && Array.isArray(msg.bindings)) {
      client.bindings = (msg.bindings as unknown[])
        .filter((b): b is TBinding => {
          const x = b as Record<string, unknown>;
          return typeof x?.id === 'string' && typeof x?.combo === 'string';
        })
        .map(({ id, combo }) => ({ id, combo }));

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
  keys ??= await createKeySource(fire);

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

export const stopBridge = () => {
  keys?.stop();
  keys = null;
  for (const client of clients) client.ws.close();
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
