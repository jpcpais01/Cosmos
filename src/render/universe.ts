import {
  BufferAttribute, BufferGeometry, IcosahedronGeometry, Matrix3, Matrix4, Mesh, PerspectiveCamera, PlaneGeometry, Points,
  Quaternion, RingGeometry, Scene, ShaderMaterial, Texture, Vector3, type WebGLRenderer,
} from 'three';
import type { BodyState, Ephemeris } from '../sim/ephemeris';
import { AU_KM } from '../sim/constants';
import { createPlanetMaterial, MAX_OCCLUDERS } from './planetMaterial';
import { SUN_RADIANCE, createBodyPointsMaterial, createRingMaterial, createSunGlowMaterial, createSunMaterial } from './bodyMaterials';
import { createDetailTexture } from './detail';
import { solidTexture, TextureStreamer, type Kind } from './textures';

export const SUN_COLOR = new Vector3(1.0, 0.975, 0.94);

/** Apparent brightness (display intensity) of a point source of visual magnitude m. Shared with the star shader. */
export function magToIntensity(m: number): number {
  return 1.5 * Math.pow(10, -0.4 * 0.58 * m);
}

interface BodyView {
  state: BodyState;
  mesh: Mesh;
  mat: ShaderMaterial;
  ring?: Mesh;
  ringMat?: ShaderMaterial;
  glow?: Mesh;
  glowMat?: ShaderMaterial;
  boundR: number;
  hasNormal: boolean;
  hasAux: boolean;
  /** apparent radius in pixels (last frame) */
  pixelRadius: number;
  /** distance from camera (km) */
  distance: number;
  /** apparent visual magnitude from the camera */
  apparentMag: number;
}

const _rel = new Vector3();
const _tmp = new Vector3();
const _tmp2 = new Vector3();
const _w2b = new Matrix3();
const _m4 = new Matrix4();
const _fwd = new Vector3();
const _camB = new Vector3();
const _fwdB = new Vector3();
const _focus = new Vector3();

export class Universe {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(60, 1, 1e-4, 1e11);
  readonly views: BodyView[] = [];
  readonly byId = new Map<string, BodyView>();
  private points: Points;
  private pointsMat: ShaderMaterial;
  private pointPos: Float32Array;
  private pointCol: Float32Array;
  private pointInt: Float32Array;
  textures: TextureStreamer;
  private black = solidTexture(40, 40, 40);
  private flatNormal = solidTexture(128, 128, 255);
  private auxDefault = solidTexture(0, 0, 0);
  private detail = createDetailTexture();
  /** Pixels per radian vertically (set from viewport). */
  pixelAngle = 0.001;
  logDepthF = 1;
  /** brightness multiplier for unresolved bodies (matches the star field) */
  pointBrightness = 1;

  constructor(renderer: WebGLRenderer, private eph: Ephemeris, maxTexture: number) {
    this.textures = new TextureStreamer(renderer, maxTexture);
    this.camera.position.set(0, 0, 0);
    this.camera.matrixAutoUpdate = true;
    const proxy = new IcosahedronGeometry(1, 3);

    for (const state of eph.list) {
      const def = state.def;
      const hasNormal = this.textures.has(def.id, 'normal');
      const hasAux = this.textures.has(def.id, 'aux');
      const isSun = def.kind === 'star';
      const mat = isSun ? createSunMaterial(this.black) : createPlanetMaterial(def, this.black, hasNormal, this.detail);
      if (hasNormal) mat.uniforms.uNormal.value = this.flatNormal;
      if (def.shading === 'earth') mat.uniforms.uAux.value = this.auxDefault;
      const mesh = new Mesh(proxy, mat);
      mesh.frustumCulled = true;
      mesh.matrixAutoUpdate = false;
      const top = def.atmosphere ? def.radius + def.atmosphere.height : def.triaxial ? Math.max(...def.triaxial) : def.radius;
      const boundR = top * 1.035;
      const view: BodyView = { state, mesh, mat, boundR, hasNormal, hasAux, pixelRadius: 0, distance: 1, apparentMag: 99 };
      mesh.renderOrder = 0;
      this.scene.add(mesh);
      if (def.rings) {
        const g = new RingGeometry(def.rings.inner, def.rings.outer, 256, 1);
        const axes = new Vector3(def.radius, def.radius, def.polarRadius ?? def.radius);
        const ringMat = createRingMaterial(this.black, def.rings.inner, def.rings.outer, axes);
        const ring = new Mesh(g, ringMat);
        ring.matrixAutoUpdate = false;
        ring.renderOrder = 1;
        ring.frustumCulled = false;
        this.scene.add(ring);
        view.ring = ring;
        view.ringMat = ringMat;
        this.loadRingTexture(def.rings.texture, ringMat);
      }
      if (isSun) {
        const glowMat = createSunGlowMaterial();
        const glow = new Mesh(new PlaneGeometry(2, 2), glowMat);
        glow.frustumCulled = false;
        glow.matrixAutoUpdate = false;
        glow.renderOrder = 3;
        this.scene.add(glow);
        view.glow = glow;
        view.glowMat = glowMat;
      }
      this.views.push(view);
      this.byId.set(def.id, view);
    }

    // Unresolved bodies as points of light.
    const n = eph.list.length;
    this.pointPos = new Float32Array(n * 3);
    this.pointCol = new Float32Array(n * 3);
    this.pointInt = new Float32Array(n);
    const pg = new BufferGeometry();
    pg.setAttribute('position', new BufferAttribute(this.pointPos, 3));
    pg.setAttribute('aColor', new BufferAttribute(this.pointCol, 3));
    pg.setAttribute('aIntensity', new BufferAttribute(this.pointInt, 1));
    this.pointsMat = createBodyPointsMaterial();
    this.points = new Points(pg, this.pointsMat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    this.scene.add(this.points);
  }

  private loadRingTexture(path: string, mat: ShaderMaterial): void {
    import('three').then(({ TextureLoader, SRGBColorSpace, ClampToEdgeWrapping, LinearFilter }) => {
      new TextureLoader().load(import.meta.env.BASE_URL + path, (t: Texture) => {
        t.colorSpace = SRGBColorSpace;
        t.wrapS = t.wrapT = ClampToEdgeWrapping;
        t.minFilter = LinearFilter;
        t.generateMipmaps = false;
        mat.uniforms.uTex.value = t;
        const saturn = this.views.find((v) => v.ringMat === mat);
        if (saturn) (saturn.mat.uniforms.uRingTex.value = t);
      });
    });
  }

  /**
   * Body-frame unit direction of the surface point the view is centred on: halfway between the
   * point straight below the camera and the point the camera looks at (when it looks at the body).
   * Expects _w2b and _rel to hold this body's frame and offset.
   */
  private focusPoint(radius: number, out: Vector3): Vector3 {
    _camB.copy(_rel).negate().applyMatrix3(_w2b);
    _fwdB.copy(_fwd).applyMatrix3(_w2b);
    out.copy(_camB).normalize();
    const b = _camB.dot(_fwdB);
    const c = _camB.lengthSq() - radius * radius;
    const h = b * b - c;
    if (h > 0 && c > 0) {
      const t = -b - Math.sqrt(h);
      if (t > 0) out.add(_tmp2.copy(_camB).addScaledVector(_fwdB, t).normalize()).normalize();
    }
    return out;
  }

  /** Points a body's tile window at (fu, fv) when close enough to need more than the whole-globe map. */
  private updateWindow(id: string, kind: Kind, name: string, u: Record<string, { value: unknown }>, want: number, fu: number, fv: number, lat: number, now: number): void {
    const levels = this.textures.tileLevels(id, kind);
    let level = 0;
    for (const L of levels) if (L <= want * 1.25) level = L;
    // the 8K window spans 90 degrees of longitude; near the poles that is too narrow, so use 4K there
    if (level > 4096 && Math.abs(lat) > 1.0 && levels.includes(4096)) level = 4096;
    const on = u[`${name}On`];
    if (!level) {
      on.value = 0;
      return;
    }
    const w = this.textures.window(id, kind);
    w.update(fu, fv, level, now);
    if (w.texture) {
      u[`${name}W`].value = w.texture;
      u[`${name}R`].value = w.rect;
      on.value = 1;
    } else on.value = 0;
  }

  /** Loads the smallest tier of every texture. */
  async preload(onProgress: (f: number) => void): Promise<void> {
    const jobs: Promise<unknown>[] = [];
    for (const v of this.views) {
      const id = v.state.def.id;
      jobs.push(this.textures.preload(id, 'map').then((t) => t && (v.mat.uniforms.uMap.value = t)));
      if (v.hasNormal) jobs.push(this.textures.preload(id, 'normal').then((t) => t && (v.mat.uniforms.uNormal.value = t)));
      if (v.hasAux) jobs.push(this.textures.preload(id, 'aux').then((t) => t && (v.mat.uniforms.uAux.value = t)));
    }
    let done = 0;
    await Promise.all(jobs.map((j) => j.catch(() => undefined).then(() => onProgress(++done / jobs.length))));
  }

  setViewport(heightPx: number, fovDeg: number, aspect: number): void {
    this.camera.fov = fovDeg;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.pixelAngle = (2 * Math.tan((fovDeg * Math.PI) / 360)) / heightPx;
    this.logDepthF = 2.0 / Math.log2(this.camera.far + 1.0);
  }

  /**
   * Positions everything relative to the camera.
   * @param camAbs camera heliocentric position (km, float64)
   * @param camQuat camera orientation (world)
   */
  update(camAbs: Vector3, camQuat: Quaternion, timeSec: number, dprPx: number): void {
    const now = performance.now();
    this.camera.quaternion.copy(camQuat);
    this.camera.updateMatrixWorld(true);
    _fwd.set(0, 0, -1).applyQuaternion(camQuat);
    const sun = this.eph.get('sun');

    for (let i = 0; i < this.views.length; i++) {
      const v = this.views[i];
      const s = v.state;
      const def = s.def;
      const u = v.mat.uniforms;
      _rel.subVectors(s.pos, camAbs);
      const dist = _rel.length();
      v.distance = dist;
      v.pixelRadius = def.radius / Math.max(dist, 1e-3) / this.pixelAngle;
      const boundPx = v.boundR / Math.max(dist, 1e-3) / this.pixelAngle;
      const visible = boundPx > 0.25;
      v.mesh.visible = visible;

      // body frame
      _w2b.copy(s.rot).transpose();
      _m4.setFromMatrix3(s.rot);
      _m4.scale(_tmp.set(v.boundR, v.boundR, v.boundR));
      _m4.setPosition(_rel);
      v.mesh.matrix.copy(_m4);
      v.mesh.matrixWorld.copy(_m4);

      u.uLogDepthF.value = this.logDepthF;
      (u.uCenter.value as Vector3).copy(_rel);
      (u.uW2B.value as Matrix3).copy(_w2b);
      (u.uCamFwd.value as Vector3).copy(_fwd);
      u.uPixelAngle.value = this.pixelAngle;
      u.uTime.value = timeSec;

      if (def.kind === 'star') {
        if (v.glow && v.glowMat) {
          const g = v.glowMat.uniforms;
          v.glow.matrix.makeTranslation(_rel.x, _rel.y, _rel.z);
          v.glow.matrixWorld.copy(v.glow.matrix);
          const size = def.radius * 14;
          g.uSize.value = size;
          g.uRatio.value = def.radius / size;
          g.uLogDepthF.value = this.logDepthF;
          g.uIntensity.value = 1.0;
          v.glow.visible = boundPx > 0.5;
        }
        u.uRadius.value = def.radius;
      } else {
        // sunlight
        _tmp.subVectors(sun.pos, s.pos);
        const dSun = _tmp.length();
        _tmp.multiplyScalar(1 / dSun);
        (u.uSunB.value as Vector3).copy(_tmp).applyMatrix3(_w2b);
        const irr = (AU_KM / dSun) ** 2;
        (u.uSunIrr.value as Vector3).copy(SUN_COLOR).multiplyScalar(irr);
        u.uSunAng.value = sun.def.radius / dSun;
        if (visible) this.updateOccluders(v, _tmp, _w2b);
        if (def.kind === 'moon' && s.parent) this.updateShine(v, _w2b);
        if (v.ring && v.ringMat) {
          const r = v.ringMat.uniforms;
          _m4.setFromMatrix3(s.rot);
          _m4.setPosition(_rel);
          v.ring.matrix.copy(_m4);
          v.ring.matrixWorld.copy(_m4);
          v.ring.visible = boundPx * 2.3 > 0.5;
          r.uLogDepthF.value = this.logDepthF;
          (r.uSunB.value as Vector3).copy(u.uSunB.value as Vector3);
          (r.uViewB.value as Vector3).copy(_rel).negate().applyMatrix3(_w2b);
          (r.uSunIrr.value as Vector3).copy(u.uSunIrr.value as Vector3);
          (r.uCamFwd.value as Vector3).copy(_fwd);
          r.uPixelAngle.value = this.pixelAngle;
        }
      }

      // texture streaming
      if (visible) {
        const want = 2 * Math.PI * v.pixelRadius * 0.8;
        const id = def.id;
        const t = this.textures.get(id, 'map', want, now);
        if (t && u.uMap.value !== t) u.uMap.value = t;
        if (v.hasNormal) {
          const tn = this.textures.get(id, 'normal', want * 0.6, now);
          if (tn && u.uNormal.value !== tn) u.uNormal.value = tn;
        }
        if (v.hasAux) {
          const ta = this.textures.get(id, 'aux', want, now);
          if (ta && u.uAux.value !== ta) u.uAux.value = ta;
        }
        // high-resolution tiles only around the part of the surface in view
        if (def.kind !== 'star') {
          if (u.uDetailTexel) {
            // synthetic close-up relief starts below the finest texel this body has at this quality
            const finest = Math.max(...this.textures.tileLevels(id, 'map'), ...this.textures.sizes(id, 'map'), 1024);
            const texel = (2 * Math.PI * def.radius) / finest;
            u.uDetailTexel.value = texel;
            u.uDetailScale.value = 1 / (texel * 8);
          }
          this.focusPoint(def.radius, _focus);
          const lat = Math.asin(Math.max(-1, Math.min(1, _focus.z)));
          const fu = Math.atan2(_focus.y, _focus.x) / (2 * Math.PI) + 0.5;
          const fv = lat / Math.PI + 0.5;
          // detail needed at that point: the globe width at which one texel covers about one pixel there
          const surf = Math.max(_tmp2.copy(_focus).multiplyScalar(def.radius).distanceTo(_camB), 1e-3);
          const near = Math.max(want, ((2 * Math.PI * def.radius) / (surf * this.pixelAngle)) * 0.8);
          this.updateWindow(id, 'map', 'uMap', u, near, fu, fv, lat, now);
          if (v.hasNormal) this.updateWindow(id, 'normal', 'uNormal', u, near * 0.6, fu, fv, lat, now);
          if (v.hasAux) this.updateWindow(id, 'aux', 'uAux', u, near, fu, fv, lat, now);
        }
      } else if (def.kind !== 'star') {
        u.uMapOn.value = 0;
        if (v.hasNormal) u.uNormalOn.value = 0;
        if (v.hasAux) u.uAuxOn.value = 0;
      }

      // point-of-light representation
      const pi = i * 3;
      this.pointPos[pi] = _rel.x;
      this.pointPos[pi + 1] = _rel.y;
      this.pointPos[pi + 2] = _rel.z;
      const isStar = def.kind === 'star';
      // the Sun's disc stays sharp down to about a pixel; below that a soft point carries its light
      const fade = isStar
        ? Math.min(1, Math.max(0, (1.2 - v.pixelRadius) / 0.8))
        : Math.min(1, Math.max(0, (2.2 - v.pixelRadius) / 1.6));
      if (isStar) u.uDiscGain.value = 1 - fade;
      let intensity = 0;
      {
        let mag: number;
        if (def.kind === 'star') {
          mag = -26.74 + 5 * Math.log10(dist / AU_KM);
        } else {
          const r = s.pos.distanceTo(sun.pos) / AU_KM;
          const delta = dist / AU_KM;
          _tmp.subVectors(sun.pos, s.pos).normalize();
          _tmp2.copy(_rel).negate().normalize();
          const alpha = Math.acos(Math.min(1, Math.max(-1, _tmp.dot(_tmp2))));
          const q = Math.max((Math.sin(alpha) + (Math.PI - alpha) * Math.cos(alpha)) / Math.PI, 1e-4);
          mag = def.H + 5 * Math.log10(r * delta) - 2.5 * Math.log10(q);
        }
        v.apparentMag = mag;
        if (isStar) {
          // the same light as the disc it replaces (pi r^2 pixels at the disc radiance) rather than its
          // magnitude, which overflowed the half-float buffer and blew the bloom up into a white-out
          const gauss = (Math.PI / 1.1) * dprPx * dprPx; // integral of the point's falloff, in pixels
          if (fade > 0) intensity = (SUN_RADIANCE * Math.PI * v.pixelRadius * v.pixelRadius * fade) / (gauss * this.pointBrightness);
        } else if (fade > 0 && dist > def.radius * 1.5) intensity = magToIntensity(mag) * fade;
      }
      this.pointInt[i] = intensity;
      const c = def.color;
      const cm = Math.max(c[0], c[1], c[2]);
      this.pointCol[pi] = c[0] / cm;
      this.pointCol[pi + 1] = c[1] / cm;
      this.pointCol[pi + 2] = c[2] / cm;
    }
    const geo = this.points.geometry;
    (geo.attributes.position as BufferAttribute).needsUpdate = true;
    (geo.attributes.aIntensity as BufferAttribute).needsUpdate = true;
    (geo.attributes.aColor as BufferAttribute).needsUpdate = true;
    this.pointsMat.uniforms.uLogDepthF.value = this.logDepthF;
    this.pointsMat.uniforms.uPx.value = dprPx;
    this.pointsMat.uniforms.uBright.value = this.pointBrightness;
    this.textures.evict(now);
  }

  /** Picks up to MAX_OCCLUDERS spheres that may cast a shadow on this body. */
  private updateOccluders(v: BodyView, sunDir: Vector3, w2b: Matrix3): void {
    const s = v.state;
    const cands: BodyState[] = [];
    if (s.parent && s.parent.def.kind !== 'star') cands.push(s.parent);
    for (const c of s.children) cands.push(c);
    if (s.parent) for (const sib of s.parent.children) if (sib !== s) cands.push(sib);
    const u = v.mat.uniforms;
    const pos = u.uOccPos.value as Vector3[];
    const rad = u.uOccR.value as number[];
    let n = 0;
    const R = s.def.radius;
    const sunAng = u.uSunAng.value as number;
    for (const c of cands) {
      if (n >= MAX_OCCLUDERS) break;
      _tmp2.subVectors(c.pos, s.pos);
      const along = _tmp2.dot(sunDir);
      if (along <= 0) continue;
      const perp = Math.sqrt(Math.max(_tmp2.lengthSq() - along * along, 0));
      const penumbra = c.def.radius + along * sunAng * 1.2;
      if (perp > R + penumbra) continue;
      pos[n].copy(_tmp2).applyMatrix3(w2b);
      rad[n] = c.def.radius;
      n++;
    }
    u.uOccN.value = n;
  }

  /** Light reflected by the parent planet onto a moon's night side. */
  private updateShine(v: BodyView, w2b: Matrix3): void {
    const s = v.state;
    const p = s.parent!;
    if (p.def.kind === 'star') return;
    const sun = this.eph.get('sun');
    _tmp.subVectors(p.pos, s.pos);
    const d = _tmp.length();
    _tmp.multiplyScalar(1 / d);
    (v.mat.uniforms.uShineDir.value as Vector3).copy(_tmp).applyMatrix3(w2b);
    _tmp2.subVectors(sun.pos, p.pos).normalize();
    // phase of the parent seen from the moon: fraction lit
    const cosPhase = -_tmp.dot(_tmp2);
    const lit = (1 + cosPhase) / 2;
    const irr = (AU_KM / p.pos.distanceTo(sun.pos)) ** 2;
    const solid = (p.def.radius / d) ** 2;
    const k = p.def.albedo * lit * solid * irr * 1.2;
    const c = p.def.color;
    (v.mat.uniforms.uShineCol.value as Vector3).set(c[0] * k * 2.2, c[1] * k * 2.2, c[2] * k * 2.2);
  }

  /** Is a camera-relative direction blocked by any body (ray test)? Returns nearest hit distance or Infinity. */
  rayBlocked(dir: Vector3, maxDist: number, ignore?: string): number {
    let best = Infinity;
    for (const v of this.views) {
      if (v.state.def.id === ignore) continue;
      const c = v.mesh.matrixWorld.elements;
      _tmp.set(c[12], c[13], c[14]);
      const b = _tmp.dot(dir);
      if (b <= 0 || b > maxDist + v.state.def.radius) continue;
      const d2 = _tmp.lengthSq() - b * b;
      const r = v.state.def.radius;
      if (d2 < r * r) best = Math.min(best, b - Math.sqrt(r * r - d2));
    }
    return best;
  }
}
