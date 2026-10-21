# smoke tests

Headless checks used while developing without a desktop. They need a built app (`npm run build`),
Xvfb and ImageMagick (`import`) on Linux.

```bash
# 1. run the app on a virtual display with the devtools protocol open
xvfb-run -n 77 -f /tmp/xauth -s "-screen 0 1400x900x24" \
  node_modules/electron/dist/electron --no-sandbox --disable-gpu --remote-debugging-port=9333 out/main/index.js &

# 2. drive a page and take a screenshot: cdp.mjs <url substring> <out.png> <js...>
node tools/smoke/cdp.mjs launcher /tmp/launcher.png \
  "document.getElementById('add-server').click(); 'ok'" \
  "window.__paperCost().toFixed(2) + ' ms/frame'"

# 3. talk to the built-in hotkey bridge like the sharkord web client does
node tools/smoke/bridge-test.mjs ~/.config/jollyboat-dev/bridge-token http://localhost:5173   # origin of a saved server
```

Debug switches (`NETLOG` and `FAKE_PIPEWIRE` only work in dev builds; `DEBUG` also logs in packaged builds):

| env | effect |
|---|---|
| `JOLLYBOAT_DEBUG=1` | logs tray state and screen-audio link/unlink |
| `JOLLYBOAT_NETLOG=/tmp/net.json` | records a Chromium net log; `kill -USR2 <main pid>` writes it, then `tools/smoke/netlog-hosts.py /tmp/net.json` lists every host, URL and UDP target |
| `JOLLYBOAT_FAKE_PIPEWIRE=1` | pretends PipeWire/venmic is present (link/unlink only log) so the page side of screen-share audio can be tested |

A fake "server" for the preload checks is any static http server that answers `/info` with
`{"serverId":"x", ...}` and serves a page.

## against a real Sharkord

The fake server cannot log in, join voice or mute. Sharkord's own repo runs locally with Bun and
ships a seeded test database (`testowner` / `password123`):

```bash
git clone --depth 1 https://github.com/sharkord/sharkord.git && cd sharkord
bun install
(cd packages/e2e && bun run seed:e2e)                       # creates packages/e2e/e2e-data
(cd apps/server && SHARKORD_DATA_PATH=../../packages/e2e/e2e-data bun ./src/index.ts) &   # :4991
(cd apps/client && bun run dev) &                           # vite on :5173, websocket to :4991
```

Add `http://localhost:5173` as a server in Jollyboat (run electron with
`--use-fake-device-for-media-stream --use-fake-ui-for-media-stream` so voice can join without a
microphone), then drive the page through `cdp.mjs`: Sharkord's elements carry `data-testid`
attributes (`connect-identity-input`, `connect-password-input`, `connect-button`, `server-view`,
`channel-item`, `user-settings-trigger`), its icons are lucide (`svg.lucide-mic-off`,
`svg.lucide-headphone-off`, `svg.lucide-phone-off`). With `JOLLYBOAT_DEBUG=1` every tray state
change is logged as `[tray] <icon> | ...`.

## smoke mode (CI)

`JOLLYBOAT_SMOKE=1` makes the packaged app start, render the setup window and the server window's
bar, print `[smoke] <platform> <arch> | ...` and exit 0 (1 if something did not come up, or after
60 s). CI runs it on every build: Windows x64 and arm64 (`smoke-win.ps1`), Linux x64 and arm64.
