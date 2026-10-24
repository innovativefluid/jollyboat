// The look of the app's own windows (setup, picker, prompt, bar, overlay): the lcd one, or the
// water one when the server page has the water theme. Light or dark comes from the colour mode
// (nativeTheme, so prefers-color-scheme in every page); the bar and the overlay follow the
// server page's own scheme on top of that.

import { nativeTheme, webContents } from 'electron';
import { isOwnPageUrl } from './paths';
import { findServerByUrl, getSettings } from './settings';

export type TLook = 'lcd' | 'water';

export const currentLook = (): TLook => (getSettings().theme === 'water' ? 'water' : 'lcd');

/** what a window shows before its page has painted: the page's own background colour */
export const windowBackground = (dark = nativeTheme.shouldUseDarkColors) =>
  currentLook() === 'water' ? (dark ? '#082a4c' : '#9fd8f6') : dark ? '#18201c' : '#a6b08a';

/** tells every open page of ours, and saved server pages whether the water runs behind them */
export const broadcastLook = () => {
  const look = currentLook();
  for (const wc of webContents.getAllWebContents()) {
    if (wc.isDestroyed()) continue;
    if (isOwnPageUrl(wc.getURL())) wc.send('shell:look', look);
    else if (findServerByUrl(wc.getURL())) wc.send('shell:water', look === 'water');
  }
};
