import { Matrix3 } from 'three';
import { OBLIQUITY_J2000 } from './constants';

/** World (ecliptic, Y-up) -> galactic rotation. */
export function worldToGalactic(): Matrix3 {
  const ce = Math.cos(OBLIQUITY_J2000), se = Math.sin(OBLIQUITY_J2000);
  // world -> ecliptic (x, y, z) = (X, -Z, Y); ecliptic -> equatorial
  const w2e = new Matrix3().set(1, 0, 0, 0, 0, -1, 0, 1, 0);
  const e2q = new Matrix3().set(1, 0, 0, 0, ce, -se, 0, se, ce);
  // equatorial (ICRS) -> galactic (Hipparcos, ESA 1997)
  const q2g = new Matrix3().set(
    -0.0548755604, -0.873437090, -0.4838350155,
    0.4941094279, -0.4448296300, 0.7469822445,
    -0.8676661490, -0.1980763734, 0.4559837762,
  );
  return q2g.multiply(e2q).multiply(w2e);
}
