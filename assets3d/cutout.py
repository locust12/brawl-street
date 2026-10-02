"""Cut the plain studio background out of a fighter's reference art -> RGBA webp (for menu tiles/showcase).
usage: python3 assets3d/cutout.py <in.png|jpg> <out.webp> [maxh]"""
import sys
from PIL import Image, ImageFilter, ImageChops, ImageDraw
import collections

def cut(src, dst, maxh=900):
    im = Image.open(src).convert('RGB')
    if im.height > maxh: im = im.resize((round(im.width * maxh / im.height), maxh), Image.LANCZOS)
    W, H = im.size
    px = im.load()
    # background colour = median of the border
    border = [px[x, 0] for x in range(W)] + [px[x, H - 1] for x in range(W)] + [px[0, y] for y in range(H)] + [px[W - 1, y] for y in range(H)]
    bg = tuple(sorted(c[i] for c in border)[len(border) // 2] for i in range(3))
    def close(c, tol):
        return abs(c[0] - bg[0]) + abs(c[1] - bg[1]) + abs(c[2] - bg[2]) < tol and max(c) - min(c) < 26
    # flood fill from the border through near-background pixels (lets the grey gradient through, stops at the outline)
    mask = Image.new('L', (W, H), 255); mp = mask.load()
    seen = bytearray(W * H); q = collections.deque()
    for x in range(W): q.append((x, 0)); q.append((x, H - 1))
    for y in range(H): q.append((0, y)); q.append((W - 1, y))
    while q:
        x, y = q.popleft()
        i = y * W + x
        if seen[i]: continue
        seen[i] = 1
        c = px[x, y]
        if not close(c, 70): continue
        mp[x, y] = 0
        if x > 0: q.append((x - 1, y))
        if x < W - 1: q.append((x + 1, y))
        if y > 0: q.append((x, y - 1))
        if y < H - 1: q.append((x, y + 1))
    mask = mask.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1.1))
    out = im.convert('RGBA'); out.putalpha(mask)
    bb = mask.point(lambda v: 255 if v > 20 else 0).getbbox()
    if bb:
        pad = 6
        out = out.crop((max(0, bb[0] - pad), max(0, bb[1] - pad), min(W, bb[2] + pad), min(H, bb[3] + pad)))
    out.save(dst, 'WEBP', quality=86, method=6)
    return out.size

if __name__ == '__main__':
    print(cut(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 900))
