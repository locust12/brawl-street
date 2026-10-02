"""Packs the generated stage art (assets3d/stages_raw/*.png) into the few files the page ships.

  python3 assets3d/stage_atlas.py

Tile atlases (stg_tiles_*.jpg, 1024 px): four seamless textures each, 480 px tiles in 512 px cells
with 16 px of wrapped padding, so the shader in 95_v3_stages.mjs can repeat a cell (fract + textureGrad).
Card atlases: stg_cards.png (alpha: lowrider + 3 palms), stg_panels.jpg (market front, coin billboard,
trophy on black for additive use). Plates: bg_<id>.jpg at 2560 px, q80. Prints the UV rects it used.
"""
import os
from PIL import Image
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, 'stages_raw')
OUT = os.path.join(HERE, '..', 'assets')
Q = 80


def raw(n):
    return Image.open(os.path.join(RAW, n + '.png'))


def save_jpg(im, name, q=Q):
    p = os.path.join(OUT, name)
    im.convert('RGB').save(p, quality=q, optimize=True, progressive=True)
    print(name, im.size, os.path.getsize(p) // 1024, 'KB')


def tile_atlas(name, tiles, T=480, P=16):
    C = T + 2 * P
    at = Image.new('RGB', (C * 2, C * 2))
    for i, n in enumerate(tiles):
        if not n:
            continue
        t = raw(n).convert('RGB').resize((T, T), Image.LANCZOS)
        a = np.array(t)
        a = np.concatenate([a[-P:], a, a[:P]], 0)
        a = np.concatenate([a[:, -P:], a, a[:, :P]], 1)
        at.paste(Image.fromarray(a), ((i % 2) * C, (i // 2) * C))
    save_jpg(at, name)


for n, tiles in [('stg_tiles_a.jpg', ['tex_cityroof', 'tex_facade', 'tex_shipdeck', 'tex_hull']),
                 ('stg_tiles_b.jpg', ['st2_asphalt', 'st2_sidewalk', 'st2_brick', 'tex_arenapanel']),
                 ('stg_tiles_c.jpg', ['tex_bark', 'tex_granite', 'tex_streetcut', 'tex_dojofloor']),
                 ('stg_tiles_d.jpg', ['kp_leaf', 'kp_bark', 'kp_moss', 'rf_deck']),
                 ('stg_tiles_e.jpg', ['mn_stone', 'mn_crust', 'bg_mudbrick', 'mn_stone'])]:
    tile_atlas(n, tiles)

# card atlas with alpha: the two cars on top, the three palms below (1536 px)
A = 1536
cards = Image.new('RGBA', (A, A), (0, 0, 0, 0))
rects = {}


def cut(im):
    a = np.array(im)[:, :, 3]; ys, xs = np.where(a > 8)
    return im.crop((xs.min() - 2, ys.min() - 2, xs.max() + 3, ys.max() + 3))


y = 0
for key, name in [('lowrider', 'st2_lowrider'), ('muscle', 'st2_musclecar')]:
    c = cut(raw(name)); c = c.resize((A, round(A * c.height / c.width)), Image.LANCZOS)
    cards.paste(c, (0, y)); rects[key] = (0, y, c.width, c.height); y += c.height + 8

pal = raw('st2_palms'); a = np.array(pal)[:, :, 3]
col = (a > 8).any(axis=0); runs = []; s0 = None
for x, v in enumerate(col):
    if v and s0 is None: s0 = x
    if not v and s0 is not None: runs.append((s0, x)); s0 = None
if s0 is not None: runs.append((s0, len(col)))
runs = [r for r in runs if r[1] - r[0] > 40]
x0 = 0
for k, (a0, a1) in enumerate(runs):
    sub = cut(pal.crop((a0, 0, a1, pal.height)))
    sc = (A - y - 4) / sub.height
    sub = sub.resize((max(1, round(sub.width * sc)), round(sub.height * sc)), Image.LANCZOS)
    cards.paste(sub, (x0, A - sub.height)); rects['palm%d' % k] = (x0, A - sub.height, sub.width, sub.height); x0 += sub.width + 8
p = os.path.join(OUT, 'stg_cards.png')
cards.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save(p, optimize=True)
print('stg_cards.png', cards.size, os.path.getsize(p) // 1024, 'KB')

# the graffiti wall and the shop front: big single pieces, mapped at real scale
w = raw('st2_wall').convert('RGB'); w = w.crop((int(w.width * 0.10), 0, w.width, w.height))
save_jpg(w.resize((1920, round(1920 * w.height / w.width)), Image.LANCZOS), 'stg_wall.jpg', 82)
sp = raw('st2_shop').convert('RGB')
save_jpg(sp.resize((1600, round(1600 * sp.height / sp.width)), Image.LANCZOS), 'stg_shop.jpg', 85)
for src, dst, wpx, q in [('rf_tower', 'stg_tower.jpg', 1536, 84), ('sb_signs', 'stg_signs.jpg', 1536, 84), ('bg_house', 'stg_house.jpg', 1536, 84)]:
    im = raw(src).convert('RGB')
    save_jpg(im.resize((wpx, round(wpx * im.height / im.width)), Image.LANCZOS), dst, q)

# opaque panels: market front, coin billboard, trophy (on black)
pan = Image.new('RGB', (1024, 1024), (0, 0, 0))
mk = raw('tex_market').convert('RGB'); W, H = mk.size
mk = mk.crop((0, int(H * 0.052), W, int(H * 0.885))); mk = mk.resize((1024, round(1024 * mk.height / mk.width)), Image.LANCZOS)
pan.paste(mk, (0, 0)); rects['market'] = (0, 0, mk.width, mk.height)
cb = raw('tex_coinboard').convert('RGB'); h = 1024 - mk.height - 4; cb = cb.resize((round(h * cb.width / cb.height), h), Image.LANCZOS)
pan.paste(cb, (0, 1024 - h)); rects['coinboard'] = (0, 1024 - h, cb.width, h)
tr = raw('spr_trophy'); a = np.array(tr)[:, :, 3]; ys, xs = np.where(a > 8); tr = tr.crop((xs.min() - 4, ys.min() - 4, xs.max() + 5, ys.max() + 5))
tr = tr.resize((round(h * tr.width / tr.height), h), Image.LANCZOS); bg = Image.new('RGBA', tr.size, (0, 0, 0, 255)); bg.alpha_composite(tr)
pan.paste(bg.convert('RGB'), (cb.width + 6, 1024 - h)); rects['trophy'] = (cb.width + 6, 1024 - h, tr.width, h)
save_jpg(pan, 'stg_panels.jpg')

# plates
PLATE_W = {'street': 3000, 'roof': 3000, 'moon': 3000, 'keep': 3000, 'shibuya': 3000, 'baghdad': 3000, 'miami': 3000}
for pid, src in [('city', 'bg_city'), ('ship', 'bg_ship'), ('street', 'st2_plate_a'), ('arena', 'bg_arena'), ('swamp', 'bg_swamp'), ('dojo', 'bg_dojo2'),
                 ('floor', 'bg_floor'), ('train', 'bg_train'), ('peak', 'bg_peak'), ('lunar', 'bg_lunar'), ('casino', 'bg_casino'),
                 ('keep', 'kp_plate'), ('roof', 'rf_plate'), ('moon', 'mn_plate'),
                 ('shibuya', 'sb_plate'), ('baghdad', 'bg_plate'), ('miami', 'mi_plate')]:
    W2 = PLATE_W.get(pid, 2560)
    save_jpg(raw(src).convert('RGB').resize((W2, round(W2 * 1097 / 2560)), Image.LANCZOS), 'bg_%s.jpg' % pid, 84 if W2 > 2560 else Q)

# UV rects for the code: [u0, v0, u1, v1] with v up
SIZE = {'lowrider': A, 'muscle': A, 'palm0': A, 'palm1': A, 'palm2': A}
for k, (x, y, w, h) in rects.items():
    S = SIZE.get(k, 1024)
    print(k, [round(x / S, 4), round(1 - (y + h) / S, 4), round((x + w) / S, 4), round(1 - y / S, 4)], 'px', w, h)
