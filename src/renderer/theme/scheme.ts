// the lcd scheme in its two faces, light and the neg (dark). the paper, sparks and strip read
// their colours from here; css has the same values as tokens in theme.css. dark follows the
// page's data-theme (bar, overlay) or else the colour mode (prefers-color-scheme).

type TRgb = [number, number, number];

export type TLcdScheme = {
  bg: TRgb;
  fg: TRgb;
  spark: TRgb;
  bgLum: number;
  lift: number;
  amp: number;
  lattice: number;
  glare: number;
  /** light: ink darkens the paper (-1). dark: ink is mixed in as its own colour */
  inkDir: 1 | -1;
  /** the boat's map: '#' outline, 'g' hull, 'w' sail, as ink units (negative brightens) */
  boatInk: Record<string, number>;
};

export const LCD: TLcdScheme = {
  bg: [0xa6, 0xb0, 0x8a],
  fg: [0x1a, 0x22, 0x1c],
  spark: [0xec, 0xf4, 0xd4],
  bgLum: 0.68,
  lift: -0.008,
  amp: 0.05,
  lattice: -0.035,
  glare: 0.07,
  inkDir: -1,
  boatInk: { '#': 60, g: 32, w: -22 }
};

export const LCD_DARK: TLcdScheme = {
  bg: [0x18, 0x20, 0x1c],
  fg: [0xc4, 0xd6, 0xa6],
  spark: [0xec, 0xf8, 0xce],
  bgLum: 0.14,
  lift: 0,
  amp: 0.022,
  lattice: -0.014,
  glare: 0.022,
  inkDir: 1,
  boatInk: { '#': 60, g: 22, w: 34 }
};

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

export const isDark = () => {
  const theme = document.documentElement.dataset.theme;
  return theme ? theme === 'dark' : darkQuery.matches;
};

export const lcdScheme = () => (isDark() ? LCD_DARK : LCD);

/** calls back when light / dark may have changed (the colour mode or the page's data-theme) */
export const onSchemeChange = (cb: () => void) => {
  darkQuery.addEventListener('change', cb);
  new MutationObserver(cb).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
};
