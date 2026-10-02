"""Slice each clip to the range the game uses, rebase to t=0, and write one assets/anims.json."""
import json, os
here = os.path.dirname(os.path.abspath(__file__))
# name: (start s, end s) or None for the whole clip
RANGES = json.load(open(os.path.join(here, 'ranges.json')))


def sl(track, a, b):
    t, v = track['t'], track['v']
    n = len(v) // len(t)
    keep = [i for i, x in enumerate(t) if a - 1e-6 <= x <= b + 1e-6]
    if not keep: keep = [0]
    return {'n': track['n'], 'p': track['p'], 't': [round(t[i] - a, 4) for i in keep], 'v': [round(x, 4) for i in keep for x in v[i * n:(i + 1) * n]]}


out = {}
for name, rng in RANGES.items():
    d = json.load(open(os.path.join(here, 'anim', name + '.json')))
    dur = d['tracks'][0]['t'][-1]
    a, b = (rng or [0, dur])
    tracks = [sl(tr, a, b) for tr in d['tracks'] if tr['p'] != 'scale' and (tr['p'] != 'translation' or tr['n'] == 'Hips')]
    out[name] = {'tracks': tracks}
json.dump(out, open(os.path.join(here, '..', 'assets', 'anims.json'), 'w'), separators=(',', ':'))
print('anims.json', os.path.getsize(os.path.join(here, '..', 'assets', 'anims.json')), 'bytes,', len(out), 'clips')
