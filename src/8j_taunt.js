// ===== TAUNTS: the cheapest item in the catalogue, and the one Fortnite sells most of =====
//
// Duane, 2026-10-16: "add everything", pointing at the shop teardown
// (https://claude.ai/artifact/Ag7J6RSPKQwHZPfjMYKtrY). From the fortnite.gg side of it:
//
//   "2,072 emotes in the catalogue and they are the reliable seller, because an emote is seen by
//    everyone in the lobby and costs a fraction of a character to make."
//
// A taunt here is an animation the rig ALREADY carries, played at its own speed and held for its own
// beat. No new mesh, no new texture, no new rig work. The catalogue entry names the clip, and
// `dev/weapon_test.js` case `_market` fails the build if a taunt ever names a clip that is not in
// assets/anims.json -- a taunt whose clip is missing silently plays `idle`, which is the same class
// of lie as a weapon called Speargun that renders a recurve bow.
//
// WHY IT CANNOT TOUCH A FIGHT
//   * It only starts from `ground` state, with no item, no hitstun, no hitlag and the match running.
//   * ANY input cancels it on the next frame, so it can never eat a defensive option. A taunt you
//     cannot cancel is a taunt that loses you the match, and then nobody presses it.
//   * It writes nothing the sim reads. The whole thing lives on the renderer's clip layer, which is
//     why it is in a 8x_ file and not a 2x_/4x_ one, and why the arena hash is unchanged.
const Taunt = (() => {
  const S = { live: null, idx: 0 };
  // the window a taunt may start in. Anything else and the press is simply ignored.
  function ready(f) {
    return !!f && f.state === 'ground' && !f.item && !f.hitstun && !f.hitlag && !f.air && !f.move;
  }
  function def() {
    try {
      const id = Econ.equipped('taunt');
      return id ? Econ.BYID[id] : null;
    } catch (e) { return null; }
  }
  function go(idx) {
    const d = def(); if (!d || !d.clip) return false;
    if (typeof Game === 'undefined' || Game.state !== 'match' || Game.paused || Game.endT) return false;
    const i = idx || 0, f = Game.fighters && Game.fighters[i];
    if (!ready(f)) return false;
    S.idx = i;
    S.live = { clip: d.clip, rate: d.rate || 1, hold: (d.hold || 0) * 1000, id: d.id,
               start: performance.now(), done: 0 };
    try { Sfx.ui(); } catch (e) { /* audio locked */ }
    return true;
  }
  function stop() { S.live = null; }
  // called once a frame by the renderer. Returns the clip to hold, or null.
  function frame(f) {
    const L = S.live;
    if (!L) return null;
    if (!f || f.idx !== S.idx) return null;
    // cancelled by anything at all: a hit, a jump, an attack, leaving the floor
    if (!ready(f)) { S.live = null; return null; }
    const age = performance.now() - L.start;
    // the clip runs, then it is held for its own beat, then it is over
    if (age > 2600 + L.hold) { S.live = null; return null; }
    return L;
  }
  // T, the way C already takes a clip (81_clip.js). Not bound on a pad: the right stick is the smash
  // flick and every face button is taken, so a pad taunt needs a controls decision, not a rename.
  if (typeof addEventListener === 'function') {
    addEventListener('keydown', e => {
      if (e.code !== 'KeyT' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (typeof Game === 'undefined' || Game.state !== 'match') return;
      if (go(0)) e.preventDefault();
    });
  }
  return { go, stop, frame, ready, def, _S: S };
})();
if (typeof window !== 'undefined') window.Taunt = Taunt;
