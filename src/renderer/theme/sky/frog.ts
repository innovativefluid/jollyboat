// Pebble, the frog from the Pixel Sky design study (cheerful, sums things up): 32 x 32, built from
// shapes by the study's rules (light from the top left, `dark` on the lower right third, one
// outline pass in #1b1640 round every filled pixel, the head's chin line where it overlaps the
// body). Frames: head down a pixel (the breath), eyes open / closed / happy, mouth smile / open,
// arm down / up / up2 (a wave). Each frame is drawn once and kept.

const OUT = '#1b1640';
const WHITE = '#ffffff';
const CHEEK = '#ff7aa2';
const TONGUE = '#ff6f86';
const C = { base: '#5fd36a', dark: '#3aa653', light: '#97ec8e', cream: '#ecfbd9', creamD: '#cdeab4', inner: '#2a6e3a', paw: '#97ec8e' };

type TPal = string | { b: string; d: string; l: string };
export type TFrogFrame = { hd: 0 | 1; eyes: 'open' | 'closed' | 'happy'; mouth: 'smile' | 'open'; arm: 'down' | 'up' | 'up2' };

class Ras {
  p: (string | null)[];
  constructor(
    readonly w: number,
    readonly h: number
  ) {
    this.p = new Array(w * h).fill(null);
  }
  set(x: number, y: number, c: string) {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.p[y * this.w + x] = c;
  }
  get(x: number, y: number) {
    return x < 0 || y < 0 || x >= this.w || y >= this.h ? null : this.p[y * this.w + x];
  }
  rect(x: number, y: number, w: number, h: number, c: string) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }
  ell(cx: number, cy: number, rx: number, ry: number, pal: TPal, _shade = true, chin = false) {
    const low: Record<number, number> = {};
    for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++)
      for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        const d = dx * dx + dy * dy;
        if (d > 1) continue;
        let c: string;
        if (typeof pal === 'string') c = pal;
        else {
          const s = dx * 0.5 + dy * 0.85;
          c = s > 0.68 ? pal.d : s < -0.62 && d > 0.3 ? pal.l : pal.b;
        }
        if (chin && (low[x] === undefined || y > low[x])) low[x] = y;
        this.set(x, y, c);
      }
    if (chin) for (const x in low) if (this.get(+x, low[x] + 1)) this.set(+x, low[x] + 1, OUT);
  }
  outline() {
    const add: [number, number][] = [];
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++)
        if (!this.get(x, y) && (this.get(x - 1, y) || this.get(x + 1, y) || this.get(x, y - 1) || this.get(x, y + 1))) add.push([x, y]);
    for (const [x, y] of add) this.set(x, y, OUT);
  }
  canvas() {
    const c = document.createElement('canvas');
    c.width = this.w;
    c.height = this.h;
    const x = c.getContext('2d')!;
    for (let i = 0; i < this.p.length; i++) {
      const col = this.p[i];
      if (!col) continue;
      x.fillStyle = col;
      x.fillRect(i % this.w, (i / this.w) | 0, 1, 1);
    }
    return c;
  }
}

const happyEyes = (r: Ras, xs: number[], y: number) => {
  for (const x of xs) {
    r.set(x - 1, y + 2, OUT);
    r.set(x, y + 1, OUT);
    r.set(x + 1, y + 1, OUT);
    r.set(x + 2, y + 2, OUT);
  }
};

const frames = new Map<string, HTMLCanvasElement>();

/** one frame of the frog (32 x 32, feet on row 31), drawn once and kept */
export const frogFrame = (st: TFrogFrame) => {
  const key = `${st.hd}${st.eyes}${st.mouth}${st.arm}`;
  const have = frames.get(key);
  if (have) return have;
  const r = new Ras(32, 32);
  const hd = st.hd;
  const P = { b: C.base, d: C.dark, l: C.light };
  const Cr = { b: C.cream, d: C.creamD, l: C.cream };
  const armUp = st.arm !== 'down';
  const up2 = st.arm === 'up2';
  // feet, body and belly, the two eye bumps, the wide head
  r.ell(9.5, 30, 3.5, 1.7, C.dark, false);
  r.ell(22.5, 30, 3.5, 1.7, C.dark, false);
  r.ell(16, 25, 8.5, 5.5, P);
  r.ell(16, 26, 5.4, 3.5, Cr);
  r.ell(10, 9.5 + hd, 4.3, 4.3, P);
  r.ell(22, 9.5 + hd, 4.3, 4.3, P);
  r.ell(16, 16.5 + hd, 12, 6.8, P, true, true);
  if (armUp) {
    r.ell(up2 ? 4 : 4.5, up2 ? 15.5 : 18, 1.8, 2.2, P);
    r.ell(up2 ? 6 : 6.5, up2 ? 19.5 : 21.5, 1.5, 1.8, P);
  } else r.ell(8.5, 25.5, 1.7, 2.2, C.paw);
  r.ell(23.5, 25.5, 1.7, 2.2, C.paw);
  r.outline();
  // the face: eyes in the bumps, a wide smile, cheeks
  const lid = st.eyes === 'closed';
  r.ell(10, 9.5 + hd, 2.8, 2.8, lid ? C.light : WHITE, false);
  r.ell(22, 9.5 + hd, 2.8, 2.8, lid ? C.light : WHITE, false);
  if (st.eyes === 'open') {
    r.rect(9, 8 + hd, 2, 3, OUT);
    r.set(9, 8 + hd, WHITE);
    r.rect(21, 8 + hd, 2, 3, OUT);
    r.set(21, 8 + hd, WHITE);
  } else if (lid) {
    r.rect(8, 10 + hd, 4, 1, OUT);
    r.rect(20, 10 + hd, 4, 1, OUT);
  } else happyEyes(r, [9, 21], 8 + hd);
  r.set(10, 18 + hd, OUT);
  r.rect(11, 19 + hd, 10, 1, OUT);
  r.set(21, 18 + hd, OUT);
  if (st.mouth === 'open') {
    r.rect(12, 20 + hd, 8, 2, C.inner);
    r.rect(14, 21 + hd, 4, 1, TONGUE);
  }
  r.rect(6, 18 + hd, 2, 1, CHEEK);
  r.rect(24, 18 + hd, 2, 1, CHEEK);
  const c = r.canvas();
  frames.set(key, c);
  return c;
};
