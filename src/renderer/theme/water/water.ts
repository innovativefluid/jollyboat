// the living water behind the app's own pages in the water look (design_handoff_aqua.md §6):
// webgl2, three passes a frame — one step of the ripple simulation, the water into a mipmapped
// texture, then that texture on screen with the page's panels as frosted glass slabs.
//
// the page tells it about itself only through the dom: every visible .panel is a glass slab at its
// bounding box (radii from its css, clipped to its scrolling column, faded with its opacity).
// drops come from ripple(): clicks on open water, pills, rain, air bubbles that surface.
//
// performance: one simulation fragment per 5 × 5 px cell; the water and the glass at up to 1.5 ×
// device pixels, less when frames run long; 60 fps with focus, 30 without, nothing while hidden.
// with reduced motion the clock stops: no ripples, bubbles or rain, a few still frames a second.

import { GLASS_FS, SIM_FS, VS, WATER_FS } from './shaders';
import { unit, waterTokens } from './tokens';

const CELL = 5;
const MAX_PANELS = 8;
const BUBBLES = 14;
const BOAT_SCALE = 4;

type TDrop = { x: number; y: number; r: number; amp: number };
type TBubble = { x: number; y: number; r: number; age: number; life: number; phase: number };

export type TWater = {
  stop: () => void;
  /** a drop at a page point (css px): amp below 0 pushes the surface down, radius in cells */
  ripple: (x: number, y: number, amp: number, radius?: number) => void;
  /** pops an air bubble under a page point, if there is one */
  popAt: (x: number, y: number) => boolean;
};

const compile = (gl: WebGL2RenderingContext, fs: string) => {
  const make = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
    return s;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, make(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, make(gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(prog, 0, 'aPos');
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link');
  const locs = new Map<string, WebGLUniformLocation | null>();
  const u = (name: string) => {
    if (!locs.has(name)) locs.set(name, gl.getUniformLocation(prog, name));
    return locs.get(name)!;
  };
  return { prog, u };
};

export const createWater = (canvas: HTMLCanvasElement, opts: { onPop?: (x: number, y: number) => void } = {}): TWater | null => {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: 'low-power' });
  if (!gl) return null;

  let sim: ReturnType<typeof compile>;
  let water: ReturnType<typeof compile>;
  let glass: ReturnType<typeof compile>;
  try {
    sim = compile(gl, SIM_FS);
    water = compile(gl, WATER_FS);
    glass = compile(gl, GLASS_FS);
  } catch (err) {
    console.warn('water:', (err as Error).message);
    return null;
  }
  // a software renderer (no gpu, or one chromium refuses) would spend whole cores on this: the
  // css water then. localStorage 'jollyboat-soft-gl' = '1' allows it anyway, for testing
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  let allowSoft = false;
  try {
    allowSoft = localStorage.getItem('jollyboat-soft-gl') === '1';
  } catch {
    /* storage blocked */
  }
  if (/swiftshader|llvmpipe|softpipe|software/i.test(renderer) && !allowSoft) {
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return null;
  }
  // rgba16f render targets for the simulation; without them the water still moves, only nothing ripples
  const simOn = !!gl.getExtension('EXT_color_buffer_float');

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  let W = 0;
  let H = 0;
  let scale = 1;
  let quality = 1;
  let gw = 0;
  let gh = 0;
  let maxLod = 0;
  let waterTex: WebGLTexture | null = null;
  let waterFbo: WebGLFramebuffer | null = null;
  let simTex: (WebGLTexture | null)[] = [null, null];
  let simFbo: (WebGLFramebuffer | null)[] = [null, null];
  let simCur = 0;

  const makeTex = (w: number, h: number, internal: number, format: number, type: number, filter: number, mip: boolean) => {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  };
  const makeFbo = (tex: WebGLTexture | null) => {
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return fbo;
  };

  const resize = () => {
    W = window.innerWidth;
    H = window.innerHeight;
    scale = Math.min(window.devicePixelRatio || 1, 1.5) * quality;
    canvas.width = Math.max(1, Math.round(W * scale));
    canvas.height = Math.max(1, Math.round(H * scale));
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    maxLod = Math.floor(Math.log2(Math.max(canvas.width, canvas.height)));

    if (waterTex) gl.deleteTexture(waterTex);
    if (waterFbo) gl.deleteFramebuffer(waterFbo);
    waterTex = makeTex(canvas.width, canvas.height, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR, true);
    waterFbo = makeFbo(waterTex);

    if (simOn) {
      const nw = Math.ceil(W / CELL);
      const nh = Math.ceil(H / CELL);
      if (nw !== gw || nh !== gh) {
        gw = nw;
        gh = nh;
        simTex.forEach((t) => t && gl.deleteTexture(t));
        simFbo.forEach((f) => f && gl.deleteFramebuffer(f));
        simTex = [0, 1].map(() => makeTex(gw, gh, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR, false));
        simFbo = simTex.map(makeFbo);
        for (const f of simFbo) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, f);
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }
    }
  };

  // ---- the pointer, drops, rain, air bubbles, the boat -------------------------------------

  let ptrX = -1;
  let ptrY = -1;
  let ptrIn = 0;
  let ptrInTarget = 0;
  let pullX = 0;
  let pullY = 0;
  let wakeFrom: [number, number] | null = null;
  let wakeTo: [number, number] | null = null;
  let wakeLen = 0;
  const drops: TDrop[] = [];

  const ripple = (x: number, y: number, amp: number, radius = 5) => {
    if (!simOn || reduce.matches || drops.length > 16) return;
    drops.push({ x: x / CELL, y: (H - y) / CELL, r: radius, amp });
  };

  const onMove = (e: PointerEvent) => {
    const first = ptrX < 0;
    if (!first) {
      // the wake: only over open water, not under glass or the page's own controls
      const open = !(e.target as Element | null)?.closest?.('.panel, button, input, label, .footer, .title-block, .toast');
      if (open) {
        if (!wakeFrom) wakeFrom = [ptrX, ptrY];
        wakeTo = [e.clientX, e.clientY];
        wakeLen += Math.hypot(e.clientX - ptrX, e.clientY - ptrY);
      }
    }
    ptrX = e.clientX;
    ptrY = e.clientY;
    if (first) {
      pullX = ptrX;
      pullY = ptrY;
    }
    ptrInTarget = 1;
  };
  const onLeave = () => {
    ptrInTarget = 0;
  };

  const bubbles: TBubble[] = [];
  const spawn = (b: TBubble, anywhere: boolean) => {
    b.r = 6 + Math.random() * 12;
    b.x = 20 + Math.random() * Math.max(1, W - 40);
    b.y = anywhere ? Math.random() * H : H + b.r + Math.random() * 60;
    b.age = 0;
    b.life = 7 + Math.random() * 16;
    b.phase = Math.random();
    return b;
  };
  // an air bubble that reaches the surface (or is clicked) pops into a drop
  const surface = (b: TBubble, natural = true) => {
    ripple(b.x, b.y, natural ? -0.6 : -1.0, natural ? 3 : 5);
    if (natural) opts.onPop?.(b.x, b.y);
    spawn(b, false);
  };
  const popAt = (x: number, y: number) => {
    const b = bubbles.find((b) => Math.hypot(b.x - x, b.y - y) < b.r + 4);
    if (!b) return false;
    surface(b, false);
    return true;
  };

  // the boat's water line, in gl's y-up css px: a fifth of the way up, breathing over ~25 s; the
  // first wave line as the shader draws it
  let shipX = -1;
  const waterY = (t: number) => H * 0.2 + 12.5 * Math.sin(t * 0.25);
  const waveY = (x: number, t: number) => waterY(t) + 8 * Math.sin(x * 0.018 + t * 0.6) + 4 * Math.sin(x * 0.046 - t * 0.9);

  let nextRain = 2;

  // ---- the page's panels -------------------------------------------------------------------

  const radii = new WeakMap<Element, number[]>();
  const rect = new Float32Array(MAX_PANELS * 4);
  const rad = new Float32Array(MAX_PANELS * 4);
  const clip = new Float32Array(MAX_PANELS * 4);
  const alpha = new Float32Array(MAX_PANELS);

  const readPanels = () => {
    let n = 0;
    for (const el of document.querySelectorAll<HTMLElement>('.panel')) {
      if (n >= MAX_PANELS) break;
      if (!el.offsetParent) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      let ra = radii.get(el);
      if (!ra) {
        const cs = getComputedStyle(el);
        ra = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius].map((v) => parseFloat(v) || 0);
        radii.set(el, ra);
      }
      // what is drawn of it: its opacity and its page's (intro, panels streaming in)
      let a = 1;
      for (let p: HTMLElement | null = el; p && p !== document.body; p = p.parentElement) a *= parseFloat(getComputedStyle(p).opacity);
      if (a < 0.01) continue;
      const col = el.closest('.col');
      const c = col ? col.getBoundingClientRect() : { left: -40, top: -40, right: W + 40, bottom: H + 40 };
      const max = Math.min(r.width, r.height) / 2;
      rect.set([r.left, H - r.bottom, r.width, r.height], n * 4);
      rad.set(ra.map((v) => Math.min(v, max)), n * 4);
      clip.set([c.left - 12, H - c.bottom - 12, c.right + 12, H - c.top + 2], n * 4);
      alpha[n] = a;
      n++;
    }
    return n;
  };

  // ---- drawing -----------------------------------------------------------------------------

  const setTokens = (u: (name: string) => WebGLUniformLocation | null, names: string[]) => {
    const tk = waterTokens() as unknown as Record<string, unknown>;
    for (const name of names) {
      const v = tk[name];
      const loc = u(`u${name[0].toUpperCase()}${name.slice(1)}`);
      if (Array.isArray(v)) gl.uniform3fv(loc, unit(v as [number, number, number]));
      else gl.uniform1f(loc, v as number);
    }
    gl.uniform1f(u('uDeep'), waterTokens().poolMid[0] < 40 ? 1 : 0);
  };

  const start = performance.now();
  let clock = 0;
  let last = 0;
  let raf = 0;
  let running = true;
  let slowFrames = 0;
  let frames = 0;
  const bubF = new Float32Array(BUBBLES * 4);
  const dropF = new Float32Array(16);

  const draw = (now: number) => {
    const dt = Math.min(0.1, last ? (now - last) / 1000 : 0.016);
    // a long run of slow frames: fewer pixels
    if (document.hasFocus() && last) {
      const gap = now - last;
      slowFrames = gap > 26 ? slowFrames + Math.min(30, gap / 26) : Math.max(0, slowFrames - 2);
      if (slowFrames > 90 && quality > 0.45) {
        quality *= 0.8;
        slowFrames = 0;
        resize();
      }
    }
    last = now;
    const still = reduce.matches;
    if (!still) clock += dt;
    const t = still ? 12 : clock;

    ptrIn += (ptrInTarget - ptrIn) * Math.min(1, dt * 4);
    if (ptrX >= 0) {
      pullX += (ptrX - pullX) * Math.min(1, dt * 6);
      pullY += (ptrY - pullY) * Math.min(1, dt * 6);
    }

    // air bubbles: rise, sway, shy away from the pointer, surface after a while
    if (!still) {
      while (bubbles.length < BUBBLES) bubbles.push(spawn({} as TBubble, true));
      for (const b of bubbles) {
        b.age += dt;
        b.y -= (14 + 1.3 * b.r) * dt;
        b.x += Math.sin(t * 0.8 + b.phase * 20) * 9 * dt;
        if (ptrX >= 0) {
          const dx = b.x - ptrX;
          const dy = b.y - ptrY;
          const d = Math.hypot(dx, dy);
          const reach = b.r + 70;
          if (d < reach && d > 0.01) {
            const push = ((reach - d) / reach) * 160 * dt;
            b.x += (dx / d) * push;
            b.y += (dy / d) * push;
          }
        }
        if (b.age > b.life || b.y < -b.r) surface(b);
      }
      // rain
      nextRain -= dt;
      if (nextRain <= 0) {
        ripple(Math.random() * W, Math.random() * H, -0.35 - Math.random() * 0.35, 3);
        nextRain = 1.6 + Math.random() * 3.2;
      }
    } else bubbles.length = 0;

    // the boat eases toward the pointer, staying on screen
    const target = Math.min(W - 70, Math.max(70, ptrX >= 0 ? ptrX : W / 2));
    if (shipX < 0) shipX = W / 2;
    shipX += (target - shipX) * Math.min(1, dt * 0.35);
    const slope = (waveY(shipX + 6, t) - waveY(shipX - 6, t)) / 12;
    const tilt = Math.atan(slope) * 0.6 + 0.04 * Math.sin(t * 0.5);

    const panels = readPanels();

    // 1. one step of the simulation
    if (simOn && !still) {
      gl.useProgram(sim.prog);
      gl.bindFramebuffer(gl.FRAMEBUFFER, simFbo[1 - simCur]);
      gl.viewport(0, 0, gw, gh);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, simTex[simCur]);
      gl.uniform1i(sim.u('uState'), 0);
      gl.uniform2f(sim.u('uGrid'), gw, gh);
      const batch = drops.splice(0, 4);
      dropF.fill(0);
      batch.forEach((d, i) => dropF.set([d.x, d.y, d.r, d.amp], i * 4));
      gl.uniform4fv(sim.u('uDrop'), dropF);
      gl.uniform1i(sim.u('uDrops'), batch.length);
      if (wakeFrom && wakeTo && wakeLen > 0.5) {
        gl.uniform4f(sim.u('uWake'), wakeFrom[0] / CELL, (H - wakeFrom[1]) / CELL, wakeTo[0] / CELL, (H - wakeTo[1]) / CELL);
        gl.uniform1f(sim.u('uWakeAmt'), Math.max(-0.25, -0.004 * wakeLen));
      } else gl.uniform1f(sim.u('uWakeAmt'), 0);
      wakeFrom = null;
      wakeTo = null;
      wakeLen = 0;
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      simCur = 1 - simCur;
    }

    // 2. the water
    gl.useProgram(water.prog);
    gl.bindFramebuffer(gl.FRAMEBUFFER, waterFbo);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, simOn ? simTex[simCur] : null);
    gl.uniform1i(water.u('uSim'), 0);
    gl.uniform2f(water.u('uGrid'), Math.max(1, gw), Math.max(1, gh));
    gl.uniform1f(water.u('uSimOn'), simOn ? 1 : 0);
    gl.uniform2f(water.u('uRes'), W, H);
    gl.uniform1f(water.u('uScale'), scale);
    gl.uniform1f(water.u('uTime'), t);
    setTokens(water.u, ['poolTop', 'poolMid', 'poolBot', 'light', 'lightA', 'sky', 'skyA', 'bubble', 'bubbleA', 'caustics', 'sun', 'spark', 'liqA', 'liqB', 'edge', 'edgeA', 'fg', 'irid']);
    bubF.fill(0);
    bubbles.forEach((b, i) => bubF.set([b.x, H - b.y, b.r, b.phase], i * 4));
    gl.uniform4fv(water.u('uBub'), bubF);
    gl.uniform1i(water.u('uBubN'), bubbles.length);
    gl.uniform4f(water.u('uBoat'), shipX, waveY(shipX, t) + 1.5 * Math.sin(t * 1.2), tilt, BOAT_SCALE);
    gl.uniform1f(water.u('uWaterY'), waterY(t));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindTexture(gl.TEXTURE_2D, waterTex);
    gl.generateMipmap(gl.TEXTURE_2D);

    // 3. on screen, under glass
    gl.useProgram(glass.prog);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform1i(glass.u('uWater'), 0);
    gl.uniform2f(glass.u('uRes'), W, H);
    gl.uniform1f(glass.u('uScale'), scale);
    gl.uniform1f(glass.u('uTime'), t);
    gl.uniform1f(glass.u('uMaxLod'), maxLod);
    gl.uniform2f(glass.u('uPtr'), pullX, H - pullY);
    gl.uniform1f(glass.u('uPtrIn'), still ? 0 : ptrIn);
    gl.uniform4fv(glass.u('uRect'), rect);
    gl.uniform4fv(glass.u('uRad'), rad);
    gl.uniform4fv(glass.u('uClip'), clip);
    gl.uniform1fv(glass.u('uAlpha'), alpha);
    gl.uniform1i(glass.u('uN'), panels);
    setTokens(glass.u, ['glass', 'glassA', 'edge', 'edgeA', 'light', 'lightA', 'shade', 'shadeA', 'irid']);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    frames++;
  };

  let lastDrawn = 0;
  const loop = (now: number) => {
    if (!running) return;
    raf = requestAnimationFrame(loop);
    // every frame with focus, every other frame without, four still frames a second when calm
    const gap = reduce.matches ? 250 : document.hasFocus() ? 0 : 1000 / 30;
    if (now - lastDrawn < gap - 2) return;
    lastDrawn = now;
    draw(now);
  };

  const onVisible = () => {
    if (!document.hidden && running) {
      cancelAnimationFrame(raf);
      last = 0;
      raf = requestAnimationFrame(loop);
    }
  };
  const onLost = (e: Event) => {
    e.preventDefault();
    stop();
    document.documentElement.classList.add('no-gl');
  };

  window.addEventListener('resize', resize);
  window.addEventListener('pointermove', onMove);
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
  Object.assign(window, { __waterFrames: () => frames, __waterQuality: () => quality });

  return { stop, ripple, popAt };
};
