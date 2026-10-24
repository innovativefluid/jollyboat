// the aqua glass look's tokens (design_handoff_aqua.md §3): `day` is the light scheme, `deep`
// the dark one. every colour of the water, the glass and the fizz comes from here; css has the
// same values in water.css.

import { isDark } from '../scheme';

type TRgb = [number, number, number];

export type TWaterTokens = {
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
  poolTop: hex('#0f416c'),
  poolMid: hex('#082a4c'),
  poolBot: hex('#020c1a'),
  light: hex('#86e2ff'),
  lightA: 0.55,
  sky: hex('#1e5f92'),
  skyA: 0.65,
  bubble: hex('#a5e8ff'),
  bubbleA: 0.85,
  caustics: 0.75,
  sun: 0.75,
  fg: hex('#e4f5ff'),
  dim: hex('#9cc5e2'),
  glass: hex('#0d2a46'),
  glassA: 0.64,
  well: hex('#071a2e'),
  wellA: 0.66,
  btn: hex('#14406a'),
  btnA: 0.42,
  edge: hex('#8fd8ff'),
  edgeA: 0.34,
  liqA: hex('#4fcfff'),
  liqB: hex('#0a48a6'),
  shade: hex('#00060f'),
  shadeA: 0.55,
  glow: hex('#3fd4ff'),
  glowA: 0.8,
  spark: hex('#d8f6ff'),
  irid: 0.45
};

export const waterTokens = () => (isDark() ? DEEP : DAY);

/** a token as 0..1 floats, for a shader */
export const unit = (c: TRgb) => [c[0] / 255, c[1] / 255, c[2] / 255] as const;

export const css = (c: TRgb, a = 1) => (a >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`);
