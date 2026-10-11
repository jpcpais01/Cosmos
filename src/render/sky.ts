import {
  AdditiveBlending, BufferAttribute, BufferGeometry, InstancedBufferAttribute, InstancedBufferGeometry, Matrix3, Matrix4, Mesh,
  OrthographicCamera, Quaternion, Scene, ShaderMaterial, Texture, Vector2, Vector3,
} from 'three';
import { EQUIRECT, MATH, STAR_COLOR } from './glsl';
import { OBLIQUITY_J2000 } from '../sim/constants';

/** World (ecliptic, Y-up) -> galactic rotation. */
export function worldToGalactic(): Matrix3 {
  const ce = Math.cos(OBLIQUITY_J2000), se = Math.sin(OBLIQUITY_J2000);
  // world -> ecliptic (x, y, z) = (X, -Z, Y); ecliptic -> equatorial
  const w2e = new Matrix3().set(1, 0, 0, 0, 0, -1, 0, 1, 0);
  const e2q = new Matrix3().set(1, 0, 0, 0, ce, -se, 0, se, ce);
  // equatorial (ICRS) -> galactic (Hipparcos, ESA 1997)
  const q2g = new Matrix3().set(
    -0.0548755604, -0.873437090, -0.4838350155,
    0.4941094279, -0.4448296300, 0.7469822445,
    -0.8676661490, -0.1980763734, 0.4559837762,
  );
  return q2g.multiply(e2q).multiply(w2e);
}

const ABERRATION = /* glsl */ `
// Relativistic aberration: where a source at direction d appears for an observer moving along v at speed beta.
vec3 aberrate(vec3 d, vec3 v, float beta) {
  float c = dot(d, v);
  vec3 perp = d - v * c;
  float pl = length(perp);
  if (pl < 1e-6) return d;
  float c2 = (c + beta) / (1.0 + beta * c);
  float s2 = sqrt(max(1.0 - c2 * c2, 0.0));
  return v * c2 + (perp / pl) * s2;
}
// Inverse: the source direction that appears at observed direction d.
vec3 deaberrate(vec3 d, vec3 v, float beta) { return aberrate(d, v, -beta); }
float doppler(vec3 dObs, vec3 v, float beta) {
  float g = inversesqrt(max(1.0 - beta * beta, 1e-4));
  return 1.0 / (g * (1.0 - beta * dot(dObs, v)));
}
vec3 dopplerTint(float D) {
  // blue-shift ahead, red-shift behind (artistically compressed)
  float k = clamp(log2(D) * 0.6, -1.0, 1.0);
  return k > 0.0 ? mix(vec3(1.0), vec3(0.55, 0.75, 1.35), k) : mix(vec3(1.0), vec3(1.35, 0.6, 0.35), -k);
}
`;

/**
 * Faint stars below the catalogue's limit, made up on the fly. Each layer splits the sky into an
 * equi-angular cube grid and a cell holds at most one star, kept away from the cell's edges so a
 * pixel only ever looks at its own cell. Finer layers hold fainter stars and switch off once their
 * cells shrink to a few pixels, where the panorama's glow already carries their light. How crowded
 * a cell is follows the panorama's brightness, so the Milky Way resolves into stars and dust lanes
 * stay empty.
 */
const FAINT_STARS = /* glsl */ `
vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}
vec3 faintStars(vec3 d, float pxPerRad, float px, vec3 crowd) {
  vec3 a = abs(d);
  vec2 q;
  float face;
  if (a.x >= a.y && a.x >= a.z) { q = d.yz / a.x; face = d.x > 0.0 ? 0.0 : 1.0; }
  else if (a.y >= a.z) { q = d.zx / a.y; face = d.y > 0.0 ? 2.0 : 3.0; }
  else { q = d.xy / a.z; face = d.z > 0.0 ? 4.0 : 5.0; }
  q = atan(q) * (2.0 / PI) + 0.5; // equi-angular, 0..1 across the face
  float lum = dot(crowd, vec3(0.2126, 0.7152, 0.0722));
  vec3 tint = crowd / max(lum, 1e-3);
  float prob = min(0.6, 0.05 + 2.5 * lum);
  float glow = 0.0025 + 0.6 * lum;
  float sigma = 0.55 * px;
  vec3 sum = vec3(0.0);
  float n = 79.0;
  for (int k = 0; k < STAR_LAYERS; k++) {
    float cellPx = (0.5 * PI / n) * pxPerRad;
    float on = smoothstep(6.0 * px, 10.0 * px, cellPx);
    if (on <= 0.0) break; // layers only get finer
    vec2 p = q * n;
    vec2 cell = floor(p);
    vec3 h = hash33(vec3(cell, face + 6.0 * float(k)));
    float present = smoothstep(h.x - 0.04, h.x, prob);
    if (present > 0.0) {
      vec2 dv = (p - cell - 0.3 - 0.4 * h.yz) * cellPx; // star sits 0.3 cells or more from the edges
      float r2 = dot(dv, dv);
      float rMax2 = 0.09 * cellPx * cellPx;
      vec3 h2 = hash33(vec3(cell.yx + 0.5, face * 7.0 + float(k) + 50.0));
      float I = glow * (0.25 + 1.75 * h2.x * h2.x * h2.x) * (1.0 - 0.12 * float(k));
      vec3 col = mix(mix(vec3(0.8, 0.88, 1.18), vec3(1.18, 0.96, 0.75), h2.y), tint, 0.4);
      sum += col * (I * present * on * exp(-r2 / (2.0 * sigma * sigma)) * (1.0 - smoothstep(0.36 * rMax2, rMax2, r2)));
    }
    n *= 1.43;
  }
  return sum;
}
`;

/**
 * How much of the sky the eye can see, from the scene's adapted brightness (the post pipeline's
 * 1x1 eye-adaptation target, last frame). Facing empty space it is 1; with the sunlit Earth, the
 * Sun or the lit hull in view the eye adapts to them and the faint sky fades, as in photos taken
 * in orbit.
 */
const SKY_VISIBILITY = /* glsl */ `
uniform sampler2D uAdapt;
uniform float uAdaptScale;
float skyVisibility() {
  float avg = texture(uAdapt, vec2(0.5)).r * uAdaptScale;
  return clamp(pow(0.005 / max(avg, 1e-5), 0.8), 0.1, 1.0);
}
`;

const _rot = new Matrix4();
const _view = new Matrix4();

export class Sky {
  readonly scene = new Scene();
  readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private bgMat: ShaderMaterial;
  private starMat: ShaderMaterial;
  private stars?: Mesh;
  /** catalogue magnitudes, brightest first (the instance order) */
  private starMags?: Float32Array;
  private w2g = worldToGalactic();
  private viewProj = new Matrix4();

  /** starLayers: how many layers of faint made-up stars (0 = none), set by the graphics quality */
  constructor(starLayers = 3) {
    const tri = new BufferGeometry();
    tri.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.bgMat = new ShaderMaterial({
      defines: { STAR_LAYERS: starLayers },
      vertexShader: /* glsl */ `
varying vec2 vNdc;
void main() { vNdc = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
${MATH}
${EQUIRECT}
${ABERRATION}
${FAINT_STARS}
${SKY_VISIBILITY}
varying vec2 vNdc;
uniform mat3 uCamRot;
uniform vec2 uTan;
uniform mat3 uW2G;
uniform sampler2D uMilkyWay;
uniform float uIntensity;
uniform float uStarGain;
uniform float uPxPerRad;
uniform float uPx;
uniform vec3 uVel;
uniform float uBeta;
void main() {
  // view ray from the camera basis (an inverted view-projection is too imprecise with a 1e15 depth range)
  vec3 ray = vec3(vNdc * uTan, -1.0);
  vec3 dObs = normalize(uCamRot * ray);
  vec3 d = uBeta > 0.0 ? deaberrate(dObs, uVel, uBeta) : dObs;
  vec3 g = uW2G * d;
  // galactic panorama: centre = galactic centre, longitude increases to the left
  vec2 uv = vec2(0.5 - atan(g.y, g.x) * (0.5 / PI), asin(clamp(g.z, -1.0, 1.0)) / PI + 0.5);
  vec3 tex = sampleEquirect(uMilkyWay, uv).rgb;
  vec3 c = tex * uIntensity;
#if STAR_LAYERS > 0
  if (uStarGain > 0.0) {
    // pixels per radian here: rectilinear projection stretches off-axis by about 1 / cos^1.5
    float pxPerRad = uPxPerRad * pow(dot(ray, ray), 0.75);
    // the panorama is star counts, so its smooth brightness says how crowded the faint stars are
    vec3 crowd = textureLod(uMilkyWay, uv, 4.0).rgb;
    c += faintStars(g, pxPerRad, uPx, crowd) * uStarGain;
  }
#endif
  c *= skyVisibility();
  if (uBeta > 0.0) {
    float D = doppler(dObs, uVel, uBeta);
    c *= dopplerTint(D) * clamp(D * D, 0.05, 2.5);
  }
  gl_FragColor = vec4(c, 1.0);
}`,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uCamRot: { value: new Matrix3() },
        uTan: { value: new Vector2(1, 1) },
        uW2G: { value: this.w2g },
        uMilkyWay: { value: null },
        uIntensity: { value: 0.35 },
        uStarGain: { value: 1 },
        uPxPerRad: { value: 1000 },
        uPx: { value: 1 },
        uVel: { value: new Vector3(0, 0, -1) },
        uBeta: { value: 0 },
        uAdapt: { value: null },
        uAdaptScale: { value: 1 },
      },
    });
    const bg = new Mesh(tri, this.bgMat);
    bg.frustumCulled = false;
    bg.renderOrder = 0;
    this.scene.add(bg);

    this.starMat = new ShaderMaterial({
      vertexShader: /* glsl */ `
${STAR_COLOR}
${ABERRATION}
${SKY_VISIBILITY}
attribute vec3 aDir;
attribute vec2 aMagBv;
uniform mat4 uViewProj;
uniform vec2 uViewport;
uniform float uPx;
uniform float uBrightness;
uniform vec3 uVel;
uniform float uBeta;
varying vec3 vColor;
varying vec2 vLocal;
varying float vLen;
varying float vSigma;
vec2 toScreen(vec3 d, out float w) {
  vec4 c = uViewProj * vec4(d, 1.0);
  w = c.w;
  return (c.xy / c.w) * 0.5 * uViewport;
}
void main() {
  vec3 d = normalize(aDir);
  float mag = aMagBv.x / 16.0 - 2.0;
  float bv = aMagBv.y / 100.0 - 0.5;
  float I = uBrightness * 1.5 * pow(10.0, -0.4 * 0.58 * mag) * skyVisibility();
  vec3 col = bvToRgb(bv);
  vec3 d0 = d;
  if (uBeta > 0.0) {
    d0 = aberrate(d, uVel, uBeta);
    float D = doppler(d0, uVel, uBeta);
    col *= dopplerTint(D);
    I *= clamp(D * D, 0.05, 3.0);
  }
  float w0;
  vec2 p0 = toScreen(d0, w0);
  if (I < 0.004 || w0 <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  // stars are round points; the quad keeps a length term (always 0 now) so the fragment shader stays generic
  float len = 0.0;
  vec2 dirA = vec2(1.0, 0.0);
  vec2 nrm = vec2(0.0, 1.0);
  float sigma = uPx * (0.62 + 0.5 * smoothstep(0.6, 12.0, I));
  float r = sigma * 3.2;
  vColor = col * I;
  vLen = len;
  vSigma = sigma;
  vec2 corner = position.xy; // x: 0..1 along, y: -1..1 across (with end caps)
  float along = mix(-r, len + r, corner.x);
  vLocal = vec2(along, corner.y * r);
  vec2 sp = p0 + dirA * along + nrm * corner.y * r;
  gl_Position = vec4(sp / (0.5 * uViewport), 0.0, 1.0);
}`,
      fragmentShader: /* glsl */ `
varying vec3 vColor;
varying vec2 vLocal;
varying float vLen;
varying float vSigma;
void main() {
  float t = clamp(vLocal.x, 0.0, vLen);
  vec2 q = vec2(vLocal.x - t, vLocal.y);
  float g = exp(-dot(q, q) / (2.0 * vSigma * vSigma));
  gl_FragColor = vec4(vColor * g, 0.0);
}`,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: AdditiveBlending,
    premultipliedAlpha: true, // ONE, ONE: shaders output alpha 0
      uniforms: {
        uViewProj: { value: new Matrix4() },
        uViewport: { value: new Vector2(1, 1) },
        uPx: { value: 1 },
        uBrightness: { value: 1 },
        uVel: { value: new Vector3(0, 0, -1) },
        uBeta: { value: 0 },
        uAdapt: { value: null },
        uAdaptScale: { value: 1 },
      },
    });
  }

  /** the eye's adapted brightness (1x1 texture) and the factor that turns it into displayed units */
  setAdaptation(t: Texture, scale: number): void {
    for (const m of [this.bgMat, this.starMat]) {
      m.uniforms.uAdapt.value = t;
      m.uniforms.uAdaptScale.value = scale;
    }
  }

  setMilkyWay(t: Texture): void {
    this.bgMat.uniforms.uMilkyWay.value = t;
  }

  setStarLayers(n: number): void {
    if (this.bgMat.defines.STAR_LAYERS === n) return;
    this.bgMat.defines.STAR_LAYERS = n;
    this.bgMat.needsUpdate = true;
  }

  async loadStars(url: string): Promise<number> {
    const buf = await (await fetch(url)).arrayBuffer();
    const n = buf.byteLength / 8;
    const dv = new DataView(buf);
    // brightest first, so each frame draws only the prefix of stars bright enough to show
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => dv.getUint8(a * 8 + 6) - dv.getUint8(b * 8 + 6));
    const dirs = new Int16Array(n * 3);
    const mb = new Uint8Array(n * 2);
    const mags = new Float32Array(n);
    order.forEach((src, i) => {
      dirs[i * 3] = dv.getInt16(src * 8, true);
      dirs[i * 3 + 1] = dv.getInt16(src * 8 + 2, true);
      dirs[i * 3 + 2] = dv.getInt16(src * 8 + 4, true);
      mb[i * 2] = dv.getUint8(src * 8 + 6);
      mb[i * 2 + 1] = dv.getUint8(src * 8 + 7);
      mags[i] = mb[i * 2] / 16 - 2;
    });
    this.starMags = mags;
    const g = new InstancedBufferGeometry();
    // quad: x along (0..1), y across (-1..1)
    g.setAttribute('position', new BufferAttribute(new Float32Array([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.setAttribute('aDir', new InstancedBufferAttribute(dirs, 3, true));
    g.setAttribute('aMagBv', new InstancedBufferAttribute(mb, 2, false));
    g.instanceCount = n;
    this.stars = new Mesh(g, this.starMat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = 1;
    this.scene.add(this.stars);
    return n;
  }

  update(
    camQuat: Quaternion, proj: Matrix4, viewportPx: Vector2, px: number, brightness: number,
    vel: Vector3, beta: number, warp: number,
  ): void {
    const rot = _rot.makeRotationFromQuaternion(camQuat);
    const bu = this.bgMat.uniforms;
    (bu.uCamRot.value as Matrix3).setFromMatrix4(rot);
    this.viewProj.multiplyMatrices(proj, _view.copy(rot).invert());
    // projection: x_ndc = P00 * x / -z  ->  tan of the half-angles
    (bu.uTan.value as Vector2).set(1 / proj.elements[0], 1 / proj.elements[5]);
    bu.uIntensity.value = 0.1 * brightness;
    bu.uPxPerRad.value = 0.5 * viewportPx.y * proj.elements[5];
    bu.uPx.value = px;
    bu.uStarGain.value = brightness * (1 - Math.min(1, warp));
    (bu.uVel.value as Vector3).copy(vel);
    bu.uBeta.value = beta;
    const su = this.starMat.uniforms;
    (su.uViewProj.value as Matrix4).copy(this.viewProj);
    (su.uViewport.value as Vector2).copy(viewportPx);
    su.uPx.value = px;
    // the warp tunnel takes over the view: stars fade out rather than streaking past
    su.uBrightness.value = brightness * (1 - Math.min(1, warp));
    (su.uVel.value as Vector3).copy(vel);
    su.uBeta.value = beta;
    // skip the stars the vertex shader would drop as too faint (I < 0.004, with up to 3x Doppler boost);
    // skyVisibility() only dims them further, so this count stays a safe upper bound
    const mags = this.starMags;
    if (this.stars && mags) {
      const peak = 1.5 * su.uBrightness.value * (beta > 0 ? 3 : 1);
      const limit = peak > 0 ? Math.log10(peak / 0.004) / (0.4 * 0.58) : -Infinity;
      let lo = 0, hi = mags.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (mags[mid] <= limit) lo = mid + 1;
        else hi = mid;
      }
      (this.stars.geometry as InstancedBufferGeometry).instanceCount = lo;
    }
  }
}
