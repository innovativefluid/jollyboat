// the water look's shaders, ported from the aquacard design study (qml/Aqua/shaders) to webgl2.
// everything works in css px with y down, like the study; gl's own y-up framebuffer rows are
// turned around where a position is made (p.y = view.y - gl_FragCoord.y / scale).
//
// SIM    one step of a damped wave equation, one fragment per 5 × 5 px cell, ping-ponged in an
//        rgba16f texture (height, previous height, gradient x, gradient y). rows are y-down.
// WATER  the lit surface over a luminous pool: simulated ripples (bicubic), a slow swell, fine
//        wind texture; under it gradient, aurora ribbons, shafts, caustics focused by the
//        ripples, air bubbles as diverging lenses; sky reflection, glints, glitter, bloom.
// GLASS  one glass element (a panel, a pill, a well, the boat's hull, a wave line...): a shape
//        with a wobbling membrane that squashes and jiggles (it does not follow the pointer); the water
//        behind refracted, frosted and tinted; water inside it; rim light, thin film, gloss cap,
//        window streaks, specular, outline; a soft shadow and a halo around it.
// TITLE  glass letters holding water, from a text mask; PEARLS a string of drifting glass beads.

export const VS_FULL = /* glsl */ `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0); }
`;

// an element's quad: uQuad is its effect box (shape + pad) in css px, y down
export const VS_QUAD = /* glsl */ `#version 300 es
in vec2 aPos;
uniform vec4 uQuad;
uniform vec2 uView;
out vec2 vPos;
void main() {
  vPos = aPos * uQuad.zw;
  vec2 p = uQuad.xy + vPos;
  gl_Position = vec4(p.x / uView.x * 2.0 - 1.0, 1.0 - p.y / uView.y * 2.0, 0.0, 1.0);
}
`;

const NOISE = /* glsl */ `
const float TAU = 6.28318531;
float hash1(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 hash2(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash1(i), hash1(i + vec2(1, 0)), u.x), mix(hash1(i + vec2(0, 1)), hash1(i + vec2(1, 1)), u.x), u.y);
}
`;

export const SIM_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D prev;
uniform vec2 cells;
uniform vec4 wakeA;   // pointer now: x, y (cells) | radius (cells) | amount
uniform vec4 wakeB;   // pointer one step ago
uniform vec4 drop0, drop1, drop2, drop3;
uniform float speed, damping;
out vec4 o;

float H(vec2 uv) { return texture(prev, uv).r; }
float bump(vec2 c, vec4 d) {
  if (d.w == 0.0) return 0.0;
  float r = length(c - d.xy) / d.z;
  return r < 1.0 ? d.w * (0.5 + 0.5 * cos(3.14159265 * r)) : 0.0;
}
float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
  return length(pa - ba * h);
}

void main() {
  vec2 uv = gl_FragCoord.xy / cells;
  vec2 t = 1.0 / cells;
  vec4 c = texture(prev, uv);
  float h = c.r, hp = c.g;
  float l = H(uv - vec2(t.x, 0.0)), r = H(uv + vec2(t.x, 0.0));
  float u = H(uv - vec2(0.0, t.y)), d = H(uv + vec2(0.0, t.y));
  float ul = H(uv - t), dr = H(uv + t);
  float ur = H(uv + vec2(t.x, -t.y)), dl = H(uv + vec2(-t.x, t.y));
  // isotropic 9-point laplacian: ripples stay round instead of turning into diamonds
  float lap = (4.0 * (l + r + u + d) + (ul + ur + dl + dr) - 20.0 * h) / 6.0;
  // soak waves up near the window edges so they do not bounce back as clutter
  vec2 cell = uv * cells;
  float edge = min(min(cell.x, cells.x - cell.x), min(cell.y, cells.y - cell.y));
  float damp = damping * mix(0.86, 1.0, smoothstep(0.0, 9.0, edge));
  float hn = h + (h - hp) * damp + speed * lap;
  hn *= 0.9994;
  hn += bump(cell, drop0) + bump(cell, drop1) + bump(cell, drop2) + bump(cell, drop3);
  if (wakeA.w != 0.0) {
    float sd = segDist(cell, wakeB.xy, wakeA.xy);
    hn += wakeA.w * exp(-(sd * sd) / (wakeA.z * wakeA.z));
  }
  o = vec4(hn, h, (r - l) * 0.5, (d - u) * 0.5);
}
`;

export const WATER_FS = /* glsl */ `#version 300 es
precision highp float;
uniform vec2 view;        // css px
uniform vec2 poolView;    // the size the pool's gradient spans (the window, for a bar)
uniform vec2 poolOffset;  // where this canvas sits in that
uniform float scale;      // device px per css px of this pass
uniform vec2 cells;
uniform float cell;
uniform float time;
uniform vec4 cTop, cMid, cBot, cLight, cSky, cBubble;
uniform float caustics, sun, swell, depth, rippleGain, simOn;
uniform vec4 bub[14];     // x, y, r, alpha
uniform sampler2D sim;
out vec4 o;
${NOISE}

// value noise with analytic derivatives: x = value, yz = gradient
vec3 vnoised(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 du = 6.0 * f * (1.0 - f);
  float a = hash1(i), b = hash1(i + vec2(1, 0)), c = hash1(i + vec2(0, 1)), d = hash1(i + vec2(1, 1));
  float k = a - b - c + d;
  return vec3(a + (b - a) * u.x + (c - a) * u.y + k * u.x * u.y, du * (vec2(b - a, c - a) + k * u.yx));
}

// bicubic b-spline fetch from four bilinear taps: smooth normals from a coarse grid
vec4 cubicTex(sampler2D t, vec2 uv, vec2 ts) {
  vec2 st = uv * ts - 0.5;
  vec2 i = floor(st), f = st - i;
  vec2 f2 = f * f, f3 = f2 * f;
  vec2 w0 = (-f3 + 3.0 * f2 - 3.0 * f + 1.0) / 6.0;
  vec2 w1 = (3.0 * f3 - 6.0 * f2 + 4.0) / 6.0;
  vec2 w2 = (-3.0 * f3 + 3.0 * f2 + 3.0 * f + 1.0) / 6.0;
  vec2 w3 = f3 / 6.0;
  vec2 g0 = w0 + w1, g1 = w2 + w3;
  vec2 h0 = (i - 1.0 + w1 / g0 + 0.5) / ts;
  vec2 h1 = (i + 1.0 + w3 / g1 + 0.5) / ts;
  vec4 a = texture(t, vec2(h0.x, h0.y)), b = texture(t, vec2(h1.x, h0.y));
  vec4 c = texture(t, vec2(h0.x, h1.y)), d = texture(t, vec2(h1.x, h1.y));
  return g0.y * (g0.x * a + g1.x * b) + g1.y * (g0.x * c + g1.x * d);
}

// voronoi border distance: ~0 on the cell walls, where caustic light gathers
float voro(vec2 p, float t) {
  vec2 ip = floor(p), fp = fract(p);
  float d1 = 9.0, d2 = 9.0;
  for (int j = -1; j <= 1; ++j)
    for (int i = -1; i <= 1; ++i) {
      vec2 g = vec2(float(i), float(j));
      vec2 o2 = hash2(ip + g);
      o2 = 0.5 + 0.42 * sin(t * (0.45 + 0.5 * o2.yx) + TAU * o2);
      vec2 r = g + o2 - fp;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
    }
  return sqrt(d2) - sqrt(d1);
}
float causticAt(vec2 q, float t) {
  vec2 p = q / 120.0;
  p += 0.22 * vec2(sin(p.y * 2.3 + t * 0.41), cos(p.x * 1.9 - t * 0.33));
  float e1 = voro(p, t * 0.85);
  float e2 = voro(p * 1.7 + vec2(3.7, 1.9), t * 1.1 + 1.3);
  float c1 = exp(-e1 * 10.0), c2 = exp(-e2 * 13.0);
  return c1 * 0.7 + c2 * 0.45 + c1 * c2 * 1.4;
}
float ribbon(vec2 uv, float k, float t) {
  float yc = 0.60 + 0.13 * sin(uv.x * 2.2 + t * 0.055 + k * 2.3) + 0.05 * sin(uv.x * 5.3 - t * 0.083 + k * 4.1) - k * 0.11;
  float w = 0.06 + 0.03 * sin(uv.x * 3.1 + k * 1.7 + t * 0.04);
  float dy = uv.y - yc;
  float sheet = exp(-pow(max(dy, 0.0) / (w * 2.4), 2.0)) * smoothstep(-0.003, 0.003, dy);
  float edge = exp(-pow(dy / 0.0028, 2.0));
  float halo = exp(-pow(dy / (w * 0.8), 2.0));
  return sheet * 0.30 + edge * 0.75 + halo * 0.20;
}
vec3 poolAt(vec2 q0, float focus) {
  vec2 q = q0 + poolOffset;
  vec2 uv = q / poolView;
  float y = clamp(uv.y + 0.05 * sin(uv.x * 2.7 + time * 0.04), 0.0, 1.0);
  vec3 col = mix(cTop.rgb, cMid.rgb, smoothstep(0.0, 0.55, y));
  col = mix(col, cBot.rgb, smoothstep(0.45, 1.05, y));
  col = mix(col, cBot.rgb, 0.28 * smoothstep(0.4, 1.3, uv.x * 0.8 + uv.y * 0.5));
  // aurora ribbons, the swoosh of the era
  float rb = ribbon(uv, 0.0, time) + 0.7 * ribbon(uv + vec2(0.3, 0.0), 1.0, time * 1.2) + 0.45 * ribbon(uv * vec2(1.3, 1.0), 2.0, time * 0.8);
  col = mix(col, cLight.rgb, clamp(rb * 0.42 * cLight.w, 0.0, 0.9));
  // light shafts from above the top left corner
  vec2 v = q - vec2(-0.08, -0.45) * poolView;
  float a = atan(v.y, v.x);
  float sh = 0.5 + 0.5 * sin(a * 23.0 + time * 0.11) * sin(a * 37.0 - time * 0.07 + 1.7);
  sh = pow(sh, 3.0) * exp(-length(v) / (poolView.y * 1.25));
  col += cLight.rgb * sh * 0.20 * cLight.w;
  // caustics, stronger near the light, focused or spread by the ripples above
  float patchy = 0.3 + 0.9 * smoothstep(0.25, 0.8, vnoised(q / 380.0 + vec2(time * 0.015, -time * 0.011)).x);
  float ca = causticAt(q, time) * caustics * (0.62 + 0.38 * (1.0 - y)) * patchy * focus;
  col += cLight.rgb * ca * 0.30;
  return col;
}

vec3 bubble(vec3 col, vec2 q, vec4 b, float idx, float focus) {
  if (b.z <= 0.5 || b.w <= 0.0) return col;
  vec2 dv = q - b.xy;
  float r0 = b.z;
  if (dot(dv, dv) > r0 * r0 * 1.7) return col;
  float ang = atan(dv.y, dv.x);
  float r = r0 * (1.0 + 0.035 * sin(3.0 * ang + time * 2.1 + idx) + 0.025 * sin(5.0 * ang - time * 2.9 + idx * 2.3));
  float d = length(dv);
  float nd = d / r;
  float aa = fwidth(d) + 0.5;
  float body = clamp((r - d) / aa + 0.5, 0.0, 1.0);
  if (body <= 0.0) {
    // a faint contact shadow / glow just outside the rim
    float halo = exp(-(d - r) / (r * 0.18)) * 0.10 * b.w;
    return mix(col, cBubble.rgb * 0.7, halo);
  }
  // an air bubble in water is a diverging lens: it shows a wider, upright view
  float k = 1.35 + 1.1 * nd * nd;
  vec3 inside = poolAt(b.xy + dv * k, focus) * 1.06 + 0.04;
  float rim = smoothstep(0.55, 1.0, nd);
  float th = nd * 2.2 + ang * 0.25 + time * 0.15 + idx;
  vec3 film = 0.5 + 0.5 * cos(TAU * (th + vec3(0.0, 0.33, 0.67)));
  vec3 c = mix(inside, vec3(1.0), rim * rim * 0.55);
  c = mix(c, c * 0.55 + film * 0.55, rim * rim * 0.30);
  c = mix(c, cBubble.rgb, smoothstep(0.86, 1.0, nd) * 0.55);
  c = mix(c, vec3(1.0), exp(-pow((nd - 0.9) / 0.05, 2.0)) * 0.6);
  // highlights: a soft window up-left, a small bounce down-right
  vec2 hp = (dv / r - vec2(-0.36, -0.42)) * vec2(1.0, 1.5);
  hp = mat2(0.80, 0.60, -0.60, 0.80) * hp;
  float hl = smoothstep(0.30, 0.05, length(hp * vec2(1.0, 1.7)));
  c = mix(c, vec3(1.0), hl * 0.92);
  float hl2 = smoothstep(0.13, 0.0, length(dv / r - vec2(0.45, 0.48)));
  c = mix(c, vec3(1.0), hl2 * 0.6);
  return mix(col, c, body * b.w * cBubble.w);
}

void main() {
  vec2 p = vec2(gl_FragCoord.x / scale, view.y - gl_FragCoord.y / scale);
  vec2 tc = p / view;

  // simulated ripples
  vec2 slope = vec2(0.0);
  float focus = 1.0;
  if (simOn > 0.5) {
    vec4 s = cubicTex(sim, tc, cells);
    slope = s.zw * rippleGain / cell;
    // soft limit: a hard splash bends the light a lot, but never tears the picture
    slope = slope / (1.0 + length(slope) * 1.4);
    vec2 tx = 1.0 / cells;
    float lap = (texture(sim, tc + vec2(tx.x, 0.0)).z - texture(sim, tc - vec2(tx.x, 0.0)).z
      + texture(sim, tc + vec2(0.0, tx.y)).w - texture(sim, tc - vec2(0.0, tx.y)).w) * 0.5;
    focus = clamp(1.0 - lap * rippleGain * 9.0, 0.45, 2.6);
  }
  vec2 simSlope = slope;

  // slow swell: the same four-sine plasma as the lcd paper, now as a height field
  vec2 c5 = p / 5.0;
  vec2 rc = (p - view * 0.5) / 5.0;
  float rl = length(rc) + 1e-3;
  float tt = time * 0.6;
  float a1 = c5.x * 0.085 + tt, a2 = c5.y * 0.11 - 0.7 * tt;
  float a3 = c5.x * 0.06 + c5.y * 0.07 + 0.5 * tt, a4 = rl * 0.09 - 0.9 * tt;
  vec2 gs = vec2(0.085 * cos(a1) + 0.06 * cos(a3) + 0.09 * cos(a4) * rc.x / rl, 0.11 * cos(a2) + 0.07 * cos(a3) + 0.09 * cos(a4) * rc.y / rl);
  slope += gs * swell;

  // fine wind texture (kept out of the glint term so the sun does not paint blobs)
  vec3 g1 = vnoised(p / 34.0 + vec2(time * 0.21, -time * 0.17));
  vec3 g2 = vnoised(p / 15.0 + vec2(-time * 0.29, time * 0.23) + 7.3);
  vec2 fine = (g1.yz / 34.0 * 1.6 + g2.yz / 15.0 * 0.6) * swell;
  vec2 smoothSlope = slope;
  slope += fine;
  vec3 nsim = normalize(vec3(-simSlope, 1.0));
  vec3 n = normalize(vec3(-slope, 1.0));
  vec3 ns = normalize(vec3(-smoothSlope, 1.0));

  // refraction through the surface
  vec2 q = p + n.xy * depth;
  vec3 col = poolAt(q, focus);
  for (int i = 0; i < 14; i++) col = bubble(col, q, bub[i], float(i), focus);

  // the ripples catch light on one flank and shade the other
  vec3 L = normalize(vec3(-0.22, -0.30, 0.93));
  col *= clamp(1.0 + dot(-slope, L.xy) * 1.8, 0.82, 1.25);

  // reflection of a bright sky (fresnel), sun glints on the crests
  vec3 R = vec3(2.0 * n.z * n.xy, 2.0 * n.z * n.z - 1.0);
  float fres = 0.02 + 0.98 * pow(1.0 - n.z, 5.0);
  vec3 sky = mix(cSky.rgb, vec3(1.0), smoothstep(0.0, -0.5, R.y));
  col = mix(col, sky, clamp(fres * cSky.w * 6.0, 0.0, 0.55));
  // glints: crisp highlights on the ripple flanks, plus glitter specks where the surface faces
  // the sun (tiny round spots that twinkle in and out)
  vec3 Rs = vec3(2.0 * ns.z * ns.xy, 2.0 * ns.z * ns.z - 1.0);
  vec3 Rr = vec3(2.0 * nsim.z * nsim.xy, 2.0 * nsim.z * nsim.z - 1.0);
  float rl2 = max(dot(Rs, L), 0.0);
  float rr2 = max(dot(Rr, L), 0.0);
  col += sun * (pow(rr2, 700.0) * 1.5 + pow(rr2, 90.0) * 0.18);
  vec2 gc = floor(p / 5.0);
  vec2 gj = hash2(gc + 3.1);
  float gh = hash1(gc);
  vec2 gp = (gc + 0.2 + 0.6 * gj) * 5.0;
  float tw = 0.5 + 0.5 * sin(time * (2.0 + 5.0 * gh) + gh * 40.0);
  float face = smoothstep(0.55, 0.95, pow(rl2, 24.0));
  float spot = step(0.975, gh) * pow(tw, 8.0) * face * exp(-dot(p - gp, p - gp) / 0.9);
  col += sun * spot * 1.4;

  // a gentle bloom from the top left, a little depth toward the corners
  vec2 uv = (p + poolOffset) / poolView;
  col += cLight.rgb * 0.05 * cLight.w * exp(-dot(uv - vec2(0.12, 0.0), uv - vec2(0.12, 0.0)) * 3.0);
  col *= 1.0 - 0.10 * pow(length((uv - 0.5) * vec2(1.1, 1.3)), 2.5);

  // tiny dither, no banding in the smooth gradients
  col += (hash1(p + fract(time)) - 0.5) / 255.0;
  o = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

export const GLASS_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vPos;
uniform vec2 size;       // effect size, px (shape size + 2 * pad)
uniform float pad;
uniform vec4 radii;      // top left, top right, bottom right, bottom left
uniform float hover, press, time, seed, wobble;
uniform vec4 jiggle;     // click x, y (effect px) | start time | strength
uniform float bevel, refr, frost;
uniform vec4 tint, edge;
uniform float gloss, streaks, irid;
uniform vec4 shade;
uniform float lift;
uniform vec4 glow;
uniform float halo, inset;
uniform vec4 liqA, liqB;
uniform vec4 liquid;     // level 0..1 | mode 0 none, 1 rises from the bottom, 2 fills from the left | wave px | speed
uniform float slosh, flow;
uniform vec2 screen;     // the framebuffer, device px
uniform float alpha;
uniform sampler2D bg;
// shapes beyond the rounded box (the boat and its waves): kind 1 hull, 2 sail, 3 a wave line.
// shapeA: scale (px per icon unit), the shape's centre in icon units (x, y), rotation.
// wave: x0 of the effect in the window, base y, wave index, thickness
uniform int kind;
uniform vec4 shapeA;
uniform vec4 wave;
out vec4 o;
${NOISE}

vec2 B;   // half extents of the box

float sdBox(vec2 p, vec2 b, vec4 r) {
  float rr = p.x > 0.0 ? (p.y > 0.0 ? r.z : r.y) : (p.y > 0.0 ? r.w : r.x);
  rr = min(rr, min(b.x, b.y));
  vec2 q = abs(p) - b + rr;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - rr;
}

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
float waveY(vec2 pw) {
  float k = wave.z;
  return wave.y + k * 15.0 + 8.0 * sin(pw.x * 0.018 + time * 0.6 + k * 1.3) + 4.0 * sin(pw.x * 0.046 - time * 0.9 + k);
}
float baseShape(vec2 p) {
  if (kind == 0) return sdBox(p, B, radii);
  if (kind == 3) {
    vec2 pw = p + B + pad + vec2(wave.x, 0.0);
    float y = waveY(pw);
    float dy = (waveY(pw + vec2(1.0, 0.0)) - waveY(pw - vec2(1.0, 0.0))) * 0.5;
    return abs(pw.y - y) / sqrt(1.0 + dy * dy) - wave.w;
  }
  float c = cos(shapeA.w), s = sin(shapeA.w);
  vec2 u = vec2(c * p.x + s * p.y, -s * p.x + c * p.y) / shapeA.x + shapeA.yz;
  return (kind == 1 ? sdHull(u) - 0.35 : sdSail(u) - 0.25) * shapeA.x;
}

float shapeAt(vec2 p) {
  float d = baseShape(p);
  if (wobble > 0.0) {
    vec2 np = p * 0.045 + vec2(time * 0.35 + seed * 7.1, -time * 0.27 + seed * 3.3);
    float w = (vnoise(np) - 0.5) * 2.0;
    float ang = atan(p.y / max(B.y, 1.0), p.x / max(B.x, 1.0));
    w += 0.55 * sin(ang * 3.0 + time * 1.7 + seed * 5.0) * sin(ang * 2.0 - time * 1.1 + seed);
    d -= wobble * (1.0 + 0.9 * hover) * w * 0.5;
  }
  return d;
}

const vec2 disk[12] = vec2[12](
  vec2(-0.326, -0.406), vec2(-0.840, -0.074), vec2(-0.696, 0.457), vec2(-0.203, 0.621),
  vec2(0.962, -0.195), vec2(0.473, -0.480), vec2(0.519, 0.767), vec2(0.185, -0.893),
  vec2(0.507, 0.064), vec2(0.896, 0.412), vec2(-0.322, -0.933), vec2(-0.792, -0.598));

void main() {
  vec2 pos = vPos;
  vec2 C = size * 0.5;
  B = size * 0.5 - pad + hover * 0.8;
  float px = max(fwidth(pos.x), 1e-3);

  // squash on press, wobble back after a click
  float tj = time - jiggle.z;
  float jig = tj >= 0.0 ? jiggle.w * exp(-tj * 4.2) * sin(tj * 25.0) : 0.0;
  float sizeK = clamp(34.0 / max(B.y, 1.0), 0.12, 1.0);
  float sq = (press * 0.055 + jig * 0.075) * sizeK;
  vec2 scl = vec2(1.0 + sq * 0.8, 1.0 - sq);
  vec2 p = (pos - C) / scl;

  float d = shapeAt(p);
  const float e = 0.6;
  vec2 g = vec2(shapeAt(p + vec2(e, 0.0)) - d, shapeAt(p + vec2(0.0, e)) - d) / e;
  float gl = length(g);
  g = gl > 1e-4 ? g / gl : vec2(0.0, -1.0);
  float aa = clamp(0.5 - d / px, 0.0, 1.0);

  // ---- outside: soft shadow and halo
  float dsh = shapeAt(p - vec2(0.0, lift * (1.0 + 0.4 * hover - 0.6 * press)));
  float shA = shade.w * (1.0 - smoothstep(-lift * 0.8, lift * 3.2 + 2.0, dsh));
  float on = max(hover * 0.75, halo);
  float glA = glow.w * on * exp(-max(d, 0.0) / (5.0 + 3.0 * halo)) * step(0.0, d);
  vec4 outside = vec4(glow.rgb * glA, glA) + vec4(shade.rgb * shA, shA) * (1.0 - glA);
  if (aa <= 0.0) { o = outside * alpha; return; }

  // ---- surface normal from the rim profile (a quarter circle of width bevel)
  float t = clamp(-d / max(bevel, 0.5), 0.0, 1.0);
  float s = 1.0 - t;
  float k = s / sqrt(max(1.0 - s * s, 0.03));
  vec2 nxy = g * k * mix(1.0, -0.55, inset);
  // click ripple travelling across the body
  vec2 jp = pos - jiggle.xy;
  float jr = length(jp);
  float ring = tj >= 0.0 ? exp(-pow((jr - tj * 260.0) / 8.0, 2.0)) * exp(-tj * 2.6) * jiggle.w : 0.0;
  nxy += (jr > 0.5 ? jp / jr : vec2(0.0)) * ring * 0.7;
  vec3 n = normalize(vec3(nxy, 1.0));

  // ---- what is behind: the water, refracted and frosted (the texture's rows run up)
  vec2 suv = gl_FragCoord.xy / screen;
  vec2 dev = 1.0 / (px * screen);
  vec2 off = vec2(n.x, -n.y) * refr * dev;
  vec3 sharp = vec3(texture(bg, suv + off * 1.06).r, texture(bg, suv + off).g, texture(bg, suv + off * 0.94).b);
  vec3 blur = vec3(0.0);
  if (frost > 0.01) {
    float rad = mix(3.0, 26.0, frost);
    float lod = log2(max(rad / (px * 4.0), 1.0));
    float rot = hash1(floor(pos)) * TAU;
    mat2 rm = mat2(cos(rot), sin(rot), -sin(rot), cos(rot));
    if (frost < 0.35) {
      // light frost (glass that fills a window): four taps a level further down the mips do
      for (int i = 0; i < 4; ++i) {
        vec2 q = vec2(i < 2 ? -0.6 : 0.6, (i & 1) == 0 ? -0.6 : 0.6);
        blur += textureLod(bg, suv + off + rm * q * rad * dev, lod + 0.5).rgb;
      }
      blur /= 4.0;
    } else {
      for (int i = 0; i < 12; ++i) blur += textureLod(bg, suv + off + rm * disk[i] * rad * dev, lod).rgb;
      blur /= 12.0;
    }
  }
  vec3 base = mix(sharp, blur, smoothstep(0.0, 0.2, frost));
  vec3 col = mix(base, tint.rgb, tint.w);

  // ---- liquid (it stays level: the boat's hull tilts, its water does not)
  if (liquid.y > 0.5 && liquid.x > 0.001) {
    float dl, depthK;
    vec2 lp = p;
    if (liquid.y < 1.5) {
      float yl = B.y - liquid.x * 2.0 * B.y;
      float wv = liquid.z * (0.6 * sin(lp.x * 0.11 + time * 3.3 + seed * 4.0) + 0.4 * sin(lp.x * 0.27 - time * 5.1 + seed));
      float ys = yl + wv + slosh * lp.x * 0.35;
      dl = lp.y - ys;
      depthK = clamp(dl / max(2.0 * B.y, 1.0), 0.0, 1.0);
    } else {
      float xl = -B.x + liquid.x * 2.0 * B.x;
      float wv = liquid.z * (sin(lp.y * 0.30 + time * 6.0) * (1.0 + 6.0 * liquid.w) + 0.6 * sin(time * 2.3 + seed));
      dl = (liquid.x >= 0.999 ? 1e4 : (xl + wv - lp.x));
      depthK = clamp((lp.y + B.y) / max(2.0 * B.y, 1.0), 0.0, 1.0);
      if (kind == 3) depthK = clamp(0.5 + (p.y + B.y + pad - waveY(p + B + pad + vec2(wave.x, 0.0))) / max(2.0 * wave.w, 1.0), 0.0, 1.0);
    }
    float inL = clamp(dl / px + 0.5, 0.0, 1.0);
    if (inL > 0.0) {
      vec3 lc = mix(liqA.rgb, liqB.rgb, smoothstep(0.0, 1.0, depthK));
      // the water behind shows through, darkened and tinted
      vec3 thru = mix(sharp, blur, 0.5);
      float lum = dot(thru, vec3(0.299, 0.587, 0.114));
      lc *= 0.72 + 0.5 * lum;
      // drifting light inside
      vec2 fp = lp + vec2(-flow * time, 0.0);
      float sh = sin(fp.x * 0.09 + sin(fp.y * 0.13 + time * 1.3) * 1.6 + time * 1.1) * sin(fp.y * 0.11 - time * 0.9 + fp.x * 0.03);
      lc += liqA.rgb * 0.16 * sh;
      // fizz: tiny bubbles climbing (and riding the flow)
      vec2 bp = (lp + vec2(-flow * time, time * 16.0)) / 9.0;
      vec2 bc = floor(bp);
      vec2 bh = hash2(bc + seed);
      vec2 bo = fract(bp) - 0.5 - (bh - 0.5) * 0.5;
      float br = 0.07 + 0.08 * bh.y;
      float bl = length(bo);
      float fz = step(0.66, bh.x) * (smoothstep(0.06, 0.0, abs(bl - br)) * 0.45 + smoothstep(br * 0.55, 0.0, length(bo + br * 0.35)) * 0.5);
      lc = mix(lc, vec3(1.0), fz * 0.6);
      // meniscus: a bright skin and a shadow just under it
      float men = exp(-pow(dl / 1.3, 2.0));
      float under = exp(-pow((dl - 3.5) / 2.5, 2.0));
      lc = mix(lc, lc * 0.82, under * 0.5);
      lc = mix(lc, vec3(1.0), men * 0.75);
      col = mix(col, lc, inL * liqA.w);
    }
  }

  // ---- the glass itself
  float v = clamp((p.y + B.y) / max(2.0 * B.y, 1.0), 0.0, 1.0);
  vec3 L = normalize(vec3(-0.45, -0.62, 0.64));
  vec3 Hh = normalize(L + vec3(0.0, 0.0, 1.0));
  float ndh = max(dot(n, Hh), 0.0);
  float rimF = pow(1.0 - n.z, 1.6);
  float raised = 1.0 - inset;
  // transmitted light gathers at the bottom inner rim
  float bot = smoothstep(0.35, 1.0, v) * exp(d / max(bevel * 0.9, 1.0));
  col += mix(vec3(0.75, 0.95, 1.0), liqA.rgb + 0.35, 0.3) * bot * (0.22 + 0.25 * hover) * raised;
  // fresnel: rims turn white, then pick up thin-film colour
  col = mix(col, vec3(1.0), rimF * 0.45 * raised);
  float th = vnoise(p * 0.03 + vec2(time * 0.08, seed)) * 2.2 + n.x * 0.8 - n.y * 0.5 + time * 0.05;
  vec3 film = 0.5 + 0.5 * cos(TAU * (th + vec3(0.0, 0.33, 0.67)));
  col = mix(col, col * 0.55 + film * 0.6, irid * rimF);
  // gloss cap: the bright lid over the upper half
  float capH = min(B.y * 0.86, 30.0);
  float curve = (p.x / max(B.x, 1.0)) * (p.x / max(B.x, 1.0)) * capH * 0.35;
  float capIn = smoothstep(px, -px, d + 1.8 + capH * 0.08);
  float capBot = -B.y + capH - curve;
  float cap = capIn * smoothstep(px * 1.5, -px * 1.5, p.y - capBot);
  float capA = cap * mix(0.66, 0.05, clamp((p.y + B.y) / capH, 0.0, 1.0));
  col = mix(col, vec3(1.0), capA * gloss);
  // window reflections
  if (streaks > 0.0) {
    float sx = p.x + p.y * 0.62 - B.x * 0.15;
    float s1 = smoothstep(0.0, 18.0, sx) * smoothstep(70.0, 40.0, sx);
    float s2 = smoothstep(95.0, 104.0, sx) * smoothstep(122.0, 112.0, sx);
    col = mix(col, vec3(1.0), (s1 * 0.10 + s2 * 0.08) * streaks * (1.0 - v * 0.7));
  }
  // specular from the light, top left
  col += vec3(1.0) * (pow(ndh, 70.0) * 0.85 + pow(ndh, 12.0) * 0.06) * raised;
  // recessed wells: a soft inner shadow along the top
  col *= 1.0 - inset * 0.16 * exp(d / 5.0) * (1.0 - v);
  // the thin bright inner line and the outline
  float inner = exp(-pow((d + 1.7) / 0.85, 2.0)) * (0.45 + 0.55 * (1.0 - v));
  col = mix(col, vec3(1.0), inner * 0.6 * (1.0 - 0.5 * inset));
  float outer = exp(-pow((d + 0.45) / 0.7, 2.0));
  col = mix(col, edge.rgb, outer * edge.w * (1.0 + 0.5 * halo));
  col = mix(col, glow.rgb, outer * glow.w * on * 0.6);
  col += (hash1(pos + fract(time)) - 0.5) / 255.0;

  vec4 inside = vec4(clamp(col, 0.0, 1.0), 1.0);
  o = (inside * aa + outside * (1.0 - aa)) * alpha;
}
`;

export const TITLE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vPos;
uniform vec2 size;
uniform float time, level, pad, slosh, alpha;
uniform vec4 glassCol, liqA, liqB, haloCol, shadeCol, edgeCol;
uniform sampler2D src;   // the text mask, rows down
out vec4 o;

void main() {
  vec2 uv = vPos / size;
  vec2 p = vPos;
  vec2 tx = 1.0 / size;
  float a = texture(src, uv).a;
  float l = textureLod(src, uv - vec2(1.6 * tx.x, 0.0), 1.2).a;
  float r = textureLod(src, uv + vec2(1.6 * tx.x, 0.0), 1.2).a;
  float u = textureLod(src, uv - vec2(0.0, 1.6 * tx.y), 1.2).a;
  float d = textureLod(src, uv + vec2(0.0, 1.6 * tx.y), 1.2).a;
  vec2 g = vec2(r - l, d - u);
  vec3 n = normalize(vec3(-g * 2.4, 1.0));
  float halo = textureLod(src, uv, 3.2).a;
  float shadow = textureLod(src, uv - vec2(0.0, 3.5 * tx.y), 2.2).a;
  // glass body
  float v = clamp((p.y - pad) / max(size.y - 2.0 * pad, 1.0), 0.0, 1.0);
  vec3 col = glassCol.rgb;
  // water inside the letters
  float ys = (1.0 - level) + 0.035 * sin(p.x * 0.05 + time * 2.6) + 0.02 * sin(p.x * 0.13 - time * 3.7) + slosh * (p.x / size.x - 0.5) * 0.25;
  float dl = (v - ys) * (size.y - 2.0 * pad);
  float inL = clamp(dl + 0.5, 0.0, 1.0);
  vec3 lc = mix(liqA.rgb, liqB.rgb, smoothstep(ys, 1.0, v));
  lc += 0.10 * sin(p.x * 0.08 + time * 1.4 + sin(p.y * 0.2 + time) * 1.5) * liqA.rgb;
  lc = mix(lc, vec3(1.0), exp(-pow(dl / 1.1, 2.0)) * 0.8);
  col = mix(col, lc, inL);
  // bevel light: white rim up-left, specular, fresnel
  vec3 L = normalize(vec3(-0.45, -0.65, 0.62));
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  float rimF = pow(1.0 - n.z, 1.5);
  col = mix(col, vec3(1.0), rimF * 0.55);
  col += pow(max(dot(n, H), 0.0), 40.0) * 0.8;
  // gloss over the upper half of the letters
  float cap = smoothstep(0.52, 0.40, v) * mix(0.55, 0.12, v / 0.52);
  col = mix(col, vec3(1.0), cap);
  // definition at the edge, from the blurred mask so it stays smooth
  float e = (l + r + u + d) * 0.25;
  float edgeL = smoothstep(0.05, 0.5, e) * (1.0 - smoothstep(0.5, 0.97, e));
  col = mix(col, edgeCol.rgb, edgeL * edgeCol.a);
  vec4 body = vec4(clamp(col, 0.0, 1.0), 1.0) * a;
  float ha = haloCol.a * halo * 0.9;
  float sa = shadeCol.a * shadow * 0.8;
  vec4 under = vec4(haloCol.rgb * ha, ha) + vec4(shadeCol.rgb * sa, sa) * (1.0 - ha);
  o = (body + under * (1.0 - body.a)) * alpha;
}
`;

export const PEARLS_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vPos;
uniform vec2 size, mouse;
uniform float time, seed, spacing, drift, alpha;
uniform vec4 rimCol, bodyCol, fillCol;
out vec4 o;

float hash1(float n) { return fract(sin(n * 127.1 + 311.7) * 43758.5453); }
vec4 over(vec4 a, vec4 b) { return a + b * (1.0 - a.a); }

void main() {
  vec2 p = vPos;
  float px = max(fwidth(p.x), 1e-3);
  float cy = size.y * 0.5;
  float shift = time * drift + seed * 53.0;
  float ci = floor((p.x + shift) / spacing);
  vec4 acc = vec4(0.0);
  for (int k = -2; k <= 2; ++k) {
    float i = ci + float(k);
    float h = hash1(i + seed * 17.0);
    float h2 = hash1(i * 3.7 + 1.3 + seed);
    vec2 c = vec2((i + 0.5) * spacing - shift + (h - 0.5) * spacing * 0.35, cy + 1.5 * sin(i * 1.7 + time * 1.4 + h * 6.0));
    float r = 1.5 + 2.5 * h2;
    vec2 dm = c - mouse;
    float dist = length(dm);
    float near = exp(-dist * dist / (30.0 * 30.0));
    c += (dist > 0.01 ? dm / dist : vec2(0.0, 1.0)) * 11.0 * near;
    r *= 1.0 + 0.45 * near;
    vec2 dv = p - c;
    float ang = atan(dv.y, dv.x);
    float rr = r * (1.0 + 0.06 * sin(3.0 * ang + time * 3.0 + i));
    float d = length(dv) - rr;
    float body = clamp(0.5 - d / px, 0.0, 1.0);
    if (body <= 0.0) continue;
    float nd = clamp(length(dv) / rr, 0.0, 1.0);
    bool filled = h2 > 1.0 - fillCol.w;
    vec3 col = filled ? mix(fillCol.rgb * 1.25, fillCol.rgb * 0.8, smoothstep(-rr, rr, dv.y)) : bodyCol.rgb;
    float a = filled ? 0.95 : bodyCol.a;
    float rim = smoothstep(0.55, 1.0, nd);
    col = mix(col, rimCol.rgb, rim * rimCol.a);
    a = max(a, rim * rimCol.a);
    float hl = smoothstep(0.42, 0.12, length(dv / rr - vec2(-0.35, -0.38)));
    col = mix(col, vec3(1.0), hl * 0.95);
    a = max(a, hl * 0.95);
    acc = over(acc, vec4(col * a, a) * body);
  }
  o = acc * alpha;
}
`;

export const BLIT_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D src;
uniform vec2 screen;
out vec4 o;
void main() { o = texture(src, gl_FragCoord.xy / screen); }
`;
