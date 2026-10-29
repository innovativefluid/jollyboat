// The look of the app's own windows (setup, picker, prompt, bar, overlay): the lcd one, or the
// water one when the server page has the water theme. Light or dark comes from the colour mode
// (nativeTheme, so prefers-color-scheme in every page); the bar and the overlay follow the
// server page's own scheme on top of that.

import { nativeTheme, webContents } from 'electron';
import { isOwnPageUrl } from './paths';
import { isTinted, type TLook, type TPalette } from '../shared/types';
import { findServerByUrl, getSettings } from './settings';

export type { TLook, TPalette };

export const currentLook = (): TLook => {
  const { theme } = getSettings();
  return theme === 'water' ? 'water' : theme === 'retro' ? 'retro' : 'lcd';
};

/** the current theme's colours, picked beside the theme menu (lcd has none: blue, unused) */
export const currentPalette = (): TPalette => {
  const { theme, palettes } = getSettings();
  return isTinted(theme) ? palettes[theme] : 'blue';
};

// [light, dark] per theme and palette: the pool's middle, the retro desktop
const BACKGROUNDS = {
  water: { blue: ['#9fd8f6', '#06203c'], pink: ['#f7b6d8', '#2a0820'], mono: ['#e6e6e6', '#121212'] },
  retro: { pink: ['#f9c9e4', '#1c1029'], green: ['#9fe0c8', '#0b1f24'], grey: ['#a8acb4', '#1e1f24'] }
} as const;

/** what a window shows before its page has painted: the page's own background colour */
export const windowBackground = (dark = nativeTheme.shouldUseDarkColors) => {
  const look = currentLook();
  const palette = currentPalette();
  if (look === 'water') return BACKGROUNDS.water[palette as 'blue']?.[dark ? 1 : 0] ?? BACKGROUNDS.water.blue[dark ? 1 : 0];
  if (look === 'retro') return BACKGROUNDS.retro[palette as 'pink']?.[dark ? 1 : 0] ?? BACKGROUNDS.retro.pink[dark ? 1 : 0];
  return dark ? '#18201c' : '#a6b08a';
};

/** tells every open page of ours, and saved server pages whether the water runs behind them */
export const broadcastLook = () => {
  const look = currentLook();
  const palette = currentPalette();
  for (const wc of webContents.getAllWebContents()) {
    if (wc.isDestroyed()) continue;
    if (isOwnPageUrl(wc.getURL())) wc.send('shell:look', look, palette);
    else if (findServerByUrl(wc.getURL())) wc.send('shell:water', look === 'water', palette);
  }
};
