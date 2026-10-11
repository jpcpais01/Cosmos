#!/usr/bin/env python3
"""Cuts the large texture tiers into 512x512 tiles for visible-area streaming.

Usage: python3 tools/build_tiles.py [public/textures]

For every <body>/<kind>_<W>.webp with W >= 4096 this writes <body>/<kind>_<W>/<x>_<y>.webp,
where x counts columns from the left (west, longitude -180) and y counts rows from the
bottom (south), then deletes the whole-globe file. Bodies that are left without a
2048-wide whole-globe tier get one, downscaled from the largest tier, so the always-resident
low-resolution map stays reasonably sharp. Re-run tools/texture_manifest.py afterwards.
"""
import os
import re
import sys

from PIL import Image

Image.MAX_IMAGE_PIXELS = None
ROOT = sys.argv[1] if len(sys.argv) > 1 else 'public/textures'
TILE = 512
Q = {'map': 84, 'aux': 84, 'normal': 86}

for body in sorted(os.listdir(ROOT)):
    d = os.path.join(ROOT, body)
    if not os.path.isdir(d) or body in ('sky', 'sun'):  # the Sun shader samples whole maps only
        continue
    tiers = {}
    for fn in os.listdir(d):
        m = re.match(r'([a-z]+)_(\d+)\.webp$', fn)
        if m:
            tiers.setdefault(m.group(1), []).append(int(m.group(2)))
    for kind, widths in tiers.items():
        big = sorted(w for w in widths if w >= 4096)
        if not big:
            continue
        if 2048 not in widths:
            src = Image.open(os.path.join(d, f'{kind}_{big[0]}.webp'))
            src.convert('RGB').resize((2048, 1024), Image.LANCZOS).save(os.path.join(d, f'{kind}_2048.webp'), quality=Q[kind], method=6)
            print(f'{body}/{kind}_2048.webp (new low tier)')
        for w in big:
            path = os.path.join(d, f'{kind}_{w}.webp')
            im = Image.open(path).convert('RGB')
            assert im.size == (w, w // 2), (path, im.size)
            out = os.path.join(d, f'{kind}_{w}')
            os.makedirs(out, exist_ok=True)
            nx, ny = w // TILE, (w // 2) // TILE
            for x in range(nx):
                for y in range(ny):
                    top = (ny - 1 - y) * TILE
                    im.crop((x * TILE, top, (x + 1) * TILE, top + TILE)).save(
                        os.path.join(out, f'{x}_{y}.webp'), quality=Q[kind], method=6)
            os.remove(path)
            print(f'{body}/{kind}_{w}: {nx}x{ny} tiles')
