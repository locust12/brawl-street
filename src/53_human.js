// ===== HUMAN: the CPU gets human eyes, a human trigger finger and human attention =====
//
// Duane, 10/16: "i dont like how with easy mode the computer just waits for where the character will
// land and attacks it makes it too difficult. make computer fighter more natural. its too concise
// like an unbeatable robot."
//
// He is describing one specific mechanism, and he is right about it. `AI2.canHit` (51_ai2) decides
// whether to swing by LEADING the opponent: it takes their exact x, y, vx, vy, applies gravity, and
// works out where their body will be on the precise frame the hitbox goes active. It was written to
// stop the CPU whiffing 66% of its swings, and it worked -- but a mover that only ever swings when
// the maths says it connects is not a fighter, it is a solver. On a jump-in it stands still, computes
// your landing spot, and fires the frame before you touch the ground. Every time. There is no read to
// win, no spacing to beat, nothing to learn: you cannot approach it at all.
//
// The old Easy knob (`SK` in 51_ai2) only scaled the PROBABILITY of each decision. A weaker roll on a
// perfect read is still a perfect read -- it just arrives slightly less often, which reads as a robot
// having an off day, not as a person. What makes an opponent feel human is not worse odds, it is
// worse INFORMATION and worse HANDS:
//
//   1. EYES      it acts on where you were a fifth of a second ago, not where you are
//   2. AIM       it guesses your landing spot instead of solving it, and guesses wrong
//   3. HANDS     it hesitates on the trigger, and sometimes swings at nothing at all
//   4. ATTENTION it drifts in and out of the fight instead of answering on all 60 frames
//   5. FAIRNESS  it will not hit you while you are landing, because you cannot answer that
//
// Every one of them scales with level, so Brutal still plays close to the solver (4 frames of lag,
// near-exact aim, no lapses, no landing amnesty) and Easy plays like somebody holding a controller
// for the first time.
//
// MEASURED 1, the complaint itself (dev harness: the player walks in, jumps, and does NOTHING else;
// how many of those landings are met with a hit):
//
//                 landings attacked
//   Easy    was        25 %          now   5 %     (what is left is a move already in flight)
//   Medium  was        37 %          now   9 %
//   Hard    was        42 %          now  18 %
//   Brutal  was        32 %          now  30 %     (on purpose: Brutal is the solver)
//
// MEASURED 2, 30 matches per level, a naive masher (walks in, swings in range, scrambles back when
// thrown off -- no blocking, no DI, no spacing) against each of the four difficulty buttons:
//
//                 masher wins   stocks left   CPU accuracy   caught landing   self-destructs
//   Easy    was        53 %      0.53 / 0.53       48 %        1.73 / match        0.00
//           now        87 %      1.40 / 0.13       27 %        0.17 / match        0.00
//   Medium  was         0 %      0.00 / 1.47       49 %        1.43 / match        0.00
//           now        50 %      0.67 / 0.63       30 %        0.20 / match        0.00
//   Hard    was         0 %      0.00 / 1.80       51 %        1.93 / match        0.00
//           now         7 %      0.07 / 1.17       36 %        0.87 / match        0.00
//   Brutal  was         0 %      0.00 / 1.73       45 %        1.43 / match        0.00
//           now         0 %      0.00 / 1.47       42 %        1.93 / match        0.00
//
// Easy went from a coin flip against a player who does not even block to a CPU that loses most of
// the time, Brutal did not move, and the four buttons finally describe four different opponents.
// The CPU swings MORE than it used to (37 a match at Easy against 33) and lands far fewer: it is
// busier and worse, which is what a person looks like. No new self-destructs at any level.
//
// No existing behaviour is deleted: this wraps AI.target, AI2.canHit and AI.think, so all five brains
// (50_ai, 51_ai2's five situations, 21_roster2's specials, 25_feel, 57_items3) inherit the same human
// limits for free. Whatever any of them decides, it decides from a stale, fuzzy picture.
//
// DETERMINISM: gated on `Game.combos`, which Game.start only sets for unseeded local matches, exactly
// like 51_ai2. The seeded bet arena (ARENA.version 1) and online lockstep never run a line of this,
// so old fights still replay bit-identically. No banned transcendentals: + - * / and Math.sqrt only.
const HUMAN = {
  off: false,
  on() { return !!Game.combos && !Game.noHuman && !this.off; },

  // 0 at Easy (level 1) .. 1 at Brutal (level 9) -- the levels 8c_difficulty's four buttons map to.
  skill(f) { return clamp(((f.level || 5) - 1) / 8, 0, 1); },

  // ---- 1. EYES: perception lag -------------------------------------------------
  // A ring of recent snapshots per fighter, so a CPU can be handed the opponent as they were N frames
  // ago. Measured median delay in play: Easy 29 frames (0.48 s), Medium 19, Hard 9, Brutal 4 -- the
  // bottom of that ladder is a distracted beginner, the top is faster than any player, so Brutal is
  // still frightening. This is the single change that kills the landing-punish: by the time an Easy
  // CPU can see you falling, you have already landed and acted.
  LEN: 64,
  LAG: 30, LAG_SPAN: 26,       // lag = LAG - LAG_SPAN * skill
  record(f) {
    if (f.hAt === Game.frame) return;                 // once a frame, whoever looks first
    f.hAt = Game.frame;
    if (f.hWasAir && !f.air) f.hLandAt = Game.frame;  // the frame they touched down (see `landing`)
    f.hWasAir = f.air;
    const h = f.hHist || (f.hHist = []);
    h[Game.frame % this.LEN] = {
      fr: Game.frame, x: f.x, y: f.y, vx: f.vx, vy: f.vy, state: f.state, air: f.air,
      crouch: f.crouch, dmg: f.dmg, face: f.face, st: f.st, hitlag: f.hitlag,
      mv: f.move, mvT: f.move ? f.move.t : 0,
    };
  },

  // The remembered move needs the real move's identity (25_feel keys "is this still the same opening?"
  // off the move object itself) but a stale `t`, so each real move gets one wrapper, made once.
  MV: typeof WeakMap === 'function' ? new WeakMap() : null,
  ghostMove(mv, t) {
    if (!mv) return null;
    if (!this.MV) return mv;
    let w = this.MV.get(mv);
    if (!w) { w = Object.create(mv); this.MV.set(mv, w); }
    w.t = t;
    return w;
  },

  offstage(t) {
    const M = Game.stage && Game.stage.main;
    return !!M && (t.x < M.x0 || t.x > M.x1 || t.y > M.top + 4);
  },

  // How far back this CPU is looking. Jittered per fighter so two CPUs in a free-for-all are not the
  // same delay line, and so one CPU is not a fixed one either.
  //
  // CLAMPED for the slow, loud facts. Someone being launched off the stage, lying in hitstun or
  // respawning is information a person takes in instantly -- it is a body flying across the screen.
  // What a person cannot do is call the frame you land. Leaving the full lag on those states made the
  // CPU edge-guard a position its opponent had left, walk off after a stale read and self-destruct
  // (the exact failure 51_ai2's edge-guard comments were written to fix), and jab at a corpse.
  lag(f, tgt) {
    let n = Math.round(this.LAG - this.LAG_SPAN * this.skill(f)) + Math.round(this.noise(f, 2) * 3);
    if (tgt.state === 'hitstun' || tgt.state === 'grabbed' || tgt.state === 'dead' ||
        tgt.state === 'respawn' || tgt.state === 'ledge' || this.offstage(tgt)) n = Math.min(n, 4);
    return clamp(n, 0, this.LEN - 2);
  },

  ghost(f, tgt) {
    const a = f.ai;
    if (a.hGAt === Game.frame && a.hGOf === tgt) return a.hG;       // one picture per frame
    const lag = this.lag(f, tgt);
    let g = tgt, s = null;
    if (lag > 0 && tgt.hHist) {
      const want = Game.frame - lag;
      s = tgt.hHist[(want + this.LEN) % this.LEN];
      // A hole in the ring (nothing looked at them for a while) used to fall straight back to the
      // LIVE fighter, which handed the CPU perfect, zero-delay vision for a moment -- and it happened
      // every time a lapse ended, which at Easy is constantly. Walk back to the newest memory that is
      // at least this old instead; stale eyes are the whole point, so a gap must never sharpen them.
      if (!s || s.fr !== want) {
        s = null;
        for (const e of tgt.hHist) if (e && e.fr <= want && (!s || e.fr > s.fr)) s = e;
      }
    }
    if (s) {
      g = Object.create(tgt);                       // everything else (w, h, c, m, stocks) reads live
      g.x = s.x; g.y = s.y; g.vx = s.vx; g.vy = s.vy;
      g.state = s.state; g.air = s.air; g.crouch = s.crouch;
      g.dmg = s.dmg; g.face = s.face; g.st = s.st; g.hitlag = s.hitlag;
      g.move = this.ghostMove(s.mv, s.mvT);
    }
    a.hG = g; a.hGOf = tgt; a.hGAt = Game.frame;
    return g;
  },

  // ---- 2. AIM: a guess, not a solution -----------------------------------------
  // What AI2.canHit is handed instead of the opponent. Two things are wrong with it on purpose:
  //
  //   LEAD   the fall is only partly accounted for (0.30 of it at Easy, all of it at Brutal), and over
  //          one nominal startup rather than per hitbox -- so the CPU aims at where you were, not where
  //          you will be. This is the landing-wait, removed at the source.
  //   NOISE  a held mis-estimate of where you actually are, re-guessed every NOISE_HOLD frames and
  //          much larger while you are airborne, because a body in the air is the hardest thing in a
  //          fighting game to place. Held, not re-rolled per call, so the CPU picks its move from ONE
  //          belief about the world each frame -- a wrong read, not a tremor.
  LEAD: 0.22, LEAD_SPAN: 0.78, LEAD_T: 8,
  NOISE_HOLD: 9, NOISE_AIR: 54, NOISE_GND: 22, NOISE_AIRY: 46, NOISE_GNDY: 14,
  noise(f, k) {
    const a = f.ai, n = a.hN || (a.hN = [0, 0, 0]);
    if ((a.hNAt || -999) + this.NOISE_HOLD <= Game.frame) {
      a.hNAt = Game.frame;
      n[0] = Rng.next() * 2 - 1; n[1] = Rng.next() * 2 - 1; n[2] = Rng.next() * 2 - 1;
    }
    return n[k];
  },
  belief(f, tgt) {
    const a = f.ai;
    if (a.hBAt === Game.frame && a.hBOf === tgt) return a.hB;
    const s = this.skill(f), m = 1 - s, lead = this.LEAD + this.LEAD_SPAN * s;
    const T = this.LEAD_T, g = (tgt.c && tgt.c.grav) || 0.6;
    const b = Object.create(tgt);
    // canHit's own lead is driven by vx/vy/air, so zero them and hand it the guess instead
    b.air = false; b.vy = 0;
    b.vx = tgt.vx * lead;                                          // horizontal lead survives, scaled
    b.x = tgt.x + this.noise(f, 0) * m * (tgt.air ? this.NOISE_AIR : this.NOISE_GND);
    b.y = tgt.y + (tgt.air ? lead * (tgt.vy * T + 0.5 * g * T * T) : 0) +
          this.noise(f, 1) * m * (tgt.air ? this.NOISE_AIRY : this.NOISE_GNDY);
    a.hB = b; a.hBOf = tgt; a.hBAt = Game.frame;
    return b;
  },

  // ---- 4. ATTENTION: in and out of the fight -----------------------------------
  // 51_ai2 already knew this mattered ("the other half is that it answers on EVERY frame, so a new
  // player never gets an opening to walk into") and bought it with `(Game.frame + idx * 17) % 60 <
  // idle`: a metronome. 20 frames off, 40 frames on, forever, to the frame. It reads as the game
  // hitching, not as a person losing the thread -- and a player can learn its beat in a few seconds.
  //
  // This is the same budget spent stochastically, and a lapsing CPU keeps MOVING: it shifts its feet,
  // walks the wrong way, holds a nervous shield. A fighter frozen mid-stage is a bug; a fighter
  // ambling while it works out what to do is a person.
  LAPSE_P: 0.018, LAPSE_MIN: 12, LAPSE_BASE: 26, LAPSE_SPAN: 42, LAPSE_GAP: 24,
  safe(f, st) {
    const M = st && st.main;
    return f.state === 'ground' && !f.air && !f.item && !f.finalReady && !(f.hitlag > 0) &&
      !!M && f.x > M.x0 + 24 && f.x < M.x1 - 24 && f.y <= M.top + 4;
  },
  lapse(f, st) {
    const a = f.ai, s = this.skill(f);
    if (s >= 1) return null;                                        // Brutal never looks away
    if ((a.hLap || 0) > 0) {
      if (!this.safe(f, st)) { a.hLap = 0; return null; }            // snap out of it to recover
      a.hLap--;
      if (!a.hLap) a.hLapEnd = Game.frame;
      const o = {}; for (const k of ACTIONS) o[k] = false;
      if (a.hLapK) o[a.hLapK] = true;
      if (a.hLapS) o.shield = true;
      return o;
    }
    if (!this.safe(f, st) || Game.frame - (a.hLapEnd || -999) < this.LAPSE_GAP) return null;
    const m = 1 - s, q = m * Math.sqrt(m);                          // falls away faster than the level rises
    if (Rng.next() >= this.LAPSE_P * q) return null;
    a.hLap = this.LAPSE_MIN + irand(0, Math.round(this.LAPSE_BASE + this.LAPSE_SPAN * m));
    const r = Rng.next();
    a.hLapK = r < 0.34 ? null : r < 0.67 ? 'left' : 'right';        // a third of lapses stand and think
    a.hLapS = Rng.next() < 0.12;
    return this.lapse(f, st);
  },

  // ---- 5. LET THEM LAND --------------------------------------------------------
  // Duane, 10/16, after the first pass: "fix it so it doesnt wait for my player to land and attack
  // so i cant even fucking land without getting attacked ... makes it unfair."
  //
  // He is right, and the first pass was the wrong shape of fix for this one. Fuzzing the CPU's aim
  // made the landing punish RARER (39% of its hits caught him falling or landing, down to 29%), and
  // rarer is not the point: the point is that touching down is the one moment a player cannot defend
  // themselves. Landing lag locks you out of blocking, dodging and attacking for a fixed number of
  // frames. A CPU that swings into that window is not beating you, it is hitting a man who is tied
  // up -- and because the old brain only ever swung when the maths said it would connect, it hit
  // that window every single time. There is no probability that makes that fair. It has to be a rule.
  //
  // So: no CPU may START an attack against someone who is in the last frames of their fall, in their
  // landing lag, or just out of it. A smash already charging is HELD rather than released into them.
  // And it does not stand on the spot they are coming down on, which is what made it feel like it was
  // waiting there for him.
  //
  // The window closes as the level rises (Easy 20 frames before touchdown + 36 after, Medium 13 + 23,
  // Hard 5 + 8, Brutal none at all), so Brutal still punishes a landing the way a strong player does
  // and the four buttons stay four different opponents. It never applies to an opponent who is off
  // the stage: covering a recovery is edge-guarding, which is a real part of the game, not this.
  GRACE: 16, PRELAND: 20,
  // the surface they are actually going to land on: the highest platform under their feet
  surfaceBelow(t) {
    const S = Game.stage; if (!S) return null;
    let y = null;
    const look = p => { if (p && t.x >= p.x0 && t.x <= p.x1 && p.y >= t.y && (y === null || p.y < y)) y = p.y; };
    look(S.mainSurf);
    if (S.plats) for (const p of S.plats) look(p);
    return y;
  },
  framesToLand(t) {
    const y = this.surfaceBelow(t);
    if (y === null) return -1;
    const d = y - t.y;
    if (d < 0) return -1;
    const g = (t.c && t.c.grav) || 0.6, v = t.vy;
    return (Math.sqrt(v * v + 2 * g * d) - v) / g;
  },
  landing(f, tgt) {
    const m = 1 - this.skill(f), q = m * Math.sqrt(m);
    const grace = Math.round(this.GRACE * q), pre = Math.round(this.PRELAND * q);
    if (grace <= 0 && pre <= 0) return false;                       // Brutal keeps the punish
    if (this.offstage(tgt)) return false;                           // a recovery is edge-guarding, not this
    if (tgt.state === 'land') return true;                          // the landing lag itself: locked out, cannot answer
    if (tgt.hLandAt !== undefined && Game.frame - tgt.hLandAt < grace) return true;
    if (tgt.air && tgt.vy > 0 && pre > 0) {
      const n = this.framesToLand(tgt);
      if (n >= 0 && n < pre) return true;
    }
    return false;
  },
  // the real opponent, not the remembered one: this guarantee is one the player has to be able to
  // feel, so it is not allowed to depend on what the CPU happens to have noticed
  live(f) {
    AI.target(f);                                                   // fills the per-frame cache
    return f.ai.hGAt === Game.frame ? f.ai.hGOf : null;
  },

  // ---- 3. HANDS: the trigger finger --------------------------------------------
  // Applied to whatever any brain decided, so a hesitation or a wild swing can land on a punish, an
  // edge-guard or a combo follow-up alike.
  //
  //   DROP   a fresh attack press is sometimes not pulled. Only a FRESH press: a held smash charge
  //          (51_ai2's `hold`) keeps charging, so this reads as a late trigger, not a stutter.
  //   WHIFF  and sometimes it swings with nothing in front of it. This is the one that sells it --
  //          every brain in this game was built to never miss, and a fighter that never misses cannot
  //          be read. Grounded only, never near a ledge, never at someone who is off the stage.
  //   DRIFT  and it never stands perfectly still at perfect spacing waiting for you to walk in.
  DROP: 0.34, WHIFF: 0.085, WHIFF_RANGE: 1.7, DRIFT: 0.25,
  hands(f, st, o) {
    if (!o) return o;
    const s = this.skill(f), m = 1 - s;
    if (s >= 1) return o;
    const t0 = this.live(f);
    if (t0 && this.landing(f, t0)) {
      if (!f.prev.attack) o.attack = false;                         // nothing may START here
      if (!f.prev.special) o.special = false;
      if (!f.prev.grab) o.grab = false;
      if (!f.prev.grapple) o.grapple = false;
      o.smash = !!f.prev.smash;                                     // keep a charge charging, never release it into them
      const M = st && st.main, to = t0.x > f.x ? 'right' : 'left';
      if (o[to] && Math.abs(t0.x - f.x) < 150) {                    // and do not camp the spot they are coming down on
        o[to] = false;
        if (!f.air && M && f.x > M.x0 + 80 && f.x < M.x1 - 80 && s < 0.7) o[to === 'right' ? 'left' : 'right'] = true;
      }
      return o;
    }
    const fresh = (o.attack && !f.prev.attack) || (o.smash && !f.prev.smash) ||
                  (o.special && !f.prev.special) || (o.grab && !f.prev.grab) ||
                  (o.grapple && !f.prev.grapple);
    if (fresh && !f.air && Rng.next() < this.DROP * m) {
      o.attack = o.smash = o.special = o.grab = o.grapple = false;
      return o;
    }
    if (o.attack || o.smash || o.special || o.grab || o.grapple || o.jump || o.shield) return o;
    if (f.state !== 'ground' || f.air || f.item) return o;
    const M = st && st.main;
    if (!M || f.x < M.x0 + 70 || f.x > M.x1 - 70) return o;         // not while standing on a lip
    const t = AI.target(f);
    if (!t || this.offstage(t) || t.state === 'dead' || t.state === 'respawn') return o;
    const range = f.w * 0.5 + 44 * (f.c.reach || 1) + t.w * 0.35;
    const adx = Math.abs(t.x - f.x);
    if (adx < range * this.WHIFF_RANGE && Rng.next() < this.WHIFF * m) {
      if (!f.prev.attack) o.attack = true;
      return o;
    }
    // and never standing perfectly still at perfect spacing, waiting for you to walk in
    if (adx > 50 && !o.left && !o.right && Rng.next() < this.DRIFT * m) o[t.x > f.x ? 'right' : 'left'] = true;
    return o;
  },
};

(function () {
  // every brain asks AI.target for the opponent, so ghosting it here is all four limits at once
  AI.target = (function (base) {
    return function (f) {
      const t = base.call(this, f);
      if (!t || !f || !f.cpu || !f.ai || !HUMAN.on()) return t;
      HUMAN.record(t);
      return HUMAN.ghost(f, t);
    };
  })(AI.target);

  // the reach test, asked about a guess instead of about the truth
  if (typeof AI2 !== 'undefined' && AI2 && typeof AI2.canHit === 'function') {
    AI2.canHit = (function (base) {
      return function (f, tgt, def, face) {
        if (!f || !f.cpu || !f.ai || !tgt || !HUMAN.on()) return base.call(this, f, tgt, def, face);
        return base.call(this, f, HUMAN.belief(f, tgt), def, face);
      };
    })(AI2.canHit);
  }

  AI.think = (function (base) {
    return function (f, st) {
      if (!f.cpu || !f.ai || !HUMAN.on()) return base.call(this, f, st);
      HUMAN.live(f);                 // keep watching them even while lapsing, or the memory gets holes
      const l = HUMAN.lapse(f, st);
      if (l) return l;
      return HUMAN.hands(f, st, base.call(this, f, st));
    };
  })(AI.think);
})();

if (typeof window !== 'undefined') window.HUMAN = HUMAN;
