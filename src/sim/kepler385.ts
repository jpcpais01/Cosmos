/**
 * Kepler-385, a seven-planet system about 4,940 light years away in Cygnus.
 *
 * Measured (NASA Exoplanet Archive; Lissauer et al. 2024, PSJ 5, 152):
 * - star: Teff 5,835 K, radius 1.09 Suns, mass 0.99 Suns (Gaia-revised values used by Lissauer et al.);
 *   luminosity follows from those, 1.24 Suns. Distance 1,516 pc (Gaia DR3).
 * - planets: orbital periods, radii, transit times (Kepler KOI cumulative table, epochs in BJD) and
 *   impact parameters. b, c and d are confirmed planets; KOI-2433.04, .06, .07 and .08 are candidates
 *   from the 2024 catalogue that made this a seven-planet system.
 *
 * Derived: orbit sizes (Kepler's third law), how far each orbit tilts from our line of sight (impact
 * parameter), equilibrium temperatures and the starlight each planet gets.
 *
 * Inferred (nobody has measured these): orbits are taken as circular and coplanar apart from those
 * tilts; masses of b and c are transit-timing estimates (Hadden & Lithwick 2017), the rest come from
 * the Chen & Kipping (2017) mass-radius relation (rocky composition below 1.5 Earth radii); the five
 * inner planets are taken to be tidally locked; d and .07 get an assumed day length; surfaces and
 * colours are drawn to suit each planet's size and temperature (tools/build_exoplanets.py).
 */
import type { AtmosphereDef, BodyDef } from './bodies';

const R_EARTH = 6371.0;
const R_SUN = 695_700;
const GM_SUN = 1.32712440018e11;
const GM_EARTH = 398_600.435;
const AU = 149_597_870.7;
/** Julian date -> UTC ms (BJD vs UTC differs by about a minute, far below what matters here) */
const jd = (d: number) => (d - 2440587.5) * 86_400_000;
const BKJD = 2454833;

export const K385_STAR = {
  teff: 5835,
  radius: 1.09 * R_SUN,
  mass: 0.99,
  luminosity: 1.09 * 1.09 * (5835 / 5772) ** 4,
  distancePc: 1516,
  ra: 294.3385109,
  dec: 50.3365178,
};

interface Planet {
  id: string;
  name: string;
  period: number;
  /** transit time, JD */
  t0: number;
  radiusE: number;
  massE: number;
  impact: number;
  albedo: number;
  color: [number, number, number];
  shading: BodyDef['shading'];
  rotation: BodyDef['rotation'];
  spin?: BodyDef['spin'];
  atmosphere?: AtmosphereDef;
  status: string;
  look: string;
}

/** Sub-Neptune haze: hydrogen Rayleigh scattering with a deeper scale height than the ice giants. */
const hydrogen = (tint: [number, number, number], h: number): AtmosphereDef => ({
  height: h * 6, rayleigh: [0.6e-4 * 28 / h, 1.45e-4 * 28 / h, 3.3e-4 * 28 / h], rayleighH: h,
  mie: [tint[0] * 0.5e-4 * 28 / h, tint[1] * 0.5e-4 * 28 / h, tint[2] * 0.5e-4 * 28 / h],
  mieAbsorb: 1.15, mieH: h, mieG: 0.7, intensity: 1.0,
});

const PLANETS: Planet[] = [
  {
    id: 'koi2433-08', name: 'KOI-2433.08', period: 3.37376, t0: 2455802.374903, radiusE: 1.206, massE: 2.0, impact: 0.12,
    albedo: 0.1, color: [0.3, 0.2, 0.15], shading: 'lava', rotation: 'synchronous',
    status: 'Candidate (Lissauer et al. 2024)',
    look: 'A rocky world so close that bare rock under the star reaches about 1,900 K: a magma ocean covers most of the day side, which always faces the star.',
  },
  {
    id: 'koi2433-06', name: 'KOI-2433.06', period: 6.06325, t0: BKJD + 136.17607, radiusE: 1.441, massE: 3.9, impact: 0.02,
    albedo: 0.12, color: [0.32, 0.27, 0.23], shading: 'lava', rotation: 'synchronous',
    status: 'Candidate (Lissauer et al. 2024)',
    look: 'Scorched, dark rock with a lake of magma under the star, where the ground passes 1,500 K.',
  },
  {
    id: 'kepler385b', name: 'Kepler-385 b', period: 10.04381, t0: BKJD + 353.61859, radiusE: 2.313, massE: 12.8, impact: 0.953,
    albedo: 0.25, color: [0.1, 0.17, 0.36], shading: 'gas', rotation: 'synchronous', atmosphere: hydrogen([0.6, 0.8, 1.0], 100),
    status: 'Confirmed (Rowe et al. 2014)',
    look: 'A hot sub-Neptune: a deep hydrogen atmosphere over clouds of salts, blue like the hot Jupiter HD 189733 b.',
  },
  {
    id: 'kepler385c', name: 'Kepler-385 c', period: 15.16213, t0: BKJD + 144.474, radiusE: 2.406, massE: 13.2, impact: 0.959,
    albedo: 0.35, color: [0.28, 0.33, 0.4], shading: 'gas', rotation: 'synchronous', atmosphere: hydrogen([0.8, 0.85, 0.95], 90),
    status: 'Confirmed (Rowe et al. 2014)',
    look: 'A sub-Neptune with thicker salt and sulfide clouds in steel-blue belts.',
  },
  {
    id: 'koi2433-04', name: 'KOI-2433.04', period: 27.90426, t0: BKJD + 154.9434, radiusE: 1.903, massE: 4.3, impact: 0.854,
    albedo: 0.6, color: [0.68, 0.62, 0.48], shading: 'cloudy', rotation: 'synchronous',
    atmosphere: {
      height: 160, rayleigh: [3.0e-3, 4.6e-3, 7.4e-3], rayleighH: 18,
      mie: [8e-3, 7.5e-3, 5.5e-3], mieAbsorb: 1.12, mieH: 14, mieG: 0.75, intensity: 1.0,
    },
    status: 'Candidate (Lissauer et al. 2024)',
    look: 'Sits in the size range between rocky planets and sub-Neptunes; drawn as a world wrapped in a closed, pale cloud deck.',
  },
  {
    id: 'kepler385d', name: 'Kepler-385 d', period: 56.41581, t0: BKJD + 163.128, radiusE: 2.423, massE: 6.5, impact: 0.908,
    albedo: 0.4, color: [0.55, 0.42, 0.27], shading: 'gas', rotation: 'spin', spin: { periodH: 19, obliquity: 4 },
    atmosphere: hydrogen([1.0, 0.85, 0.6], 70),
    status: 'Confirmed (Armstrong et al. 2021)',
    look: 'A warm sub-Neptune where methane and photochemical haze paint butterscotch and cream bands.',
  },
  {
    id: 'koi2433-07', name: 'KOI-2433.07', period: 86.43086, t0: BKJD + 423.0356, radiusE: 2.252, massE: 5.7, impact: 0.95,
    albedo: 0.45, color: [0.38, 0.45, 0.42], shading: 'gas', rotation: 'spin', spin: { periodH: 15, obliquity: 7 },
    atmosphere: hydrogen([0.85, 0.95, 0.9], 60),
    status: 'Candidate (Lissauer et al. 2024)',
    look: 'The outermost and coolest planet: methane-rich and hazy, a muted grey-green.',
  },
];

const fmt = (x: number, d = 0) => x.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });

function planetDef(p: Planet): BodyDef {
  const gmStar = K385_STAR.mass * GM_SUN;
  const P = p.period * 86400;
  const a = Math.cbrt(gmStar * (P / (2 * Math.PI)) ** 2);
  const R = p.radiusE * R_EARTH;
  const tilt = Math.asin(Math.min(1, (p.impact * K385_STAR.radius) / a)) * (180 / Math.PI);
  const teq = K385_STAR.teff * Math.sqrt(K385_STAR.radius / (2 * a));
  const flux = K385_STAR.luminosity / (a / AU) ** 2;
  // absolute magnitude from diameter and albedo (H = 5 log10(1329 km / (D sqrt(p))))
  const H = 5 * Math.log10(1329 / (2 * R * Math.sqrt(p.albedo)));
  return {
    id: p.id, name: p.name, kind: 'planet', parent: 'kepler385', system: 'kepler385',
    radius: R, color: p.color, albedo: p.albedo, H,
    atmosphere: p.atmosphere, rotation: p.rotation, spin: p.spin, shading: p.shading,
    exo: { a, period: p.period, t0: jd(p.t0), tilt },
    gm: p.massE * GM_EARTH,
    info: `${p.status}. ${fmt(p.radiusE, 2)} Earth radii, ${fmt(p.period, 2)}-day orbit at ${fmt(a / AU, 3)} AU; `
      + `${fmt(flux)}× the sunlight Earth gets, equilibrium ${fmt(teq)} K. ${p.look}`,
  };
}

export const KEPLER385_BODIES: BodyDef[] = [
  {
    id: 'kepler385', name: 'Kepler-385', kind: 'star', system: 'kepler385', radius: K385_STAR.radius,
    color: [1, 0.97, 0.93], albedo: 0, H: 4.83 - 2.5 * Math.log10(K385_STAR.luminosity),
    teff: K385_STAR.teff, luminosity: K385_STAR.luminosity,
    rotation: 'spin', spin: { periodH: 24 * 22, obliquity: 2 }, shading: 'sun', gm: K385_STAR.mass * GM_SUN,
    info: `Sun-like star, ${fmt(K385_STAR.teff)} K, 1.09× the Sun's size and ${fmt(K385_STAR.luminosity, 2)}× its light. `
      + 'Home of seven known planets, all bigger than Earth and smaller than Neptune, packed inside half an AU.',
  },
  ...PLANETS.map(planetDef),
];
