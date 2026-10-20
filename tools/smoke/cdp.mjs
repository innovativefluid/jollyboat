// tiny CDP driver: node cdp.mjs <urlSubstring> <outPng> <js...>
// evaluates each js argument in order (awaited), then captures a screenshot.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const WebSocket = require('ws');

const [, , match, out, ...scripts] = process.argv;
const targets = await (await fetch('http://127.0.0.1:9333/json')).json();
const target = targets.find((t) => t.type === 'page' && t.url.includes(match));
if (!target) { console.error('no target for', match, targets.map((t) => t.url)); process.exit(1); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.once('open', r));
let id = 0;
const pending = new Map();
ws.on('message', (raw) => { const m = JSON.parse(raw); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });

for (const js of scripts) {
  const res = await send('Runtime.evaluate', { expression: js, awaitPromise: true, returnByValue: true });
  console.log('>', js.slice(0, 70), '=>', JSON.stringify(res.result?.result?.value ?? res.result?.exceptionDetails?.text ?? null));
}
await new Promise((r) => setTimeout(r, 700));
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
console.log('saved', out);
ws.close();
