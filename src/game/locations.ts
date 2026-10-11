import { Quaternion, Vector3 } from 'three';
import type { Ephemeris } from '../sim/ephemeris';
import type { Ship } from '../ship/flight';
import type { ViewMode } from '../ship/cameraRig';
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
  /** camera view to switch to on arrival (keeps the current one when unset) */
  view?: ViewMode;
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

const dirTo = (eph: Ephemeris, from: string, to: string) => new Vector3().subVectors(eph.get(to).pos, eph.get(from).pos).normalize();
/** a body's spin axis (world) */
const poleOf = (eph: Ephemeris, id: string) => {
  const e = eph.get(id).rot.elements;
  return new Vector3(e[6], e[7], e[8]).normalize();
};
/** unit vector perpendicular to `v`, in the plane of `v` and `hint` */
function perpTo(v: Vector3, hint: Vector3): Vector3 {
  const p = hint.clone().addScaledVector(v, -hint.dot(v));
  if (p.lengthSq() < 1e-10) p.set(0, 0, 1).addScaledVector(v, -v.z);
  return p.normalize();
}
/** `a` turned by `deg` toward the unit vector `b` (which must be perpendicular to it) */
const turn = (a: Vector3, b: Vector3, deg: number) => a.clone().multiplyScalar(Math.cos(deg * DEG)).addScaledVector(b, Math.sin(deg * DEG)).normalize();
/**
 * Puts the ship at `abs` (km, world) facing `target`, with `up` as the up hint. `lower` (deg) points the nose
 * that much below the target, so in the cockpit it sits higher in the view, clear of the dashboard.
 */
function aimShip(ship: Ship, eph: Ephemeris, frame: string, abs: Vector3, target: Vector3, up: Vector3, lower = 0): void {
  let dir = new Vector3().subVectors(target, abs).normalize();
  if (lower) dir = turn(dir, perpTo(dir, up).negate(), lower);
  setShip(ship, eph, frame, abs, lookQuat(dir, up));
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
  // --- more views, each at a moment chosen for its light
  {
    id: 'eclipse-2027',
    name: 'Total Eclipse · 2 Aug 2027',
    description: 'The Moon\'s shadow crossing Egypt during the longest total eclipse of the century, seen from 18,000 km above the sunlit Earth.',
    epoch: Date.UTC(2027, 7, 2, 10, 7, 0),
    view: 'cockpit',
    place(eph, ship) {
      const E = eph.get('earth');
      const M = eph.get('moon');
      // straight above the point where the shadow axis (Sun -> Moon) meets the Earth, so the dark spot is mid-disc
      const axis = new Vector3().subVectors(M.pos, eph.get('sun').pos).normalize();
      const along = new Vector3().subVectors(E.pos, M.pos).dot(axis);
      const closest = new Vector3().copy(M.pos).addScaledVector(axis, along).sub(E.pos);
      const miss = closest.length();
      // the sunward point where the axis enters the Earth (or the nearest point, should it miss)
      const u = closest.addScaledVector(axis, -Math.sqrt(Math.max(0, E.def.radius ** 2 - miss * miss))).normalize();
      const abs = new Vector3().copy(E.pos).addScaledVector(u, E.def.radius + 18_000);
      aimShip(ship, eph, 'earth', abs, E.pos, poleOf(eph, 'earth'), 9);
    },
  },
  {
    id: 'earth-and-moon',
    name: 'Half Moon, Half Earth',
    description: 'From just beyond the Moon at last quarter: the Moon half lit, with a half-lit Earth beside it 400,000 km away.',
    epoch: Date.UTC(2026, 2, 10, 12, 0, 0),
    view: 'cockpit',
    place(eph, ship) {
      const M = eph.get('moon');
      const u = dirTo(eph, 'earth', 'moon');
      const side = perpTo(u, dirTo(eph, 'moon', 'sun'));
      // out past the Moon and a little to the side, so the Earth peeks out beside it
      const abs = new Vector3().copy(M.pos).addScaledVector(u, 11_000).addScaledVector(side, -3_000);
      const toM = new Vector3().subVectors(M.pos, abs).normalize();
      const toE = new Vector3().subVectors(eph.get('earth').pos, abs).normalize();
      const look = toM.multiplyScalar(0.6).add(toE.multiplyScalar(0.4)).normalize();
      aimShip(ship, eph, 'moon', abs, look.add(abs), poleOf(eph, 'earth'), 7);
    },
  },
  {
    id: 'venus-crescent',
    name: 'Venus Crescent',
    description: 'Hanging off the night side of Venus, its thick clouds lit as a slender sunlit crescent.',
    epoch: Date.UTC(2026, 9, 11, 12, 0, 0),
    view: 'cockpit',
    place(eph, ship) {
      const V = eph.get('venus');
      const pole = poleOf(eph, 'venus');
      const s = dirTo(eph, 'venus', 'sun');
      // swing round toward the night side in the equator plane, so the Sun sits off to one side
      const side = new Vector3().crossVectors(pole, s).normalize();
      const u = turn(s, side, 135);
      const abs = new Vector3().copy(V.pos).addScaledVector(u, V.def.radius * 3.6);
      // look a little away from the Sun to keep its glare out of the frame
      const toV = new Vector3().subVectors(V.pos, abs).normalize();
      const fwd = turn(toV, perpTo(toV, s).negate(), 14);
      aimShip(ship, eph, 'venus', abs, fwd.add(abs), pole, 6);
    },
  },
  {
    id: 'mercury-sunrise',
    name: 'Dawn on Mercury',
    description: '150 km above Mercury just after sunrise, the low Sun behind you casting long shadows across the craters.',
    epoch: Date.UTC(2026, 9, 11, 12, 0, 0),
    view: 'cockpit',
    place(eph, ship) {
      const H = eph.get('mercury');
      const s = dirTo(eph, 'mercury', 'sun');
      const h = 150;
      const dip = Math.acos(H.def.radius / (H.def.radius + h));
      // a spot where the Sun stands just above the horizon
      // the Sun 10 degrees up, so the ground below is lit at a low angle
      const u = turn(s, perpTo(s, poleOf(eph, 'mercury')), 80);
      const abs = new Vector3().copy(H.pos).addScaledVector(u, H.def.radius + h);
      // look away from the Sun and down past the horizon, so the lit, long-shadowed ground fills the view
      const fwd = horizonLook(u, s.clone().negate(), -dip - 9 * DEG, new Vector3());
      setShip(ship, eph, 'mercury', abs, lookQuat(fwd, u));
    },
  },
  {
    id: 'phobos-mars',
    name: 'Phobos over Mars',
    description: 'Flying beside the potato-shaped moon Phobos, 6,000 km above the red planet\'s sunlit face.',
    epoch: Date.UTC(2026, 9, 11, 8, 50, 0),
    view: 'chase',
    place(eph, ship) {
      const P = eph.get('phobos');
      const M = eph.get('mars');
      const out = dirTo(eph, 'mars', 'phobos');
      const side = perpTo(out, dirTo(eph, 'mars', 'sun'));
      const abs = new Vector3().copy(P.pos).addScaledVector(out, 30).addScaledVector(side, 22);
      // look at Mars, swung a little toward Phobos so both share the frame
      const target = new Vector3().copy(M.pos).lerp(P.pos, 0.35);
      aimShip(ship, eph, 'phobos', abs, target, poleOf(eph, 'mars'));
    },
  },
  {
    id: 'io-shadow',
    name: 'Io\'s Shadow on Jupiter',
    description: 'The black shadow of Io on Jupiter\'s cloud tops as the moon passes between Jupiter and the Sun (2 Oct 2026).',
    epoch: Date.UTC(2026, 9, 2, 2, 50, 0),
    view: 'cockpit',
    place(eph, ship) {
      const J = eph.get('jupiter');
      const s = dirTo(eph, 'jupiter', 'sun');
      const u = turn(s, perpTo(s, poleOf(eph, 'jupiter')), 12);
      const abs = new Vector3().copy(J.pos).addScaledVector(u, 260_000);
      aimShip(ship, eph, 'jupiter', abs, J.pos, poleOf(eph, 'jupiter'), 8);
    },
  },
  {
    id: 'saturn-eclipse',
    name: 'Saturn Eclipsing the Sun',
    description: 'Deep in Saturn\'s shadow with the Sun hidden behind the planet, its rings and night side lit from behind, after Cassini\'s famous view.',
    epoch: Date.UTC(2026, 9, 11, 12, 0, 0),
    view: 'cockpit',
    place(eph, ship) {
      const S = eph.get('saturn');
      const z = poleOf(eph, 'saturn');
      const s = dirTo(eph, 'saturn', 'sun');
      const anti = s.clone().negate();
      // behind Saturn, just above the ring plane, so the planet covers the Sun
      const u = turn(anti, perpTo(anti, z), 5);
      const abs = new Vector3().copy(S.pos).addScaledVector(u, 520_000);
      aimShip(ship, eph, 'saturn', abs, S.pos, z, 8);
    },
  },
  {
    id: 'titan-saturn',
    name: 'Titan before Saturn',
    description: 'Behind the hazy orange moon Titan, with ringed Saturn hanging in the sky beyond it.',
    epoch: Date.UTC(2026, 9, 9, 20, 0, 0),
    view: 'chase',
    place(eph, ship) {
      const T = eph.get('titan');
      const S = eph.get('saturn');
      const out = dirTo(eph, 'saturn', 'titan');
      const side = perpTo(out, dirTo(eph, 'titan', 'sun'));
      const abs = new Vector3().copy(T.pos).addScaledVector(out, T.def.radius * 6).addScaledVector(side, T.def.radius * 2.4);
      const target = new Vector3().copy(S.pos).lerp(T.pos, 0.82);
      aimShip(ship, eph, 'titan', abs, target, poleOf(eph, 'saturn'));
    },
  },
  {
    id: 'miranda-uranus',
    name: 'Uranus from Miranda',
    description: 'Skimming the patchwork cliffs of Miranda, with the pale, half-lit globe of Uranus rising over the horizon.',
    epoch: Date.UTC(2026, 9, 11, 19, 30, 0),
    view: 'chase',
    place(eph, ship) {
      const Mi = eph.get('miranda');
      const toU = dirTo(eph, 'miranda', 'uranus');
      const h = 20;
      const dip = Math.acos(Mi.def.radius / (Mi.def.radius + h));
      // over sunlit ground, with Uranus 14 degrees above the horizon
      const u = turn(toU, perpTo(toU, dirTo(eph, 'miranda', 'sun')), 90 + dip / DEG - 14);
      const abs = new Vector3().copy(Mi.pos).addScaledVector(u, Mi.def.radius + h);
      const dir = new Vector3().subVectors(eph.get('uranus').pos, abs).normalize();
      const fwd = horizonLook(u, dir, -dip + 6 * DEG, new Vector3());
      setShip(ship, eph, 'miranda', abs, lookQuat(fwd, u));
    },
  },
  {
    id: 'pluto-charon',
    name: 'Pluto and Charon',
    description: 'Beside Charon at the edge of the planets, looking across 19,600 km of space to Pluto, with the Sun only a bright star behind you.',
    epoch: Date.UTC(2026, 9, 5, 13, 0, 0),
    view: 'chase',
    place(eph, ship) {
      const C = eph.get('charon');
      const P = eph.get('pluto');
      const out = dirTo(eph, 'pluto', 'charon');
      // sideways across the view (Pluto's pole is up), so Charon sits beside the ship rather than under it
      const side = new Vector3().crossVectors(out, poleOf(eph, 'pluto')).normalize();
      const abs = new Vector3().copy(C.pos).addScaledVector(out, C.def.radius * 4.5).addScaledVector(side, C.def.radius * 5);
      const target = new Vector3().copy(P.pos).lerp(C.pos, 0.6);
      aimShip(ship, eph, 'charon', abs, target, poleOf(eph, 'pluto'));
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
  /** where it was saved, e.g. "Io" or "Jupiter system" */
  place?: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtEpoch(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

function readStored(): StoredLocation[] {
  try {
    const list = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as unknown;
    return Array.isArray(list) ? (list as StoredLocation[]) : [];
  } catch {
    return [];
  }
}

function writeStored(list: StoredLocation[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* storage full or unavailable */
  }
}

export function loadCustomLocations(): SavedLocation[] {
  return readStored().filter((s) => s && typeof s.frame === 'string').map(fromStored);
}

function fromStored(s: StoredLocation): SavedLocation {
  return {
    id: s.id,
    name: s.name,
    description: `${s.place ? `${s.place} · ` : ''}${fmtEpoch(s.epoch)}`,
    epoch: s.epoch,
    custom: true,
    place(eph, ship) {
      const abs = new Vector3(...s.rel).add(eph.get(s.frame).pos);
      setShip(ship, eph, s.frame, abs, new Quaternion(...s.quat));
    },
  };
}

/** Saves where the ship is, which way it faces and the sim time. An empty name is made from the place. */
export function saveCustomLocation(name: string, epoch: number, ship: Ship, place?: string): SavedLocation {
  const list = readStored();
  if (!name) {
    const base = place || 'My location';
    const taken = new Set(list.map((l) => l.name));
    name = base;
    for (let i = 2; taken.has(name); i++) name = `${base} ${i}`;
  }
  const s: StoredLocation = {
    id: `custom-${Date.now()}`,
    name,
    epoch,
    frame: ship.frame.def.id,
    rel: [ship.rel.x, ship.rel.y, ship.rel.z],
    quat: [ship.quat.x, ship.quat.y, ship.quat.z, ship.quat.w],
    place,
  };
  list.push(s);
  writeStored(list);
  return fromStored(s);
}

export function renameCustomLocation(id: string, name: string): void {
  const list = readStored();
  const l = list.find((x) => x.id === id);
  if (!l || !name) return;
  l.name = name;
  writeStored(list);
}

export function deleteCustomLocation(id: string): void {
  writeStored(readStored().filter((l) => l.id !== id));
}
