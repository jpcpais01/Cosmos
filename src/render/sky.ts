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

export class Sky {
  readonly scene = new Scene();
  readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private bgMat: ShaderMaterial;
  private starMat: ShaderMaterial;
  private stars?: Mesh;
  private w2g = worldToGalactic();
  private viewProj = new Matrix4();

  constructor() {
    const tri = new BufferGeometry();
    tri.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.bgMat = new ShaderMaterial({
      vertexShader: /* glsl */ `
varying vec2 vNdc;
void main() { vNdc = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
${MATH}
${EQUIRECT}
${ABERRATION}
varying vec2 vNdc;
uniform mat3 uCamRot;
uniform vec2 uTan;
uniform mat3 uW2G;
uniform sampler2D uMilkyWay;
uniform float uIntensity;
uniform vec3 uVel;
uniform float uBeta;
void main() {
  // view ray from the camera basis (an inverted view-projection is too imprecise with a 1e15 depth range)
  vec3 dObs = normalize(uCamRot * vec3(vNdc * uTan, -1.0));
  vec3 d = uBeta > 0.0 ? deaberrate(dObs, uVel, uBeta) : dObs;
  vec3 g = uW2G * d;
  // galactic panorama: centre = galactic centre, longitude increases to the left
  vec2 uv = vec2(0.5 - atan(g.y, g.x) * (0.5 / PI), asin(clamp(g.z, -1.0, 1.0)) / PI + 0.5);
  vec3 c = sampleEquirect(uMilkyWay, uv).rgb * uIntensity;
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
        uVel: { value: new Vector3(0, 0, -1) },
        uBeta: { value: 0 },
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
attribute vec3 aDir;
attribute vec2 aMagBv;
uniform mat4 uViewProj;
uniform vec2 uViewport;
uniform float uPx;
uniform float uBrightness;
uniform vec3 uVel;
uniform float uBeta;
uniform float uStreak;
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
  float I = uBrightness * 1.5 * pow(10.0, -0.4 * 0.58 * mag);
  vec3 col = bvToRgb(bv);
  vec3 d0 = d;
  vec3 d1 = d;
  if (uBeta > 0.0 || uStreak > 0.0) {
    d0 = aberrate(d, uVel, uBeta);
    d1 = aberrate(d, uVel, max(uBeta - uStreak, -0.995));
    float D = doppler(d0, uVel, uBeta);
    col *= dopplerTint(D);
    I *= clamp(D * D, 0.05, 3.0);
  }
  float w0, w1;
  vec2 p0 = toScreen(d0, w0);
  vec2 p1 = toScreen(d1, w1);
  // in warp only the brightest stars stay; the rest would pass by as a swarm of specks
  if (I < 0.004 + uStreak * 25.0 || w0 <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  if (w1 <= 0.0) p1 = p0 + normalize(p0 + 1e-3) * uViewport.x;
  vec2 axis = p1 - p0;
  float len = length(axis);
  vec2 dirA = len > 1e-3 ? axis / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dirA.y, dirA.x);
  float sigma = uPx * (0.62 + 0.5 * smoothstep(0.6, 12.0, I));
  float r = sigma * 3.2;
  // spread energy along the streak
  float energy = I * sigma / (sigma + len * 0.35);
  vColor = col * energy;
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
        uStreak: { value: 0 },
      },
    });
  }

  setMilkyWay(t: Texture): void {
    this.bgMat.uniforms.uMilkyWay.value = t;
  }

  async loadStars(url: string): Promise<number> {
    const buf = await (await fetch(url)).arrayBuffer();
    const n = buf.byteLength / 8;
    const dv = new DataView(buf);
    const dirs = new Int16Array(n * 3);
    const mb = new Uint8Array(n * 2);
    for (let i = 0; i < n; i++) {
      dirs[i * 3] = dv.getInt16(i * 8, true);
      dirs[i * 3 + 1] = dv.getInt16(i * 8 + 2, true);
      dirs[i * 3 + 2] = dv.getInt16(i * 8 + 4, true);
      mb[i * 2] = dv.getUint8(i * 8 + 6);
      mb[i * 2 + 1] = dv.getUint8(i * 8 + 7);
    }
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
    vel: Vector3, beta: number, streak: number,
  ): void {
    const view = new Matrix4().makeRotationFromQuaternion(camQuat).invert();
    this.viewProj.multiplyMatrices(proj, view);
    const bu = this.bgMat.uniforms;
    (bu.uCamRot.value as Matrix3).setFromMatrix4(new Matrix4().makeRotationFromQuaternion(camQuat));
    // projection: x_ndc = P00 * x / -z  ->  tan of the half-angles
    (bu.uTan.value as Vector2).set(1 / proj.elements[0], 1 / proj.elements[5]);
    bu.uIntensity.value = 0.2 * brightness;
    (bu.uVel.value as Vector3).copy(vel);
    bu.uBeta.value = beta;
    const su = this.starMat.uniforms;
    (su.uViewProj.value as Matrix4).copy(this.viewProj);
    (su.uViewport.value as Vector2).copy(viewportPx);
    su.uPx.value = px;
    su.uBrightness.value = brightness;
    (su.uVel.value as Vector3).copy(vel);
    su.uBeta.value = beta;
    su.uStreak.value = streak;
  }
}
