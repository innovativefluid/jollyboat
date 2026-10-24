// Light, dark or the system's for every window: the server page (and with it the bar and the
// overlay, which follow the page) and the app's own windows, through Chromium's own scheme
// (prefers-color-scheme, scrollbars, the pip window).

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
