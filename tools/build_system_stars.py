#!/usr/bin/env python3
"""Builds the bright-star sky seen from Kepler-385: public/data/stars_kepler385_v2.bin.

Usage: python3 tools/build_system_stars.py [public/data/stars_kepler385_v2.bin] [maglimit]

Kepler-385 is 1,516 pc from the Sun and 360 pc above the galactic plane, so none of our familiar stars
are near it: almost all of them are too far away to see from there, and its own neighbours have never
been catalogued. Its sky is therefore filled statistically: stars are drawn from a model of the Milky
Way's disc around Kepler-385 (thin and thick discs with exponential scale lengths and heights, a local
luminosity function, younger and brighter stars hugging the plane more closely, and a dust layer that
dims light passing near the plane), then kept if they would shine brighter than the magnitude limit.
The result has the right number of stars of each brightness and colour, and more of them toward the
galactic plane, which from 360 pc above it lies a little below the Milky Way's band. Past magnitude 6
the faint stars are thinned to the completeness of the Sun's catalogue, so both skies look alike.

Same layout as tools/build_stars.py (int16 x3 direction * 32767, uint8 (mag + 2) * 16, uint8
(B-V + 0.5) * 100), with directions in Kepler-385's frame (src/sim/systems.ts: +X toward the Sun,
+Y the orbital pole, taken as close to galactic north as the transits allow).
"""
import math
import struct
import sys

import numpy as np

DST = sys.argv[1] if len(sys.argv) > 1 else 'public/data/stars_kepler385_v2.bin'
MAGLIM = float(sys.argv[2]) if len(sys.argv) > 2 else 9.0
RA, DEC, DIST = 294.3385109, 50.3365178, 1516.0
EPS = math.radians(23.4392911)
rng = np.random.default_rng(385)

# --- frames (match src/sim/frames.ts, galactic.ts and systems.ts)
ce, se = math.cos(EPS), math.sin(EPS)


def eqj_to_world(v):
    x, y, z = v
    return np.array([x, -se * y + ce * z, -(ce * y + se * z)])


w2e = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], float)
e2q = np.array([[1, 0, 0], [0, ce, -se], [0, se, ce]], float)
q2g = np.array([[-0.0548755604, -0.873437090, -0.4838350155],
                [0.4941094279, -0.4448296300, 0.7469822445],
                [-0.8676661490, -0.1980763734, 0.4559837762]])
W2G = q2g @ e2q @ w2e
G2W = W2G.T
r, d = math.radians(RA), math.radians(DEC)
u = eqj_to_world((math.cos(d) * math.cos(r), math.cos(d) * math.sin(r), math.sin(d)))
u /= np.linalg.norm(u)
to_sun = -u
ngp = G2W @ np.array([0, 0, 1.0])
pole = ngp - to_sun * ngp.dot(to_sun)
pole /= np.linalg.norm(pole)
zax = np.cross(to_sun, pole)
TO_ECL = np.stack([to_sun, pole, zax], axis=1)  # local -> ecliptic world
G2L = TO_ECL.T @ G2W  # galactic -> local

# --- the galaxy around Kepler-385 (pc; galactocentric x toward the Sun's side, z to the NGP)
R0, Z0 = 8178.0, 20.8
obs_h = W2G @ u * DIST  # heliocentric galactic offset of Kepler-385
obs = np.array([-R0 + obs_h[0], obs_h[1], Z0 + obs_h[2]])
print(f'Kepler-385 at galactocentric R = {math.hypot(obs[0], obs[1]):.0f} pc, z = {obs[2]:.0f} pc')

# local luminosity function, stars per pc^3 per magnitude at the Sun (V band), with the scale height
# of each population and the colour model
LF = [  # (M_V, density, scale height pc)
    (-6.5, 7e-8, 70), (-5.5, 2.5e-7, 70), (-4.5, 8e-7, 80), (-3.5, 2.5e-6, 90), (-2.5, 8e-6, 110),
    (-1.5, 1.6e-5, 160), (-0.5, 4.5e-5, 220), (0.5, 5.5e-5, 250), (1.5, 1.8e-4, 230), (2.5, 4e-4, 260),
    (3.5, 9e-4, 290), (4.5, 2.6e-3, 300), (5.5, 3.6e-3, 300), (6.5, 4.4e-3, 300), (7.5, 5.2e-3, 300),
    (8.5, 6.0e-3, 300), (9.5, 7.0e-3, 300),
]
HR_THIN, HR_THICK, H_THICK, F_THICK = 2600.0, 3600.0, 900.0, 0.08
DUST_H, DUST_K = 120.0, 0.0007  # mag per pc at the mid-plane


def density(p, h):
    R = np.hypot(p[:, 0], p[:, 1])
    z = np.abs(p[:, 2])
    thin = np.exp(-(R - R0) / HR_THIN - z / h)
    thick = F_THICK * np.exp(-(R - R0) / HR_THICK - z / H_THICK)
    return thin + thick


def extinction(p_rel, dist):
    # integrate the dust layer along the line of sight
    steps = 12
    a = np.zeros(len(dist))
    for i in range(steps):
        f = (i + 0.5) / steps
        z = obs[2] + p_rel[:, 2] * f
        a += np.exp(-np.abs(z) / DUST_H) * dist / steps
    return a * DUST_K


def colour(M, n):
    bv = np.empty(n)
    giant = rng.uniform(size=n) < np.clip((1.5 - M) / 3.0, 0, 0.75)
    ms = -0.3 + 0.17 * (M + 1.5) + rng.normal(0, 0.06, n)
    bv[:] = np.clip(ms, -0.32, 1.9)
    bv[giant] = rng.normal(1.15, 0.2, giant.sum())
    return bv


dirs, mags, bvs = [], [], []
for M, n0, h in LF:
    for sub in range(4):  # spread each bin over its magnitude range
        Ms = M - 0.375 + sub * 0.25
        dmax = min(10 ** ((MAGLIM - Ms + 5) / 5), 9000.0)
        vol = 4 / 3 * math.pi * dmax ** 3
        rho_max = 1.4  # the densest the model gets within reach (mid-plane, slightly inward)
        n_try = rng.poisson(vol * n0 * 0.25 * rho_max)
        if n_try == 0:
            continue
        # uniform points in the sphere, kept in proportion to the model's density there
        batch = 2_000_000
        for start in range(0, n_try, batch):
            m = min(batch, n_try - start)
            v = rng.normal(size=(m, 3))
            v /= np.linalg.norm(v, axis=1, keepdims=True)
            rr = dmax * rng.uniform(size=m) ** (1 / 3)
            rel = v * rr[:, None]
            keep = rng.uniform(size=m) * rho_max < density(obs + rel, h)
            rel, rr = rel[keep], rr[keep]
            if not len(rr):
                continue
            mag = Ms + rng.uniform(-0.125, 0.125, len(rr)) + 5 * np.log10(np.maximum(rr, 1) / 10) + extinction(rel, rr)
            vis = mag <= MAGLIM
            if not vis.any():
                continue
            dg = rel[vis] / rr[vis, None]
            dirs.append(dg @ G2L.T)
            mags.append(mag[vis])
            bvs.append(colour(Ms, vis.sum()) + extinction(rel[vis], rr[vis]) * 0.32)

D = np.concatenate(dirs)
Mg = np.concatenate(mags)
B = np.concatenate(bvs)

# The Sun's own catalogue (public/data/stars.bin) thins out past magnitude 8 as surveys get incomplete.
# Thin these faint stars the same way, magnitude bin by magnitude bin, so the two skies look alike
# rather than this one looking twice as crowded with faint stars.
try:
    sol = np.frombuffer(open('public/data/stars.bin', 'rb').read(), dtype=np.uint8).reshape(-1, 8)
    sol_m = sol[:, 6] / 16.0 - 2
    edges = np.arange(6.0, MAGLIM + 0.25, 0.25)
    keep = np.ones(len(Mg), bool)
    for lo, hi in zip(edges[:-1], edges[1:]):
        mine = (Mg > lo) & (Mg <= hi)
        n_sol = int(((sol_m > lo) & (sol_m <= hi)).sum())
        n_me = int(mine.sum())
        if n_me > n_sol > 0:
            keep[mine] = rng.uniform(size=n_me) < n_sol / n_me
    keep[Mg > edges[-1]] = False
    D, Mg, B = D[keep], Mg[keep], B[keep]
except FileNotFoundError:
    pass
order = np.argsort(Mg)
D, Mg, B = D[order], Mg[order], B[order]
out = bytearray()
for (x, y, z), m, b in zip(D, Mg, B):
    q = lambda c: max(-32767, min(32767, int(round(c * 32767))))
    out += struct.pack('<hhhBB', q(x), q(y), q(z), max(0, min(255, int(round((m + 2) * 16)))), max(0, min(255, int(round((b + 0.5) * 100)))))
open(DST, 'wb').write(out)
counts = [int((Mg <= lim).sum()) for lim in (1, 3, 5, 6.5, 8, MAGLIM)]
print(f'{len(Mg)} stars <= {MAGLIM} -> {DST} ({len(out) / 1024:.0f} KiB); cumulative counts at 1/3/5/6.5/8/{MAGLIM}: {counts}')
print('local frame -> ecliptic:\n', TO_ECL)
