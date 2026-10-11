import { Vector3 } from 'three';
import type { Ephemeris } from '../sim/ephemeris';
import { C_KMS, type WarpFactor } from '../sim/constants';
import type { Ship } from '../ship/flight';
import { BODY_BY_ID } from '../sim/bodies';

export type WarpTarget =
  | { kind: 'body'; id: string }
  /** a point fixed relative to a (non-rotating) body frame */
  | { kind: 'point'; frame: string; offset: Vector3; label?: string };

export type WarpState = 'idle' | 'aligning' | 'spooling' | 'cruise' | 'exiting';

const SPOOL_TIME = 3.2;
const EXIT_TIME = 1.6;
const VISUAL_BETA: Record<number, number> = { 1: 0.3, 3: 0.42, 10: 0.55, 50: 0.66, 100: 0.72 };

const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();

/** Arrival distance from a body's centre (km) for a nice framing. */
export function arrivalDistance(id: string): number {
  const d = BODY_BY_ID[id];
  if (d.kind === 'star') return d.radius * 14;
  if (d.rings) return d.rings.outer * 2.3;
  const top = d.radius + (d.atmosphere?.height ?? 0);
  if (d.kind === 'moon' || d.kind === 'dwarf') return top * 3.2 + 50;
  return top * 3.6;
}

export class WarpDrive {
  state: WarpState = 'idle';
  factor: WarpFactor = 10;
  target: WarpTarget | null = null;
  /** resolved arrival offset when the target is a body */
  private arrivalOffset = new Vector3();
  private t = 0;
  /** effects 0..1 */
  spool = 0;
  intensity = 0;
  flash = 0;
  shake = 0;
  speed = 0;
  distance = 0;
  message = '';
  onEvent?: (e: 'align' | 'spool' | 'jump' | 'exit' | 'arrive' | 'abort' | 'denied') => void;

  constructor(private eph: Ephemeris, private ship: Ship) {}

  get active(): boolean {
    return this.state !== 'idle';
  }

  /** Visual aberration "beta" for the star field. */
  get visualBeta(): number {
    return (VISUAL_BETA[this.factor] ?? 0.8) * this.intensity;
  }

  /** Absolute position of the target's arrival point. */
  resolve(out: Vector3, target = this.target): Vector3 | null {
    if (!target) return null;
    if (target.kind === 'body') {
      const b = this.eph.get(target.id);
      if (this.state !== 'idle' && target === this.target) return out.copy(b.pos).add(this.arrivalOffset);
      return out.copy(b.pos).add(this.computeArrivalOffset(target.id, _c));
    }
    return out.copy(this.eph.get(target.frame).pos).add(target.offset);
  }

  private computeArrivalOffset(id: string, out: Vector3): Vector3 {
    const b = this.eph.get(id);
    const ship = this.ship.absPos(_a);
    const fromBody = _b.subVectors(ship, b.pos).normalize();
    if (b.def.kind !== 'star') {
      const toSun = out.subVectors(this.eph.get('sun').pos, b.pos).normalize();
      fromBody.addScaledVector(toSun, 0.9);
      // keep a little elevation above the orbital plane for a nicer view
      fromBody.y += 0.12;
      fromBody.normalize();
    }
    return out.copy(fromBody).multiplyScalar(arrivalDistance(id));
  }

  setTarget(t: WarpTarget | null): void {
    if (this.active) return;
    this.target = t;
  }

  targetName(t = this.target): string {
    if (!t) return '';
    if (t.kind === 'body') return BODY_BY_ID[t.id].name;
    return t.label ?? `Coordinates near ${BODY_BY_ID[t.frame].name}`;
  }

  /** Light-speed travel time estimate (s) at a warp factor. */
  eta(factor: number = this.factor): number {
    const p = this.resolve(_c);
    if (!p) return 0;
    return p.distanceTo(this.ship.absPos(_a)) / (factor * C_KMS);
  }

  engage(): boolean {
    if (this.active || !this.target) return false;
    const p = this.resolve(_c)!;
    const d = p.distanceTo(this.ship.absPos(_a));
    if (d < 2000) {
      this.message = 'Target too close for warp';
      this.onEvent?.('denied');
      return false;
    }
    if (this.target.kind === 'body') this.computeArrivalOffset(this.target.id, this.arrivalOffset);
    this.state = 'aligning';
    this.t = 0;
    this.ship.autopilot = true;
    this.ship.throttle = 0;
    this.message = '';
    this.onEvent?.('align');
    return true;
  }

  abort(): void {
    if (!this.active) return;
    if (this.state === 'cruise') {
      this.state = 'exiting';
      this.t = 0;
      this.flash = 1;
      this.onEvent?.('exit');
    } else {
      this.state = 'idle';
      this.ship.autopilot = false;
      this.onEvent?.('abort');
    }
  }

  update(dt: number): void {
    this.flash = Math.max(0, this.flash - dt * 2.2);
    this.shake = Math.max(0, this.shake - dt * 1.4);
    if (this.state === 'idle') {
      this.intensity = Math.max(0, this.intensity - dt);
      this.spool = Math.max(0, this.spool - dt);
      this.speed = 0;
      return;
    }
    this.t += dt;
    const pos = this.ship.absPos(_a);
    const tgt = this.resolve(_b)!;
    const toT = _c.subVectors(tgt, pos);
    this.distance = toT.length();
    const dir = toT.multiplyScalar(1 / Math.max(this.distance, 1e-9));
    this.ship.vel.multiplyScalar(Math.exp(-dt * 3));

    switch (this.state) {
      case 'aligning': {
        const ang = this.ship.turnToward(dir, dt, 1.6);
        this.ship.rel.addScaledVector(this.ship.vel, dt);
        if (ang < 0.02 || this.t > 5) {
          this.state = 'spooling';
          this.t = 0;
          this.onEvent?.('spool');
        }
        break;
      }
      case 'spooling': {
        this.ship.turnToward(dir, dt, 2);
        this.spool = Math.min(1, this.t / SPOOL_TIME);
        this.shake = Math.max(this.shake, this.spool * 0.35);
        if (this.t >= SPOOL_TIME) {
          this.state = 'cruise';
          this.t = 0;
          this.flash = 1;
          this.shake = 1;
          this.onEvent?.('jump');
        }
        break;
      }
      case 'cruise': {
        this.ship.turnToward(dir, dt, 2);
        const vmax = this.factor * C_KMS;
        // ramp up fast, slow down exponentially near the target (never overshoot)
        const ramp = Math.min(1, this.t / 0.6);
        const v = Math.min(vmax * (0.02 + 0.98 * ramp * ramp), Math.max(this.distance * 2.4, 30));
        this.speed = v;
        const step = Math.min(v * dt, this.distance);
        pos.addScaledVector(dir, step);
        this.ship.setAbs(pos);
        this.intensity = Math.min(1, this.intensity + dt * 3) * Math.min(1, v / (vmax * 0.15) + 0.2);
        this.spool = Math.max(0, this.spool - dt * 0.5);
        if (this.distance - step < 5 || (this.distance < vmax * 0.02 && v < vmax * 0.015)) {
          this.state = 'exiting';
          this.t = 0;
          this.flash = 0.9;
          this.shake = 0.6;
          this.onEvent?.('exit');
        }
        break;
      }
      case 'exiting': {
        const k = Math.min(1, this.t / EXIT_TIME);
        this.intensity = Math.max(0, (1 - k) * this.intensity);
        this.speed = 0;
        this.spool = 0;
        // final settle onto the arrival point
        if (this.distance > 1) {
          pos.addScaledVector(dir, Math.min(this.distance, this.distance * dt * 4));
          this.ship.setAbs(pos);
        }
        if (this.target?.kind === 'body') {
          const b = this.eph.get(this.target.id);
          this.ship.turnToward(_b.subVectors(b.pos, pos).normalize(), dt, 0.9);
        }
        if (k >= 1) {
          this.state = 'idle';
          this.intensity = 0;
          this.ship.autopilot = false;
          this.ship.vel.set(0, 0, 0);
          this.onEvent?.('arrive');
        }
        break;
      }
    }
  }
}
