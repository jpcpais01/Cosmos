import { Data3DTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, RGBAFormat, UnsignedByteType } from 'three';

/** Edge of the tiling detail volume in voxels. */
const N = 64;

/** Deterministic PRNG (mulberry32) so every visit shows the same ground. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Adds one octave of periodic gradient noise with `p` lattice cells across the volume. */
function addNoise(h: Float32Array, p: number, amp: number, rand: () => number): void {
  const g = new Float32Array(p * p * p * 3);
  for (let i = 0; i < p * p * p; i++) {
    const z = rand() * 2 - 1;
    const a = rand() * Math.PI * 2;
    const s = Math.sqrt(1 - z * z);
    g[i * 3] = s * Math.cos(a);
    g[i * 3 + 1] = s * Math.sin(a);
    g[i * 3 + 2] = z;
  }
  const cell = N / p;
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const dot = (ix: number, iy: number, iz: number, x: number, y: number, z: number) => {
    const k = (((iz % p) * p + (iy % p)) * p + (ix % p)) * 3;
    return g[k] * x + g[k + 1] * y + g[k + 2] * z;
  };
  for (let z = 0; z < N; z++) {
    const fz = z / cell, iz = Math.floor(fz), tz = fz - iz, wz = fade(tz);
    for (let y = 0; y < N; y++) {
      const fy = y / cell, iy = Math.floor(fy), ty = fy - iy, wy = fade(ty);
      for (let x = 0; x < N; x++) {
        const fx = x / cell, ix = Math.floor(fx), tx = fx - ix, wx = fade(tx);
        const c000 = dot(ix, iy, iz, tx, ty, tz), c100 = dot(ix + 1, iy, iz, tx - 1, ty, tz);
        const c010 = dot(ix, iy + 1, iz, tx, ty - 1, tz), c110 = dot(ix + 1, iy + 1, iz, tx - 1, ty - 1, tz);
        const c001 = dot(ix, iy, iz + 1, tx, ty, tz - 1), c101 = dot(ix + 1, iy, iz + 1, tx - 1, ty, tz - 1);
        const c011 = dot(ix, iy + 1, iz + 1, tx, ty - 1, tz - 1), c111 = dot(ix + 1, iy + 1, iz + 1, tx - 1, ty - 1, tz - 1);
        const x00 = c000 + (c100 - c000) * wx, x10 = c010 + (c110 - c010) * wx;
        const x01 = c001 + (c101 - c001) * wx, x11 = c011 + (c111 - c011) * wx;
        const y0 = x00 + (x10 - x00) * wy, y1 = x01 + (x11 - x01) * wy;
        h[(z * N + y) * N + x] += (y0 + (y1 - y0) * wz) * amp;
      }
    }
  }
}

/** Bowl-shaped craters with raised rims, wrapped around the volume edges. */
function addCraters(h: Float32Array, count: number, rand: () => number): void {
  for (let c = 0; c < count; c++) {
    const cx = rand() * N, cy = rand() * N, cz = rand() * N;
    // many small craters, few large ones
    const r = 1.5 + Math.pow(rand(), 2.2) * 9;
    const depth = 0.35 * r / 6;
    const ext = Math.ceil(r * 1.8);
    for (let dz = -ext; dz <= ext; dz++) {
      const z = (((Math.floor(cz) + dz) % N) + N) % N;
      const ez = Math.floor(cz) + dz - cz;
      for (let dy = -ext; dy <= ext; dy++) {
        const y = (((Math.floor(cy) + dy) % N) + N) % N;
        const ey = Math.floor(cy) + dy - cy;
        for (let dx = -ext; dx <= ext; dx++) {
          const ex = Math.floor(cx) + dx - cx;
          const d = Math.sqrt(ex * ex + ey * ey + ez * ez) / r;
          if (d > 1.8) continue;
          const x = (((Math.floor(cx) + dx) % N) + N) % N;
          // bowl inside, rim at the edge, ejecta fading outside
          const prof = d < 1 ? d * d - 1 + 0.25 * Math.pow(d, 6) : 0.25 * Math.exp(-((d - 1) * (d - 1)) / 0.12);
          h[(z * N + y) * N + x] += prof * depth;
        }
      }
    }
  }
}

/**
 * A small tiling volume of terrain-like relief (rolling noise plus craters) used to add surface
 * detail finer than the real maps once you are close enough that their texels get magnified.
 * RGB holds the height gradient (for bump lighting), A the height (for albedo variation).
 */
export function createDetailTexture(): Data3DTexture {
  const rand = rng(0x5eed1e);
  const h = new Float32Array(N * N * N);
  addNoise(h, 4, 1.0, rand);
  addNoise(h, 8, 0.5, rand);
  addNoise(h, 16, 0.25, rand);
  addCraters(h, 70, rand);
  let lo = Infinity, hi = -Infinity;
  for (const v of h) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  const at = (x: number, y: number, z: number) => h[(((z + N) % N) * N + ((y + N) % N)) * N + ((x + N) % N)];
  const grad = new Float32Array(N * N * N * 3);
  let gmax = 0;
  for (let z = 0; z < N; z++) {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const i = ((z * N + y) * N + x) * 3;
        grad[i] = (at(x + 1, y, z) - at(x - 1, y, z)) * 0.5;
        grad[i + 1] = (at(x, y + 1, z) - at(x, y - 1, z)) * 0.5;
        grad[i + 2] = (at(x, y, z + 1) - at(x, y, z - 1)) * 0.5;
        gmax = Math.max(gmax, Math.abs(grad[i]), Math.abs(grad[i + 1]), Math.abs(grad[i + 2]));
      }
    }
  }
  const data = new Uint8Array(N * N * N * 4);
  // keep typical slopes well inside the 8-bit range
  const gs = 1 / (gmax * 0.6);
  const q = (v: number) => Math.max(0, Math.min(255, Math.round((v * 0.5 + 0.5) * 255)));
  for (let i = 0; i < N * N * N; i++) {
    data[i * 4] = q(grad[i * 3] * gs);
    data[i * 4 + 1] = q(grad[i * 3 + 1] * gs);
    data[i * 4 + 2] = q(grad[i * 3 + 2] * gs);
    data[i * 4 + 3] = Math.round(((h[i] - lo) / (hi - lo)) * 255);
  }
  const tex = new Data3DTexture(data, N, N, N);
  tex.format = RGBAFormat;
  tex.type = UnsignedByteType;
  tex.wrapS = tex.wrapT = tex.wrapR = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}
