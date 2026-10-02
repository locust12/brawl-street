"""GLB helper: info, shrink textures (via macOS sips), extract animations to compact JSON.
usage:
  python3 glbtool.py info file.glb
  python3 glbtool.py shrink in.glb out.glb [maxsize=1024]
  python3 glbtool.py anim in.glb out.json name
"""
import json, struct, sys, os, subprocess, tempfile

COMP = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2), 5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}
NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def load(path):
    d = open(path, 'rb').read()
    magic, ver, length = struct.unpack_from('<III', d, 0)
    assert magic == 0x46546C67, 'not a glb'
    off = 12; js = None; binc = b''
    while off < length:
        clen, ctype = struct.unpack_from('<II', d, off); off += 8
        chunk = d[off:off + clen]; off += clen
        if ctype == 0x4E4F534A: js = json.loads(chunk.decode('utf8'))
        elif ctype == 0x004E4942: binc = chunk
    return js, bytearray(binc)


def save(path, js, binc):
    jb = json.dumps(js, separators=(',', ':')).encode('utf8')
    jb += b' ' * ((4 - len(jb) % 4) % 4)
    binc = bytes(binc) + b'\0' * ((4 - len(binc) % 4) % 4)
    total = 12 + 8 + len(jb) + 8 + len(binc)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(jb), 0x4E4F534A)); f.write(jb)
        f.write(struct.pack('<II', len(binc), 0x004E4942)); f.write(binc)


def read_acc(js, binc, i):
    a = js['accessors'][i]; bv = js['bufferViews'][a['bufferView']]
    fmt, sz = COMP[a['componentType']]; n = NCOMP[a['type']]
    base = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = bv.get('byteStride', sz * n)
    out = []
    for k in range(a['count']):
        vals = struct.unpack_from('<' + fmt * n, binc, base + k * stride)
        if a.get('normalized'):
            m = {5120: 127, 5121: 255, 5122: 32767, 5123: 65535}[a['componentType']]
            vals = tuple(max(v / m, -1) for v in vals)
        out.append(vals)
    return out


def info(path):
    js, binc = load(path)
    print('size', os.path.getsize(path), 'bin', len(binc))
    print('meshes', len(js.get('meshes', [])), 'skins', len(js.get('skins', [])), 'nodes', len(js.get('nodes', [])))
    for s in js.get('skins', []): print('skin joints', [js['nodes'][j].get('name') for j in s['joints']][:60])
    for im in js.get('images', []):
        bv = js['bufferViews'][im['bufferView']] if 'bufferView' in im else None
        print('image', im.get('mimeType'), bv and bv['byteLength'])
    for a in js.get('animations', []):
        ch = a['channels']; t = read_acc(js, binc, a['samplers'][0]['input'])
        print('anim', a.get('name'), 'channels', len(ch), 'duration', t[-1][0] if t else 0)
    for m in js.get('materials', []): print('material', m.get('name'), list(m.get('pbrMetallicRoughness', {}).keys()), [k for k in m if k.endswith('Texture')])


def shrink(src, dst, maxsize=1024):
    js, binc = load(src)
    new = bytearray(); views = []
    img_views = {im['bufferView']: i for i, im in enumerate(js.get('images', [])) if 'bufferView' in im}
    tmp = tempfile.mkdtemp()
    for vi, bv in enumerate(js['bufferViews']):
        data = bytes(binc[bv.get('byteOffset', 0): bv.get('byteOffset', 0) + bv['byteLength']])
        if vi in img_views:
            im = js['images'][img_views[vi]]
            ext = '.png' if im.get('mimeType') == 'image/png' else '.jpg'
            a = os.path.join(tmp, f'i{vi}{ext}'); b = os.path.join(tmp, f'o{vi}.jpg')
            open(a, 'wb').write(data)
            # normal/ORM maps stay PNG-free JPEG at high quality; base colour gets the same
            subprocess.run(['sips', '-Z', str(maxsize), '-s', 'format', 'jpeg', '-s', 'formatOptions', '82', a, '--out', b], check=True, capture_output=True)
            data = open(b, 'rb').read(); im['mimeType'] = 'image/jpeg'
        while len(new) % 4: new.append(0)
        bv['byteOffset'] = len(new); bv['byteLength'] = len(data); new += data
    js['buffers'] = [{'byteLength': len(new)}]
    save(dst, js, new)
    print('shrunk', os.path.getsize(src), '->', os.path.getsize(dst))


def anim(src, dst, name):
    js, binc = load(src)
    out = []
    for a in js.get('animations', []):
        tracks = []
        for ch in a['channels']:
            node = js['nodes'][ch['target']['node']].get('name'); path = ch['target']['path']
            smp = a['samplers'][ch['sampler']]
            t = [round(v[0], 4) for v in read_acc(js, binc, smp['input'])]
            vals = [round(x, 5) for v in read_acc(js, binc, smp['output']) for x in v]
            tracks.append({'n': node, 'p': path, 't': t, 'v': vals})
        out.append({'name': name, 'tracks': tracks})
    json.dump(out[0] if len(out) == 1 else out, open(dst, 'w'), separators=(',', ':'))
    print('anim', name, 'clips', len(out), 'bytes', os.path.getsize(dst))


def split(src, dst, tex_out, maxsize=1024):
    js, binc = load(src)
    img = None
    try:
        ti = js['materials'][0]['pbrMetallicRoughness']['baseColorTexture']['index']
        img = js['images'][js['textures'][ti]['source']]
    except Exception:
        img = (js.get('images') or [None])[0]
    if img is not None and 'bufferView' in img:
        bv = js['bufferViews'][img['bufferView']]
        data = bytes(binc[bv.get('byteOffset', 0): bv.get('byteOffset', 0) + bv['byteLength']])
        tmp = tempfile.mkdtemp(); a = os.path.join(tmp, 'i.png')
        open(a, 'wb').write(data)
        subprocess.run(['sips', '-Z', str(maxsize), '-s', 'format', 'jpeg', '-s', 'formatOptions', '84', a, '--out', tex_out], check=True, capture_output=True)
    drop = {im['bufferView'] for im in js.get('images', []) if 'bufferView' in im}
    for k in ('images', 'textures', 'samplers'): js.pop(k, None)
    for m in js.get('materials', []):
        pbr = m.get('pbrMetallicRoughness', {})
        for k in list(pbr): 
            if k.endswith('Texture'): pbr.pop(k)
        for k in list(m):
            if k.endswith('Texture'): m.pop(k)
    js.pop('animations', None)
    new = bytearray(); remap = {}; views = []
    for vi, bv in enumerate(js['bufferViews']):
        if vi in drop: continue
        data = bytes(binc[bv.get('byteOffset', 0): bv.get('byteOffset', 0) + bv['byteLength']])
        while len(new) % 4: new.append(0)
        nb = dict(bv); nb['byteOffset'] = len(new); nb['byteLength'] = len(data); new += data
        remap[vi] = len(views); views.append(nb)
    js['bufferViews'] = views
    for a in js.get('accessors', []):
        if 'bufferView' in a: a['bufferView'] = remap[a['bufferView']]
    js['buffers'] = [{'byteLength': len(new)}]
    save(dst, js, new)
    print('split', os.path.getsize(src), '->', os.path.getsize(dst), '+ tex', os.path.getsize(tex_out))


if __name__ == '__main__':
    cmd = sys.argv[1]
    if cmd == 'info': info(sys.argv[2])
    elif cmd == 'shrink': shrink(sys.argv[2], sys.argv[3], int(sys.argv[4]) if len(sys.argv) > 4 else 1024)
    elif cmd == 'split': split(sys.argv[2], sys.argv[3], sys.argv[4], int(sys.argv[5]) if len(sys.argv) > 5 else 1024)
    elif cmd == 'anim': anim(sys.argv[2], sys.argv[3], sys.argv[4])
