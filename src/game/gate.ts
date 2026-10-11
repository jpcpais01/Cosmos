import { Matrix4, Quaternion, Vector3 } from 'three';
import type { Ephemeris } from '../sim/ephemeris';
import type { StarSystem } from '../sim/systems';

/**
 * Warp gates: one at the edge of every star system, the only way to another star. The gate's ring
 * faces its own star; ships fly out through it and come out of the destination's gate heading in.
 * Sizes are in km (the ship is about 20 m long).
 */
export const GATE = {
  /** radius of the portal inside the ring */
  portal: 0.84,
  /** centre line of the main ring */
  ring: 1.1,
  /** outermost reach of the pylons */
  span: 1.95,
  /** in-system warp arrivals stop this far in front of the gate (star side) */
  arrival: 7,
  /** the gate panel opens within this distance */
  range: 60,
  /** a jump starts its run-up from this far in front of the portal */
  runUp: 2.6,
} as const;

const _m = new Matrix4();
const _x = new Vector3();
const _y = new Vector3();
const _z = new Vector3();

/** Position of a system's gate (default the active one), in that system's frame (km). */
export function gatePosition(eph: Ephemeris, out: Vector3, sys: StarSystem = eph.system): Vector3 {
  return out.copy(eph.get(sys.star).pos).addScaledVector(sys.gate.dir, sys.gate.distance);
}

/**
 * Orientation of a gate: local +Z points away from the star (the way ships leave), +Y is as close to
 * the system's orbital pole as it can be.
 */
export function gateQuaternion(sys: StarSystem, out = new Quaternion()): Quaternion {
  _z.copy(sys.gate.dir).normalize();
  _y.set(0, 1, 0).addScaledVector(_z, -_z.y);
  if (_y.lengthSq() < 1e-6) _y.set(1, 0, 0).addScaledVector(_z, -_z.x);
  _y.normalize();
  _x.crossVectors(_y, _z);
  return out.setFromRotationMatrix(_m.makeBasis(_x, _y, _z));
}

/** Where an in-system warp to the gate ends: straight in front of it on the star side. */
export function gateArrival(eph: Ephemeris, out: Vector3): Vector3 {
  return gatePosition(eph, out).addScaledVector(eph.system.gate.dir, -GATE.arrival);
}
