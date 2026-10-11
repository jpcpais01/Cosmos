#!/usr/bin/env python3
"""Build the Milky Way background (galactic equirectangular, centre = galactic centre).

Usage: python3 tools/build_sky.py <eso_panorama> <gaia_map> public/textures/sky

  eso_panorama  ESO eso0932a (S. Brunier) with its stars removed: eso_starless_6000.webp from
                build_textures.py (the same image shipped as public/textures/sky/milkyway_6000.webp
                up to commit 1f6b0d8, which is what the current maps were built from)
  gaia_map      ESA/Gaia/DPAC EDR3 "Gaia's sky in colour", plate carree in galactic coordinates
                (MW_edgeon_edr3_unannotate.jpg, shipped in the mw_plot Python package)

Gaia's map is exact and sharp but stretched for print and grey; ESO's photo has the real colours
but is soft, blotchy where its stars were removed, and rotated about 3.8 degrees off the true
galactic frame. So the structure (dust lanes, clouds) comes from Gaia, denoised and tone-mapped
onto ESO's brightness, and the colour comes from ESO after rotating it onto Gaia's frame.

Needs numpy and opencv-python-headless. Writes galaxy_<width>.webp.
"""
import os
import sys

import cv2
import numpy as np

ESO, GAIA, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
W, H = 6000, 3000
WIDTHS = [2048, 4096, 6000]
LUMA = np.array([0.0722, 0.7152, 0.2126], np.float32)  # BGR


def wrapped(fn, img, pad):
    """Apply a neighbourhood filter seamlessly: longitude wraps around, latitude mirrors at the poles."""
    p = cv2.copyMakeBorder(img, 0, 0, pad, pad, cv2.BORDER_WRAP)
    p = cv2.copyMakeBorder(p, pad, pad, 0, 0, cv2.BORDER_REFLECT)
    return fn(p)[pad:-pad, pad:-pad]


def blur(img, sigma):
    return wrapped(lambda p: cv2.GaussianBlur(p, (0, 0), sigma), img, int(4 * sigma) + 1)


def unit_vectors(xs, ys, w, h):
    lon = (0.5 - (xs + 0.5) / w) * 2 * np.pi  # longitude increases to the left
    lat = (0.5 - (ys + 0.5) / h) * np.pi
    return np.stack([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)], -1)


def band_pass(img):
    lg = np.log(img @ LUMA + 0.02)
    return (blur(lg, 2) - blur(lg, 20)).astype(np.float32)


def close_seam(img, ramp=240):
    """ESO's panorama does not quite meet itself at longitude 180: spread the step over both edges."""
    step = img[:, :4].mean(1) - img[:, -4:].mean(1)
    step = cv2.GaussianBlur(step[:, None, :], (0, 0), 25)[:, 0, :]
    t = (1 - np.arange(ramp) / ramp)[None, :, None] * 0.5
    img = img.copy()
    img[:, :ramp] -= step[:, None, :] * t
    img[:, -ramp:] += step[:, None, :] * t[:, ::-1]
    return img


def fit_rotation(eso, gaia):
    """Rotation taking ESO directions onto Gaia's, from template matches along the galactic plane."""
    a, b = band_pass(eso), band_pass(gaia)
    p, q = [], []
    for y in range(1100, 1950, 100):
        for x in range(150, W, 200):
            t, s = a[y - 90:y + 90, x - 90:x + 90], b[y - 170:y + 170, x - 170:x + 170]
            if s.shape != (340, 340):
                continue
            _, score, _, loc = cv2.minMaxLoc(cv2.matchTemplate(s, t, cv2.TM_CCOEFF_NORMED))
            if score < 0.45:
                continue
            p.append(unit_vectors(x, y, W, H))
            q.append(unit_vectors(x + loc[0] - 80, y + loc[1] - 80, W, H))
    p, q = np.array(p), np.array(q)
    u, _, vt = np.linalg.svd(p.T @ q)
    r = vt.T @ np.diag([1, 1, np.sign(np.linalg.det(vt.T @ u.T))]) @ u.T
    err = np.degrees(np.arccos(np.clip(((p @ r.T) * q).sum(1), -1, 1)))
    print(f'ESO -> galactic: {np.degrees(np.arccos((np.trace(r) - 1) / 2)):.2f} deg rotation, '
          f'{len(p)} matches, median residual {np.median(err):.3f} deg')
    return r


def rotate_into_gaia(eso, r):
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
    v = unit_vectors(xs, ys, W, H) @ r  # r^T v: Gaia direction -> ESO direction
    lon = np.arctan2(v[..., 1], v[..., 0])
    lat = np.arcsin(np.clip(v[..., 2], -1, 1))
    mx = ((0.5 - lon / (2 * np.pi)) * W - 0.5) % W
    my = (0.5 - lat / np.pi) * H - 0.5
    return cv2.remap(eso, mx.astype(np.float32), my.astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)


def gaia_structure(path):
    """Gaia luminance at full resolution: shot noise and point stars removed, a little grain kept."""
    g8 = (cv2.imread(path).astype(np.float32) / 255 @ LUMA * 255 + 0.5).astype(np.uint8)
    clean = wrapped(lambda p: cv2.fastNlMeansDenoising(p, None, 13, 5, 21), g8, 16).astype(np.float32) / 255
    g = clean + 0.12 * (g8.astype(np.float32) / 255 - clean)
    g = cv2.resize(g, (W, H), interpolation=cv2.INTER_AREA)
    disk = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    opened = wrapped(lambda p: cv2.morphologyEx(p, cv2.MORPH_OPEN, disk), g, 4)
    peaks = g - opened
    # the star catalogue draws the stars, so flatten Gaia's own point sources
    return np.where(peaks > 0.05, opened + 0.3 * peaks, g)


def tone_curve(g, ye):
    """Monotonic map from Gaia's stretched levels to ESO's brightness, fitted on blurred maps."""
    gb = blur(g, 8).ravel()
    eb = blur(ye, 8).ravel()
    edges = np.linspace(0, 1, 257)
    idx = np.clip(np.digitize(gb, edges) - 1, 0, 255)
    centres = (edges[:-1] + edges[1:]) / 2
    med = np.full(256, np.nan)
    for i in range(256):
        sel = eb[idx == i]
        if sel.size > 50:
            med[i] = np.median(sel)
    ok = ~np.isnan(med)
    return centres, np.maximum.accumulate(np.interp(centres, centres[ok], med[ok]))


def main():
    eso = cv2.imread(ESO).astype(np.float32) / 255
    eso = close_seam(cv2.resize(eso, (W, H), interpolation=cv2.INTER_AREA))
    gaia_rgb = cv2.resize(cv2.imread(GAIA).astype(np.float32) / 255, (W, H), interpolation=cv2.INTER_AREA)
    eso = np.clip(rotate_into_gaia(eso, fit_rotation(eso, gaia_rgb)), 0, 1)
    ye = eso @ LUMA
    g = gaia_structure(GAIA)
    cx, cf = tone_curve(g, ye)
    y = np.interp(g, cx, cf).astype(np.float32)
    # a quarter of ESO's own (softer) structure keeps dark lanes from being crushed to flat black
    y = 0.75 * y + 0.25 * blur(ye, 2)
    # keep ESO's broad brightness (emission nebulae that Gaia's star counts miss), within limits
    ratio = (blur(ye, 30) + 0.004) / (blur(y, 30) + 0.004)
    y *= np.clip(ratio, 0.6, 3.0)
    # and what Gaia does not see at all (Andromeda, Triangulum, bright nebulae): only clear excesses,
    # so ESO's blotchy texture stays out
    ye2 = blur(ye, 1.2)
    y += np.maximum(0, ye2 - blur(y, 1.2) - 0.03 - 0.5 * y)
    chroma = blur(eso, 3) / np.maximum(blur(ye, 3), 0.02)[..., None]
    out = np.clip(y[..., None] * np.clip(chroma, 0, 3), 0, 1)
    out8 = (out * 255 + 0.5).astype(np.uint8)
    os.makedirs(OUT, exist_ok=True)
    for w in WIDTHS:
        img = out8 if w == W else cv2.resize(out8, (w, w // 2), interpolation=cv2.INTER_AREA)
        path = os.path.join(OUT, f'galaxy_{w}.webp')
        cv2.imwrite(path, img, [cv2.IMWRITE_WEBP_QUALITY, 90])
        print(f'{path}: {os.path.getsize(path) / 1024:.0f} KiB')


if __name__ == '__main__':
    main()
