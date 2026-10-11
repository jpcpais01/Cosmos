import { Matrix3, Vector3 } from 'three';
import { AU_KM, DEG } from './constants';
import { eqjToWorld } from './frames';
import { K385_STAR } from './kepler385';
import { worldToGalactic } from './galactic';

/** Parsec in light years. */
export const PC_LY = 3.261564;

/**
 * A star system the ship can be in. Each system has its own frame, centred on its star, so positions
 * stay small and precise however far apart the stars are. The Solar System's frame is the game's
 * ecliptic J2000 world frame; other systems have their planets' orbital plane as XZ, like the
 * ecliptic, and `toEcliptic` says how that frame sits on the sky (the sky and the galaxy map use it).
 */
export interface StarSystem {
  id: string;
  name: string;
  /** body id of the star */
  star: string;
  /** position relative to the Sun in heliocentric galactic coordinates (pc): x to the galactic centre,
   * y along the Sun's orbit, z to the north galactic pole */
  galactic: Vector3;
  /** distance from the Sun (light years) */
  distanceLy: number;
  constellation: string;
  /** rotates this system's frame onto the ecliptic J2000 world axes */
  toEcliptic: Matrix3;
  /** the warp gate: direction from the star (system frame) and distance (km) */
  gate: { dir: Vector3; distance: number };
  /** exposure stops adapting to brighter light closer to the star than this (AU from a Sun-like star) */
  exposureFloorAU: number;
  /** bright-star catalogue for this system's sky (public/data) */
  stars: string;
  blurb: string;
}

/** Unit vector in heliocentric galactic coordinates from galactic longitude and latitude (deg). */
export function galacticDir(l: number, b: number): Vector3 {
  return new Vector3(Math.cos(b * DEG) * Math.cos(l * DEG), Math.cos(b * DEG) * Math.sin(l * DEG), Math.sin(b * DEG));
}

/** Ecliptic-world direction of an RA/Dec (deg). */
function skyDir(ra: number, dec: number): Vector3 {
  const r = ra * DEG, d = dec * DEG;
  return eqjToWorld(Math.cos(d) * Math.cos(r), Math.cos(d) * Math.sin(r), Math.sin(d), new Vector3());
}

const W2G = worldToGalactic();
const G2W = W2G.clone().transpose();

/**
 * Kepler-385's frame. Its planets transit, so we see their orbits edge-on: the Sun lies in the orbital
 * plane (to within each orbit's small tilt). Local +X points at the Sun. Which way the orbital pole
 * points around that line is not measured; it is taken as close to galactic north as it can be.
 */
function kepler385Frame(): { toEcliptic: Matrix3; galactic: Vector3 } {
  const u = skyDir(K385_STAR.ra, K385_STAR.dec); // Sun -> Kepler-385, ecliptic world
  const toSun = u.clone().negate();
  const ngp = new Vector3(0, 0, 1).applyMatrix3(G2W);
  const pole = ngp.clone().addScaledVector(toSun, -ngp.dot(toSun)).normalize();
  const z = new Vector3().crossVectors(toSun, pole);
  const m = new Matrix3().set(toSun.x, pole.x, z.x, toSun.y, pole.y, z.y, toSun.z, pole.z, z.z);
  const galactic = u.clone().applyMatrix3(W2G).multiplyScalar(K385_STAR.distancePc);
  return { toEcliptic: m, galactic };
}

const k385 = kepler385Frame();
const SUN_TO_K385 = skyDir(K385_STAR.ra, K385_STAR.dec);

export const SYSTEMS: StarSystem[] = [
  {
    id: 'sol',
    name: 'Solar System',
    star: 'sun',
    galactic: new Vector3(0, 0, 0),
    distanceLy: 0,
    constellation: '',
    toEcliptic: new Matrix3(),
    // beyond Neptune, in the direction of Kepler-385 (Cygnus), so the gate faces where it leads
    gate: { dir: SUN_TO_K385.clone(), distance: 32 * AU_KM },
    exposureFloorAU: 0.3,
    stars: 'data/stars.bin',
    blurb: 'Eight planets, five dwarf planets and hundreds of moons around a G2 star.',
  },
  {
    id: 'kepler385',
    name: 'Kepler-385',
    star: 'kepler385',
    galactic: k385.galactic,
    distanceLy: K385_STAR.distancePc * PC_LY,
    constellation: 'Cygnus',
    toEcliptic: k385.toEcliptic,
    // out past the seven planets (all inside 0.4 AU), on the side facing the Sun
    gate: { dir: new Vector3(1, 0, 0), distance: 1.0 * AU_KM },
    exposureFloorAU: 0.035,
    stars: 'data/stars_kepler385_v2.bin',
    blurb: 'Seven planets bigger than Earth and smaller than Neptune, all closer to their star than Mercury is to the Sun.',
  },
];

export const SYSTEM_BY_ID: Record<string, StarSystem> = Object.fromEntries(SYSTEMS.map((s) => [s.id, s]));

/** Distance between two systems (light years). */
export function lightYearsBetween(a: StarSystem, b: StarSystem): number {
  return a.galactic.distanceTo(b.galactic) * PC_LY;
}


