<p align="center"><img src="build/icons/128x128.png" width="96" alt=""></p>

# Jollyboat

A desktop client for [Sharkord](https://sharkord.com) servers, for Windows and Linux on x64 and ARM (macOS experimental). Not affiliated with Sharkord.

![setup screen](docs/launcher.png)

- **Screen sharing with sound** — everything you hear except your own call. On Linux the share is encoded on the GPU when it can be.
- **Global hotkeys and push-to-talk** — mute, deafen and push-to-talk from any window; set them in Sharkord's user settings (push-to-talk: pick it as the mic mode). Works on Wayland (KDE, GNOME 48+), where the desktop asks once.
- **Voice overlay** (optional) — who is in the call and who talks, on top of your game or other apps, with an adjustable background.
- **One bar on top** — server name, zoom, servers and settings, window buttons; light or dark with Sharkord.
- **Tray** — in voice, talking, muted, deafened, new messages. Closing the window minimizes, hides to the tray or quits.
- **Servers** — several, with proxy logins (basic auth), staying logged in, one that opens at start, and share codes.
- **Careful in calls** — asks before a reload or quit would drop you out of a call.
- **Private** — talks to your servers, plus GitHub for update checks (one switch to turn off). No telemetry. On Windows, push-to-talk needs a keyboard hook while a hotkey is set: keys are compared with your hotkeys and never stored or sent.

## Install

From [releases](../../releases):

| | |
|---|---|
| Windows (x64 or ARM) | `Jollyboat-x.y.z-windows-universal-setup.exe`, or portable: `Jollyboat-x.y.z-windows-x64-portable.exe` (`arm64`), settings in a `Jollyboat-data` folder next to it |
| Linux (x64 or ARM) | `flatpak install ./Jollyboat-x.y.z-linux-x64.flatpak` (or `linux-arm64`) |
| macOS 13+ (**experimental**) | `Jollyboat-x.y.z-mac-universal-EXPERIMENTAL.dmg` |

Add your server's address; if a proxy asks for a login first, tick **proxy login / basic auth**. On a server, **servers and settings** in the top bar (or ctrl+shift+s) opens this window again.

Tip: for GPU-encoded screen shares, pick H264 (or AV1 on newer GPUs) as the screen codec in Sharkord's settings, with simulcast off.

### macOS is experimental

CI builds it and checks that it starts on Intel and Apple Silicon, but nobody on the project has
used it on a real Mac. It is not signed by Apple, so the first open needs **System Settings →
Privacy & Security → Open Anyway**. It does not update itself (it tells you about new releases),
asks for permissions again after each update, and screen-share sound may include your own call.
Reports welcome.

## Build

```bash
npm install
npm run dev
npm run dist:win     # on Windows
npm run dist:linux   # unpacked app; the flatpak is built from source:
                     # flatpak-builder --user --install build-dir flatpak/net.innovativefluid.Jollyboat.yml
npm run dist:mac     # on a mac (experimental)
```

MIT — see [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
