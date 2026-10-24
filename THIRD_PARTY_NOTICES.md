# Third-party notices

Jollyboat is MIT licensed (`LICENSE`). It ships with the following third-party work, each under its own license.

## Bundled in the app

| component | license | what it is |
|---|---|---|
| [Electron](https://github.com/electron/electron) | MIT, plus the licenses of Chromium and Node.js (`LICENSES.chromium.html` in the installed app) | the runtime |
| [electron-updater](https://github.com/electron-userland/electron-builder) | MIT | update checks on Windows |
| [ws](https://github.com/websockets/ws) | MIT | the WebSocket server of the built-in hotkey bridge |
| [venmic](https://github.com/Vencord/venmic) (Linux only) | MPL-2.0 | screen-share audio on PipeWire; unmodified, compiled from source in the flatpak build, source at the link (MPL §3.2) |
| [uiohook-napi](https://github.com/SnosMe/uiohook-napi) (Windows only) | MIT | keyboard hook for push-to-talk |
| [libuiohook](https://github.com/kwhat/libuiohook) (Windows only, inside uiohook-napi) | LGPL-3.0-or-later | the hook itself; unmodified, loaded at runtime from `resources/app.asar.unpacked/node_modules/uiohook-napi/prebuilds/` (that file can be replaced with your own build), source at the link |
| [Pixelify Sans](https://github.com/eifetx/Pixelify-Sans) | SIL OFL 1.1 (`src/renderer/fonts/OFL-PixelifySans.txt`) | pixel typeface of the setup pages |
| [Jersey 10](https://github.com/scfried/soft-type-jersey) | SIL OFL 1.1 (`src/renderer/fonts/OFL-Jersey10.txt`) | counter typeface |
| [Fredoka](https://github.com/hafontia-zz/Fredoka) | SIL OFL 1.1 (`src/renderer/fonts/OFL-Fredoka.txt`) | body typeface |
| [Nunito](https://github.com/googlefonts/nunito) | SIL OFL 1.1 (`src/renderer/fonts/OFL-Nunito.txt`) | typeface of the Water theme (Latin and Latin Extended subset) |

## Protocols and services

- **Sharkord** ([sharkord.com](https://sharkord.com), MIT): the server Jollyboat connects to, whose web client it loads and whose [bridge protocol](https://github.com/Sharkord/bridge) it speaks. Jollyboat is independent and not affiliated with the Sharkord team.
- **Google's CDN**: Chromium's spellcheck dictionaries, only if spellcheck is turned on.
- **GitHub**: release downloads and update checks (can be turned off; none in the Flathub build).

## Build tools (not shipped)

electron-builder (MIT), electron-vite (MIT), Vite (MIT), TypeScript (Apache-2.0), Pillow for the icon script (MIT-CMU), fontTools for the Nunito subset (MIT), SciPy for the Water theme's caustic tiles (BSD-3-Clause).
