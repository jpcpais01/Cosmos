import {
  AddEquation, BufferAttribute, BufferGeometry, CustomBlending, FloatType, HalfFloatType, LinearFilter, Mesh,
  NoBlending, OneFactor, OrthographicCamera, RGBAFormat, Scene, ShaderMaterial, Vector2, WebGLRenderTarget,
  type Texture, type WebGLRenderer,
} from 'three';
import { MATH } from './glsl';
import type { FrameProfiler } from './profiler';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const DOWNSAMPLE = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform bool uKaris;
// clamped so a pixel that overflowed half float (+inf) cannot turn the whole bloom into NaN
vec3 s(vec2 o) { return min(texture(uSrc, vUv + o * uTexel).rgb, vec3(6.0e4)); }
float w(vec3 c) { return 1.0 / (1.0 + dot(c, vec3(0.2126, 0.7152, 0.0722))); }
void main() {
  vec3 a = s(vec2(-2, 2)), b = s(vec2(0, 2)), c = s(vec2(2, 2));
  vec3 d = s(vec2(-2, 0)), e = s(vec2(0, 0)), f = s(vec2(2, 0));
  vec3 g = s(vec2(-2, -2)), h = s(vec2(0, -2)), i = s(vec2(2, -2));
  vec3 j = s(vec2(-1, 1)), k = s(vec2(1, 1)), l = s(vec2(-1, -1)), m = s(vec2(1, -1));
  vec3 col;
  if (uKaris) {
    // Karis average per 2x2 block to kill fireflies (the Sun!)
    vec3 g0 = (a + b + d + e) * 0.25, g1 = (b + c + e + f) * 0.25, g2 = (d + e + g + h) * 0.25, g3 = (e + f + h + i) * 0.25, g4 = (j + k + l + m) * 0.25;
    float w0 = w(g0), w1 = w(g1), w2 = w(g2), w3 = w(g3), w4 = w(g4);
    col = (g0 * w0 * 0.125 + g1 * w1 * 0.125 + g2 * w2 * 0.125 + g3 * w3 * 0.125 + g4 * w4 * 0.5) /
          (w0 * 0.125 + w1 * 0.125 + w2 * 0.125 + w3 * 0.125 + w4 * 0.5);
  } else {
    col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  gl_FragColor = vec4(min(col, vec3(6.0e4)), 1.0);
}`;

const UPSAMPLE = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uWeight;
vec3 s(vec2 o) { return texture(uSrc, vUv + o * uTexel).rgb; }
void main() {
  vec3 c = s(vec2(0)) * 4.0 + (s(vec2(-1, 0)) + s(vec2(1, 0)) + s(vec2(0, -1)) + s(vec2(0, 1))) * 2.0
         + s(vec2(-1, -1)) + s(vec2(1, -1)) + s(vec2(-1, 1)) + s(vec2(1, 1));
  gl_FragColor = vec4(c / 16.0 * uWeight, 1.0);
}`;

const ADAPT = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uSrc;
uniform sampler2D uPrev;
uniform float uBlend;
void main() {
  float acc = 0.0;
  for (int y = 0; y < 5; y++) for (int x = 0; x < 7; x++) {
    vec2 uv = (vec2(float(x), float(y)) + 0.5) / vec2(7.0, 5.0);
    // centre-weighted metering
    float wgt = 1.0 - 0.6 * length(uv - 0.5);
    float l = dot(texture(uSrc, uv).rgb, vec3(0.2126, 0.7152, 0.0722));
    acc += log(max(l, 1e-4)) * wgt;
  }
  float avg = exp(acc / 22.5);
  float prev = texture(uPrev, vec2(0.5)).r;
  float a = prev <= 0.0 ? avg : mix(prev, avg, uBlend);
  gl_FragColor = vec4(a, a, a, 1.0);
}`;

const COMPOSITE = /* glsl */ `
${MATH}
varying vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform sampler2D uAdapt;
uniform vec2 uResolution;
uniform float uExposure;
uniform float uAdaptStrength;
uniform float uBloomStrength;
uniform float uTime;
// sun / flare
uniform vec2 uSunUv;
uniform float uSunOn;     // 0..1: in view and not eclipsed
uniform float uSunPower;
uniform float uSunRadius; // disc radius in screen heights
// warp
uniform vec2 uApex;
uniform float uWarp;      // tunnel strength 0..1
uniform float uWarpSpeed; // how fast the trails flow out of the apex
uniform float uFlash;
uniform float uBubble;    // lens distortion of the warp bubble
uniform float uShake;
uniform float uSpool;     // warp drive charging 0..1
uniform float uRays;      // god-ray strength 0..1
uniform float uChaos;     // 0 at 1c .. 1 at 100c: how extreme and erratic the warp gets
uniform float uSeed;      // new random value for every jump

// cosine palette for the colour drift at high warp
vec3 warpHue(float h) { return 0.55 + 0.45 * cos(6.2832 * (h + vec3(0.0, 0.33, 0.67))); }

vec3 agx(vec3 c) {
  const mat3 m = mat3(0.842479062253094, 0.0423282422610123, 0.0423756549057051,
                      0.0784335999999992, 0.878468636469772, 0.0784336,
                      0.0792237451477643, 0.0791661274605434, 0.879142973793104);
  const mat3 mi = mat3(1.19687900512017, -0.0528968517574562, -0.0529716355144438,
                       -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
                       -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
  c = m * max(c, vec3(1e-10));
  c = clamp((log2(c) + 12.47393) / 16.5, 0.0, 1.0);
  vec3 x2 = c * c, x4 = x2 * x2;
  c = 15.5 * x4 * x2 - 40.14 * x4 * c + 31.96 * x4 - 6.868 * x2 * c + 0.4298 * x2 + 0.1191 * c - 0.00232;
  // gentle "punchy" look
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = l + (c - l) * 1.18;
  c = pow(max(c, 0.0), vec3(1.06));
  return clamp(mi * c, 0.0, 1.0);
}

// Sun glare, drawn analytically around the Sun's exact sub-pixel position so it stays steady while the
// view moves (the disc itself is only a few pixels across). Hidden by the ship through its mask, which
// is filtered so the glare fades smoothly as a strut or the hull slides over the Sun.
vec3 sunFlare(vec2 uv, vec2 aspect) {
  if (uSunOn <= 0.0) return vec3(0.0);
  float hid = 0.0;
  if (all(greaterThan(uSunUv, vec2(0.0))) && all(lessThan(uSunUv, vec2(1.0)))) {
    vec2 sr = vec2(max(uSunRadius * uResolution.y * 0.7, 0.75)) / uResolution;
    hid = (texture(uScene, uSunUv).a * 2.0 + texture(uScene, uSunUv + vec2(sr.x, 0.0)).a + texture(uScene, uSunUv - vec2(sr.x, 0.0)).a
         + texture(uScene, uSunUv + vec2(0.0, sr.y)).a + texture(uScene, uSunUv - vec2(0.0, sr.y)).a) / 6.0;
  }
  float vis = uSunOn * (1.0 - clamp(hid, 0.0, 1.0)) * uSunPower;
  if (vis <= 0.0) return vec3(0.0);
  vec2 sd = (uv - uSunUv) * aspect;          // in screen heights
  float dsun = length(sd);
  float k = max(dsun - uSunRadius, 0.0);     // distance from the limb
  float px = 1.0 / uResolution.y;
  // glow: a hot core hugging the disc, a soft halo and a faint veil over the whole frame
  float glow = 4.0 * exp(-k * 300.0) + 0.5 / (1.0 + k * k * 7000.0) + 0.12 / (1.0 + k * k * 280.0) + 0.014 / (1.0 + k * k * 10.0);
  // six thin diffraction spikes, at least a pixel and a half wide so they never shimmer
  const vec2 A0 = vec2(0.966, 0.259), A1 = vec2(-0.259, 0.966), A2 = vec2(-0.707, -0.707);
  float wid = max(px * 1.5, 0.0009 + dsun * 0.006);
  float spk = exp(-abs(dot(sd, vec2(-A0.y, A0.x))) / wid) + exp(-abs(dot(sd, vec2(-A1.y, A1.x))) / wid) * 0.7
            + exp(-abs(dot(sd, vec2(-A2.y, A2.x))) / wid) * 0.55;
  spk *= 0.35 / (1.0 + dsun * dsun * 450.0) * smoothstep(0.0, 0.004, k);
  // fine static streaks radiating from the Sun (the eye's ciliary corona)
  float streak = 0.0;
  if (dsun < 0.35) {
    vec2 sdir = sd / max(dsun, 1e-5);
    streak = pow(vnoise3(vec3(sdir * 16.0, 3.7)), 3.0) * 0.6 + pow(vnoise3(vec3(sdir * 41.0, 9.1)), 4.0) * 0.5;
    streak *= 0.5 / (1.0 + dsun * dsun * 900.0) * smoothstep(0.002, 0.012, k);
  }
  vec3 fl = vec3(1.0, 0.9, 0.78) * glow + vec3(1.0, 0.95, 0.9) * (spk + streak);
  // a faint rainbow ring around the Sun
  float rg = (dsun - 0.3) / 0.035;
  fl += warpHue(0.62 - rg * 0.12) * exp(-rg * rg) * 0.004;
  return fl * vis;
}

// grading, vignette, grain and dither; alpha carries luma for the anti-aliasing pass
vec4 finish(vec3 col) {
  vec3 outc = agx(col);
  float vig = 1.0 - 0.22 * pow(length((vUv - 0.5) * vec2(1.0, 0.9)) * 1.25, 2.6);
  outc *= vig;
  float n = hash12(gl_FragCoord.xy + fract(uTime * 13.7) * 431.0);
  outc += (n - 0.5) * (1.6 / 255.0);
  return vec4(outc, dot(outc, vec3(0.299, 0.587, 0.114)));
}

float exposureNow() {
  float avg = texture(uAdapt, vec2(0.5)).r;
  float adapt = clamp(pow(0.16 / max(avg, 1e-4), 0.55), 0.3, 2.2);
  return uExposure * mix(1.0, adapt, uAdaptStrength);
}

#ifndef WARP
// Cruising (no warp effect on screen): none of the tunnel maths, the common case.
void main() {
  vec2 uv = vUv;
  vec2 aspect = vec2(uResolution.x / uResolution.y, 1.0);
  vec2 dv = (uv - 0.5) * aspect;
  // faint lens chromatic aberration towards the corners
  float ca = 0.0006 * dot(uv - 0.5, uv - 0.5);
  vec2 cdir = normalize(dv + 1e-5) / aspect;
  vec3 scene;
  scene.r = texture(uScene, uv + cdir * ca).r;
  scene.g = texture(uScene, uv).g;
  scene.b = texture(uScene, uv - cdir * ca).b;
  scene = min(scene, vec3(6.0e4));
  vec3 bloom = texture(uBloom, uv).rgb;
  vec3 col = mix(scene, bloom, uBloomStrength) * exposureNow();
  col += sunFlare(uv, aspect);
  gl_FragColor = finish(col);
}
#else
void main() {
  vec2 uv = vUv;
  vec2 aspect = vec2(uResolution.x / uResolution.y, 1.0);
  // camera shake (warp entry)
  uv += uShake * 0.004 * vec2(sin(uTime * 61.0) + sin(uTime * 23.0), cos(uTime * 47.0) + sin(uTime * 31.0));
  // warp bubble lensing: radial compression toward the apex with a refractive ring
  float hull = texture(uScene, uv).a; // 1 where the ship was drawn
  float space = 1.0 - clamp(hull, 0.0, 1.0);
  float inside = 1.0 - space;
  vec2 dv = (uv - uApex) * aspect;
  float r = length(dv);
  float ring = exp(-pow((r - 0.55) / 0.22, 2.0));
  vec2 lens = dv * (1.0 - uBubble * (0.18 * ring + 0.08 * smoothstep(0.0, 1.2, r)));
  float ang = atan(dv.y, dv.x);
  float lr = log(max(r, 1e-3));
  vec2 radial = dv / max(r, 1e-4);
  vec2 tang = vec2(-radial.y, radial.x);
  vec3 polar = vec3(cos(ang), sin(ang), 0.0);
  float veins = 0.5;
  float n1 = 0.5;
  float agitation = max(uBubble, uSpool * 0.8);
  // random surges that get stronger and more frequent with the warp factor
  float surge = smoothstep(0.55, 1.0, vnoise3(vec3(uTime * (0.5 + 2.5 * uChaos), uSeed * 37.0, 1.7)));
  float wild = uChaos * (0.6 + 1.4 * surge);
  if (agitation > 0.001) {
    // space itself ripples: noisy waves running out of the apex, sheared sideways by a second noise field
    float flow = uTime * uWarpSpeed;
    vec3 so = vec3(uSeed * 61.0, uSeed * 23.0, 0.0);
    n1 = fbm3(polar * (1.7 + uChaos * 1.5) + so + vec3(0.0, 0.0, lr * 1.3 - flow * 0.6));
    veins = fbm3(polar * (4.0 + uChaos * 3.0) + so.yxz + vec3(5.2, 1.3, lr * 2.4 - flow * 0.8));
    float ripple = sin(lr * (14.0 + 6.0 * uChaos) - uTime * (6.0 + uWarpSpeed * 4.0) + n1 * (7.0 + 4.0 * uChaos));
    vec2 disp = radial * (ripple * 0.009 + (n1 - 0.5) * 0.035) + tang * (veins - 0.5) * 0.04;
    // at high factors the tunnel also writhes: a lobed twist with a per-jump lobe count
    float lobes = 3.0 + floor(uSeed * 5.0);
    disp += tang * sin(ang * lobes + lr * 6.0 - uTime * (2.0 + 4.0 * uChaos)) * 0.03 * wild;
    disp *= 0.6 + 1.6 * uChaos + wild;
    // while charging, space is wound up around the apex
    float tw = uSpool * (1.0 - uBubble) * 0.6 * exp(-r * 2.2) * sin(uTime * 2.0 + r * 9.0);
    disp += tang * tw * r;
    lens += disp * agitation * smoothstep(0.0, 0.25, r);
  }
  // shockwave ring on entry and exit
  if (uFlash > 0.001) {
    float sr = (1.0 - uFlash) * 1.9;
    lens += radial * uFlash * 0.07 * exp(-pow((r - sr) / 0.09, 2.0));
  }
  lens = mix(dv, lens, space);
  // on the ship itself (the cabin, or the hull in chase view) the warp is only a faint heat-haze shimmer
  float haze = 0.0;
  if (uBubble > 0.001 && inside > 0.001) {
    vec2 hp = uv * aspect * 7.0;
    float h1 = vnoise3(vec3(hp, uTime * 0.7 + uSeed * 13.0));
    float h2 = vnoise3(vec3(hp * 1.9 + 4.1, uTime * 1.1 + 2.3));
    lens += (vec2(h1, h2) - 0.5) * 0.004 * (1.0 + 0.6 * uChaos) * uBubble * inside;
    // a soft band of warp light sweeps slowly from the front of the cabin to the back
    haze = smoothstep(0.55, 1.0, sin(r * 5.0 - uTime * (1.2 + 0.8 * uChaos) + h1 * 2.5)) * uBubble * inside;
  }
  // the light trails flow through a morphing field: their angle wanders with distance and time, so each
  // shaft bends and undulates instead of shooting out dead straight
  float flowT = uTime * uWarpSpeed;
  float wob = (n1 - 0.5) * (0.22 + 0.3 * uChaos) + (veins - 0.5) * (0.08 + 0.2 * wild)
            + sin(lr * 3.0 - flowT * 1.3 + ang * 3.0 + uSeed * 20.0) * 0.05 * (1.0 + wild);
  float wang = ang + wob * smoothstep(0.02, 0.2, r);
  vec3 wpolar = vec3(cos(wang), sin(wang), 0.0);
  // ripples racing out along the trails, their fronts warped by the same noise
  float trailRipple = 0.5 + 0.5 * sin(lr * (9.0 + 7.0 * uChaos) - uTime * (4.0 + 3.0 * uWarpSpeed) + n1 * (6.0 + 6.0 * uChaos));
  vec2 suv = uApex + lens / aspect;
  // chromatic aberration grows with warp
  float ca = uBubble * 0.006 * r * (1.0 + 2.5 * wild) * space + 0.0006 * dot(uv - 0.5, uv - 0.5);
  vec2 cdir = normalize(dv + 1e-5) / aspect;
  vec3 scene;
  scene.r = texture(uScene, suv + cdir * ca).r;
  scene.g = texture(uScene, suv).g;
  scene.b = texture(uScene, suv - cdir * ca).b;
  scene = min(scene, vec3(6.0e4));
  vec3 bloom = texture(uBloom, suv).rgb;

  float exposure = exposureNow();
  vec3 col = mix(scene, bloom, uBloomStrength) * exposure;
  col *= 1.0 + haze * vec3(0.06, 0.09, 0.16);

  col += sunFlare(uv, aspect);

  // God rays: the glow of the scene smeared outward from the warp apex, broken into shafts
  if (uRays > 0.001) {
    vec2 st = (uApex - suv) * (0.9 / 20.0);
    vec2 p = suv;
    vec3 acc = vec3(0.0);
    float w = 1.0;
    for (int i = 0; i < 20; i++) {
      p += st;
      vec3 b = texture(uBloom, p).rgb * exposure;
      acc += b * smoothstep(0.6, 2.5, dot(b, vec3(0.2126, 0.7152, 0.0722))) * w;
      w *= 0.9;
    }
    acc /= 8.0;
    float shafts = vnoise3(wpolar * (9.0 + 9.0 * uChaos) + vec3(uSeed * 11.0, 0.0, lr * 0.7 - flowT * 0.35 + uTime * 0.6 * uChaos));
    shafts = (0.25 + 1.5 * pow(shafts, 2.5 - uChaos)) * (0.6 + 0.65 * trailRipple);
    // flicker: steady at 1c, stuttering at 100c
    float flick = mix(1.0, 0.35 + 1.4 * hash12(vec2(floor(uTime * 14.0), uSeed * 91.0)), uChaos * 0.7);
    // light pouring out of the apex itself, drifting through colours at high factors
    // (the hue varies periodically round the circle, so there is no seam where atan wraps on the left)
    vec3 coreCol = mix(vec3(0.55, 0.75, 1.0), warpHue(uSeed + uTime * 0.07 + 0.25 * sin(ang + uSeed * 6.0)), uChaos * 0.55);
    vec3 core = coreCol * pow(vnoise3(wpolar * 16.0 + vec3(3.0, 0.0, lr * 0.9 - flowT * 0.5)), 3.0) * (0.7 + 0.8 * wild) / (1.0 + r * 3.5);
    shafts *= flick;
    col += (acc * vec3(0.8, 0.9, 1.0) * shafts * 0.3 + core * shafts) * uRays * smoothstep(0.0, 0.08, r) * space;
  }

  // Warp tunnel: sparse light streaks scrolling out of the apex (polar coordinates, log-radius)
  if (uWarp > 0.001) {
    // strange occlusion: dark veins crawl along the tunnel wall and the edges sink into shadow
    float occl = smoothstep(0.52, 0.72, veins) * smoothstep(0.12, 0.6, r);
    float edge = smoothstep(0.45, 1.35, r);
    float horizon = exp(-pow((r - 0.11) / 0.045, 2.0));
    col *= 1.0 - uWarp * space * clamp((0.7 * occl + 0.5 * horizon + 0.55 * edge * (0.5 + veins)) * (0.75 + 0.5 * wild), 0.0, 0.93);
    // flowing ribbons of light: noise stretched along the log-radius, scrolling outward and following the
    // morphing trail field, so the tunnel wall shimmers like rippling silk rather than a hail of dashes
    float z = lr * 0.55 - flowT * 0.45;
    float rib = vnoise3(wpolar * (6.0 + 4.0 * uChaos) + vec3(uSeed * 17.0, 0.0, z));
    float rib2 = vnoise3(wpolar * (15.0 + 8.0 * uChaos) + vec3(0.0, uSeed * 29.0, z * 1.7 - uTime * 0.3));
    float ribbons = pow(rib, 3.0) * 0.8 + pow(rib2, 4.0) * 0.6;
    ribbons *= 0.55 + 0.9 * trailRipple;
    float mask = smoothstep(0.08, 0.6, r) * smoothstep(1.6, 0.5, r);
    vec3 tint = mix(vec3(0.45, 0.65, 1.0), vec3(0.8, 0.72, 1.0), rib2);
    tint = mix(tint, warpHue(uSeed + rib * 0.6 + uTime * 0.05) * 1.2, uChaos * 0.6 * rib);
    vec3 tunnel = tint * ribbons * (0.75 + 0.75 * uChaos) * mask;
    // glow of the warp bubble around the apex
    tunnel += vec3(0.6, 0.8, 1.0) * 0.18 / (1.0 + r * r * 160.0);
    col += tunnel * uWarp * 0.55 * space;
  }
  // entry / exit flash: bright at the apex, a soft veil elsewhere
  col += vec3(0.75, 0.88, 1.0) * uFlash * (0.25 + 2.5 / (1.0 + r * r * 30.0)) * (space + 0.15 * inside);

  gl_FragColor = finish(col);
}
#endif
`;

/*
 * FXAA (after Lottes' FXAA 3.11, quality preset) on the final display image, plus a light
 * sharpen on smooth areas so fine surface detail stays crisp. One cheap full-screen pass:
 * far less work than multisampling the half-float HDR buffer, which cost most of the frame.
 */
const FXAA = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uSrc; // display colour, luma in alpha
uniform vec2 uTexel;
uniform float uSharpen;
float lum(vec2 o) { return texture(uSrc, vUv + o * uTexel).a; }
void main() {
  vec4 cM = texture(uSrc, vUv);
  float lM = cM.a;
  float lN = lum(vec2(0.0, 1.0)), lS = lum(vec2(0.0, -1.0)), lE = lum(vec2(1.0, 0.0)), lW = lum(vec2(-1.0, 0.0));
  float lMax = max(lM, max(max(lN, lS), max(lE, lW)));
  float lMin = min(lM, min(min(lN, lS), min(lE, lW)));
  float range = lMax - lMin;
  if (range < max(0.0312, lMax * 0.125)) {
    // no edge: unsharp mask on luma, bounded by the local contrast
    float d = (lM - 0.25 * (lN + lS + lE + lW)) * uSharpen * 2.0;
    gl_FragColor = vec4(cM.rgb + clamp(d, -range, range), 1.0);
    return;
  }
  float lNW = lum(vec2(-1.0, 1.0)), lNE = lum(vec2(1.0, 1.0)), lSW = lum(vec2(-1.0, -1.0)), lSE = lum(vec2(1.0, -1.0));
  float lNS = lN + lS, lWE = lW + lE;
  float lLeft = lNW + lSW, lRight = lNE + lSE, lTop = lNW + lNE, lBottom = lSW + lSE;
  float edgeH = abs(-2.0 * lW + lLeft) + abs(-2.0 * lM + lNS) * 2.0 + abs(-2.0 * lE + lRight);
  float edgeV = abs(-2.0 * lN + lTop) + abs(-2.0 * lM + lWE) * 2.0 + abs(-2.0 * lS + lBottom);
  bool horz = edgeH >= edgeV;
  float l1 = horz ? lS : lW;
  float l2 = horz ? lN : lE;
  float g1 = l1 - lM, g2 = l2 - lM;
  bool steep1 = abs(g1) >= abs(g2);
  float gScaled = 0.25 * max(abs(g1), abs(g2));
  float stepLen = horz ? uTexel.y : uTexel.x;
  float lAvgLocal = 0.5 * (l2 + lM);
  if (steep1) {
    stepLen = -stepLen;
    lAvgLocal = 0.5 * (l1 + lM);
  }
  vec2 cur = vUv;
  if (horz) cur.y += stepLen * 0.5;
  else cur.x += stepLen * 0.5;
  vec2 off = horz ? vec2(uTexel.x, 0.0) : vec2(0.0, uTexel.y);
  vec2 uv1 = cur - off, uv2 = cur + off;
  float e1 = texture(uSrc, uv1).a - lAvgLocal;
  float e2 = texture(uSrc, uv2).a - lAvgLocal;
  bool r1 = abs(e1) >= gScaled, r2 = abs(e2) >= gScaled;
  float q = 1.0;
  for (int i = 0; i < 10; i++) {
    if (r1 && r2) break;
    q = i < 3 ? 1.0 : i < 6 ? 1.5 : i < 8 ? 2.0 : 4.0;
    if (!r1) {
      uv1 -= off * q;
      e1 = texture(uSrc, uv1).a - lAvgLocal;
      r1 = abs(e1) >= gScaled;
    }
    if (!r2) {
      uv2 += off * q;
      e2 = texture(uSrc, uv2).a - lAvgLocal;
      r2 = abs(e2) >= gScaled;
    }
  }
  float d1 = horz ? vUv.x - uv1.x : vUv.y - uv1.y;
  float d2 = horz ? uv2.x - vUv.x : uv2.y - vUv.y;
  bool near1 = d1 < d2;
  float edgeLen = d1 + d2;
  float pixOff = 0.5 - min(d1, d2) / edgeLen;
  bool correct = ((near1 ? e1 : e2) < 0.0) != (lM < lAvgLocal);
  float finalOff = correct ? pixOff : 0.0;
  // sub-pixel aliasing (thin features), kept gentle so textures are not smeared
  float lAvg = (2.0 * (lNS + lWE) + lLeft + lRight) / 12.0;
  float sub = clamp(abs(lAvg - lM) / range, 0.0, 1.0);
  sub = (-2.0 * sub + 3.0) * sub * sub;
  finalOff = max(finalOff, sub * sub * 0.5);
  vec2 uv = vUv;
  if (horz) uv.y += finalOff * stepLen;
  else uv.x += finalOff * stepLen;
  gl_FragColor = vec4(texture(uSrc, uv).rgb, 1.0);
}`;

export interface PostParams {
  exposure: number;
  adaptStrength: number;
  bloomStrength: number;
  time: number;
  dt: number;
  sunUv: Vector2;
  /** 0..1: how much of the Sun is in view and not eclipsed by a planet or moon */
  sunOn: number;
  sunPower: number;
  /** angular radius of the Sun's disc, in screen heights */
  sunRadius: number;
  apex: Vector2;
  warp: number;
  warpSpeed: number;
  flash: number;
  bubble: number;
  spool: number;
  rays: number;
  chaos: number;
  seed: number;
  shake: number;
}

const COPY = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uTexel;
void main() {
  // 4-tap box: a soft half-resolution copy is all the exhaust lens needs
  vec3 c = texture2D(uSrc, vUv + uTexel * vec2(-0.5, -0.5)).rgb + texture2D(uSrc, vUv + uTexel * vec2(0.5, -0.5)).rgb
         + texture2D(uSrc, vUv + uTexel * vec2(-0.5, 0.5)).rgb + texture2D(uSrc, vUv + uTexel * vec2(0.5, 0.5)).rgb;
  gl_FragColor = vec4(c * 0.25, 1.0);
}`;

const MIPS = 6;

export class PostPipeline {
  readonly hdr: WebGLRenderTarget;
  /** Half-resolution copy of the frame so far, for refraction effects. */
  readonly bg: WebGLRenderTarget;
  private copy: ShaderMaterial;
  private mips: WebGLRenderTarget[] = [];
  private adapt: WebGLRenderTarget[];
  private adaptIdx = 0;
  /** the latest eye-adaptation result: 1x1, red = adapted scene luminance before exposure */
  get adaptTexture(): Texture {
    return this.adapt[this.adaptIdx].texture;
  }
  private scene = new Scene();
  private cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: Mesh;
  private down: ShaderMaterial;
  private up: ShaderMaterial;
  private adaptMat: ShaderMaterial;
  private comp: ShaderMaterial;
  /** the composite with the warp effects compiled in; the plain one skips all of that maths */
  private compWarp: ShaderMaterial;
  /** Final display image, input of the anti-aliasing pass. */
  private ldr: WebGLRenderTarget;
  private fxaa: ShaderMaterial;
  private aa = false;
  profiler?: FrameProfiler;
  private width = 1;
  private height = 1;

  constructor(private renderer: WebGLRenderer) {
    // Never multisampled: three.js resolves an MSAA target (colour and depth) after every render() call,
    // four times a frame here, which made medium and higher run several times slower than low.
    this.hdr = new WebGLRenderTarget(1, 1, {
      type: HalfFloatType, format: RGBAFormat, depthBuffer: true, stencilBuffer: false,
      minFilter: LinearFilter, magFilter: LinearFilter, generateMipmaps: false,
    });
    this.ldr = new WebGLRenderTarget(1, 1, {
      format: RGBAFormat, depthBuffer: false, minFilter: LinearFilter, magFilter: LinearFilter, generateMipmaps: false,
    });
    for (let i = 0; i < MIPS; i++) {
      this.mips.push(new WebGLRenderTarget(1, 1, {
        type: HalfFloatType, format: RGBAFormat, depthBuffer: false, minFilter: LinearFilter, magFilter: LinearFilter,
      }));
    }
    this.bg = new WebGLRenderTarget(1, 1, {
      type: HalfFloatType, format: RGBAFormat, depthBuffer: false, minFilter: LinearFilter, magFilter: LinearFilter, generateMipmaps: false,
    });
    this.adapt = [0, 1].map(() => new WebGLRenderTarget(1, 1, { type: FloatType, depthBuffer: false }));
    const tri = new BufferGeometry();
    tri.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.down = new ShaderMaterial({ vertexShader: VERT, fragmentShader: DOWNSAMPLE, depthTest: false, depthWrite: false,
      uniforms: { uSrc: { value: null }, uTexel: { value: new Vector2() }, uKaris: { value: false } } });
    this.up = new ShaderMaterial({ vertexShader: VERT, fragmentShader: UPSAMPLE, depthTest: false, depthWrite: false,
      blending: CustomBlending, blendEquation: AddEquation, blendSrc: OneFactor, blendDst: OneFactor,
      uniforms: { uSrc: { value: null }, uTexel: { value: new Vector2() }, uWeight: { value: 1 } } });
    this.copy = new ShaderMaterial({ vertexShader: VERT, fragmentShader: COPY, depthTest: false, depthWrite: false, blending: NoBlending,
      uniforms: { uSrc: { value: null }, uTexel: { value: new Vector2() } } });
    this.adaptMat = new ShaderMaterial({ vertexShader: VERT, fragmentShader: ADAPT, depthTest: false, depthWrite: false,
      uniforms: { uSrc: { value: null }, uPrev: { value: null }, uBlend: { value: 0.05 } } });
    this.comp = new ShaderMaterial({
      vertexShader: VERT, fragmentShader: COMPOSITE, depthTest: false, depthWrite: false, blending: NoBlending,
      uniforms: {
        uScene: { value: null }, uBloom: { value: null }, uAdapt: { value: null },
        uResolution: { value: new Vector2() }, uExposure: { value: 1 }, uAdaptStrength: { value: 1 },
        uBloomStrength: { value: 0.05 }, uTime: { value: 0 },
        uSunUv: { value: new Vector2() }, uSunOn: { value: 0 }, uSunPower: { value: 1 }, uSunRadius: { value: 0 },
        uApex: { value: new Vector2(0.5, 0.5) }, uWarp: { value: 0 }, uWarpSpeed: { value: 1 }, uFlash: { value: 0 },
        uBubble: { value: 0 }, uShake: { value: 0 }, uSpool: { value: 0 }, uRays: { value: 0 }, uChaos: { value: 0 }, uSeed: { value: 0 },
      },
    });
    this.compWarp = new ShaderMaterial({
      vertexShader: VERT, fragmentShader: COMPOSITE, depthTest: false, depthWrite: false, blending: NoBlending,
      uniforms: this.comp.uniforms, defines: { WARP: '' },
    });
    this.fxaa = new ShaderMaterial({ vertexShader: VERT, fragmentShader: FXAA, depthTest: false, depthWrite: false, blending: NoBlending,
      uniforms: { uSrc: { value: null }, uTexel: { value: new Vector2() }, uSharpen: { value: 0 } } });
    this.quad = new Mesh(tri, this.comp);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    // compile the warp variant now so the first jump does not stall on a shader compile
    this.quad.material = this.compWarp;
    renderer.compile(this.scene, this.cam);
    this.quad.material = this.comp;
  }

  setSize(w: number, h: number): void {
    this.width = w;
    this.height = h;
    this.hdr.setSize(w, h);
    if (this.aa) this.ldr.setSize(w, h);
    this.bg.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1));
    let mw = w, mh = h;
    for (const m of this.mips) {
      mw = Math.max(1, mw >> 1);
      mh = Math.max(1, mh >> 1);
      m.setSize(mw, mh);
    }
  }

  /** Anti-aliasing pass on or off; sharpen (0..1) adds crispness to smooth areas. */
  setAA(on: boolean, sharpen: number): void {
    this.aa = on;
    this.fxaa.uniforms.uSharpen.value = sharpen;
    if (on) this.ldr.setSize(this.width, this.height);
    else this.ldr.setSize(1, 1);
  }

  /** Copies the HDR frame rendered so far into bg, then makes hdr the render target again. */
  captureBackground(): void {
    const r = this.renderer;
    const autoClear = r.autoClear;
    r.autoClear = false;
    this.copy.uniforms.uSrc.value = this.hdr.texture;
    (this.copy.uniforms.uTexel.value as Vector2).set(1 / this.width, 1 / this.height);
    this.pass(this.copy, this.bg);
    r.setRenderTarget(this.hdr);
    r.autoClear = autoClear;
  }

  private pass(mat: ShaderMaterial, target: WebGLRenderTarget | null): void {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.cam);
  }

  render(p: PostParams): void {
    const r = this.renderer;
    const autoClear = r.autoClear;
    r.autoClear = false;
    this.profiler?.gpu('Bloom & exposure');
    // bloom downsample chain
    let src: Texture = this.hdr.texture;
    let sw = this.width, sh = this.height;
    for (let i = 0; i < MIPS; i++) {
      const u = this.down.uniforms;
      u.uSrc.value = src;
      (u.uTexel.value as Vector2).set(1 / sw, 1 / sh);
      u.uKaris.value = i === 0;
      this.pass(this.down, this.mips[i]);
      src = this.mips[i].texture;
      sw = this.mips[i].width;
      sh = this.mips[i].height;
    }
    // upsample (additive)
    for (let i = MIPS - 1; i > 0; i--) {
      const u = this.up.uniforms;
      u.uSrc.value = this.mips[i].texture;
      (u.uTexel.value as Vector2).set(1 / this.mips[i].width, 1 / this.mips[i].height);
      u.uWeight.value = 1.0;
      this.pass(this.up, this.mips[i - 1]);
    }
    // eye adaptation
    const prev = this.adapt[this.adaptIdx];
    const next = this.adapt[1 - this.adaptIdx];
    this.adaptMat.uniforms.uSrc.value = this.mips[MIPS - 2].texture;
    this.adaptMat.uniforms.uPrev.value = prev.texture;
    this.adaptMat.uniforms.uBlend.value = 1 - Math.exp(-p.dt * 1.6);
    this.pass(this.adaptMat, next);
    this.adaptIdx = 1 - this.adaptIdx;

    const u = this.comp.uniforms;
    u.uScene.value = this.hdr.texture;
    u.uBloom.value = this.mips[0].texture;
    u.uAdapt.value = next.texture;
    (u.uResolution.value as Vector2).set(this.width, this.height);
    u.uExposure.value = p.exposure;
    u.uAdaptStrength.value = p.adaptStrength;
    u.uBloomStrength.value = p.bloomStrength;
    u.uTime.value = p.time;
    (u.uSunUv.value as Vector2).copy(p.sunUv);
    u.uSunOn.value = p.sunOn;
    u.uSunPower.value = p.sunPower;
    u.uSunRadius.value = p.sunRadius;
    (u.uApex.value as Vector2).copy(p.apex);
    u.uWarp.value = p.warp;
    u.uWarpSpeed.value = p.warpSpeed;
    u.uFlash.value = p.flash;
    u.uBubble.value = p.bubble;
    u.uSpool.value = p.spool;
    u.uRays.value = p.rays;
    u.uChaos.value = p.chaos;
    u.uSeed.value = p.seed;
    u.uShake.value = p.shake;
    this.profiler?.gpu(this.aa ? 'Final image + AA' : 'Final image');
    const warping = Math.max(p.warp, p.flash, p.bubble, p.spool, p.rays, p.shake) > 0.001;
    const comp = warping ? this.compWarp : this.comp;
    if (this.aa) {
      this.pass(comp, this.ldr);
      this.fxaa.uniforms.uSrc.value = this.ldr.texture;
      (this.fxaa.uniforms.uTexel.value as Vector2).set(1 / this.width, 1 / this.height);
      this.pass(this.fxaa, null);
    } else this.pass(comp, null);
    r.autoClear = autoClear;
  }
}

