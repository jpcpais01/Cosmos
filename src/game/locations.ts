import { Quaternion, Vector3 } from 'three';
import type { Ephemeris } from '../sim/ephemeris';
import type { Ship } from '../ship/flight';
import { lookQuat } from '../ship/flight';
import { DEG } from '../sim/constants';
import { latLonToBody } from '../sim/frames';

export interface SavedLocation {
  id: string;
  name: string;
  description: string;
  /** UTC ms to jump to, or null for "keep current time" */
  epoch: number | null;
  /** places the ship; called after the ephemeris was updated to the epoch */
  place(eph: Ephemeris, ship: Ship): void;
  custom?: boolean;
}

const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _d = new Vector3();

function setShip(ship: Ship, eph: Ephemeris, frame: string, abs: Vector3, q: Quaternion): void {
  ship.frame = eph.get(frame);
  ship.setAbs(abs);
  ship.vel.set(0, 0, 0);
  ship.angVel.set(0, 0, 0);
  ship.throttle = 0;
  ship.quat.copy(q);
}

/** Direction on the local horizontal plane toward `dir`, tilted by `elev` (rad) above the horizon. */
function horizonLook(up: Vector3, dir: Vector3, elev: number, out: Vector3): Vector3 {
  const h = _d.copy(dir).addScaledVector(up, -dir.dot(up));
  if (h.lengthSq() < 1e-12) h.set(1, 0, 0).addScaledVector(up, -up.x);
  h.normalize();
  return out.copy(h).multiplyScalar(Math.cos(elev)).addScaledVector(up, Math.sin(elev)).normalize();
}

function elevation(up: Vector3, dir: Vector3): number {
  return Math.asin(Math.max(-1, Math.min(1, dir.dot(up))));
}

export const DEFAULT_LOCATIONS: SavedLocation[] = [
  {
    id: 'earth-orbit',
    name: 'Low Earth Orbit',
    description: '420 km up at ISS altitude, the blue limb and sunlit clouds below, the Sun glinting off the ocean.',
    epoch: null,
    place(eph, ship) {
      const E = eph.get('earth');
      const R = E.def.radius;
      const h = 420;
      const s = _a.subVectors(eph.get('sun').pos, E.pos).normalize();
      const pole = _b.set(E.rot.elements[6], E.rot.elements[7], E.rot.elements[8]);
      // a point where the Sun stands ~30 degrees above the horizon, in the northern hemisphere
      const w = pole.addScaledVector(s, -pole.dot(s)).normalize();
      const off = 60 * DEG;
      const u = new Vector3().copy(s).multiplyScalar(Math.cos(off)).addScaledVector(w, Math.sin(off)).normalize();
      const abs = new Vector3().copy(E.pos).addScaledVector(u, R + h);
      // look along the horizon, 65 degrees away from the Sun's azimuth, so the glint and the limb are both in view
      const sunH = _c.copy(s).addScaledVector(u, -s.dot(u)).normalize();
      const side = _d.crossVectors(u, sunH).normalize();
      const az = 65 * DEG;
      const dirH = new Vector3().copy(sunH).multiplyScalar(Math.cos(az)).addScaledVector(side, Math.sin(az));
      const dip = Math.acos(R / (R + h));
      const fwd = horizonLook(u, dirH, -dip - 8 * DEG, new Vector3());
      setShip(ship, eph, 'earth', abs, lookQuat(fwd, u));
    },
  },
  {
    id: 'europe-jupiter',
    name: 'Over Europe · Jupiter Setting',
    description: '400 km above the Alps before dawn: city lights below, Jupiter bright over the western limb (10 Jan 2026, the night of opposition).',
    epoch: Date.UTC(2026, 0, 10, 6, 0, 0),
    place(eph, ship) {
      const E = eph.get('earth');
      const R = E.def.radius;
      const h = 400;
      const local = latLonToBody(46.2, 7.5, 1, new Vector3());
      const u = local.applyMatrix3(E.rot).normalize();
      const abs = new Vector3().copy(E.pos).addScaledVector(u, R + h);
      const j = _a.subVectors(eph.get('jupiter').pos, abs).normalize();
      const dip = Math.acos(R / (R + h));
      const ej = elevation(u, j);
      // keep the limb just above the dashboard and Jupiter high in the frame
      const look = Math.max(-dip + 9 * DEG, ej - 28 * DEG);
      const fwd = horizonLook(u, j, look, new Vector3());
      setShip(ship, eph, 'earth', abs, lookQuat(fwd, u));
    },
  },
  {
    id: 'earthrise',
    name: 'Earthrise over the Moon',
    description: '110 km above the lunar surface as a half-lit Earth climbs over the horizon, Apollo 8 style.',
    epoch: Date.UTC(2025, 11, 27, 19, 0, 0),
    place(eph, ship) {
      const M = eph.get('moon');
      const R = M.def.radius;
      const h = 110;
      const e = _a.subVectors(eph.get('earth').pos, M.pos).normalize();
      const s0 = _b.subVectors(eph.get('sun').pos, M.pos).normalize();
      const s = _c.copy(s0).addScaledVector(e, -s0.dot(e)).normalize();
      const n = new Vector3().crossVectors(e, s).normalize();
      const dip = Math.acos(R / (R + h));
      // Earth just above the horizon, the Sun 22 degrees up off to the side: long shadows on the ground
      const a = Math.sin(-dip + 3 * DEG);
      const b = Math.sin(22 * DEG);
      const c = Math.sqrt(Math.max(0, 1 - a * a - b * b));
      const u = new Vector3().copy(e).multiplyScalar(a).addScaledVector(s, b).addScaledVector(n, c).normalize();
      const abs = new Vector3().copy(M.pos).addScaledVector(u, R + h);
      const toE = _d.subVectors(eph.get('earth').pos, abs).normalize();
      const fwd = horizonLook(u, toE, elevation(u, toE) - 7 * DEG, new Vector3());
      setShip(ship, eph, 'moon', abs, lookQuat(fwd, u));
    },
  },
  {
    id: 'io-jupiter',
    name: 'Io · Jupiter Rising',
    description: 'Skimming volcanic Io with Jupiter filling the sky behind it.',
    epoch: null,
    place(eph, ship) {
      const I = eph.get('io');
      const J = eph.get('jupiter');
      const j = _a.subVectors(J.pos, I.pos).normalize();
      const s = _b.subVectors(eph.get('sun').pos, I.pos).normalize();
      const side = _c.copy(s).addScaledVector(j, -s.dot(j));
      if (side.lengthSq() < 1e-6) side.set(0, 1, 0);
      side.normalize();
      const off = new Vector3().copy(j).multiplyScalar(-0.62).addScaledVector(side, 0.72).add(new Vector3(0, 0.22, 0)).normalize();
      const abs = new Vector3().copy(I.pos).addScaledVector(off, I.def.radius * 3.0);
      const toI = new Vector3().subVectors(I.pos, abs).normalize();
      const toJ = _d.subVectors(J.pos, abs).normalize();
      const fwd = toI.multiplyScalar(0.42).addScaledVector(toJ, 0.58).normalize();
      setShip(ship, eph, 'io', abs, lookQuat(fwd, new Vector3(0, 1, 0)));
    },
  },
  {
    id: 'saturn-rings',
    name: 'Saturn · Above the Rings',
    description: 'Hovering above the sunlit rings in June 2017, when they were tilted wide open toward the Sun.',
    epoch: Date.UTC(2017, 5, 15, 0, 0, 0),
    place(eph, ship) {
      const S = eph.get('saturn');
      const e = S.rot.elements;
      const z = new Vector3(e[6], e[7], e[8]);
      const s = _a.subVectors(eph.get('sun').pos, S.pos).normalize();
      const sunSide = Math.sign(s.dot(z)) || 1;
      const sp = _b.copy(s).addScaledVector(z, -s.dot(z)).normalize();
      const perp = _c.crossVectors(z, sp).normalize();
      const az = 38 * DEG;
      const el = 11 * DEG * sunSide;
      const dir = new Vector3().copy(sp).multiplyScalar(Math.cos(az)).addScaledVector(perp, Math.sin(az));
      dir.multiplyScalar(Math.cos(el)).addScaledVector(z, Math.sin(el)).normalize();
      const abs = new Vector3().copy(S.pos).addScaledVector(dir, 330_000);
      const toS = _d.subVectors(S.pos, abs).normalize();
      const fwd = toS.clone().addScaledVector(perp, -0.12).normalize();
      setShip(ship, eph, 'saturn', abs, lookQuat(fwd, z.multiplyScalar(sunSide)));
    },
  },
];

const STORAGE_KEY = 'cosmos.locations.v1';

interface StoredLocation {
  id: string;
  name: string;
  epoch: number;
  frame: string;
  rel: [number, number, number];
  quat: [number, number, number, number];
}

export function loadCustomLocations(): SavedLocation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return (JSON.parse(raw) as StoredLocation[]).map(fromStored);
  } catch {
    return [];
  }
}

function fromStored(s: StoredLocation): SavedLocation {
  return {
    id: s.id,
    name: s.name,
    description: `Saved ${new Date(s.epoch).toUTCString()}`,
    epoch: s.epoch,
    custom: true,
    place(eph, ship) {
      const abs = new Vector3(...s.rel).add(eph.get(s.frame).pos);
      setShip(ship, eph, s.frame, abs, new Quaternion(...s.quat));
    },
  };
}

export function saveCustomLocation(name: string, epoch: number, ship: Ship): SavedLocation {
  const list = (() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as StoredLocation[];
    } catch {
      return [];
    }
  })();
  const s: StoredLocation = {
    id: `custom-${Date.now()}`,
    name,
    epoch,
    frame: ship.frame.def.id,
    rel: [ship.rel.x, ship.rel.y, ship.rel.z],
    quat: [ship.quat.x, ship.quat.y, ship.quat.z, ship.quat.w],
  };
  list.push(s);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable */
  }
  return fromStored(s);
}

export function deleteCustomLocation(id: string): void {
  try {
    const list = (JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as StoredLocation[]).filter((l) => l.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}
