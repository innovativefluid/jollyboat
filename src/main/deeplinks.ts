// sharkord:// links, the official Sharkord Desktop's format: sharkord://add-server?url=<encoded
// server address>. Sharkord's login screen shows one ("Add to desktop app") when it is not running
// in the official app, and a server owner can hand them out. Jollyboat opens its setup window
// with the address filled in (an invite in it comes along, see shared/invite.ts), or with the
// server already saved under that address.
//
// Who gets the links is the system's call: Windows and macOS keep one app per scheme. Jollyboat
// takes it when nobody has it (or it is already Jollyboat's), never from another app on its own;
// the setup window has a switch to take it over or give it back. On Linux the desktop entry
// declares the scheme (flatpak/*.desktop) and the desktop environment picks.

import { app } from 'electron';
import { log } from './log';

export const PROTOCOL = 'sharkord';
const ADD_SERVER = 'add-server';

/** the server address in a sharkord://add-server link (http(s) only), or null */
export const parseDeepLink = (link: string): string | null => {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  if (url.protocol !== `${PROTOCOL}:` || url.hostname !== ADD_SERVER) return null;
  const server = url.searchParams.get('url')?.trim() ?? '';
  try {
    const target = new URL(/^https?:\/\//i.test(server) ? server : `https://${server}`);
    if (!/^https?:$/.test(target.protocol) || !target.hostname) return null;
    return target.href.slice(0, 2000);
  } catch {
    return null;
  }
};

/** windows and linux hand the link over as a command line argument */
export const findDeepLink = (argv: readonly string[]) => argv.find((arg) => arg.toLowerCase().startsWith(`${PROTOCOL}://`));

// a portable windows build runs from a temporary copy: the link has to start the exe itself
const exePath = () => process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
// (macos registers the scheme through Info.plist, linux through the desktop entry)
const canRegister = () => app.isPackaged && process.platform === 'win32';

/** whether sharkord:// links open in Jollyboat; null where the system decides (linux, dev builds) */
export const ownsLinks = (): boolean | null => {
  if (process.platform === 'darwin') return app.isDefaultProtocolClient(PROTOCOL);
  if (!canRegister()) return null;
  return app.isDefaultProtocolClient(PROTOCOL, exePath(), []);
};

/** at start: take the scheme when nobody holds it (keeps a portable copy's path current) */
export const claimLinksIfFree = () => {
  if (!canRegister()) return;
  const holder = app.getApplicationNameForProtocol(`${PROTOCOL}://`);
  const ours = app.isDefaultProtocolClient(PROTOCOL, exePath(), []);
  if (ours || !holder) {
    const ok = app.setAsDefaultProtocolClient(PROTOCOL, exePath(), []);
    log('links', ok ? 'sharkord:// links open here' : 'could not register sharkord:// links');
  } else {
    log('links', `sharkord:// links open in ${holder}`);
  }
};

/** the setup window's switch: take the links over from another app, or give them back */
export const setOwnsLinks = (on: boolean) => {
  if (process.platform === 'darwin') {
    if (on) app.setAsDefaultProtocolClient(PROTOCOL);
    else app.removeAsDefaultProtocolClient(PROTOCOL);
  } else if (canRegister()) {
    if (on) app.setAsDefaultProtocolClient(PROTOCOL, exePath(), []);
    else app.removeAsDefaultProtocolClient(PROTOCOL, exePath(), []);
  }
  return ownsLinks();
};
