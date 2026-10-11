#!/usr/bin/env python3
"""Pack the Hipparcos-based star catalog from d3-celestial (BSD-3) into a compact binary.

Usage: python3 tools/build_stars.py <path/to/stars.14.json> public/data/stars.bin [maglimit]

Output layout (little endian), 8 bytes per star, sorted bright -> faint:
  int16 x3  unit direction in the game's world frame (ecliptic J2000, Y = ecliptic north), * 32767
  uint8     magnitude encoded as round((mag + 2) * 16)   (range -2 .. 13.9)
  uint8     B-V colour index encoded as round((bv + 0.5) * 100) clamped 0..255  (range -0.5 .. 2.05)
"""
import json, math, struct, sys

src, dst = sys.argv[1], sys.argv[2]
maglim = float(sys.argv[3]) if len(sys.argv) > 3 else 10.5
EPS = math.radians(23.4392911)
ce, se = math.cos(EPS), math.sin(EPS)

stars = []
for f in json.load(open(src))['features']:
    mag = float(f['properties']['mag'])
    if mag > maglim:
        continue
    bv = f['properties'].get('bv')
    try:
        bv = float(bv)
    except (TypeError, ValueError):
        bv = 0.65
    lon, lat = f['geometry']['coordinates']
    ra = math.radians(lon % 360.0)
    dec = math.radians(lat)
    x, y, z = math.cos(dec) * math.cos(ra), math.cos(dec) * math.sin(ra), math.sin(dec)
    # EQJ -> ecliptic J2000
    ex, ey, ez = x, ce * y + se * z, -se * y + ce * z
    # ecliptic -> game world (X = x, Y = north, Z = -y)
    wx, wy, wz = ex, ez, -ey
    stars.append((mag, wx, wy, wz, bv))

stars.sort(key=lambda s: s[0])
out = bytearray()
for mag, wx, wy, wz, bv in stars:
    q = lambda v: max(-32767, min(32767, int(round(v * 32767))))
    m = max(0, min(255, int(round((mag + 2.0) * 16))))
    b = max(0, min(255, int(round((bv + 0.5) * 100))))
    out += struct.pack('<hhhBB', q(wx), q(wy), q(wz), m, b)
open(dst, 'wb').write(out)
print(f'{len(stars)} stars <= mag {maglim} -> {dst} ({len(out)/1024:.0f} KiB)')
