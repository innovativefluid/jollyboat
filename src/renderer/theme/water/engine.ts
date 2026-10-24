// the water look's renderer, as in the aquacard design study: a ripple simulation, the lit water
// rendered once per frame into a mipmapped texture, then glass elements on screen that sample
// that texture to refract and frost what is behind them.
//
// it knows nothing about pages: a scene callback hands it, every frame, the glass to draw (in
// css px, y down) — `stage` glass is drawn into the water itself (the boat and its waves, so the
// panels above frost them too), `items` on screen in order (panels, then controls, the title,
// pearl strings). the app's own windows build that scene from their dom (glass-dom.ts), the
// sharkord page from its layout (preload).
//
// per frame: up to two simulation steps (one fragment per 5 × 5 px cell), the water at up to
// 1.5 × device px (less with `scale`, and less again when frames run long), a mipmap, one quad
// per glass element. hidden: nothing. reduced motion: the clock stops, four still frames a second.

import { BLIT_FS, GLASS_FS, PEARLS_FS, SIM_FS, TITLE_FS, VS_FULL, VS_QUAD, WATER_FS } from './shaders';
import type { TWaterTokens } from './tokens';

const CELL = 5;
const BUBBLES = 14;

export type TRgba = [number, number, number, number];

export type TGlass = {
  type: 'glass';
  /** 0 rounded box, 1 the boat's hull, 2 its sail, 3 a wave line */
  kind: 0 | 1 | 2 | 3;
  /** the shape's box, css px, y down */
  x: number;
  y: number;
  w: number;
  h: number;
  pad: number;
  radii: [number, number, number, number];
  bevel: number;
  refr: number;
  frost: number;
  tint: TRgba;
  edge: TRgba;
  gloss: number;
  streaks: number;
  irid: number;
  shade: TRgba;
  lift: number;
  glow: TRgba;
  halo: number;
  inset: number;
  hover: number;
  press: number;
  seed: number;
  wobble: number;
  jiggle: TRgba;
  liqA: TRgba;
  liqB: TRgba;
  /** level, mode (0 none, 1 rises, 2 fills from the left), wave px, speed */
  liquid: TRgba;
  slosh: number;
  flow: number;
  alpha: number;
  /** css px, y down: x0, y0, x1, y1 */
  clip: TRgba | null;
  /** hull / sail: px per icon unit, centre in icon units, rotation */
  shapeA?: TRgba;
  /** wave line: effect x in the window, base y in the effect, index, thickness */
  wave?: TRgba;
};

export type TTitle = {
  type: 'title';
  /** the effect box, css px (text box + pad on every side) */
  x: number;
  y: number;
  w: number;
  h: number;
  pad: number;
  mask: HTMLCanvasElement;
  maskKey: string;
  level: number;
  slosh: number;
  alpha: number;
  glassCol: TRgba;
  liqA: TRgba;
  liqB: TRgba;
  haloCol: TRgba;
  shadeCol: TRgba;
  edgeCol: TRgba;
  clip: TRgba | null;
};

export type TPearls = {
  type: 'pearls';
  x: number;
  y: number;
  w: number;
  h: number;
  seed: number;
  drift: number;
  alpha: number;
  rimCol: TRgba;
  bodyCol: TRgba;
  fillCol: TRgba;
  clip: TRgba | null;
};

export type TItem = TGlass | TTitle | TPearls;
export type TScene = { stage: TGlass[]; items: TItem[]; /** where the pointer leaves no wake: the panels */ solid: TRgba[] };

export type TWaterOptions = {
  tokens: () => TWaterTokens;
  scene: (time: number) => TScene;
  /** resolution of the glass, times min(device px, 1.5) */
  scale?: number;
  /** resolution of the water under it, as a share of that (it is mostly seen through frost) */
  waterScale?: number;
  fps?: { focused: number; blurred: number };
  /** whether the window has focus (default: this document's; the server window's two views
   * share one window, so they are told) */
  focused?: () => boolean;
  /** the pointer's wake under the glass, as a share of the one over open water (default 0) */
  glassWake?: number;
  /** after each drawn frame, with the clock (the bar's mark moves along) */
  onFrame?: (time: number) => void;
  bubbles?: number;
  /** the pool's gradient spans this (a bar takes the window's), and the canvas sits here in it */
  pool?: () => { view: [number, number]; offset: [number, number] };
  /** an air bubble popped (strong: clicked) */
  onPop?: (x: number, y: number, strong: boolean, r: number) => void;
  /** software renderers are refused unless this says yes */
  allowSoftware?: boolean;
  /** css zoom on the page's root (the bar zooms that way): the canvas is sized against it */
  zoom?: () => number;
};

export type TWater = {
  stop: () => void;
  ripple: (x: number, y: number, amp: number, radius?: number) => void;
  popAt: (x: number, y: number) => boolean;
  /** the clock the glass runs on (seconds) */
  time: () => number;
  /** the page changed size without a resize event (css zoom) */
  resize: () => void;
  pointer: () => { x: number; y: number };
};

type TProg = { prog: WebGLProgram; u: (name: string) => WebGLUniformLocation | null };

const compile = (gl: WebGL2RenderingContext, vs: string, fs: string): TProg => {
  const make = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
    return s;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, make(gl.VERTEX_SHADER, vs));
  gl.attachShader(prog, make(gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(prog, 0, 'aPos');
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link');
  const locs = new Map<string, WebGLUniformLocation | null>();
  return {
    prog,
    u: (name) => {
      if (!locs.has(name)) locs.set(name, gl.getUniformLocation(prog, name));
      return locs.get(name)!;
    }
  };
};

const rgba = (c: [number, number, number], a = 1): TRgba => [c[0] / 255, c[1] / 255, c[2] / 255, a];

export const createWater = (canvas: HTMLCanvasElement, opts: TWaterOptions): TWater | null => {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, premultipliedAlpha: true, powerPreference: 'low-power' });
  if (!gl) return null;

  // a software renderer (no gpu, or one chromium refuses) would spend whole cores on this
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  if (/swiftshader|llvmpipe|softpipe|software/i.test(renderer) && !opts.allowSoftware) {
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return null;
  }

  let sim: TProg, water: TProg, glass: TProg, title: TProg, pearls: TProg, blit: TProg;
  try {
    sim = compile(gl, VS_FULL, SIM_FS);
    water = compile(gl, VS_FULL, WATER_FS);
    glass = compile(gl, VS_QUAD, GLASS_FS);
    title = compile(gl, VS_QUAD, TITLE_FS);
    pearls = compile(gl, VS_QUAD, PEARLS_FS);
    blit = compile(gl, VS_FULL, BLIT_FS);
  } catch (err) {
    console.warn('water:', (err as Error).message);
    return null;
  }
  // rgba16f render targets for the simulation; without them nothing ripples
  const simOn = !!gl.getExtension('EXT_color_buffer_float');

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const fps = opts.fps ?? { focused: 60, blurred: 30 };
  const focused = opts.focused ?? (() => document.hasFocus());
  const glassWake = opts.glassWake ?? 0;

  // ---- targets -----------------------------------------------------------------------------

  let W = 1;
  let H = 1;
  let scale = 1;
  let quality = 1;
  let cw = 1;
  let ch = 1;
  let ww = 1;
  let wh = 1;
  let gw = 0;
  let gh = 0;
  const tex = (w: number, h: number, internal: number, type: number, mip: boolean) => {
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, gl.RGBA, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  const fbo = (t: WebGLTexture) => {
    const f = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return f;
  };
  // A: the water; B: the water with the boat and waves on it (what glass refracts)
  let texA: WebGLTexture | null = null;
  let texB: WebGLTexture | null = null;
  let fboA: WebGLFramebuffer | null = null;
  let fboB: WebGLFramebuffer | null = null;
  let simTex: WebGLTexture[] = [];
  let simFbo: WebGLFramebuffer[] = [];
  let simCur = 0;

  // B only exists where there is a stage (the setup window's boat)
  const makeB = () => {
    texB = tex(ww, wh, gl.RGBA8, gl.UNSIGNED_BYTE, true);
    fboB = fbo(texB);
  };
  const resize = () => {
    W = Math.max(1, window.innerWidth);
    H = Math.max(1, window.innerHeight);
    scale = Math.min(window.devicePixelRatio || 1, 1.5) * (opts.scale ?? 1) * quality;
    cw = Math.max(1, Math.round(W * scale));
    ch = Math.max(1, Math.round(H * scale));
    canvas.width = cw;
    canvas.height = ch;
    ww = Math.max(1, Math.round(cw * (opts.waterScale ?? 1)));
    wh = Math.max(1, Math.round(ch * (opts.waterScale ?? 1)));
    const z = opts.zoom?.() || 1;
    canvas.style.width = `${W / z}px`;
    canvas.style.height = `${H / z}px`;
    const hadB = !!texB;
    [texA, texB].forEach((t) => t && gl.deleteTexture(t));
    [fboA, fboB].forEach((f) => f && gl.deleteFramebuffer(f));
    texA = tex(ww, wh, gl.RGBA8, gl.UNSIGNED_BYTE, true);
    fboA = fbo(texA);
    texB = null;
    fboB = null;
    if (hadB) makeB();
    if (simOn) {
      const nw = Math.max(16, Math.ceil(W / CELL));
      const nh = Math.max(16, Math.ceil(H / CELL));
      if (nw !== gw || nh !== gh) {
        gw = nw;
        gh = nh;
        simTex.forEach((t) => gl.deleteTexture(t));
        simFbo.forEach((f) => gl.deleteFramebuffer(f));
        simTex = [0, 1].map(() => tex(gw, gh, gl.RGBA16F, gl.HALF_FLOAT, false));
        simFbo = simTex.map(fbo);
        for (const f of simFbo) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, f);
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }
    }
  };

  // ---- pointer, drops, bubbles -------------------------------------------------------------

  const ptr = { x: -9999, y: -9999 };
  let lastPtr = { x: -9999, y: -9999 };
  const drops: TRgba[] = [];
  let solid: TRgba[] = [];
  const ripple = (x: number, y: number, amp: number, radius = 6) => {
    if (!simOn || reduce.matches) return;
    drops.push([x / CELL, y / CELL, radius, amp]);
    if (drops.length > 24) drops.shift();
  };
  const onMove = (e: PointerEvent) => {
    ptr.x = e.clientX;
    ptr.y = e.clientY;
  };
  const onLeave = () => {
    ptr.x = -9999;
    ptr.y = -9999;
  };
  const overSolid = (x: number, y: number) => solid.some((r) => x >= r[0] - 6 && y >= r[1] - 6 && x <= r[2] + 6 && y <= r[3] + 6);

  type TBub = { x: number; y: number; r: number; vx: number; vy: number; age: number; life: number; ph: number };
  const bubCount = opts.bubbles ?? BUBBLES;
  const bubs: TBub[] = [];
  const seedBubble = (b: TBub, anywhere: boolean) => {
    const big = Math.random() < 0.18;
    b.r = big ? 18 + Math.random() * 14 : 5 + Math.random() * 11;
    b.x = Math.random() * W;
    b.y = anywhere ? Math.random() * H : H + b.r + Math.random() * 120;
    b.vx = 0;
    b.vy = -(14 + b.r * 1.3);
    b.age = 0;
    b.life = 7 + Math.random() * 16;
    b.ph = Math.random() * 6.283;
    return b;
  };
  const pop = (b: TBub, strong: boolean) => {
    ripple(b.x, b.y, strong ? -1.1 : -0.55, Math.max(3, (b.r / CELL) * 0.9));
    opts.onPop?.(b.x, b.y, strong, b.r);
    seedBubble(b, false);
  };
  const popAt = (x: number, y: number) => {
    const b = bubs.find((b) => Math.hypot(b.x - x, b.y - y) < b.r + 6);
    if (!b) return false;
    pop(b, true);
    return true;
  };
  const bubF = new Float32Array(BUBBLES * 4);
  const stepBubbles = (dt: number, t: number) => {
    while (bubs.length < bubCount) bubs.push(seedBubble({} as TBub, true));
    bubF.fill(0);
    bubs.forEach((b, i) => {
      b.age += dt;
      const rise = -(14 + b.r * 1.3);
      b.vy += (rise - b.vy) * Math.min(1, dt * 1.4);
      b.vx += Math.sin(t * 0.9 + b.ph) * 9 * dt;
      const dx = b.x - ptr.x;
      const dy = b.y - ptr.y;
      const d = Math.hypot(dx, dy);
      const reach = b.r + 70;
      if (d < reach && d > 0.01) {
        const f = 1 - d / reach;
        b.vx += (dx / d) * f * f * 1400 * dt;
        b.vy += (dy / d) * f * f * 1400 * dt;
      }
      b.vx *= Math.exp(-dt * 1.6);
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.x < -b.r) b.x += W + 2 * b.r;
      if (b.x > W + b.r) b.x -= W + 2 * b.r;
      const fadeIn = Math.min(1, b.age / 1.2);
      const fadeOut = b.age > b.life ? Math.max(0, 1 - (b.age - b.life) / 0.25) : 1;
      if (b.age > b.life + 0.25 || b.y < -b.r * 2) pop(b, false);
      bubF.set([b.x, b.y, b.r * (b.age > b.life ? 1 + (b.age - b.life) * 0.8 : 1), fadeIn * fadeOut], i * 4);
    });
  };

  // ---- drawing -----------------------------------------------------------------------------

  const titleTex = new Map<string, WebGLTexture>();
  const maskTexture = (t: TTitle) => {
    let tx = titleTex.get(t.maskKey);
    if (tx) return tx;
    titleTex.forEach((old) => gl.deleteTexture(old));
    titleTex.clear();
    tx = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tx);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, t.mask);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    titleTex.set(t.maskKey, tx);
    return tx;
  };

  const scissor = (clip: TRgba | null, k = scale, w = cw, h = ch) => {
    if (!clip) {
      gl.disable(gl.SCISSOR_TEST);
      return true;
    }
    const x0 = Math.max(0, Math.floor(clip[0] * k));
    const x1 = Math.min(w, Math.ceil(clip[2] * k));
    const y0 = Math.max(0, Math.floor((H - clip[3]) * k));
    const y1 = Math.min(h, Math.ceil((H - clip[1]) * k));
    if (x1 <= x0 || y1 <= y0) return false;
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(x0, y0, x1 - x0, y1 - y0);
    return true;
  };

  const drawGlass = (g: TGlass, t: number, bg: WebGLTexture, sw: number, sh: number) => {
    const u = glass.u;
    gl.uniform4f(u('uQuad'), g.x - g.pad, g.y - g.pad, g.w + 2 * g.pad, g.h + 2 * g.pad);
    gl.uniform2f(u('uView'), W, H);
    gl.uniform2f(u('size'), g.w + 2 * g.pad, g.h + 2 * g.pad);
    gl.uniform1f(u('pad'), g.pad);
    gl.uniform4fv(u('radii'), g.radii);
    gl.uniform1f(u('hover'), g.hover);
    gl.uniform1f(u('press'), g.press);
    gl.uniform1f(u('time'), t);
    gl.uniform1f(u('seed'), g.seed);
    gl.uniform1f(u('wobble'), reduce.matches ? 0 : g.wobble);
    gl.uniform4fv(u('jiggle'), g.jiggle);
    gl.uniform1f(u('bevel'), g.bevel);
    gl.uniform1f(u('refr'), g.refr);
    gl.uniform1f(u('frost'), g.frost);
    gl.uniform4fv(u('tint'), g.tint);
    gl.uniform4fv(u('edge'), g.edge);
    gl.uniform1f(u('gloss'), g.gloss);
    gl.uniform1f(u('streaks'), g.streaks);
    gl.uniform1f(u('irid'), g.irid);
    gl.uniform4fv(u('shade'), g.shade);
    gl.uniform1f(u('lift'), g.lift);
    gl.uniform4fv(u('glow'), g.glow);
    gl.uniform1f(u('halo'), g.halo);
    gl.uniform1f(u('inset'), g.inset);
    gl.uniform4fv(u('liqA'), g.liqA);
    gl.uniform4fv(u('liqB'), g.liqB);
    gl.uniform4fv(u('liquid'), g.liquid);
    gl.uniform1f(u('slosh'), g.slosh);
    gl.uniform1f(u('flow'), reduce.matches ? 0 : g.flow);
    gl.uniform2f(u('screen'), sw, sh);
    gl.uniform1f(u('alpha'), g.alpha);
    gl.uniform1i(u('kind'), g.kind);
    gl.uniform4fv(u('shapeA'), g.shapeA ?? [1, 0, 0, 0]);
    gl.uniform4fv(u('wave'), g.wave ?? [0, 0, 0, 1]);
    gl.uniform1i(u('bg'), 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, bg);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  };

  const drawTitle = (it: TTitle, t: number) => {
    const u = title.u;
    gl.useProgram(title.prog);
    gl.uniform4f(u('uQuad'), it.x, it.y, it.w, it.h);
    gl.uniform2f(u('uView'), W, H);
    gl.uniform2f(u('size'), it.w, it.h);
    gl.uniform1f(u('time'), t);
    gl.uniform1f(u('level'), it.level);
    gl.uniform1f(u('pad'), it.pad);
    gl.uniform1f(u('slosh'), it.slosh);
    gl.uniform1f(u('alpha'), it.alpha);
    gl.uniform4fv(u('glassCol'), it.glassCol);
    gl.uniform4fv(u('liqA'), it.liqA);
    gl.uniform4fv(u('liqB'), it.liqB);
    gl.uniform4fv(u('haloCol'), it.haloCol);
    gl.uniform4fv(u('shadeCol'), it.shadeCol);
    gl.uniform4fv(u('edgeCol'), it.edgeCol);
    gl.uniform1i(u('src'), 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, maskTexture(it));
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  };

  const drawPearls = (it: TPearls, t: number) => {
    const u = pearls.u;
    gl.useProgram(pearls.prog);
    gl.uniform4f(u('uQuad'), it.x, it.y, it.w, it.h);
    gl.uniform2f(u('uView'), W, H);
    gl.uniform2f(u('size'), it.w, it.h);
    gl.uniform2f(u('mouse'), ptr.x - it.x, ptr.y - it.y);
    gl.uniform1f(u('time'), t);
    gl.uniform1f(u('seed'), it.seed);
    gl.uniform1f(u('spacing'), 15);
    gl.uniform1f(u('drift'), reduce.matches ? 0 : it.drift);
    gl.uniform1f(u('alpha'), it.alpha);
    gl.uniform4fv(u('rimCol'), it.rimCol);
    gl.uniform4fv(u('bodyCol'), it.bodyCol);
    gl.uniform4fv(u('fillCol'), it.fillCol);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  };

  const simStep = () => {
    const u = sim.u;
    gl.useProgram(sim.prog);
    gl.bindFramebuffer(gl.FRAMEBUFFER, simFbo[1 - simCur]);
    gl.viewport(0, 0, gw, gh);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, simTex[simCur]);
    gl.uniform1i(u('prev'), 0);
    gl.uniform2f(u('cells'), gw, gh);
    gl.uniform1f(u('speed'), 0.55);
    gl.uniform1f(u('damping'), 0.994);
    // the pointer's wake: full over open water, `glassWake` of it under the glass
    const has = ptr.x > -1000 && lastPtr.x > -1000;
    const moved = has ? Math.hypot(ptr.x - lastPtr.x, ptr.y - lastPtr.y) : 0;
    const gain = !has ? 0 : overSolid(ptr.x, ptr.y) ? glassWake : 1;
    gl.uniform4f(u('wakeB'), lastPtr.x / CELL, lastPtr.y / CELL, 0, 0);
    // (a jump, the pointer coming back in somewhere else, leaves no wake: it would draw a line)
    gl.uniform4f(u('wakeA'), ptr.x / CELL, ptr.y / CELL, 2.0, gain > 0 && moved > 0.5 && moved < 90 ? -Math.min(moved, 40) * 0.004 * gain : 0);
    lastPtr = { ...ptr };
    for (let i = 0; i < 4; i++) gl.uniform4fv(u(`drop${i}`), drops.shift() ?? [0, 0, 1, 0]);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    simCur = 1 - simCur;
  };

  const start = performance.now();
  let clock = 0;
  let last = 0;
  let simAcc = 0;
  let rainIn = 2;
  let slow = 0;
  let frames = 0;
  // for tuning: the time spent building scenes (dom reads), and on the cpu side of a frame
  let sceneMs = 0;
  let frameMs = 0;

  const draw = (now: number) => {
    const f0 = performance.now();
    drawFrame(now);
    frameMs += performance.now() - f0;
  };
  const drawFrame = (now: number) => {
    const dt = Math.min(0.1, last ? (now - last) / 1000 : 1 / 60);
    // a long run of slow frames: fewer pixels (not when a software renderer was asked for: tests)
    if (focused() && last && !opts.allowSoftware) {
      const gap = now - last;
      const expected = 1000 / fps.focused;
      slow = gap > expected * 1.6 ? slow + Math.min(30, gap / expected) : Math.max(0, slow - 2);
      if (slow > 90 && quality > 0.45) {
        quality *= 0.8;
        slow = 0;
        resize();
      }
    }
    last = now;
    const still = reduce.matches;
    if (!still) clock += dt;
    const t = still ? 12 : clock;
    const tk = opts.tokens();

    if (!still) {
      stepBubbles(dt, t);
      rainIn -= dt;
      if (rainIn <= 0) {
        rainIn = 1.6 + Math.random() * 3.2;
        ripple(Math.random() * W, Math.random() * H, -0.35 - Math.random() * 0.35, 2.5 + Math.random() * 2.5);
      }
    } else bubF.fill(0);

    const t0 = performance.now();
    const scene = opts.scene(t);
    sceneMs += performance.now() - t0;
    solid = scene.solid;

    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);

    // 1. the simulation: up to 60 steps a second, two at most per frame
    if (simOn && !still) {
      simAcc = Math.min(simAcc + dt, 2 / 60);
      while (simAcc >= 1 / 61) {
        simStep();
        simAcc -= 1 / 60;
      }
      if (simAcc < 0) simAcc = 0;
    }

    // 2. the water, into A
    const pool = opts.pool?.() ?? { view: [W, H] as [number, number], offset: [0, 0] as [number, number] };
    const u = water.u;
    gl.useProgram(water.prog);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fboA);
    gl.viewport(0, 0, ww, wh);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, simOn ? simTex[simCur] : null);
    gl.uniform1i(u('sim'), 0);
    gl.uniform2f(u('view'), W, H);
    gl.uniform2f(u('poolView'), pool.view[0], pool.view[1]);
    gl.uniform2f(u('poolOffset'), pool.offset[0], pool.offset[1]);
    gl.uniform1f(u('scale'), ww / W);
    gl.uniform2f(u('cells'), Math.max(1, gw), Math.max(1, gh));
    gl.uniform1f(u('cell'), CELL);
    gl.uniform1f(u('time'), t);
    gl.uniform4fv(u('cTop'), rgba(tk.poolTop));
    gl.uniform4fv(u('cMid'), rgba(tk.poolMid));
    gl.uniform4fv(u('cBot'), rgba(tk.poolBot));
    gl.uniform4fv(u('cLight'), rgba(tk.light, tk.lightA));
    gl.uniform4fv(u('cSky'), rgba(tk.sky, tk.skyA));
    gl.uniform4fv(u('cBubble'), rgba(tk.bubble, still ? 0 : tk.bubbleA));
    gl.uniform1f(u('caustics'), tk.caustics);
    gl.uniform1f(u('sun'), tk.sun);
    gl.uniform1f(u('swell'), 0.9);
    gl.uniform1f(u('depth'), 38);
    gl.uniform1f(u('rippleGain'), 13);
    gl.uniform1f(u('simOn'), simOn ? 1 : 0);
    gl.uniform4fv(u('bub'), bubF);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindTexture(gl.TEXTURE_2D, texA);
    gl.generateMipmap(gl.TEXTURE_2D);

    // 3. the boat and its waves, glass on the water, into B
    let bg = texA!;
    if (scene.stage.length) {
      if (!texB) makeB();
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fboA);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, fboB);
      gl.blitFramebuffer(0, 0, ww, wh, 0, 0, ww, wh, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fboB);
      gl.viewport(0, 0, ww, wh);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(glass.prog);
      for (const g of scene.stage) if (scissor(g.clip, ww / W, ww, wh)) drawGlass(g, t, texA!, ww, wh);
      gl.disable(gl.SCISSOR_TEST);
      gl.disable(gl.BLEND);
      gl.bindTexture(gl.TEXTURE_2D, texB);
      gl.generateMipmap(gl.TEXTURE_2D);
      bg = texB!;
    }

    // 4. on screen: the water, then the glass
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, cw, ch);
    gl.useProgram(blit.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, bg);
    gl.uniform1i(blit.u('src'), 0);
    gl.uniform2f(blit.u('screen'), cw, ch);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    let current: WebGLProgram | null = null;
    for (const it of scene.items) {
      if (it.alpha <= 0.002 || !scissor(it.clip)) continue;
      if (it.type === 'glass') {
        if (current !== glass.prog) gl.useProgram((current = glass.prog));
        drawGlass(it, t, bg, cw, ch);
      } else if (it.type === 'title') {
        drawTitle(it, t);
        current = title.prog;
      } else {
        drawPearls(it, t);
        current = pearls.prog;
      }
    }
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);
    frames++;
    opts.onFrame?.(t);
  };

  // ---- the loop ----------------------------------------------------------------------------

  // frames are budgeted, not skipped by a fixed gap: on a 144 hz screen 60 a second stay 60
  let raf = 0;
  let running = true;
  let prevTick = 0;
  let budget = 0;
  const loop = (now: number) => {
    if (!running) return;
    raf = requestAnimationFrame(loop);
    const rate = reduce.matches ? 4 : focused() ? fps.focused : fps.blurred;
    const interval = 1000 / rate;
    budget = Math.min(budget + (prevTick ? now - prevTick : interval), interval * 2);
    prevTick = now;
    // a hair of slack, so a 60 hz screen's jitter does not drop every other frame at 60
    if (budget < interval - 1.5) return;
    budget = Math.max(0, budget - interval);
    draw(now);
  };
  const onVisible = () => {
    if (!document.hidden && running) {
      cancelAnimationFrame(raf);
      last = 0;
      prevTick = 0;
      raf = requestAnimationFrame(loop);
    }
  };
  const onLost = (e: Event) => {
    e.preventDefault();
    stop();
    document.documentElement.classList.add('no-gl');
  };

  window.addEventListener('resize', resize);
  window.addEventListener('pointermove', onMove, { passive: true });
  document.documentElement.addEventListener('pointerleave', onLeave);
  document.addEventListener('visibilitychange', onVisible);
  canvas.addEventListener('webglcontextlost', onLost);

  const stop = () => {
    running = false;
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
    window.removeEventListener('pointermove', onMove);
    document.documentElement.removeEventListener('pointerleave', onLeave);
    document.removeEventListener('visibilitychange', onVisible);
    canvas.removeEventListener('webglcontextlost', onLost);
  };

  resize();
  raf = requestAnimationFrame(loop);
  void start;
  // devtools: __waterCost() → ms per frame on the cpu (all of it, and the scene's dom reads)
  Object.assign(window, {
    __waterFrames: () => frames,
    __waterQuality: () => quality,
    __waterBench: (n = 200) => {
      const t0 = performance.now();
      for (let i = 0; i < n; i++) opts.scene(clock + i / 60);
      return +((performance.now() - t0) / n).toFixed(3);
    },
    __waterCost: () => ({ frame: +(frameMs / Math.max(1, frames)).toFixed(3), scene: +(sceneMs / Math.max(1, frames)).toFixed(3), frames, size: [cw, ch, ww, wh] })
  });

  return { stop, ripple, popAt, time: () => (reduce.matches ? 12 : clock), pointer: () => ptr, resize };
};
