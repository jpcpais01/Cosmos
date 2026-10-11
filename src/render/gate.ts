import {
  AdditiveBlending, BoxGeometry, BufferAttribute, BufferGeometry, CircleGeometry, DoubleSide, Group, Mesh, PerspectiveCamera,
  Points, Quaternion, Scene, ShaderMaterial, Vector3, type WebGLRenderer,
} from 'three';
import { MATH } from './glsl';
import { GATE } from '../game/gate';

/*
 * The warp gate: a ring 2.2 km across of sixteen armoured segments joined by glowing energy cores,
 * two counter-rotating inner rings that spin up before a jump, four pylons with navigation lights,
 * radiator fins on the back, a shimmering portal film and a corridor of approach beacons in front.
 * Modelled in metres in the gate's own frame (+Z away from its star, the way ships leave) and drawn
 * in its own pass with a camera fitted to it, between the planets and the ship.
 */

const R = GATE.ring * 1000;
const PORTAL = GATE.portal * 1000;
const SEGMENTS = 16;

type Profile = [number, number][];

/** Sweeps a convex (radius, z) profile around the Z axis from angle a0 to a1, with flat end caps. */
function sweep(profile: Profile, a0: number, a1: number, steps: number, caps = true): BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const n = profile.length;
  let cr = 0, cz = 0;
  for (const [r, z] of profile) {
    cr += r / n;
    cz += z / n;
  }
  const push = (r: number, z: number, a: number, nr: number, nz: number) => {
    pos.push(r * Math.cos(a), r * Math.sin(a), z);
    nor.push(nr * Math.cos(a), nr * Math.sin(a), nz);
  };
  for (let i = 0; i < n; i++) {
    const [r0, z0] = profile[i];
    const [r1, z1] = profile[(i + 1) % n];
    let nr = z1 - z0, nz = -(r1 - r0);
    const l = Math.hypot(nr, nz);
    nr /= l;
    nz /= l;
    if (nr * ((r0 + r1) / 2 - cr) + nz * ((z0 + z1) / 2 - cz) < 0) {
      nr = -nr;
      nz = -nz;
    }
    for (let j = 0; j < steps; j++) {
      const aa = a0 + ((a1 - a0) * j) / steps;
      const ab = a0 + ((a1 - a0) * (j + 1)) / steps;
      push(r0, z0, aa, nr, nz); push(r1, z1, aa, nr, nz); push(r1, z1, ab, nr, nz);
      push(r0, z0, aa, nr, nz); push(r1, z1, ab, nr, nz); push(r0, z0, ab, nr, nz);
    }
  }
  if (caps) {
    for (const [a, s] of [[a0, -1], [a1, 1]] as const) {
      const tx = -Math.sin(a) * s, ty = Math.cos(a) * s;
      for (let i = 1; i < n - 1; i++) {
        for (const k of [0, i, i + 1]) {
          const [r, z] = profile[k];
          pos.push(r * Math.cos(a), r * Math.sin(a), z);
          nor.push(tx, ty, 0);
        }
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  return g;
}

/** A tapered box from `r0` to `r1` along +X (width and depth shrink linearly), flat-shaded. */
function taper(r0: number, r1: number, w0: number, w1: number, d0: number, d1: number): BufferGeometry {
  const v = (x: number, w: number, d: number) => [
    [x, -w, -d], [x, w, -d], [x, w, d], [x, -w, d],
  ];
  const a = v(r0, w0 / 2, d0 / 2), b = v(r1, w1 / 2, d1 / 2);
  const quads = [
    [a[0], a[1], b[1], b[0]], [a[1], a[2], b[2], b[1]], [a[2], a[3], b[3], b[2]], [a[3], a[0], b[0], b[3]],
    [b[0], b[1], b[2], b[3]], [a[3], a[2], a[1], a[0]],
  ];
  const pos: number[] = [];
  const nor: number[] = [];
  const e1 = new Vector3(), e2 = new Vector3(), nn = new Vector3(), c = new Vector3((r0 + r1) / 2, 0, 0), m = new Vector3();
  for (const q of quads) {
    e1.set(q[1][0] - q[0][0], q[1][1] - q[0][1], q[1][2] - q[0][2]);
    e2.set(q[2][0] - q[0][0], q[2][1] - q[0][1], q[2][2] - q[0][2]);
    nn.crossVectors(e1, e2).normalize();
    m.set((q[0][0] + q[2][0]) / 2, (q[0][1] + q[2][1]) / 2, (q[0][2] + q[2][2]) / 2).sub(c);
    if (nn.dot(m) < 0) nn.negate();
    for (const k of [0, 1, 2, 0, 2, 3]) {
      pos.push(...q[k]);
      nor.push(nn.x, nn.y, nn.z);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  return g;
}

/** Merges non-indexed geometries, each placed by a rotation about Z and an offset. */
function merge(parts: { g: BufferGeometry; rot?: number; off?: Vector3 }[]): BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const v = new Vector3(), q = new Quaternion(), z = new Vector3(0, 0, 1);
  for (const { g, rot = 0, off } of parts) {
    q.setFromAxisAngle(z, rot);
    const gg = g.index ? g.toNonIndexed() : g;
    const p = gg.attributes.position, nn = gg.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      v.set(p.getX(i), p.getY(i), p.getZ(i)).applyQuaternion(q);
      if (off) v.add(off);
      pos.push(v.x, v.y, v.z);
      v.set(nn.getX(i), nn.getY(i), nn.getZ(i)).applyQuaternion(q);
      nor.push(v.x, v.y, v.z);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  return g;
}

const HULL_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vNl;
varying vec3 vV;
varying vec3 vL;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vNl = normal;
  vL = position;
  vV = mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;

const HULL_FRAG = /* glsl */ `
${MATH}
varying vec3 vN;
varying vec3 vNl;
varying vec3 vV;
varying vec3 vL;
uniform vec3 uLight;    // view space, toward the star
uniform vec3 uIrr;      // starlight irradiance (rgb)
uniform float uGain;    // keeps self-lit parts at a constant on-screen brightness
uniform float uCharge;  // 0..1 while the gate spins up for a jump
uniform float uTime;
uniform vec3 uTint;
uniform vec3 uGlowCol;
uniform float uDashes;
void main() {
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  vec3 v = normalize(-vV);
  float rad = length(vL.xy);
  vec2 cs = vL.xy / max(rad, 1e-3);
  float ang = atan(vL.y, vL.x);
  // armour panels: 176 around the ring (a whole number, so the pattern closes where atan wraps)
  float pu = ang / TAU * 176.0;
  float pv = vL.z / 34.0 + rad / 34.0;
  vec2 cell = floor(vec2(pu, pv));
  vec2 f = fract(vec2(pu, pv));
  vec2 fw = max(fwidth(vec2(pu, pv)), vec2(1e-4));
  vec2 edge = smoothstep(vec2(0.0), fw * 1.5, min(f, 1.0 - f));
  float seams = mix(0.55, 1.0, edge.x * edge.y);
  float tone = 0.82 + 0.3 * hash12(cell + floor(rad / 200.0) * 13.0);
  vec3 albedo = uTint * tone * seams;
  // starlight: Lambert plus a broad metallic highlight
  float ndl = max(dot(n, uLight), 0.0);
  vec3 h = normalize(uLight + v);
  float spec = pow(max(dot(n, h), 0.0), 48.0) * 0.6 + pow(max(dot(n, h), 0.0), 8.0) * 0.05;
  vec3 col = (albedo + spec * vec3(0.9, 0.95, 1.0)) * uIrr * ndl;
  // the gate's own floodlights, from the front and the rim, so it reads even far from its star
  vec3 nl = normalize(vNl);
  float flood = 0.5 + 0.5 * max(-nl.z, 0.0) + 0.3 * max(dot(nl.xy, cs), 0.0);
  col += albedo * vec3(0.8, 0.88, 1.0) * flood * 0.14 * uGain;
  // the portal lights the inner faces as it charges
  float inward = max(-dot(nl.xy, cs), 0.0);
  col += albedo * uGlowCol * inward * (0.08 + 2.2 * uCharge) * exp(-(rad - 850.0) / 260.0) * uGain;
#ifdef DASHES
  // running light strips on the rotating rings
  float d = fract(ang / TAU * uDashes);
  float lane = smoothstep(0.32, 0.36, abs(fract(vL.z / 30.0) - 0.5));
  float dash = smoothstep(0.0, 0.03, d) * smoothstep(0.62, 0.55, d) * (1.0 - lane) * step(abs(dot(nl.xy, cs)), 0.5);
  float run = 0.55 + 0.45 * sin(ang * 4.0 - uTime * (1.0 + 9.0 * uCharge));
  col += uGlowCol * dash * (0.9 + 7.0 * uCharge) * run * uGain;
#endif
#ifdef CORE
  // energy cores between the segments: a hot plasma column that pulses faster as the gate charges
  float flow = vnoise3(vec3(cs * 3.0, vL.z / 40.0 - uTime * (0.6 + 3.0 * uCharge)));
  float pulse = 0.75 + 0.25 * sin(uTime * (2.0 + 10.0 * uCharge) + ang * 3.0);
  float face = 0.35 + 0.65 * (1.0 - abs(nl.z));
  col = uGlowCol * (1.2 + 7.0 * uCharge) * (0.6 + 0.8 * flow) * pulse * face * uGain + col * 0.2;
#endif
  gl_FragColor = vec4(col, 1.0);
}`;

const PORTAL_FRAG = /* glsl */ `
${MATH}
varying vec3 vL;
uniform float uCharge;
uniform float uOpen;
uniform float uTime;
uniform float uGain;
uniform vec3 uGlowCol;
void main() {
  float r = length(vL.xy) / ${PORTAL.toFixed(1)};
  vec2 cs = vL.xy / max(length(vL.xy), 1e-3);
  // the film swirls, faster and inward as the gate charges; noise is sampled on (cos, sin), so no seam
  float spin = uTime * (0.05 + 0.9 * uCharge) + (1.0 - r) * (1.0 + 4.0 * uCharge);
  vec2 sc = vec2(cs.x * cos(spin) - cs.y * sin(spin), cs.x * sin(spin) + cs.y * cos(spin));
  float n1 = fbm3(vec3(sc * 2.2, r * 3.0 - uTime * (0.15 + 1.4 * uCharge)));
  float n2 = vnoise3(vec3(sc * 7.0, r * 9.0 - uTime * (0.4 + 3.0 * uCharge)));
  float rings = pow(0.5 + 0.5 * sin(r * 34.0 + uTime * (1.0 + 14.0 * uCharge) + n1 * 6.0), 6.0);
  float rim = smoothstep(0.82, 0.995, r) * smoothstep(1.0, 0.985, r);
  // idle: only the rim and the odd faint wisp (any even film would veil the stars behind it in grey)
  float idle = rim * 0.35 + 0.004 * smoothstep(0.55, 0.85, n1) * smoothstep(0.3, 0.9, r);
  float live = (0.15 + 0.9 * n1 * n1 + 0.6 * pow(n2, 3.0)) * (0.3 + 0.7 * rings) + rim * 2.0;
  vec3 col = uGlowCol * mix(idle, live * 0.5, uCharge);
  // violet depths between the cyan streams
  col = mix(col, col.bgr * vec3(1.3, 0.35, 1.5), 0.5 * smoothstep(0.35, 0.65, 1.0 - n1));
  // opening: a white-hot eye grows from the centre
  col += vec3(0.8, 0.9, 1.0) * uOpen * uOpen * (4.0 * exp(-r * r * 6.0) + 0.6 * live);
  col *= smoothstep(1.0, 0.97, r);
  gl_FragColor = vec4(col * uGain, 1.0);
}`;

const LIGHT_VERT = /* glsl */ `
attribute vec3 aColor;
attribute vec3 aInfo; // size (m), kind (0 steady, 1 strobe, 2 chase, 3 core glow), phase
uniform float uTime;
uniform float uFocal;  // pixels per radian
uniform float uPx;
uniform float uCharge;
uniform float uGain;
uniform float uScale;  // km per model unit
varying vec3 vC;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float dist = max(-mv.z, 1e-4);
  float kind = aInfo.y, ph = aInfo.z;
  float on = 1.0;
  if (kind < 0.5) on = 0.8 + 0.2 * sin(uTime * 1.3 + ph * 6.0);
  else if (kind < 1.5) on = step(0.9, fract(uTime * 0.7 + ph)) + 0.08;
  else if (kind < 2.5) {
    // beacons chase toward the gate, faster while it charges
    float k = fract(ph - uTime * (0.35 + 1.4 * uCharge));
    on = 0.15 + pow(1.0 - k, 10.0) * 1.6;
  } else on = 0.3 + 1.6 * uCharge;
  float px = aInfo.x * uScale / dist * uFocal;
  float size = max(px, 2.0 * uPx);
  // a light smaller than its sprite spreads the same energy over more pixels
  float spread = min(1.0, px * px / (size * size) + 0.04);
  vC = aColor * on * uGain * spread * (kind > 2.5 ? 1.0 : 2.5);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(size, 320.0 * uPx);
}`;

const LIGHT_FRAG = /* glsl */ `
varying vec3 vC;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d) * 4.0;
  float g = exp(-r2 * 9.0) * 1.6 + exp(-r2 * 2.5) * 0.25;
  gl_FragColor = vec4(vC * g * smoothstep(1.0, 0.7, r2), 0.0);
}`;

const _rel = new Vector3();

export class GateView {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(60, 1, 0.01, 100);
  readonly root = new Group();
  private ringA: Mesh;
  private ringB: Mesh;
  private mats: ShaderMaterial[] = [];
  private portalMat: ShaderMaterial;
  private lightMat: ShaderMaterial;
  private meshes: Group;
  /** 0..1 while spinning up for a jump */
  charge = 0;
  /** 0..1 the portal opening for the ship */
  open = 0;
  private spinA = 0;
  private spinB = 0;
  /** distance from the camera to the gate centre last frame (km) */
  distance = Infinity;

  constructor() {
    this.root.scale.setScalar(0.001);
    this.root.matrixAutoUpdate = true;
    this.scene.add(this.root);
    this.meshes = new Group();
    this.root.add(this.meshes);

    const glow = new Vector3(0.35, 0.85, 1.0);
    const hull = (tint: [number, number, number], defines: Record<string, string> = {}, dashes = 0) => {
      const m = new ShaderMaterial({
        vertexShader: HULL_VERT, fragmentShader: HULL_FRAG, defines,
        uniforms: {
          uLight: { value: new Vector3(0, 0, 1) }, uIrr: { value: new Vector3(1, 1, 1) }, uGain: { value: 1 },
          uCharge: { value: 0 }, uTime: { value: 0 }, uTint: { value: new Vector3(...tint) }, uGlowCol: { value: glow },
          uDashes: { value: dashes },
        },
      });
      this.mats.push(m);
      return m;
    };
    const armour = hull([0.2, 0.21, 0.23]);
    const dark = hull([0.09, 0.095, 0.1]);
    const core = hull([0.3, 0.3, 0.3], { CORE: '' });

    // main ring: sixteen chamfered segments with a raised spine, joined by energy cores under clamps
    const prof: Profile = [[R - 85, -80], [R - 45, -120], [R + 45, -120], [R + 85, -80], [R + 85, 80], [R + 45, 120], [R - 45, 120], [R - 85, 80]];
    const spine: Profile = [[R + 80, -40], [R + 118, -28], [R + 118, 28], [R + 80, 40]];
    const lip: Profile = [[R - 112, -128], [R - 80, -128], [R - 80, -96], [R - 112, -104]];
    const step = (Math.PI * 2) / SEGMENTS;
    const gap = 3.2 * (Math.PI / 180);
    const seg: { g: BufferGeometry; rot?: number }[] = [];
    const darkParts: { g: BufferGeometry; rot?: number; off?: Vector3 }[] = [];
    const coreParts: { g: BufferGeometry; rot?: number; off?: Vector3 }[] = [];
    for (let i = 0; i < SEGMENTS; i++) {
      const a0 = i * step + gap / 2, a1 = (i + 1) * step - gap / 2;
      seg.push({ g: sweep(prof, a0, a1, 10) });
      seg.push({ g: sweep(spine, a0 + 0.02, a1 - 0.02, 8) });
      darkParts.push({ g: sweep(lip, a0 + 0.01, a1 - 0.01, 8) });
      // clamps over each core
      const c = (i + 1) * step;
      darkParts.push({ g: sweep([[R + 70, -95], [R + 104, -95], [R + 104, 95], [R + 70, 95]], c - gap * 0.9, c + gap * 0.9, 3) });
      darkParts.push({ g: sweep([[R - 104, -95], [R - 72, -95], [R - 72, 95], [R - 104, 95]], c - gap * 0.9, c + gap * 0.9, 3) });
      coreParts.push({ g: sweep([[R - 70, -100], [R + 70, -100], [R + 70, 100], [R - 70, 100]], c - gap / 2 - 0.002, c + gap / 2 + 0.002, 2) });
      // radiator fins on the back of every segment
      for (const fa of [0.3, 0.5, 0.7]) {
        const box = new BoxGeometry(150, 8, 150);
        darkParts.push({ g: box, rot: a0 + (a1 - a0) * fa, off: new Vector3(R * Math.cos(a0 + (a1 - a0) * fa), R * Math.sin(a0 + (a1 - a0) * fa), 190) });
      }
    }
    // pylons, with braces back to the ring and a mast at the tip
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      seg.push({ g: taper(R + 80, R + 820, 150, 50, 200, 70), rot: a });
      darkParts.push({ g: taper(R + 820, R + 860, 70, 70, 90, 90), rot: a });
      for (const s of [-1, 1]) darkParts.push({ g: taper(R + 90, R + 520, 40, 22, 26, 18), rot: a + s * 0.08, off: new Vector3(0, 0, s * 40) });
    }
    this.meshes.add(new Mesh(merge(seg), armour));
    this.meshes.add(new Mesh(merge(darkParts), dark));
    this.meshes.add(new Mesh(merge(coreParts), core));

    // counter-rotating inner rings with running lights
    this.ringA = new Mesh(sweep([[952, -48], [980, -48], [980, 48], [952, 48]], 0, Math.PI * 2, 192, false), hull([0.16, 0.17, 0.19], { DASHES: '' }, 48));
    this.ringB = new Mesh(sweep([[892, -30], [912, -30], [912, 30], [892, 30]], 0, Math.PI * 2, 192, false), hull([0.16, 0.17, 0.19], { DASHES: '' }, 24));
    this.meshes.add(this.ringA, this.ringB);

    // the portal film
    this.portalMat = new ShaderMaterial({
      vertexShader: /* glsl */ `varying vec3 vL; void main() { vL = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: PORTAL_FRAG, transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide,
      uniforms: { uCharge: { value: 0 }, uOpen: { value: 0 }, uTime: { value: 0 }, uGain: { value: 1 }, uGlowCol: { value: glow } },
    });
    const portal = new Mesh(new CircleGeometry(PORTAL, 160), this.portalMat);
    portal.renderOrder = 2;
    this.meshes.add(portal);

    // lights: pylon strobes and nav lights, marker lights round the face, core glows, approach beacons
    const pos: number[] = [], col: number[] = [], info: number[] = [];
    const add = (x: number, y: number, z: number, c: [number, number, number], size: number, kind: number, phase: number) => {
      pos.push(x, y, z);
      col.push(...c);
      info.push(size, kind, phase);
    };
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      add(ca * (R + 870), sa * (R + 870), 0, [1, 1, 1], 60, 1, k * 0.25);
      add(ca * (R + 830), sa * (R + 830), -40, k % 2 ? [1, 0.1, 0.06] : [0.1, 1, 0.3], 40, 0, k);
    }
    for (let i = 0; i < SEGMENTS; i++) {
      const a = (i + 0.5) * step;
      add(Math.cos(a) * (R - 60), Math.sin(a) * (R - 60), -124, [1, 0.62, 0.22], 14, 0, i * 0.37);
      const c = (i + 1) * step;
      add(Math.cos(c) * R, Math.sin(c) * R, -105, [0.35, 0.85, 1.0], 160, 3, 0);
    }
    for (let i = 0; i < 10; i++) {
      const z = -(1200 + i * 1250);
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2;
        add(Math.cos(a) * 620, Math.sin(a) * 620, z, i % 3 === 2 ? [1, 0.7, 0.3] : [0.4, 0.85, 1.0], 22, 2, i / 10);
      }
    }
    const lg = new BufferGeometry();
    lg.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    lg.setAttribute('aColor', new BufferAttribute(new Float32Array(col), 3));
    lg.setAttribute('aInfo', new BufferAttribute(new Float32Array(info), 3));
    this.lightMat = new ShaderMaterial({
      vertexShader: LIGHT_VERT, fragmentShader: LIGHT_FRAG, transparent: true, depthWrite: false, blending: AdditiveBlending,
      uniforms: {
        uTime: { value: 0 }, uFocal: { value: 1000 }, uPx: { value: 1 }, uCharge: { value: 0 }, uGain: { value: 1 }, uScale: { value: 0.001 },
      },
    });
    const lights = new Points(lg, this.lightMat);
    lights.frustumCulled = false;
    lights.renderOrder = 3;
    this.root.add(lights);
    for (const o of this.meshes.children) o.frustumCulled = false;
  }

  /**
   * Places the gate for this frame and says whether it is worth drawing.
   * @param rel gate centre minus camera position (km)
   * @param toStar unit vector from the gate toward its star (world)
   * @param irr starlight irradiance at the gate (rgb)
   */
  update(dt: number, t: number, rel: Vector3, quat: Quaternion, camQ: Quaternion, toStar: Vector3, irr: Vector3,
    gain: number, fov: number, aspect: number, bufH: number, pr: number): boolean {
    const d = rel.length();
    this.distance = d;
    // pixels per radian; beyond the reach of its lights there is nothing to draw
    const focal = bufH / (2 * Math.tan((fov * Math.PI) / 360));
    if (d > 2e5) return false;
    this.spinA += dt * (0.025 + 0.9 * this.charge * this.charge);
    this.spinB -= dt * (0.04 + 1.3 * this.charge * this.charge);
    this.ringA.rotation.z = this.spinA;
    this.ringB.rotation.z = this.spinB;
    this.root.position.copy(rel);
    this.root.quaternion.copy(quat);
    const cam = this.camera;
    cam.quaternion.copy(camQ);
    cam.fov = fov;
    cam.aspect = aspect;
    // depth range fitted round the gate and its beacons (up to 13 km in front)
    const reach = 14;
    cam.near = Math.max(0.005, d - reach) * 0.9;
    cam.far = d + reach;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    // the meshes are not worth drawing once smaller than a few pixels
    this.meshes.visible = (GATE.span / d) * focal > 3;
    const light = _rel.copy(toStar).applyQuaternion(camQ.clone().invert());
    for (const m of this.mats) {
      const u = m.uniforms;
      (u.uLight.value as Vector3).copy(light);
      (u.uIrr.value as Vector3).copy(irr);
      u.uGain.value = gain;
      u.uCharge.value = this.charge;
      u.uTime.value = t;
    }
    const p = this.portalMat.uniforms;
    p.uCharge.value = this.charge;
    p.uOpen.value = this.open;
    p.uTime.value = t;
    p.uGain.value = gain;
    const l = this.lightMat.uniforms;
    l.uTime.value = t;
    l.uFocal.value = focal;
    l.uPx.value = pr;
    l.uCharge.value = this.charge;
    l.uGain.value = gain;
    return true;
  }

  render(renderer: WebGLRenderer): void {
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
  }
}
