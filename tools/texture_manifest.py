#!/usr/bin/env python3
"""Scans public/textures and writes src/data/textures.json:
{body: {kind: [whole-globe widths...], "tiles": {kind: [tiled widths...]}}}."""
import json, os, re, sys

root = sys.argv[1] if len(sys.argv) > 1 else 'public/textures'
out = sys.argv[2] if len(sys.argv) > 2 else 'src/data/textures.json'
man = {}
for body in sorted(os.listdir(root)):
    d = os.path.join(root, body)
    if not os.path.isdir(d):
        continue
    for fn in os.listdir(d):
        m = re.match(r'([a-z]+)_(\d+)\.webp$', fn)
        if m:
            man.setdefault(body, {}).setdefault(m.group(1), []).append(int(m.group(2)))
        m = re.match(r'([a-z]+)_(\d+)$', fn)
        if m and os.path.isdir(os.path.join(d, fn)):
            man.setdefault(body, {}).setdefault('tiles', {}).setdefault(m.group(1), []).append(int(m.group(2)))
for b in man.values():
    for k, v in b.items():
        if k == 'tiles':
            for t in v.values():
                t.sort()
        else:
            v.sort()
json.dump(man, open(out, 'w'), indent=1, sort_keys=True)
print(f'wrote {out} ({len(man)} bodies)')
