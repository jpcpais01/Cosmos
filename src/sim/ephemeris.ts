import * as Astronomy from 'astronomy-engine';
import { Matrix3, Vector3 } from 'three';
import { AU_KM, DAY_MS, DEG, J2000_MS } from './constants';
import { BODIES, type BodyDef, type MoonOrbit } from './bodies';
import { bodyToWorldMatrix, eqjToWorld, matrixFromAxes } from './frames';

const ASTRO_BODY: Record<string, Astronomy.Body> = {
  sun: Astronomy.Body.Sun,
  mercury: Astronomy.Body.Mercury,
  venus: Astronomy.Body.Venus,
  earth: Astronomy.Body.Earth,
  moon: Astronomy.Body.Moon,
  mars: Astronomy.Body.Mars,
  jupiter: Astronomy.Body.Jupiter,
  saturn: Astronomy.Body.Saturn,
  uranus: Astronomy.Body.Uranus,
  neptune: Astronomy.Body.Neptune,
  pluto: Astronomy.Body.Pluto,
};

const GALILEAN = ['io', 'europa', 'ganymede', 'callisto'] as const;

export interface BodyState {
  def: BodyDef;
  /** Heliocentric position in the world frame (km, float64). */
  pos: Vector3;
  /** Body-fixed -> world rotation. */
  rot: Matrix3;
  /** Laplace sphere-of-influence radius (km). */
  soi: number;
  parent?: BodyState;
  children: BodyState[];
  depth: number;
}

const _v = new Vector3();
const _x = new Vector3();
const _y = new Vector3();
const _z = new Vector3();

function solveKepler(M: number, e: number): number {
  let E = e < 0.8 ? M : Math.PI;
  for (let k = 0; k < 8; k++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-12) break;
  }
  return E;
}

/** Position of a moon in its parent's equatorial frame (x = node of parent equator on ICRF equator, z = pole). */
function keplerPosition(o: MoonOrbit, tDays: number, out: Vector3, normal?: Vector3): Vector3 {
  const n = 360 / Math.abs(o.period);
  const M = ((o.M0 + n * tDays) % 360) * DEG;
  const E = solveKepler(M, o.e);
  const xv = o.a * (Math.cos(E) - o.e);
  const yv = o.a * Math.sqrt(1 - o.e * o.e) * Math.sin(E);
  const w = o.peri * DEG;
  const node = o.node * DEG + (o.nodePeriod ? (2 * Math.PI * tDays) / (o.nodePeriod * 365.25) : 0);
  const inc = o.i * DEG;
  const cw = Math.cos(w), sw = Math.sin(w), cn = Math.cos(node), sn = Math.sin(node), ci = Math.cos(inc), si = Math.sin(inc);
  // perifocal -> equatorial
  const px = xv * cw - yv * sw;
  const py = xv * sw + yv * cw;
  out.set(px * cn - py * ci * sn, px * sn + py * ci * cn, py * si);
  if (normal) normal.set(si * sn, -si * cn, ci);
  return out;
}

export class Ephemeris {
  readonly states = new Map<string, BodyState>();
  readonly list: BodyState[] = [];
  time: Astronomy.AstroTime = Astronomy.MakeTime(new Date());
  private orbitNormals = new Map<string, Vector3>();
  private parentEquator = new Map<string, Matrix3>();

  constructor() {
    for (const def of BODIES) {
      const s: BodyState = { def, pos: new Vector3(), rot: new Matrix3(), soi: Infinity, children: [], depth: 0 };
      this.states.set(def.id, s);
      this.list.push(s);
    }
    for (const s of this.list) {
      if (s.def.parent) {
        s.parent = this.states.get(s.def.parent)!;
        s.parent.children.push(s);
      }
    }
    for (const s of this.list) {
      let d = 0;
      for (let p = s.parent; p; p = p.parent) d++;
      s.depth = d;
      this.orbitNormals.set(s.def.id, new Vector3(0, 1, 0));
      this.parentEquator.set(s.def.id, new Matrix3());
    }
  }

  get(id: string): BodyState {
    return this.states.get(id)!;
  }

  update(simMs: number): void {
    const time = Astronomy.MakeTime(new Date(simMs));
    this.time = time;
    const tDays = (simMs - J2000_MS) / DAY_MS;

    // Sun, planets, Pluto: heliocentric.
    for (const s of this.list) {
      const id = s.def.id;
      if (id === 'sun') {
        s.pos.set(0, 0, 0);
      } else if (s.def.parent === 'sun') {
        const v = Astronomy.HelioVector(ASTRO_BODY[id], time);
        eqjToWorld(v.x * AU_KM, v.y * AU_KM, v.z * AU_KM, s.pos);
      }
      if (s.def.rotation === 'iau' && ASTRO_BODY[id]) {
        const ax = Astronomy.RotationAxis(ASTRO_BODY[id], time);
        bodyToWorldMatrix(ax.ra, ax.dec, ax.spin, s.rot);
        bodyToWorldMatrix(ax.ra, ax.dec, 0, this.parentEquator.get(id)!);
      }
    }

    // Earth's Moon.
    const earth = this.get('earth');
    const moon = this.get('moon');
    const gm = Astronomy.GeoMoon(time);
    eqjToWorld(gm.x * AU_KM, gm.y * AU_KM, gm.z * AU_KM, moon.pos).add(earth.pos);

    // Galilean moons.
    const jup = this.get('jupiter');
    const jm = Astronomy.JupiterMoons(time);
    for (const id of GALILEAN) {
      const st = jm[id];
      const s = this.get(id);
      eqjToWorld(st.x * AU_KM, st.y * AU_KM, st.z * AU_KM, s.pos);
      eqjToWorld(st.vx, st.vy, st.vz, _v);
      this.orbitNormals.get(id)!.copy(s.pos).cross(_v).normalize();
      s.pos.add(jup.pos);
    }

    // Other moons: Kepler elements relative to the parent's equator.
    for (const s of this.list) {
      const o = s.def.orbit;
      if (!o || !s.parent) continue;
      const eq = this.parentEquator.get(s.parent.def.id)!;
      const nrm = this.orbitNormals.get(s.def.id)!;
      keplerPosition(o, tDays, _v, nrm);
      _v.applyMatrix3(eq);
      nrm.applyMatrix3(eq).normalize();
      s.pos.copy(_v).add(s.parent.pos);
    }

    // Synchronous rotation: +X faces the parent, +Z along the orbit normal.
    for (const s of this.list) {
      if (s.def.rotation !== 'synchronous' || !s.parent) continue;
      _x.subVectors(s.parent.pos, s.pos).normalize();
      _z.copy(this.orbitNormals.get(s.def.id)!);
      _y.crossVectors(_z, _x).normalize();
      _z.crossVectors(_x, _y);
      matrixFromAxes(_x, _y, _z, s.rot);
    }

    // Spheres of influence.
    const sun = this.get('sun');
    for (const s of this.list) {
      if (!s.parent) continue;
      const a = s.pos.distanceTo(s.parent.pos);
      s.soi = Math.max(a * Math.pow(s.def.gm / s.parent.def.gm, 0.4), s.def.radius * 6);
    }
    sun.soi = Infinity;
  }

  /** Deepest body whose sphere of influence contains the point. */
  dominantBody(p: Vector3): BodyState {
    let best = this.get('sun');
    let bestD = Infinity;
    for (const s of this.list) {
      if (!s.parent) continue;
      const d = p.distanceTo(s.pos);
      if (d < s.soi && (s.depth > best.depth || (s.depth === best.depth && d < bestD))) {
        best = s;
        bestD = d;
      }
    }
    return best;
  }

  /** Orbital normal (world) for moons; planet's orbit normal approximated by ecliptic north. */
  orbitNormal(id: string): Vector3 {
    return this.orbitNormals.get(id)!;
  }

  /** Parent equatorial frame for bodies with IAU rotation (spin removed). */
  equatorFrame(id: string): Matrix3 {
    return this.parentEquator.get(id)!;
  }

  /** Samples an orbit polyline (relative to the parent) for the map. */
  sampleOrbit(id: string, n = 256): Vector3[] {
    const s = this.get(id);
    const def = s.def;
    const out: Vector3[] = [];
    if (!s.parent) return out;
    if (def.orbit) {
      const eq = this.parentEquator.get(s.parent.def.id)!;
      const period = Math.abs(def.orbit.period);
      for (let k = 0; k <= n; k++) {
        const v = keplerPosition(def.orbit, (k / n) * period, new Vector3()).applyMatrix3(eq);
        out.push(v);
      }
      return out;
    }
    // Planets/Moon/Galilean: sample through the ephemeris over one period.
    const periodDays = ORBIT_PERIOD_DAYS[id] ?? 365.25;
    const t0 = this.time.ut;
    for (let k = 0; k <= n; k++) {
      const t = Astronomy.MakeTime(t0 + (k / n) * periodDays);
      const v = new Vector3();
      if (s.def.parent === 'sun') {
        const h = Astronomy.HelioVector(ASTRO_BODY[id], t);
        eqjToWorld(h.x * AU_KM, h.y * AU_KM, h.z * AU_KM, v);
      } else if (id === 'moon') {
        const g = Astronomy.GeoMoon(t);
        eqjToWorld(g.x * AU_KM, g.y * AU_KM, g.z * AU_KM, v);
      } else {
        const jm = Astronomy.JupiterMoons(t)[id as (typeof GALILEAN)[number]];
        eqjToWorld(jm.x * AU_KM, jm.y * AU_KM, jm.z * AU_KM, v);
      }
      out.push(v);
    }
    return out;
  }
}

const ORBIT_PERIOD_DAYS: Record<string, number> = {
  mercury: 87.969, venus: 224.701, earth: 365.256, mars: 686.98, jupiter: 4332.59, saturn: 10759.22,
  uranus: 30688.5, neptune: 60182, pluto: 90560, moon: 27.3217, io: 1.769138, europa: 3.551181,
  ganymede: 7.154553, callisto: 16.689018,
};

