<p align="center"><img src="build/icons/128x128.png" width="96" alt=""></p>

# jollyboat

A desktop client for [Sharkord](https://sharkord.com) servers, for Windows and Linux. Not affiliated with Sharkord.

![setup screen](docs/launcher.png)

- **Screen sharing with sound** — everything you hear except your own call, so nobody hears themselves. Linux needs PipeWire.
- **Global hotkeys** — mute and deafen from any window; set them in Sharkord's user settings. Works on Wayland (KDE, GNOME 48+).
- **Tray** — shows muted/deafened, marks new messages, closes to tray, starts with the system.
- **Servers** — several at once, proxy logins, one that opens at start, share codes for friends.
- **Private** — talks to your servers and nobody else. No telemetry. Spellcheck and update checks are off/opt-in.

## Install

From [releases](../../releases):

| | |
|---|---|
| Windows | `Jollyboat-Setup-x.y.z.exe` (updates itself) or the `.msi` (doesn't) |
| Linux | `flatpak install ./jollyboat-x.y.z.flatpak` |

Add your server's address; if a proxy asks for a login first, fill in the basic auth fields.

## Build

```bash
npm install
npm run dev
npm run dist:win     # on Windows
npm run dist:linux   # needs flatpak-builder
```

MIT — see [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
