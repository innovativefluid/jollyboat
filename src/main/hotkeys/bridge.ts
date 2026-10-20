// A built-in implementation of the Sharkord hotkey bridge protocol (v1), the same one the
// official Sharkord Bridge speaks (https://github.com/Sharkord/bridge). The Sharkord web app
// connects to ws://127.0.0.1:47821, pairs with a token, sends its bindings, and expects
// `event` messages with phase down/up. Our key source is Electron's globalShortcut, which only
// reports presses, so we announce keyUp:false (push-to-talk is then disabled by Sharkord).
//
// If the port is already taken (the user runs the official bridge), we stay out of the way.

import { app, globalShortcut } from 'electron';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { BRIDGE_PORT, type TBridgeStatus } from '../../shared/types';
import { comboToAccelerator } from './combo';

const PROTOCOL_VERSION = 1;
const CAPABILITIES = { keyUp: false };

type TBinding = { id: string; combo: string };
type TClient = { ws: WebSocket; serverId: string; serverName: string; bindings: TBinding[] };

let httpServer: Server | null = null;
let token = '';
let ownedByUs = false;
const clients = new Set<TClient>();
/** accelerator → combos registered for it (several servers may bind the same key) */
const registered = new Map<string, Set<string>>();

const tokenPath = () => join(app.getPath('userData'), 'bridge-token');

const loadOrCreateToken = () => {
  try {
    const existing = readFileSync(tokenPath(), 'utf8').trim();
    if (existing) return existing;
  } catch {
    /* first run */
  }

  const fresh = randomBytes(24).toString('base64url');
  mkdirSync(app.getPath('userData'), { recursive: true });
  writeFileSync(tokenPath(), fresh);

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

const rebuildShortcuts = () => {
  globalShortcut.unregisterAll();
  registered.clear();

  const wanted = new Map<string, Set<string>>(); // accelerator → combos

  for (const client of clients) {
    for (const binding of client.bindings) {
      const parsed = comboToAccelerator(binding.combo);

      if ('error' in parsed) {
        send(client.ws, { type: 'error', id: binding.id, reason: parsed.error });
        continue;
      }

      const set = wanted.get(parsed.accelerator) ?? new Set<string>();
      set.add(binding.combo);
      wanted.set(parsed.accelerator, set);
    }
  }

  for (const [accelerator, combos] of wanted) {
    let ok = false;

    try {
      ok = globalShortcut.register(accelerator, () => {
        for (const combo of combos) fire(combo, 'down');
      });
    } catch {
      ok = false;
    }

    if (ok) {
      registered.set(accelerator, combos);
      continue;
    }

    for (const client of clients) {
      for (const binding of client.bindings) {
        if (combos.has(binding.combo)) {
          send(client.ws, { type: 'error', id: binding.id, reason: 'the system refused this key' });
        }
      }
    }
  }
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

      send(ws, { type: 'ready', v: PROTOCOL_VERSION, capabilities: CAPABILITIES, platform: process.platform });
      return;
    }

    if (msg.type === 'bindings' && client && Array.isArray(msg.bindings)) {
      client.bindings = (msg.bindings as unknown[])
        .filter((b): b is TBinding => {
          const x = b as Record<string, unknown>;
          return typeof x?.id === 'string' && typeof x?.combo === 'string';
        })
        .map(({ id, combo }) => ({ id, combo }));

      rebuildShortcuts();
    }
  });

  ws.on('close', () => {
    if (client) {
      clients.delete(client);
      client = null;
      rebuildShortcuts();
    }
  });
};

export const startBridge = async (): Promise<TBridgeStatus> => {
  getBridgeToken();

  if (httpServer) return getBridgeStatus();

  const server = createServer((_req, res) => {
    res.writeHead(426).end('Jollyboat hotkey bridge');
  });
  const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });

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
  globalShortcut.unregisterAll();
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
  keyUp: CAPABILITIES.keyUp,
  bindings: [...clients].flatMap((c) => c.bindings)
});
