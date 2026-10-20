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
node tools/smoke/bridge-test.mjs ~/.config/jollyboat-dev/bridge-token
```

Debug switches (`NETLOG` and `FAKE_PIPEWIRE` only work in dev builds; `DEBUG` also logs in packaged builds):

| env | effect |
|---|---|
| `JOLLYBOAT_DEBUG=1` | logs tray state and screen-audio link/unlink |
| `JOLLYBOAT_NETLOG=/tmp/net.json` | records a Chromium net log; `kill -USR2 <main pid>` writes it, then `tools/smoke/netlog-hosts.py /tmp/net.json` lists every host, URL and UDP target |
| `JOLLYBOAT_FAKE_PIPEWIRE=1` | pretends PipeWire/venmic is present (link/unlink only log) so the page side of screen-share audio can be tested |

A fake "server" for the preload checks is any static http server that answers `/info` with
`{"serverId":"x", ...}` and serves a page.
