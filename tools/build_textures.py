#!/usr/bin/env python3
"""Builds the game's streamed texture tiers (WebP) from the source maps listed in CREDITS.md.

Usage: python3 tools/build_textures.py <source-dir> <public-dir>

Each body gets map_<width>.webp files (2:1 equirectangular). Earth also gets an
"aux" map (R = clouds, G = ocean mask, B = city lights) and a normal map. The
Milky Way panorama (galactic frame) has its stars removed with a grey-scale
morphological opening so that the real star catalogue can be drawn on top
as sharp points.
"""
import os
import sys

from PIL import Image, ImageChops, ImageFilter

Image.MAX_IMAGE_PIXELS = None
SRC, OUT = sys.argv[1], sys.argv[2]
Q = 84

# body id -> (source file, list of widths)
MAPS = {
    'sun': ('sun.jpg', [1024, 4096]),
    'mercury': ('mercury.jpg', [1024, 4096, 8192]),
    'venus': ('venus_atmosphere.jpg', [1024, 4096]),
    'earth': ('earth_day.jpg', [2048, 4096, 8192]),
    'moon': ('moon.jpg', [1024, 4096, 8192]),
    'mars': ('mars.jpg', [1024, 4096, 8192]),
    'phobos': ('phobos.jpg', [1024, 2048]),
    'deimos': ('deimos.jpg', [1024, 2048]),
    'jupiter': ('jupiter.jpg', [1024, 4096]),
    'io': ('io.jpg', [1024, 4096]),
    'europa': ('europa.jpg', [1024, 4096]),
    'ganymede': ('ganymede.jpg', [1024, 4096]),
    'callisto': ('callisto.jpg', [1024, 4096]),
    'saturn': ('saturn.jpg', [1024, 4096]),
    'mimas': ('mimas.jpg', [1024, 2048]),
    'enceladus': ('enceladus.jpg', [1024, 2048]),
    'tethys': ('tethys.jpg', [1024, 2048]),
    'dione': ('dione.jpg', [1024, 2048]),
    'rhea': ('rhea.jpg', [1024, 2048]),
    'titan': ('titan.jpg', [1024, 4096]),
    'iapetus': ('iapetus.jpg', [1024, 2048]),
    'uranus': ('uranus.jpg', [1024, 2048]),
    'miranda': ('alt/miranda_celestia_iau.jpg', [1024, 2048]),
    'ariel': ('alt/ariel_celestia_iau.jpg', [1024, 2048]),
    'umbriel': ('alt/umbriel_celestia_iau.jpg', [1024, 2048]),
    'titania': ('alt/titania_celestia_iau.jpg', [1024, 2048]),
    'oberon': ('alt/oberon_celestia_iau.jpg', [1024, 2048]),
    'neptune': ('neptune.jpg', [1024, 2048]),
    'triton': ('triton.jpg', [1024, 4096]),
    'pluto': ('pluto.jpg', [1024, 4096]),
    'charon': ('charon.jpg', [1024, 2048]),
}

NORMALS = {
    'earth': ('earth_normal.jpg', [2048, 4096]),
    'moon': ('moon_normal.png', [2048, 4096]),
    'mars': ('mars_normal.png', [2048, 4096]),
}


# Cassini colour maps of these moons are strongly enhanced; pull them toward natural colour.
DESATURATE = {'mimas': 0.4, 'dione': 0.4}


def save(im, path, lossless=False):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    q = Q if im.size[0] < 8192 else 76
    im.save(path, 'WEBP', quality=q, method=6, lossless=lossless)
    print(f'  {path}  {im.size[0]}x{im.size[1]}  {os.path.getsize(path) / 1024:.0f} KiB')


def resized(im, w):
    if im.size[0] == w:
        return im
    return im.resize((w, w // 2), Image.LANCZOS)


def build_maps():
    for body, (fn, widths) in MAPS.items():
        p = os.path.join(SRC, fn)
        if not os.path.exists(p):
            print(f'!! missing {fn} for {body}')
            continue
        im = Image.open(p).convert('RGB')
        if body in DESATURATE:
            im = Image.blend(im.convert('L').convert('RGB'), im, DESATURATE[body])
        for w in widths:
            if w > im.size[0] * 1.01:
                continue
            save(resized(im, w), os.path.join(OUT, 'textures', body, f'map_{w}.webp'))
    for body, (fn, widths) in NORMALS.items():
        p = os.path.join(SRC, fn)
        if not os.path.exists(p):
            print(f'!! missing {fn} for {body} normal')
            continue
        im = Image.open(p).convert('RGB')
        for w in widths:
            if w > im.size[0] * 1.01:
                continue
            save(resized(im, w), os.path.join(OUT, 'textures', body, f'normal_{w}.webp'))


def build_earth_aux():
    clouds = Image.open(os.path.join(SRC, 'earth_clouds.jpg')).convert('L')
    spec = Image.open(os.path.join(SRC, 'earth_specular.jpg')).convert('L')
    night = Image.open(os.path.join(SRC, 'earth_night.jpg')).convert('L')
    size = clouds.size
    spec = spec.resize(size, Image.LANCZOS) if spec.size != size else spec
    night = night.resize(size, Image.LANCZOS) if night.size != size else night
    aux = Image.merge('RGB', (clouds, spec, night))
    for w in [2048, 4096, 8192]:
        save(resized(aux, w), os.path.join(OUT, 'textures', 'earth', f'aux_{w}.webp'))


def build_rings():
    im = Image.open(os.path.join(SRC, 'saturn_ring_alpha.png')).convert('RGBA')
    w = 4096
    row = im.resize((w, 4), Image.LANCZOS)
    save(row, os.path.join(OUT, 'textures', 'saturn', 'rings.webp'), lossless=True)


def build_sky():
    im = Image.open(os.path.join(SRC, 'milkyway.jpg')).convert('RGB')
    # Remove point stars (they are drawn from the Hipparcos catalogue instead):
    # grey opening = erosion then dilation, then a gentle blur.
    opened = im.filter(ImageFilter.MinFilter(5)).filter(ImageFilter.MaxFilter(5))
    opened = opened.filter(ImageFilter.GaussianBlur(1.2))
    # keep a hint of the unresolved faint star field
    mixed = Image.blend(opened, im.filter(ImageFilter.GaussianBlur(1.0)), 0.18)
    # black point: subtract the dark-sky floor so empty space is black
    floor = Image.new('RGB', mixed.size, (7, 7, 8))
    mixed = ImageChops.subtract(mixed, floor).point(lambda v: min(255, int(v * 2.2)))
    for w in [2048, 6000]:
        out = mixed if w == mixed.size[0] else mixed.resize((w, w // 2), Image.LANCZOS)
        save(out, os.path.join(OUT, 'textures', 'sky', f'milkyway_{w}.webp'))


if __name__ == '__main__':
    only = sys.argv[3:] or ['maps', 'aux', 'rings', 'sky']
    if 'maps' in only:
        build_maps()
    if 'aux' in only:
        build_earth_aux()
    if 'rings' in only:
        build_rings()
    if 'sky' in only:
        build_sky()
