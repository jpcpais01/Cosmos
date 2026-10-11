import {
  AdditiveBlending, BackSide, CustomBlending, DoubleSide, OneFactor, OneMinusSrcAlphaFactor, ShaderMaterial, Texture,
  Vector2, Vector3, Matrix3,
} from 'three';
import { EQUIRECT, LOGDEPTH_PARS, LOGDEPTH_VERTEX, MATH } from './glsl';

const proxyVertex = /* glsl */ `
${LOGDEPTH_PARS}
varying vec3 vRel;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vRel = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  ${LOGDEPTH_VERTEX}
}
`;

/** Radiance of the Sun's disc in the HDR buffer. */
export const SUN_RADIANCE = 2000;

/** The Sun: exact sphere, limb darkening, animated granulation. */
export function createSunMaterial(map: Texture): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: proxyVertex,
    fragmentShader: /* glsl */ `
${LOGDEPTH_PARS}
${MATH}
${EQUIRECT}
varying vec3 vRel;
uniform vec3 uCenter;
uniform mat3 uW2B;
uniform float uRadius;
uniform vec3 uCamFwd;
uniform float uPixelAngle;
uniform float uTime;
uniform float uRadiance;
uniform float uDiscGain;
uniform sampler2D uMap;
void main() {
  vec3 rdW = normalize(vRel);
  vec3 ro = uW2B * (-uCenter);
  vec3 rd = uW2B * rdW;
  vec2 t = sphIntersect(ro, rd, uRadius);
  float closest = length(ro - dot(ro, rd) * rd);
  float pix = max(-dot(ro, rd), 1.0) * uPixelAngle;
  float cov = clamp((uRadius - closest) / pix + 0.5, 0.0, 1.0);
  if (cov <= 0.0) discard;
  float th = max(t.x, 0.0);
  vec3 p = t.x > -1e29 ? ro + rd * th : normalize(ro - dot(ro, rd) * rd) * uRadius;
  vec3 n = normalize(p);
  float mu = clamp(dot(n, -rd), 0.0, 1.0);
  vec2 uv = dirToEquirect(n);
  vec3 tex = sampleEquirect(uMap, uv).rgb;
  float lumT = dot(tex, vec3(0.3, 0.55, 0.15));
  // fine animated granulation on top of the photographic map, faded out once its cells get smaller
  // than a pixel (sampled any finer it only sparkles as the view moves)
  float fp = pix / uRadius;
  float w1 = 1.0 - smoothstep(1.0 / 180.0, 4.0 / 180.0, fp);
  float w2 = 1.0 - smoothstep(1.0 / 700.0, 4.0 / 700.0, fp);
  float gran = 1.0;
  if (w1 > 0.0) gran += w1 * (0.28 * fbm3(n * 180.0 + vec3(0.0, 0.0, uTime * 0.02)) - 0.14);
  if (w2 > 0.0) gran += w2 * (0.12 * fbm3(n * 700.0 - vec3(uTime * 0.05)) - 0.06);
  vec3 limb = pow(vec3(max(mu, 1e-3)), vec3(0.38, 0.5, 0.68));
  vec3 base = vec3(1.0, 0.93, 0.82);
  vec3 c = base * limb * gran * mix(0.75, 1.25, lumT) * uRadiance;
  // uDiscGain hands a disc only a pixel or two wide over to the point of light
  cov *= uDiscGain;
  gl_FragColor = vec4(c * cov, cov);
  float w = max(th * dot(rdW, uCamFwd), 1e-6);
  gl_FragDepth = logDepthValue(w);
}`,
    side: BackSide,
    transparent: true,
    depthWrite: true,
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
    uniforms: {
      uLogDepthF: { value: 1 },
      uCenter: { value: new Vector3() },
      uW2B: { value: new Matrix3() },
      uRadius: { value: 695700 },
      uCamFwd: { value: new Vector3() },
      uPixelAngle: { value: 0.001 },
      uTime: { value: 0 },
      uRadiance: { value: SUN_RADIANCE },
      uDiscGain: { value: 1 },
      uMap: { value: map },
    },
  });
}

/** Soft corona / glare around the Sun, as a camera-facing quad. */
export function createSunGlowMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: /* glsl */ `
${LOGDEPTH_PARS}
uniform float uSize;
varying vec2 vUv;
void main() {
  vUv = position.xy;
  vec4 c = viewMatrix * modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  c.xy += position.xy * uSize;
  gl_Position = projectionMatrix * c;
  ${LOGDEPTH_VERTEX}
}`,
    fragmentShader: /* glsl */ `
uniform float uIntensity;
uniform float uRatio; // sun radius / quad half-size
varying vec2 vUv;
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  float x = max(r / uRatio, 1.0);
  float corona = pow(x, -3.2) * 0.6 + pow(x, -1.6) * 0.04;
  float fade = smoothstep(1.0, 0.6, r);
  vec3 col = vec3(1.0, 0.86, 0.68) * corona * fade * uIntensity;
  gl_FragColor = vec4(col, 0.0);
}`,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    premultipliedAlpha: true, // ONE, ONE: shaders output alpha 0
    uniforms: {
      uLogDepthF: { value: 1 },
      uSize: { value: 1 },
      uIntensity: { value: 1 },
      uRatio: { value: 0.1 },
    },
  });
}

/** Planetary rings: texture radial profile, lit/unlit side, planet shadow, forward scattering. */
export function createRingMaterial(tex: Texture, inner: number, outer: number, axes: Vector3): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: /* glsl */ `
${LOGDEPTH_PARS}
varying vec3 vRel;
varying vec2 vLocal;
void main() {
  vLocal = position.xy;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vRel = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  ${LOGDEPTH_VERTEX}
}`,
    fragmentShader: /* glsl */ `
${LOGDEPTH_PARS}
${MATH}
varying vec3 vRel;
varying vec2 vLocal;
uniform sampler2D uTex;
uniform vec2 uRange;
uniform vec3 uSunB;   // body frame
uniform vec3 uViewB;  // camera position, body frame
uniform vec3 uSunIrr;
uniform vec3 uAxes;
uniform vec3 uCamFwd;
uniform float uPixelAngle;
void main() {
  float r = length(vLocal);
  float u = (r - uRange.x) / (uRange.y - uRange.x);
  if (u < 0.0 || u > 1.0) discard;
  vec4 t = texture(uTex, vec2(u, 0.5));
  // procedural fine ringlets that appear when close (texture alone is blurry up close)
  float dist = length(vRel);
  float px = dist * uPixelAngle;
  float fine = 0.0;
  float amp = 0.0;
  for (int i = 0; i < 3; i++) {
    float scale = 40.0 * pow(4.0, float(i)); // km per band
    float vis = smoothstep(scale * 0.5, scale * 0.1, px);
    float n = hash12(vec2(floor(r / scale), float(i) * 7.0));
    fine += (n - 0.5) * vis;
    amp += vis;
  }
  float alpha = clamp(t.a * (1.0 + 0.55 * fine), 0.0, 1.0);
  vec3 col = t.rgb * (1.0 + 0.25 * fine);
  vec3 p = vec3(vLocal, 0.0);
  vec3 L = normalize(uSunB);
  vec3 V = normalize(uViewB - p);
  // planet shadow on the rings
  vec3 sc = uAxes / uAxes.x;
  vec3 ps = p / sc;
  vec3 ls = normalize(L / sc);
  vec2 hit = sphIntersect(ps, ls, uAxes.x);
  float shadow = (hit.y > 0.0 && hit.x > -1e29) ? 0.0 : 1.0;
  // lit vs unlit face
  float sunSide = sign(L.z);
  float viewSide = sign(V.z);
  float cosI = abs(L.z);
  float g = dot(-V, L);
  vec3 lit;
  if (sunSide == viewSide) {
    // back-scattering icy particles: brightness depends weakly on incidence (dense, many-particle layer)
    lit = col * (0.35 + 0.65 * pow(cosI, 0.35)) * (1.0 + 0.4 * pow(max(-g, 0.0), 8.0));
  } else {
    // seen from the unlit side: light diffuses through thin regions, strong forward scattering
    float through = alpha * (1.0 - alpha) * 1.8 + 0.06 * alpha;
    lit = col * through * (0.4 + 3.0 * pow(max(g, 0.0), 6.0));
  }
  vec3 c = lit * uSunIrr * shadow;
  gl_FragColor = vec4(c * alpha, alpha);
  gl_FragDepth = logDepthValue(max(dot(vRel, uCamFwd), 1e-6));
}`,
    side: DoubleSide,
    transparent: true,
    depthWrite: false,
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
    uniforms: {
      uLogDepthF: { value: 1 },
      uTex: { value: tex },
      uRange: { value: new Vector2(inner, outer) },
      uSunB: { value: new Vector3(1, 0, 0) },
      uViewB: { value: new Vector3() },
      uSunIrr: { value: new Vector3(1, 1, 1) },
      uAxes: { value: axes },
      uCamFwd: { value: new Vector3() },
      uPixelAngle: { value: 0.001 },
    },
  });
}

/** Unresolved bodies rendered as points of light with their apparent brightness. */
export function createBodyPointsMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: /* glsl */ `
${LOGDEPTH_PARS}
attribute vec3 aColor;
attribute float aIntensity;
uniform float uPx;
uniform float uBright;
varying vec3 vColor;
void main() {
  vColor = aColor * aIntensity * uBright;
  vec4 mv = viewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aIntensity > 0.0 ? uPx * 5.0 : 0.0;
  ${LOGDEPTH_VERTEX}
}`,
    fragmentShader: /* glsl */ `
varying vec3 vColor;
uniform float uPx;
void main() {
  vec2 d = (gl_PointCoord - 0.5) * 5.0;
  float r2 = dot(d, d);
  float g = exp(-r2 * 1.1);
  gl_FragColor = vec4(vColor * g, 0.0);
}`,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: AdditiveBlending,
    premultipliedAlpha: true, // ONE, ONE: shaders output alpha 0
    uniforms: { uLogDepthF: { value: 1 }, uPx: { value: 1 }, uBright: { value: 1 } },
  });
}
