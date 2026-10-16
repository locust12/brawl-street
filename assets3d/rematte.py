#!/usr/bin/env python3
"""Rebuild the alpha matte of the fighter cutouts (assets/<id>_cut.webp).

Every cutout shipped with a blobby low-res segmentation mask that ate real body
parts -- hands, shins, ankles, weapon tips, chrome panels. The RGB channel
underneath is intact and the source art sits on flat studio grey, so the matte
can be rebuilt from the file itself: key the grey, keep anything the background
cannot reach, drop the compression smears, feather the rim, unmix the grey out of
the half-covered pixels.

Canvas size is never changed, so every crop the game takes off these files (HUD
heads, roster tiles, winner art) frames exactly as before.
"""
import sys, os, glob
import numpy as np
from PIL import Image
from scipy import ndimage

LO = 7.0        # <= this far from the background colour: certainly background
HI = 22.0       # >= this far: certainly the fighter; between the two, feather
BAND = 3        # px around the background where the soft key is allowed to feather
MIN_BLOB = 140  # px: anything smaller and detached is background noise, not a fighter
POCKET = 200    # px: a sealed-off patch of backdrop this big is a gap, not a grey panel
SMEAR_W = 55    # a band this wide, this much wider than it is tall, and this flat
SMEAR_AR = 2.0  # along its own direction is an encoder smear, not a piece of fighter
SMEAR_FLAT = 0.5  # mean change along a row inside the band
SMEAR_GRAIN = 1.0 # ...or this flat along rows while banding hard between them
HAIR_H = 8      # a leftover hairline: this tall at most, this wide at least
HAIR_W = 40
HAIR_FLAT = 3.5


def bg_colour(rgb):
    """Median of a 3px frame, then refined over everything that frame agrees with."""
    frame = np.concatenate([
        rgb[:3, :].reshape(-1, 3), rgb[-3:, :].reshape(-1, 3),
        rgb[:, :3].reshape(-1, 3), rgb[:, -3:].reshape(-1, 3)])
    bg = np.median(frame, axis=0)
    near = np.abs(frame - bg).max(axis=1) < 20
    if near.sum() > 50:
        bg = np.median(frame[near], axis=0)
    return bg


def drop_smears(fg, old_mask, d):
    """Kill the lossy-encode streaks without touching the fighter.

    Re-encoding smeared each fighter's colour sideways: wide horizontal bands of
    one flat tint that run off to the frame edge. They clear the key, and they
    touch the body, so neither a threshold nor connectivity separates them -- but
    they hold a single value for hundreds of pixels, and nothing in a 3D render
    does. So a band is a smear when it is much wider than it is tall AND dead flat
    along its length; a recovered hand, hem or blade tip is neither.

    Faintness is no use as a test: a smear can be any strength, and a marble statue
    or a chrome robot is background-grey over most of its body. Only ground the old
    mask had already given up on is examined, so nothing visible today can be lost.
    """
    fresh = fg & ~ndimage.binary_dilation(old_mask, iterations=6)
    if not fresh.any():
        return fg
    along = np.abs(np.diff(d, axis=1, prepend=d[:, :1]))
    across = np.abs(np.diff(d, axis=0, prepend=d[:1, :]))
    smear = np.zeros_like(fg)

    lab, _ = ndimage.label(fresh)
    for i, sl in enumerate(ndimage.find_objects(lab), 1):
        if sl is None:
            continue
        part = lab[sl] == i
        n = part.sum()
        if n < 60:
            continue
        h, w = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        a = along[sl][part].mean()
        # a wide flat band, or a block of stacked stripes: a smear changes from row
        # to row far more than it does along a row, and real art shades both ways
        band = w >= SMEAR_W and w >= SMEAR_AR * h and a <= SMEAR_FLAT
        striped = n >= 400 and a <= SMEAR_GRAIN and across[sl][part].mean() >= 6 * a
        # the leftovers are hairlines a few px tall running off to the frame edge;
        # at that size, on ground the old mask had abandoned, there is no fighter
        hair = h <= HAIR_H and w >= HAIR_W and a <= HAIR_FLAT
        if band or striped or hair:
            smear[sl] |= part

    # the last of them reach the body through a pixel or two and ride along with it
    # as one component, so finish on shape alone: fresh ground that is never more
    # than HAIR_H tall yet runs HAIR_W wide. Anything thicker than that -- chrome,
    # marble, a hand -- is untouched, which is what the earlier per-pixel pass that
    # ate a third of the robot got wrong.
    thin = fresh & ~ndimage.binary_opening(fresh, structure=np.ones((HAIR_H + 1, 1), bool))
    seed = ndimage.binary_opening(thin, structure=np.ones((1, HAIR_W), bool))
    if seed.any():
        smear |= ndimage.binary_propagation(seed, mask=thin)
    return fg & ~smear
    # (a per-pixel version of this test was tried and thrown out: chrome and marble
    #  are smooth enough over a long run to look exactly like a smear, and it ate
    #  a third of the robot.)


def matte(path):
    im = Image.open(path).convert('RGBA')
    a = np.asarray(im).astype(np.float32)
    rgb, old = a[..., :3], a[..., 3]

    bg = bg_colour(rgb)
    d = np.abs(rgb - bg).max(axis=2)

    # 1. the outside: background-coloured and reachable from the frame.
    #    Grey *inside* the fighter (chrome, white sneakers, smoke) is unreachable,
    #    so it stays opaque -- which is exactly what the old mask got wrong.
    lab, n = ndimage.label(d <= LO)
    edge = np.unique(np.concatenate([lab[0, :], lab[-1, :], lab[:, 0], lab[:, -1]]))
    outside = np.isin(lab, edge[edge > 0])

    # ...except the backdrop sealed off between the legs or under an arm, which the
    # frame cannot reach: flat grey, and it would sit on the results screen as a
    # pale slab. It is only dropped where the old mask agreed it was background, so
    # a white belly or a chrome panel the old mask did keep is never punched out,
    # and nothing that was visible before can go missing.
    if n:
        idx = np.arange(1, n + 1)
        sizes = ndimage.sum_labels(np.ones_like(lab), lab, idx)
        solid = ndimage.mean((old > 127).astype(np.float32), lab, idx)
        sealed = idx[(sizes >= POCKET) & (solid < 0.5) & ~np.isin(idx, edge)]
        if sealed.size:
            outside |= np.isin(lab, sealed)
    fg = ~outside

    # 2. drop specks of encoder noise floating in the background, then the smears
    lab2, n2 = ndimage.label(fg)
    if n2:
        sizes = ndimage.sum_labels(np.ones_like(lab2), lab2, range(1, n2 + 1))
        small = np.flatnonzero(sizes < MIN_BLOB) + 1
        if small.size:
            fg &= ~np.isin(lab2, small)
    fg = drop_smears(fg, old > 127, d)
    outside = ~fg

    # 3. feather only the rim: the soft key decides the half-covered pixels,
    #    everything deeper in stays fully opaque.
    key = np.clip((d - LO) / (HI - LO), 0, 1)
    rim = ndimage.binary_dilation(outside, iterations=BAND) & fg
    alpha = np.where(fg, 255.0, 0.0)
    alpha[rim] = np.minimum(255.0, key[rim] * 255.0)

    # 4. unmix the grey out of the rim so nothing wears a pale halo on a dark screen.
    #    Only where enough of the fighter is in the pixel -- dividing by a sliver of
    #    alpha amplifies compression noise into bright confetti.
    out = rgb.copy()
    af = alpha / 255.0
    soft = (af > 0.25) & (af < 0.96)
    if soft.any():
        k = af[soft][:, None]
        out[soft] = np.clip((rgb[soft] - (1 - k) * bg) / k, 0, 255)
    out[alpha < 1] = bg  # flat colour under the transparency keeps the file small

    res = np.dstack([out, alpha]).astype(np.uint8)
    gained = int(((alpha > 127) & (old < 10)).sum())
    lost = int(((alpha < 10) & (old > 127)).sum())
    return Image.fromarray(res), gained, lost, int((alpha > 127).sum())


def main(files, outdir=None):
    for f in files:
        img, gained, lost, area = matte(f)
        dest = f if outdir is None else os.path.join(outdir, os.path.basename(f))
        img.save(dest, 'WEBP', quality=92, method=6)
        print(f"{os.path.basename(f):26s} recovered={gained:7d} trimmed={lost:6d} "
              f"body={area:7d} ({100 * gained / max(1, area):5.1f}% was missing)  "
              f"{os.path.getsize(dest) // 1024}KB")


if __name__ == '__main__':
    args = [x for x in sys.argv[1:] if not x.startswith('--')]
    outdir = next((x.split('=')[1] for x in sys.argv[1:] if x.startswith('--out=')), None)
    main(args or sorted(glob.glob('play/assets/*_cut.webp')), outdir)
