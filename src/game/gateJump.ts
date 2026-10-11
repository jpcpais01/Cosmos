import { Quaternion, Vector3 } from 'three';
import type { Ephemeris } from '../sim/ephemeris';
import type { Ship } from '../ship/flight';
import { lookQuat } from '../ship/flight';
import { SYSTEM_BY_ID } from '../sim/systems';
import { GATE, gatePosition, gateQuaternion } from './gate';

export type JumpState = 'idle' | 'aligning' | 'charging' | 'entering' | 'tunnel' | 'exiting';
export type JumpEvent = 'align' | 'charge' | 'enter' | 'tunnel' | 'exit' | 'arrive' | 'abort' | 'denied';

const CHARGE_TIME = 5.5;
const ENTER_TIME = 2.4;
const TUNNEL_TIME = 9.5;
const EXIT_TIME = 3.6;
/** how far the ship coasts out of the destination gate (km) */
const EXIT_RUN = 3.2;

const _a = new Vector3();
const _b = new Vector3();
const _g = new Vector3();
const _z = new Vector3();
const _up = new Vector3();
const _q = new Quaternion();
const _q2 = new Quaternion();

/**
 * A jump through a warp gate to another star: line up in front of the gate, let it charge, fly through
 * the portal, ride the tunnel (the game moves to the other system halfway along) and coast out of the
 * destination's gate facing its star.
 */
export class GateJump {
  state: JumpState = 'idle';
  dest: string | null = null;
  private t = 0;
  /** effects, 0..1 */
  charge = 0;
  open = 0;
  tunnel = 0;
  speed = 0;
  flash = 0;
  shake = 0;
  /** distance flown down the tunnel (tunnel radii) */
  travel = 0;
  /** 0..1 progress through the tunnel */
  progress = 0;
  seed = 0;
  message = '';
  /** world orientation of the tunnel (its -Z is the way ahead) */
  readonly tunnelFrame = new Quaternion();
  onEvent?: (e: JumpEvent) => void;
  /** moves the game into the destination system (called halfway through the tunnel) */
  onSwitch?: (system: string) => void;

  constructor(private eph: Ephemeris, private ship: Ship) {}

  get active(): boolean {
    return this.state !== 'idle';
  }

  /** Distance from the ship to the active system's gate (km). */
  gateDistance(): number {
    return gatePosition(this.eph, _g).distanceTo(this.ship.absPos(_a));
  }

  start(dest: string): boolean {
    if (this.active) return false;
    if (!SYSTEM_BY_ID[dest] || dest === this.eph.system.id) return false;
    if (this.gateDistance() > GATE.range) {
      this.message = 'Fly to the warp gate first';
      this.onEvent?.('denied');
      return false;
    }
    this.dest = dest;
    this.state = 'aligning';
    this.t = 0;
    this.seed = Math.random();
    this.ship.autopilot = true;
    this.ship.throttle = 0;
    this.onEvent?.('align');
    return true;
  }

  /** Calls the jump off while there is still time (before the ship commits to the portal). */
  abort(): boolean {
    if (this.state !== 'aligning' && this.state !== 'charging') return false;
    this.state = 'idle';
    this.ship.autopilot = false;
    this.ship.vel.set(0, 0, 0);
    this.onEvent?.('abort');
    return true;
  }

  update(dt: number): void {
    this.flash = Math.max(0, this.flash - dt * 1.6);
    this.shake = Math.max(0, this.shake - dt * 0.9);
    if (this.state === 'idle') {
      this.charge = Math.max(0, this.charge - dt * 0.4);
      this.open = Math.max(0, this.open - dt * 0.5);
      this.tunnel = 0;
      this.speed = 0;
      return;
    }
    this.t += dt;
    const sys = this.eph.system;
    const G = gatePosition(this.eph, _g);
    const Z = _z.copy(sys.gate.dir).normalize();
    gateQuaternion(sys, _q);
    const up = _up.set(0, 1, 0).applyQuaternion(_q);
    const pos = this.ship.absPos(_a);

    switch (this.state) {
      case 'aligning':
      case 'charging': {
        // slide onto the gate's axis, a little way in front of the portal, nose to the gate
        const A = _b.copy(G).addScaledVector(Z, -GATE.runUp);
        const off = A.sub(pos);
        const d = off.length();
        const step = Math.min(d, Math.max(d * (1 - Math.exp(-dt * 0.9)), Math.min(d, 0.05 * dt)), 8 * dt);
        if (d > 1e-9) pos.addScaledVector(off, step / d);
        this.ship.vel.copy(off).multiplyScalar(d > 1e-9 ? step / d / Math.max(dt, 1e-6) : 0);
        this.ship.setAbs(pos);
        const ang = this.ship.turnToward(Z, dt, 1.2, up);
        if (this.state === 'aligning') {
          if ((d < 0.03 && ang < 0.01) || this.t > 16) {
            this.state = 'charging';
            this.t = 0;
            this.onEvent?.('charge');
          }
        } else {
          const k = Math.min(1, this.t / CHARGE_TIME);
          this.charge = k * k * (3 - 2 * k);
          this.shake = Math.max(this.shake, this.charge * 0.35);
          if (k >= 1) {
            this.state = 'entering';
            this.t = 0;
            this.onEvent?.('enter');
          }
        }
        break;
      }
      case 'entering': {
        // the drive and the gate's field pull the ship in, ever faster
        const k = Math.min(1, this.t / ENTER_TIME);
        const along = -GATE.runUp * (1 - k * k * k);
        const A = _b.copy(G).addScaledVector(Z, along);
        this.ship.vel.copy(Z).multiplyScalar((3 * GATE.runUp * k * k) / ENTER_TIME);
        this.ship.setAbs(A);
        lookQuat(Z, up, _q2);
        this.ship.quat.slerp(_q2, 1 - Math.exp(-dt * 4));
        this.charge = 1;
        this.open = k * k;
        this.shake = Math.max(this.shake, 0.35 + 0.5 * k * k);
        this.tunnel = smoothstep(0.86, 1, k);
        if (k >= 1) {
          this.state = 'tunnel';
          this.t = 0;
          this.travel = 0;
          this.flash = 1;
          this.shake = 1;
          this.ship.quat.copy(_q2);
          this.tunnelFrame.copy(this.ship.quat);
          this.onEvent?.('tunnel');
        }
        break;
      }
      case 'tunnel': {
        const k = Math.min(1, this.t / TUNNEL_TIME);
        this.progress = k;
        this.tunnel = 1;
        this.charge = Math.max(0, 1 - this.t * 2);
        this.open = this.charge;
        // rush up to speed, hold, ease off before the exit
        this.speed = smoothstep(0, 0.2, k) * (1 - 0.6 * smoothstep(0.8, 1, k));
        this.travel += dt * (4 + 70 * this.speed);
        this.shake = Math.max(this.shake, 0.25 + 0.25 * this.speed);
        this.ship.vel.set(0, 0, 0);
        if (this.dest && this.t >= TUNNEL_TIME / 2 && this.eph.system.id !== this.dest) this.arriveAt(this.dest);
        if (k >= 1) {
          this.state = 'exiting';
          this.t = 0;
          this.flash = 1;
          this.shake = 0.9;
          this.onEvent?.('exit');
        }
        break;
      }
      case 'exiting': {
        const k = Math.min(1, this.t / EXIT_TIME);
        this.tunnel = 1 - smoothstep(0, 0.18, k);
        this.speed = 0;
        this.open = Math.max(0, 1 - k * 2);
        this.charge = this.open;
        // coasting out of the portal toward the star
        const out = EXIT_RUN * (1 - (1 - k) ** 3);
        this.ship.setAbs(_b.copy(G).addScaledVector(Z, -0.02 - out));
        this.ship.vel.copy(Z).multiplyScalar((-3 * EXIT_RUN * (1 - k) ** 2) / EXIT_TIME);
        if (k >= 1) {
          this.state = 'idle';
          this.dest = null;
          this.tunnel = 0;
          this.ship.autopilot = false;
          this.ship.vel.set(0, 0, 0);
          this.onEvent?.('arrive');
        }
        break;
      }
    }
  }

  /** Halfway through the tunnel: the game moves to the destination and the ship to its gate's mouth. */
  private arriveAt(dest: string): void {
    const before = _q2.copy(this.ship.quat);
    this.onSwitch?.(dest);
    const sys = this.eph.system;
    const G = gatePosition(this.eph, _g);
    const Z = _z.copy(sys.gate.dir).normalize();
    const up = _up.set(0, 1, 0).applyQuaternion(gateQuaternion(sys, _q));
    this.ship.frame = this.eph.star;
    this.ship.setAbs(_b.copy(G).addScaledVector(Z, -0.02));
    lookQuat(Z.clone().negate(), up, this.ship.quat);
    this.ship.updateEnvironment();
    // keep the tunnel where it was on screen: turn its frame with the ship
    const turn = _q.copy(this.ship.quat).multiply(before.invert());
    this.tunnelFrame.premultiply(turn);
  }
}

function smoothstep(a: number, b: number, x: number): number {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
}
