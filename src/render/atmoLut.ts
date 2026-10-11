import { ClampToEdgeWrapping, DataTexture, DataUtils, HalfFloatType, LinearFilter, RGBAFormat } from 'three';
import type { AtmosphereDef } from '../sim/bodies';

/** Size of the sunlight transmittance table: altitude columns x sun-elevation rows. */
export const TRANS_W = 64;
export const TRANS_H = 256;

function chapman(X: number, h: number, mu: number): number {
  const c = Math.sqrt(X + h);
  if (mu >= 0) return (c / (c * mu + 1)) * Math.exp(-h);
  const x0 = Math.sqrt(1 - mu * mu) * (X + h);
  const c0 = Math.sqrt(x0);
  return 2 * c0 * Math.exp(X - x0) - (c / (1 - c * mu)) * Math.exp(-h);
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Transmittance of sunlight from radius r down to a point in the atmosphere, for every altitude
 * and sun elevation, so the scattering shader reads one texel per step instead of evaluating two
 * Chapman functions. Same maths (and the same soft planet shadow at the terminator) as before.
 * Lookup: x = sqrt(altitude / height), y = sqrt((mu - lo) / (1 - lo)) with lo 0.02 below the horizon.
 */
export function transmittanceTexture(R: number, a: AtmosphereDef): DataTexture {
  const H = a.height;
  const absorb = a.absorb ?? [0, 0, 0];
  const data = new Uint16Array(TRANS_W * TRANS_H * 4);
  for (let j = 0; j < TRANS_H; j++) {
    const y = j / (TRANS_H - 1);
    for (let i = 0; i < TRANS_W; i++) {
      const x = i / (TRANS_W - 1);
      const r = R + x * x * H;
      const horizon = -Math.sqrt(Math.max(1 - (R * R) / (r * r), 0));
      const lo = horizon - 0.02;
      const mu = Math.min(1, lo + y * y * (1 - lo));
      let cR = 1e9, cM = 1e9;
      if (mu >= lo) {
        const soft = Math.max(smoothstep(horizon - 0.02, horizon + 0.01, mu), 1e-4);
        cR = (a.rayleighH * chapman(R / a.rayleighH, (r - R) / a.rayleighH, mu)) / soft;
        cM = (a.mieH * chapman(R / a.mieH, (r - R) / a.mieH, mu)) / soft;
      }
      const o = (j * TRANS_W + i) * 4;
      for (let k = 0; k < 3; k++) {
        const t = Math.exp(-((a.rayleigh[k] + absorb[k]) * cR + a.mie[k] * a.mieAbsorb * cM));
        data[o + k] = DataUtils.toHalfFloat(Number.isFinite(t) ? t : 0);
      }
      data[o + 3] = DataUtils.toHalfFloat(1);
    }
  }
  const tex = new DataTexture(data, TRANS_W, TRANS_H, RGBAFormat, HalfFloatType);
  tex.minFilter = tex.magFilter = LinearFilter;
  tex.wrapS = tex.wrapT = ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}
