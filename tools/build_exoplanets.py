#!/usr/bin/env python3
"""Generates the Kepler-385 planet and star maps (no photographs of these worlds exist).

Usage: python3 tools/build_exoplanets.py [public/textures] [width] [body ...]

Every map is built from 3D noise sampled on the sphere, so it has no seam at the date line and no
pinching at the poles. What each world looks like follows from its measured radius and the light it
gets from its star (see src/sim/kepler385.ts for the numbers and what is inferred):

- KOI-2433.08 and .06 are rocky and so close to the star that they are surely tidally locked, with
  the star always overhead at longitude 0 (the map centre). Bare rock there reaches
  T = Teff * sqrt(R* / a) * (1 - A)^0.25 * cos(z)^0.25 at a zenith angle z. Wherever that is above the
  rock's melting point (about 1500 K) the ground is molten, so .08 has a magma ocean over most of its
  day side and .06 a magma lake under the star. The aux map's red channel holds that temperature
  (800 K + 1600 K * value, 0 = cold rock) and the game draws the glow of hot rock from it.
- The five larger planets are sub-Neptunes: hydrogen-rich envelopes with banded clouds and hazes,
  coloured by temperature (hot, blue, alkali-cloud worlds inside; tan photochemical haze and methane
  further out). KOI-2433.04 is drawn with a closed cloud deck.

Writes <body>/map_<w>.webp (and normal_ / aux_ for the rocky worlds) at the full width and the
1024 and 2048 tiers; run tools/build_tiles.py and tools/texture_manifest.py afterwards.
"""
import math
import os
import sys
from multiprocessing import Pool

import numpy as np
from PIL import Image

OUT = sys.argv[1] if len(sys.argv) > 1 else 'public/textures'
W = int(sys.argv[2]) if len(sys.argv) > 2 else 4096
ONLY = set(sys.argv[3:])
H = W // 2
F = np.float32


# ---------------------------------------------------------------- noise

class Noise:
    """Gradient (Perlin) noise in 3D with random unit gradients, vectorised over numpy arrays."""

    def __init__(self, seed):
        rng = np.random.default_rng(seed)
        p = rng.permutation(256).astype(np.int32)
        self.p = np.concatenate([p, p, p])
        g = rng.normal(size=(256, 3))
        g /= np.linalg.norm(g, axis=1, keepdims=True)
        self.gx, self.gy, self.gz = (g[:, i].astype(F) for i in range(3))
        self.off = rng.uniform(-100, 100, size=(32, 3)).astype(F)

    def perlin(self, x, y, z):
        x0, y0, z0 = np.floor(x), np.floor(y), np.floor(z)
        fx, fy, fz = (x - x0).astype(F), (y - y0).astype(F), (z - z0).astype(F)
        xi, yi, zi = x0.astype(np.int32) & 255, y0.astype(np.int32) & 255, z0.astype(np.int32) & 255
        p = self.p
        u = fx * fx * fx * (fx * (fx * 6 - 15) + 10)
        v = fy * fy * fy * (fy * (fy * 6 - 15) + 10)
        w = fz * fz * fz * (fz * (fz * 6 - 15) + 10)
        a, b = p[xi], p[xi + 1]
        aa, ab, ba, bb = p[a + yi], p[a + yi + 1], p[b + yi], p[b + yi + 1]

        def gd(h, dx, dy, dz):
            h = p[h] & 255
            return self.gx[h] * dx + self.gy[h] * dy + self.gz[h] * dz

        x1 = gd(aa + zi, fx, fy, fz) + u * (gd(ba + zi, fx - 1, fy, fz) - gd(aa + zi, fx, fy, fz))
        x2 = gd(ab + zi, fx, fy - 1, fz) + u * (gd(bb + zi, fx - 1, fy - 1, fz) - gd(ab + zi, fx, fy - 1, fz))
        y1 = x1 + v * (x2 - x1)
        x3 = gd(aa + zi + 1, fx, fy, fz - 1) + u * (gd(ba + zi + 1, fx - 1, fy, fz - 1) - gd(aa + zi + 1, fx, fy, fz - 1))
        x4 = gd(ab + zi + 1, fx, fy - 1, fz - 1) + u * (gd(bb + zi + 1, fx - 1, fy - 1, fz - 1) - gd(ab + zi + 1, fx, fy - 1, fz - 1))
        y2 = x3 + v * (x4 - x3)
        return (y1 + w * (y2 - y1)) * F(1.6)  # roughly -1..1

    def fbm(self, P, freq, octaves, gain=0.5, lac=2.03, k=0):
        x, y, z = P
        s = np.zeros_like(x)
        a = F(1)
        norm = 0.0
        for i in range(octaves):
            o = self.off[(k + i) % 32]
            s += a * self.perlin(x * freq + o[0], y * freq + o[1], z * freq + o[2])
            norm += a
            a *= gain
            freq *= lac
        return s / F(norm)

    def ridged(self, P, freq, octaves, gain=0.5, lac=2.1, k=7):
        x, y, z = P
        s = np.zeros_like(x)
        a = F(1)
        norm = 0.0
        prev = np.ones_like(x)
        for i in range(octaves):
            o = self.off[(k + i) % 32]
            n = 1 - np.abs(self.perlin(x * freq + o[0], y * freq + o[1], z * freq + o[2]))
            n = n * n
            s += a * n * prev
            prev = np.clip(n * 1.2, 0, 1)
            norm += a
            a *= gain
            freq *= lac
        return s / F(norm)

    def cells(self, P, freq, k=11):
        """Worley noise: distances to the nearest and second-nearest random feature points."""
        x, y, z = (c * freq for c in P)
        x0, y0, z0 = np.floor(x), np.floor(y), np.floor(z)
        d1 = np.full_like(x, 9.0)
        d2 = np.full_like(x, 9.0)
        p = self.p
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    cx, cy, cz = x0 + dx, y0 + dy, z0 + dz
                    h = p[(p[(p[(cx.astype(np.int32) + k) & 255] + cy.astype(np.int32)) & 511] + cz.astype(np.int32)) & 511]
                    fx = cx + (self.gx[h] * 0.35 + 0.5)
                    fy = cy + (self.gy[h] * 0.35 + 0.5)
                    fz = cz + (self.gz[(h + 77) & 255] * 0.35 + 0.5)
                    d = np.sqrt((x - fx) ** 2 + (y - fy) ** 2 + (z - fz) ** 2)
                    nd2 = np.where(d < d1, d1, np.minimum(d2, d))
                    d1 = np.minimum(d1, d)
                    d2 = nd2
        return d1, d2


# ---------------------------------------------------------------- grid & helpers

def grid(w=W):
    h = w // 2
    lon = ((np.arange(w, dtype=np.float64) + 0.5) / w * 2 * math.pi - math.pi).astype(F)
    lat = (math.pi / 2 - (np.arange(h, dtype=np.float64) + 0.5) / h * math.pi).astype(F)
    LON, LAT = np.meshgrid(lon, lat)
    cl = np.cos(LAT)
    P = (cl * np.cos(LON), cl * np.sin(LON), np.sin(LAT))
    return LON, LAT, P


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def mix(a, b, t):
    return a + (b - a) * t


def lerp3(c0, c1, t):
    t = t[..., None]
    return np.asarray(c0, F) * (1 - t) + np.asarray(c1, F) * t


def srgb(lin):
    lin = np.clip(lin, 0, 1)
    return np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(lin, 1 / 2.4) - 0.055)


def save(img_lin_or_raw, body, kind, linear=True, q=86):
    d = os.path.join(OUT, body)
    os.makedirs(d, exist_ok=True)
    a = srgb(img_lin_or_raw) if linear else np.clip(img_lin_or_raw, 0, 1)
    im = Image.fromarray((a * 255 + 0.5).astype(np.uint8), 'RGB')
    w = im.size[0]
    tiers = sorted({w, 2048, 1024} if w >= 2048 else {w})
    for tw in tiers:
        out = im if tw == w else im.resize((tw, tw // 2), Image.LANCZOS)
        out.save(os.path.join(d, f'{kind}_{tw}.webp'), quality=q, method=6)
    print(f'  {body}/{kind} {tiers}', flush=True)


def normal_map(height, relief):
    """Tangent-space normals (x east, y north) from a height field in km-ish units scaled by `relief`."""
    h, w = height.shape
    lat = (math.pi / 2 - (np.arange(h) + 0.5) / h * math.pi).astype(F)
    cl = np.maximum(np.cos(lat), 0.02)[:, None]
    dx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) / (2 * (2 * math.pi / w) * cl)
    hp = np.vstack([height[:1], height, height[-1:]])
    dy = (hp[:-2] - hp[2:]) / (2 * (math.pi / h))  # north minus south
    nx, ny = -dx * relief, -dy * relief
    nz = np.ones_like(nx)
    l = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx / l, ny / l, nz / l], axis=-1) * 0.5 + 0.5


def craters(P, count, rmin, rmax, seed, slope=2.2):
    """Height of a population of impact craters (bowl, raised rim, faint ejecta). Radii in radians."""
    rng = np.random.default_rng(seed)
    x, y, z = P
    out = np.zeros_like(x)
    u = rng.uniform(0, 1, count)
    radii = rmin * (1 - u * (1 - (rmin / rmax) ** slope)) ** (-1 / slope)
    for r in radii:
        c = rng.normal(size=3)
        c /= np.linalg.norm(c)
        cosd = x * c[0] + y * c[1] + z * c[2]
        near = cosd > math.cos(min(r * 3.2, math.pi))
        if not near.any():
            continue
        d = np.arccos(np.clip(cosd[near], -1, 1)) / r
        depth = 0.22 * r ** 0.85
        bowl = np.where(d < 1, (d * d - 1) * depth, 0)
        rim = np.exp(-((d - 1) / 0.18) ** 2) * depth * 0.45
        ej = np.where(d > 1, np.exp(-(d - 1) * 2.2) * depth * 0.08, 0)
        out[near] += (bowl + rim + ej).astype(F)
    return out


# ---------------------------------------------------------------- rocky, tidally locked worlds

def molten_world(body, seed, t_ss, ocean, palette):
    """A tidally locked rock with the star overhead at longitude 0. t_ss: sub-stellar temperature (K);
    rock is molten above about 1500 K. ocean: 0..1, how much of the melt is open rather than crusted."""
    n = Noise(seed)
    LON, LAT, P = grid()
    x, y, z = P
    cosz = x  # the star stands at +X (longitude 0, latitude 0)
    T = t_ss * np.power(np.clip(cosz, 0, 1), 0.25)

    # terrain: dark flood-basalt lowlands, rough cratered highlands
    wx = n.fbm(P, 1.6, 4, k=20)
    Pw = (x + wx * 0.35, y + wx * 0.2, z - wx * 0.3)
    continents = n.fbm(Pw, 1.4, 5, 0.5, k=1)
    lowland = smooth(0.06, -0.08, continents)
    rough = n.fbm(Pw, 4.0, 8, 0.55, k=3) * 0.5 + n.ridged(P, 6.0, 6, 0.5, k=9) * 0.6
    height = continents * 0.8 + rough * (1 - lowland * 0.75) * 0.5
    crat = craters(P, 1600, 0.003, 0.2, seed + 1)
    # the hot side has been resurfaced: craters survive only beyond the old shore
    crust_age = smooth(0.5, 0.1, cosz + n.fbm(P, 3.0, 4, k=15) * 0.08)
    height = height + crat * 1.8 * crust_age * (1 - lowland * 0.5)

    # where the ground is molten; the shoreline wanders with the terrain
    Tn = T + n.fbm(P, 3.5, 5, k=14) * 90 + continents * 160
    melt = smooth(1470, 1530, Tn)

    # the melt: bright, slowly churning magma with dark skins of cooling crust drawn out by the flow,
    # breaking into rafts that crowd together toward the cooler shore
    sw = n.fbm(Pw, 4.0, 5, k=5)
    Pf = (x + sw * 0.18, y - sw * 0.25, z + sw * 0.2)
    flow = n.fbm(Pf, 9.0, 6, 0.55, k=24)
    skins = smooth(0.62, 0.9, n.ridged(Pf, 7.0, 5, 0.55, k=26))
    d1, d2 = n.cells((x + sw * 0.12, y + wx * 0.06, z - sw * 0.1), 18.0)
    d1b, d2b = n.cells((x + sw * 0.05, y, z + sw * 0.04), 60.0, k=29)
    cool = smooth(1500 + 380 * ocean, 1520, Tn) + (flow * 0.5 + 0.2) * 0.35
    raft = smooth(0.04, 0.14, d2 - d1) * smooth(0.35, 0.8, cool)
    crack = 1 - smooth(0.0, 0.03, d2b - d1b)
    raft = np.clip(raft * (1 - crack * 0.85) + skins * smooth(0.0, 0.6, cool) * 0.6, 0, 1)

    # temperatures for the glow (aux.r): open melt near local equilibrium, rafts dull red, the cracks
    # between them hot, and fissures in the solid shore fading out with distance from the melt
    # hottest under the star; churning cells and cooler skins break it into bright and dull patches
    t_open = np.minimum(Tn, t_ss) * (0.93 + 0.12 * flow) - skins * 220
    glowT = melt * ((1 - raft) * t_open + raft * (1050 + 150 * flow))
    glowT = np.maximum(glowT, melt * raft * crack * (t_open * 0.95))
    shore = smooth(1200, 1500, Tn) * (1 - melt)
    fiss = (1 - smooth(0.0, 0.02, d2 - d1)) * shore * smooth(-0.1, 0.35, n.fbm(P, 6.0, 4, k=27))
    glowT = np.maximum(glowT, fiss * (1100 + 300 * smooth(1200, 1500, Tn)))
    aux_r = np.where(glowT > 900, (glowT - 800) / 1600, 0).astype(F)

    # albedo
    pal = palette
    tint = n.fbm(P, 3.0, 6, k=19) * 0.5 + 0.5
    high = lerp3(pal['rock'], pal['high'], smooth(0.0, 0.5, height))
    rock = mix(high, lerp3(pal['dark'], pal['rock'], tint * 0.6), lowland[..., None])
    rock = rock * (0.85 + 0.3 * tint[..., None]) * (1 + n.fbm(P, 30.0, 4, k=22)[..., None] * 0.12)
    rock = mix(rock, lerp3(pal['rock'], pal['oxide'], smooth(0.5, 0.85, tint)), 0.4 * (1 - lowland[..., None]))
    # frozen flows running out from the shore, and rock-vapour frost deposited on the night side
    band = smooth(0.45, 0.25, cosz) * smooth(-0.35, 0.05, cosz)
    flows = smooth(0.3, 0.7, n.ridged(Pw, 7.0, 4, k=13)) * band * (1 - melt)
    rock = mix(rock, np.asarray(pal['glass'], F) * np.ones_like(rock), (flows * 0.75)[..., None])
    night = smooth(0.0, -0.6, cosz)
    frost = night * smooth(0.0, 0.6, n.fbm(P, 5.0, 6, k=21) + 0.1 + night * 0.2)
    rock = mix(rock, np.asarray(pal['frost'], F) * np.ones_like(rock), (frost * pal['frost_k'])[..., None])
    rays = smooth(0.0, 0.03, crat) * crust_age  # fresh ejecta is brighter
    rock = rock * (1 + rays[..., None] * 0.35)
    melt_col = lerp3(pal['melt'], pal['crust'], raft)
    alb = mix(rock, melt_col, melt[..., None])

    save(alb, body, 'map')
    save(normal_map((height * (1 - melt * 0.92)).astype(F), 0.8), body, 'normal', linear=False)
    save(np.stack([aux_r, np.zeros_like(aux_r), np.zeros_like(aux_r)], axis=-1), body, 'aux', linear=False, q=90)


# ---------------------------------------------------------------- sub-Neptunes

def banded_world(body, seed, palette, bands, turb, storms, haze=0.0, contrast=1.0, polar=None, spots=24):
    """Zonal bands sheared by jets, turbulent band edges, and long-lived vortices large and small."""
    n = Noise(seed)
    rng = np.random.default_rng(seed + 5)
    LON, LAT, P = grid()

    # small ovals scattered along the band edges, plus the named big storms
    allstorms = list(storms)
    sc_list = list(palette.get('storms', [])) + [None] * (len(storms) - len(palette.get('storms', [])))
    for _ in range(spots):
        la = math.asin(rng.uniform(-0.85, 0.85))
        size = rng.uniform(0.008, 0.028)
        allstorms.append((la, rng.uniform(-math.pi, math.pi), size * rng.uniform(1.3, 2.2), size, rng.choice([-1, 1]) * rng.uniform(1.5, 3.0)))
        sc_list.append('spot')

    # vortices swirl the sampling coordinates
    lonw, latw = LON.copy(), LAT.copy()
    for (slat, slon, a, b, spin) in allstorms:
        dlon = np.mod(LON - slon + math.pi, 2 * math.pi) - math.pi
        box = (np.abs(dlon) < a * 4 / max(math.cos(slat), 0.2)) & (np.abs(LAT - slat) < b * 4)
        if not box.any():
            continue
        ex = dlon[box] * math.cos(slat) / a
        ey = (LAT[box] - slat) / b
        r2 = ex * ex + ey * ey
        ang = spin * np.exp(-r2 * 1.4)
        ca, sa = np.cos(ang), np.sin(ang)
        lonw[box] = slon + (ex * ca - ey * sa) * a / math.cos(slat)
        latw[box] = slat + (ex * sa + ey * ca) * b

    def stretched(lo, la, sx, sz):
        c = np.cos(la)
        return (c * np.cos(lo) * sx, c * np.sin(lo) * sx, la * sz)

    # jets shear the turbulence: alternate bands drift east and west, so eddies tilt into chevrons
    jet = np.sin(latw * bands * 0.5 + 0.7)
    lo2 = lonw + jet * 0.3
    w1 = n.fbm(stretched(lo2, latw, 2.0, 7.0), 1.0, 6, 0.55, k=0)
    w2 = n.fbm(stretched(lo2 + w1 * 0.5, latw + w1 * 0.04, 4.5, 26.0), 1.0, 6, 0.55, k=6)
    w3 = n.fbm(stretched(lo2 + w2 * 0.4 + jet * 0.15, latw + w2 * 0.02, 10.0, 70.0), 1.0, 5, 0.6, k=10)
    latq = latw + (w1 * 0.07 + w2 * 0.035 + w3 * 0.012) * turb
    s = np.sin(latq)
    prof = np.zeros_like(s)
    for f, ph, amp in zip(rng.uniform(0.6, 1.4, 6) * bands, rng.uniform(0, 6.28, 6), [1, 0.6, 0.45, 0.3, 0.25, 0.2]):
        prof += amp * np.sin(s * f * math.pi * 0.5 + ph)
    prof = smooth(0.12, 0.88, prof / 2.8 * 0.5 + 0.5)
    col = lerp3(palette['belt'], palette['zone'], prof)
    # band brightness drifts along each band, and fine filaments trace the flow
    along = n.fbm(stretched(lo2, latq, 1.5, 12.0), 1.0, 4, k=14)
    fil = n.fbm(stretched(lo2 + w3 * 0.5, latq, 14.0, 110.0), 1.0, 4, 0.6, k=12)
    edges = np.clip(np.abs(np.gradient(prof, axis=0)) * W * 0.015, 0, 1)
    det = (along * 0.12 + fil * (0.06 + 0.22 * edges) + w3 * 0.08 * edges) * turb * contrast
    col = col * (1 + det[..., None])
    accent = smooth(0.15, 0.65, n.fbm(stretched(lo2 + w1 * 0.8, latq, 3.0, 20.0), 1.0, 5, k=18)) * palette.get('accent_k', 0.3)
    col = mix(col, np.asarray(palette['accent'], F) * np.ones_like(col), accent[..., None])
    # storm ovals: their own colour, with a soft collar
    for (slat, slon, a, b, spin), sc in zip(allstorms, sc_list):
        if sc is None:
            continue
        dlon = np.mod(LON - slon + math.pi, 2 * math.pi) - math.pi
        box = (np.abs(dlon) < a * 3 / max(math.cos(slat), 0.2)) & (np.abs(LAT - slat) < b * 3)
        if not box.any():
            continue
        r = np.sqrt((dlon[box] * math.cos(slat) / a) ** 2 + ((LAT[box] - slat) / b) ** 2)
        if sc == 'spot':
            k = rng.uniform(0.25, 0.6)
            c = np.asarray(palette['zone'], F) * 1.25 if rng.uniform() < 0.7 else np.asarray(palette['belt'], F) * 0.8
        else:
            k, c = 0.85, np.asarray(sc, F)
        core = smooth(1.0, 0.35, r + w3[box] * 0.2) * k
        col[box] = mix(col[box], c * np.ones_like(col[box]), core[..., None])
    if polar is not None:
        pk = smooth(math.radians(polar[0]), math.radians(polar[1]), np.abs(LAT) + w1 * 0.06)
        col = mix(col, np.asarray(palette['pole'], F) * np.ones_like(col), (pk * polar[2])[..., None])
    if haze:
        mean = col.reshape(-1, 3).mean(axis=0)
        col = mix(col, mean * np.ones_like(col), haze)
    save(col, body, 'map')


def cloud_world(body, seed, palette):
    """A closed cloud deck: broad chevrons and streaks from the super-rotating upper atmosphere."""
    n = Noise(seed)
    LON, LAT, P = grid()

    def stretched(lo, la, sx, sz):
        c = np.cos(la)
        return (c * np.cos(lo) * sx, c * np.sin(lo) * sx, la * sz)

    # the equatorial flow runs fastest, bending streaks into a sideways Y
    lo = LON + 0.55 * np.abs(LAT) ** 1.1
    w = n.fbm(stretched(lo, LAT, 2.0, 5.0), 1.0, 6, k=1)
    streak = n.fbm(stretched(lo + w * 0.6, LAT + w * 0.06, 2.5, 9.0), 1.0, 7, 0.5, k=4)
    mott = n.fbm(P, 7.0, 5, k=9)
    t = smooth(-0.6, 0.6, streak * 0.7 + w * 0.5)
    col = lerp3(palette['dark'], palette['bright'], t)
    col = col * (1 + mott[..., None] * 0.05)
    pole = smooth(math.radians(55), math.radians(80), np.abs(LAT) + w * 0.04)
    col = mix(col, np.asarray(palette['pole'], F) * np.ones_like(col), (pole * 0.6)[..., None])
    save(col, body, 'map')


def star_surface(body, seed, base):
    n = Noise(seed)
    LON, LAT, P = grid(2048)
    x, y, z = P
    g = n.cells(P, 90.0)
    gran = smooth(0.0, 0.25, g[1] - g[0])
    sg = n.fbm(P, 12.0, 4, k=3)
    lum = 0.88 + 0.1 * gran + 0.06 * sg
    # a few small spots in the active latitudes
    rng = np.random.default_rng(seed)
    for _ in range(9):
        la = math.radians(rng.choice([-1, 1]) * rng.uniform(8, 30))
        lo = rng.uniform(-math.pi, math.pi)
        c = (math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la))
        d = np.arccos(np.clip(x * c[0] + y * c[1] + z * c[2], -1, 1))
        r = rng.uniform(0.008, 0.02)
        lum = lum * (1 - 0.55 * smooth(r, r * 0.4, d) - 0.25 * smooth(r * 2.2, r, d))
    col = np.asarray(base, F) * lum[..., None]
    save(col, body, 'map', q=84)


# ---------------------------------------------------------------- the system

def job(name):
    if name == 'kepler385':
        star_surface('kepler385', 385, (1.0, 0.86, 0.66))
    elif name == 'koi2433-08':
        molten_world('koi2433-08', 808, 1931, 1.0, {
            'dark': (0.045, 0.041, 0.039), 'rock': (0.075, 0.066, 0.06), 'high': (0.105, 0.094, 0.084), 'oxide': (0.13, 0.075, 0.05),
            'glass': (0.03, 0.028, 0.03), 'frost': (0.15, 0.135, 0.115), 'frost_k': 0.5,
            'melt': (0.05, 0.022, 0.012), 'crust': (0.04, 0.035, 0.033),
        })
    elif name == 'koi2433-06':
        molten_world('koi2433-06', 606, 1566, 0.5, {
            'dark': (0.055, 0.05, 0.046), 'rock': (0.095, 0.082, 0.07), 'high': (0.13, 0.112, 0.095), 'oxide': (0.2, 0.11, 0.065),
            'glass': (0.045, 0.04, 0.042), 'frost': (0.15, 0.14, 0.125), 'frost_k': 0.3,
            'melt': (0.055, 0.025, 0.014), 'crust': (0.05, 0.042, 0.038),
        })
    elif name == 'kepler385b':
        # ~975 K: hydrogen sky over alkali-salt clouds; deep blue like HD 189733 b
        banded_world('kepler385b', 1385, {
            'belt': (0.035, 0.085, 0.24), 'zone': (0.16, 0.25, 0.42), 'accent': (0.36, 0.42, 0.52), 'accent_k': 0.35,
            'pole': (0.03, 0.06, 0.18), 'storms': [(0.34, 0.42, 0.55), None, (0.05, 0.1, 0.27)],
        }, bands=9, turb=1.0, storms=[(math.radians(-22), 1.2, 0.09, 0.05, 2.6), (math.radians(31), -2.0, 0.05, 0.03, -2.2), (math.radians(-48), -0.4, 0.06, 0.035, 2.0)],
            haze=0.1, polar=(55, 78, 0.6))
    elif name == 'kepler385c':
        # ~850 K: thicker salt and sulfide clouds; steel blue-grey belts
        banded_world('kepler385c', 2385, {
            'belt': (0.11, 0.17, 0.25), 'zone': (0.4, 0.45, 0.5), 'accent': (0.2, 0.32, 0.38), 'accent_k': 0.4,
            'pole': (0.12, 0.17, 0.26), 'storms': [(0.55, 0.58, 0.6), (0.1, 0.18, 0.26)],
        }, bands=12, turb=1.15, storms=[(math.radians(17), 2.4, 0.07, 0.04, -2.4), (math.radians(-35), -1.1, 0.05, 0.03, 2.2)],
            haze=0.15, polar=(60, 82, 0.5))
    elif name == 'koi2433-04':
        # ~690 K, 1.9 Earth radii: a closed, pale cloud deck
        cloud_world('koi2433-04', 404, {'dark': (0.5, 0.44, 0.32), 'bright': (0.8, 0.74, 0.6), 'pole': (0.68, 0.62, 0.5)})
    elif name == 'kepler385d':
        # ~550 K: methane and photochemical haze: butterscotch and cream bands
        banded_world('kepler385d', 3385, {
            'belt': (0.36, 0.22, 0.1), 'zone': (0.66, 0.53, 0.36), 'accent': (0.5, 0.33, 0.17), 'accent_k': 0.3,
            'pole': (0.38, 0.28, 0.18), 'storms': [(0.8, 0.68, 0.5), (0.32, 0.18, 0.08), None],
        }, bands=10, turb=1.1, storms=[(math.radians(-18), 0.6, 0.08, 0.045, 2.4), (math.radians(26), -2.6, 0.05, 0.03, -2.0), (math.radians(44), 1.5, 0.04, 0.025, -2.0)],
            haze=0.12, polar=(58, 80, 0.55))
    elif name == 'koi2433-07':
        # ~480 K: methane-rich and hazy: muted grey-green with a tan haze over the poles
        banded_world('koi2433-07', 707, {
            'belt': (0.25, 0.33, 0.31), 'zone': (0.45, 0.52, 0.48), 'accent': (0.48, 0.44, 0.34), 'accent_k': 0.25,
            'pole': (0.45, 0.4, 0.3), 'storms': [(0.6, 0.64, 0.6)],
        }, bands=8, turb=0.8, storms=[(math.radians(-28), -1.8, 0.06, 0.035, 2.0)], haze=0.25, contrast=0.8, polar=(50, 75, 0.7))


if __name__ == '__main__':
    names = ['koi2433-08', 'koi2433-06', 'kepler385b', 'kepler385c', 'koi2433-04', 'kepler385d', 'koi2433-07', 'kepler385']
    if ONLY:
        names = [x for x in names if x in ONLY]
    with Pool(min(4, len(names))) as pool:
        pool.map(job, names)
