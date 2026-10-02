// ===== input buffer: a press made during recovery comes out the moment you are free =====
//
// Smash Ultimate buffers every action for 5 frames and Tekken buffers inputs into recovery; it is the
// single most-felt "this game is responsive" rule in either of them, and Brawl Street only had a
// partial version of it. `23_combo.js` buffers presses made *during hitlag*, and only for cancels.
// Everything else was dropped on the floor:
//
//   * attack pressed during landing lag  -> nothing
//   * attack pressed in a move's endlag  -> nothing
//   * jump pressed as hitstun runs out   -> nothing
//   * anything pressed during a roll, a spot dodge or an air dodge -> nothing
//
// So a player who reacts correctly but a frame or two early gets nothing at all, which reads as the
// game ignoring them. This buffers every action button for BUF.FRAMES and re-presses it on the first
// frame the fighter is actionable again.
//
// DETERMINISM: gated on Game.combos, which Game.start only sets for unseeded local matches. The bet
// arena (ARENA.version 1) and online lockstep never run it, so old fights replay bit-identically —
// and CPUs are excluded outright (AI.think already returns a fresh decision every frame, so
// buffering for them would just make them press things twice).
const BUF = {
  FRAMES: 6,          // Smash Ultimate uses 5; 6 at 60fps is one tenth of a second
  ACTS: ['attack', 'smash', 'special', 'jump', 'shield', 'grab', 'grapple'],
  // the states a press is thrown away in today. `move` is included so the end of a move buffers the
  // next one; the cancel system in 23_combo gets first refusal and only what it declines is buffered.
  BUSY: { move: 1, land: 1, hitstun: 1, roll: 1, spot: 1, airdodge: 1, dizzy: 1, helpless: 1, grabbing: 1, grabbed: 1, hammer: 1, climb: 1 },

  // `!Game.feel`: the disabled 25_feel layer has its own buffer, so if anyone turns it back on
  // (localStorage tb_feel = '1') this one stands down rather than double-firing — the same rule
  // 52_stale.js uses.
  on(f) { return !!Game.combos && !Game.feel && !f.cpu; },

  // record: called after the fighter's own update, so f.in is this frame's real pad state.
  // `was` is the state at the TOP of the frame, not the bottom: a press made on the very last frame
  // of landing lag arrives while the fighter is still in `land`, and by the time this runs the state
  // machine has already moved it to `ground`. Testing the state after the fact lost exactly that
  // press — the one frame a player is most likely to be early by.
  rec(f, was) {
    if (!BUF.on(f)) return;
    if (f.ibufAt === Game.frame) return;                 // that press was one we injected ourselves
    if (!BUF.BUSY[was] && !(f.hitlag > 0)) { return; }
    const b = f.ibuf || (f.ibuf = {});
    for (const k of BUF.ACTS) if (f.in[k] && !f.prev[k]) b[k] = Game.frame;
  },

  // replay: called at the top of groundAct / airAct, i.e. the first frame the fighter can act again
  inject(f) {
    const b = f.ibuf;
    if (!BUF.on(f) || !b) return;
    if (f.st > 2) { f.ibuf = null; return; }              // only just-became-actionable, not idling
    for (const k of BUF.ACTS) {
      const t = b[k];
      if (t == null) continue;
      delete b[k];
      if (Game.frame - t > BUF.FRAMES) continue;          // stale: the player was not that close
      if (f.in[k] && f.prev[k]) continue;                 // still holding it; pressed() handles that
      f.in[k] = true; f.prev[k] = false;                  // -> f.pressed(k) is true this frame
      f.ibufAt = Game.frame;
      BUF.n++;
      return;                                             // one action per frame, like both reference games
    }
  },
  n: 0,   // dev counter: how many presses this buffer rescued (dev/buffer_test.js reads it)
};

(function () {
  const FP = Fighter.prototype;

  const oGround = FP.groundAct;
  FP.groundAct = function () { BUF.inject(this); return oGround.call(this); };

  const oAir = FP.airAct;
  FP.airAct = function () { BUF.inject(this); return oAir.call(this); };

  const oUpdate = FP.update;
  FP.update = function (stage) { const was = this.state; const r = oUpdate.call(this, stage); BUF.rec(this, was); return r; };

  const oReset = FP.reset;
  FP.reset = function (x, y, st) { this.ibuf = null; this.ibufAt = -99; return oReset.call(this, x, y, st); };
})();
