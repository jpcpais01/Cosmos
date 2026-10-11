import { Matrix4, Quaternion, Vector3 } from 'three';
import type { BodyState, Ephemeris } from '../sim/ephemeris';
import { C_KMS } from '../sim/constants';
import { polarRadius } from '../sim/bodies';

export interface FlightInput {
  pitch: number; // -1..1 (rate demand)
  yaw: number;
  roll: number;
  /** direct angular deltas from the mouse (radians this frame) */
  mousePitch: number;
  mouseYaw: number;
  throttleDelta: number; // per second
  boost: boolean;
  brake: boolean;
}

export const SUBLIGHT_MAX = 0.05 * C_KMS; // 15,000 km/s
const V_MIN = 0.01; // 10 m/s

const _v = new Vector3();
const _q = new Quaternion();
const _fwd = new Vector3();
const _axis = new Vector3();

/** Player ship kinematics. Position is stored relative to a reference body so planets don't run away from you. */
export class Ship {
  frame: BodyState;
  /** position relative to the frame body (km) */
  rel = new Vector3();
  /** velocity relative to the frame body (km/s) */
  vel = new Vector3();
  quat = new Quaternion();
  angVel = new Vector3();
  throttle = 0;
  /** speed limit currently enforced near bodies (km/s) */
  limit = SUBLIGHT_MAX;
  altitude = Infinity;
  nearest: BodyState;
  /** true while the warp drive owns the ship */
  autopilot = false;

  constructor(private eph: Ephemeris) {
    this.frame = eph.get('earth');
    this.nearest = this.frame;
  }

  absPos(out: Vector3): Vector3 {
    return out.copy(this.frame.pos).add(this.rel);
  }

  setAbs(abs: Vector3): void {
    this.rel.subVectors(abs, this.frame.pos);
  }

  forward(out: Vector3): Vector3 {
    return out.set(0, 0, -1).applyQuaternion(this.quat);
  }

  get speed(): number {
    return this.vel.length();
  }

  /** Throttle 0..1 -> target speed (log scale). */
  targetSpeed(): number {
    if (this.throttle <= 0.001) return 0;
    const vmax = Math.max(this.limit, V_MIN * 2);
    return V_MIN * Math.pow(vmax / V_MIN, this.throttle);
  }

  /** Surface radius of a body in the direction of a body-relative vector. */
  static surfaceRadius(b: BodyState, relWorld: Vector3): number {
    const def = b.def;
    const pr = polarRadius(def);
    if (pr === def.radius && !def.triaxial) return def.radius;
    // latitude from body z axis
    const e = b.rot.elements;
    const zx = e[6], zy = e[7], zz = e[8];
    const sinLat = (relWorld.x * zx + relWorld.y * zy + relWorld.z * zz) / Math.max(relWorld.length(), 1e-9);
    const c2 = 1 - sinLat * sinLat;
    const a = def.radius, c = pr;
    return (a * c) / Math.sqrt(c * c * c2 + a * a * sinLat * sinLat);
  }

  static minAltitude(b: BodyState): number {
    const def = b.def;
    if (def.kind === 'star') return def.radius * 0.6;
    if (def.shading === 'gas' || def.shading === 'icegiant') return Math.max(150, def.radius * 0.004);
    return Math.min(Math.max(def.radius * 0.0004, 0.08), 3);
  }

  updateEnvironment(): void {
    const abs = this.absPos(_v);
    // reference frame
    const dom = this.eph.dominantBody(abs);
    if (dom !== this.frame) {
      this.frame = dom;
      this.setAbs(abs);
    }
    // nearest surface
    let best = Infinity;
    let nearest = this.frame;
    for (const s of this.eph.list) {
      const rel = _fwd.subVectors(abs, s.pos);
      const alt = rel.length() - Ship.surfaceRadius(s, rel);
      if (alt < best) {
        best = alt;
        nearest = s;
      }
    }
    this.altitude = best;
    this.nearest = nearest;
    // speed limit grows with altitude (like a supercruise safety governor)
    this.limit = Math.min(SUBLIGHT_MAX, Math.max(0.3, (best - Ship.minAltitude(nearest)) * 0.12));
  }

  update(dt: number, input: FlightInput): void {
    this.updateEnvironment();
    if (this.autopilot) return;

    // rotation: rate demands with smoothing, mouse as direct deltas
    const maxRate = 1.1; // rad/s
    const k = 1 - Math.exp(-dt * 5);
    this.angVel.x += (input.pitch * maxRate - this.angVel.x) * k;
    this.angVel.y += (input.yaw * maxRate * 0.8 - this.angVel.y) * k;
    this.angVel.z += (input.roll * maxRate * 1.4 - this.angVel.z) * k;
    const dx = this.angVel.x * dt + input.mousePitch;
    const dy = this.angVel.y * dt + input.mouseYaw;
    const dz = this.angVel.z * dt;
    _q.setFromAxisAngle(_axis.set(1, 0, 0), dx);
    this.quat.multiply(_q);
    _q.setFromAxisAngle(_axis.set(0, 1, 0), dy);
    this.quat.multiply(_q);
    _q.setFromAxisAngle(_axis.set(0, 0, 1), dz);
    this.quat.multiply(_q).normalize();

    // throttle and flight assist
    this.throttle = Math.min(1, Math.max(0, this.throttle + input.throttleDelta * dt));
    if (input.brake) this.throttle = Math.max(0, this.throttle - dt * 1.5);
    let target = this.targetSpeed();
    if (input.boost) target = Math.min(Math.max(target * 4, 0.5), this.limit * 2.5, SUBLIGHT_MAX);
    this.forward(_fwd);
    const desired = _v.copy(_fwd).multiplyScalar(target);
    // exponential approach + a minimum acceleration so small speeds still converge quickly
    const diff = desired.sub(this.vel);
    const dl = diff.length();
    const accel = Math.max(dl * 1.6, 0.02);
    const step = Math.min(dl, accel * dt);
    if (dl > 0) this.vel.addScaledVector(diff, step / dl);
    // hard limiter near surfaces
    const sp = this.vel.length();
    const hardLimit = this.limit * (input.boost ? 2.5 : 1.15);
    if (sp > hardLimit) this.vel.multiplyScalar(hardLimit / sp);

    this.rel.addScaledVector(this.vel, dt);
    this.collide();
  }

  /** Keeps the ship above the surface of every body. */
  collide(): void {
    const abs = this.absPos(_v);
    for (const s of this.eph.list) {
      const rel = _fwd.subVectors(abs, s.pos);
      const d = rel.length();
      const r = Ship.surfaceRadius(s, rel) + Ship.minAltitude(s);
      if (d < r) {
        const n = rel.multiplyScalar(1 / d);
        abs.copy(s.pos).addScaledVector(n, r);
        this.setAbs(abs);
        const vn = this.vel.dot(n);
        if (vn < 0) this.vel.addScaledVector(n, -vn);
      }
    }
  }

  /** Smoothly turns the ship toward a world direction; returns remaining angle (rad). */
  turnToward(dirWorld: Vector3, dt: number, rate = 1.2, upHint?: Vector3): number {
    this.forward(_fwd);
    const ang = _fwd.angleTo(dirWorld);
    const target = lookQuat(dirWorld, upHint ?? _axis.set(0, 1, 0).applyQuaternion(this.quat));
    const t = ang < 1e-6 ? 1 : Math.min(1, (rate * dt) / ang);
    this.quat.slerp(target, t);
    this.angVel.set(0, 0, 0);
    return ang;
  }
}

const _m = new Vector3();
const _x = new Vector3();
const _y = new Vector3();
const _z = new Vector3();
const _mat = new Matrix4();

/** Orientation looking along `dir` (forward = -Z) with an up hint. */
export function lookQuat(dir: Vector3, up: Vector3, out = new Quaternion()): Quaternion {
  _z.copy(dir).normalize().negate();
  _x.crossVectors(up, _z);
  if (_x.lengthSq() < 1e-10) _x.crossVectors(_m.set(0.3, 1, 0.1).normalize(), _z);
  _x.normalize();
  _y.crossVectors(_z, _x);
  return out.setFromRotationMatrix(_mat.makeBasis(_x, _y, _z));
}
