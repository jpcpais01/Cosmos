"""Generates the PWA icons (ringed planet over a starfield). Run: python3 tools/icons/make_icons.py"""
import math, random
from PIL import Image, ImageDraw, ImageFilter

OUT = 'public/icons'


def icon(size, maskable=False):
    S = size * 4
    img = Image.new('RGB', (S, S), (2, 4, 10))
    d = ImageDraw.Draw(img)
    rnd = random.Random(7)
    for _ in range(int(S * S / 9000)):
        x, y = rnd.random() * S, rnd.random() * S
        b = int(90 + rnd.random() ** 3 * 165)
        r = S / 900 * (0.6 + rnd.random())
        d.ellipse([x - r, y - r, x + r, y + r], fill=(b, b, min(255, b + 20)))
    cx, cy = S * 0.5, S * 0.52
    R = S * (0.25 if maskable else 0.3)
    # glow
    glow = Image.new('RGB', (S, S), (0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([cx - R * 1.25, cy - R * 1.25, cx + R * 1.25, cy + R * 1.25], fill=(40, 90, 160))
    glow = glow.filter(ImageFilter.GaussianBlur(S * 0.06))
    img = Image.composite(img, img, Image.new('L', (S, S), 255))
    img = Image.fromarray(__import__('numpy').clip(__import__('numpy').asarray(img, dtype='float32') + __import__('numpy').asarray(glow, dtype='float32') * 0.8, 0, 255).astype('uint8'))
    d = ImageDraw.Draw(img)
    tilt = -0.32

    def ring(front):
        for k in range(60):
            t = k / 59
            rr = R * (1.35 + 0.6 * t)
            a = (200 + 40 * math.sin(t * 40)) * (0.55 + 0.45 * math.sin(t * 9 + 1) ** 2)
            col = (int(a), int(a * 0.86), int(a * 0.66))
            pts = []
            for j in range(181):
                th = (j / 180) * math.pi + (0 if front else math.pi)
                x, y = rr * math.cos(th), rr * 0.26 * math.sin(th)
                pts.append((cx + x * math.cos(tilt) - y * math.sin(tilt), cy + x * math.sin(tilt) + y * math.cos(tilt)))
            d.line(pts, fill=col, width=max(1, int(S / 512)))

    ring(False)
    # planet with terminator shading
    planet = Image.new('RGB', (S, S), (0, 0, 0))
    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).ellipse([cx - R, cy - R, cx + R, cy + R], fill=255)
    import numpy as np
    yy, xx = np.mgrid[0:S, 0:S].astype('float32')
    nx, ny = (xx - cx) / R, (yy - cy) / R
    nz = np.sqrt(np.clip(1 - nx * nx - ny * ny, 0, 1))
    L = np.array([-0.55, -0.45, 0.7]); L /= np.linalg.norm(L)
    lam = np.clip(nx * L[0] + ny * L[1] + nz * L[2], 0, 1) ** 0.8
    band = 0.85 + 0.15 * np.sin((ny * math.cos(tilt) - nx * math.sin(tilt)) * 18)
    base = np.stack([235 * band, 205 * band, 160 * band], -1)
    col = base * lam[..., None] + np.array([10, 14, 24])
    planet = Image.fromarray(np.clip(col, 0, 255).astype('uint8'))
    img.paste(planet, (0, 0), mask)
    d = ImageDraw.Draw(img)
    ring(True)
    return img.resize((size, size), Image.LANCZOS)


icon(192).save(f'{OUT}/icon-192.png', optimize=True)
icon(512).save(f'{OUT}/icon-512.png', optimize=True)
icon(512, maskable=True).save(f'{OUT}/icon-maskable-512.png', optimize=True)
icon(180).save(f'{OUT}/apple-touch-icon.png', optimize=True)
print('icons written')
