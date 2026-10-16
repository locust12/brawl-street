// ===== 3D renderer: fighters, effects, camera, frame =====
// Which animation clip plays for each game state. [clip, start s, end s] ranges are set in CLIP_RANGE.
const avatars = new Map();
// Exposed for the silhouette readability check (dev/silcheck.js): it needs to hide the fighter
// bodies and freeze their pose so the same frame can be rendered with and without them. Read-only
// in practice; nothing in the game reads V3.avatars.
V3.avatars = avatars;
V3._avatars = avatars;   // dev inspection
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector2();

// Purpose-made fighting clips (Meshy's library, rigged onto DOGE and brought into DOGE's rig space by
// dev/anim_import.py, 9/22 night) replace the generic ones move by move. V3.oldClips = true shows the old.
// A/B-tested on the real frame with the strike layer on (runs/clips/ab_old_new.png): only clips that beat the
// generic one are mapped. sweep2 / flykick2 lost (the old low lunge and horizontal flying kick read better).
// `kick: 'kick2'` was REMOVED on 9/23. kick2 is a bad retarget: on every body tested -- doge, ronin,
// brett, moodeng, pengu, whale, gigachad -- it tips the fighter onto its BACK with the legs in the
// air, through the whole active window (runs/clipmatrix/G_clipm_kick2_*.png, frames -6/-2/+2/+6).
// Because `kick` is the default clip for fsmash AND bair, the entire roster's forward smash and back
// air played that. The original `kick` is a clean standing side kick on every body, so it is the
// default again. Every other entry here was re-checked the same way and is good (runs/clipmatrix/H).
const NEWCLIP = { jab: 'jab2', punch: 'punch2', uppercut: 'upper2', slam: 'slam2', cast: 'cast2' };
// and per state: dodges get their own clips (both played `spin`), the shield a real block, and hitstun a hit
// reaction on the ground / a launch in the air. Each only once its clip exists in anims.json.
// Body types throw different strikes (audit B1: "a penguin, a turtle, a mannequin and a mushroom all throw the
// same kick"). Heavy = weight >= 115, fast = walk >= 7 or weight <= 88; everyone else uses NEWCLIP. Per clip,
// only when that clip shipped.
const HEAVY_CLIP = { punch: 'fists2' }, FAST_CLIP = { kick: 'fkick2' };   // fkick2 = Meshy 218 Step_in_High_Kick (9/22 night)   // spinkick (216) lost its A/B: mid-spin the kicking leg is behind the body at contact
const bodyOf = f => { const c = f.c; return c.weight >= 115 ? 'heavy' : (c.walk >= 7 || c.weight <= 88) ? 'fast' : 'mid'; };
// Per-FIGHTER clips for the normals (Duane, 9/23: "each character feels too similar"). The body-type
// swap above only reaches two clips, so eleven of the twelve still threw the same punch and the same
// kick. 6g_styles.js gives each of the core twelve its own frame data; this gives them their own
// motion to go with it, out of the 16 attack clips in assets/anims.json. Names here are FINAL - they
// skip NEWCLIP and the heavy/fast swap on purpose, so a style beats a body type.
//   BRETT and GIGACHAD never kick. BONK, WHALE and MOODENG swing overhead. RONIN spins the blade.
//   PENGU spins on the belly. POPCAT throws the plainest, fastest jab in the game.
// V3.noStyleClips = back to the shared mapping (A/B).
// EVERY entry below was rendered on THAT fighter's own body at the frame the move connects and
// looked at (dev/anim_probe clipm_<clip>_<dN>, sheets in runs/clipmatrix). Rules that came out of it:
//   - `kick`, `punch2`, `jab2`, `uppercut`, `upper2`, `sweep`, `spin`, `cast2` read on every body
//   - `fkick2` and `flykick` only read on the tall/slim rigs; on a round or short body the fighter
//     ends up horizontal or on its back, so they are never given to pengu / whale / mochi / moodeng
//   - `slam` reads as a committed forward stride on a tall or heavy body and as a stumble on a small
//     round one, so Pengu lost it (it folded him double, facing away -- Duane, 9/23)
//   - `punch` raises a leg on several rigs; only Ronin, whose lunge-thrust it suits, keeps it
//   - `fists2` holds a guard rather than striking, so it is a boxer's pose, not a smash
const STYLE_CLIP = {
  pepe:     { ftilt: 'cast2', fsmash: 'kick', nair: 'spin', bair: 'fkick2' },
  shib:     { ftilt: 'kick', fsmash: 'fkick2', nair: 'spin', bair: 'kick' },
  bonk:     { jab: 'punch2', ftilt: 'fists2', fsmash: 'slam', usmash: 'uppercut', nair: 'spin', fair: 'slam', bair: 'kick' },
  wif:      { ftilt: 'kick', nair: 'spin', bair: 'fkick2' },
  pengu:    { jab: 'jab2', ftilt: 'punch2', fsmash: 'kick', dsmash: 'spin', nair: 'spin', fair: 'kick', uair: 'uppercut' },
  popcat:   { jab: 'jab', ftilt: 'jab2', fsmash: 'spin', nair: 'spin', fair: 'fkick2' },
  brett:    { ftilt: 'punch2', fsmash: 'uppercut', usmash: 'upper2', nair: 'spin', fair: 'punch2', bair: 'fists2' },
  moodeng:  { jab: 'fists2', ftilt: 'slam', fsmash: 'kick', usmash: 'uppercut', nair: 'spin', fair: 'kick', bair: 'kick', uair: 'uppercut' },
  whale:    { jab: 'fists2', ftilt: 'fists2', fsmash: 'slam', usmash: 'uppercut', nair: 'spin', fair: 'slam', bair: 'kick', uair: 'uppercut' },
  gigachad: { jab: 'punch2', ftilt: 'uppercut', fsmash: 'slam', usmash: 'upper2', nair: 'spin', fair: 'punch2', bair: 'kick', uair: 'uppercut' },
  ronin:    { jab: 'jab', ftilt: 'punch', fsmash: 'spin', nair: 'spin', fair: 'slam', bair: 'kick', uair: 'uppercut' },
};
// which of the fighter's own move slots this definition is, so the table above can be keyed by name
const MOVE_KEY = ['jab', 'ftilt', 'utilt', 'dtilt', 'fsmash', 'usmash', 'dsmash', 'nair', 'fair', 'bair', 'uair', 'dair'];

// ---- AUTO-STYLE: the same treatment for the OTHER 34 fighters -------------------------------
// The table above is hand-authored and covers 11 fighters. Everyone else fell through to the
// body-type swap, which reaches exactly TWO clips (HEAVY_CLIP punch->fists2, FAST_CLIP
// kick->fkick2) -- so 34 of the 46 still threw the same jab, the same smash and the same aerial as
// each other, which is the "every character feels the same" note again, just further down the
// roster. This derives a moveset per fighter instead of authoring 34 more by hand.
//
// It is NOT random. Two constraints come straight off the 9/23 render sheets documented above:
//   * the palette is only clips that were LOOKED AT on a real body -- the eight that read on every
//     body, plus the ones the hand-authored tables already use;
//   * the body-dependent ones stay gated. `fkick2`/`flykick` put a round or short fighter on its
//     back, and `slam` folds one double, so both are reserved for slim/tall or heavy frames.
//     `punch` raises a leg on several rigs (only Ronin keeps it) so it is not in any pool.
// Within those limits the choice is a stable draw off the fighter's own id, biased by the identity
// 97_v3_pose already computes (heavy / quick / brawn), so a tank and a runner reach for different
// clips and two fighters with the same stat line still differ. No per-fighter authoring, and a new
// roster entry is covered the moment it exists.
// V3.noAutoStyle = off (A/B against the old shared mapping).
const AUTO_POOL = {
  jab:    { base: ['jab2', 'punch2', 'jab'],          heavy: ['fists2'] },
  ftilt:  { base: ['punch2', 'kick', 'cast2'],        heavy: ['fists2', 'slam'], slim: ['uppercut'] },
  utilt:  { base: ['uppercut', 'upper2'] },
  dtilt:  { base: ['sweep', 'spin'] },
  fsmash: { base: ['kick', 'spin', 'uppercut'],       heavy: ['slam'],           slim: ['fkick2'] },
  usmash: { base: ['uppercut', 'upper2'] },
  dsmash: { base: ['sweep', 'spin'] },
  nair:   { base: ['spin'] },
  fair:   { base: ['kick', 'punch2'],                 heavy: ['slam'],           slim: ['fkick2', 'flykick'] },
  bair:   { base: ['kick'],                           heavy: ['fists2'],         slim: ['fkick2'] },
  uair:   { base: ['uppercut', 'upper2'] },
  // `slam` is NOT in this base pool. It was, and it reached 30 fighters including mochi -- one of
  // the four round bodies the 9/23 pass says it folds double. A gated clip has to be gated in
  // EVERY slot, not just the ones where it looks obviously wrong.
  dair:   { base: ['sweep', 'spin'],                  heavy: ['slam'] },
};
// The bodies the render sheets named by hand: `fkick2` / `flykick` put these on their back and
// `slam` folds them double, whatever their stat line says. Three of the four are hand-authored
// already; mochi is not, and it is exactly the one the ungated pool caught out.
const ROUND_BODY = new Set(['pengu', 'whale', 'mochi', 'mochi_v2', 'moodeng']);
const autoCache = new Map();
function autoStyleFor(c) {
  const id = (c && c.id) || 'x';
  let t = autoCache.get(id); if (t) return t;
  const G = V3.gaitOf ? V3.gaitOf(c) : null;
  const round = ROUND_BODY.has(id) || ROUND_BODY.has((c && c.baseOf && c.baseOf.id) || '');
  const heavy = !round && (G ? G.heavy > 0.45 : (c.weight || 100) >= 115);
  // slim = quick AND not heavy: the frames fkick2 / flykick / slam were cleared on
  const slim = !round && (G ? (G.quick > 0.45 && G.heavy < 0.5) : ((c.walk || 6) >= 7 && (c.weight || 100) <= 95));
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  t = {};
  let n = 0;
  for (const k of MOVE_KEY) {
    const p = AUTO_POOL[k]; if (!p) continue;
    const pool = p.base.concat(heavy && p.heavy ? p.heavy : [], slim && p.slim ? p.slim : [])
      .filter(x => !V3.hasClip || V3.hasClip(x));
    if (!pool.length) continue;
    // a separate draw per slot, so one fighter does not take the same index everywhere
    const r = ((h >>> ((n++ % 6) * 5)) & 31) / 31;
    t[k] = pool[Math.min(pool.length - 1, Math.floor(r * pool.length))];
  }
  autoCache.set(id, t);
  return t;
}
function styleClip(f, d) {
  if (V3.noStyleClips || !V3.hasClip) return null;
  const c = f.c, id = c && c.id;
  const t = STYLE_CLIP[id] || (V3.noAutoStyle ? null : autoStyleFor(c));
  if (!t) return null;
  const M = f.m;
  for (const k of MOVE_KEY) if (M[k] === d) { const cl = t[k]; return cl && V3.hasClip(cl) ? cl : null; }
  return null;
}
V3.autoStyleFor = autoStyleFor;   // dev inspection (dev/aaa/movesets.mjs)
V3.STYLE_CLIP_FOR = id => STYLE_CLIP[id] || null;
function stateClipNew(f, c) {
  if (V3.oldClips || !V3.hasClip) return c;
  const pick = n => (V3.hasClip(n) ? n : c);
  if (f.state === 'move') {
    // dev: force one clip on everybody, so a clip can be reviewed on every body type before it is
    // assigned to anyone (dev/anim_probe clipm_<clip>_<pct>). A tall humanoid's `slam` folds a short
    // round body double and points it away from the camera -- that has to be SEEN, not assumed.
    if (V3.forceClip && V3.hasClip(V3.forceClip)) return V3.forceClip;
    // the fighter's own clip for this normal wins outright: NEWCLIP would otherwise fold 'kick' back
    // to kick2 for everyone and Doge and Pepe would throw the same smash again
    if (f.move) { const sc = styleClip(f, f.move.def.base || f.move.def); if (sc) return sc; }
    const b = bodyOf(f), alt = b === 'heavy' ? HEAVY_CLIP[c] : b === 'fast' && !V3.noFastClip ? FAST_CLIP[c] : null;
    if (alt && V3.hasClip(alt)) return alt;
    if (V3.kickAll && c === 'kick' && V3.hasClip('fkick2')) return 'fkick2';   // dev A/B
  }
  // held in a grab: braced with the guard up, struggling (the `hit` clip is a flying-back pose: victims lay flat)
  if (f.state === 'grabbed' && !V3.oldClips) return 'block';
  if (f.state === 'roll') return pick('roll2');
  if (f.state === 'spot') return pick('dodge2');
  if (f.state === 'shield' && c === 'block') return pick('block2');
  if (f.state === 'hitstun' && f.tumble && f.air) return pick('launch2');   // (hit2 lost its A/B: the old flinch reads as a hit)
  if (f.state === 'ground' && c === 'guard' && V3.stanceIdle) return pick('stance2');
  if (f.state === 'move' && NEWCLIP[c]) return pick(NEWCLIP[c]);
  return c;
}
function moveClip(f) { return moveClip0(f); }
function moveClip0(f) {
  const d = f.move.def.base || f.move.def, M = f.m;
  if (d.clip) return d.clip;   // moves that name their own clip (21_roster2)
  if (d.gunAnim) return 'guard';   // guns plant and aim (97_v3_pose): the punch clip read as turning away
  if (d.throwAnim) return 'punch';
  const sc = styleClip(f, d); if (sc) return sc;   // (also applied in stateClipNew, which is final)
  if (d === M.jab) return 'jab';
  if (d === M.ftilt || d === M.grab || d === M.getup) return 'punch';
  if (d === M.fsmash || d === M.bair) return 'kick';
  if (d === M.utilt || d === M.usmash || d === M.uair) return 'uppercut';
  if (d === M.dtilt || d === M.dsmash) return 'sweep';
  if (d === M.nair) return V3.nairClip || 'flykick';
  if (d === M.fair) return 'flykick';
  if (d === M.dair) return 'slam';
  if (d === M.nb) return d.counter ? 'block' : 'cast';
  if (d === M.sb) return 'flykick';
  // the stock up special (no clip or effect of its own) is a rising attack: once off the ground the body takes the
  // jump clip's take-off stretch (scrubbed by vy) instead of a planted ground uppercut floating up, and
  // 97_v3_pose puts the fist overhead (Mario's Super Jump Punch / a Shoryuken)
  if (d === M.ub) return f.air && !d.fx && !V3.noRise ? 'jump' : 'uppercut';
  if (d.counter) return 'block';
  const db = M.db;
  if (d === db || d === db.ground || d === db.air || (db.air && d === db.air.land)) return 'slam';
  return 'punch';
}
function stateClip(f) {
  switch (f.state) {
    // the resting clip is the fighter's own: a Chill Guard or a Shell Plating tank stands in `block`
    // with its hands up, a Drifter rests in the loose `idle`, everyone else in `guard` (97_v3_pose)
    case 'ground': return f.crouch ? 'guard' : Math.abs(f.vx) > 0.8 ? 'run' : (V3.gaitIdleClip ? V3.gaitIdleClip(f) : 'guard');
    case 'jumpsquat': case 'land': case 'respawn': case 'climb': return 'guard';
    case 'air': case 'airdodge': case 'helpless': return 'jump';
    case 'hitstun': case 'grabbed': return 'hit';
    case 'dizzy': return 'idle';
    case 'shield': return 'block';
    case 'roll': case 'spot': return 'spin';
    case 'ledge': return 'hang';
    case 'grabbing': return 'punch';
    case 'hammer': return 'slam';
    case 'final': return 'cast';
    case 'move': return f.move ? moveClip(f) : 'idle';   // a tick that clears the move mid-frame must not throw the renderer
  }
  return 'idle';
}
// Scrubbed clips: gameplay frame drives the pose, so strikes land on the hit frame.
const SCRUB = new Set(['jab', 'punch', 'kick', 'uppercut', 'sweep', 'flykick', 'slam', 'cast', 'spin', 'jump', 'hit',
  'jab2', 'punch2', 'kick2', 'upper2', 'sweep2', 'flykick2', 'slam2', 'cast2', 'hit2', 'launch2', 'roll2', 'dodge2', 'fists2', 'fkick2', 'rkick', 'spinkick']);
const CLIP_RANGE = window.CLIP_RANGE || {};

// ---- strike sync: the fix for "the arms are too short with a lot of the characters" ----
//
// The clips are shared across the whole roster (assets/anims.json, one Meshy skeleton) and each one
// reaches full extension at a fixed point in its OWN timeline. The scrub above played the clip
// linearly across the whole move, so that pose had no reason to land on the frames the hitbox is
// actually live — and measured (dev/aaa/reach_rig.mjs, which replays this file's maths headlessly)
// it mostly did not:
//
//   move    hitbox live (k)   clip reaches full extension at   reach missing at contact
//   ftilt     0.27 - 0.39                 0.58                 22 units (max 37)
//   fsmash    0.28 - 0.36                 0.60                 27 units (max 30)
//   grab      0.20 - 0.27                 0.58                 30 units (max 43)
//   bair      0.22 - 0.31                 0.63                  8 units (max 17)
//
// So on the exact frame a fighter connects, its arm is still half folded — the swing looks stubby and
// the punch appears to fall short even though the hitbox is generous. Both reference games line the
// contact pose up with the active frames; this does the same by warping the clip's own time so its
// strike sits in the middle of the hit window, with 0 -> 0 and 1 -> 1 so the move still starts at the
// start and ends at the end. Wind-up compresses, recovery stretches, which is also what makes a strike
// read as fast.
//
// PURELY VISUAL: this file is page-only (build.py puts src/*.mjs in game3d.mjs, never in SIM_FILES),
// so no hitbox, no frame count and no fight outcome changes. arena/fightsim.js does not contain it.
const STRIKE = { jab: 0.33, punch: 0.58, kick: 0.60, uppercut: 0.52, sweep: 0.38, flykick: 0.57, slam: 0.42, jab2: 0.444, kick2: 0.5, punch2: 0.51, upper2: 0.29, cast2: 0.5, fists2: 0.62, fkick2: 0.54, spinkick: 0.72 };
const hitMidCache = new WeakMap();   // never write to the shared move defs the sim owns
function hitMid(d) {
  if (hitMidCache.has(d)) return hitMidCache.get(d);
  let lo = Infinity, hi = -Infinity;
  if (d.hits) for (const hb of d.hits) if (hb.f) { if (hb.f[0] < lo) lo = hb.f[0]; if (hb.f[1] > hi) hi = hb.f[1]; }
  const total = Math.max(1, d.total || 1);
  const v = hi >= lo ? Math.min(0.9, Math.max(0.1, (lo + hi) / 2 / total)) : null;
  hitMidCache.set(d, v);
  return v;
}
function strikeSync(f, clip, k) {
  if (window.__noStrikeSync) return k;   // dev A/B switch (dev/aaa/shot_strike.js)
  const S = STRIKE[clip];
  if (S == null || f.state !== 'move' || !f.move) return k;
  const m = hitMid(f.move.def);
  if (m == null) return k;
  // Per-fighter attack timing, INSIDE the two segments so the contact pose still lands exactly on the
  // active frames and every reach number in the table above is preserved. e > 1: the heavy loads up,
  // hangs at the top of the wind-up and is hauled through contact. e < 1: the light one snaps out and
  // holds the follow-through. Same clip, two completely different-feeling swings.
  const e = V3.gaitEase ? V3.gaitEase(f) : 1;
  if (e !== 1) k = k <= m ? m * Math.pow(k / m, e) : m + (1 - m) * Math.pow((k - m) / (1 - m), 1 / e);
  return k <= m ? (k / m) * S : S + (k - m) / (1 - m) * (1 - S);
}

// ---- the stage's VISIBLE edge (audit #23, 9/22 night) ----
// A hanging fighter is placed 0.42 body-widths outside the collision edge (40_fighter grabLedge), but every stage
// body is modelled wider than its collision box, and the model is drawn 1.32x its hitbox: on Rune Isle, Dojo,
// Rooftop, Keep, Lava Temple and Neon City the hanging fighter was hidden inside the stage block, hands and all.
// The visible edge per side = the outermost stage-body mesh that straddles the fight plane and runs from the top
// surface down (measured once per arena); a hanging fighter is drawn that much further out, hands on the corner.
const edgeBox = new THREE.Box3();
V3.stageEdges = function () {
  const arena = V3.internals().arena(), st = Game.stage;
  if (!arena || !st || !st.main) return null;
  if (arena.userData.edges && arena.userData.edges.id === st.id) return arena.userData.edges;
  const M = st.main, top = -M.top * SC, x0 = M.x0 * SC, x1 = M.x1 * SC;
  let L = x0, R = x1, FL = 0, FR = 0;
  arena.updateMatrixWorld(true);
  arena.traverse(o => {
    if (!o.isMesh || !o.geometry) return;
    for (let q = o; q && q !== arena; q = q.parent) if (!q.visible) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    edgeBox.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
    const b = edgeBox;
    if (b.min.z > 0.05 || b.max.z < -0.05) return;                 // not across the fight plane
    if (b.max.y < top - 0.02 || b.min.y > top - 0.25) return;       // not the body just under the top surface
    if (b.max.y > top + 0.4) return;                                // something standing up past the top (posts, walls)
    if (b.max.x - b.min.x > 40 || b.max.x < x0 || b.min.x > x1) return;
    L = Math.min(L, b.min.x); R = Math.max(R, b.max.x);
    if (b.min.x <= x0 + 0.5) FL = Math.max(FL, b.max.z);            // how far the body's front comes toward the camera at each corner
    if (b.max.x >= x1 - 0.5) FR = Math.max(FR, b.max.z);
  });
  return (arena.userData.edges = { id: st.id, L: Math.max(L, x0 - 1.2), R: Math.min(R, x1 + 1.2), x0, x1, FL: Math.min(FL, 2.4), FR: Math.min(FR, 2.4) });
};
const ledgeRay = new THREE.Raycaster(), ledgeP = new THREE.Vector3(), ledgeD = new THREE.Vector3();
function ledgeOcclusion(av, f) {
  const arena = V3.internals().arena(); if (!arena) return 0;
  const cam = V3.camera.position, base = av.root.position; let zMax = 0;
  for (const fy of [0.2, 0.9, 1.6]) {
    ledgeP.set(base.x, base.y + f.h * SC * fy * 0.66, 0);
    ledgeD.subVectors(ledgeP, cam); const dist = ledgeD.length(); ledgeD.normalize();
    ledgeRay.set(cam, ledgeD); ledgeRay.far = dist - 0.02; ledgeRay.camera = V3.camera;
    const hits = ledgeRay.intersectObject(arena, true);
    for (const h of hits) {
      let vis = true; for (let q = h.object; q; q = q.parent) if (!q.visible) { vis = false; break; }
      const m = h.object.material;
      if (!vis || !h.object.isMesh || (m && (m.transparent && m.opacity < 0.6))) continue;
      zMax = Math.max(zMax, h.point.z); break;
    }
  }
  return zMax > 0.02 ? Math.min(zMax + 0.12, 3) : 0;
}
class Avatar {
  constructor(f) {
    const mk = V3.makeModel(f.c.id);
    // root (position + yaw) -> mirror (x scale +/-1) -> model. Facing LEFT is the exact mirror image of facing
    // right instead of the same model turned the other way: the shared clips stand in a bladed stance twisted
    // ~60 degrees one way, and turned left that twist added to the yaw and showed the camera the fighter's
    // BACK (Duane's "facing the wrong way", audit / NOTES-aaa2). Three flips the face winding by itself for a
    // negative-determinant matrix; 97_v3_pose's world-space maths is made mirror-safe.
    this.f = f; this.root = new THREE.Group(); this.model = mk.root;
    this.mirror = new THREE.Group(); this.root.add(this.mirror); this.mirror.add(mk.root);
    const scale = (f.h * SC * 1.32) / mk.height;
    mk.root.scale.setScalar(scale); mk.root.position.y = -mk.minY * scale;
    try { if (window.CustomLook && CustomLook.apply) CustomLook.apply(f.c.id, mk.root, THREE, f); } catch (e) { V3.fxErr(e, '91_v3_render:150'); /* cosmetic only */ }
    let hips = null; mk.root.traverse(o => { if (o.isBone && o.name === 'Hips' && !hips) hips = o; });
    this.clips = V3.clipsFor(f.c.id, hips ? hips.position.clone() : null);
    this.mixer = new THREE.AnimationMixer(mk.root);
    this.actions = {};
    for (const [n, c] of Object.entries(this.clips)) { const a = this.mixer.clipAction(c); a.enabled = true; this.actions[n] = a; }
    this.cur = null; this.mats = [];
    mk.root.traverse(o => { if (o.isMesh) this.mats.push(o.material); });
    this.yaw = f.face * (Math.PI / 2 - 0.5);
    const shieldMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(f.color).multiplyScalar(1.6), transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false });
    this.shield = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), shieldMat); this.shield.visible = false; V3.scene.add(this.shield);
    const tagMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(f.color).multiplyScalar(2.2) });
    this.tag = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.12, 3), tagMat); this.tag.rotation.x = Math.PI; V3.scene.add(this.tag);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.05, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(f.color).multiplyScalar(2), transparent: true, opacity: 0.8 }));
    this.disc = disc; disc.visible = false; V3.scene.add(disc);
    V3.scene.add(this.root);
  }
  play(name, fade) {
    if (!this.actions[name]) name = 'idle';
    if (this.cur === name) return this.actions[name];
    const next = this.actions[name], prev = this.cur && this.actions[this.cur];
    next.reset(); next.setEffectiveWeight(1); next.play();
    if (prev) {
      // three's crossFadeTo always ramps the outgoing action from weight 1, whatever it is actually
      // at. Interrupt a fade half way -- which happens constantly in a fight, a jab into a tilt into a
      // shield -- and the old clip SNAPS back up to full weight before fading, which is the twitch in
      // audit #22. Fade from where it really is, over a proportionally shorter time.
      const w = typeof prev.getEffectiveWeight === 'function' ? prev.getEffectiveWeight() : 1;
      if (fade > 0 && w > 0.02 && typeof prev._scheduleFading === 'function') prev._scheduleFading(fade * Math.max(0.2, w), w, 0);
      else if (fade > 0) prev.crossFadeTo(next, fade, false);
      else { prev.setEffectiveWeight(0); prev.stop(); }
    }
    this.cur = name; return next;
  }
  update(dt) {
    const f = this.f, dead = f.state === 'dead';
    this.root.visible = !dead && !MV2.hidden(f); this.tag.visible = !dead; this.disc.visible = f.state === 'respawn';
    if (dead) { this.shield.visible = false; return; }
    const z = (f.idx - 1.5) * 0.06;
    // hitstop shake, Sakurai's rules: the victim shakes a lot and the attacker a little, visual only (never the
    // hurtbox), side to side on the ground and up and down in the air, decaying over the freeze. Was a
    // random +-0.025 jitter on the victim only.
    let sx = 0, sy = 0;
    if (f.hitlag > 0) {
      if (!(this.hlPrev > 0) || f.hitlag > this.hlPrev) this.hl0 = f.hitlag;   // a new freeze started
      const vict = f.state === 'hitstun', k = f.hitlag / Math.max(1, this.hl0);
      const amp = (vict ? 0.05 : 0.012) * (0.45 + Math.min(1, this.hl0 / 14) * 0.55) * k;
      const s = (f.hitlag % 2 ? 1 : -1) * amp;
      if (vict && f.air) sy = s; else sx = s;
    }
    this.hlPrev = f.hitlag;
    this.root.position.set(f.x * SC + sx, -f.y * SC + sy, z);
    const want = f.state === 'ledge' ? f.face * (Math.PI / 2) : f.face * (Math.PI / 2 - 0.5);
    this.yaw += (want - this.yaw) * (f.state === 'move' ? 0.5 : 0.3);
    this.root.rotation.set(0, this.yaw, 0);
    // flip as the turn passes the camera (yaw 0, the one pose that reads the same either way), not on the
    // facing change itself: flipping while the yaw is still on the old side shows the back for a frame
    this.mirror.scale.x = this.yaw < 0 ? -1 : 1;
    if (f.state === 'ledge') this.root.position.y -= f.h * SC * 0.5;
    // squash & stretch on landings / jumps
    const sq = f.sq || 0; this.root.scale.set(1 + sq * 0.5, 1 - sq, 1 + sq * 0.5);
    // LEDGE HANG IN VIEW (audit #23, 9/22 night): every stage body comes 1.2-2.4 units toward the camera from the fight
    // plane, so in perspective its front face covered a fighter hanging just past the edge: on 6 of 7 stages checked
    // the hanging fighter was invisible (runs/ledge/six.png). On the grab, rays from the camera to the fighter's head,
    // middle and feet find the frontmost stage surface in the way; the fighter hangs just in front of it, scaled by
    // the depth ratio so it keeps its on-screen size, easing in on the grab and back out after. Visual only.
    if (!V3.noLedgeZ) {
      if (f.state === 'ledge' && f.ledge) {
        if (this.ledgeKey !== f.ledge) { this.ledgeKey = f.ledge; try { this.ledgeZ = ledgeOcclusion(this, f); } catch (e) { this.ledgeZ = 0; V3.fxErr(e, '91 ledgeOcclusion'); } }
      } else this.ledgeKey = null;
      const want = f.state === 'ledge' ? (this.ledgeZ || 0) : 0;
      this.hangZ = (this.hangZ || 0) + (want - (this.hangZ || 0)) * (want > (this.hangZ || 0) ? 0.45 : 0.2);
      if (this.hangZ > 0.005) {
        const cz = Math.max(1, V3.camera.position.z), k = (cz - this.hangZ) / cz;
        this.root.position.z += this.hangZ; this.root.scale.multiplyScalar(k);
        this.root.position.x = V3.camera.position.x + (this.root.position.x - V3.camera.position.x) * k;
        this.root.position.y = V3.camera.position.y + (this.root.position.y - V3.camera.position.y) * k;
      }
    }
    const clip = stateClipNew(f, stateClip(f));
    // ATTACKS DO NOT BLEND. Sakurai, on Smash's attack animations: the character "skips" to the
    // startup pose with no smooth transition, because a smooth one reads as slow and an attack has to
    // answer the button on the frame it is pressed. The shipped data agrees -- all 24 of Kirby's
    // attack motions have TransitionFrames 0, while wait/walk/run blend over 6. We were mushing every
    // attack through a 0.06 s (3.6 frame) fade. Locomotion keeps a blend, now 6 frames like Smash's.
    // V3.softClips = the old 0.06 / 0.14 for A/B.
    const act = this.play(clip, V3.softClips ? (SCRUB.has(clip) ? 0.06 : 0.14) : (SCRUB.has(clip) ? 0 : 0.10));
    const range = CLIP_RANGE[clip];
    if (SCRUB.has(clip)) {
      let k;
      if (f.state === 'hammer') k = 0.3;   // hold one overhead frame: the swing itself is posed (97_v3_pose)
      else if (clip === 'jump') k = Math.min(1, Math.max(0, (f.vy + 14) / 22));
      else if (clip === 'hit' || clip === 'hit2' || clip === 'launch2') k = Math.min(1, f.st / Math.max(1, f.hitstun || 20));
      else if (clip === 'spin' || clip === 'roll2') k = Math.min(1, f.st / 28);
      else if (clip === 'dodge2') k = Math.min(1, f.st / 24);
      else if (f.state === 'final') k = Math.min(0.55, f.st / 30);
      else {
        k = f.move ? Math.min(1, f.move.t / Math.max(1, f.move.def.total)) : 0;
        k = strikeSync(f, clip, k);   // land the clip's strike pose ON the active frames (see below)
      }
      act.paused = true;
      const [a, b] = range || [0, act.getClip().duration];
      act.time = a + (b - a) * k;
    } else {
      act.paused = f.hitlag > 0;
      if (range && act.time < range[0]) act.time = range[0];
      if (range && act.time > range[1]) act.time = range[0] + ((act.time - range[0]) % Math.max(0.05, range[1] - range[0]));
      // and at the fighter's own tempo: a 134 kg heavy idles and runs slower than a 74 kg speedster,
      // which is the difference you feel before you read anything else (97_v3_pose gaitRate)
      const tempo = V3.gaitRate ? V3.gaitRate(f) : 1;
      act.timeScale = (clip === 'run' ? Math.max(0.7, Math.abs(f.vx) / f.c.walk * 1.1) : 1) * tempo;
    }
    this.mixer.update(dt);
    // hit flash + invulnerability shimmer
    const flash = f.flashT > 0 && f.flashT % 4 < 2, inv = (f.invuln > 0 || f.intang) && Math.floor(f.t / 4) % 2;
    for (const m of this.mats) {
      m.emissive.setRGB(flash ? 0.2 : 0, flash ? 0.18 : 0, flash ? 0.14 : 0);   // was 0.42: with bloom every hit turned the victim into a white ghost (audit #4)
      if (f.move && f.move.def.charge && f.move.t === f.move.def.charge.at && f.move.charge > 0) m.emissive.setRGB(0.6 + Math.sin(f.t) * 0.3, 0.45, 0.05);
      m.transparent = !!inv; m.opacity = inv ? 0.55 : 1;
    }
    const headY = -f.y * SC + f.h * SC * 1.45;
    this.tag.position.set(f.x * SC, headY + 0.12 + Math.sin(f.t * 0.1) * 0.02, z); this.tag.rotation.y += 0.05;
    this.shield.visible = f.state === 'shield';
    if (this.shield.visible) { const r = f.h * SC * 0.8 * (0.35 + 0.65 * f.shieldHP / 60); this.shield.scale.setScalar(r); this.shield.position.set(f.x * SC, -f.y * SC + f.h * SC * 0.6, z); }
    if (this.disc.visible) this.disc.position.set(f.x * SC, -f.y * SC - 0.03, z);
    V3.decorate(this);
  }
  // Same leak as the arenas, one size down: V3.makeModel clones a material per mesh and the shield,
  // the tag and the disc each own geometry, so every match used to leave a full set behind. The
  // fighter's own texture is in `models[id]` and marked shared, so it is kept uploaded.
  dispose() {
    V3.scene.remove(this.root, this.shield, this.tag, this.disc); this.mixer.stopAllAction(); V3.disposeDecor(this);
    for (const o of [this.root, this.shield, this.tag, this.disc]) if (o && V3.disposeArena) V3.disposeArena(o);
  }
}

// ---- particles (sparks, dust) as one additive point cloud ----
const MAXP = 2500;
let pts, pPos, pCol, pSize;
function makePoints() {
  const g = new THREE.BufferGeometry();
  pPos = new Float32Array(MAXP * 3); pCol = new Float32Array(MAXP * 3); pSize = new Float32Array(MAXP);
  g.setAttribute('position', new THREE.BufferAttribute(pPos, 3)); g.setAttribute('color', new THREE.BufferAttribute(pCol, 3)); g.setAttribute('size', new THREE.BufferAttribute(pSize, 1));
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
    uniforms: { scale: { value: 400 } },
    vertexShader: 'attribute float size; varying vec3 vc; uniform float scale; void main(){ vc = color; vec4 mv = modelViewMatrix*vec4(position,1.); gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix*mv; }',
    fragmentShader: 'varying vec3 vc; void main(){ vec2 d = gl_PointCoord - .5; float r = dot(d,d); if (r > .25) discard; float a = smoothstep(.25, 0., r); gl_FragColor = vec4(vc * a * 1.6, a); }',
  });
  pts = new THREE.Points(g, m); pts.frustumCulled = false; V3.scene.add(pts);
}
const colTmp = new THREE.Color();
function syncParticles() {
  let n = 0;
  for (const p of Game.parts) {
    if (n >= MAXP) break;
    if (p.soft || p.streak) continue;   // drawn by the smoke and streak systems in 93
    const k = p.life / p.max;
    pPos[n * 3] = p.x * SC; pPos[n * 3 + 1] = -p.y * SC; pPos[n * 3 + 2] = 0.35;
    colTmp.set(p.color); const b = p.fire ? 1.25 : p.soft ? 0.35 : 1.2;
    pCol[n * 3] = colTmp.r * b * k; pCol[n * 3 + 1] = colTmp.g * b * k; pCol[n * 3 + 2] = colTmp.b * b * k;
    pSize[n] = (p.fire ? p.size * (1.5 - k * 0.5) : p.soft ? p.size * (2.2 - k) : p.size * (0.5 + k)) * SC * 1.6; n++;
  }
  // embers drifting up out of the lava
  const ar = V3.internals().arena();
  if (ar && ar.userData.embers) {
    const t = performance.now() / 1000;
    const nEmber = Math.round(140 * QUAL.parts);   // ambient dressing, not hit feedback: it scales
    for (let i = 0; i < nEmber && n < MAXP; i++, n++) {
      const s = i * 12.9898, life = ((t * 0.12 + (i * 0.618) % 1) % 1);
      pPos[n * 3] = ((Math.sin(s) * 43758.5) % 1) * 14 + Math.sin(t + i) * 0.3; pPos[n * 3 + 1] = -4 + life * 11; pPos[n * 3 + 2] = -1 - ((i * 7.13) % 1) * 8;
      colTmp.setHex(ar.userData.embers); const a = Math.sin(life * Math.PI);
      pCol[n * 3] = colTmp.r * a * 1.5; pCol[n * 3 + 1] = colTmp.g * a; pCol[n * 3 + 2] = colTmp.b * a * 0.5; pSize[n] = 0.05 + (i % 3) * 0.02;
    }
  }
  if (ar && (ar.userData.rain || ar.userData.petals)) {
    const t = performance.now() / 1000, rain = ar.userData.rain;
    const nDrift = Math.round((rain ? 260 : 120) * QUAL.parts);
    for (let i = 0; i < nDrift && n < MAXP; i++, n++) {
      const sx = ((i * 0.6180339) % 1), sz = ((i * 0.4142) % 1), sp = rain ? 1.6 : 0.12;
      const life = (t * sp + sx * 7.3) % 1;
      pPos[n * 3] = -14 + sx * 28 + (rain ? 0 : Math.sin(t + i) * 0.8); pPos[n * 3 + 1] = 9 - life * 16; pPos[n * 3 + 2] = 1.5 - sz * 10;
      if (rain) { pCol[n * 3] = 0.35; pCol[n * 3 + 1] = 0.45; pCol[n * 3 + 2] = 0.7; pSize[n] = 0.03; }
      else { pCol[n * 3] = 1.0; pCol[n * 3 + 1] = 0.55; pCol[n * 3 + 2] = 0.75; pSize[n] = 0.07; }
    }
  }
  for (let i = n; i < MAXP; i++) pSize[i] = 0;
  const g = pts.geometry; g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true; g.attributes.size.needsUpdate = true;
  g.setDrawRange(0, n);
}

// ---- rings (shockwaves), projectiles, hit light ----
const ringPool = [];
function syncRings() {
  let i = 0;
  for (const r of Game.rings) {
    let m = ringPool[i];
    if (!m) { m = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })); ringPool.push(m); V3.scene.add(m); }
    m.visible = true; m.position.set(r.x * SC, -r.y * SC, 0.3);
    m.rotation.set(r.flat ? -Math.PI / 2 : 0, 0, 0);
    m.scale.setScalar(Math.max(0.01, r.r * SC)); m.material.color.set(r.color).multiplyScalar(2.5); m.material.opacity = Math.min(1, r.life / 12);
    i++;
  }
  for (; i < ringPool.length; i++) ringPool[i].visible = false;
}
const projMeshes = new Map();
function projMesh(p) {
  const g = new THREE.Group();
  if (p.kind === 'coin') {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.035, 32), new THREE.MeshStandardMaterial({ color: 0xffc83a, metalness: 1, roughness: 0.25, emissive: 0x7a4a00, emissiveIntensity: 1.2 }));
    m.rotation.x = Math.PI / 2; g.add(m);
  } else if (p.kind === 'bone') {
    const mat = new THREE.MeshStandardMaterial({ color: 0xfff6e6, roughness: 0.6, emissive: 0x332a20 });
    g.add(new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.22, 4, 8), mat)); g.children[0].rotation.z = Math.PI / 2;
    for (const s of [-1, 1]) for (const t of [-1, 1]) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), mat); b.position.set(s * 0.14, t * 0.035, 0); g.add(b); }
  } else if (p.kind === 'hat') {
    const mat = new THREE.MeshStandardMaterial({ color: 0xff7ab8, roughness: 0.9 });
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat));
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.035, 8, 24), new THREE.MeshStandardMaterial({ color: 0xff4f9e })); rim.rotation.x = Math.PI / 2; g.add(rim);
  } else if (p.kind === 'laser') {
    const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.34, 4, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 2.6, 3) }));
    b.rotation.z = Math.PI / 2; g.add(b);
  } else if (p.kind === 'axe') {
    const wood = new THREE.MeshStandardMaterial({ color: 0x7a4a22, roughness: 0.8 }), steel = new THREE.MeshStandardMaterial({ color: 0xc8ccd4, metalness: 1, roughness: 0.3 });
    const h = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.36, 8), wood); g.add(h);
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.03, 20, 1, false, 0, Math.PI), steel); head.rotation.x = Math.PI / 2; head.position.y = 0.14; g.add(head);
  } else if (p.kind === 'cash') {
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.12, 0.06), new THREE.MeshStandardMaterial({ color: 0x3ec46d, roughness: 0.6, emissive: 0x0a3a18 }));
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.125, 0.065), new THREE.MeshStandardMaterial({ color: 0xffd45c })); g.add(c, band);
  } else if (p.kind === 'tear') {
    g.add(new THREE.Mesh(new THREE.SphereGeometry(p.r * SC * 0.9, 20, 14), new THREE.MeshStandardMaterial({ color: 0x7ec8ff, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.85, emissive: 0x1a5aa0, emissiveIntensity: 0.5 })));
  } else if (p.kind === 'goldbar') {
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.09, 0.12), new THREE.MeshStandardMaterial({ color: 0xffc83a, metalness: 1, roughness: 0.22, emissive: 0x5a3a00, emissiveIntensity: 0.8 })));
  } else if (V3.projMesh2 && V3.projMesh2(p, g)) {
    // roster-2 kinds: built by 94_v3_moves.mjs
  } else {
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 14), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, emissive: 0x6fb6ff, emissiveIntensity: 0.5 })));
  }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  // (9/22 night) a soft halo behind the small thrown projectiles (coin, bone, hat, tear, snowball): edge-on or against a
  // busy painting they vanished in flight. Additive, no depth write, a shared material per colour.
  const HALO = { coin: '#ffc83a', bone: '#fff2d8', hat: '#ff7ab8', tear: '#7ec8ff', snow: '#dff4ff', goldbar: '#ffc83a', cash: '#6affa0' };
  if (HALO[p.kind] && !V3.noHalo) {
    if (!haloTex) { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,.9)'); gr.addColorStop(0.35, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); haloTex = new THREE.CanvasTexture(c); }
    const hm = haloMats[p.kind] || (haloMats[p.kind] = new THREE.SpriteMaterial({ map: haloTex, color: new THREE.Color(HALO[p.kind]).multiplyScalar(1.6), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    const h = new THREE.Sprite(hm); h.scale.setScalar(Math.max(0.24, (p.r || 12) * SC * 3.0)); g.add(h);
  }
  V3.scene.add(g); return g;
}
const haloMats = {}; let haloTex = null;
function syncProjectiles() {
  const live = new Set(Game.projs);
  for (const [p, m] of projMeshes) if (!live.has(p)) { V3.scene.remove(m); projMeshes.delete(p); }
  for (const p of Game.projs) {
    let m = projMeshes.get(p); if (!m) { m = projMesh(p); projMeshes.set(p, m); }
    m.position.set(p.x * SC, -p.y * SC, 0.1);
    if (p.kind === 'coin') m.rotation.y = p.age * 0.35;
    else if (m.userData.anim2) m.userData.anim2(p, m);   // roster-2 kinds animate themselves (94)
    else m.rotation.z = -p.age * 0.45 * Math.sign(p.vx || 1);
  }
}
let hitLight = null, lastHits = 0;

// ---- camera ----
// ONE framing rule for every match. 9/20, Duane: "i cant see the full characters only half of them"
// and "the 4 players ... i could be in the right corner and it zooms into the left".
// Both came from the old code: it centred on `Game.cam.x * 0.85 * 0.92` (so the camera always sat 22%
// of the way back toward the stage centre) and then showed only 66% of the height the fit had solved
// for, which cut heads and feet off.
// What it does now: fit the box that holds every LIVE fighter -- feet, head and name tag -- into the
// part of the screen the HUD is not using (TB_HUD.layout, 71_hud.js), with
//   * a zoom floor and ceiling expressed as "a fighter is between 7.5% and 23.5% of the screen height",
//   * damped follow (zooms out faster than it zooms in, so nobody leaves frame),
//   * a bias toward the local player and a HARD guarantee that the local player is inside the frame.
// Anyone who still cannot be framed gets an arrow at the screen edge (drawn by R.hud, 71_hud.js).
// Visual only: reads Game, never writes it; shake uses Math.random, never the seeded Rng.
const camPos = new THREE.Vector3(0, 1.5, 12), camLook = new THREE.Vector3(0, 1, 0);
let camPunch = 0;
const CAM_TILT = 0.07;      // the camera sits this fraction of its distance above what it looks at
const CAM_MINFR = 0.075;    // a fighter is never smaller than this share of the screen height (no dots)
const CAM_MAXFR = 0.235;    // ...and never bigger, so a 1v1 clinch does not fill the screen
const CAM_HEAD = 1.86;      // clearance above the feet, in fighter heights (model is 1.32, name tag 1.62)
const CAM_FOOT = 0.30;      // clearance below the feet, in fighter heights
const camProbe = new THREE.PerspectiveCamera(FOV, 1, 0.1, 500);
const camV = new THREE.Vector3(), camC = { x: 0, y: 0 };
const camNow = { x: 0, y: -1.6, dist: 12, live: false };
V3.cam = camNow;
const CAM_TANF = Math.tan(FOV * Math.PI / 360);

function camPlace(cx, cy, dist, aspect) {
  camProbe.aspect = aspect; camProbe.position.set(cx, cy + dist * CAM_TILT, dist);
  camProbe.lookAt(cx, cy, 0); camProbe.updateMatrixWorld(true); camProbe.updateProjectionMatrix();
}
// where an NDC point lands on the z = 0 plane the fight lives on
function camHit(nx, ny) {
  camV.set(nx, ny, 0.5).unproject(camProbe);
  const p = camProbe.position; camV.sub(p);
  const t = Math.abs(camV.z) > 1e-6 ? -p.z / camV.z : 0;
  camC.x = p.x + camV.x * t; camC.y = p.y + camV.y * t; return camC;
}
// the HUD's hard insets, in CSS px
function camInsets(W, H) {
  let top = 132, bottom = 48;
  try {
    // the title-screen demo has no HUD over it, so it gets the open, cinematic framing
    if (Game.demo || Game.state !== 'match') return { top: 40, bottom: 40 };
    let touch = false; try { touch = !!Touch.visible; } catch (e) { V3.fxErr(e, '91_v3_render:414'); /* no touch layer */ }
    const L = window.TB_HUD && TB_HUD.layout(W, H, Game.fighters.length, touch);
    if (L) { top = L.top; bottom = L.bottom; }
  } catch (e) { V3.fxErr(e, '91_v3_render:417'); /* HUD not loaded: use the defaults */ }
  return { top, bottom };
}
// which fighter is the person holding the phone / keyboard (null in a CPU demo or the bet arena)
function camLocalOf(F) {
  try { const s = window.Net && Net.active ? Net.slot : null; if (s != null && F[s] && F[s].state !== 'dead') return F[s]; } catch (e) {}
  for (const f of F) if (f.state !== 'dead' && f.ctrl && f.ctrl !== 'cpu' && !String(f.ctrl).startsWith('net')) return f;
  for (const f of F) if (f.state !== 'dead' && f.ctrl && f.ctrl !== 'cpu') return f;
  return null;
}
const camBox = { x0: 0, x1: 0, y0: 0, y1: 0 }, camLoc = { x0: 0, x1: 0, y0: 0, y1: 0, has: false };
function camBoxes() {
  const F = Game.fighters, B = Game.stage.blast, L = camLocalOf(F);
  // The chase area. Someone already sailing out to a blast line should not drag the camera the whole
  // way with them, so their POSITION is clamped to this box -- never their silhouette, or the fit would
  // shave the head off anyone who is still legitimately in play up near the top of the stage.
  const cl = B.l * 0.85, cr = B.r * 0.85, cbot = B.b * 0.6, ctop = B.t * 0.8;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, tall = 0.9, any = false;
  camLoc.has = false;
  for (const f of F) {
    if (f.state === 'dead') continue;
    const hw = (f.w * 0.55 + 30) * SC, fx = clamp(f.x, cl, cr) * SC, fy = clamp(f.y, ctop, cbot);
    const a = fx - hw, b = fx + hw;
    const c = (-fy - f.h * CAM_FOOT) * SC, d = (-fy + f.h * CAM_HEAD) * SC;
    if (a < x0) x0 = a; if (b > x1) x1 = b; if (c < y0) y0 = c; if (d > y1) y1 = d;
    tall = Math.max(tall, f.h * 1.32 * SC); any = true;
    if (f === L) { camLoc.x0 = a; camLoc.x1 = b; camLoc.y0 = c; camLoc.y1 = d; camLoc.has = true; }
  }
  if (!any) { const M = Game.stage.main; x0 = M.x0 * SC; x1 = M.x1 * SC; y0 = -M.bot * SC; y1 = 2.4; }
  // never let the box collapse to a point (a single fighter): the dist clamp does the real zoom floor
  if (x1 - x0 < 1.2) { const m = (x0 + x1) / 2; x0 = m - 0.6; x1 = m + 0.6; }
  if (y1 - y0 < 1.2) { const m = (y0 + y1) / 2; y0 = m - 0.6; y1 = m + 0.6; }
  // THE "GAME!" TABLEAU. The loop above skips dead fighters, so the instant the last stock is taken the
  // box collapses onto the LONE SURVIVOR and the camera slams to its hardest zoom-in -- and because the
  // follow is damped, the GAME! banner played over a frame containing one glove and nothing else
  // (runs/p0ko, frames k11-k15: cine null, out null, winner off-frame). Smash holds a readable tableau
  // here. While the match is ending, the box is floored at a full-stage-ish size around whoever is left,
  // so the camera pulls BACK to a stable wide shot instead of pushing into a face. V3.noEndFrame = old.
  if (Game.endT && !V3.noEndFrame) {
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, MINW = 5.2, MINH = 2.9;
    if (x1 - x0 < MINW) { x0 = mx - MINW / 2; x1 = mx + MINW / 2; }
    if (y1 - y0 < MINH) { y0 = my - MINH / 2; y1 = my + MINH / 2; }
  }
  camBox.x0 = x0; camBox.x1 = x1; camBox.y0 = y0; camBox.y1 = y1;
  return tall;
}

function updateCamera(dt) {
  const cam = V3.camera, W = innerWidth || 1280, H = innerHeight || 720;
  const aspect = cam.aspect || W / H;
  const tall = camBoxes();
  const ins = camInsets(W, H);
  // safe rect in NDC: the HUD insets plus a small margin so nothing ever kisses the screen edge
  let sx0 = -1 + 2 * 26 / W, sx1 = 1 - 2 * 26 / W;
  let sy1 = 1 - 2 * (ins.top + 16) / H, sy0 = -1 + 2 * (ins.bottom + 16) / H;
  if (sy1 - sy0 < 0.5) { const m = (sy1 + sy0) / 2; sy0 = m - 0.25; sy1 = m + 0.25; }   // HUD ate the screen
  const zoomH = location.hash.includes(':zoom') ? 0.45 : 1;   // dev: #...:zoom for close-up render checks

  // --- fit: scale the distance and recentre until the box sits inside the safe rect ---
  const bw = camBox.x1 - camBox.x0, bh = camBox.y1 - camBox.y0;
  let cx = (camBox.x0 + camBox.x1) / 2, cy = (camBox.y0 + camBox.y1) / 2;
  let dist = Math.max(3, bh / (sy1 - sy0) / CAM_TANF);
  for (let i = 0; i < 9; i++) {
    camPlace(cx, cy, dist, aspect);
    let nx0 = 1e9, nx1 = -1e9, ny0 = 1e9, ny1 = -1e9;
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
      camV.set(a ? camBox.x1 : camBox.x0, b ? camBox.y1 : camBox.y0, 0).project(camProbe);
      if (camV.x < nx0) nx0 = camV.x; if (camV.x > nx1) nx1 = camV.x;
      if (camV.y < ny0) ny0 = camV.y; if (camV.y > ny1) ny1 = camV.y;
    }
    cx += ((nx0 + nx1) / 2 - (sx0 + sx1) / 2) * (bw / Math.max(1e-3, nx1 - nx0));
    cy += ((ny0 + ny1) / 2 - (sy0 + sy1) / 2) * (bh / Math.max(1e-3, ny1 - ny0));
    const s = Math.max((nx1 - nx0) / (sx1 - sx0), (ny1 - ny0) / (sy1 - sy0));
    dist *= s;
    if (Math.abs(s - 1) < 0.0008) break;
  }
  dist *= 1.012;   // a sliver of breathing room so a fighter never grazes the HUD edge
  // --- zoom floor / ceiling, as a share of the screen a fighter fills ---
  dist = clamp(dist * zoomH, tall / (2 * CAM_MAXFR * CAM_TANF) * zoomH, tall / (2 * CAM_MINFR * CAM_TANF));

  // --- recentre for that distance: keep the whole box if it fits, otherwise bias to the local player ---
  camPlace(cx, cy, dist, aspect);
  // the four corners of the safe rect, on the fight plane. The view is a trapezoid (the camera is
  // pitched down), so take the inner rectangle: max of the left edges, min of the right edges, etc.
  let c = camHit(sx0, sy0); const blx = c.x, bly = c.y;   // bottom-left
  c = camHit(sx1, sy0); const brx = c.x, bry = c.y;       // bottom-right
  c = camHit(sx0, sy1); const tlx = c.x, tly = c.y;       // top-left
  c = camHit(sx1, sy1); const trx = c.x, try_ = c.y;      // top-right
  const vx0 = Math.max(blx, tlx), vx1 = Math.min(brx, trx);
  const vy0 = Math.max(bly, bry), vy1 = Math.min(tly, try_);
  const vw = Math.max(0.2, vx1 - vx0), vh = Math.max(0.2, vy1 - vy0);
  const offX = (vx0 + vx1) / 2 - cx, offY = (vy0 + vy1) / 2 - cy;   // the insets push the view off-centre
  let px = (camBox.x0 + camBox.x1) / 2, py = (camBox.y0 + camBox.y1) / 2;
  // If the whole cast fits, the fit above already framed everyone and nothing else is needed. Only when
  // an axis cannot be framed do we lean toward the local player and then hard-guarantee them on screen.
  const tightX = bw > vw + 0.004, tightY = bh > vh + 0.004, m = 0.14;
  if (camLoc.has && (tightX || tightY)) {
    const lcx = (camLoc.x0 + camLoc.x1) / 2, lcy = (camLoc.y0 + camLoc.y1) / 2;
    if (tightX) {
      px = clamp(lerp(px, lcx, 0.6), camBox.x0 + vw / 2, Math.max(camBox.x0 + vw / 2, camBox.x1 - vw / 2));
      if (camLoc.x1 - camLoc.x0 < vw - 2 * m) px = clamp(px, camLoc.x1 - vw / 2 + m, camLoc.x0 + vw / 2 - m); else px = lcx;
    }
    if (tightY) {
      py = clamp(lerp(py, lcy, 0.6), camBox.y0 + vh / 2, Math.max(camBox.y0 + vh / 2, camBox.y1 - vh / 2));
      if (camLoc.y1 - camLoc.y0 < vh - 2 * m) py = clamp(py, camLoc.y1 - vh / 2 + m, camLoc.y0 + vh / 2 - m); else py = lcy;
    }
  }
  cx = px - offX; cy = py - offY;

  // --- damped follow: out fast, in slow, and snap on the first frame of a match ---
  const step = Math.min(4, Math.max(0.2, dt * 60));   // in 60ths of a second, so the feel is frame-rate independent
  if (!camNow.live) { camNow.x = cx; camNow.y = cy; camNow.dist = dist; camNow.live = true; }
  else {
    // While the match is ENDING the camera has to travel a long way: it was chasing the loser out
    // toward the blast line, and the moment they die the target jumps back to the survivor. At the
    // normal 0.18 follow that crawl takes over a second -- which is exactly how long the GAME! banner
    // is up, so the banner played over a frame with the winner off the bottom of the screen and one
    // glove clipping the corner (runs/p0ko k11-k15; measured: survivor projected to y=1701 in a
    // 900-tall viewport). Settling is ~3x faster while endT is counting, so the tableau is framed
    // before the banner reads. V3.noEndFrame = the old crawl.
    const endK = Game.endT && !V3.noEndFrame ? 0.55 : 0;
    const kxy = 1 - Math.pow(1 - Math.max(0.18, endK), step), kz = 1 - Math.pow(1 - Math.max(dist > camNow.dist ? 0.19 : 0.10, endK), step);
    camNow.x += (cx - camNow.x) * kxy; camNow.y += (cy - camNow.y) * kxy; camNow.dist += (dist - camNow.dist) * kz;
  }
  camNow.visH = 2 * camNow.dist * CAM_TANF; camNow.visW = camNow.visH * aspect;

  // --- cinematic punch-ins: big hits and Final Smashes lean the camera toward the action ---
  const fin = Game.finalBy && Game.finalBy.state === 'final' ? Game.finalBy : null, im = Game.impact;
  let fx = null;
  if (fin) fx = { x: fin.x + fin.face * 120, y: fin.y - fin.h * 0.6 };
  else if (im && im.t > 12) fx = im;
  camPunch += ((fx ? 1 : 0) - camPunch) * 0.12;
  let tx = camNow.x, ty = camNow.y, td = camNow.dist;
  if (fx) {
    tx = lerp(tx, fx.x * SC, 0.26 * camPunch); ty = lerp(ty, -fx.y * SC, 0.2 * camPunch);
    td *= 1 - (fin ? 0.18 : 0.09) * camPunch;
  }
  const shake = Game.shakeT * SC * 0.6;
  camPos.set(tx + (Math.random() - 0.5) * shake, ty + td * CAM_TILT + (Math.random() - 0.5) * shake, td);
  camLook.set(tx, ty, 0);
  cam.position.copy(camPos); cam.lookAt(camLook);
}

// ---- frame ----
let lastFighters = null, lastT = performance.now();
V3.render = function () {
  const now = performance.now(), dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  const { composer } = V3.internals();
  V3.setArena(Game.stage);
  if (!pts) makePoints();
  if (!hitLight) { hitLight = new THREE.PointLight(0xffffff, 0, 6, 2); V3.scene.add(hitLight); }
  if (lastFighters !== Game.fighters) { for (const a of avatars.values()) a.dispose(); avatars.clear(); lastFighters = Game.fighters; camNow.live = false; }
  for (const f of Game.fighters) {
    const cur = avatars.get(f);
    if (cur && cur.placeholder && V3.hasChar(f.c.id)) { cur.dispose(); avatars.delete(f); }   // its real model arrived
    if (avatars.has(f)) continue;
    if (V3.hasChar(f.c.id)) avatars.set(f, new Avatar(f));
    else if (V3.missing.has(f.c.id) && V3.placeholder) { avatars.set(f, V3.placeholder(f)); V3.loadChar(f.c.id).catch(() => {}); }   // no model (yet): stand-in from 94
    else V3.loadChar(f.c.id).catch(() => {});
  }
  for (const a of avatars.values()) a.update(dt);
  pts.material.uniforms.scale.value = V3.internals().renderer.getDrawingBufferSize(tmpV2).y / 2 / Math.tan(FOV / 2 * Math.PI / 180);
  syncParticles(); syncRings(); syncProjectiles();
  V3.fxFrame(pts.material.uniforms.scale.value);
  if (V3.movesFrame) V3.movesFrame();   // special-move effects (94)
  const big =Game.rings.find(r => r.life > 10 && r.w >= 5);
  // was 25 at 0.8 units: with bloom the struck fighter burned to a white ghost on every hit (audit #4, 9/22 night)
  if (big) { hitLight.position.set(big.x * SC, -big.y * SC, 1.3); hitLight.intensity = 9; hitLight.color.set(big.color); }
  hitLight.intensity *= 0.82;
  V3.itemsFrame();
  V3.arenaTick(now / 1000);
  updateCamera(dt);
  V3.qualityTick(dt);   // adaptive resolution: see QUAL in 90_v3_core
  if (location.hash.includes('nobloom')) V3.internals().renderer.render(V3.scene, V3.camera);
  else composer.render(dt);
};
V3.project = function (x, y) {
  tmpV.set(x * SC, -y * SC, 0).project(V3.camera);
  return { x: (tmpV.x + 1) / 2 * innerWidth, y: (1 - tmpV.y) / 2 * innerHeight };
};
