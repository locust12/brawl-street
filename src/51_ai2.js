// ===== CPU brain, layer 2: spacing, blocking, whiff punishment, throw mixups =====
//
// 50_ai.js decides what to do from a flat random roll, which is why the watch harness
// (dev/aaa/observe.js) measured a CPU that jabs 46% of the time, blocks 1.5% of incoming attacks,
// throws almost never, and leaves 7 stretches of 3+ seconds per match where nobody lands anything.
// None of those are how Tekken or Smash actually play.
//
// This file pre-empts AI.think in the five situations a real player reads, and falls through to the
// old brain everywhere else (ledges, recovery, items, Final Smash, grabs in progress):
//
//   1. BLOCK      an attack is coming and it reaches me      -> shield / spot-dodge / roll through
//   2. PUNISH     they whiffed and are stuck in recovery     -> the biggest thing that reaches
//   3. THROW      they are sitting in shield                 -> grab, because throws beat blocking
//   4. SPACE      neutral                                    -> pick by range, not by coin flip
//   5. PRESSURE   nobody has landed a hit in a while         -> close the gap and commit
//
// GATED ON Game.combos, which is only true in unseeded local matches. The seeded bet arena and
// online lockstep never run a line of this, so ARENA.version 1 stays bit-identical (checked by
// dev/aaa/guard.sh against dev/aaa/golden_v1_hashes.json).

const AI2 = {
  on: true,
  // Frames a CPU waits between specials. 45 (0.75s) was measured as far too loose to bind: a 60s
  // match has room for 80 specials, so side-special still came out 23 times a match, 27% of the
  // fighter's whole offence at a 55% miss rate. 90 frames (1.5s) still reads as that fighter's
  // showpiece move without reading as a held button.
  SPEC_COOL: 90,

  // how long since ANYONE landed a hit: the dead-air clock. takeHit (41_combat) stamps lastHitT on
  // whoever got hit, so no extra hook is needed — and this file loads before 60_game.js, where Game
  // itself is declared, so it must not touch Game at load time.
  staleFrames() {
    let t = 0;
    for (const g of Game.fighters) if ((g.lastHitT || 0) > t) t = g.lastHitT;
    return Game.frame - t;
  },

  // ---- reading the opponent ----------------------------------------------------
  // which part of an attack they are in: startup is a threat, recovery is free damage
  phase(f) {
    if (f.state !== 'move' || !f.move) return null;
    const d = f.move.def, t = f.move.t;
    if (!d.hits || !d.hits.length) return t * 2 < (d.total || 20) ? 'startup' : 'recovery';
    let s = 1e9, e = -1;
    for (const h of d.hits) { if (h.f[0] < s) s = h.f[0]; if (h.f[1] > e) e = h.f[1]; }
    return t < s ? 'startup' : t <= e ? 'active' : 'recovery';
  },
  // frames they are still stuck for
  recLeft(f) { return f.move ? (f.move.def.total || 24) - f.move.t : 0; },
  // how far their current attack reaches, in world units from their body
  swingReach(f) {
    if (!f.move || !f.move.def.hits) return 0;
    let r = 0;
    for (const h of f.move.def.hits) r = Math.max(r, Math.abs(h.x || 0) + (h.r || 0));
    return r * (Game.reach || 1);
  },
  // my own poke range, the same number 50_ai.js uses to decide it is close enough
  reach(f, tgt) { return f.w * 0.5 + 44 * f.c.reach + tgt.w * 0.35; },

  // Would this move actually connect? The old brain committed on one generic `range` number, which
  // is why the watch harness measured jab whiffing 90.7% of 227 throws and aerials 80-91%: a jab
  // reaches ~60 units forward and barely any vertically, but the CPU would throw it at anyone
  // within 120 units of height. This walks the move's real hitboxes, leads both fighters to the
  // frame the hitbox goes active, and does the same circle-vs-box test 60_game.js uses.
  // It is the difference between a CPU that swings and a CPU that hits.
  canHit(f, tgt, def, face) {
    if (!def) return false;
    if (def.ground || def.air) def = f.air ? (def.air || def.ground) : (def.ground || def.air);
    if (!def.hits || !def.hits.length) return false;
    const R = Game.reach || 1, dir = face || f.face;
    const g = f.c.grav || 0.6;
    for (const h of def.hits) {
      const t = h.f[0];
      // where they will be when it comes out (linear lead; good enough over 3-15 frames)
      const px = tgt.x + tgt.vx * t;
      const py = tgt.y + (tgt.air ? tgt.vy * t + 0.5 * g * t * t : 0);
      const fx = f.x + f.vx * t * 0.5;
      const fy = f.y + (f.air ? f.vy * t + 0.5 * g * t * t : 0);
      const hx = fx + dir * (h.x || 0) * R, hy = fy + (h.y || 0), r = (h.r || 0) * R;
      const duck = tgt.crouch ? (Game.duck ? 0.46 : 0.72) : 1;
      const x0 = px - tgt.w * 0.4, x1 = px + tgt.w * 0.4, y0 = py - tgt.h * duck, y1 = py;
      const nx = clamp(hx, x0, x1), ny = clamp(hy, y0, y1);
      if ((hx - nx) * (hx - nx) + (hy - ny) * (hy - ny) < r * r) return true;
    }
    return false;
  },
  // the move behind a pick key, so canHit can be asked about it before committing
  defOf(f, k) {
    const m = f.m;
    switch (k) {
      case 'jab': return m.jab; case 'ftilt': return m.ftilt; case 'utilt': return m.utilt;
      case 'dtilt': return m.dtilt; case 'fsmash': return m.fsmash; case 'usmash': return m.usmash;
      case 'dsmash': return m.dsmash; case 'grab': return m.grab;
      case 'nair': return m.nair; case 'fair': return m.fair; case 'bair': return m.bair;
      case 'uair': return m.uair; case 'dair': return m.dair;
      case 'sb': return m.sb; case 'db': return m.db; case 'nb': return m.nb;
      default: return null;
    }
  },
  // drop every option that cannot reach, so the CPU stops swinging at air
  reachable(f, tgt, opts, face) {
    const out = [];
    const onCool = Game.frame - ((f.ai && f.ai.a2spec) || -999) < this.SPEC_COOL;
    for (const o of opts) {
      if (o.k === 'dash') { out.push(o); continue; }
      if (onCool && (o.k === 'sb' || o.k === 'nb' || o.k === 'db')) continue;   // one special at a time
      const d = this.defOf(f, o.k);
      if (!d) continue;
      if (this.canHit(f, tgt, d, face)) out.push(o);
    }
    return out;
  },

  // anti-spam: remember the last few moves and refuse to pick the same one again
  used(f, name) {
    const a = f.ai;
    a.a2recent = a.a2recent || [];
    a.a2recent.push(name);
    if (a.a2recent.length > 4) a.a2recent.shift();
  },
  stale(f, name) {
    const r = f.ai.a2recent;
    if (!r || !r.length) return 0;
    let n = 0; for (const x of r) if (x === name) n++;
    return n;                                   // 0 fresh, 3+ means it has been leaned on
  },
  // weighted pick that skips whatever the CPU has been repeating
  pick(f, opts) {
    let total = 0;
    const live = [];
    for (const o of opts) {
      const w = o.w * (1 - Math.min(0.85, this.stale(f, o.k) * 0.38));
      if (w <= 0) continue;
      live.push({ o, w }); total += w;
    }
    if (!total) return null;
    let r = Rng.next() * total;
    for (const x of live) { r -= x.w; if (r <= 0) { this.used(f, x.o.k); return x.o; } }
    const last = live[live.length - 1].o; this.used(f, last.k); return last;
  },

  // ---- the hook ----------------------------------------------------------------
  think(f, st) {
    const a = f.ai, S = f.state;
    // a decision made a few frames ago is still being held down (shields, charged smashes)
    if (a.a2hold > 0) { a.a2hold--; const o = {}; for (const k of a.a2keys) o[k] = true; return o; }
    if (S !== 'ground' && S !== 'air' && S !== 'shield') return null;   // old brain owns the rest
    if (f.finalReady || f.item) return null;                            // 50_ai handles supers and items
    const tgt = AI.target(f);
    if (!tgt) return null;

    // I am off the stage: getting back is the only thing that matters. 50_ai.recover() owns this,
    // and AI2 must not steal the frame and throw an aerial instead.
    {
      const m0 = st.main;
      if (f.x < m0.x0 - 6 || f.x > m0.x1 + 6 || f.y > m0.top + 4) return null;
    }

    // EASY HESITATES. Weaker decisions are only half of what makes a CPU beatable -- the other half is
    // that it answers on EVERY frame, so a new player never gets an opening to walk into. At low levels
    // it now spends part of each second doing nothing at all. Offset per fighter so two CPUs in a
    // free-for-all do not freeze in lockstep, and placed AFTER the recovery guards above so a hesitating
    // CPU never forgets to come back to the stage.
    // Level 5 and up are untouched, so Medium-and-up play and the seeded arena are unchanged.
    if (Game.sigs && !Game.noSkill && f.level < 5) {
      const idle = Math.round((5 - f.level) * 5);           // level 1: 20 frames in every 60
      if ((Game.frame + (f.idx || 0) * 17) % 60 < idle) return {};
    }

    // Their stock is gone or they are respawning: there is nothing to hit. The old brain jabbed at
    // it anyway — 31 swings a session, 100% of them missing, because it never checks.
    if (tgt.state === 'dead' || tgt.state === 'respawn') {
      const o0 = {}; for (const k of ACTIONS) o0[k] = false;
      const mid = (st.main.x0 + st.main.x1) / 2;                        // take centre stage and wait
      if (Math.abs(f.x - mid) > 60) o0[f.x < mid ? 'right' : 'left'] = true;
      return o0;
    }

    const o = {}; for (const k of ACTIONS) o[k] = false;
    const press = k => { if (!f.prev[k]) o[k] = true; };
    const key = d => (d > 0 ? 'right' : 'left');
    const hold = (keys, t) => { a.a2keys = keys; a.a2hold = t; for (const k of keys) o[k] = true; };

    const dx = tgt.x - f.x, adx = Math.abs(dx), dir = dx > 0 ? 1 : -1;
    const dy = (tgt.y - tgt.h / 2) - (f.y - f.h / 2);
    const M = st.main;
    const range = this.reach(f, tgt);
    // EASY HAS TO ACTUALLY BE EASY (Duane, 9/25: "easy mode is wayy too hard against cpu").
    // Every probability in here reads `base + lvl * k`, and the BASE is what a level-1 CPU still does:
    // it guarded 36% of threats, anti-aired 35%, punished 42% and committed at 24%. So the slider was
    // only ever moving the top of the range. Measured with dev/aaa/easytest.js, which plays a naive
    // masher (walk in, swing in range, scramble back when thrown off -- no blocking, no DI, no spacing)
    // against each difficulty:
    //        level 1  masher wins 0%   stocks 0.00 / 2.83
    //        level 9  masher wins 0%   stocks 0.04 / 2.96
    // i.e. a new player got 3-0'd on Easy, and Easy and Brutal were barely different.
    // SKILL scales the WHOLE roll at low levels rather than only its level term, so Easy loses the
    // floor instead of just the ceiling. 1 at level 5 and above, so Medium-and-up play exactly as
    // before and the balance work behind observe's 88/100 is untouched. Gated on Game.sigs.
    const lvl = f.level;
    const SK = (Game.sigs && lvl < 5 && !Game.noSkill) ? 0.18 + 0.205 * (lvl - 1) : 1;
    // EDGE-GUARD. They are off the stage trying to get back. The old brain's answer was to stand in
    // the middle and jab: 88 jabs a session at someone who is not there, 91% of them missing.
    // Smash's answer is to take the ledge and cover the return.
    const offstage = tgt.x < M.x0 || tgt.x > M.x1 || tgt.y > M.top + 4;
    // Edge-guarding is something you do STANDING on the stage. Letting it run while airborne was
    // the bug behind every 0% self-destruct traced this iteration: the "hold the spot" branch
    // returns an empty input, and returning ANY decision suppresses the old brain — including
    // AI.recover. So an airborne CPU near the lip pressed nothing, drifted out and died at 0%.
    if (offstage && !f.air) {
      const side = tgt.x < 0 ? -1 : 1;                                   // the ledge they are coming back to
      const ledgeX = side < 0 ? M.x0 : M.x1;
      // Stand INBOARD of the lip, never on or past it. The first version allowed anywhere within 46
      // units of the ledge — which includes 46 units PAST it — and the CPU would then turn toward the
      // edge to face them, or fire a lunging side-special, and walk itself off at 0%. Measured: it
      // doubled self-destructs (4 vs 2 in 5 matches) and halved match length.
      const standX = ledgeX - side * 52;
      if (side > 0 ? f.x > standX : f.x < standX) { a.a2br = 'guard-return'; o[key(-side)] = true; return o; }   // too far out: come back
      const atLedge = Math.abs(f.x - standX) < 34;
      if (!atLedge) {                                                    // walk to the spot, do not swing
        a.a2br = 'guard-walk'; o[key(standX > f.x ? 1 : -1)] = true;
        return o;
      }
      // standing on the ledge: only swing if something would actually reach them out there
      const guard = this.reachable(f, tgt, [
        { k: 'fsmash', w: tgt.dmg > 60 ? 1.2 : 0.6 }, { k: 'ftilt', w: 1.0 }, { k: 'dtilt', w: 0.9 },
        { k: 'dsmash', w: 0.7 }, { k: 'fair', w: 0.8 }, { k: 'dair', w: 0.6 },
      ], side);   // NO side-special here: most are a dash/lunge, i.e. a suicide button at the lip
      if (guard.length && Rng.next() < (0.25 + lvl * 0.05) * SK) {
        if (f.face !== side) { f.face = side; }     // turn on the spot; stepping here walks off
        const g = this.pick(f, guard);
        switch (g.k) {
          case 'fsmash': o[key(side)] = true; hold(['smash', key(side)], irand(4, 14)); return o;
          case 'dsmash': o.down = true; press('smash'); return o;
          case 'ftilt': o[key(side)] = true; press('attack'); return o;
          case 'dtilt': o.down = true; press('attack'); return o;
          case 'dair': o.down = true; press('attack'); return o;
          default: o[key(side)] = true; press('attack'); return o;
        }
      }
      a.a2br = 'guard-hold'; return o;   // hold the spot and wait for them; never walk off after them
    }

    const ph = this.phase(tgt);

    // 1. BLOCK ---------------------------------------------------------------
    // Their attack is coming out and it reaches me. Tekken is mostly blocking; this CPU never did.
    if (!f.air && (ph === 'startup' || ph === 'active')) {
      const threatens = adx < this.swingReach(tgt) + f.w * 0.5 + 20 && Math.abs(dy) < 90;
      if (threatens) {
        const r = Rng.next(), guard = (0.30 + lvl * 0.06) * SK;   // 9/21: was 0.22 + lvl*0.055. The measured blocked rate sat on the 8% floor of its target band in every iteration because this roll is the only way the CPU ever guards. At n=60 matches: blocked 7.7 -> 8.3%, entropy 3.64 -> 3.55, KO damage 99 -> 96%, score 81 -> 88 (dev/aaa/metrics/n60_*.json). Higher (0.40 + lvl*0.07) guards ~96% of threats and doubled the KOs under 12% damage, 3.6% -> 8.6%: see src/6c_shieldpush.js.
        if (r < guard) {
          const d2 = Rng.next();
          if (d2 < 0.12 && !f.air) { hold(['shield', 'down'], 3); return o; }        // spot-dodge
          if (d2 < 0.24) { o.shield = true; o[key(-dir)] = true; return o; }         // roll away
          if (d2 < 0.34) { o.shield = true; o[key(dir)] = true; return o; }          // roll through them
          hold(['shield'], irand(6, 16));                                            // hold the block
          return o;
        }
      }
    }
    // already blocking: punish out of shield the moment their move ends (Smash's shield-drop punish)
    if (S === 'shield') {
      if (ph === 'recovery' || !ph) {
        if (adx < range * 0.7 && Rng.next() < 0.5) { o.shield = true; press('attack'); return o; }   // shield-grab
        return null;
      }
      o.shield = true; return o;
    }

    // 2. PUNISH --------------------------------------------------------------
    // They are stuck in recovery. Free damage, and the moment a real player looks for.
    if (!f.air && ph === 'recovery' && adx < range * 1.05 && Math.abs(dy) < 70) {
      const left = this.recLeft(tgt);
      if (left >= 5 && Rng.next() < (0.35 + lvl * 0.07) * SK) {
        if (f.face !== dir) { o[key(dir)] = true; return o; }
        if (left >= 14 && tgt.dmg > 55) {                                // long whiff, they are cooked: smash it
          o[key(dir)] = true; hold(['smash', key(dir)], irand(8, 20)); this.used(f, 'fsmash'); return o;
        }
        if (left >= 10 && Rng.next() < 0.5) { o.up = true; press('attack'); this.used(f, 'utilt'); return o; }  // launcher -> juggle
        o[key(dir)] = true; press('attack'); this.used(f, 'ftilt'); return o;
      }
    }

    // 3. THROW ---------------------------------------------------------------
    // Blocking beats attacking, throws beat blocking. Without this the loop never closes.
    if (!f.air && (tgt.state === 'shield' || tgt.state === 'spot') && adx < range * 0.8) {
      if (Rng.next() < (0.55 + lvl * 0.04) * SK) {
        if (f.face !== dir) { o[key(dir)] = true; return o; }
        press('grab'); this.used(f, 'grab'); return o;
      }
    }

    // 5. PRESSURE ------------------------------------------------------------
    // Nobody has landed anything for a while: stop circling, walk in and swing.
    const stale = this.staleFrames();
    const pushy = stale > 110 ? Math.min(1, (stale - 110) / 160) : 0;

    // 4. SPACE ---------------------------------------------------------------
    if (f.air) {
      // Aerials, chosen by which one can actually reach them rather than by which way they are.
      // Measured before this check: fair 91% whiff, nair 83%, dair 79%.
      if (Rng.next() > (0.30 + lvl * 0.05 + pushy * 0.25) * SK) return null;
      const air = this.reachable(f, tgt, [
        { k: 'uair', w: dy < -30 ? 1.3 : 0.4 }, { k: 'dair', w: dy > 45 && f.y < M.top - 40 ? 1.2 : 0.2 },
        { k: 'fair', w: 1.0 }, { k: 'bair', w: 0.9 }, { k: 'nair', w: 0.8 },
      ], dir);
      if (!air.length) {                                   // nothing reaches: move, do not flail
        a.a2br = 'air-drift'; if (adx > 40) o[key(dir)] = true;
        if (dy < -60 && f.jumps > 0 && Rng.next() < 0.06) press('jump');
        return o;
      }
      const pickA = this.pick(f, air);
      if (!pickA) return o;
      if (pickA.k === 'uair') { o.up = true; press('attack'); return o; }
      if (pickA.k === 'dair') { o.down = true; press('attack'); return o; }
      if (pickA.k === 'fair') { if (f.face !== dir) o[key(dir)] = true; else o[key(dir)] = true; press('attack'); return o; }
      if (pickA.k === 'bair') { o[key(-dir)] = true; press('attack'); return o; }
      press('attack'); return o;                            // nair
    }

    // on the ground: what you throw out depends on how far away they are, not on a coin flip
    if (adx > range * 1.1) {
      // Out of range. Close the distance, or throw something that covers it — but a ranged special
      // is a commitment, not a twitch: without this cooldown the CPU fired one every few frames and
      // side-special became 25% of its whole offence (measured, iteration 01).
      const cool = Game.frame - (a.a2proj || -999);
      if (cool > 50 && Rng.next() < 0.05 + pushy * 0.12) {
        a.a2proj = Game.frame; o[key(dir)] = true; press('special'); this.used(f, 'sb'); return o;
      }
      if (f.face !== dir) { a.a2br = 'far-turn'; o[key(dir)] = true; return o; }
      a.a2br = 'far-walk'; o[key(dir)] = true;
      if (adx > range * 2.4 && Rng.next() < 0.03 + pushy * 0.12) press('jump');   // hop in instead of walking
      return o;
    }
    // They are well above us: that is an anti-air read, not a reason to jab at their feet.
    if (dy < -70) {
      const aa = this.reachable(f, tgt, [{ k: 'utilt', w: 1.0 }, { k: 'usmash', w: 0.8 }], dir);
      if (aa.length && Rng.next() < (0.3 + lvl * 0.05) * SK) {
        const p = this.pick(f, aa);
        o.up = true; press(p.k === 'usmash' ? 'smash' : 'attack'); return o;
      }
      if (Rng.next() < 0.05 + pushy * 0.1) { press('jump'); return o; }   // go up and meet them
      if (adx > 40) o[key(dir)] = true;
      return o;
    }
    // A big height gap — they are on a platform, or under one. The old brain kept swinging into it:
    // 95 swings a session, 92.6% missing. Position first; only attack if something genuinely reaches.
    if (Math.abs(dy) > 120) {
      const far = this.reachable(f, tgt, [{ k: 'utilt', w: 1 }, { k: 'usmash', w: 0.9 }, { k: 'sb', w: 0.5 }, { k: 'nb', w: 0.5 }], dir);
      if (far.length && Rng.next() < (0.25 + lvl * 0.04) * SK) {
        const p = this.pick(f, far);
        if (p.k === 'usmash') { o.up = true; press('smash'); return o; }
        if (p.k === 'utilt') { o.up = true; press('attack'); return o; }
        if (f.face !== dir) { o[key(dir)] = true; return o; }
        o[key(dir)] = true; press('special'); return o;
      }
      a.a2br = 'gap-move'; if (adx > 50) o[key(dir)] = true;              // get underneath them
      else if (dy < -120 && !f.air && Rng.next() < 0.05 + pushy * 0.12) press('jump');
      else if (dy > 120 && !f.air && f.plat && f.plat.soft && Rng.next() < 0.05) { o.down = true; press('jump'); }
      return o;
    }

    // Swinging the instant they are in range is why the whiff rate was 66%: real players wait for a
    // reason. Commit less on a target who is already attacking (they will beat us to it) and more on
    // one standing still, and never from the very edge of range where the tip barely reaches.
    const theirs = this.phase(tgt);
    let want = (0.20 + lvl * 0.035 + pushy * 0.3) * SK;
    if (theirs === 'startup' || theirs === 'active') want *= 0.35;     // respect their turn
    if (tgt.state === 'ground' && Math.abs(tgt.vx) < 0.4) want += 0.15; // they are sitting there
    if (adx > range) want *= 0.5;
    const commit = Rng.next() < want;
    if (!commit) {
      // spacing: drift in and out of their range instead of standing still (Tekken's backdash dance)
      if (adx < range * 0.5 && Rng.next() < 0.35) { a.a2br = 'space-back'; o[key(-dir)] = true; return o; }
      if (adx > range * 0.9) { a.a2br = 'space-in'; o[key(dir)] = true; return o; }
      return o;
    }
    if (f.face !== dir) { o[key(dir)] = true; return o; }

    const close = adx < range * 0.55, tip = adx > range * 0.9;
    const finish = tgt.dmg > 75;
    const opts = close ? [
      { k: 'jab', w: 1.0 }, { k: 'dtilt', w: 0.8 }, { k: 'grab', w: 0.9 },
      { k: 'utilt', w: 0.9 }, { k: 'dsmash', w: finish ? 0.8 : 0.3 }, { k: 'db', w: 0.4 },
    ] : tip ? [
      { k: 'ftilt', w: 1.0 }, { k: 'fsmash', w: finish ? 1.1 : 0.45 }, { k: 'sb', w: 0.35 },
      { k: 'dtilt', w: 0.5 }, { k: 'dash', w: 0.5 },
    ] : [
      { k: 'ftilt', w: 1.0 }, { k: 'jab', w: 0.55 }, { k: 'utilt', w: 0.6 },
      { k: 'fsmash', w: finish ? 1.0 : 0.35 }, { k: 'sb', w: 0.25 }, { k: 'grab', w: 0.45 }, { k: 'dtilt', w: 0.5 },
    ];
    // only from the moves that can actually reach them on the frame they go active
    const live = this.reachable(f, tgt, opts, dir);
    if (!live.length) {
      a.a2br = 'noreach-step'; if (adx > range * 0.6) o[key(dir)] = true;   // step into range instead of swinging
      else if (Rng.next() < 0.2) o[key(-dir)] = true;
      return o;
    }
    const choice = this.pick(f, live);
    if (!choice) return null;
    switch (choice.k) {
      case 'jab': press('attack'); return o;
      case 'ftilt': o[key(dir)] = true; press('attack'); return o;
      case 'utilt': o.up = true; press('attack'); return o;
      case 'dtilt': o.down = true; press('attack'); return o;
      case 'fsmash': o[key(dir)] = true; hold(['smash', key(dir)], irand(6, 22)); return o;
      case 'dsmash': o.down = true; press('smash'); return o;
      case 'grab': press('grab'); return o;
      case 'sb': o[key(dir)] = true; press('special'); return o;
      case 'db': o.down = true; press('special'); return o;
      case 'dash': o[key(dir)] = true; return o;
    }
    return o;
  },
};

// ---- special-move rate limit ---------------------------------------------------
// Roster-2 fighters get their showpiece specials from MV2.aiPick / aiMove (21_roster2), which sits
// inside the old brain and streams them: side-special alone was 28.1% of ALL offence at a 50% miss
// rate, and it is what the move-entropy metric keeps catching. A special every ~0.75s still reads as
// that fighter's identity; one every few frames reads as a CPU holding a button down.
// CPU only — a human pressing Special is never blocked.
Fighter.prototype.special = (function (base) {
  return function () {
    if (this.cpu && this.ai) this.ai.a2spec = Game.frame;
    return base.apply(this, arguments);
  };
})(Fighter.prototype.special);

if (typeof MV2 !== 'undefined' && MV2 && typeof MV2.aiPick === 'function') {
  MV2.aiPick = (function (base) {
    return function (f, tgt, o, press, ctx) {
      if (Game.combos && AI2.on && f.cpu && f.ai && Game.frame - (f.ai.a2spec || -999) < AI2.SPEC_COOL && Rng.next() < 0.75) return false;
      return base.apply(this, arguments);
    };
  })(MV2.aiPick);
}

AI.think = (function (base) {
  return function (f, st) {
    if (Game.combos && AI2.on) {                      // unseeded local matches only
      try {
        const o = AI2.think(f, st);
        // stamp who decided this frame, so dev/aaa/probe.js can tell which brain threw a move
        if (o) { f.ai.a2last = Game.frame; return o; }
      } catch (e) { /* fall back to the old brain */ }
    }
    return base.call(this, f, st);
  };
})(AI.think);
