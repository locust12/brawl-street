"""Shrink a single-mesh GLB for shipping: KHR_mesh_quantization (int16 positions, uint16 UVs),
normals dropped (the page recomputes them), uint16 indices, texture split out to a small jpg.

  python3 assets3d/glb_quantize.py in.glb out_glb.wasm out_tex.jpg [texsize=512]
"""
import sys, os, struct, subprocess, tempfile
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from glbtool import load, save, read_acc

src, dst, tex_out = sys.argv[1:4]
tsize = int(sys.argv[4]) if len(sys.argv) > 4 else 512
js, binc = load(src)
prim = js['meshes'][0]['primitives'][0]
P = np.array(read_acc(js, binc, prim['attributes']['POSITION']), dtype=np.float64)
UV = np.array(read_acc(js, binc, prim['attributes']['TEXCOORD_0']), dtype=np.float64)
I = np.array(read_acc(js, binc, prim['indices'])).reshape(-1)
# texture
ti = js['materials'][0]['pbrMetallicRoughness']['baseColorTexture']['index']
img = js['images'][js['textures'][ti]['source']]; bv = js['bufferViews'][img['bufferView']]
data = bytes(binc[bv.get('byteOffset', 0): bv.get('byteOffset', 0) + bv['byteLength']])
tmp = tempfile.mkdtemp(); a = os.path.join(tmp, 'i.img'); open(a, 'wb').write(data)
subprocess.run(['sips', '-Z', str(tsize), '-s', 'format', 'jpeg', '-s', 'formatOptions', '80', a, '--out', tex_out], check=True, capture_output=True)
# quantize
lo, hi = P.min(0), P.max(0); c = (lo + hi) / 2; s = (hi - lo).max() / 2 * 1.0001
q = np.round((P - c) / s * 32767).astype(np.int16)
qp = np.zeros((len(P), 4), np.int16); qp[:, :3] = q
quv = np.round(np.clip(UV, 0, 1) * 65535).astype(np.uint16)
assert len(P) < 65536
buf = qp.tobytes(); o_uv = len(buf); buf += quv.tobytes(); o_i = len(buf); buf += I.astype(np.uint16).tobytes()
while len(buf) % 4: buf += b'\0'
out = {
    'asset': {'version': '2.0'},
    'extensionsUsed': ['KHR_mesh_quantization'], 'extensionsRequired': ['KHR_mesh_quantization'],
    'scene': 0, 'scenes': [{'nodes': [0]}],
    'nodes': [{'mesh': 0, 'translation': c.tolist(), 'scale': [s, s, s]}],
    'meshes': [{'primitives': [{'attributes': {'POSITION': 0, 'TEXCOORD_0': 1}, 'indices': 2, 'material': 0}]}],
    'materials': [{'pbrMetallicRoughness': {'metallicFactor': 0.5, 'roughnessFactor': 0.4}}],
    'buffers': [{'byteLength': len(buf)}],
    'bufferViews': [{'buffer': 0, 'byteOffset': 0, 'byteLength': o_uv, 'byteStride': 8, 'target': 34962},
                    {'buffer': 0, 'byteOffset': o_uv, 'byteLength': o_i - o_uv, 'byteStride': 4, 'target': 34962},
                    {'buffer': 0, 'byteOffset': o_i, 'byteLength': len(I) * 2, 'target': 34963}],
    'accessors': [{'bufferView': 0, 'componentType': 5122, 'normalized': True, 'count': len(P), 'type': 'VEC3', 'min': q.min(0).tolist(), 'max': q.max(0).tolist()},
                  {'bufferView': 1, 'componentType': 5123, 'normalized': True, 'count': len(P), 'type': 'VEC2'},
                  {'bufferView': 2, 'componentType': 5123, 'count': len(I), 'type': 'SCALAR'}],
}
save(dst, out, bytearray(buf))
print('glb', os.path.getsize(dst), 'tex', os.path.getsize(tex_out), 'verts', len(P), 'tris', len(I) // 3)
