// ===== motion: dash, run and air speed (local rules) =====
//
// Audit C3 and research §8: every fighter moved like a Smash heavyweight. There was one ground speed
// (walk 5.0-7.9 px/frame, reached at 1.1 px/f²), so crossing the 800 px stage took 2.15 s where Mario
// takes 1.52 s, and air speed was 28 % under Mario's scaled to our fighter height.
//
// This gives everyone Smash's ground ladder, as ratios of the fighter's own walk speed so the roster
// keeps its spread (Mario: initial dash 1.68x walk, run 1.52x walk):
//
//   frame 0 of a direction   a kick toward dash speed (Smash applies the initial dash at once)
//   frames 0-7               initial dash, 1.65x walk
//   frame 8 on               run, 1.5x walk (x the 66_traits run bonus, so Redline & co stay fastest)
//   reversing                keeps 35 % of the slide, then accelerates the other way (a skid, not ice)
//   air                      1.3x air speed (drift keeps its 0.45 accel, already Mario's at our scale)
//
// GATED on Game.combos (never in the seeded bet arena), and off while the v2 feel layer is on, which
// has its own movement numbers. Wraps groundAct / drift; no existing file is edited.
const MOTION = {
  DASH: 1.65,
  DASH_F: 8,
  KICK: 5,
  RUN: 1.5,
  ACC: 1.6,
  TURN: 0.35,
  AIR: 1.3,
  on() { return !!Game.combos && !Game.feel; },
};

(function () {
  const FP = Fighter.prototype;

  const ground0 = FP.groundAct;
  FP.groundAct = function () {
    if (!MOTION.on()) return ground0.call(this);
    const vx0 = this.vx;
    const r = ground0.call(this);
    const dx = this.dirX();
    // only the plain moving branch: still standing on the ground, holding a direction, not crouched
    if (this.state !== 'ground' || this.air || !dx || this.crouch) {
      this.mRun = 0;
      if (!dx) this.mDir = 0;
      return r;
    }
    const t = this.mDir === dx ? (this.mRun || 0) + 1 : 0;
    this.mDir = dx; this.mRun = t;
    const tr = TR.of(this);
    const k = t < MOTION.DASH_F ? MOTION.DASH : MOTION.RUN * (tr && tr.run ? tr.run : 1);
    const target = dx * this.c.walk * k * (this.powerT > 0 ? 1.25 : 1);
    let v = vx0;
    if (v * dx < 0) v *= MOTION.TURN;
    this.vx = approach(v, target, t === 0 ? MOTION.KICK : MOTION.ACC);
    return r;
  };

  // Grounded normals stop at the platform edge instead of sliding off it. A run is now 1.5x faster, so
  // a jab or smash started at full speed slid ~52 px (5.25x vx at the 0.84 move friction): attacking near
  // the edge dropped you off the stage. Smash's ground normals hold the edge the same way. Specials keep
  // their own travel (TOP G's car, dashes), so only the moves in NORMALS are held.
  const isNormal = f => { const d = f.move && f.move.def; return !!d && NORMALS.some(n => f.m[n] === d || (d.base && f.m[n] === d.base)); };
  const phys0 = FP.physics;
  FP.physics = function (st) {
    // rolls too (9/22 night, dev/aaa/sd_why.js): a roll carries 136 px with no edge check, and "rolled off the stage"
    // was the biggest single cause of CPU self-destructs (6 of 30 at level 8). Smash's rolls stop at the ledge.
    if (MOTION.on() && !this.air && this.plat && this.vx && ((this.state === 'move' && isNormal(this)) || (MOTION.ROLLEDGE && this.state === 'roll'))) {
      const p = this.plat, nx = this.x + this.vx;
      if (nx > p.x1) this.vx = Math.max(0, p.x1 - this.x);
      else if (nx < p.x0) this.vx = Math.min(0, p.x0 - this.x);
    }
    return phys0.call(this, st);
  };

  // CPUs brake for the edge. 50_ai stops chasing an offstage target 40 px from the edge, a margin set
  // for walk speed; at run speed the release slide (about 3.5x vx) carried them off (self-destructs at
  // level 1 and 6 went 10 -> 14 %). A CPU on the ground holding toward an edge it would slide past lets
  // go of the direction, unless it is jumping this frame (a deliberate edge-guard leaves by jumping).
  //
  // And no ground side-special dash at an edge after a target that is already off the stage (or past
  // the dash): the CPU hit-confirmed into its side special and chased the launched victim straight off
  // the stage (dev/aaa/sd_trace.js: every traced run-off at level 6 was `fsmash -> sb`).
  const think0 = AI.think;
  AI.think = function (f, st) {
    const o = think0.call(this, f, st);
    if (!MOTION.on() || !o) return o;
    // variety: CPUs chained into their side special over and over (20 % of all CPU moves, 31 % for some fighters,
    // observe.js 9/22 night). After one in 10 s, further ones are usually skipped so they pick something else.
    // Seeded Rng: the server and every peer make the same call.
    if (o.special && (o.left || o.right) && !o.up && !o.down) {
      const a = f.ai || (f.ai = {}), now = Game.frame;
      a.sbT = (a.sbT || []).filter(t => now - t < 600);
      if (a.sbT.length >= 1 && Rng.next() < 0.6) o.special = false; else a.sbT.push(now);
    }
    // AIR DISCIPLINE (9/22 night): when AI2 passes on a mid-air frame (~30 % of them at level 8) the old brain takes it and
    // throws an aerial by which way the target is, with no reach test: dair whiffed 69 % of 1,224 throws, nair 72 %, bair
    // 82 %, "height-gap" swings 85 % (observe.js). An old-brain aerial that AI2.canHit says cannot connect is not thrown;
    // the CPU keeps drifting. Resolves the aerial the way 40_fighter's local rules do (a direction turns and fairs).
    if (MOTION.AIRCHK && f.air && f.state === 'air' && (o.attack || o.smash) && !f.item && f.ai && f.ai.a2last !== Game.frame && typeof AI2 !== 'undefined') {
      const t = AI.target(f);
      if (t) {
        const dx = o.left && !o.right ? -1 : o.right && !o.left ? 1 : 0, m = f.m;
        let d = m.nair, face = f.face;
        if (o.up) d = m.uair; else if (o.down) d = m.dair; else if (dx) { d = m.fair; face = dx; }
        else if ((t.x - f.x) * f.face < 0) d = m.bair;
        if (d && !AI2.canHit(f, t, d, face)) { o.attack = false; o.smash = false; }
      }
    }
    // UNDER THE STAGE (9/22 night, scratchpad sdmoves probe): 11 of 21 level-8 self-destructs were an up special fired
    // from UNDER the main stage (inside its width, 170-330 px below the top). 50_ai recover() drifts toward the middle,
    // which below the lip means under the stage; the up special then bonks the underside and ends in a helpless fall.
    // Smash CPUs drift out past the ledge first. Below the lip and inside (or within 24 px of) the stage's width: drift
    // outward, and keep the up special (and, deep under, the jump) until clear of the lip. No Rng.
    if (MOTION.UNDER && f.air && st.main && (f.state === 'air' || f.state === 'helpless')) {
      const M0 = st.main;
      if (f.y > M0.top + 20 && f.x > M0.x0 - 24 && f.x < M0.x1 + 24) {
        const out = f.x < (M0.x0 + M0.x1) / 2 ? -1 : 1;
        o.left = out < 0; o.right = out > 0;
        if (o.special && o.up && f.x > M0.x0 - 8 && f.x < M0.x1 + 8) o.special = false;
        if (o.jump && f.x > M0.x0 + 40 && f.x < M0.x1 - 40) o.jump = false;
      }
    }
    if (f.air) return o;
    const M = st.main;
    if (o.special && !o.up && !o.down && (o.left || o.right) && !(o.left && o.right)) {
      const dx = o.right ? 1 : -1, dist = ((dx > 0 ? M.x1 : M.x0) - f.x) * dx;
      if (dist >= 0 && dist < 260) {
        const t = AI.target(f);
        const tOff = t && (t.x < M.x0 || t.x > M.x1 || t.y > M.top + 4);
        if (!t || tOff || (t.x - f.x) * dx > dist * 0.7) o.special = false;
      }
    }
    if (f.state !== 'ground' || o.jump) return o;
    const stop = Math.abs(f.vx) * 3.6 + 14;
    if (o.right && f.x + stop > M.x1 && f.x <= M.x1) o.right = false;
    if (o.left && f.x - stop < M.x0 && f.x >= M.x0) o.left = false;
    return o;
  };

  // COMBO VALVE (9/22 night, dev/aaa/invariants.js): 240 CPU matches found fighters held in hitstun for 400+
  // frames — e.g. GIGA's side-special dash catching the victim into its 7-hit flurry + launcher, which at
  // low percent does not launch far enough to escape, then dash again: a true loop, 7 s with no input.
  // Tekken caps this with its juggle rules, Brawlhalla with hitstun decay. Here: once a fighter has been
  // unable to act for LOCK frames in a row (hitstun, hitlag, grabbed), every further hit's hitstun shrinks
  // with the time already locked, down to a quarter, so they get a frame to act and can shield or jump out.
  // Normal combos (a few hits, a launcher, a juggle) finish long before LOCK and are untouched.
  // Past BREAK frames (a multi-hit whose hitlag + hitstun still covers the gap between its hits kept the
  // victim locked even at a quarter of the hitstun) the next hit barely freezes or stuns, and the first frame
  // the victim can act again comes with 45 frames of invulnerability (the usual shimmer): a guaranteed out.
  MOTION.FIT = { doge: 1.041, shib: 1.052, pepe: 0.975, bonk: 0.852, wif: 1.031, pengu: 1.202, floki: 0.913, cheems: 1.124, cashcat: 1.133, lobster: 1.02, wojak: 1.095, topg: 0.904, trump: 1.041, clanker: 0.983, giga: 0.852, ronin: 0.855, tyrant: 1.106, gwei: 1.036, shroom: 0.923, kaiju: 0.866, mochi: 1.181, omen: 1.151, wisp: 1.04, spark: 1.143, turbo: 1.121, chop: 0.924, ginga: 0.93, sifu: 0.949, fro: 0.911, bling: 1.071, hoodie: 1.032, slam: 1.051, mystic: 0.978, ape: 0.865, ember: 0.842, bogdanoff: 0.934, fartcoin: 1.07, bull: 0.958, bear: 0.919, whale: 0.835, sin: 0.876, gigachad: 0.901, popcat: 1.187, brett: 0.992, moodeng: 0.954 };   // dev/aaa/balfit.js ALL=1 LO=.82 HI=1.30, 9/26 evening: RE-FITTED after
  // 6g_styles gave all 46 fighters their own normals, which moved 34 of them. Every pair, both sides, on
  // ALL SIX stages -- 12,420 matches a round, 540 per fighter, so a win rate carries a ~2 % standard error
  // instead of the ~7.5 % the old one-stage sampling gave. Converged sd 5.7 -> 2.0 over six rounds and
  // held: best 55.4 %, worst 44.4 %, and from round 2 on NOT ONE fighter of the 46 outside 40-60 %.
  MOTION.LOCK = 150; MOTION.LOCK_SPAN = 200; MOTION.LOCK_MIN = 0.25; MOTION.BREAK = 200; MOTION.BREAK_INV = 45;
  const up0 = FP.update;
  FP.update = function (stage) {
    const r = up0.call(this, stage);
    if (MOTION.on()) {
      const locked = this.state === 'hitstun' || this.state === 'grabbed' || this.hitlag > 0;
      if (!locked && (this.lockT || 0) > MOTION.BREAK && this.state !== 'dead' && this.state !== 'respawn') this.invuln = Math.max(this.invuln, MOTION.BREAK_INV);
      this.lockT = locked ? (this.lockT || 0) + 1 : 0;
    }
    return r;
  };
  // ROSTER FIT (9/22 night): one strength value per fighter, fitted by dev/aaa/balfit.js on CPU round robins
  // (every pair, both sides, 6 stages). It scales the damage a fighter deals and its effective weight
  // (weight x s^1.5), clamped to +-12 %, so it nudges the roster toward 50 % without changing how anyone plays.
  // The fight's weight is swapped only for the length of the takeHit call (synchronous, restored in finally).
  const fitOf = f => (f && f.c && MOTION.FIT[f.c.id]) || 1;
  const take0 = FP.takeHit;
  FP.takeHit = function (hb, att, mult, srcX, srcFace) {
    let r;
    if (MOTION.on() && hb) {
      const fa = att && att !== this ? fitOf(att) : 1, fv = fitOf(this), c = this.c, w0 = c.weight;
      if (fa !== 1) mult = (mult || 1) * fa;
      // fv**1.5 as fv*sqrt(fv): Math.pow is engine-dependent, Math.sqrt is exactly specified.
      // This runs inside takeHit and scales weight, so it scales knockback -- a last-bit
      // difference here changes where a fighter lands. Shifts the value by ~1 ULP vs Math.pow.
      if (fv !== 1) c.weight = w0 * (fv * Math.sqrt(fv));
      try { r = take0.call(this, hb, att, mult, srcX, srcFace); } finally { c.weight = w0; }
    } else r = take0.call(this, hb, att, mult, srcX, srcFace);
    const L = this.lockT || 0;
    if (MOTION.on() && this.state === 'hitstun' && L > MOTION.LOCK) {
      const k = Math.max(MOTION.LOCK_MIN, 1 - (L - MOTION.LOCK) / MOTION.LOCK_SPAN);
      this.hitstun = Math.max(1, Math.round(this.hitstun * k));
      if (L > MOTION.BREAK) { this.hitstun = Math.min(this.hitstun, 2); this.hitlag = Math.min(this.hitlag, 2); }
    }
    return r;
  };

  // RESPAWN (audit C4, 9/22 night): the platform appeared 200 px under the TOP blast line (~500 px up) and a
  // respawned fighter spent ~1 s falling back into the fight. Smash's platform sits just above the stage.
  // Local rules: at most 300 px above the main stage.
  const resp0 = Game.respawn;
  Game.respawn = function (f) {
    const r = resp0.apply(this, arguments);
    if (MOTION.on() && this.stage && this.stage.main) f.y = Math.max(f.y, this.stage.main.top - 300);
    return r;
  };

  // SWORD HILT (9/22 night, dev/aaa/observe.js): 55_items swordify moves every hitbox of a sword-held normal 46 px out
  // along the blade (29 px up for the vertical ones) and keeps none near the body, so a sword swung point-blank
  // passed straight through the opponent: 84-92 % of CPU sword swings whiffed, and a player standing close got the
  // same. Local rules: the blade covers hilt to tip. The tip hitboxes keep priority and the unarmed ones follow
  // with the sword's damage, knockback and timing, so a hit anywhere along the blade connects (still one hit per
  // victim per move). 63_netsim fingerprints the original swordify, captured before this file loads.
  MOTION.HILT = true; MOTION.AIRCHK = true; MOTION.ROLLEDGE = true; MOTION.UNDER = true;
  const sword0 = swordify, HILT = new WeakMap();
  swordify = function (def, sw) {
    const out = sword0(def, sw);
    if (!MOTION.on() || !MOTION.HILT || !def.hits) return out;
    let m = HILT.get(out);
    if (!m) {
      const off = Math.floor((sw.slow || 0) / 2);
      const hilt = def.hits.map(h => Object.assign({}, h, { f: [h.f[0] + off, h.f[1] + off + 2], dmg: h.dmg * sw.dmg, kbg: h.kbg * sw.kb }));
      m = Object.assign({}, out, { hits: out.hits.concat(hilt) });
      HILT.set(out, m);
    }
    return m;
  };

  // calls through with a bigger k, so the base drift (and anything later wrapped round it) still runs.
  // Accel stays 0.45 px/f², which is already Mario's 0.08 u/f² at our scale.
  const drift0 = FP.drift;
  FP.drift = function (k) {
    if (!MOTION.on()) return drift0.call(this, k);
    const tr = TR.of(this);
    return drift0.call(this, k * MOTION.AIR * (tr && tr.airc > 1 ? tr.airc : 1));
  };
})();
