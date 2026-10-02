// ===== dual wield: two guns, alternating hands (Madness Combat's akimbo) =====
//
// Duane, 9/26, after the Madness weapon pass: "you got uzis and shit in madness" and, on this
// specifically, "we can save dual wield til after". After is now -- the guns, the eight-way aim, the
// throw and the gun audio all shipped on 9/22-9/26, and akimbo was the one thing on that list left.
//
// HOW MADNESS DOES IT, and what is copied: the hands fire ALTERNATELY rather than together, which is
// why akimbo reads as a faster stutter rather than as a shotgun; the muzzle flashes alternate sides;
// accuracy gets visibly worse; and you throw one gun and keep shooting with the other. Not copied:
// picking up two DIFFERENT guns. Two kinds would mean two rates, two spreads and two recoils fighting
// each other every frame, and every version of that in this file read as a bug rather than a feature.
// Same kind only.
//
// ONE-HANDED GUNS ONLY. A shotgun, a sniper rifle and a rocket launcher are shouldered weapons; a
// fighter holding two of them akimbo looks like a physics error, not a power fantasy.
//
// GATED, and it comes free: everything here goes through GUNS.on(), which is
// `Game.combos && Game.itemSet >= 2`. The seeded bet arena runs combos off and item set 1, so no gun
// can spawn there at all and none of this can run. Prove with dev/detcheck.js 1.
//
// HOW IT HOOKS IN, and why it is wrapping rather than editing 6e_guns.js: the fire path is one tight
// function (GUNS.shoot) that reads `it.ammo`, decrements it and emits. Rather than thread a hand
// index through it, the off-hand's shot SWAPS ammo and ammo2 around the call, so the base function is
// untouched and always operates on "the hand that is firing". Same trick 6f_motion uses to swap a
// fighter's weight for the length of one takeHit: synchronous, restored in a finally.
const AKIMBO = {
  off: false,
  // the guns you can hold one of in each hand
  KINDS: { pistol: 1, revolver: 1, smg: 1 },
  // dual fire is faster but not twice as fast: the alternation costs you. Spread widens a lot,
  // per-shot recoil drops (each hand is doing half the work) but you take twice as many shoves.
  RATE: 0.62, SPREAD: 1.55, REC: 0.72,
  on() { return !AKIMBO.off && GUNS.on(); },
  can(k) { return !!AKIMBO.KINDS[k]; },
  is(it) { return !!(it && it.dual); },
  // what the HUD and the AI should treat as "rounds left"
  total(it) { return !it ? 0 : (it.ammo > 0 ? it.ammo : 0) + (it.dual && it.ammo2 > 0 ? it.ammo2 : 0); },
  // THE INVARIANT, and getting it wrong was the whole bug: `it.ammo` is ALWAYS the gun that fires
  // next, and `it.hand` says which physical hand that is. The first version instead left `ammo` as
  // "the right hand" and swapped around each shot, which meant GUNS.tickMove -- which checks
  // `it.ammo > 0` and THROWS the gun when it is empty -- threw the pair away the moment the right
  // hand ran dry, while the left was still loaded. The probe caught it on the pistol and the SMG
  // (whose fire rates empty a magazine inside one burst) and not on the revolver.
  //
  // So after every shot the magazines hand over: swap, flip the hand, and if the hand we just moved
  // to is empty while the other still has rounds, hand over once more. Everything downstream --
  // tickMove's empty check, the throw, the HUD, the AI -- then reads the loaded gun with no
  // knowledge of akimbo at all.
  handOff(it) {
    if (!it || !it.dual) return;
    let a = it.ammo; it.ammo = it.ammo2; it.ammo2 = a; it.hand = it.hand ? 0 : 1;
    if (!(it.ammo > 0) && it.ammo2 > 0) { a = it.ammo; it.ammo = it.ammo2; it.ammo2 = a; it.hand = it.hand ? 0 : 1; }
  },
};

(function () {
  if (typeof GUNS === 'undefined') return;

  // ---- picking up the second gun ----------------------------------------------------------------
  // GUNS.pick replaces whatever is in hand. If the fighter is already holding the same one-handed
  // gun, the second one goes in the other hand instead of throwing the first away.
  const pick0 = GUNS.pick;
  GUNS.pick = function (f, it) {
    if (AKIMBO.on() && f.item && !f.item.dual && f.item.kind === it.kind && AKIMBO.can(it.kind)) {
      const cur = f.item;
      cur.dual = 1;
      cur.ammo2 = it.ammo > 0 ? it.ammo : 0;
      cur.hand = 0;
      // the main hand keeps the fuller magazine, so the first trigger pull is never a dry click
      if (cur.ammo2 > cur.ammo) { const t = cur.ammo; cur.ammo = cur.ammo2; cur.ammo2 = t; }
      GUNS.emit('pick', f.x, f.y - f.h * 0.6, 0, 0, it.kind, f.idx, AKIMBO.total(cur));
      Game.text(f.x, f.y - f.h - 18, 'AKIMBO', '#ffd45c', 1.2);
      return true;
    }
    return pick0.call(this, f, it);
  };

  // ---- firing -----------------------------------------------------------------------------------
  // The off-hand shot swaps ammo/ammo2 so GUNS.shoot always works on the firing hand, and the muzzle
  // is nudged to that side so the flash and the tracer leave the right gun.
  const shoot0 = GUNS.shoot;
  GUNS.shoot = function (f, it, g, mv, t) {
    if (!AKIMBO.is(it)) return shoot0.call(this, f, it, g, mv, t);
    mv.gnHand = it.hand | 0;                // 9g_guns reads this to pose and flash the right gun
    // wider spread and a softer per-shot shove, restored whatever happens: g is the shared DEF entry
    // and leaving it modified would re-tune that gun for everyone on the stage.
    const sp0 = g.spread, rc0 = g.rec, ar0 = g.airRec;
    if (g.spread) g.spread = sp0 * AKIMBO.SPREAD;
    g.rec = rc0 * AKIMBO.REC; g.airRec = ar0 * AKIMBO.REC;
    try { return shoot0.call(this, f, it, g, mv, t); }
    finally { g.spread = sp0; g.rec = rc0; g.airRec = ar0; AKIMBO.handOff(it); }
  };

  // ---- rate -------------------------------------------------------------------------------------
  // tickMove gates the next shot on `since >= g.rate`. Two hands means the next trigger pull comes
  // sooner, so the DEF's rate is scaled for the length of that one call and put back.
  const tick0 = GUNS.tickMove;
  GUNS.tickMove = function (f, t) {
    const it = f.item, g = it && this.DEF[it.kind];
    if (!g || !AKIMBO.is(it)) return tick0.call(this, f, t);
    const r0 = g.rate;
    g.rate = Math.max(2, Math.round(r0 * AKIMBO.RATE));
    try { return tick0.call(this, f, t); }
    finally { g.rate = r0; }
  };

  // Nothing wraps GUNS.use: with the hand-over invariant, `it.ammo` is already the loaded gun by the
  // time any press is read, so the base "empty gun -> throw it" path is correct as written.

  // Throwing while akimbo throws ONE gun -- the off hand (`ammo2`), the way Madness sheds a spent
  // pistol and keeps shooting. The thrown one carries its own rounds; the fighter keeps the other.
  const throw0 = GUNS.throwGun;
  GUNS.throwGun = function (f) {
    const it = f.item;
    if (!AKIMBO.is(it)) return throw0.call(this, f);
    // hand the OFF-hand gun to the throw, keep the main one
    const keepAmmo = it.ammo, keepHand = it.hand;
    it.ammo = it.ammo2 > 0 ? it.ammo2 : 0;
    it.dual = 0; it.ammo2 = 0;
    const r = throw0.call(this, f);
    // throwGun clears f.item; put the surviving gun back in hand
    if (!f.item) f.item = { kind: it.kind, ammo: keepAmmo, cd: 0, hand: keepHand };
    return r;
  };

  // ---- CPU --------------------------------------------------------------------------------------
  // The existing GUNS.ai reads `it.ammo` to decide between shooting and closing in to throw. With two
  // guns that is only half the picture, so it sees the total while it decides.
  const ai0 = GUNS.ai;
  GUNS.ai = function (f, tgt, o, press) {
    const it = f.item;
    if (!AKIMBO.is(it)) return ai0.call(this, f, tgt, o, press);
    const a0 = it.ammo;
    it.ammo = AKIMBO.total(it);
    try { return ai0.call(this, f, tgt, o, press); }
    finally { it.ammo = a0; }
  };
})();
