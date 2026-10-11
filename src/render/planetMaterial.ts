import { ALBEDO_SCALE } from './albedo';
import { BackSide, CustomBlending, OneFactor, OneMinusSrcAlphaFactor, ShaderMaterial, Texture, Matrix3, Vector2, Vector3, Vector4 } from 'three';
import { TRANS_H, TRANS_W, transmittanceTexture } from './atmoLut';
import { EQUIRECT, LOGDEPTH_PARS, LOGDEPTH_VERTEX, MATH } from './glsl';
import { SHIP_MASK, shipMaskUniforms } from './shipMask';
import type { BodyDef } from '../sim/bodies';

export const MAX_OCCLUDERS = 4;

const vertex = /* glsl */ `
${LOGDEPTH_PARS}
varying vec3 vRel;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vRel = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  ${LOGDEPTH_VERTEX}
}
`;

const fragment = /* glsl */ `
${LOGDEPTH_PARS}
${MATH}
${EQUIRECT}
${SHIP_MASK}
varying vec3 vRel;

uniform vec3 uCenter;      // body centre relative to camera (world axes)
uniform mat3 uW2B;         // world -> body-fixed
uniform vec3 uAxes;        // ellipsoid semi-axes (km)
uniform vec3 uSunB;        // direction to the Sun, body frame
uniform vec3 uSunIrr;      // solar irradiance (linear RGB, exposure units)
uniform float uSunAng;     // angular radius of the Sun seen from the body
uniform vec3 uCamFwd;      // camera forward (world)
uniform float uPixelAngle; // radians per pixel
uniform float uTime;
uniform sampler2D uMap;
uniform sampler2D uMapW;
uniform vec4 uMapR;
uniform float uMapOn;
uniform float uAlbedoScale;

uniform vec3 uOccPos[${MAX_OCCLUDERS}]; // occluder centres relative to body centre (body frame)
uniform float uOccR[${MAX_OCCLUDERS}];
uniform int uOccN;

#ifdef SHINE
uniform vec3 uShineDir;   // body frame, direction to the shining parent
uniform vec3 uShineCol;
#endif

#ifdef NORMALMAP
uniform sampler2D uNormal;
uniform sampler2D uNormalW;
uniform vec4 uNormalR;
uniform float uNormalOn;
uniform float uNormalStrength;
#endif

#ifdef EARTH
uniform sampler2D uAux;
uniform sampler2D uAuxW;
uniform vec4 uAuxR;
uniform float uAuxOn;
#endif

#ifdef DETAIL
uniform highp sampler3D uDetail;
uniform float uDetailScale;  // detail volume tiles per km
uniform float uDetailTexel;  // km per texel of the finest map
uniform float uDetailBump;
uniform float uDetailAlbedo;
#endif

#ifdef RINGSHADOW
uniform sampler2D uRingTex;
uniform vec2 uRingRange;
#endif

#ifdef ATMO
uniform float uAtmoH;
uniform vec3 uBetaR;
uniform vec3 uBetaM;
uniform vec3 uAbsorb;
uniform float uMieExt;
uniform float uHR;
uniform float uHM;
uniform float uG;
uniform float uAtmoI;
#endif

// --- soft shadows from other spheres (eclipses) ---
float sphereShadow(vec3 p, vec3 L) {
  float s = 1.0;
  for (int i = 0; i < ${MAX_OCCLUDERS}; i++) {
    if (i >= uOccN) break;
    vec3 oc = uOccPos[i] - p;
    float d = length(oc);
    float tca = dot(oc, L);
    if (tca <= 0.0) continue;
    float occAng = asin(clamp(uOccR[i] / d, 0.0, 1.0));
    float sep = acos(clamp(tca / d, -1.0, 1.0));
    // overlap of two discs (sun radius uSunAng, occluder radius occAng) separated by sep
    float r1 = uSunAng, r2 = occAng;
    float cover;
    if (sep >= r1 + r2) cover = 0.0;
    else if (sep <= abs(r2 - r1)) cover = r2 >= r1 ? 1.0 : (r2 * r2) / (r1 * r1);
    else {
      float x = (sep * sep + r1 * r1 - r2 * r2) / (2.0 * sep);
      float a1 = r1 * r1 * acos(clamp(x / r1, -1.0, 1.0)) - x * sqrt(max(r1 * r1 - x * x, 0.0));
      float x2 = sep - x;
      float a2 = r2 * r2 * acos(clamp(x2 / r2, -1.0, 1.0)) - x2 * sqrt(max(r2 * r2 - x2 * x2, 0.0));
      cover = (a1 + a2) / (PI * r1 * r1);
    }
    s *= 1.0 - clamp(cover, 0.0, 1.0);
  }
  return s;
}

#ifdef RINGSHADOW
float ringShadow(vec3 p, vec3 L) {
  if (abs(L.z) < 1e-4) return 1.0;
  float t = -p.z / L.z;
  if (t <= 0.0) return 1.0;
  float r = length(p.xy + L.xy * t);
  float u = (r - uRingRange.x) / (uRingRange.y - uRingRange.x);
  if (u < 0.0 || u > 1.0) return 1.0;
  float a = texture(uRingTex, vec2(u, 0.5)).a;
  return 1.0 - a * 0.92;
}
#endif

#ifdef ATMO
uniform sampler2D uTrans;
// Transmittance of sunlight to radius r with cos(sun zenith) mu, from the precomputed table
// (see atmoLut.ts; includes the soft planet shadow at the terminator).
vec3 sunTrans(float R, float r, float mu) {
  float x = sqrt(clamp((r - R) / uAtmoH, 0.0, 1.0));
  float lo = -sqrt(max(1.0 - (R * R) / (r * r), 0.0)) - 0.02;
  float y = sqrt(clamp((mu - lo) / (1.0 - lo), 0.0, 1.0));
  vec2 n = vec2(${TRANS_W}.0, ${TRANS_H}.0);
  return textureLod(uTrans, (vec2(x, y) * (n - 1.0) + 0.5) / n, 0.0).rgb;
}
float phaseR(float mu) { return 3.0 / (16.0 * PI) * (1.0 + mu * mu); }
float phaseM(float mu, float g) {
  float g2 = g * g;
  return 3.0 / (8.0 * PI) * ((1.0 - g2) * (1.0 + mu * mu)) / ((2.0 + g2) * pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5));
}
vec3 extinction(float odR, float odM) {
  return exp(-((uBetaR + uAbsorb) * odR + uBetaM * uMieExt * odM));
}
// In-scattered radiance along ro + rd*t, t in [t0, t1]. Returns radiance; T gets the transmittance.
vec3 scatter(vec3 ro, vec3 rd, float t0, float t1, float R, vec3 L, bool hitGround, out vec3 T) {
  const int N = 16;
  vec3 sumR = vec3(0.0), sumM = vec3(0.0);
  float odR = 0.0, odM = 0.0;
  float mu = dot(rd, L);
  float len = t1 - t0;
  float prev = 0.0;
  for (int i = 1; i <= N; i++) {
    float s = float(i) / float(N);
    float sm = (float(i) - 0.5) / float(N);
    float u = hitGround ? 1.0 - (1.0 - s) * (1.0 - s) : s;
    float um = hitGround ? 1.0 - (1.0 - sm) * (1.0 - sm) : sm;
    float ds = (u - prev) * len;
    prev = u;
    vec3 p = ro + rd * (t0 + um * len);
    float r = length(p);
    float h = max(r - R, 0.0);
    float dR = exp(-h / uHR) * ds;
    float dM = exp(-h / uHM) * ds;
    vec3 att = extinction(odR + 0.5 * dR, odM + 0.5 * dM) * sunTrans(R, r, dot(p, L) / r);
    sumR += att * dR;
    sumM += att * dM;
    odR += dR;
    odM += dM;
  }
  T = extinction(odR, odM);
  return uSunIrr * uAtmoI * PI * (sumR * uBetaR * phaseR(mu) + sumM * uBetaM * phaseM(mu, uG));
}
#endif

void main() {
  // under the cockpit: the ship pass paints over this pixel, so skip all the work
  if (behindShip()) discard;
  vec3 rdW = normalize(vRel);
  vec3 roB = uW2B * (-uCenter);
  vec3 rdB = uW2B * rdW;
  float R = uAxes.x;
  vec3 sc = uAxes / R;               // ellipsoid -> sphere scale
  vec3 roS = roB / sc;
  vec3 rdS0 = rdB / sc;
  float ls = length(rdS0);
  vec3 rdS = rdS0 / ls;

  vec2 tP = sphIntersect(roS, rdS, R);
  bool hit = tP.y > 0.0 && tP.x > -1e29;
  float tHit = max(tP.x, 0.0);

  // Point used for texturing: the hit point, or the closest approach point for misses (keeps derivatives sane).
  vec3 pS = hit ? roS + rdS * tHit : normalize(roS - dot(roS, rdS) * rdS) * R;
  vec3 pB = pS * sc;
  vec3 dir = normalize(pB);
  vec3 nB = normalize(pB / (uAxes * uAxes));
  vec2 uv = dirToEquirect(dir);
  vec3 L = normalize(uSunB);

  // Coverage for analytic anti-aliasing of the limb.
  float closest = length(roS - dot(roS, rdS) * rdS);
  float distAlong = max(-dot(roS, rdS), 1.0);
  float pix = max(distAlong * uPixelAngle, 1e-6);
  float coverage = clamp((R - closest) / pix + 0.5, 0.0, 1.0);

#ifdef ATMO
  float Ra = R + uAtmoH;
  vec2 tA = sphIntersect(roS, rdS, Ra);
  bool hitA = tA.y > 0.0 && tA.x > -1e29;
#else
  bool hitA = false;
#endif

  if (!hit && !hitA && coverage <= 0.0) discard;

  vec3 color = vec3(0.0);
  float tDepth = tHit / ls;
  vec2 gdx, gdy;
  equirectGrad(uv, gdx, gdy);

  // Surface shading only where the ground (or its anti-aliased limb) shows; sky pixels inside
  // the atmosphere skip every map lookup.
  if (hit || coverage > 0.0) {
  vec4 albedoS = sampleLayered(uMap, uMapW, uMapR, uMapOn, uv, gdx, gdy);
  vec3 albedo = albedoS.rgb * uAlbedoScale;
  vec3 n = nB;

#ifdef NORMALMAP
  vec3 east = normalize(vec3(-dir.y, dir.x, 0.0) + vec3(1e-6, 0.0, 0.0));
  vec3 north = cross(dir, east);
  vec3 tn = sampleLayered(uNormal, uNormalW, uNormalR, uNormalOn, uv, gdx, gdy).xyz * 2.0 - 1.0;
  n = normalize(east * tn.x * uNormalStrength + north * tn.y * uNormalStrength + nB * max(tn.z, 0.2));
#endif

#if defined(EARTH)
  vec4 aux = sampleLayered(uAux, uAuxW, uAuxR, uAuxOn, uv, gdx, gdy);
  // The ocean mask also traces rivers and lakes a texel or two wide, which glinted like white
  // threads across the land. Only water that stays water in a much blurrier read counts.
  float wide = textureGrad(uAux, uv, gdx * 12.0, gdy * 12.0).g;
  float water = aux.g * smoothstep(0.35, 0.8, wide);
  float lights = aux.b;
  // Clouds are part of the surface picture: the 8K cloud map, fixed to the ground (no drift,
  // no separate layer or shadows), read from the same lookup as the ocean mask.
  float cloud = smoothstep(0.08, 0.95, aux.r);
#endif

  float detailShade = 1.0;
#ifdef DETAIL
  // Close up, the finest map texel spans many pixels: add relief finer than the map from a small
  // tiling volume of noise and craters, fading in as the map gets magnified.
  float foot = tDepth * uPixelAngle;
  float detail = smoothstep(1.5, 5.0, uDetailTexel / max(foot, 1e-6)) * (hit ? 1.0 : 0.0);
#if defined(EARTH)
  detail *= (1.0 - smoothstep(0.3, 0.7, water)) * (1.0 - cloud);
#endif
  if (detail > 0.0) {
    vec3 q = pB * uDetailScale;
    // explicit gradients: screen derivatives of positions this large are too noisy up close;
    // the grazing-angle stretch is only partly applied so the relief stays crisp toward the horizon
    float g = foot * uDetailScale;
    vec3 gx = vec3(g, 0.0, 0.0), gy = vec3(0.0, g / sqrt(max(abs(dot(nB, rdB)), 0.1)), 0.0);
    vec4 d1 = textureGrad(uDetail, q, gx, gy);
    vec4 d2 = textureGrad(uDetail, q * 4.37 + 0.31, gx * 4.37, gy * 4.37);
    vec3 dg = (d1.rgb - 0.5) * 2.0 + (d2.rgb - 0.5) * 1.1;
    dg -= nB * dot(dg, nB);
    vec3 nD = normalize(n - dg * (uDetailBump * detail));
    // Light the relief as a bounded brighten/darken of the map's own shading, so small slopes
    // facing away from a low Sun shade the ground instead of punching black holes in it.
    float base = dot(n, L);
    detailShade = exp(0.6 * tanh((dot(nD, L) - base) / (max(base, 0.0) + 0.1)));
    detailShade = mix(1.0, detailShade, smoothstep(0.0, 0.08, base));
    albedo *= 1.0 + ((d1.a - 0.5) + (d2.a - 0.5) * 0.6) * uDetailAlbedo * detail;
  }
#endif

  vec3 V = -rdB;
  float NdotL = dot(n, L);
  float geoNdotL = dot(nB, L);
  float NdotV = max(dot(nB, V), 0.0);
  float shadow = sphereShadow(pB, L);
#ifdef RINGSHADOW
  shadow *= ringShadow(pB, L);
#endif

  vec3 irr = uSunIrr * shadow;
#ifdef ATMO
  // Sunlight reaching the ground through the atmosphere
  irr *= sunTrans(R, R + 0.05, geoNdotL);
#endif

#if defined(EARTH)
  float lambert = max(NdotL, 0.0);
  vec3 ground = albedo * mix(1.0, 0.85, water);
  // ocean: dark, with sun glint (GGX)
  vec3 H = normalize(L + V);
  float NdotH = max(dot(nB, H), 0.0);
  float a2 = 0.09 * 0.09;
  float dd = NdotH * NdotH * (a2 - 1.0) + 1.0;
  float D = a2 / (PI * dd * dd);
  float F = 0.02 + 0.98 * pow(1.0 - max(dot(H, V), 0.0), 5.0);
  float spec = D * F * 0.25 / max(NdotV * max(geoNdotL, 0.0), 0.05) * max(geoNdotL, 0.0);
  vec3 surf = ground * lambert * irr + water * spec * irr * 0.6;
  // clouds: bright, softly lit, fading out across the terminator
  vec3 cloudCol = vec3(0.92) * irr * max(geoNdotL * 0.9 + 0.1, 0.0) * smoothstep(-0.12, 0.1, geoNdotL);
  color = mix(surf, cloudCol, cloud);
  // city lights on the night side
  float night = smoothstep(0.08, -0.18, geoNdotL);
  if (night > 0.0 && lights > 0.0) {
    // break the map's soft blobs into specks of light: fine value noise anchored to the surface
    float speck = vnoise3(dir * 9000.0) * 0.6 + vnoise3(dir * 23000.0) * 0.4;
    float lit = pow(lights, 1.8) * (0.25 + 2.2 * smoothstep(0.45, 0.85, speck));
    vec3 cityCol = vec3(1.0, 0.72, 0.42) * lit * 0.11;
    color += cityCol * night * (1.0 - cloud * 0.85);
  }
#elif defined(GAS)
  // Minnaert limb darkening on the cloud tops
  float k = 0.82;
  float lam = pow(max(geoNdotL, 0.0), k) * pow(max(NdotV, 1e-3), k - 1.0);
  color = albedo * irr * lam * 1.05;
#elif defined(CLOUDY)
  float lam = max(geoNdotL, 0.0);
  color = albedo * irr * (0.75 * lam + 0.25 * pow(max(geoNdotL, 0.0), 0.5) * lam);
#else
  // Airless bodies: blend of Lommel-Seeliger (regolith) and Lambert.
  float mu0 = max(NdotL, 0.0);
  float muG = max(geoNdotL, 0.0);
  float lsl = 2.0 * mu0 / (mu0 + max(NdotV, 0.05)) * smoothstep(-0.02, 0.06, muG);
  float lam = mu0;
  color = albedo * irr * mix(lam, lsl, 0.55);
#endif

  color *= detailShade;

#ifdef SHINE
  // reflected light from the parent planet (e.g. Earthshine on the Moon)
  color += albedo * uShineCol * max(dot(n, normalize(uShineDir)), 0.0);
#endif
  }

  float alpha = coverage;

#ifdef ATMO
  if (hitA) {
    float t0 = max(tA.x, 0.0);
    float t1 = hit ? tHit : tA.y;
    vec3 T;
    vec3 ins = scatter(roS, rdS, t0, t1, R, L, hit, T);
    if (hit) {
      color = color * T + ins;
      // keep the atmosphere glow beyond the anti-aliased limb
      alpha = 1.0;
    } else {
      float tm = (T.r + T.g + T.b) / 3.0;
      // blend AA'd limb surface (if any) with the haze
      color = mix(ins, color * T + ins, coverage);
      alpha = mix(1.0 - tm, 1.0, coverage);
      tDepth = t0 / ls;
    }
#if defined(EARTH)
    // faint green airglow layer (~95 km) seen edge-on on the night side
    float closestH = closest - R;
    float glow = exp(-pow((closestH - 95.0) / 7.0, 2.0)) * (hit ? 0.0 : 1.0);
    color += vec3(0.25, 1.0, 0.45) * glow * 0.0035 * smoothstep(0.1, -0.2, dot(normalize(roS - dot(roS, rdS) * rdS), L));
#endif
  }
#endif

  color = max(color, vec3(0.0));
  gl_FragColor = vec4(color * alpha, alpha);
  float w = max(tDepth * dot(rdW, uCamFwd), 1e-6);
  gl_FragDepth = logDepthValue(w);
}
`;

export function createPlanetMaterial(def: BodyDef, map: Texture, hasNormal: boolean, detail: Texture | null = null): ShaderMaterial {
  const defines: Record<string, string> = {};
  if (def.atmosphere) defines.ATMO = '';
  if (def.shading === 'earth') defines.EARTH = '';
  if (def.shading === 'gas' || def.shading === 'icegiant') defines.GAS = '';
  if (def.shading === 'cloudy') defines.CLOUDY = '';
  if (hasNormal) defines.NORMALMAP = '';
  if (def.rings) defines.RINGSHADOW = '';
  if (def.kind === 'moon') defines.SHINE = '';
  // solid ground you can fly low over gets synthetic close-up relief
  if (detail && (def.shading === 'rocky' || def.shading === 'earth')) defines.DETAIL = '';
  const a = def.atmosphere;
  const axes = def.triaxial
    ? new Vector3(def.triaxial[0], def.triaxial[1], def.triaxial[2])
    : new Vector3(def.radius, def.radius, def.polarRadius ?? def.radius);
  const mat = new ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    defines,
    side: BackSide,
    transparent: true,
    depthWrite: true,
    depthTest: true,
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
    blendSrcAlpha: OneFactor,
    blendDstAlpha: OneMinusSrcAlphaFactor,
    uniforms: {
      uLogDepthF: { value: 1 },
      uCenter: { value: new Vector3() },
      uW2B: { value: new Matrix3() },
      uAxes: { value: axes },
      uSunB: { value: new Vector3(1, 0, 0) },
      uSunIrr: { value: new Vector3(1, 1, 1) },
      uSunAng: { value: 0.00465 },
      uCamFwd: { value: new Vector3(0, 0, -1) },
      uPixelAngle: { value: 0.001 },
      uTime: { value: 0 },
      uMap: { value: map },
      uMapW: { value: map },
      uMapR: { value: new Vector4(0, 0, 1, 1) },
      uMapOn: { value: 0 },
      uAlbedoScale: { value: ALBEDO_SCALE[def.id] ?? 1 },
      uOccPos: { value: Array.from({ length: MAX_OCCLUDERS }, () => new Vector3()) },
      uOccR: { value: new Array(MAX_OCCLUDERS).fill(0) },
      uOccN: { value: 0 },
      uShineDir: { value: new Vector3() },
      uShineCol: { value: new Vector3() },
      uNormal: { value: null },
      uNormalW: { value: null },
      uNormalR: { value: new Vector4(0, 0, 1, 1) },
      uNormalOn: { value: 0 },
      uNormalStrength: { value: 1.0 },
      uAux: { value: null },
      uAuxW: { value: null },
      uAuxR: { value: new Vector4(0, 0, 1, 1) },
      uAuxOn: { value: 0 },
      uRingTex: { value: null },
      uDetail: { value: detail },
      uDetailScale: { value: 1 },
      uDetailTexel: { value: 1 },
      uDetailBump: { value: def.shading === 'earth' ? 0.14 : 0.2 },
      uDetailAlbedo: { value: def.shading === 'earth' ? 0.18 : 0.22 },
      uRingRange: { value: def.rings ? new Vector2(def.rings.inner, def.rings.outer) : new Vector2(0, 1) },
      uAtmoH: { value: a?.height ?? 0 },
      uTrans: { value: a ? transmittanceTexture(axes.x, a) : null },
      uBetaR: { value: new Vector3(...(a?.rayleigh ?? [0, 0, 0])) },
      uBetaM: { value: new Vector3(...(a?.mie ?? [0, 0, 0])) },
      uAbsorb: { value: new Vector3(...(a?.absorb ?? [0, 0, 0])) },
      uMieExt: { value: a?.mieAbsorb ?? 1 },
      uHR: { value: a?.rayleighH ?? 8 },
      uHM: { value: a?.mieH ?? 1 },
      uG: { value: a?.mieG ?? 0.7 },
      uAtmoI: { value: a?.intensity ?? 1 },
      ...shipMaskUniforms,
    },
  });
  return mat;
}
