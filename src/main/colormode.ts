// Light, dark or the system's for the server page (and with it the bar and the overlay, which
// follow the page). Chromium's own scheme (prefers-color-scheme, scrollbars, the pip window)
// follows too; the app's own windows declare `color-scheme: light` and stay the lcd look.

import { nativeTheme, webContents } from 'electron';
import { findServerByUrl, getSettings } from './settings';

export const applyColorMode = () => {
  const mode = getSettings().colorMode;
  nativeTheme.themeSource = mode === 'auto' ? 'system' : mode;
  // saved-server pages switch live (the preload does the rest)
  for (const wc of webContents.getAllWebContents()) {
    if (!wc.isDestroyed() && findServerByUrl(wc.getURL())) wc.send('shell:color-mode', mode);
  }
};
