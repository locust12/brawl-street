"""Turns a generated material photo into the three maps a wall actually needs.

  python3 assets3d/mi_material.py

Input : assets3d/stages_raw/mi_stucco.png, mi_trim.png (Higgsfield, 2048 px, not tileable)
Output: assets/stg_plaster.jpg + stg_plaster_n.jpg  (coarse painted render)
        assets/stg_castst.jpg + stg_castst_n.jpg    (fine cast stone / trim)

The albedo ships as a DESATURATED detail map with its mean pushed near white, so one photo tints to
any wall colour through material.color (three multiplies map by color). That is why a single
2048 px plaster photo can dress every building on every stage instead of one pink wall.

Seamless: the photo is not tileable, so it is blended with a half-offset copy of itself across a
feathered band. The offset copy's border content comes from the middle of the original, which has
no seam in it, so the result wraps.
"""
import os
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, 'stages_raw')
OUT = os.path.join(HERE, '..', 'assets')
N = 1024


def tileable(a, feather=None):
    h, w = a.shape[:2]
    f = feather or h // 6
    r = np.roll(np.roll(a, h // 2, 0), w // 2, 1)
    # 0 in the middle of the tile, 1 at the border, ramped over `f`
    yy = np.minimum(np.arange(h), h - 1 - np.arange(h))
    xx = np.minimum(np.arange(w), w - 1 - np.arange(w))
    my = np.clip(1.0 - yy / f, 0, 1)
    mx = np.clip(1.0 - xx / f, 0, 1)
    m = np.maximum(my[:, None], mx[None, :])
    m = m * m * (3 - 2 * m)
    if a.ndim == 3:
        m = m[:, :, None]
    return a * (1 - m) + r * m


def normal_map(lum, strength):
    """Tangent-space normal from a height field. Stays LINEAR (an sRGB normal map is wrong)."""
    dx = (np.roll(lum, -1, 1) - np.roll(lum, 1, 1)) * strength
    dy = (np.roll(lum, -1, 0) - np.roll(lum, 1, 0)) * strength
    nz = np.ones_like(lum)
    l = np.sqrt(dx * dx + dy * dy + nz * nz)
    out = np.stack([(-dx / l * 0.5 + 0.5), (dy / l * 0.5 + 0.5), (nz / l * 0.5 + 0.5)], -1)
    return (out * 255).clip(0, 255).astype(np.uint8)


def build(src, base, mean, contrast, strength):
    im = Image.open(os.path.join(RAW, src)).convert('RGB').resize((N, N), Image.LANCZOS)
    a = np.asarray(im).astype(np.float32) / 255.0
    a = tileable(a)
    lum = a @ np.array([0.299, 0.587, 0.114], np.float32)
    lum = (lum - lum.mean()) * contrast + mean
    lum = lum.clip(0.02, 1.0)
    g = (lum * 255).astype(np.uint8)
    Image.fromarray(np.dstack([g, g, g])).save(os.path.join(OUT, base + '.jpg'), quality=86, optimize=True)
    # the normal comes off a slightly smoothed height so JPEG blocking does not become bumps
    h = lum.copy()
    for _ in range(2):
        h = (h + np.roll(h, 1, 0) + np.roll(h, -1, 0) + np.roll(h, 1, 1) + np.roll(h, -1, 1)) / 5.0
    Image.fromarray(normal_map(h, strength)).save(os.path.join(OUT, base + '_n.jpg'), quality=88, optimize=True)
    for suffix in ('.jpg', '_n.jpg'):
        p = os.path.join(OUT, base + suffix)
        print(base + suffix, os.path.getsize(p) // 1024, 'KB')


# The albedo is a DETAIL map, not a value map: its mean sits near white so it barely darkens
# what it tints, and all of the value control stays in material.color.
build('mi_stucco.png', 'stg_plaster', mean=0.88, contrast=0.62, strength=18)
build('mi_trim.png', 'stg_castst', mean=0.91, contrast=0.5, strength=11)
