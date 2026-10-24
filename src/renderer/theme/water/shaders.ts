// the water look's shaders (design_handoff_aqua.md §5, §6), ported from the qml ones to webgl2.
// everything works in css px with y up (gl's own direction); the js side turns dom rects around.
//
// SIM: a damped wave equation, one fragment per 5 × 5 px cell, ping-ponged in an rgba16f texture
//      holding (height, previous height, gradient x, gradient y).
// WATER: the pool seen through the moving surface: gradient, aurora ribbons, light shafts,
//      caustics focused by the ripples, air bubbles as lenses, sky reflection, sun glints, glitter,
//      bloom; then the jolly boat and its wave lines as glass on top. into a mipmapped texture.
// GLASS: that texture on screen, with the panels as frosted glass slabs over it: a membrane edge
//      that wobbles and reaches for the pointer, refraction at the rim, frost, tint, rim light,
//      thin film, a gloss cap, window streaks, an outline and a soft shadow.

export const VS = /* glsl */ `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const COMMON = /* glsl */ `
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec2 hash2(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
`;

export const SIM_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uState;
uniform vec2 uGrid;
uniform vec4 uDrop[4];   // x, y (cells), radius (cells), amplitude
uniform int uDrops;
uniform vec4 uWake;      // the pointer's segment since the last step, in cells
uniform float uWakeAmt;
out vec4 o;

void main() {
  ivec2 ic = ivec2(gl_FragCoord.xy);
  ivec2 mx = ivec2(uGrid) - 1;
  #define H(dx, dy) texelFetch(uState, clamp(ic + ivec2(dx, dy), ivec2(0), mx), 0).r
  vec4 s = texelFetch(uState, ic, 0);
  float h = s.r;
  float n = H(0, 1), so = H(0, -1), e = H(1, 0), w = H(-1, 0);
  float lap = (4.0 * (n + so + e + w) + (H(1, 1) + H(-1, 1) + H(1, -1) + H(-1, -1)) - 20.0 * h) / 6.0;
  float v = (h - s.g) * 0.994;
  float hn = (h + v + 0.55 * lap) * 0.9994;

  vec2 c = vec2(ic) + 0.5;
  for (int i = 0; i < 4; i++) {
    if (i >= uDrops) break;
    vec4 d = uDrop[i];
    float r = length(c - d.xy);
    if (r < d.z) hn += d.w * 0.5 * (1.0 + cos(3.14159265 * r / d.z));
  }
  if (uWakeAmt != 0.0) {
    vec2 a = uWake.xy, ab = uWake.zw - uWake.xy;
    float t = clamp(dot(c - a, ab) / max(dot(ab, ab), 1e-4), 0.0, 1.0);
    float dd = length(c - (a + ab * t));
    hn += uWakeAmt * exp(-dd * dd / 4.0);
  }

  // the last 9 cells at every edge swallow what reaches them
  vec2 ed = min(c, uGrid - c);
  float absorb = mix(0.8, 1.0, smoothstep(0.0, 9.0, min(ed.x, ed.y)));
  o = vec4(hn * absorb, h * absorb, (e - w) * 0.5, (n - so) * 0.5);
}
`;

export const WATER_FS = /* glsl */ `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uScale;
uniform float uTime;
uniform sampler2D uSim;
uniform vec2 uGrid;
uniform float uSimOn;
uniform vec3 uPoolTop, uPoolMid, uPoolBot, uLight, uSky, uBubble, uSpark, uLiqA, uLiqB, uEdge, uFg;
uniform float uLightA, uSkyA, uBubbleA, uCaustics, uSun, uEdgeA, uIrid, uDeep;
uniform vec4 uBub[14];   // x, y, r, phase
uniform int uBubN;
uniform vec4 uBoat;      // x, waterline y, tilt, scale (0: no boat)
uniform float uWaterY;
out vec4 o;
${COMMON}

vec4 cubicW(float v) {
  vec4 n = vec4(1.0, 2.0, 3.0, 4.0) - v;
  vec4 s = n * n * n;
  float x = s.x, y = s.y - 4.0 * s.x, z = s.z - 4.0 * s.y + 6.0 * s.x;
  return vec4(x, y, z, 6.0 - x - y - z) * (1.0 / 6.0);
}
vec4 simCubic(vec2 cell) {
  vec2 c = cell - 0.5;
  vec2 f = fract(c);
  c -= f;
  vec4 xc = cubicW(f.x), yc = cubicW(f.y);
  vec4 cc = c.xxyy + vec2(-0.5, 1.5).xyxy;
  vec4 s = vec4(xc.xz + xc.yw, yc.xz + yc.yw);
  vec4 off = (cc + vec4(xc.yw, yc.yw) / s) / uGrid.xxyy;
  vec4 s0 = texture(uSim, off.xz), s1 = texture(uSim, off.yz), s2 = texture(uSim, off.xw), s3 = texture(uSim, off.yw);
  float sx = s.x / (s.x + s.y), sy = s.z / (s.z + s.w);
  return mix(mix(s3, s2, sx), mix(s1, s0, sx), sy);
}

// F2 − F1 of a moving voronoi: thin bright lines where two cells meet
float vEdge(vec2 x, float t) {
  vec2 n = floor(x), f = fract(x);
  float f1 = 8.0, f2 = 8.0;
  for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 h = hash2(n + g);
      vec2 r = g + 0.5 + 0.42 * sin(t + 6.2831 * h) - f;
      float d = dot(r, r);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
    }
  return sqrt(f2) - sqrt(f1);
}

vec3 pool(vec2 q, float T, float focus) {
  vec2 u = q / uRes;
  float dpt = clamp(0.62 * (1.0 - u.y) + 0.38 * u.x, 0.0, 1.0);
  vec3 c = mix(mix(uPoolTop, uPoolMid, smoothstep(0.0, 0.5, dpt)), uPoolBot, smoothstep(0.45, 1.05, dpt));
  vec3 L = uLight * uLightA;

  // three aurora ribbons: a wide sheet, a 3 px bright edge, a halo
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    float yk = uRes.y * (0.8 - 0.25 * fk) + 46.0 * sin(q.x * 0.0043 + T * 0.11 + fk * 2.1) + 20.0 * sin(q.x * 0.0105 - T * 0.07 + fk * 1.7);
    float dd = q.y - yk;
    float w = 36.0 + 18.0 * fk;
    float along = 0.5 + 0.5 * sin(q.x * 0.0052 - T * 0.16 + fk * 2.6);
    float sheet = smoothstep(w, 0.0, -dd) * step(dd, 0.0) * 0.1;
    float edge = exp(-dd * dd / 4.0) * 0.32;
    float halo = exp(-dd * dd / 260.0) * 0.09;
    c += L * (sheet + edge + halo) * along;
  }

  // light shafts fanning from above the top left
  vec2 v = q - vec2(-0.12 * uRes.x, 1.2 * uRes.y);
  float a = atan(v.y, v.x);
  float rays = pow(0.5 + 0.5 * sin(a * 31.0 + 1.7 * sin(a * 11.0 + T * 0.13) + T * 0.04), 5.0) * 0.6 + pow(0.5 + 0.5 * sin(a * 17.0 - T * 0.06), 8.0) * 0.4;
  c += L * rays * 0.1 * smoothstep(1.6 * uRes.y, 0.15 * uRes.y, length(v));

  // caustics: two warped voronoi layers, in patches, focused or spread by the ripples above
  float patchy = smoothstep(0.3, 0.85, vnoise(q * 0.0032 + vec2(T * 0.02, -T * 0.015)));
  vec2 w2 = q + 24.0 * vec2(sin(q.y * 0.009 + T * 0.3) + 0.5 * sin(q.x * 0.021 - T * 0.2), cos(q.x * 0.008 - T * 0.25) + 0.5 * cos(q.y * 0.019 + T * 0.23));
  float e1 = vEdge(w2 / 120.0, T * 0.35);
  float e2 = vEdge(w2 / 70.0 + 3.7, T * 0.5);
  float c1 = pow(1.0 - smoothstep(0.0, 0.13, e1), 3.0);
  float c2 = pow(1.0 - smoothstep(0.0, 0.15, e2), 3.0);
  float cs = c1 * 0.55 + c2 * 0.35 + c1 * c2 * 0.6;
  c += L * cs * (0.12 + 0.88 * patchy) * uCaustics * focus * 0.3;
  return c;
}

float waveY(float k, float x, float T) {
  return uWaterY - k * 15.0 + 8.0 * sin(x * 0.018 + T * 0.6 + k * 1.3) + 4.0 * sin(x * 0.046 - T * 0.9 + k);
}

float sdSeg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}

// the boat in the icon's 28-unit grid (y down): hull, sail, mast
const vec2 HULL[5] = vec2[5](vec2(2.2, 17.0), vec2(26.6, 17.0), vec2(26.2, 19.8), vec2(24.4, 22.6), vec2(7.4, 22.6));
const vec2 SAIL[4] = vec2[4](vec2(15.2, 2.8), vec2(24.2, 12.6), vec2(23.4, 14.4), vec2(15.2, 14.6));
float sdHull(vec2 p) {
  float d = dot(p - HULL[0], p - HULL[0]);
  float s = 1.0;
  for (int i = 0, j = 4; i < 5; j = i, i++) {
    vec2 e = HULL[j] - HULL[i], w = p - HULL[i];
    vec2 b = w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
    d = min(d, dot(b, b));
    bvec3 c = bvec3(p.y >= HULL[i].y, p.y < HULL[j].y, e.x * w.y > e.y * w.x);
    if (all(c) || all(not(c))) s = -s;
  }
  return s * sqrt(d);
}
float sdSail(vec2 p) {
  float d = dot(p - SAIL[0], p - SAIL[0]);
  float s = 1.0;
  for (int i = 0, j = 3; i < 4; j = i, i++) {
    vec2 e = SAIL[j] - SAIL[i], w = p - SAIL[i];
    vec2 b = w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
    d = min(d, dot(b, b));
    bvec3 c = bvec3(p.y >= SAIL[i].y, p.y < SAIL[j].y, e.x * w.y > e.y * w.x);
    if (all(c) || all(not(c))) s = -s;
  }
  return s * sqrt(d);
}

void main() {
  vec2 p = gl_FragCoord.xy / uScale;
  float T = uTime;

  // the surface: ripples from the simulation, the lcd paper's four sines as a slow swell, and a
  // fine texture
  vec2 sl = vec2(0.0);
  float focus = 1.0;
  if (uSimOn > 0.5) {
    vec2 cell = p / 5.0;
    vec4 st = simCubic(cell);
    sl = st.zw * 13.0 / 5.0;
    vec2 ts = 1.0 / uGrid;
    vec2 cu = cell / uGrid;
    float lap = texture(uSim, cu + vec2(ts.x, 0.0)).r + texture(uSim, cu - vec2(ts.x, 0.0)).r + texture(uSim, cu + vec2(0.0, ts.y)).r + texture(uSim, cu - vec2(0.0, ts.y)).r - 4.0 * st.r;
    focus = clamp(1.0 - lap * 9.0 * 1.6, 0.45, 2.6);
  }
  vec2 pc = p / 5.0;
  float Tp = T * 0.6;
  vec2 cc = pc - uRes / 10.0;
  float rr = length(cc) + 1e-3;
  vec2 swell = vec2(0.085 * cos(pc.x * 0.085 + Tp), 0.11 * cos(pc.y * 0.11 - 0.7 * Tp))
    + vec2(0.06, 0.07) * cos(pc.x * 0.06 + pc.y * 0.07 + 0.5 * Tp)
    + 0.09 * cos(rr * 0.09 - 0.9 * Tp) * cc / rr;
  swell *= 0.045;
  vec2 fine = (vec2(vnoise(p * 0.03 + vec2(T * 0.11, 0.0)), vnoise(p * 0.03 + vec2(5.2, -T * 0.09))) - 0.5) * 0.012;
  sl += swell + fine;
  sl = sl / (1.0 + 1.4 * length(sl));

  // refraction, and the air bubbles as diverging lenses (a wider view of the pool)
  vec2 q = p + sl * 38.0;
  int hit = -1;
  vec2 bdv = vec2(0.0);
  float br = 1.0;
  for (int i = 0; i < 14; i++) {
    if (i >= uBubN) break;
    vec4 b = uBub[i];
    float r = b.z * (1.0 + 0.045 * sin(T * 6.5 + b.w * 9.0));
    vec2 dv = p - b.xy;
    float d = length(dv);
    if (d < r) {
      float k = d / r;
      q = b.xy + dv * (1.9 - 0.9 * k * k) + sl * 10.0;
      hit = i; bdv = dv; br = r;
      break;
    }
  }
  vec3 col = pool(q, T, focus);

  if (hit >= 0) {
    float k = length(bdv) / br;
    float aa = 1.5 / br;
    float rim = smoothstep(0.6, 1.0, k);
    col = col * 1.06 + 0.04;
    vec3 film = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + k * 1.4 + atan(bdv.y, bdv.x) * 0.16 + T * 0.05));
    col += film * uIrid * 0.28 * rim;
    col = mix(col, uSpark, rim * 0.32);
    float ring = smoothstep(1.0 - 3.5 * aa, 1.0 - aa, k);
    col = mix(col, uBubble, ring * uBubbleA * 0.75);
    vec2 hp = (bdv / br - vec2(-0.34, 0.36)) / vec2(0.27, 0.16);
    col = mix(col, uSpark, smoothstep(1.0, 0.55, length(hp)) * 0.85);
  }

  // light on the surface: slope shading, the sky's reflection, sun glints on ripple flanks only,
  // glitter where the swell faces the sun, a soft bloom, a light vignette
  vec3 n = normalize(vec3(-sl, 1.0));
  float lam = clamp(0.5 + dot(sl, normalize(vec2(-0.7, 0.7))) * 2.4, 0.0, 1.0);
  col *= mix(0.82, 1.25, lam) / 1.035;
  float fres = 0.04 + 0.96 * pow(1.0 - n.z, 5.0);
  col = mix(col, uSky, uSkyA * clamp(0.05 + fres * 6.0, 0.0, 0.5));
  vec3 sunD = normalize(vec3(-0.5, 0.55, 0.67));
  vec3 rf = reflect(vec3(0.0, 0.0, -1.0), n);
  float glint = pow(max(dot(rf, sunD), 0.0), 900.0) * smoothstep(0.02, 0.07, length(sl - swell - fine));
  col += uSpark * glint * 2.2 * uSun;
  float h1 = hash(floor(p / 3.0));
  float tw = pow(max(0.0, sin(T * (2.0 + h1 * 3.0) + h1 * 40.0)), 8.0);
  float faces = smoothstep(0.0012, 0.0035, dot(swell, normalize(vec2(-0.5, 0.55))));
  col += uSpark * step(0.986, h1) * tw * faces * 0.55 * uSun;
  vec2 bl = (p - vec2(0.0, uRes.y)) / (0.55 * uRes.x);
  col += uLight * uLightA * 0.2 * exp(-dot(bl, bl) * 1.6);
  vec2 vu = p / uRes - 0.5;
  col *= 1.0 - 0.15 * pow(length(vu * vec2(1.0, 1.2)) * 1.25, 2.4);

  // the jolly boat and its wave lines, glass on the water: the hull holds water, the sail is
  // frosted, the mast a thin rod; the first wave line runs in front of the hull
  if (uBoat.w > 0.0) {
    float S = uBoat.w;
    vec2 bp = p - uBoat.xy;
    float ct = cos(uBoat.z), st = sin(uBoat.z);
    bp = vec2(ct * bp.x + st * bp.y, -st * bp.x + ct * bp.y);
    vec2 lp = vec2(bp.x / S + 14.0, 21.2 - bp.y / S);
    if (lp.x > -1.0 && lp.x < 29.0 && lp.y > 0.5 && lp.y < 24.5) {
      vec2 dx = vec2(0.05, 0.0), dy = vec2(0.0, 0.05);
      float dh = (sdHull(lp) - 0.35) * S;
      float ds = (sdSail(lp) - 0.25) * S;
      float dm = (sdSeg(lp, vec2(14.4, 1.6), vec2(14.4, 17.2)) - 0.42) * S;
      vec3 behind = col;
      if (ds < 1.0) {
        vec2 g = normalize(vec2(sdSail(lp + dx) - sdSail(lp - dx), sdSail(lp + dy) - sdSail(lp - dy)) + 1e-5);
        float e = max(-ds, 0.0);
        float k = clamp(1.0 - e / 6.0, 0.0, 1.0);
        vec3 body = pool(q - vec2(g.x, -g.y) * k * 7.0, T, focus);
        body = mix(body, uSpark, mix(0.62, 0.32, uDeep));
        body += uIrid * 0.12 * k * k * (0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + lp.y * 0.05 + T * 0.04)));
        body = mix(body, uSpark, 0.5 * k * k * max(0.0, dot(vec2(g.x, -g.y), normalize(vec2(-1.0, 1.0)))));
        body = mix(body, uEdge, clamp(uEdgeA * 1.8, 0.0, 1.0) * smoothstep(1.4, 0.2, abs(ds)));
        col = mix(col, body, smoothstep(1.0, -1.0, ds));
      }
      if (dm < 1.0) col = mix(col, mix(uEdge, uFg, 0.55), smoothstep(1.0, -0.6, dm) * 0.9);
      if (dh < 1.0) {
        vec2 g = normalize(vec2(sdHull(lp + dx) - sdHull(lp - dx), sdHull(lp + dy) - sdHull(lp - dy)) + 1e-5);
        float e = max(-dh, 0.0);
        float k = clamp(1.0 - e / 7.0, 0.0, 1.0);
        vec3 body = pool(q - vec2(g.x, -g.y) * k * 9.0, T, focus);
        body = mix(body, mix(uLiqA, uLiqB, clamp((lp.y - 17.0) / 6.0, 0.0, 1.0)), 0.74);
        body += uSpark * 0.42 * smoothstep(1.5, 0.3, lp.y - 17.3) * step(1.5, e);
        body = mix(body, uSpark, 0.45 * k * k * max(0.0, dot(vec2(g.x, -g.y), normalize(vec2(-1.0, 1.0)))));
        body = mix(body, uEdge, clamp(uEdgeA * 1.8, 0.0, 1.0) * smoothstep(1.4, 0.2, abs(dh)));
        col = mix(col, body, smoothstep(1.0, -1.0, dh));
      }
    }
  }
  if (uWaterY > 0.0 && p.y < uWaterY + 26.0 && p.y > uWaterY - 60.0) {
    for (int k = 0; k < 3; k++) {
      float fk = float(k);
      float y = waveY(fk, p.x, T);
      float dyx = (waveY(fk, p.x + 1.0, T) - waveY(fk, p.x - 1.0, T)) * 0.5;
      float dist = (p.y - y) / sqrt(1.0 + dyx * dyx);
      float th = 2.6 - 0.5 * fk;
      float a = smoothstep(th + 1.0, th - 0.2, abs(dist)) * (1.0 - 0.3 * fk);
      if (a > 0.0) {
        float side = clamp(dist / th, -1.0, 1.0);
        vec3 rod = mix(uLiqB, uLiqA, 0.5 + side * 0.5);
        rod = mix(rod, uSpark, smoothstep(0.15, 0.95, side) * 0.75);
        col = mix(col, rod, a * 0.88);
      }
    }
  }

  col += (hash(gl_FragCoord.xy + fract(T) * 61.0) - 0.5) / 255.0;
  o = vec4(col, 1.0);
}
`;

export const GLASS_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uWater;
uniform vec2 uRes;
uniform float uScale;
uniform float uTime;
uniform float uMaxLod;
uniform vec2 uPtr;
uniform float uPtrIn;
uniform vec4 uRect[8];   // x, y (bottom left), w, h
uniform vec4 uRad[8];    // radii: top left, top right, bottom right, bottom left
uniform vec4 uClip[8];   // x0, y0, x1, y1
uniform float uAlpha[8];
uniform int uN;
uniform vec3 uGlass, uEdge, uLight, uShade;
uniform float uGlassA, uEdgeA, uLightA, uShadeA, uIrid, uDeep;
out vec4 o;
${COMMON}

float sdRB(vec2 p, vec2 b, vec4 r) {
  // r: top right, bottom right, top left, bottom left
  r.xy = (p.x > 0.0) ? r.xy : r.zw;
  r.x = (p.y > 0.0) ? r.x : r.y;
  vec2 q = abs(p) - b + r.x;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r.x;
}

float shape(int i, vec2 p) {
  vec4 R = uRect[i];
  vec4 r = uRad[i];
  return sdRB(p - (R.xy + R.zw * 0.5), R.zw * 0.5, vec4(r.y, r.z, r.x, r.w));
}

// the membrane: slow noise and two angular sines push the edge, and it bulges toward the pointer
float panelSd(int i, vec2 p, float T) {
  vec4 R = uRect[i];
  vec2 lp = p - (R.xy + R.zw * 0.5);
  float a = atan(lp.y, lp.x);
  float ph = float(i) * 1.7;
  vec2 ring = vec2(cos(a), sin(a));
  float wob = (vnoise(ring * 1.6 + vec2(ph, T * 0.35)) - 0.5) * 1.6 + 0.35 * sin(a * 3.0 + T * 0.7 + ph) + 0.25 * sin(a * 5.0 - T * 0.9);
  vec2 dp = p - uPtr;
  return shape(i, p) - 2.0 * wob - 7.0 * uPtrIn * exp(-dot(dp, dp) / (76.0 * 76.0));
}

const vec2 K[8] = vec2[8](vec2(1.0, 0.0), vec2(0.42, 0.42), vec2(0.0, 1.0), vec2(-0.42, 0.42), vec2(-1.0, 0.0), vec2(-0.42, -0.42), vec2(0.0, -1.0), vec2(0.42, -0.42));

vec3 frost(vec2 q, float R, float lod) {
  vec3 s = vec3(0.0);
  for (int i = 0; i < 8; i++) s += textureLod(uWater, (q + K[i] * R) / uRes, lod).rgb;
  return s / 8.0;
}

vec3 glass(int i, vec2 p, float d, float T) {
  vec2 g = vec2(panelSd(i, p + vec2(1.0, 0.0), T) - panelSd(i, p - vec2(1.0, 0.0), T), panelSd(i, p + vec2(0.0, 1.0), T) - panelSd(i, p - vec2(0.0, 1.0), T));
  g = normalize(g + 1e-5);
  float e = max(-d, 0.0);
  float k = clamp(1.0 - e / 18.0, 0.0, 1.0);
  float k2 = k * k;

  // refraction through the quarter-circle rim, a chromatic split, then frost and the tint
  vec2 off = -g * k * 13.0;
  float lod = clamp(log2(max(16.0 * uScale / 3.0, 1.0)), 0.0, uMaxLod);
  vec3 c = frost(p + off, 15.0, lod);
  c.r = mix(c.r, textureLod(uWater, (p + off * 1.06) / uRes, lod).r, 0.6);
  c.b = mix(c.b, textureLod(uWater, (p + off * 0.94) / uRes, lod).b, 0.6);
  c = mix(c, uGlass, uGlassA);

  // light: glow carried along the bottom inner rim, fresnel whitening, thin film colours
  c += uLight * uLightA * 0.5 * k2 * smoothstep(-0.2, 0.9, -g.y);
  c = mix(c, mix(vec3(1.0), uLight, uDeep), 0.3 * k2 * k);
  float ang = atan(g.y, g.x);
  c += uIrid * 0.1 * k2 * (0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + ang * 0.35 + T * 0.04)));

  // a gloss cap over the upper part, at most 30 px tall
  vec4 R = uRect[i];
  float ty = R.y + R.w - p.y;
  float xn = (p.x - (R.x + R.z * 0.5)) / (R.z * 0.5);
  float capH = min(30.0, R.w * 0.4) * (1.0 - 0.3 * xn * xn);
  float cap = (1.0 - smoothstep(capH * 0.7, capH, ty)) * smoothstep(2.0, 7.0, e) * mix(0.66, 0.05, clamp(ty / capH, 0.0, 1.0));
  c = mix(c, vec3(1.0), 0.38 * cap * mix(1.0, 0.5, uDeep));

  // window streaks that slide against the pointer
  float s = p.x * 0.8 + p.y * 0.55 - uPtr.x * 0.35 - uPtr.y * 0.2;
  c += vec3(pow(0.5 + 0.5 * sin(s * 0.021), 22.0) * 0.06 + pow(0.5 + 0.5 * sin(s * 0.043 + 1.3), 34.0) * 0.045) * mix(1.0, 0.5, uDeep);

  // specular from the top left, a 1 px inner highlight, the outline
  c += vec3(0.45) * k2 * k * max(0.0, dot(g, normalize(vec2(-1.0, 1.0))));
  c = mix(c, vec3(1.0), 0.5 * smoothstep(2.6, 1.6, e) * smoothstep(0.4, 1.2, e) * (0.4 + 0.6 * max(g.y, 0.0)) * mix(1.0, 0.55, uDeep));
  c = mix(c, uEdge, clamp(uEdgeA * 1.4, 0.0, 1.0) * smoothstep(1.4, 0.2, abs(d)));
  return c;
}

void main() {
  vec2 p = gl_FragCoord.xy / uScale;
  vec3 col = texture(uWater, p / uRes).rgb;
  float T = uTime;

  // soft shadows of the same shapes, 7 px down
  float sh = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= uN) break;
    vec4 cl = uClip[i];
    if (p.x < cl.x || p.y < cl.y - 20.0 || p.x > cl.z || p.y > cl.w) continue;
    float ds = shape(i, p + vec2(0.0, 7.0));
    sh = max(sh, (1.0 - smoothstep(-6.0, 16.0, ds)) * uAlpha[i]);
  }

  float best = 1e5;
  int bi = -1;
  for (int i = 0; i < 8; i++) {
    if (i >= uN) break;
    vec4 cl = uClip[i];
    if (p.x < cl.x || p.y < cl.y || p.x > cl.z || p.y > cl.w) continue;
    if (shape(i, p) > 14.0) continue;
    float d = panelSd(i, p, T);
    if (d < best) { best = d; bi = i; }
  }

  col = mix(col, uShade, uShadeA * 0.8 * sh * smoothstep(-1.0, 1.0, best));
  if (bi >= 0 && best < 1.5) col = mix(col, glass(bi, p, best, T), smoothstep(1.0, -1.0, best) * uAlpha[bi]);
  o = vec4(col, 1.0);
}
`;
