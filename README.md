<p align="center"><img src="build/icons/128x128.png" width="96" alt=""></p>

# Jollyboat

A desktop client for [Sharkord](https://sharkord.com) servers, for Windows and Linux, on x64 and ARM. Not affiliated with Sharkord.

![setup screen](docs/launcher.png)

- **Screen sharing with sound** — everything you hear except your own call, so nobody hears themselves. Linux needs PipeWire.
- **Global hotkeys** — mute and deafen from any window; set them in Sharkord's user settings. Works on Wayland (KDE, GNOME 48+).
- **Tray** — shows in voice, talking, muted, deafened and new messages; closing the window minimizes, hides to the tray or quits — your choice; starts with the system.
- **Servers** — several at once, proxy logins, stays logged in, one that opens at start, share codes for friends.
- **Private** — talks to your servers, and to GitHub only for update checks (on by default, one switch to turn off). No telemetry; spellcheck (Google dictionaries) is off unless you turn it on.

## Install

From [releases](../../releases):

| | |
|---|---|
| Windows (x64 or ARM) | `Jollyboat-Setup-x.y.z.exe` |
| Linux | `flatpak install ./Jollyboat-x.y.z-x86_64.flatpak` (or `-aarch64`) |

Add your server's address; if a proxy asks for a login first, tick **proxy login / basic auth** and fill it in. On a server, the bar at the top (or ctrl+shift+s) brings back servers and settings.

## Build

```bash
npm install
npm run dev
npm run dist:win     # on Windows
npm run dist:linux   # needs flatpak-builder
```

MIT — see [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
