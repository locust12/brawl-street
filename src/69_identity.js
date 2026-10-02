// ===== identity: make the per-fighter stat profile actually reach the moves =====
//
// `src/66_traits.js` PROFILE gives 46 fighters a stat line, including `reach` for the long-limbed
// ones and `power` for the heavies. Measured (dev/face_test-style A/B in the sim, seeded vs local):
// **both of those stats were dead.** `baseMoves(c)` in 20_chars.js bakes `R = c.reach` and
// `P = c.power` into every hitbox's x / r / dmg ONCE at load time:
//
//     jab: H(3, 5, fx + 12 * R, -Hh * 0.5, 20 * R, 3 * P, ...)
//
// and `CHARS.forEach(c => { c.moves = ... })` runs before any match. TR.profile swaps in a copy of
// the character with the profile applied, but the moves were built from the ORIGINAL numbers and
// never rebuilt, so:
//
//   lobster  profile reach 1.20 -> 1.24, power 1.08 -> 1.14 : jab x 45.4 -> 45.4, dmg 3.24 -> 3.24
//   fro      profile reach 1.22 -> 1.26                     : jab x 41.6 -> 41.6
//   turbo    profile power 1.10 -> 1.02                     : jab dmg 3.30 -> 3.30
//
// 6 fighters had a dead `reach` and 38 had a dead `power`. This file makes the two stats real the
// same way 65_balance and 66_traits already make theirs real — as a multiplier at the point of use —
// rather than rebuilding the move tables, which would also have to rebuild every signature set in
// 21_roster2 / 22_chars_more and every swordified copy.
//
// GATED: `BAL.on()` (Game.sigs), i.e. unseeded local matches only. `c.baseOf` only exists at all
// once TR.profile has run, which is itself gated, so the bet arena (ARENA.version 1) and online
// lockstep see exactly the numbers they always did. Verified by dev/aaa/guard.sh.
const IDENT = {
  on() { return !!(typeof BAL !== 'undefined' ? BAL.on() : Game.sigs); },
  // how much the profile moved this fighter's reach / power away from the numbers its moves were
  // baked with. 1 = the profile did not touch it (or there is no profile).
  ratio(f, k) {
    const c = f && f.c, b = c && c.baseOf;
    if (!b) return 1;
    const now = c[k], was = b[k];
    if (!now || !was || now === was) return 1;
    return now / was;
  },
  reachMul(f) { return IDENT.ratio(f, 'reach'); },
  // Power is DAMPED. The PROFILE numbers were written while they were inert, so nobody ever played
  // against them: switching them on at full strength double-taxed the fighters who already pay for
  // their speed with low weight. Measured on dev/tourney.js (2070 CPU matches, 1 stock, level 6):
  //
  //   POWER_K   spread sd   bottom of the table
  //   0 (off)      11.7     popcat 28.9  cashcat 28.9  pengu 28.9
  //   1 (full)     12.9     popcat 28.9  omen 28.9  turbo 31.1  spark 31.1
  //   0.5          see NOTES-aaa iteration 14
  //
  // Half keeps the designer's direction — heavies hit harder, speedsters hit softer — without the
  // fighters at the bottom paying for it twice.
  POWER_K: 1,
  powerMul(f) { const r = IDENT.ratio(f, 'power'); return r === 1 ? 1 : 1 + (r - 1) * IDENT.POWER_K; },
};

(function () {
  // ---- reach: push the melee hitbox out (offset AND radius, the same shape 65_balance uses) ----
  const hits0 = Fighter.prototype.activeHits;
  Fighter.prototype.activeHits = function () {
    const out = hits0.call(this);
    if (!IDENT.on() || !out.length) return out;
    const m = IDENT.reachMul(this);
    if (m === 1) return out;
    for (const h of out) { h.x = this.x + (h.x - this.x) * m; h.r *= m; }
    return out;
  };

  // ---- power: the damage the profile says this fighter hits for ----
  const take0 = Fighter.prototype.takeHit;
  Fighter.prototype.takeHit = function (hb, att, mult, srcX, srcFace) {
    if (IDENT.on() && att && att !== this) {
      const p = IDENT.powerMul(att);
      if (p !== 1) mult = (mult || 1) * p;
    }
    return take0.call(this, hb, att, mult, srcX, srcFace);
  };
})();
