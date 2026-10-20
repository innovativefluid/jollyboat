# Third-party notices

Jollyboat is MIT licensed (`LICENSE`). It ships with the following third-party work, each under its own license.

## Bundled in the app

| component | license | what it is |
|---|---|---|
| [Electron](https://github.com/electron/electron) | MIT, plus the licenses of Chromium and Node.js (`LICENSES.chromium.html` in the installed app) | the runtime |
| [electron-updater](https://github.com/electron-userland/electron-builder) | MIT | update checks on Windows |
| [ws](https://github.com/websockets/ws) | MIT | the WebSocket server of the built-in hotkey bridge |
| [venmic](https://github.com/Vencord/venmic) (Linux only) | MPL-2.0 | screen-share audio on PipeWire; prebuilt binary, unmodified, source at the link (MPL §3.2) |
| [Pixelify Sans](https://github.com/eifetx/Pixelify-Sans) | SIL OFL 1.1 (`src/renderer/fonts/OFL-PixelifySans.txt`) | pixel typeface of the setup pages |
| [Jersey 10](https://github.com/scfried/soft-type-jersey) | SIL OFL 1.1 (`src/renderer/fonts/OFL-Jersey10.txt`) | counter typeface |
| [Fredoka](https://github.com/hafontia-zz/Fredoka) | SIL OFL 1.1 (`src/renderer/fonts/OFL-Fredoka.txt`) | body typeface |

## Protocols and services

- **Sharkord** ([sharkord.com](https://sharkord.com), MIT): the server Jollyboat connects to, whose web client it loads and whose [bridge protocol](https://github.com/Sharkord/bridge) it speaks. Jollyboat is independent and not affiliated with the Sharkord team.
- **Google's CDN**: Chromium's spellcheck dictionaries, only if spellcheck is turned on.
- **GitHub**: release downloads and, on Windows, update checks (can be turned off).

## Build tools (not shipped)

electron-builder (MIT), electron-vite (MIT), Vite (MIT), TypeScript (Apache-2.0), Pillow for the icon script (MIT-CMU).
