// ===== move staling + combo scaling, outside the feel layer =====
//
// Smash Ultimate's anti-spam rule is the cleanest one in fighting games: every move you land goes
// into a 9-deep queue, and a move already in the queue does less damage and less knockback the more
// copies of it are in there. Fresh moves get a small bonus. On top of it, damage inside one combo
// decays so a long juggle is worth less per hit than a clean confirm.
//
// `25_feel.js` already implements both (FEEL.STALE, FEEL.mult), but the whole v2 feel layer is OFF
// by default because Duane found the REST of it worse to play — short reach, wrong facing, sticky
// hits (9/20 playtest). So the good half is lifted out here and runs on its own.
//
// Why it matters, measured (dev/aaa/metrics): with no staling the CPU's top move was 46% of its
// entire offence, and 3-stock matches ended in 60s because nothing ever cost anything to repeat.
//
// GATED ON Game.combos && !Game.feel — unseeded local matches only, and it stands down when the
// feel layer is on so the two never double-apply. The seeded bet arena is untouched.

const STALE = {
  DEPTH: 9,
  // reduction per queue slot, newest first: a move you just used hurts noticeably less
  STEP: [0.09, 0.08545, 0.07635, 0.0679, 0.05945, 0.05035, 0.04255, 0.03345, 0.025],
  FRESH: 1.05,          // small bonus for something they have not seen yet
  COMBO_FROM: 4,        // hits 1-3 of a string are full price
  COMBO_STEP: 0.10,
  COMBO_FLOOR: 0.5,

  // what counts as "the same move": the underlying def, so a swordified copy still stales
  key(att) {
    const mv = att.move;
    if (!mv || !mv.def) return null;
    return mv.def.base || mv.def;
  },
  mult(att, k) {
    const q = att.sQueue;
    if (!q || !q.length) return this.FRESH;
    let m = 1, seen = false;
    for (let i = 0; i < q.length; i++) if (q[i] === k) { m -= this.STEP[i]; seen = true; }
    return seen ? Math.max(0.35, m) : this.FRESH;
  },
  push(att, k) {
    const q = att.sQueue = att.sQueue || [];
    q.unshift(k);
    if (q.length > this.DEPTH) q.length = this.DEPTH;
  },

  // one multiplier for this hit: staling x combo scaling
  factor(victim, hb, att) {
    if (!att || att === victim || hb.fPush) return 1;
    let k = 1;
    const mv = att.move;
    const melee = !!hb.f && !!mv && !!mv.def.hits && mv.def.hits.includes(hb);
    if (melee) {
      // stale once per MOVE, not once per hit, so a multi-hit flurry is one entry
      if (mv.sStale == null) { const key = this.key(att); mv.sStale = this.mult(att, key); this.push(att, key); }
      k *= mv.sStale;
    }
    // combo scaling counts distinct moves in the string, not hits
    const live = victim.state === 'hitstun' || victim.state === 'grabbed';
    const src = melee ? mv : hb;
    if (!live) { victim.sPro = 1; victim.sProSrc = src; }
    else if (victim.sProSrc !== src) { victim.sPro = (victim.sPro || 1) + 1; victim.sProSrc = src; }
    if (victim.sPro >= this.COMBO_FROM) k *= Math.max(this.COMBO_FLOOR, 1 - this.COMBO_STEP * (victim.sPro - (this.COMBO_FROM - 1)));
    return k;
  },
};

Fighter.prototype.takeHit = (function (base) {
  return function (hb, att, mult, srcX, srcFace) {
    if (Game.combos && !Game.feel) mult = (mult || 1) * STALE.factor(this, hb, att);
    return base.call(this, hb, att, mult, srcX, srcFace);
  };
})(Fighter.prototype.takeHit);
