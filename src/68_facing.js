// ===== facing: "I press left, he faces left" — every input path, not just attacks =====
//
// Duane's standing complaint: "the characters still face the wrong way. i press left they face right."
// 40_fighter.js already turns on ftilt / fsmash / fair / side-special / walking. It does NOT turn on:
// up- and down- variants of anything (utilt/dtilt/usmash/dsmash/uair/dair/up-special/down-special),
// the grab out of shield, the item throw, the gun, the Final Smash, or the jump. And dodgeUpdate
// actively turns you AGAINST the stick at the end of a roll.
//
// Rather than sprinkle `if (dx) this.face = dx` through six files, everything funnels through one
// chokepoint: startMove. Every attack, special, throw, item use and getup in the game goes through it.
// FACE.cur makes the turn happen only for a move the fighter's own update started — the engine also
// calls startMove from outside (the counter retaliation in 60_game.js sets its own facing, and an
// engine-driven move must not be spun round by whatever direction happened to be held).
//
// DETERMINISM: every entry point is gated on Game.combos, which Game.start only sets for unseeded
// local matches. The bet arena (ARENA.version 1) and online lockstep run with combos === false, so
// none of this executes and old fights replay bit-identically. Verified by dev/aaa/guard.sh.
const FACE = {
  // 9/22, Duane: "when i click right they stay left ... FIX IT once and for all". Measured with real
  // input (dev/facetest.js + dev/facerender.js): on the ground the turn was already instant, in the fight
  // code AND in the rendered model. The air was the problem — a 10-frame hold, PLUS a wait for momentum
  // to reverse (`dx * vx > 0.5`), so pressing right mid-jump left him facing left for a sixth of a second
  // or more. In a platform fighter you are in the air constantly, so that is where he felt it.
  // 2 frames (33 ms) still ignores a one-frame DI flick; the momentum wait is gone.
  AIR_HOLD: 2,           // frames a direction must be held before a drifting fighter turns to match it
  cur: null,             // the fighter currently inside its own update(); null = the engine is driving

  // moves whose facing is NOT the stick's business
  keep(f, def) {
    if (def.noTurn) return true;                 // opt-out for a signature move that owns its facing
    const m = f.m;
    if (def === m.getup) return true;            // the ledge getup faces the stage, not the stick
    if (def === m.bair) return true;             // back air is the move that hits behind you, by definition
    return false;
  },

  // hook: startMove, before the def's own start() runs (it can spawn projectiles off f.face)
  onStart(f, def) {
    if (!Game.combos || !def || FACE.cur !== f) return;
    if (f.state === 'ledge' || f.state === 'climb' || f.state === 'grabbed' || f.state === 'grabbing') return;
    const dx = f.dirX();
    if (!dx || dx === f.face || FACE.keep(f, def)) return;
    f.face = dx;
  },

  // hook: the two item paths and the Final Smash, which all fire along f.face
  aim(f) {
    if (!Game.combos || FACE.cur !== f) return;
    const dx = f.dirX();
    if (dx && dx !== f.face) f.face = dx;
  },

  // hook: end of a roll. 40_fighter used `face = -rollDir`, which reads as turning against the stick
  // on a forward roll. Both reference games end a dodge looking at the opponent, so do that: it is
  // never "the wrong way", and it keeps the retreat roll's old behaviour (you roll away, you still
  // face them).
  roll(f) {
    if (!Game.combos) return;
    let best = null, bd = 1e9;
    for (const g of Game.fighters) {
      if (g === f || g.state === 'dead' || g.stocks <= 0 || g.state === 'respawn') continue;
      const d = Math.abs(g.x - f.x);
      if (d < bd) { bd = d; best = g; }
    }
    if (best) f.face = best.x >= f.x ? 1 : -1;
    else if (f.rollDir) f.face = f.rollDir;
  },

  // hook: leaving the ground. Hold a direction through jumpsquat and you jump that way, so look that way.
  jumped(f) {
    if (!Game.combos) return;
    const dx = f.dirX();
    if (dx && dx !== f.face) f.face = dx;
  },

  // hook: end of airAct. Pure drift never turned you at all, so "I am flying left" could read as
  // facing right for the whole arc. A sustained hold (AIR_HOLD frames) that is actually moving you
  // turns the fighter; a DI tap does not, so back-air survives.
  drift(f) {
    if (!Game.combos || f.state !== 'air' || f.move) return;
    const dx = f.dirX();
    if (!dx || dx === f.face) return;
    const held = dx > 0 ? f.tap.right : f.tap.left;
    // no longer waits for vx to reverse: you face where you are pressing, not where you are still drifting
    if (held >= FACE.AIR_HOLD) f.face = dx;
  },
};

// ---- wiring: wrap the prototype instead of editing five shared files ----
(function () {
  const FP = Fighter.prototype;

  const oUpdate = FP.update;
  FP.update = function (stage) {
    const prev = FACE.cur; FACE.cur = this;
    try { return oUpdate.call(this, stage); } finally { FACE.cur = prev; }
  };

  const oStart = FP.startMove;
  FP.startMove = function (def) { FACE.onStart(this, def); return oStart.call(this, def); };

  const oDodge = FP.dodgeUpdate;
  FP.dodgeUpdate = function () {
    const wasRoll = this.state === 'roll';
    const r = oDodge.call(this);
    if (wasRoll && this.state !== 'roll') FACE.roll(this);
    return r;
  };

  const oSquat = FP.jumpSquat;
  FP.jumpSquat = function () {
    const r = oSquat.call(this);
    if (this.state === 'air') FACE.jumped(this);
    return r;
  };

  const oAir = FP.airAct;
  FP.airAct = function () { const r = oAir.call(this); FACE.drift(this); return r; };

  const oThrowItem = FP.throwItem;
  FP.throwItem = function () { FACE.aim(this); return oThrowItem.call(this); };

  const oUseItem = FP.useItem;
  FP.useItem = function () { FACE.aim(this); return oUseItem.call(this); };

  const oFinal = FP.startFinal;
  FP.startFinal = function () { FACE.aim(this); return oFinal.call(this); };
})();
