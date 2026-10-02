// ===== hitstop: how heavy a hit feels =====
//
// Hitstop (hitlag) is the freeze on the frame of contact. It is the whole language of weight in both
// reference games, and it is the cheapest feel lever in the engine: no hitbox moves, no damage
// changes, nothing about who wins is touched — the same hit just lands harder.
//
// 41_combat.js used `clamp(floor(d * 0.45 + 4), 4, 18)`, a nearly flat line:
//
//   damage        3     8    15    22    30
//   old hitstop   5     7    10    13    17     frames
//
// A jab and a fully charged smash were 5 frames apart. Smash Ultimate's curve is `floor(d * 0.65) + 5`
// with a lighter multiplier on aerials so juggles still flow, and Tekken adds freeze on a counter hit
// and on the hit that ends a round. This does all three:
//
//   * steeper base, so a heavy hit is unmistakably heavier than a poke
//   * aerials at BUF-style 0.74, so air strings do not turn into slideshows
//   * a KO bonus that scales with knockback — the hit that sends someone flying freezes hardest,
//     which is the beat both games build their highlight reels on
//   * a counter-hit bonus: catching someone in their own startup reads as a punish (Tekken)
//
// GATED on Game.combos, and applied by overwriting `hitlag` after 41_combat has set it, so the bet
// arena (ARENA.version 1) and online lockstep keep the frame counts they always had. Measured by
// dev/hitstop_test.js; guard.sh proves the arena is bit-identical.
const HITSTOP = {
  BASE: 0.52,        // frames per point of damage. 9/22: was 0.62 - the owner found every hit sluggish; still heavier than the old flat 0.45
  ADD: 5,
  AIR: 0.74,         // aerials freeze less, so juggles keep moving (Smash uses about two thirds)
  KO_AT: 90,         // knockback above which a hit starts reading as a launcher
  KO_K: 0.11,        // extra frames per point of knockback over KO_AT
  KO_MAX: 10,
  COUNTER: 3,        // Tekken: they were in their own move's startup, so it is a punish
  MIN: 4,
  MAX: 22,
  MAX_HL: 26,        // only a hitbox that ASKS for extra weight may pass MAX; every existing hit is untouched

  // `hl` is the PER-HITBOX multiplier, Sakurai's own primary feel dial. From his Famitsu column on
  // hitstop: "the hitstop period is determined not only by the amount of damage, but by certain
  // factors exclusive to each individual attack... [for Marth] I emphasized this difference by adding
  // an increased hitstop modifier at the tip, and reducing the hitstop created when slashing with the
  // edge of the blade." In shipped Ultimate data it ranges 0.5 (multi-hit links, so a flurry does not
  // turn to sludge) through 1.8 (Mario's and Fox's JABS, so a 2 % poke still thumps) to 3.0 (Kirby's
  // rapid-jab finisher). Without it every hit of the same damage feels identical, which is most of
  // why our twelve still felt alike even after they stopped sharing frame data. Default 1.
  frames(d, kb, air, counter, hl) {
    let n = Math.floor(d * HITSTOP.BASE) + HITSTOP.ADD;
    if (air) n = Math.floor(n * HITSTOP.AIR);
    if (kb > HITSTOP.KO_AT) n += Math.min(HITSTOP.KO_MAX, Math.floor((kb - HITSTOP.KO_AT) * HITSTOP.KO_K));
    if (counter) n += HITSTOP.COUNTER;
    if (hl && hl !== 1) n = Math.floor(n * hl);
    const cap = hl > 1 ? HITSTOP.MAX_HL : HITSTOP.MAX;
    return Math.max(HITSTOP.MIN, Math.min(cap, n));
  },
};

(function () {
  const take0 = Fighter.prototype.takeHit;
  Fighter.prototype.takeHit = function (hb, att, mult, srcX, srcFace) {
    if (!Game.combos || !att || att === this) return take0.call(this, hb, att, mult, srcX, srcFace);
    // read the things that decide the weight of this hit BEFORE take0 changes them
    const dmg0 = this.dmg;
    const counter = this.state === 'move' && this.move && this.move.t <= (firstActive(this.move.def) || 99);
    const air = !!(att.move && att.move.air);
    const kb = take0.call(this, hb, att, mult, srcX, srcFace);
    // take0 returns early (0) on an absorbed hit and returns kb without setting hitlag on armour
    if (!this.hitlag) return kb;
    const d = this.dmg - dmg0;
    const n = HITSTOP.frames(d, kb || 0, air, counter, hb && hb.hl);
    this.hitlag = n;
    att.hitlag = Math.max(att.hitlag, n);
    return kb;
  };
  // the frame a move's first hitbox goes live: before that, the victim was still winding up
  const cache = new WeakMap();
  function firstActive(d) {
    if (!d || !d.hits) return 0;
    if (cache.has(d)) return cache.get(d);
    let f = 1e9;
    for (const hb of d.hits) if (hb.f && hb.f[0] < f) f = hb.f[0];
    const v = f === 1e9 ? 0 : f;
    cache.set(d, v);
    return v;
  }
})();
