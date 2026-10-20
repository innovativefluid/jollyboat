# Third-party notices

Jollyboat is MIT licensed (see `LICENSE`). It ships with, or is built on, the following
third-party work. Each stays under its own license.

## Bundled in the app

| component | license | what it is |
|---|---|---|
| [Electron](https://github.com/electron/electron) | MIT, plus the licenses of Chromium and Node.js (`LICENSES.chromium.html` in the installed app) | the runtime |
| [electron-updater](https://github.com/electron-userland/electron-builder) | MIT | update checks on Windows |
| [ws](https://github.com/websockets/ws) | MIT | the WebSocket server of the built-in hotkey bridge |
| [venmic](https://github.com/Vencord/venmic) (`@vencord/venmic`, Linux only) | MPL-2.0 | routes other apps' sound into a virtual source for screen sharing on PipeWire. The prebuilt binary is redistributed unmodified; its source is at the link above, as required by MPL-2.0 §3.2. |
| [Pixelify Sans](https://github.com/eifetx/Pixelify-Sans) | SIL OFL 1.1 (`src/renderer/fonts/OFL-PixelifySans.txt`) | pixel typeface of the setup pages |
| [Jersey 10](https://github.com/scfried/soft-type-jersey) | SIL OFL 1.1 (`src/renderer/fonts/OFL-Jersey10.txt`) | counter typeface |
| [Fredoka](https://github.com/hafontia-zz/Fredoka) | SIL OFL 1.1 (`src/renderer/fonts/OFL-Fredoka.txt`) | body typeface |

## Protocols and services

- **Sharkord** ([sharkord.com](https://sharkord.com), MIT) is the chat server Jollyboat connects to. Jollyboat loads a
  server's own web client and speaks the hotkey-bridge protocol of the
  [official Sharkord Bridge](https://github.com/Sharkord/bridge). Jollyboat is an independent project and is not
  affiliated with or endorsed by the Sharkord team. "Sharkord" is their name, not ours.
- **Google's CDN** serves Chromium's spellcheck dictionaries. Jollyboat only contacts it when you turn spellcheck
  on in the privacy panel.
- **GitHub** hosts the releases that the Windows build checks for updates (can be turned off).

## Build tools (not shipped)

electron-builder (MIT), electron-vite (MIT), Vite (MIT), TypeScript (Apache-2.0), Pillow for the icon script (MIT-CMU).
