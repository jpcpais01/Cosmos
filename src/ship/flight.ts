import { Matrix4, Quaternion, Vector2, Vector3 } from 'three';
import type { BodyState, Ephemeris } from '../sim/ephemeris';
import { C_KMS } from '../sim/constants';
import { polarRadius } from '../sim/bodies';

export interface FlightInput {
  pitch: number; // -1..1 (rate demand)
  yaw: number;
  roll: number;
  /** mouse movement this frame (radians); moves the aim point the ship follows */
  mousePitch: number;
  mouseYaw: number;
  /** true while mouse flight is active (pointer locked) */
  mouseFlight: boolean;
  throttleDelta: number; // per second
  boost: boolean;
  brake: boolean;
}

export const SUBLIGHT_MAX = 0.05 * C_KMS; // 15,000 km/s
const V_MIN = 0.01; // 10 m/s
/** reverse flies at this fraction of forward speed and acceleration */
export const REVERSE_FRACTION = 0.5;

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
  /** mouse-flight aim point as (yaw, pitch) offsets from the nose, radians; the ship turns to chase it */
  aim = new Vector2();
  /** -1..1: below zero flies backwards */
  throttle = 0;
  /** set when the throttle stops at zero on its way through; it stays there until the throttle key is let go */
  private detent = false;
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

  /** Throttle -1..1 -> signed target speed along the nose (log scale); reverse tops out at half the forward speed. */
  targetSpeed(): number {
    const t = Math.abs(this.throttle);
    if (t <= 0.001) return 0;
    const rev = this.throttle < 0;
    const vmax = Math.max(this.limit * (rev ? REVERSE_FRACTION : 1), V_MIN * 2);
    return (rev ? -1 : 1) * V_MIN * Math.pow(vmax / V_MIN, t);
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
    if (this.autopilot) {
      this.aim.set(0, 0);
      return;
    }

    // mouse flight: the mouse moves an aim point and the nose chases it with inertia
    const AIM_MAX = 0.6; // rad
    if (input.mouseFlight) {
      this.aim.x += input.mouseYaw;
      this.aim.y += input.mousePitch;
      if (this.aim.length() > AIM_MAX) this.aim.setLength(AIM_MAX);
    } else {
      this.aim.multiplyScalar(Math.exp(-dt * 4));
    }
    const follow = 2.0; // 1/s: turn rate per radian of aim offset

    // rotation: rate demands approached with inertia (heavier than the old snap-to-mouse)
    const maxRate = 1.1; // rad/s
    const k = 1 - Math.exp(-dt * 5);
    const km = 1 - Math.exp(-dt * 4.5);
    const wantX = input.pitch * maxRate + Math.max(-maxRate, Math.min(maxRate, this.aim.y * follow));
    const wantY = input.yaw * maxRate * 0.8 + Math.max(-maxRate, Math.min(maxRate, this.aim.x * follow));
    const mouseActive = this.aim.lengthSq() > 1e-8;
    this.angVel.x += (wantX - this.angVel.x) * (mouseActive ? km : k);
    this.angVel.y += (wantY - this.angVel.y) * (mouseActive ? km : k);
    this.angVel.z += (input.roll * maxRate * 1.4 - this.angVel.z) * k;
    const dx = this.angVel.x * dt;
    const dy = this.angVel.y * dt;
    const dz = this.angVel.z * dt;
    // turning toward the aim point uses it up (never past zero)
    const consume = (a: number, d: number) => (a > 0 ? Math.max(0, a - Math.max(0, d)) : Math.min(0, a - Math.min(0, d)));
    this.aim.set(consume(this.aim.x, dy), consume(this.aim.y, dx));
    _q.setFromAxisAngle(_axis.set(1, 0, 0), dx);
    this.quat.multiply(_q);
    _q.setFromAxisAngle(_axis.set(0, 1, 0), dy);
    this.quat.multiply(_q);
    _q.setFromAxisAngle(_axis.set(0, 0, 1), dz);
    this.quat.multiply(_q).normalize();

    // throttle and flight assist; the throttle pauses at zero between forward and reverse
    const prev = this.throttle;
    let thr = Math.min(1, Math.max(-1, prev + input.throttleDelta * dt));
    if (input.throttleDelta === 0) this.detent = false;
    if ((prev > 0 && thr < 0) || (prev < 0 && thr > 0) || (this.detent && prev === 0)) {
      thr = 0;
      this.detent = true;
    }
    if (input.brake) thr = Math.sign(thr) * Math.max(0, Math.abs(thr) - dt * 1.5);
    this.throttle = thr;
    let target = this.targetSpeed();
    const rev = target < 0;
    const scale = rev ? REVERSE_FRACTION : 1;
    if (input.boost) target = (rev ? -1 : 1) * Math.min(Math.max(Math.abs(target) * 4, 0.5 * scale), this.limit * 2.5 * scale, SUBLIGHT_MAX * scale);
    this.forward(_fwd);
    const desired = _v.copy(_fwd).multiplyScalar(target);
    // exponential approach + a minimum acceleration so small speeds still converge quickly
    const backing = this.vel.dot(_fwd) < 0;
    const diff = desired.sub(this.vel);
    const dl = diff.length();
    // speeding up backwards is half as quick; stopping is not
    const accel = Math.max(dl * 1.6, 0.02) * (rev && backing ? REVERSE_FRACTION : 1);
    const step = Math.min(dl, accel * dt);
    if (dl > 0) this.vel.addScaledVector(diff, step / dl);
    // hard limiter near surfaces
    const sp = this.vel.length();
    const hardLimit = this.limit * (input.boost ? 2.5 : 1.15) * (backing ? REVERSE_FRACTION : 1);
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

  /**
   * Turns the ship toward a world direction with the same inertia as mouse flight: the turn rate
   * eases in, is capped at `rate` (rad/s) and eases out onto the target without overshooting.
   * Returns the remaining angle between the nose and the direction (rad).
   */
  turnToward(dirWorld: Vector3, dt: number, rate = 1.2, upHint?: Vector3): number {
    this.forward(_fwd);
    const ang = _fwd.angleTo(dirWorld);
    const target = lookQuat(dirWorld, upHint ?? _axis.set(0, 1, 0).applyQuaternion(this.quat), _qt);
    // remaining rotation in the ship's own axes (x pitch, y yaw, z roll), as a rotation vector
    _q.copy(this.quat).invert().multiply(target);
    if (_q.w < 0) _q.set(-_q.x, -_q.y, -_q.z, -_q.w);
    const s = Math.sqrt(1 - Math.min(1, _q.w * _q.w));
    const err = 2 * Math.acos(Math.min(1, _q.w));
    if (s > 1e-9) _axis.set(_q.x / s, _q.y / s, _q.z / s).multiplyScalar(err);
    else _axis.set(0, 0, 0);
    // demanded rate shrinks with the remaining angle; follow and lag are critically damped
    const want = _axis.multiplyScalar(ALIGN_FOLLOW);
    if (want.length() > rate) want.setLength(rate);
    this.angVel.lerp(want, 1 - Math.exp(-dt * ALIGN_LAG));
    const step = this.angVel.length() * dt;
    if (step > 1e-12) {
      _q.setFromAxisAngle(_v.copy(this.angVel).normalize(), step);
      this.quat.multiply(_q).normalize();
    }
    return ang;
  }
}

/** auto-turn stiffness (1/s per radian left) and rate lag (1/s); lag = 4 * follow is critically damped */
const ALIGN_FOLLOW = 1.4;
const ALIGN_LAG = 5.6;
const _qt = new Quaternion();

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
