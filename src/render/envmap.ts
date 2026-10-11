import {
  BufferAttribute, BufferGeometry, EquirectangularReflectionMapping, HalfFloatType, LinearFilter, Matrix3, Mesh,
  OrthographicCamera, Scene, ShaderMaterial, Texture, Vector3, WebGLRenderTarget, type WebGLRenderer,
} from 'three';
import { EQUIRECT, MATH } from './glsl';
import type { Universe } from './universe';
import type { Ephemeris } from '../sim/ephemeris';
import { AU_KM } from '../sim/constants';

const N = 3;

const FRAG = /* glsl */ `
${MATH}
${EQUIRECT}
varying vec2 vUv;
uniform sampler2D uMilkyWay;
uniform mat3 uW2G;
uniform float uSkyI;
uniform int uCount;
uniform vec3 uDir[${N}];     // direction to body centre (world)
uniform float uSinR[${N}];   // angular radius sine
uniform float uDist[${N}];   // centre distance in body radii
uniform mat3 uW2B[${N}];
uniform vec3 uSunB[${N}];
uniform vec3 uIrr[${N}];
uniform vec3 uHaze[${N}];    // atmosphere colour (0 = none)
uniform float uHazeH[${N}];  // atmosphere height / radius
uniform sampler2D uMap0;
uniform sampler2D uMap1;
uniform sampler2D uMap2;

vec3 texBody(int i, vec2 uv) {
  if (i == 0) return textureLod(uMap0, uv, 3.0).rgb;
  if (i == 1) return textureLod(uMap1, uv, 3.0).rgb;
  return textureLod(uMap2, uv, 3.0).rgb;
}

void main() {
  float lon = (vUv.x - 0.5) * TAU;
  float lat = (vUv.y - 0.5) * PI;
  // inverse of three.js equirectUv(): u = atan(z, x) / 2pi + 0.5, v = asin(y) / pi + 0.5
  vec3 rd = vec3(cos(lat) * cos(lon), sin(lat), cos(lat) * sin(lon));
  vec3 g = uW2G * rd;
  vec2 guv = vec2(0.5 - atan(g.y, g.x) * (0.5 / PI), asin(clamp(g.z, -1.0, 1.0)) / PI + 0.5);
  vec3 col = textureLod(uMilkyWay, guv, 2.0).rgb * uSkyI;
  float tBest = 1e30;
  for (int i = 0; i < ${N}; i++) {
    if (i >= uCount) break;
    // unit sphere at distance uDist along uDir
    vec3 c = uDir[i] * uDist[i];
    float b = dot(c, rd);
    if (b <= 0.0) continue;
    float d2 = dot(c, c) - b * b;
    float hazeR = 1.0 + uHazeH[i];
    if (d2 < 1.0 && b < tBest) {
      float t = b - sqrt(1.0 - d2);
      vec3 p = rd * t - c; // unit normal
      vec3 pB = uW2B[i] * p;
      vec2 uv = dirToEquirect(pB);
      vec3 alb = texBody(i, uv);
      float l = max(dot(pB, uSunB[i]), 0.0);
      col = alb * uIrr[i] * l;
      col += uHaze[i] * uIrr[i] * 0.35 * smoothstep(-0.2, 0.3, dot(pB, uSunB[i])) * pow(1.0 - max(dot(-rd, p), 0.0), 3.0);
      tBest = b;
    } else if (d2 < hazeR * hazeR && uHazeH[i] > 0.0) {
      float h = (sqrt(d2) - 1.0) / uHazeH[i];
      vec3 pc = normalize(rd * b - c);
      float lit = smoothstep(-0.25, 0.25, dot(uW2B[i] * pc, uSunB[i]));
      col += uHaze[i] * uIrr[i] * exp(-h * 4.0) * lit * 0.6;
    }
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const _rel = new Vector3();
const _tmp = new Vector3();
/** a re-render that changes nothing visible still costs a full reflection (PMREM) rebuild, so skip it */
const MAX_AGE = 5;

/** Low-res equirect environment (sky + nearby lit bodies) for ship reflections and planet-shine. */
export class EnvMap {
  readonly target = new WebGLRenderTarget(256, 128, { type: HalfFloatType, depthBuffer: false, minFilter: LinearFilter, magFilter: LinearFilter });
  private scene = new Scene();
  private cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private mat: ShaderMaterial;
  private timer = 0;
  private age = Infinity;
  /** what the last render was made from, each value scaled so a change of 1 is about the smallest that shows */
  private sig: number[] = [];
  private nextSig: number[] = [];
  private inputs: (Texture | null)[] = [];

  constructor(private renderer: WebGLRenderer, private universe: Universe, private eph: Ephemeris, w2g: Matrix3) {
    this.target.texture.mapping = EquirectangularReflectionMapping;
    const tri = new BufferGeometry();
    tri.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.mat = new ShaderMaterial({
      vertexShader: 'varying vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uMilkyWay: { value: null },
        uW2G: { value: w2g },
        uSkyI: { value: 0.3 },
        uCount: { value: 0 },
        uDir: { value: Array.from({ length: N }, () => new Vector3()) },
        uSinR: { value: new Array(N).fill(0) },
        uDist: { value: new Array(N).fill(10) },
        uW2B: { value: Array.from({ length: N }, () => new Matrix3()) },
        uSunB: { value: Array.from({ length: N }, () => new Vector3()) },
        uIrr: { value: Array.from({ length: N }, () => new Vector3()) },
        uHaze: { value: Array.from({ length: N }, () => new Vector3()) },
        uHazeH: { value: new Array(N).fill(0) },
        uMap0: { value: null },
        uMap1: { value: null },
        uMap2: { value: null },
      },
    });
    const m = new Mesh(tri, this.mat);
    m.frustumCulled = false;
    this.scene.add(m);
  }

  get texture(): Texture {
    return this.target.texture;
  }

  setMilkyWay(t: Texture): void {
    this.mat.uniforms.uMilkyWay.value = t;
  }

  /**
   * Checks every `interval` seconds whether the environment changed enough to show (bodies moved or turned
   * against the view, the light or the exposure changed, a texture was swapped) and re-renders it only then,
   * or immediately when forced.
   */
  update(dt: number, camAbs: Vector3, skyI: number, force = false, interval = 0.35): boolean {
    this.timer -= dt;
    this.age += dt;
    if (this.timer > 0 && !force) return false;
    this.timer = interval;
    const u = this.mat.uniforms;
    const sun = this.eph.get('sun');
    // pick the bodies with the largest angular size
    const cands = this.universe.views
      .filter((v) => v.state.def.kind !== 'star')
      .map((v) => ({ v, ang: v.state.def.radius / Math.max(_rel.subVectors(v.state.pos, camAbs).length(), 1) }))
      .sort((a, b) => b.ang - a.ang)
      .slice(0, N)
      .filter((c) => c.ang > 0.002);
    u.uCount.value = cands.length;
    u.uSkyI.value = 0.3 * skyI;
    cands.forEach((c, i) => {
      const s = c.v.state;
      const R = s.def.radius;
      _rel.subVectors(s.pos, camAbs);
      const d = _rel.length();
      (u.uDir.value as Vector3[])[i].copy(_rel).multiplyScalar(1 / d);
      (u.uDist.value as number[])[i] = Math.max(d / R, 1.0005);
      (u.uSinR.value as number[])[i] = R / d;
      const w2b = (u.uW2B.value as Matrix3[])[i].copy(s.rot).transpose();
      _tmp.subVectors(sun.pos, s.pos);
      const ds = _tmp.length();
      (u.uSunB.value as Vector3[])[i].copy(_tmp).multiplyScalar(1 / ds).applyMatrix3(w2b);
      const irr = (AU_KM / ds) ** 2;
      (u.uIrr.value as Vector3[])[i].set(irr, irr * 0.975, irr * 0.94);
      const atmo = s.def.atmosphere;
      const haze = (u.uHaze.value as Vector3[])[i];
      if (atmo && s.def.shading === 'earth') haze.set(0.12, 0.28, 0.75);
      else if (atmo && s.def.id === 'mars') haze.set(0.35, 0.22, 0.12);
      else if (atmo) haze.set(0.4, 0.33, 0.2);
      else haze.set(0, 0, 0);
      (u.uHazeH.value as number[])[i] = atmo ? Math.max(atmo.height / R, 0.01) : 0;
      u[`uMap${i}`].value = c.v.mat.uniforms.uMap.value;
    });
    const changed = this.changed(cands.length);
    if (!force && this.age < MAX_AGE && !changed) return false;
    this.age = 0;
    [this.sig, this.nextSig] = [this.nextSig, this.sig];
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(this.scene, this.cam);
    this.renderer.setRenderTarget(prev);
    this.target.texture.needsPMREMUpdate = true;
    return true;
  }

  /** Builds the signature of the uniforms just set into nextSig and compares it with the last render's. */
  private changed(count: number): boolean {
    const u = this.mat.uniforms;
    const sig = this.nextSig;
    sig.length = 0;
    // directions to about 0.2 degrees (a pixel of the 256-wide map is 1.4), distance, light and exposure to 1-2%
    const D = 1 / 0.003;
    sig.push(Math.log(u.uSkyI.value) * 50);
    for (let i = 0; i < count; i++) {
      const dir = (u.uDir.value as Vector3[])[i];
      const sunB = (u.uSunB.value as Vector3[])[i];
      sig.push(dir.x * D, dir.y * D, dir.z * D, sunB.x * D, sunB.y * D, sunB.z * D);
      for (const e of (u.uW2B.value as Matrix3[])[i].elements) sig.push(e * D);
      sig.push(Math.log((u.uDist.value as number[])[i]) * D, Math.log((u.uIrr.value as Vector3[])[i].x) * 100);
    }
    let changed = sig.length !== this.sig.length;
    for (let k = 0; !changed && k < sig.length; k++) changed = Math.abs(sig[k] - this.sig[k]) > 1;
    // a body's texture (or the sky's) swapped for a sharper one
    const tex = [u.uMilkyWay.value, ...Array.from({ length: count }, (_, i) => u[`uMap${i}`].value)];
    if (tex.length !== this.inputs.length || tex.some((t, i) => t !== this.inputs[i])) changed = true;
    this.inputs = tex;
    return changed;
  }
}
