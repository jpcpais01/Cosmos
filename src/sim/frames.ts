import { Matrix3, Vector3 } from 'three';
import { DEG, OBLIQUITY_J2000 } from './constants';

/**
 * World frame used everywhere in the game: ecliptic J2000 rotated so that
 *   X = vernal equinox, Y = north ecliptic pole, Z = -ecliptic Y.
 * (Three.js is Y-up, so the ecliptic plane is the XZ plane.)
 */
const ce = Math.cos(OBLIQUITY_J2000);
const se = Math.sin(OBLIQUITY_J2000);

/** Equatorial J2000 (EQJ, as used by astronomy-engine) -> world. */
export function eqjToWorld(x: number, y: number, z: number, out: Vector3): Vector3 {
  const ey = ce * y + se * z;
  const ez = -se * y + ce * z;
  return out.set(x, ez, -ey);
}

/** Ecliptic J2000 -> world. */
export function eclToWorld(x: number, y: number, z: number, out: Vector3): Vector3 {
  return out.set(x, z, -y);
}

/** World -> ecliptic J2000 (x, y, z). */
export function worldToEcl(v: Vector3): [number, number, number] {
  return [v.x, -v.z, v.y];
}

const _n = new Vector3();
const _zb = new Vector3();
const _xb = new Vector3();
const _yb = new Vector3();
const _t = new Vector3();

/**
 * Builds the body-fixed -> world rotation from IAU pole (right ascension in hours, declination in degrees)
 * and prime meridian angle W (degrees). Body-fixed frame: +X = longitude 0, +Y = 90E, +Z = north pole.
 */
export function bodyToWorldMatrix(raHours: number, decDeg: number, spinDeg: number, out: Matrix3): Matrix3 {
  const a = raHours * 15 * DEG;
  const d = decDeg * DEG;
  const w = spinDeg * DEG;
  eqjToWorld(Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d), _zb);
  eqjToWorld(-Math.sin(a), Math.cos(a), 0, _n);
  _t.crossVectors(_zb, _n);
  _xb.copy(_n).multiplyScalar(Math.cos(w)).addScaledVector(_t, Math.sin(w));
  _yb.crossVectors(_zb, _xb);
  return out.set(_xb.x, _yb.x, _zb.x, _xb.y, _yb.y, _zb.y, _xb.z, _yb.z, _zb.z);
}

/** Body-fixed -> world rotation from explicit axes (columns). */
export function matrixFromAxes(x: Vector3, y: Vector3, z: Vector3, out: Matrix3): Matrix3 {
  return out.set(x.x, y.x, z.x, x.y, y.y, z.y, x.z, y.z, z.z);
}

/** Converts planetographic latitude/longitude (degrees, east positive) + altitude to a body-fixed vector (km). */
export function latLonToBody(latDeg: number, lonDeg: number, radius: number, out: Vector3): Vector3 {
  const la = latDeg * DEG;
  const lo = lonDeg * DEG;
  return out.set(Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)).multiplyScalar(radius);
}
