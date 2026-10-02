// ===== blocking must not kill you =====
//
// `Game.shieldHit` shoves the defender: `b.vx = dir * min(7, 1 + dmg * 0.4)`. On a stage with an
// open edge that is a death sentence — block a smash near the lip and the pushback walks you off at
// 0%. Measured (dev/aaa/probe.js, 30 matches, 2 stocks): raising the CPU's guard rate so blocking
// finally hit its target band took KOs under 12% damage from **3.6% to 8.6% of all KOs**. The extra
// deaths were not bad blocks, they were correct blocks punished by the floor running out.
//
// Neither reference game does this. Tekken has walls, and Smash's shield pushback cannot send a
// grounded fighter off a ledge to their death at 0%. So: the pushback is scaled down as the
// defender nears the edge they are being pushed toward, reaching zero at the lip. They still get
// moved — spacing pressure is the point of shield pushback — they just do not get killed by it.
//
// GATED on Game.combos: the bet arena (ARENA.version 1) and online lockstep keep the old pushback,
// so old fights replay bit-identically. Verified by dev/aaa/guard.sh.
const SHPUSH = {
  EDGE: 78,        // within this many units of the lip, the pushback starts being scaled down
  on() { return !!Game.combos; },
  // how much of the pushback survives, 0 at the lip and 1 once EDGE units inside
  clampVx(b) {
    if (!SHPUSH.on() || b.air || !b.vx) return;
    const M = Game.stage && Game.stage.main;
    if (!M) return;
    // the edge they are being pushed toward
    const edge = b.vx > 0 ? M.x1 : M.x0;
    const dist = Math.abs(edge - b.x) - b.w * 0.4;
    if (dist >= SHPUSH.EDGE) return;
    const k = Math.max(0, dist) / SHPUSH.EDGE;
    b.vx *= k;
  },
};

(function () {
  const hit0 = Game.shieldHit;
  Game.shieldHit = function (b, dmg, srcX, a) {
    const r = hit0.call(this, b, dmg, srcX, a);
    SHPUSH.clampVx(b);
    return r;
  };
})();
