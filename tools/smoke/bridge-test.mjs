import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const WebSocket = createRequire(import.meta.url)('ws');
const token = readFileSync(process.argv[2], 'utf8').trim();
const talk = (hello, bindings) => new Promise((resolve) => {
  const ws = new WebSocket('ws://127.0.0.1:47821'); const got = [];
  ws.on('open', () => { ws.send(JSON.stringify(hello)); if (bindings) setTimeout(() => ws.send(JSON.stringify({ type: 'bindings', bindings })), 200); });
  ws.on('message', (m) => got.push(JSON.parse(m)));
  ws.on('close', (code) => resolve({ close: code, got }));
  setTimeout(() => ws.close(), 1200);
});
console.log('bad token  ', JSON.stringify(await talk({ type: 'hello', v: 1, token: 'nope', serverId: 's1' })));
console.log('good token ', JSON.stringify(await talk({ type: 'hello', v: 1, token, serverId: 's1', serverName: 'fake' },
  [{ id: 'core:toggle-mic', combo: 'ctrl+shift+KeyM' }, { id: 'core:push-to-talk', combo: 'ControlLeft' }, { id: 'x', combo: 'ctrl+Nope' }])));
