// the lcd scheme: the one and only face of the app's own pages. the paper, sparks and strip read
// their colours from here; css has the same values as tokens in theme.css.

type TSchemeParams = {
  bg: [number, number, number];
  fg: [number, number, number];
  spark: [number, number, number];
  bgLum: number;
  lift: number;
  amp: number;
  lattice: number;
  glare: number;
  inkDir: 1 | -1;
};

export const LCD: TSchemeParams = {
  bg: [0xa6, 0xb0, 0x8a],
  fg: [0x1a, 0x22, 0x1c],
  spark: [0xec, 0xf4, 0xd4],
  bgLum: 0.68,
  lift: -0.008,
  amp: 0.05,
  lattice: -0.035,
  glare: 0.07,
  inkDir: -1
};
