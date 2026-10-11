#!/usr/bin/env python3
"""Builds the face-on Milky Way for the galaxy map: public/textures/galaxy_map_2048.webp.

Usage: python3 tools/build_galaxy_map.py [public/textures] [size]

Nobody can photograph our galaxy from outside, so this is a model drawn from what radio, maser and
Gaia surveys have mapped (Reid et al. 2019; Gaia DR3 for the Local Arm): a central bar about 5 kpc
long tilted 27 degrees from the Sun-centre line, two major spiral arms (Scutum-Centaurus and Perseus),
two minor ones (Sagittarius-Carina and Norma, which becomes the Outer arm), all logarithmic spirals
with a 12 degree pitch, and the short Local (Orion) Arm the Sun sits in. Arms carry young blue stars,
pink star-forming nebulae and dark dust lanes on their inner edges; the bulge is old and yellow.

The image covers 36 x 36 kpc centred on the Galactic Centre. Up is from the Sun toward the centre;
seen from the north galactic pole, so galactic longitude 90 degrees (the way the Sun orbits) is left.
"""
import math
import sys

import numpy as np
from PIL import Image

OUT = sys.argv[1] if len(sys.argv) > 1 else 'public/textures'
N = int(sys.argv[2]) if len(sys.argv) > 2 else 2048
HALF = 18.0  # kpc
R0 = 8.178
rng = np.random.default_rng(1)

# pixel grid -> galactocentric (X toward the Sun's side reversed: Sun at X = -R0), Y = galactic l=90 direction
px = (np.arange(N) + 0.5) / N * 2 * HALF - HALF
sxg, syg = np.meshgrid(px, -px)  # screen x right, screen y up
# screen up = toward the centre from the Sun = +X_gc; screen left = +Y
X = syg
Y = -sxg
R = np.hypot(X, Y)
TH = np.arctan2(Y, X)  # the Sun is at theta = pi


def noise(scale, octaves=4, seed=0):
    """Smooth value noise on the plane (bilinear upsampled random grids)."""
    r = np.random.default_rng(seed)
    out = np.zeros((N, N))
    amp = 1.0
    tot = 0.0
    for o in range(octaves):
        g = int(scale * 2 ** o) + 2
        grid = r.uniform(size=(g, g))
        img = Image.fromarray((grid * 255).astype(np.uint8)).resize((N, N), Image.BICUBIC)
        out += amp * np.asarray(img, float) / 255
        tot += amp
        amp *= 0.5
    return out / tot


K = math.tan(math.radians(12.0))
# real arms wander: warp the coordinates a little so none is a perfect curve
RW = R * (1 + 0.07 * (noise(5, 3, 21) - 0.5))
TW = TH + 0.16 * (noise(6, 3, 22) - 0.5)


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def arm(r_at_sun, width, th_min=-1e9, th_max=1e9, k=K, fade=0.9):
    """Gaussian profile around a log spiral R = r_at_sun * exp(k (theta - pi)), over every turn, fading out at its ends."""
    prof = np.zeros((N, N))
    for turn in range(-2, 3):
        th = TW + 2 * np.pi * turn
        ra = r_at_sun * np.exp(k * (th - np.pi))
        win = smooth(th_min, th_min + fade, th) * smooth(th_max, th_max - fade, th)
        # arms are wider and fainter farther out
        w = width * (0.75 + 0.25 * ra / 8.0)
        prof = np.maximum(prof, np.exp(-0.5 * ((RW - ra) / w) ** 2) * win)
    return prof


# arms: (radius where they cross the Sun's azimuth, width kpc, strength, theta range)
arms = [
    ('perseus', 10.3, 0.42, 1.0, (np.pi - 3.6, np.pi + 3.4)),
    ('sagittarius', 7.0, 0.30, 0.6, (np.pi - 2.6, np.pi + 3.8)),
    ('scutum', 5.1, 0.40, 1.0, (np.pi - 3.6, np.pi + 3.6)),
    ('norma', 3.75, 0.32, 0.65, (np.pi - 1.8, np.pi + 5.0)),
]
spiral = np.zeros((N, N))
dust = np.zeros((N, N))
young = np.zeros((N, N))
for name, ra, w, s_, (a, b) in arms:
    taper = np.clip((R - 2.6) / 1.5, 0, 1) * np.exp(-np.maximum(R - 12.0, 0) / 3.0)
    prof = arm(ra, w, a, b)
    spiral += s_ * prof * taper
    # dust lanes hug the inner (concave) edge
    dust += s_ * arm(ra * 0.955, w * 0.5, a, b) * taper
    young += s_ * prof ** 2 * taper
# the Local (Orion) Arm: a short spur through the Sun
k_loc = math.tan(math.radians(11.4))
local = arm(8.35, 0.2, np.pi - 0.55, np.pi + 0.5, k_loc, 0.3)
spiral += 0.5 * local
young += 0.45 * local ** 2
dust += 0.3 * arm(8.35 * 0.97, 0.07, np.pi - 0.55, np.pi + 0.5, k_loc, 0.3)
# feathers and spurs between the arms
spurs = np.clip(noise(14, 4, 31) - 0.52, 0, 1) * 1.6 * np.exp(-np.maximum(R - 4, 0) / 6) * (R > 3)
spiral += spurs * 0.35

# clumpy structure along the arms
clump = noise(36, 5, 3)
breaks = smooth(0.25, 0.6, noise(9, 3, 4))
mottle = noise(220, 2, 6)
spiral *= (0.2 + 1.5 * clump ** 2) * (0.35 + 0.65 * breaks) * (0.7 + 0.6 * mottle)
fine = noise(90, 3, 5)

# disc, bulge and bar
disc = np.exp(-R / 3.2) * np.clip(R / 1.2, 0.3, 1) * (0.75 + 0.5 * noise(10, 4, 41))
bar_ang = math.radians(27.0)  # near end toward positive longitude
bx = X * math.cos(bar_ang) + Y * math.sin(bar_ang)
by = -X * math.sin(bar_ang) + Y * math.cos(bar_ang)
bar = np.exp(-((bx / 2.6) ** 2 + (by / 0.85) ** 2) ** 1.0)
bulge = np.exp(-(R / 0.9) ** 1.4)
ring3 = np.exp(-0.5 * ((np.hypot(bx / 1.15, by) - 3.2) / 0.35) ** 2) * 0.35  # the 3 kpc arms round the bar

old = disc * 0.55 + bar * 0.9 + bulge * 1.6 + ring3
img = np.zeros((N, N, 3))
img += old[..., None] * np.array([1.0, 0.82, 0.58])
img += (spiral * (0.55 + 0.45 * fine))[..., None] * np.array([0.62, 0.74, 1.0]) * 0.75
# star-forming regions: pink knots on the arms
knots = smooth(0.7, 0.8, noise(160, 2, 11)) * young
img += knots[..., None] * np.array([1.0, 0.35, 0.55]) * 0.55
# dust
img *= (1 - np.clip(dust * 0.75 * smooth(0.3, 0.8, noise(50, 4, 7)), 0, 0.8))[..., None]
# a faint halo of stars around it all
img += (np.exp(-R / 9.0) * 0.05)[..., None] * np.array([0.7, 0.75, 0.9])

# sprinkle of stars, denser in the arms
stars = rng.uniform(size=(N, N)) ** 220 * (0.4 + 3 * spiral + 2 * old)
img += np.clip(stars, 0, 1.5)[..., None] * np.array([0.9, 0.93, 1.0])

# tone map and fade at the edges
img = 1 - np.exp(-img * 1.6)
edge = np.clip((HALF - R) / 2.5, 0, 1)
img *= edge[..., None]
img = np.clip(img, 0, 1) ** (1 / 1.25)
out = f'{OUT}/galaxy_map_{N}.webp'
Image.fromarray((img * 255).astype(np.uint8)).save(out, quality=82, method=6)
print(out)
