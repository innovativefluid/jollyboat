# Privacy policy

Jollyboat collects nothing about you and has no servers of its own. It sends no telemetry, no
crash reports and no usage statistics.

**What it connects to**

- **The Sharkord servers you add.** Jollyboat loads their web app, as a browser would. What those
  servers keep is up to whoever runs them.
- **GitHub, for updates** (api.github.com and github.com), while "check for updates on github" is
  on (setup window → privacy; on by default). Every six hours it asks for the list of releases,
  and when there is a newer one the Windows and AppImage builds download it from the release.
  GitHub sees your IP address and that a copy of Jollyboat is checking; nothing else is sent. Turn
  the switch off and Jollyboat does not contact GitHub at all. The Flathub build never checks:
  Flathub delivers its updates.
- **Google's dictionary download** (redirector.gvt1.com), only while "spellcheck" is on (off by
  default): the spellcheck dictionaries for your language. With the switch off this host is
  blocked inside the app.

**What stays on your computer**

Your server list, proxy logins (encrypted with the system's keyring where there is one), the
Sharkord login for each server, and the settings, in the app's data folder (or the
`Jollyboat-data` folder next to the portable exe). Nothing of it leaves your computer except to
the server it belongs to.

On Windows, push-to-talk uses a keyboard hook while a hotkey is set: keys are compared with your
hotkeys and never stored or sent.

**Third parties**

Jollyboat is built on [Electron](https://www.electronjs.org/) (Chromium). The components it
contains are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md); none of them send data
on their own. The pages of your Sharkord servers, and the plugins those servers run, follow their
own policies.
