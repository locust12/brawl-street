import glob, os
root = os.path.dirname(os.path.abspath(__file__))
src = os.path.join(root, 'src')

# headless fight engine (Node, JavaScriptCore): the same fight files as the page, no DOM
SIM_FILES = ['10_core.js', '20_chars.js', '21_roster2.js', '40_fighter.js', '41_combat.js', '50_ai.js', '51_ai2.js', '52_stale.js', '55_items.js', '56_items2.js', '57_items3.js', '60_game.js', '62_rules.js', '63_netsim.js', '64_stages2.js', '65_balance.js', '66_traits.js', '67_unique.js', '68_facing.js', '69_identity.js', '6a_buffer.js', '6b_hitstop.js', '6c_shieldpush.js', '6e_guns.js', '6f_motion.js', '6g_styles.js', '6h_akimbo.js']
# any other roster file (src/2x_*.js) joins the sim in name order too; keep the literal list above (net/tools parses it)
for _f in sorted(os.path.basename(p) for p in glob.glob(os.path.join(src, '2[0-9]_*.js'))):
    if _f not in SIM_FILES:
        SIM_FILES.insert(next((i for i, x in enumerate(SIM_FILES) if x > _f), len(SIM_FILES)), _f)
# ---- determinism lint (9/27): ECMAScript defines Math.sin/cos/tan/atan/atan2/pow/hypot/exp/log/cbrt
# as "implementation-approximated" -- V8 and JavaScriptCore may differ in the low bits, and one bit is
# enough to fork a chaotic fight. Math.sqrt IS exactly specified, so it stays allowed. The hand audit
# caught Math.random in five files and missed four transcendental calls in fight-deciding code
# (41_combat DI, 57_items3 bumper, 65_balance tumble, 6f_motion weight); see dev/NOTES-determinism-20260927.md.
# Use dsin/dcos/dhypot (10_core.js) instead, or rebuild the expression out of + - * / and sqrt.
_BANNED = __import__('re').compile(r'Math\.(?:sin|cos|tan|atan2|atan|pow|hypot|exp|log|cbrt|random)\b')
_bad = []
for _f in SIM_FILES:
    for _i, _line in enumerate(open(os.path.join(src, _f)), 1):
        _code = _line.split('//')[0]
        if 'det-ok' in _line:      # explicit, reviewed exemption
            continue
        for _m in _BANNED.finditer(_code):
            _bad.append(f'{_f}:{_i}  {_m.group(0)}  |  {_line.strip()[:90]}')
if _bad:
    print('\nDETERMINISM LINT FAILED -- these run in fight code and are not bit-stable across JS engines:')
    for _b in _bad: print('  ' + _b)
    print('\nUse dsin/dcos/dhypot, or + - * / and Math.sqrt. Mark a reviewed non-fight line `det-ok`.')
    raise SystemExit(1)
print('determinism lint: clean (' + str(len(SIM_FILES)) + ' sim files)')

head = open(os.path.join(src, '01_head.html')).read()
# Each source file is fenced with a marker comment so a downstream packager can excise one FILE
# cleanly. The portal build needs a version with no bet arena at all, and it had been doing that by
# substituting UI strings one at a time -- which silently rotted every time the copy changed and once
# shipped a broken build for five days. A fence is a rule; a list of strings is a snapshot.
# Comments only: nothing here changes what the page does, and it costs about 2 KB.
def _fenced(p):
    n = os.path.basename(p)
    return f'/*<<SRC:{n}>>*/\n' + open(p).read() + f'\n/*<<END:{n}>>*/'
js = '\n'.join(_fenced(p) for p in sorted(glob.glob(os.path.join(src, '*.js'))))
import datetime
js = "window.TB_BUILD = '" + datetime.datetime.now().strftime('%m%d-%H%M') + "';\n" + js
# test-fight record for the bet screen (written by arena/test/stats.js)
sp = os.path.join(root, 'arena', 'stats_v1.json')
if os.path.exists(sp):
    import json
    st = json.load(open(sp))
    form = {'pct': [f['pct'] for f in st['fighters']], 'h2h': st['h2h'], 'fights': st['fights']}
    js = 'const ARENA_FORM = ' + json.dumps(form, separators=(',', ':')) + ';\n' + js
# live arena config (written once the contract is deployed); without it the arena runs in practice mode
lp = os.path.join(root, 'arena', 'live.json')
if os.path.exists(lp):
    import json
    js = 'const ARENA_LIVE = ' + json.dumps(json.load(open(lp)), separators=(',', ':')) + ';\n' + js
# live escrow pin for real-ETH matches: {"escrow":"0x...","chainId":4663}
# Without it the page has to take the deposit address from the game server, which means a server
# that has been tampered with can redirect every player's stake. With it the page refuses any
# deposit that does not go to this exact address on this exact chain. Write it the moment
# BrawlEscrow is deployed, and rebuild.
ep = os.path.join(root, 'chain', 'live.json')
if os.path.exists(ep):
    import json
    js = 'const ESCROW_LIVE = ' + json.dumps(json.load(open(ep)), separators=(',', ':')) + ';\n' + js
mjs = '\n'.join(open(p).read() for p in sorted(glob.glob(os.path.join(src, '*.mjs'))))
open(os.path.join(root, 'game.js'), 'w').write(js)
open(os.path.join(root, 'game3d.mjs'), 'w').write(mjs)
open(os.path.join(root, 'index.html'), 'w').write(head + '\n<script>\n' + js + '\n</script>\n<script type="module">\n' + mjs + '\n</script>\n')
print('built', len(head) + len(js), 'bytes')
# local test copy with the same skeleton the artifact host wraps around the page
page = open(os.path.join(root, 'index.html')).read()
open(os.path.join(root, 'local.html'), 'w').write('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>[hidden]{display:none!important}body{margin:0}</style></head><body>\n' + page + '\n</body></html>')

prelude = """// GENERATED by build.py from src/ -- the exact fight code the page runs, minus rendering.
var addEventListener = function () {};
var R = { w: 1280, h: 720 };
var UI = { startDemo() {}, showResults() {}, onPause() {} };
"""
sim = prelude + '\n'.join(open(os.path.join(src, f)).read() for f in SIM_FILES)
sim += "\nvar FightSim = { ARENA, runFight, version: ARENA.version };\nif (typeof module !== 'undefined') module.exports = FightSim;\n"
os.makedirs(os.path.join(root, 'arena'), exist_ok=True)
open(os.path.join(root, 'arena', 'fightsim.js'), 'w').write(sim)

# ---- rig check (9/22 audit A3): a fighter model with no skinned rig plays no clip, takes no pose and holds
# no weapon (shroom_v2 / mochi_v2 shipped like that). The renderer gives them procedural motion instead of the fighter's older rigged
# art at load time (90_v3_core.mjs V3.loadChar), so this only WARNS; STRICT_RIGS=1 makes it fail the build.
def _unrigged_fighters():
    import json as _j, struct as _s
    listed = set()
    for mf in ('files.json', 'files_all.json'):
        p = os.path.join(root, 'publish', mf)
        if os.path.exists(p):
            try: listed.update(x for x in _j.load(open(p)) if isinstance(x, str))
            except Exception: pass
    cands = sorted(glob.glob(os.path.join(root, 'assets', '*_glb.wasm')))
    if listed: cands = [c for c in cands if 'assets/' + os.path.basename(c) in listed]
    bad = []
    for c in cands:
        b = os.path.basename(c)
        if b.startswith(('item_', 'stage_', 'car_')): continue
        try:
            with open(c, 'rb') as fh:
                head = fh.read(20)
                n = _s.unpack('<I', head[12:16])[0]
                gj = _j.loads(fh.read(n))
            if not gj.get('skins'): bad.append(b)
        except Exception as e:
            bad.append(b + ' (unreadable: %s)' % e)
    return bad
_bad = _unrigged_fighters()
if _bad:
    print('WARNING: shipped fighter models with NO skinned rig (they get procedural motion at load, see 99_v3_finish.mjs; they need a real rig): ' + ', '.join(_bad))
    if os.environ.get('STRICT_RIGS') == '1':
        raise SystemExit('STRICT_RIGS=1: refusing to build with unrigged fighter models')
