// the aqua glass look's tokens (design_handoff_aqua.md §3): `day` is the light scheme, `deep`
// the dark one. every colour of the water, the glass and the fizz comes from here; css has the
// same values in water.css.

import { isDark } from '../scheme';

type TRgb = [number, number, number];

export type TWaterTokens = {
  /** the light scheme (day) or the dark one (deep) */
  day: boolean;
  poolTop: TRgb;
  poolMid: TRgb;
  poolBot: TRgb;
  light: TRgb;
  lightA: number;
  sky: TRgb;
  skyA: number;
  bubble: TRgb;
  bubbleA: number;
  caustics: number;
  sun: number;
  fg: TRgb;
  dim: TRgb;
  glass: TRgb;
  glassA: number;
  well: TRgb;
  wellA: number;
  btn: TRgb;
  btnA: number;
  edge: TRgb;
  edgeA: number;
  liqA: TRgb;
  liqB: TRgb;
  shade: TRgb;
  shadeA: number;
  glow: TRgb;
  glowA: number;
  spark: TRgb;
  irid: number;
};

const hex = (h: string): TRgb => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

export const DAY: TWaterTokens = {
  day: true,
  poolTop: hex('#e8f6ff'),
  poolMid: hex('#9fd8f6'),
  poolBot: hex('#2f88d8'),
  light: hex('#ffffff'),
  lightA: 0.8,
  sky: hex('#e4f5ff'),
  skyA: 1,
  bubble: hex('#2b78bd'),
  bubbleA: 0.95,
  caustics: 0.8,
  sun: 1,
  fg: hex('#0a2f52'),
  dim: hex('#335c7c'),
  glass: hex('#f2f9ff'),
  glassA: 0.54,
  well: hex('#ffffff'),
  wellA: 0.62,
  btn: hex('#ffffff'),
  btnA: 0.34,
  edge: hex('#2a6aa3'),
  edgeA: 0.42,
  liqA: hex('#5cc0f7'),
  liqB: hex('#0757c2'),
  shade: hex('#0b4a86'),
  shadeA: 0.3,
  glow: hex('#46cdff'),
  glowA: 0.7,
  spark: hex('#ffffff'),
  irid: 0.35
};

export const DEEP: TWaterTokens = {
  day: false,
  poolTop: hex('#0b3358'),
  poolMid: hex('#06203c'),
  poolBot: hex('#010812'),
  light: hex('#86e2ff'),
  lightA: 0.5,
  sky: hex('#1a527f'),
  skyA: 0.55,
  bubble: hex('#a5e8ff'),
  bubbleA: 0.85,
  caustics: 0.7,
  sun: 0.62,
  fg: hex('#e4f5ff'),
  dim: hex('#9cc5e2'),
  glass: hex('#0a2138'),
  glassA: 0.66,
  well: hex('#051425'),
  wellA: 0.7,
  btn: hex('#103458'),
  btnA: 0.44,
  edge: hex('#8fd8ff'),
  edgeA: 0.34,
  liqA: hex('#4fcfff'),
  liqB: hex('#0a48a6'),
  shade: hex('#00050c'),
  shadeA: 0.6,
  glow: hex('#3fd4ff'),
  glowA: 0.8,
  spark: hex('#d8f6ff'),
  irid: 0.45
};

// the other palettes: pink water, and black and white (white water by day, black by night)
const PINK_DAY: TWaterTokens = {
  day: true,
  poolTop: hex('#fff0f7'),
  poolMid: hex('#f7b6d8'),
  poolBot: hex('#d8458f'),
  light: hex('#ffffff'),
  lightA: 0.8,
  sky: hex('#ffe8f4'),
  skyA: 1,
  bubble: hex('#c22d7e'),
  bubbleA: 0.95,
  caustics: 0.8,
  sun: 1,
  fg: hex('#4a0f2e'),
  dim: hex('#7c3a5c'),
  glass: hex('#fff5fa'),
  glassA: 0.54,
  well: hex('#ffffff'),
  wellA: 0.62,
  btn: hex('#ffffff'),
  btnA: 0.34,
  edge: hex('#b33a78'),
  edgeA: 0.42,
  liqA: hex('#ff8cc8'),
  liqB: hex('#c2187a'),
  shade: hex('#861450'),
  shadeA: 0.3,
  glow: hex('#ff6fc0'),
  glowA: 0.7,
  spark: hex('#ffffff'),
  irid: 0.35
};

const PINK_DEEP: TWaterTokens = {
  day: false,
  poolTop: hex('#4a0f33'),
  poolMid: hex('#2a0820'),
  poolBot: hex('#0d0208'),
  light: hex('#ffa3d6'),
  lightA: 0.5,
  sky: hex('#6e1a4f'),
  skyA: 0.55,
  bubble: hex('#ffb3e0'),
  bubbleA: 0.85,
  caustics: 0.7,
  sun: 0.62,
  fg: hex('#ffe8f5'),
  dim: hex('#e0a6c8'),
  glass: hex('#2a0b20'),
  glassA: 0.66,
  well: hex('#1a0614'),
  wellA: 0.7,
  btn: hex('#4a1638'),
  btnA: 0.44,
  edge: hex('#ff9fd4'),
  edgeA: 0.34,
  liqA: hex('#ff7fc8'),
  liqB: hex('#a8166a'),
  shade: hex('#0c0007'),
  shadeA: 0.6,
  glow: hex('#ff5fbf'),
  glowA: 0.8,
  spark: hex('#ffd8ef'),
  irid: 0.45
};

const MONO_DAY: TWaterTokens = {
  day: true,
  poolTop: hex('#ffffff'),
  poolMid: hex('#e6e6e6'),
  poolBot: hex('#9a9a9a'),
  light: hex('#ffffff'),
  lightA: 0.8,
  sky: hex('#f4f4f4'),
  skyA: 1,
  bubble: hex('#5a5a5a'),
  bubbleA: 0.95,
  caustics: 0.6,
  sun: 1,
  fg: hex('#141414'),
  dim: hex('#4a4a4a'),
  glass: hex('#ffffff'),
  glassA: 0.54,
  well: hex('#ffffff'),
  wellA: 0.62,
  btn: hex('#ffffff'),
  btnA: 0.34,
  edge: hex('#5a5a5a'),
  edgeA: 0.42,
  liqA: hex('#8c8c8c'),
  liqB: hex('#2e2e2e'),
  shade: hex('#333333'),
  shadeA: 0.3,
  glow: hex('#9a9a9a'),
  glowA: 0.6,
  spark: hex('#ffffff'),
  irid: 0.12
};

const MONO_DEEP: TWaterTokens = {
  day: false,
  poolTop: hex('#2a2a2a'),
  poolMid: hex('#121212'),
  poolBot: hex('#000000'),
  light: hex('#e0e0e0'),
  lightA: 0.45,
  sky: hex('#3a3a3a'),
  skyA: 0.55,
  bubble: hex('#d0d0d0'),
  bubbleA: 0.85,
  caustics: 0.6,
  sun: 0.62,
  fg: hex('#f2f2f2'),
  dim: hex('#b4b4b4'),
  glass: hex('#141414'),
  glassA: 0.66,
  well: hex('#0a0a0a'),
  wellA: 0.7,
  btn: hex('#2a2a2a'),
  btnA: 0.44,
  edge: hex('#d8d8d8'),
  edgeA: 0.3,
  liqA: hex('#bdbdbd'),
  liqB: hex('#5c5c5c'),
  shade: hex('#000000'),
  shadeA: 0.6,
  glow: hex('#ffffff'),
  glowA: 0.6,
  spark: hex('#f0f0f0'),
  irid: 0.15
};

const PALETTES: Record<string, [TWaterTokens, TWaterTokens]> = { blue: [DAY, DEEP], pink: [PINK_DAY, PINK_DEEP], mono: [MONO_DAY, MONO_DEEP] };

/** the water's tokens for a palette (blue, pink or mono), light or dark */
export const waterTokensFor = (palette: string | undefined, dark: boolean) => (PALETTES[palette ?? 'blue'] ?? PALETTES.blue)[dark ? 1 : 0];

/** the app's own pages: the palette is on <html data-palette> */
export const waterTokens = () => waterTokensFor(document.documentElement.dataset.palette, isDark());

/** a token as 0..1 floats, for a shader */
export const unit = (c: TRgb) => [c[0] / 255, c[1] / 255, c[2] / 255] as const;

export const css = (c: TRgb, a = 1) => (a >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`);
