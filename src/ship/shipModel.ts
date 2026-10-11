import {
  AdditiveBlending, BufferAttribute, BufferGeometry, type Camera, CanvasTexture, Color, CylinderGeometry, CustomBlending, DirectionalLight,
  DoubleSide, Group, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, NoColorSpace, Object3D,
  OneFactor, OneMinusSrcAlphaFactor, PCFShadowMap, PointLight, Points, Scene, ShaderMaterial, SRGBColorSpace,
  Texture, TextureLoader, Vector2, Vector3, type Material, type WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const BASE = import.meta.env.BASE_URL;

// exhaust colours: white-cyan at the nozzle, violet downstream
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

/** Canopy glass: reflections are added, the scene behind is only slightly darkened. */
function glassMaterial(): MeshPhysicalMaterial {
  const m = new MeshPhysicalMaterial({
    color: new Color(0, 0, 0),
    roughness: 0.05,
    metalness: 0.0,
    transparent: true,
    opacity: 0.1,
    side: DoubleSide,
    depthWrite: false,
    envMapIntensity: 1.0,
    specularIntensity: 0.35,
    ior: 1.5,
  });
  m.blending = CustomBlending;
  m.blendSrc = OneFactor;
  m.blendDst = OneMinusSrcAlphaFactor;
  m.onBeforeCompile = (s) => {
    s.fragmentShader = s.fragmentShader.replace(
      '#include <opaque_fragment>',
      /* glsl */ `
float fres = pow(1.0 - abs(dot(normalize(vViewPosition), normal)), 4.0);
float a = mix(diffuseColor.a, 0.55, fres);
gl_FragColor = vec4(outgoingLight, a);`,
    );
  };
  return m;
}

/*
 * Engine exhaust: no flames, but a drive that bends space. Each engine gets
 *  - a lens tube that refracts what is behind it (ship included) with travelling, twisting ripples
 *    and a little chromatic split, read from a half-resolution copy of the frame;
 *  - a thin additive shell with a core line and energy rings that stream away from the nozzle;
 *  - a vortex in the nozzle itself.
 * Brightness is kept to a few HDR units so bloom never washes out the chase views.
 */
const plumeVertex = /* glsl */ `
varying vec3 vN;
varying vec3 vView;
varying float vAlong;
varying float vAng;
varying float vP11;
void main() {
  vP11 = projectionMatrix[1][1];
  vAlong = 1.0 - uv.y;
  vAng = uv.x;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vView = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;

const plumeCommon = /* glsl */ `
uniform float uThrottle;
uniform float uTime;
uniform float uWarp;
uniform float uGain;
varying vec3 vN;
varying vec3 vView;
varying float vAlong;
varying float vAng;
varying float vP11;
// visible length (fraction of the mesh) grows with thrust
float plumeLen() { return clamp(0.22 + 0.78 * uThrottle, 0.0, 1.0); }
float plumeFade(float L) { return smoothstep(0.0, 0.05, vAlong) * (1.0 - smoothstep(L * 0.45, L, vAlong)); }
`;

const lensFragment = /* glsl */ `
${plumeCommon}
uniform sampler2D uBg;
uniform vec2 uRes;
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(vView);
  float ndv = clamp(dot(n, v), 0.0, 1.0);
  float L = plumeLen();
  float fade = plumeFade(L);
  float k = min(1.0, uThrottle * 1.6 + uWarp);
  // ripples travelling away from the nozzle, twisting the lens as they go
  float speed = 9.0 + 28.0 * uWarp;
  float wave = sin(vAlong * 34.0 - uTime * speed);
  float tw = sin(vAlong * 11.0 - uTime * speed * 0.35) * 1.4 + uTime * 0.7;
  vec2 dir = n.xy * ndv;                                     // 0 at the centre and at the silhouette
  dir = mat2(cos(tw), -sin(tw), sin(tw), cos(tw)) * dir;
  float amp = 0.38 * (0.5 + 0.5 * wave) * fade * k;       // metres of apparent displacement
  float depth = max(vView.z, 0.5);
  vec2 off = dir * amp * vP11 / depth * 0.5;
  off.x *= uRes.y / uRes.x;
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 col;
  col.r = texture2D(uBg, uv + off * 0.85).r;
  col.g = texture2D(uBg, uv + off).g;
  col.b = texture2D(uBg, uv + off * 1.2).b;
  // faint cold tint where space is bent the most
  col *= mix(vec3(1.0), vec3(0.86, 0.95, 1.12), clamp(length(dir) * 2.0, 0.0, 1.0) * k);
  float a = fade * smoothstep(0.02, 0.3, ndv) * k;
  gl_FragColor = vec4(col, a);
}`;

const glowFragment = /* glsl */ `
${plumeCommon}
uniform vec3 uHot;
uniform vec3 uCold;
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(vView);
  float ndv = abs(dot(n, v));
  float L = plumeLen();
  float fade = plumeFade(L);
  float t = vAlong / max(L, 0.05);
  // a thin core line seen through the centre of the tube
  float core = pow(ndv, 6.0) * exp(-t * 3.0) * 1.6;
  // energy rings emitted from the nozzle; faster and denser in warp
  float rate = 1.6 + 5.0 * uWarp;
  float ph = fract(vAlong * (5.0 + 3.0 * uWarp) - uTime * rate);
  float ring = exp(-pow((ph - 0.5) * 22.0, 2.0)) * (0.35 + 0.65 * ndv);
  // fine helical filaments
  float helix = pow(0.5 + 0.5 * sin(vAng * 6.2832 * 2.0 + vAlong * 18.0 - uTime * (6.0 + 14.0 * uWarp)), 16.0) * 0.14 * (1.0 - t);
  vec3 col = mix(uHot, uCold, clamp(t, 0.0, 1.0));
  float I = (core * 1.1 + ring * 0.9 + helix) * fade * min(1.0, uThrottle * 1.4 + uWarp * 0.6);
  gl_FragColor = vec4(col * I * uGain, 0.0);
}`;

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
  plumes: ShaderMaterial[];
  lenses: ShaderMaterial[];
  nav: { points: Points; mat: ShaderMaterial };
  interiorMeshes: Mesh[];
  hullMeshes: Mesh[];
  canopy?: Mesh;
}

/** The ship scene (metres). Rendered after the world with its own depth range. */
export class ShipView {
  readonly scene = new Scene();
  readonly sun = new DirectionalLight(0xffffff, 3);
  readonly fill = new DirectionalLight(0x88aaff, 0);
  readonly cabin = new PointLight(0xffc89a, 0, 2.5, 2);
  readonly screenLight = new PointLight(0x7fd8ff, 0, 1.8, 2);
  readonly warpLight = new PointLight(0x88aaff, 0, 30, 1.2);
  /** Engine exhaust; rendered after the ship so its lens can refract the finished ship image. */
  readonly plumeScene = new Scene();
  private plumeAnchor = new Group();
  parts?: ShipParts;

  constructor(renderer: WebGLRenderer) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.015;
    this.sun.shadow.radius = 2;
    this.scene.add(this.sun, this.sun.target, this.fill, this.fill.target);
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

    const makeMats = (ao: Texture): Record<string, Material> => {
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
    const cockpitMats = makeMats(cockpitAo);
    const glass = glassMaterial();
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
        const mats = isCockpit ? cockpitMats : hullMats;
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
        } else if (name !== 'EngineGlow' && name !== 'Screen') {
          m.castShadow = true;
          m.receiveShadow = true;
        }
        if (isCockpit) interiorMeshes.push(m);
        if (inGroup(m, 'Hull')) hullMeshes.push(m);
      }
      if (o.name === 'EyePoint') eye = o.position.clone();
      if (o.name.startsWith('Nav')) navPos.push(o.position.clone());
    });
    // screens get the MFD canvases later; order them left -> right
    const order = (m: Mesh) => ['ScreenL', 'ScreenC', 'ScreenR'].findIndex((n) => inGroup(m, n));
    screens.sort((a, b) => order(a) - order(b));

    // engine exhaust (lives in its own scene; the anchor follows the model each frame)
    const plumes: ShaderMaterial[] = [];
    const lenses: ShaderMaterial[] = [];
    this.plumeAnchor.matrixAutoUpdate = false;
    this.plumeScene.add(this.plumeAnchor);
    model.updateMatrixWorld(true);
    const toModel = model.matrixWorld.clone().invert();
    const len = 7.5;
    const tube = new CylinderGeometry(0.34, 0.66, len, 40, 48, true);
    tube.translate(0, -len / 2, 0);
    tube.rotateX(-Math.PI / 2); // nozzle end at the engine, widening backward (+Z)
    const shell = tube.clone().scale(0.72, 0.72, 1);
    model.traverse((o) => {
      if (o.name !== 'EngineL' && o.name !== 'EngineR') return;
      const at = o.getWorldPosition(new Vector3()).applyMatrix4(toModel);
      const common = () => ({ uThrottle: { value: 0 }, uTime: { value: 0 }, uWarp: { value: 0 }, uGain: { value: 1 } });
      const lens = new ShaderMaterial({
        vertexShader: plumeVertex, fragmentShader: lensFragment, transparent: true, depthWrite: false,
        uniforms: { ...common(), uBg: { value: null }, uRes: { value: new Vector2(1, 1) } },
      });
      const glow = new ShaderMaterial({
        vertexShader: plumeVertex, fragmentShader: glowFragment, transparent: true, depthWrite: false, side: DoubleSide,
        blending: AdditiveBlending, premultipliedAlpha: true,
        uniforms: { ...common(), uHot: { value: HOT }, uCold: { value: COLD } },
      });
      const lm = new Mesh(tube, lens);
      const gm = new Mesh(shell, glow);
      for (const [mesh, order] of [[lm, 1], [gm, 2]] as const) {
        mesh.position.copy(at);
        mesh.renderOrder = order;
        mesh.frustumCulled = false;
        this.plumeAnchor.add(mesh);
      }
      lenses.push(lens);
      plumes.push(lens, glow);
    });

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

    this.parts = { root, model, eye, screens, glows, plumes, lenses, nav: { points: navPoints, mat: navMat }, interiorMeshes, hullMeshes, canopy };
    return this.parts;
  }

  /** Keeps self-lit parts at a constant on-screen brightness whatever the exposure. */
  setEmissiveGain(g: number): void {
    const p = this.parts;
    if (!p) return;
    for (const m of p.plumes) m.uniforms.uGain.value = g;
    for (const m of p.glows) m.uniforms.uGain.value = g;
    p.nav.mat.uniforms.uGain.value = g;
    for (const m of p.screens) (m.material as MeshBasicMaterial).color?.setScalar(1.6 * g);
  }

  /** Drives the exhaust: thrust 0..1.3, warp 0..1 (spool and cruise). */
  setEngines(throttle: number, warp: number, time: number): void {
    const p = this.parts;
    if (!p) return;
    for (const m of [...p.plumes, ...p.glows]) {
      m.uniforms.uThrottle.value = throttle;
      m.uniforms.uWarp.value = warp;
      m.uniforms.uTime.value = time;
    }
  }

  /** Whether the exhaust is worth drawing this frame. */
  get enginesVisible(): boolean {
    const p = this.parts;
    if (!p || !p.lenses.length) return false;
    const u = p.lenses[0].uniforms;
    return (u.uThrottle.value as number) > 0.01 || (u.uWarp.value as number) > 0.01;
  }

  /** Renders the exhaust into the current target; bg is a copy of the frame with the ship already in it. */
  renderPlumes(renderer: WebGLRenderer, camera: Camera, bg: Texture, width: number, height: number): void {
    const p = this.parts;
    if (!p) return;
    this.plumeAnchor.matrix.copy(p.model.matrixWorld);
    this.plumeAnchor.matrixWorldNeedsUpdate = true;
    for (const m of p.lenses) {
      m.uniforms.uBg.value = bg;
      (m.uniforms.uRes.value as Vector2).set(width, height);
    }
    renderer.render(this.plumeScene, camera);
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

  setEnvMap(env: Texture | null): void {
    this.scene.environment = env;
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
