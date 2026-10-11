import {
  AddEquation, BufferAttribute, BufferGeometry, CustomBlending, FloatType, HalfFloatType, LinearFilter, Mesh,
  NoBlending, OneFactor, OrthographicCamera, RGBAFormat, Scene, ShaderMaterial, Vector2, WebGLRenderTarget,
  type Texture, type WebGLRenderer,
} from 'three';
import { MATH } from './glsl';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const DOWNSAMPLE = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform bool uKaris;
vec3 s(vec2 o) { return texture(uSrc, vUv + o * uTexel).rgb; }
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
uniform float uSunOn;
uniform float uSunPower;
// warp
uniform vec2 uApex;
uniform float uWarp;      // tunnel strength 0..1
uniform float uWarpSpeed; // streak scroll speed
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

float flareDisc(vec2 p, vec2 c, float r, float soft) {
  float d = length((p - c) * vec2(uResolution.x / uResolution.y, 1.0));
  return smoothstep(r, r * (1.0 - soft), d);
}

void main() {
  vec2 uv = vUv;
  vec2 aspect = vec2(uResolution.x / uResolution.y, 1.0);
  // camera shake (warp entry)
  uv += uShake * 0.004 * vec2(sin(uTime * 61.0) + sin(uTime * 23.0), cos(uTime * 47.0) + sin(uTime * 31.0));
  // warp bubble lensing: radial compression toward the apex with a refractive ring
  float hull = texture(uScene, uv).a; // 1 where the ship was drawn
  float space = 1.0 - clamp(hull, 0.0, 1.0);
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
  float agitation = max(uBubble, uSpool * 0.8);
  // random surges that get stronger and more frequent with the warp factor
  float surge = smoothstep(0.55, 1.0, vnoise3(vec3(uTime * (0.5 + 2.5 * uChaos), uSeed * 37.0, 1.7)));
  float wild = uChaos * (0.6 + 1.4 * surge);
  if (agitation > 0.001) {
    // space itself ripples: noisy waves running out of the apex, sheared sideways by a second noise field
    float flow = uTime * uWarpSpeed;
    vec3 so = vec3(uSeed * 61.0, uSeed * 23.0, 0.0);
    float n1 = fbm3(polar * (1.7 + uChaos * 1.5) + so + vec3(0.0, 0.0, lr * 1.3 - flow * 0.6));
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
  vec2 suv = uApex + lens / aspect;
  // chromatic aberration grows with warp
  float ca = uBubble * 0.006 * r * (1.0 + 2.5 * wild) + 0.0006 * dot(uv - 0.5, uv - 0.5);
  vec2 cdir = normalize(dv + 1e-5) / aspect;
  vec3 scene;
  scene.r = texture(uScene, suv + cdir * ca).r;
  scene.g = texture(uScene, suv).g;
  scene.b = texture(uScene, suv - cdir * ca).b;
  vec3 bloom = texture(uBloom, suv).rgb;

  float avg = texture(uAdapt, vec2(0.5)).r;
  float adapt = clamp(pow(0.16 / max(avg, 1e-4), 0.55), 0.3, 2.2);
  float exposure = uExposure * mix(1.0, adapt, uAdaptStrength);
  vec3 col = mix(scene, bloom, uBloomStrength) * exposure;

  // Lens flare from the Sun: visibility measured from the scene itself (occluded by planets and the cockpit)
  if (uSunOn > 0.0) {
    float vis = 0.0;
    for (int i = 0; i < 9; i++) {
      vec2 o = vec2(float(i % 3) - 1.0, float(i / 3) - 1.0) * 2.0 / uResolution;
      vis += smoothstep(40.0, 400.0, dot(texture(uScene, uSunUv + o).rgb, vec3(0.3333)));
    }
    vis /= 9.0;
    vec2 axis = vec2(0.5) - uSunUv;
    vec3 fl = vec3(0.0);
    fl += vec3(0.9, 0.6, 0.35) * flareDisc(uv, uSunUv + axis * 0.55, 0.03, 0.4) * 0.012;
    fl += vec3(0.35, 0.6, 1.0) * flareDisc(uv, uSunUv + axis * 0.85, 0.05, 0.15) * 0.008;
    fl += vec3(0.5, 1.0, 0.6) * flareDisc(uv, uSunUv + axis * 1.25, 0.02, 0.5) * 0.014;
    fl += vec3(1.0, 0.5, 0.8) * flareDisc(uv, uSunUv + axis * 1.6, 0.09, 0.08) * 0.005;
    fl += vec3(0.6, 0.75, 1.0) * flareDisc(uv, uSunUv + axis * 2.1, 0.15, 0.05) * 0.003;
    // soft veiling glare across the whole frame
    float dsun = length((uv - uSunUv) * aspect);
    fl += vec3(1.0, 0.9, 0.8) * 0.02 / (1.0 + dsun * dsun * 40.0);
    col += fl * vis * uSunPower;
  }

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
    float shafts = vnoise3(polar * (9.0 + 9.0 * uChaos) + vec3(uSeed * 11.0, 0.0, uTime * (0.35 + 1.4 * uChaos)));
    shafts = 0.25 + 1.5 * pow(shafts, 2.5 - uChaos);
    // flicker: steady at 1c, stuttering at 100c
    float flick = mix(1.0, 0.35 + 1.4 * hash12(vec2(floor(uTime * 14.0), uSeed * 91.0)), uChaos * 0.7);
    // light pouring out of the apex itself, drifting through colours at high factors
    vec3 coreCol = mix(vec3(0.55, 0.75, 1.0), warpHue(uSeed + uTime * 0.07 + ang * 0.08), uChaos * 0.55);
    vec3 core = coreCol * pow(vnoise3(polar * 16.0 + vec3(3.0, 0.0, uTime * 0.6)), 3.0) * (0.7 + 0.8 * wild) / (1.0 + r * 3.5);
    shafts *= flick;
    col += (acc * vec3(0.8, 0.9, 1.0) * shafts * 0.3 + core * shafts) * uRays * smoothstep(0.0, 0.08, r) * (0.25 + 0.75 * space);
  }

  // Warp tunnel: sparse light streaks scrolling out of the apex (polar coordinates, log-radius)
  if (uWarp > 0.001) {
    // strange occlusion: dark veins crawl along the tunnel wall and the edges sink into shadow
    float occl = smoothstep(0.52, 0.72, veins) * smoothstep(0.12, 0.6, r);
    float edge = smoothstep(0.45, 1.35, r);
    float horizon = exp(-pow((r - 0.11) / 0.045, 2.0));
    col *= 1.0 - uWarp * clamp(((0.7 * occl + 0.5 * horizon) * space + 0.55 * edge * (0.5 + veins)) * (0.75 + 0.5 * wild), 0.0, 0.93);
    float a1 = ang * 40.0 / TAU;
    float cell = floor(a1 * 4.0);
    float rnd = hash12(vec2(cell, 3.7));
    float rnd2 = hash12(vec2(cell, 9.1));
    float z = lr * 1.6 - uTime * uWarpSpeed * (0.5 + rnd);
    float on = step(0.55, rnd2);
    float streak = on * smoothstep(0.86, 1.0, fract(z + rnd2 * 7.0)) * smoothstep(0.5, 0.0, abs(fract(a1 * 4.0) - 0.5));
    float z2 = lr * 1.1 - uTime * uWarpSpeed * 0.35;
    float wisps = fbm3(vec3(cos(ang) * 2.5, sin(ang) * 2.5, z2));
    float mask = smoothstep(0.08, 0.6, r) * smoothstep(1.6, 0.5, r);
    vec3 tint = mix(vec3(0.45, 0.65, 1.0), vec3(0.8, 0.72, 1.0), rnd);
    tint = mix(tint, warpHue(uSeed + rnd * 0.6 + uTime * 0.05) * 1.2, uChaos * 0.6 * rnd2);
    vec3 tunnel = tint * (streak * 0.9 + pow(wisps, 4.0) * 0.35) * mask;
    // glow of the warp bubble around the apex
    tunnel += vec3(0.6, 0.8, 1.0) * 0.18 / (1.0 + r * r * 160.0);
    col += tunnel * uWarp * 0.55;
  }
  // entry / exit flash: bright at the apex, a soft veil elsewhere
  col += vec3(0.75, 0.88, 1.0) * uFlash * (0.25 + 2.5 / (1.0 + r * r * 30.0));

  vec3 outc = agx(col);
  // vignette + grain + dither
  float vig = 1.0 - 0.22 * pow(length((vUv - 0.5) * vec2(1.0, 0.9)) * 1.25, 2.6);
  outc *= vig;
  float n = hash12(gl_FragCoord.xy + fract(uTime * 13.7) * 431.0);
  outc += (n - 0.5) * (1.6 / 255.0);
  gl_FragColor = vec4(outc, 1.0);
}`;

export interface PostParams {
  exposure: number;
  adaptStrength: number;
  bloomStrength: number;
  time: number;
  dt: number;
  sunUv: Vector2;
  sunOn: number;
  sunPower: number;
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
  private scene = new Scene();
  private cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: Mesh;
  private down: ShaderMaterial;
  private up: ShaderMaterial;
  private adaptMat: ShaderMaterial;
  private comp: ShaderMaterial;
  private width = 1;
  private height = 1;

  constructor(private renderer: WebGLRenderer, samples: number) {
    this.hdr = new WebGLRenderTarget(1, 1, {
      type: HalfFloatType, format: RGBAFormat, depthBuffer: true, stencilBuffer: false, samples,
      minFilter: LinearFilter, magFilter: LinearFilter, generateMipmaps: false,
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
        uSunUv: { value: new Vector2() }, uSunOn: { value: 0 }, uSunPower: { value: 1 },
        uApex: { value: new Vector2(0.5, 0.5) }, uWarp: { value: 0 }, uWarpSpeed: { value: 1 }, uFlash: { value: 0 },
        uBubble: { value: 0 }, uShake: { value: 0 }, uSpool: { value: 0 }, uRays: { value: 0 }, uChaos: { value: 0 }, uSeed: { value: 0 },
      },
    });
    this.quad = new Mesh(tri, this.comp);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  setSize(w: number, h: number): void {
    this.width = w;
    this.height = h;
    this.hdr.setSize(w, h);
    this.bg.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1));
    let mw = w, mh = h;
    for (const m of this.mips) {
      mw = Math.max(1, mw >> 1);
      mh = Math.max(1, mh >> 1);
      m.setSize(mw, mh);
    }
  }

  setSamples(samples: number): void {
    this.hdr.samples = samples;
    this.hdr.dispose();
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
    this.pass(this.comp, null);
    r.autoClear = autoClear;
  }
}

