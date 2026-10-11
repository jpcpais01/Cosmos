import {
  AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, Color, CustomBlending, DirectionalLight,
  DoubleSide, Group, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, NoColorSpace, Object3D,
  OneFactor, OneMinusSrcAlphaFactor, PCFShadowMap, PointLight, Points, Scene, ShaderChunk, ShaderMaterial,
  SRGBColorSpace, Texture, TextureLoader, Vector2, Vector3, ZeroFactor, type Material, type WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { Pilot } from './pilot';

const BASE = import.meta.env.BASE_URL;

// A point light adds nothing where its attenuated colour is zero (the cabin lights outside their
// short range, the warp light while it is off), so skip its BRDF there instead of evaluating it for
// every hull pixel. Exact: the skipped term would have been multiplied by zero.
{
  const chunk = ShaderChunk.lights_fragment_begin;
  const patched = chunk.replace(/(getPointLightInfo\( pointLight, geometryPosition, directLight \);[\s\S]*?)RE_Direct\(/, '$1if ( directLight.visible ) RE_Direct(');
  if (patched === chunk) console.warn('point-light skip patch did not apply');
  ShaderChunk.lights_fragment_begin = patched;
}

// engine glow colours: white-cyan at the centre, violet at the rim
const HOT = new Color(0.55, 0.9, 1.0);
const COLD = new Color(0.42, 0.3, 1.0);

/**
 * Material tweaks via onBeforeCompile:
 *  - object-space procedural panel lines with per-panel tone variation (optional)
 *  - baked AO also darkens a share of the direct light, so crevices read even in full sunlight
 */
function enhance(mat: MeshStandardMaterial, panel: [number, number] | null, aoDirect = 0.6): void {
  const [scale, strength] = panel ?? [1, 0];
  mat.onBeforeCompile = (shader) => {
    if (panel) {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vObjPos;\nvarying vec3 vObjNrm;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjPos = position;\nvObjNrm = normal;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', /* glsl */ `#include <common>
varying vec3 vObjPos;
varying vec3 vObjNrm;
float pnlHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
// distance (m) to the nearest panel seam in a staggered brick layout; id = panel id
float pnlSeams(vec2 q, out float id) {
  vec2 cell = vec2(1.45, 0.82) * ${scale.toFixed(3)};
  float row = floor(q.y / cell.y);
  q.x += pnlHash(vec2(row, 3.1)) * cell.x;
  vec2 c = floor(q / cell);
  id = pnlHash(c + row * 17.0);
  vec2 f = fract(q / cell) * cell;
  float d = min(min(f.x, cell.x - f.x), min(f.y, cell.y - f.y));
  if (id > 0.62) d = min(d, abs(f.x - cell.x * 0.5));
  return d;
}`)
        .replace('#include <roughnessmap_fragment>', /* glsl */ `#include <roughnessmap_fragment>
{
  vec3 an = pow(abs(normalize(vObjNrm)), vec3(4.0));
  an /= (an.x + an.y + an.z);
  float idA, idB, idC;
  float dA = pnlSeams(vObjPos.zy, idA);
  float dB = pnlSeams(vObjPos.xz, idB);
  float dC = pnlSeams(vObjPos.xy, idC);
  float d = dA * an.x + dB * an.y + dC * an.z;
  float id = idA * an.x + idB * an.y + idC * an.z;
  float fw = max(fwidth(d), 1e-5);
  float w = 0.006;
  float line = 1.0 - smoothstep(w - fw, w + fw, d);
  line *= clamp(w * 2.5 / fw, 0.0, 1.0); // fade out when lines get sub-pixel
  diffuseColor.rgb *= (1.0 - ${strength.toFixed(3)} * line) * (0.965 + 0.07 * id);
  roughnessFactor = clamp(roughnessFactor + (id - 0.5) * 0.08 + line * 0.25, 0.04, 1.0);
}`);
    }
    shader.fragmentShader = shader.fragmentShader.replace('#include <aomap_fragment>', /* glsl */ `#include <aomap_fragment>
#ifdef USE_AOMAP
  reflectedLight.directDiffuse *= mix(1.0, ambientOcclusion, ${aoDirect.toFixed(3)});
  reflectedLight.directSpecular *= mix(1.0, ambientOcclusion, ${aoDirect.toFixed(3)});
#endif`);
  };
  mat.customProgramCacheKey = () => `enh${scale}${strength}${aoDirect}`;
}

/**
 * The generated hull has parts that came out inside out (the fuselage loft and the mirrored copies
 * of some parts): faces and normals point inward, so back-face culling hid the near wall and the
 * inside of the far wall showed through. Each connected piece is a (nearly) closed shell, so a
 * negative signed volume means it is inside out; those pieces get their winding and normals flipped.
 */
function fixInsideOut(geo: BufferGeometry): number {
  const P = geo.attributes.position;
  const N = geo.attributes.normal;
  const I = geo.index;
  if (!I || !N) return 0;
  // weld by position (normals split vertices along sharp edges)
  const ids = new Map<string, number>();
  const vk = new Int32Array(P.count);
  for (let i = 0; i < P.count; i++) {
    const k = `${P.getX(i).toFixed(5)},${P.getY(i).toFixed(5)},${P.getZ(i).toFixed(5)}`;
    let id = ids.get(k);
    if (id === undefined) ids.set(k, (id = ids.size));
    vk[i] = id;
  }
  const parent = Int32Array.from({ length: ids.size }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) x = parent[x] = parent[parent[x]];
    return x;
  };
  const tris = I.count / 3;
  for (let t = 0; t < tris; t++) {
    const a = find(vk[I.getX(3 * t)]);
    parent[find(vk[I.getX(3 * t + 1)])] = a;
    parent[find(vk[I.getX(3 * t + 2)])] = a;
  }
  const comps = new Map<number, number[]>();
  for (let t = 0; t < tris; t++) {
    const r = find(vk[I.getX(3 * t)]);
    let c = comps.get(r);
    if (!c) comps.set(r, (c = []));
    c.push(t);
  }
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), o = new Vector3();
  let flipped = 0;
  for (const list of comps.values()) {
    o.set(0, 0, 0);
    for (const t of list) for (let j = 0; j < 3; j++) o.add(b.fromBufferAttribute(P, I.getX(3 * t + j)));
    o.divideScalar(list.length * 3);
    let vol = 0;
    for (const t of list) {
      a.fromBufferAttribute(P, I.getX(3 * t)).sub(o);
      b.fromBufferAttribute(P, I.getX(3 * t + 1)).sub(o);
      c.fromBufferAttribute(P, I.getX(3 * t + 2)).sub(o);
      vol += a.dot(b.cross(c));
    }
    if (vol >= 0) continue;
    const verts = new Set<number>();
    for (const t of list) {
      const i1 = I.getX(3 * t + 1);
      I.setX(3 * t + 1, I.getX(3 * t + 2));
      I.setX(3 * t + 2, i1);
      for (let j = 0; j < 3; j++) verts.add(I.getX(3 * t + j));
    }
    for (const v of verts) N.setXYZ(v, -N.getX(v), -N.getY(v), -N.getZ(v));
    flipped += list.length;
  }
  if (flipped) {
    I.needsUpdate = true;
    N.needsUpdate = true;
  }
  return flipped;
}

/**
 * Canopy glass: reflections are added over the scene behind. From inside it is nearly clear; from
 * outside it is lightly tinted, so it reads as glass while the pilot stays visible.
 *
 * From the cockpit the canopy covers most of the screen, so this is a small dedicated shader rather
 * than a lit physical material: a mirror lookup in the environment map plus the sun's glint, with
 * the same Fresnel (ior 1.5, specular 0.35) and opacity curve the physical version had.
 */
function glassMaterial(): ShaderMaterial {
  const m = new ShaderMaterial({
    vertexShader: /* glsl */ `
varying vec3 vWPos;
varying vec3 vWNrm;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWPos = wp.xyz;
  vWNrm = mat3(modelMatrix) * normal;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`,
    fragmentShader: /* glsl */ `
uniform sampler2D uEnv;
uniform float uHasEnv;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform float uOutside;
varying vec3 vWPos;
varying vec3 vWNrm;
const float PI = 3.14159265;
void main() {
  vec3 V = normalize(cameraPosition - vWPos);
  vec3 N = normalize(vWNrm) * (gl_FrontFacing ? 1.0 : -1.0);
  float nv = clamp(dot(N, V), 1e-3, 1.0);
  const float F0 = 0.014, F90 = 0.35;
  // environment reflection (equirect, same mapping three.js uses for it)
  vec3 R = reflect(-V, N);
  vec2 uv = vec2(atan(R.z, R.x) * (0.5 / PI) + 0.5, asin(clamp(R.y, -1.0, 1.0)) / PI + 0.5);
  vec3 col = uHasEnv * texture2D(uEnv, uv).rgb * (F0 + (F90 - F0) * pow(1.0 - nv, 5.0));
  // sun glint: GGX, roughness 0.08
  float nl = dot(N, uSunDir);
  if (nl > 0.0) {
    vec3 H = normalize(uSunDir + V);
    float nh = max(dot(N, H), 0.0);
    const float a2 = 0.0064 * 0.0064;
    float d = nh * nh * (a2 - 1.0) + 1.0;
    float D = a2 / (PI * d * d);
    float vis = 0.5 / max(nl * sqrt(a2 + (1.0 - a2) * nv * nv) + nv * sqrt(a2 + (1.0 - a2) * nl * nl), 1e-5);
    float F = F0 + (F90 - F0) * pow(1.0 - max(dot(V, H), 0.0), 5.0);
    col += uSunCol * nl * F * vis * D;
  }
  float fres = pow(1.0 - nv, 4.0);
  float a = mix(mix(0.1, 0.32, uOutside), mix(0.55, 0.85, uOutside), fres);
  vec3 tint = vec3(0.012, 0.02, 0.03) * uOutside;
  gl_FragColor = vec4(col + tint * a, a);
}`,
    uniforms: {
      uEnv: { value: null },
      uHasEnv: { value: 0 },
      uSunDir: { value: new Vector3(0, 1, 0) },
      uSunCol: { value: new Color(0, 0, 0) },
      uOutside: { value: 0 },
    },
    transparent: true,
    side: DoubleSide,
    depthWrite: false,
  });
  // one pass for both faces: the layers are nearly clear, so their order does not show
  m.forceSinglePass = true;
  m.blending = CustomBlending;
  m.blendSrc = OneFactor;
  m.blendDst = OneMinusSrcAlphaFactor;
  // leave the alpha channel alone (nothing reads it)
  m.blendSrcAlpha = ZeroFactor;
  m.blendDstAlpha = OneFactor;
  return m;
}

/*
 * Engine glow: a vortex in each nozzle that spins up with thrust and warp.
 * Brightness is kept to a few HDR units so bloom never washes out the chase views.
 */
const nozzleVertex = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const nozzleFragment = /* glsl */ `
uniform vec2 uCenter;
uniform float uRadius;
uniform float uThrottle;
uniform float uTime;
uniform float uWarp;
uniform float uGain;
uniform vec3 uHot;
uniform vec3 uCold;
varying vec2 vP;
void main() {
  vec2 p = (vP - uCenter) / uRadius;
  float r = clamp(length(p), 0.0, 1.0);
  float a = atan(p.y, p.x);
  float spin = uTime * (2.5 + 9.0 * uWarp + 3.0 * uThrottle);
  // three spiral arms falling into the centre
  float arms = pow(0.5 + 0.5 * sin(a * 3.0 + r * 9.0 - spin), 3.0);
  float iris = smoothstep(0.05, 0.45, r);
  float rim = exp(-pow((r - 0.9) * 14.0, 2.0));
  float eye = exp(-r * r * 90.0);
  float pulse = 0.88 + 0.12 * sin(uTime * 6.0 + r * 12.0);
  float drive = 0.25 + 0.75 * min(1.0, uThrottle + uWarp);
  vec3 col = mix(uHot, uCold, r);
  float I = (0.18 + arms * iris * 0.9 + rim * 1.1 + eye * 1.4) * pulse * drive;
  gl_FragColor = vec4(col * I * uGain * (1.4 - 0.4 * uWarp), 1.0);
}`;

export interface ShipParts {
  root: Group;
  model: Object3D;
  eye: Vector3;
  screens: Mesh[];
  glows: ShaderMaterial[];
  nav: { points: Points; mat: ShaderMaterial };
  interiorMeshes: Mesh[];
  hullMeshes: Mesh[];
  canopy?: Mesh;
  pilot?: Pilot;
}

/** The ship scene (metres). Rendered after the world with its own depth range. */
export class ShipView {
  readonly scene = new Scene();
  readonly sun = new DirectionalLight(0xffffff, 3);
  readonly cabin = new PointLight(0xffc89a, 0, 2.5, 2);
  readonly screenLight = new PointLight(0x7fd8ff, 0, 1.8, 2);
  readonly warpLight = new PointLight(0x88aaff, 0, 30, 1.2);
  readonly glass = glassMaterial();
  parts?: ShipParts;

  constructor(renderer: WebGLRenderer) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.015;
    this.sun.shadow.radius = 2;
    this.scene.add(this.sun, this.sun.target);
  }

  async load(onProgress?: (f: number) => void): Promise<ShipParts> {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const tl = new TextureLoader();
    const [gltf, hullAo, cockpitAo] = await Promise.all([
      loader.loadAsync(`${BASE}models/ship.glb`, (e) => onProgress?.(e.total ? e.loaded / e.total : 0.5)),
      tl.loadAsync(`${BASE}models/hull_ao.webp`),
      tl.loadAsync(`${BASE}models/cockpit_ao.webp`),
    ]);
    for (const t of [hullAo, cockpitAo]) {
      t.flipY = false;
      t.colorSpace = NoColorSpace;
      t.channel = 0;
    }
    const root = new Group();
    const model = gltf.scene;
    root.add(model);
    this.scene.add(root);

    const makeMats = (ao: Texture | null): Record<string, Material> => {
      const mats: Record<string, Material> = {};
      const paint = new MeshPhysicalMaterial({
        color: new Color(0.78, 0.79, 0.8), roughness: 0.34, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.12,
        aoMap: ao, aoMapIntensity: 1.0,
      });
      enhance(paint, [1, 0.55], 0.45);
      mats.Paint = paint;
      const trim = new MeshStandardMaterial({ color: new Color(0.035, 0.037, 0.042), roughness: 0.42, metalness: 0.7, aoMap: ao });
      enhance(trim, [0.6, 0.4]);
      mats.Trim = trim;
      const accent = new MeshStandardMaterial({ color: new Color(0.95, 0.38, 0.06), roughness: 0.32, metalness: 0.1, aoMap: ao });
      enhance(accent, null);
      mats.Accent = accent;
      const metal = new MeshStandardMaterial({ color: new Color(0.6, 0.6, 0.62), roughness: 0.25, metalness: 1, aoMap: ao });
      enhance(metal, null);
      mats.Metal = metal;
      const interior = new MeshStandardMaterial({ color: new Color(0.032, 0.034, 0.038), roughness: 0.7, metalness: 0.05, aoMap: ao, aoMapIntensity: 1 });
      enhance(interior, [0.35, 0.3], 0.7);
      mats.Interior = interior;
      const panel = new MeshStandardMaterial({ color: new Color(0.06, 0.062, 0.068), roughness: 0.5, metalness: 0.25, aoMap: ao });
      enhance(panel, [0.25, 0.45], 0.7);
      mats.InteriorPanel = panel;
      const seat = new MeshStandardMaterial({ color: new Color(0.018, 0.018, 0.02), roughness: 0.6, metalness: 0, aoMap: ao });
      enhance(seat, null, 0.7);
      mats.Seat = seat;
      mats.Buttons = new MeshBasicMaterial({ color: new Color(1.0, 0.55, 0.18).multiplyScalar(2.2) });
      return mats;
    };
    const hullMats = makeMats(hullAo);
    // the hull's inner face is the cockpit wall below the canopy rim, so draw both sides
    for (const m of Object.values(hullMats)) m.side = DoubleSide;
    const cockpitMats = makeMats(cockpitAo);
    // the moving levers are not part of the baked cockpit
    const leverMats = makeMats(null);
    const glass = this.glass;
    const inGroup = (o: Object3D, n: string): boolean => {
      for (let p: Object3D | null = o; p; p = p.parent) if (p.name.startsWith(n)) return true;
      return false;
    };

    const screens: Mesh[] = [];
    const glows: ShaderMaterial[] = [];
    const interiorMeshes: Mesh[] = [];
    const hullMeshes: Mesh[] = [];
    let eye = new Vector3(0, 1.42, -1.62);
    const navPos: Vector3[] = [];
    let canopy: Mesh | undefined;
    model.traverse((o) => {
      if ((o as Mesh).isMesh) {
        const m = o as Mesh;
        const src = m.material as Material;
        const name = src.name.replace(/\.\d+$/, '');
        const isCockpit = inGroup(m, 'Cockpit');
        const isLever = inGroup(m, 'StickLever') || inGroup(m, 'ThrottleLever');
        if (inGroup(m, 'Pilot')) return; // set up by Pilot
        const mats = isLever ? leverMats : isCockpit ? cockpitMats : hullMats;
        if (name === 'Screen' || m.name.startsWith('Screen')) {
          screens.push(m);
        } else if (name === 'EngineGlow') {
          m.geometry.computeBoundingBox();
          const bb = m.geometry.boundingBox!;
          const g = new ShaderMaterial({
            vertexShader: nozzleVertex, fragmentShader: nozzleFragment, side: DoubleSide,
            uniforms: {
              uCenter: { value: new Vector2((bb.min.x + bb.max.x) / 2, (bb.min.y + bb.max.y) / 2) },
              uRadius: { value: Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y) / 2 },
              uThrottle: { value: 0 }, uTime: { value: 0 }, uWarp: { value: 0 }, uGain: { value: 1 },
              uHot: { value: HOT }, uCold: { value: COLD },
            },
          });
          m.material = g;
          glows.push(g);
        } else if (name === 'Glass') {
          m.material = glass;
        } else if (mats[name]) {
          m.material = mats[name];
        }
        if (name === 'Glass') {
          canopy = m;
          m.renderOrder = 10;
          m.onBeforeRender = () => this.updateGlass();
        } else if (name !== 'EngineGlow' && name !== 'Screen') {
          m.castShadow = true;
          m.receiveShadow = true;
        }
        if (isCockpit || isLever) interiorMeshes.push(m);
        if (inGroup(m, 'Hull')) {
          hullMeshes.push(m);
          fixInsideOut(m.geometry);
        }
      }
      if (o.name === 'EyePoint') eye = o.position.clone();
      if (o.name.startsWith('Nav')) navPos.push(o.position.clone());
    });
    // screens get the MFD canvases later; order them left -> right
    const order = (m: Mesh) => ['ScreenL', 'ScreenC', 'ScreenR'].findIndex((n) => inGroup(m, n));
    screens.sort((a, b) => order(a) - order(b));

    // navigation lights
    const navGeo = new BufferGeometry();
    navGeo.setAttribute('position', new BufferAttribute(new Float32Array(navPos.flatMap((p) => [p.x, p.y, p.z])), 3));
    const navCols = navPos.map((p) => (Math.abs(p.x) < 0.5 ? [1, 1, 1] : p.x < 0 ? [1, 0.08, 0.05] : [0.1, 1, 0.25]));
    navGeo.setAttribute('aColor', new BufferAttribute(new Float32Array(navCols.flat()), 3));
    const navMat = new ShaderMaterial({
      vertexShader: /* glsl */ `
attribute vec3 aColor; varying vec3 vC; uniform float uPx; uniform float uTime; uniform float uGain;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  bool strobe = aColor.g > 0.9 && aColor.r > 0.9;
  float on = strobe ? step(0.92, fract(uTime * 0.8)) : 0.55 + 0.45 * step(0.5, fract(uTime * 0.5));
  vC = aColor * on * uGain;
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uPx * clamp(180.0 / -mv.z, 3.0, 40.0);
}`,
      fragmentShader: /* glsl */ `
varying vec3 vC;
void main() { vec2 d = gl_PointCoord - 0.5; float g = exp(-dot(d, d) * 40.0); gl_FragColor = vec4(vC * g * 6.0, 0.0); }`,
      transparent: true, depthWrite: false, blending: AdditiveBlending, premultipliedAlpha: true,
      uniforms: { uPx: { value: 1 }, uTime: { value: 0 }, uGain: { value: 1 } },
    });
    const navPoints = new Points(navGeo, navMat);
    navPoints.frustumCulled = false;
    model.add(navPoints);

    // cabin lights (relative to the eye): a soft overhead light behind the head and the glow of the displays
    this.cabin.position.copy(eye).add(new Vector3(0, 0.22, 0.5));
    this.screenLight.position.copy(eye).add(new Vector3(0, -0.55, -1.25));
    this.warpLight.position.set(0, 2, -6);
    model.add(this.cabin, this.screenLight, this.warpLight);

    const stick = model.getObjectByName('StickLever');
    const throttle = model.getObjectByName('ThrottleLever');
    const pilotObj = model.getObjectByName('Pilot');
    const pilot = stick && throttle && pilotObj ? new Pilot(model, stick, throttle, pilotObj) : undefined;

    this.parts = { root, model, eye, screens, glows, nav: { points: navPoints, mat: navMat }, interiorMeshes, hullMeshes, canopy, pilot };
    return this.parts;
  }

  /** Keeps self-lit parts at a constant on-screen brightness whatever the exposure. */
  setEmissiveGain(g: number): void {
    const p = this.parts;
    if (!p) return;
    for (const m of p.glows) m.uniforms.uGain.value = g;
    p.nav.mat.uniforms.uGain.value = g;
    for (const m of p.screens) (m.material as MeshBasicMaterial).color?.setScalar(1.6 * g);
  }

  /** Drives the engine glow: thrust 0..1.3, warp 0..1 (spool and cruise). */
  setEngines(throttle: number, warp: number, time: number): void {
    const p = this.parts;
    if (!p) return;
    for (const m of p.glows) {
      m.uniforms.uThrottle.value = throttle;
      m.uniforms.uWarp.value = warp;
      m.uniforms.uTime.value = time;
    }
  }

  setScreens(textures: CanvasTexture[]): void {
    if (!this.parts) return;
    this.parts.screens.forEach((m, i) => {
      const t = textures[i % textures.length];
      t.colorSpace = SRGBColorSpace;
      t.flipY = false;
      m.material = new MeshBasicMaterial({ map: t, color: new Color(1.7, 1.7, 1.7) });
    });
  }

  /** Smoked canopy glass from outside, clear from the cockpit. */
  setCanopyOutside(outside: boolean): void {
    this.glass.uniforms.uOutside.value = outside ? 1 : 0;
  }

  setEnvMap(env: Texture | null): void {
    this.scene.environment = env;
    this.glass.uniforms.uEnv.value = env;
    this.glass.uniforms.uHasEnv.value = env ? 1 : 0;
  }

  private updateGlass(): void {
    const u = this.glass.uniforms;
    (u.uSunDir.value as Vector3).subVectors(this.sun.position, this.sun.target.position).normalize();
    (u.uSunCol.value as Color).copy(this.sun.color).multiplyScalar(this.sun.intensity);
  }

  /** In the cockpit the exterior is mostly hidden by the camera anyway; keep shadows tight around the eye. */
  configureShadows(cockpit: boolean): void {
    const c = this.sun.shadow.camera;
    const s = cockpit ? 2.4 : 11;
    c.left = -s; c.right = s; c.top = s; c.bottom = -s;
    c.near = 0.5; c.far = cockpit ? 16 : 90;
    c.updateProjectionMatrix();
  }
}
