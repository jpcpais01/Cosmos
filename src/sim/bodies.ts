/**
 * Solar system body catalogue. Radii, flattening, rotation and orbital data from
 * IAU WGCCRE 2015 / JPL Solar System Dynamics (planetary physical parameters and
 * planetary satellite mean elements). Distances in km.
 */

export type BodyKind = 'star' | 'planet' | 'moon' | 'dwarf';

export interface AtmosphereDef {
  /** Thickness of the rendered shell above the surface (km). */
  height: number;
  /** Rayleigh scattering coefficients at the surface (1/km), RGB. */
  rayleigh: [number, number, number];
  rayleighH: number;
  /** Mie (aerosol) scattering coefficients at the surface (1/km), RGB. */
  mie: [number, number, number];
  /** Extinction / scattering ratio for aerosols (>= 1, absorption). */
  mieAbsorb: number;
  mieH: number;
  mieG: number;
  /** Ozone-like absorption (1/km) following the Rayleigh profile. */
  absorb?: [number, number, number];
  /** Brightness multiplier (artistic exposure balance). */
  intensity?: number;
}

export interface MoonOrbit {
  /** Semi-major axis (km). */
  a: number;
  e: number;
  /** Inclination to the parent's equator (deg). */
  i: number;
  /** Longitude of ascending node on parent's equator at J2000 (deg). */
  node: number;
  /** Argument of periapsis (deg). */
  peri: number;
  /** Mean anomaly at J2000 (deg). */
  M0: number;
  /** Sidereal period (days). Negative for retrograde. */
  period: number;
  /** Nodal precession period (years) - optional. */
  nodePeriod?: number;
}

export interface RingDef {
  inner: number;
  outer: number;
  texture: string;
}

export interface BodyDef {
  id: string;
  name: string;
  kind: BodyKind;
  parent?: string;
  /** Equatorial radius (km). */
  radius: number;
  /** Polar radius (km), defaults to radius. */
  polarRadius?: number;
  /** Tri-axial semi-axes for irregular bodies (a: toward parent, b, c: polar). */
  triaxial?: [number, number, number];
  /** Linear RGB albedo colour used for far-away dots and planet-shine. */
  color: [number, number, number];
  /** Bond-ish albedo multiplier for planet-shine. */
  albedo: number;
  /** Absolute magnitude H (V band) used when the body is a point of light. */
  H: number;
  atmosphere?: AtmosphereDef;
  rings?: RingDef;
  /** Rotation: from astronomy-engine (IAU) or synchronous with orbit. */
  rotation: 'iau' | 'synchronous';
  orbit?: MoonOrbit;
  /** Kind of surface shading. */
  shading: 'rocky' | 'earth' | 'gas' | 'icegiant' | 'sun' | 'cloudy';
  /** Fun facts for the info panel. */
  info: string;
  /** Gravitational parameter (km^3/s^2) - used for hill sphere / reference frame selection. */
  gm: number;
}

export const BODIES: BodyDef[] = [
  {
    id: 'sun', name: 'Sun', kind: 'star', radius: 695_700, color: [1, 0.96, 0.9], albedo: 0, H: -26.7,
    rotation: 'iau', shading: 'sun', gm: 1.32712440018e11,
    info: 'G2V main-sequence star. 99.86% of the Solar System mass. Surface 5,772 K.',
  },
  {
    id: 'mercury', name: 'Mercury', kind: 'planet', parent: 'sun', radius: 2440.53, polarRadius: 2438.26,
    color: [0.55, 0.52, 0.5], albedo: 0.14, H: -0.613,
    rotation: 'iau', shading: 'rocky', gm: 22031.86,
    info: 'Smallest planet. A day (sunrise to sunrise) lasts 176 Earth days.',
  },
  {
    id: 'venus', name: 'Venus', kind: 'planet', parent: 'sun', radius: 6051.8,
    color: [0.92, 0.84, 0.66], albedo: 0.76, H: -4.384,
    atmosphere: {
      height: 120, rayleigh: [3.0e-3, 4.6e-3, 7.4e-3], rayleighH: 15,
      mie: [9e-3, 8e-3, 5.5e-3], mieAbsorb: 1.15, mieH: 12, mieG: 0.75, intensity: 1.0,
    },
    rotation: 'iau', shading: 'cloudy', gm: 324858.59,
    info: 'Thick CO2 atmosphere, 92 bar at the surface. Sulfuric-acid clouds hide the ground.',
  },
  {
    id: 'earth', name: 'Earth', kind: 'planet', parent: 'sun', radius: 6378.137, polarRadius: 6356.752,
    color: [0.3, 0.38, 0.52], albedo: 0.36, H: -3.99,
    atmosphere: {
      height: 100, rayleigh: [5.802e-3, 13.558e-3, 33.1e-3], rayleighH: 8,
      mie: [3.996e-3, 3.996e-3, 3.996e-3], mieAbsorb: 1.11, mieH: 1.2, mieG: 0.8,
      absorb: [0.65e-3, 1.881e-3, 0.085e-3], intensity: 1.0,
    },
    rotation: 'iau', shading: 'earth', gm: 398600.435,
    info: 'Our home. 71% ocean. The only place known to harbour life.',
  },
  {
    id: 'moon', name: 'Moon', kind: 'moon', parent: 'earth', radius: 1737.4,
    color: [0.42, 0.4, 0.38], albedo: 0.12, H: 0.21,
    rotation: 'iau', shading: 'rocky', gm: 4902.8,
    info: 'Tidally locked: the same face always looks at Earth. 384,400 km away.',
  },
  {
    id: 'mars', name: 'Mars', kind: 'planet', parent: 'sun', radius: 3396.19, polarRadius: 3376.2,
    color: [0.68, 0.38, 0.22], albedo: 0.25, H: -1.601,
    atmosphere: {
      height: 80, rayleigh: [0.2e-3, 0.45e-3, 1.0e-3], rayleighH: 11,
      mie: [16e-3, 9.5e-3, 5.5e-3], mieAbsorb: 1.35, mieH: 11, mieG: 0.72, intensity: 1.0,
    },
    rotation: 'iau', shading: 'rocky', gm: 42828.37,
    info: 'Home of Olympus Mons, 22 km tall, and Valles Marineris, 4,000 km long.',
  },
  {
    id: 'phobos', name: 'Phobos', kind: 'moon', parent: 'mars', radius: 11.08, triaxial: [13.0, 11.4, 9.1],
    color: [0.3, 0.27, 0.25], albedo: 0.07, H: 11.8,
    rotation: 'synchronous', shading: 'rocky', gm: 7.087e-4,
    orbit: { a: 9376, e: 0.0151, i: 1.075, node: 207.8, peri: 150.06, M0: 92.47, period: 0.31891023 },
    info: 'Orbits Mars three times a day, slowly spiralling inward.',
  },
  {
    id: 'deimos', name: 'Deimos', kind: 'moon', parent: 'mars', radius: 6.2, triaxial: [7.8, 6.0, 5.1],
    color: [0.36, 0.33, 0.3], albedo: 0.07, H: 12.89,
    rotation: 'synchronous', shading: 'rocky', gm: 9.6e-5,
    orbit: { a: 23458, e: 0.00033, i: 1.788, node: 24.53, peri: 290.5, M0: 296.23, period: 1.2624407 },
    info: 'Tiny outer moon of Mars, only 12 km across.',
  },
  {
    id: 'jupiter', name: 'Jupiter', kind: 'planet', parent: 'sun', radius: 71492, polarRadius: 66854,
    color: [0.75, 0.66, 0.54], albedo: 0.5, H: -9.395,
    atmosphere: {
      height: 600, rayleigh: [1.0e-4, 2.2e-4, 5.0e-4], rayleighH: 27,
      mie: [0.6e-4, 0.6e-4, 0.55e-4], mieAbsorb: 1.2, mieH: 27, mieG: 0.7, intensity: 1.0,
    },
    rotation: 'iau', shading: 'gas', gm: 126686534,
    info: 'Gas giant with 2.5x the mass of all other planets combined. The Great Red Spot is wider than Earth.',
  },
  {
    id: 'io', name: 'Io', kind: 'moon', parent: 'jupiter', radius: 1821.6,
    color: [0.75, 0.68, 0.4], albedo: 0.63, H: -1.68,
    rotation: 'synchronous', shading: 'rocky', gm: 5959.9,
    info: 'The most volcanically active world known: over 400 active volcanoes.',
  },
  {
    id: 'europa', name: 'Europa', kind: 'moon', parent: 'jupiter', radius: 1560.8,
    color: [0.72, 0.66, 0.58], albedo: 0.67, H: -1.41,
    rotation: 'synchronous', shading: 'rocky', gm: 3202.7,
    info: 'An ice shell over a global salt-water ocean, with more water than all of Earth\'s oceans.',
  },
  {
    id: 'ganymede', name: 'Ganymede', kind: 'moon', parent: 'jupiter', radius: 2634.1,
    color: [0.5, 0.47, 0.43], albedo: 0.43, H: -2.09,
    rotation: 'synchronous', shading: 'rocky', gm: 9887.8,
    info: 'Largest moon in the Solar System, bigger than Mercury. Has its own magnetic field.',
  },
  {
    id: 'callisto', name: 'Callisto', kind: 'moon', parent: 'jupiter', radius: 2410.3,
    color: [0.36, 0.33, 0.3], albedo: 0.22, H: -1.05,
    rotation: 'synchronous', shading: 'rocky', gm: 7179.3,
    info: 'The most heavily cratered surface in the Solar System.',
  },
  {
    id: 'saturn', name: 'Saturn', kind: 'planet', parent: 'sun', radius: 60268, polarRadius: 54364,
    color: [0.78, 0.7, 0.54], albedo: 0.47, H: -8.914,
    atmosphere: {
      height: 600, rayleigh: [0.9e-4, 2.0e-4, 4.6e-4], rayleighH: 60,
      mie: [0.5e-4, 0.5e-4, 0.45e-4], mieAbsorb: 1.2, mieH: 60, mieG: 0.7, intensity: 1.0,
    },
    rings: { inner: 70_965, outer: 141_160, texture: 'textures/saturn/rings.webp' },
    rotation: 'iau', shading: 'gas', gm: 37931187,
    info: 'Its rings span 280,000 km but are mostly only ~10 m thick.',
  },
  {
    id: 'mimas', name: 'Mimas', kind: 'moon', parent: 'saturn', radius: 198.2,
    color: [0.6, 0.6, 0.6], albedo: 0.96, H: 3.3, 
    rotation: 'synchronous', shading: 'rocky', gm: 2.503,
    orbit: { a: 185_539, e: 0.0196, i: 1.574, node: 173.0, peri: 332.5, M0: 14.85, period: 0.942422 },
    info: 'Its giant Herschel crater makes it look like the Death Star.',
  },
  {
    id: 'enceladus', name: 'Enceladus', kind: 'moon', parent: 'saturn', radius: 252.1,
    color: [0.9, 0.9, 0.9], albedo: 1.38, H: 2.2, 
    rotation: 'synchronous', shading: 'rocky', gm: 7.211,
    orbit: { a: 237_948, e: 0.0047, i: 0.009, node: 342.5, peri: 0.08, M0: 199.7, period: 1.370218 },
    info: 'Geysers at its south pole feed Saturn\'s E ring. Brightest surface in the Solar System.',
  },
  {
    id: 'tethys', name: 'Tethys', kind: 'moon', parent: 'saturn', radius: 531.1,
    color: [0.8, 0.8, 0.8], albedo: 1.23, H: 0.7, 
    rotation: 'synchronous', shading: 'rocky', gm: 41.21,
    orbit: { a: 294_619, e: 0.0001, i: 1.091, node: 259.8, peri: 45.2, M0: 243.4, period: 1.887802 },
    info: 'Almost entirely water ice. Scarred by the 400 km Odysseus crater.',
  },
  {
    id: 'dione', name: 'Dione', kind: 'moon', parent: 'saturn', radius: 561.4,
    color: [0.75, 0.75, 0.75], albedo: 0.99, H: 0.8, 
    rotation: 'synchronous', shading: 'rocky', gm: 73.11,
    orbit: { a: 377_396, e: 0.0022, i: 0.028, node: 290.4, peri: 284.3, M0: 322.2, period: 2.736915 },
    info: 'Bright ice cliffs streak its trailing hemisphere.',
  },
  {
    id: 'rhea', name: 'Rhea', kind: 'moon', parent: 'saturn', radius: 763.8,
    color: [0.72, 0.72, 0.72], albedo: 0.95, H: 0.1, 
    rotation: 'synchronous', shading: 'rocky', gm: 153.94,
    orbit: { a: 527_108, e: 0.0013, i: 0.333, node: 351.0, peri: 241.6, M0: 179.8, period: 4.518212 },
    info: 'Saturn\'s second-largest moon, a dirty snowball 1,528 km across.',
  },
  {
    id: 'titan', name: 'Titan', kind: 'moon', parent: 'saturn', radius: 2574.73,
    color: [0.72, 0.55, 0.28], albedo: 0.22, H: -1.2, 
    atmosphere: {
      height: 600, rayleigh: [1.2e-3, 2.4e-3, 4.5e-3], rayleighH: 40,
      mie: [3.2e-3, 2.2e-3, 1.0e-3], mieAbsorb: 1.6, mieH: 45, mieG: 0.6, intensity: 1.0,
    },
    rotation: 'synchronous', shading: 'cloudy', gm: 8978.14,
    orbit: { a: 1_221_870, e: 0.0288, i: 0.306, node: 28.1, peri: 180.5, M0: 163.3, period: 15.945421 },
    info: 'Thick nitrogen-methane atmosphere, 1.5 bar. Lakes and seas of liquid methane.',
  },
  {
    id: 'iapetus', name: 'Iapetus', kind: 'moon', parent: 'saturn', radius: 734.5,
    color: [0.45, 0.4, 0.35], albedo: 0.6, H: 1.6, 
    rotation: 'synchronous', shading: 'rocky', gm: 120.5,
    orbit: { a: 3_560_820, e: 0.0283, i: 8.3, node: 81.1, peri: 271.6, M0: 201.8, period: 79.3215 },
    info: 'Two-toned: one hemisphere as dark as coal, the other bright as snow.',
  },
  {
    id: 'uranus', name: 'Uranus', kind: 'planet', parent: 'sun', radius: 25559, polarRadius: 24973,
    color: [0.6, 0.78, 0.82], albedo: 0.49, H: -7.11,
    atmosphere: {
      height: 500, rayleigh: [0.6e-4, 1.4e-4, 3.0e-4], rayleighH: 28,
      mie: [0.4e-4, 0.45e-4, 0.45e-4], mieAbsorb: 1.1, mieH: 28, mieG: 0.7, intensity: 1.0,
    },
    rotation: 'iau', shading: 'icegiant', gm: 5793939,
    info: 'Ice giant tipped on its side: its axis is tilted 98 degrees.',
  },
  {
    id: 'miranda', name: 'Miranda', kind: 'moon', parent: 'uranus', radius: 235.8,
    color: [0.55, 0.55, 0.55], albedo: 0.32, H: 3.5, 
    rotation: 'synchronous', shading: 'rocky', gm: 4.4,
    orbit: { a: 129_390, e: 0.0013, i: 4.338, node: 326.4, peri: 68.3, M0: 311.3, period: 1.413479 },
    info: 'Home of Verona Rupes, possibly the tallest cliff in the Solar System (~20 km).',
  },
  {
    id: 'ariel', name: 'Ariel', kind: 'moon', parent: 'uranus', radius: 578.9,
    color: [0.6, 0.6, 0.6], albedo: 0.53, H: 1.7, 
    rotation: 'synchronous', shading: 'rocky', gm: 83.43,
    orbit: { a: 191_020, e: 0.0012, i: 0.041, node: 22.4, peri: 115.3, M0: 39.5, period: 2.520379 },
    info: 'The brightest of Uranus\'s moons, crossed by deep rift valleys.',
  },
  {
    id: 'umbriel', name: 'Umbriel', kind: 'moon', parent: 'uranus', radius: 584.7,
    color: [0.35, 0.35, 0.35], albedo: 0.26, H: 2.1, 
    rotation: 'synchronous', shading: 'rocky', gm: 85.4,
    orbit: { a: 266_300, e: 0.0039, i: 0.128, node: 33.5, peri: 84.7, M0: 12.5, period: 4.144177 },
    info: 'The darkest of Uranus\'s large moons.',
  },
  {
    id: 'titania', name: 'Titania', kind: 'moon', parent: 'uranus', radius: 788.4,
    color: [0.5, 0.48, 0.46], albedo: 0.35, H: 1.0, 
    rotation: 'synchronous', shading: 'rocky', gm: 226.9,
    orbit: { a: 435_910, e: 0.0011, i: 0.079, node: 99.8, peri: 284.4, M0: 24.6, period: 8.705872 },
    info: 'Largest moon of Uranus, cut by canyons up to 1,500 km long.',
  },
  {
    id: 'oberon', name: 'Oberon', kind: 'moon', parent: 'uranus', radius: 761.4,
    color: [0.45, 0.42, 0.4], albedo: 0.31, H: 1.2, 
    rotation: 'synchronous', shading: 'rocky', gm: 205.3,
    orbit: { a: 583_520, e: 0.0014, i: 0.068, node: 279.8, peri: 104.4, M0: 283.1, period: 13.463239 },
    info: 'Outermost large moon of Uranus, old and heavily cratered.',
  },
  {
    id: 'neptune', name: 'Neptune', kind: 'planet', parent: 'sun', radius: 24764, polarRadius: 24341,
    color: [0.3, 0.45, 0.85], albedo: 0.44, H: -7.0,
    atmosphere: {
      height: 500, rayleigh: [0.6e-4, 1.5e-4, 3.6e-4], rayleighH: 20,
      mie: [0.35e-4, 0.4e-4, 0.45e-4], mieAbsorb: 1.1, mieH: 20, mieG: 0.7, intensity: 1.0,
    },
    rotation: 'iau', shading: 'icegiant', gm: 6836529,
    info: 'Fastest winds in the Solar System: up to 2,100 km/h.',
  },
  {
    id: 'triton', name: 'Triton', kind: 'moon', parent: 'neptune', radius: 1353.4,
    color: [0.7, 0.66, 0.62], albedo: 0.76, H: -1.2, 
    rotation: 'synchronous', shading: 'rocky', gm: 1427.6,
    orbit: { a: 354_759, e: 0.000016, i: 156.865, node: 177.6, peri: 66.1, M0: 352.3, period: -5.876854 },
    info: 'Orbits backwards: probably a captured Kuiper-belt object. Nitrogen geysers.',
  },
  {
    id: 'pluto', name: 'Pluto', kind: 'dwarf', parent: 'sun', radius: 1188.3,
    color: [0.66, 0.56, 0.46], albedo: 0.52, H: -0.4, 
    atmosphere: {
      height: 120, rayleigh: [0.3e-3, 0.7e-3, 1.6e-3], rayleighH: 30,
      mie: [0.2e-3, 0.22e-3, 0.25e-3], mieAbsorb: 1.1, mieH: 30, mieG: 0.6, intensity: 1.0,
    },
    rotation: 'iau', shading: 'rocky', gm: 869.6,
    info: 'Dwarf planet with a heart-shaped nitrogen glacier, Sputnik Planitia.',
  },
  {
    id: 'charon', name: 'Charon', kind: 'moon', parent: 'pluto', radius: 606,
    color: [0.45, 0.43, 0.42], albedo: 0.35, H: 1.0, 
    rotation: 'synchronous', shading: 'rocky', gm: 105.88,
    orbit: { a: 19_591, e: 0.0002, i: 0.08, node: 223.0, peri: 147.0, M0: 0.0, period: 6.3872273 },
    info: 'So large relative to Pluto that both orbit a point in space between them.',
  },
];

export const BODY_BY_ID: Record<string, BodyDef> = Object.fromEntries(BODIES.map((b) => [b.id, b]));

export function polarRadius(b: BodyDef): number {
  return b.triaxial ? b.triaxial[2] : (b.polarRadius ?? b.radius);
}

/** Mean radius used for collision and approach distances. */
export function meanRadius(b: BodyDef): number {
  if (b.triaxial) return (b.triaxial[0] + b.triaxial[1] + b.triaxial[2]) / 3;
  return (2 * b.radius + polarRadius(b)) / 3;
}
