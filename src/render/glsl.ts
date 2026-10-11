/** Shared GLSL snippets. All world-space shading happens camera-relative (camera at the origin). */

export const LOGDEPTH_PARS = /* glsl */ `
uniform float uLogDepthF;
float logDepthValue(float w) { return log2(max(1e-6, 1.0 + w)) * uLogDepthF * 0.5; }
`;

/** Vertex-side logarithmic depth (Outerra style). Apply after gl_Position is computed. */
export const LOGDEPTH_VERTEX = /* glsl */ `
gl_Position.z = (log2(max(1e-6, 1.0 + gl_Position.w)) * uLogDepthF - 1.0) * gl_Position.w;
`;

export const MATH = /* glsl */ `
#define PI 3.14159265359
#define TAU 6.28318530718
// Numerically stable ray/sphere intersection (rd normalised). Returns (tNear, tFar) or (-1,-1) on miss.
vec2 sphIntersect(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd);
  vec3 qc = ro - b * rd;
  float h = r * r - dot(qc, qc);
  if (h < 0.0) return vec2(-1.0e30);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise3(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash13(i), b = hash13(i + vec3(1,0,0)), c = hash13(i + vec3(0,1,0)), d = hash13(i + vec3(1,1,0));
  float e = hash13(i + vec3(0,0,1)), g = hash13(i + vec3(1,0,1)), h = hash13(i + vec3(0,1,1)), k = hash13(i + vec3(1,1,1));
  return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y), mix(mix(e, g, f.x), mix(h, k, f.x), f.y), f.z);
}
float fbm3(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise3(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}
`;

/**
 * Seam-free equirectangular sampling (Tarini's trick): pick whichever of two
 * longitude parameterisations has the smaller screen-space derivative.
 */
export const EQUIRECT = /* glsl */ `
vec2 dirToEquirect(vec3 d) {
  return vec2(atan(d.y, d.x) * (0.5 / PI) + 0.5, asin(clamp(d.z, -1.0, 1.0)) / PI + 0.5);
}
vec4 sampleEquirect(sampler2D t, vec2 uv) {
  vec2 uvB = vec2(fract(uv.x + 0.5) - 0.5, uv.y);
  vec2 dxA = dFdx(uv), dyA = dFdy(uv);
  vec2 dxB = dFdx(uvB), dyB = dFdy(uvB);
  bool useB = abs(dxB.x) + abs(dyB.x) < abs(dxA.x) + abs(dyA.x);
  return textureGrad(t, uv, useB ? dxB : dxA, useB ? dyB : dyA);
}
// Screen-space gradients of an equirect uv, from whichever of two longitude parameterisations
// has no seam jump at this pixel. Shared by every map lookup of a pixel.
void equirectGrad(vec2 uv, out vec2 dx, out vec2 dy) {
  vec2 uvB = vec2(fract(uv.x + 0.5) - 0.5, uv.y);
  vec2 dxA = dFdx(uv), dyA = dFdy(uv);
  vec2 dxB = dFdx(uvB), dyB = dFdy(uvB);
  bool useB = abs(dxB.x) + abs(dyB.x) < abs(dxA.x) + abs(dyA.x);
  dx = useB ? dxB : dxA;
  dy = useB ? dyB : dyA;
}
// Smooth (B-spline) bicubic filtering from four bilinear taps of mip 0.
vec4 textureBicubic(sampler2D t, vec2 uv, vec2 size) {
  vec2 p = uv * size - 0.5;
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 f2 = f * f, f3 = f2 * f;
  vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
  vec2 w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0;
  vec2 w3 = f3 / 6.0;
  vec2 g0 = w0 + w1, g1 = w2 + w3;
  vec2 c0 = (i - 0.5 + w1 / g0) / size;
  vec2 c1 = (i + 1.5 + w3 / g1) / size;
  return g0.y * (g0.x * textureLod(t, vec2(c0.x, c0.y), 0.0) + g1.x * textureLod(t, vec2(c1.x, c0.y), 0.0))
       + g1.y * (g0.x * textureLod(t, vec2(c0.x, c1.y), 0.0) + g1.x * textureLod(t, vec2(c1.x, c1.y), 0.0));
}
// Filtered lookup that switches to bicubic once texels are magnified past ~2.5 pixels, where
// plain bilinear shows its blocky diamond pattern.
vec4 textureMag(sampler2D t, vec2 uv, vec2 dx, vec2 dy) {
  vec2 size = vec2(textureSize(t, 0));
  float fp = max(length(dx * size), length(dy * size));
  float k = smoothstep(0.55, 0.35, fp);
  vec4 lin = k < 1.0 ? textureGrad(t, uv, dx, dy) : vec4(0.0);
  if (k <= 0.0) return lin;
  vec4 cub = textureBicubic(t, uv, size);
  return k >= 1.0 ? cub : mix(lin, cub, k);
}
// Whole-globe map plus a high-resolution window (rect = u0, v0, width, height in equirect uv)
// holding only the tiles around where you are looking; blends to the globe map at its edges.
// Inside the window the globe map is not read at all.
vec4 sampleLayered(sampler2D t, sampler2D w, vec4 rect, float on, vec2 uv, vec2 dx, vec2 dy) {
  float f = 0.0;
  vec2 l = vec2(0.0);
  if (on > 0.5) {
    l = vec2(fract(uv.x - rect.x), uv.y - rect.y) / rect.zw;
    vec2 e = min(l, 1.0 - l);
    f = (rect.z > 0.999 ? 1.0 : smoothstep(0.0, 0.05, e.x)) * (rect.w > 0.999 ? 1.0 : smoothstep(0.0, 0.05, e.y));
  }
  vec4 base = f < 1.0 ? textureMag(t, uv, dx, dy) : vec4(0.0);
  if (f <= 0.0) return base;
  vec4 hi = textureMag(w, l, dx / rect.zw, dy / rect.zw);
  return f >= 1.0 ? hi : mix(base, hi, f);
}
`;

/** Black-body-ish colour from a B-V index (Ballesteros 2012 temperature + Planckian locus fit), linear sRGB. */
export const STAR_COLOR = /* glsl */ `
vec3 bvToRgb(float bv) {
  float t = 4600.0 * (1.0 / (0.92 * bv + 1.7) + 1.0 / (0.92 * bv + 0.62));
  // Tanner Helland style fit, then linearise
  float k = t / 100.0;
  vec3 c;
  c.r = k <= 66.0 ? 1.0 : clamp(1.292936 * pow(k - 60.0, -0.1332047), 0.0, 1.0);
  c.g = k <= 66.0 ? clamp(0.3900816 * log(k) - 0.6318414, 0.0, 1.0) : clamp(1.1298909 * pow(k - 60.0, -0.0755148), 0.0, 1.0);
  c.b = k >= 66.0 ? 1.0 : (k <= 19.0 ? 0.0 : clamp(0.5432068 * log(k - 10.0) - 1.1962541, 0.0, 1.0));
  c = pow(c, vec3(2.2));
  // de-saturate: stars look mostly white to the eye, with gentle tints
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return mix(vec3(l), c, 0.55) / max(l, 1e-3);
}
`;
