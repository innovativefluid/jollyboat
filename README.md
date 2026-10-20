<p align="center"><img src="build/icons/128x128.png" width="96" alt=""></p>

# jollyboat

A desktop client for [Sharkord](https://sharkord.com) servers, for Windows and Linux.

Jollyboat opens your server's own Sharkord web app inside a small Electron shell and adds the things a
browser can't do: screen sharing with sound, global hotkeys, a tray icon that knows whether you're
muted, and nothing that talks to anyone but your server.

> Jollyboat is an independent project. It is not affiliated with or endorsed by the Sharkord team.

![the setup screen](docs/launcher.png)

## What it does

- **Screen sharing with sound.** Everything you hear, except Jollyboat's own audio, so nobody hears
  themselves. Windows uses Chromium's own-audio-excluding loopback (Windows 10 22H2 or newer); Linux with
  PipeWire routes every other app's sound through a virtual source ([venmic](https://github.com/Vencord/venmic),
  bundled); Linux without PipeWire falls back to capturing the default output. Resolution, frame rate and
  bitrate stay Sharkord's own settings.
- **Global hotkeys.** A built-in implementation of Sharkord's hotkey bridge, paired automatically. Bind
  mute and deafen in Sharkord under *user settings → hotkeys*. Works on Windows, X11 and Wayland (KDE Plasma
  and recent GNOME, through the desktop portal). Push-to-talk needs key-release events and is not available yet.
- **Tray.** Mic-muted and deafened states in the icon, mute/deafen from the menu, an unread marker and a window
  flash for new messages, close-to-tray, start with the system.
- **Servers.** Several servers, HTTP basic auth for ones behind a reverse proxy (passwords in the OS keychain),
  a server that opens at start, share codes and files to hand a server config to a friend.
- **Privacy.** No telemetry, no crash reports, no Google services. Spellcheck is off by default because
  Chromium would fetch its dictionaries from Google's CDN; it's a toggle. On Windows the update check against
  GitHub Releases is a toggle too. The only other things the app talks to are the servers you add.

## Install

Builds are attached to [GitHub Releases](../../releases).

| platform | file | notes |
|---|---|---|
| Windows 10 22H2 / 11 | `Jollyboat-Setup-x.y.z.exe` | installs per user and updates itself |
| Windows | `Jollyboat-x.y.z.msi` | for people who want an MSI; does **not** update itself |
| Linux | `jollyboat-x.y.z.flatpak` | `flatpak install ./jollyboat-x.y.z.flatpak`; needs the Freedesktop 24.08 runtime |

Then add your server's address. If the server sits behind a proxy that asks for a username and password before
Sharkord loads, put those in the server's basic-auth fields.

### Linux notes

- Screen sharing with sound needs PipeWire (the default on Fedora, Ubuntu 22.10+, Debian 12+). In a call, check
  once that the other side does not hear themselves; if they do, your session may be routing audio in a way
  venmic can't see — please open an issue with `JOLLYBOAT_DEBUG=1` output.
- Hotkeys on Wayland go through the GlobalShortcuts portal: KDE Plasma lists them in System Settings →
  Shortcuts; GNOME 48+ asks once; desktops without the portal get no global hotkeys.
- Basic-auth passwords are encrypted with the system keyring (KWallet, GNOME Keyring). Without one the setup
  screen says so and stores them unencrypted.

## Build

```bash
npm install
npm run dev          # electron with hot reload
npm run typecheck
npm run dist:win     # NSIS + MSI (run on Windows)
npm run dist:linux   # flatpak (needs flatpak-builder and org.electronjs.Electron2.BaseApp//24.08)
```

`tools/make-icons.py` regenerates every icon from the pixel maps in `build/pixel/`. `tools/smoke/` has the
headless checks used during development (Xvfb + the DevTools protocol).

## License

MIT, see [LICENSE](LICENSE). Bundled third-party work and its licenses are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
