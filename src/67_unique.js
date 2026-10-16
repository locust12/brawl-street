// ===== one move nobody else has, for the fighters whose kit was interchangeable =====
//
// dev/stats_audit.js lists, per fighter, the mechanics nobody else uses. Eighteen fighters came back
// with "-- NOTHING UNIQUE --": their four specials were all built from the same shared builders as
// somebody else's. This file gives the most generic of them a signature move with a mechanic that
// exists nowhere else on the roster.
//
// GATED: every move goes into `c.moves2`, the local-match table (40_fighter.js reads it when
// Game.sigs is on), so the bet arena (ARENA.version 1) replays the old kits untouched. Fight code:
// seeded rand() only, never Math.random.
//
//   WHALE     db  MAELSTROM   a vortex that drags everyone on stage toward it (nothing else pulls)
//   BEAR      nb  MAUL        claw flurry that feeds on what it hits: the bear heals per hit
//   BULL      sb  STAMPEDE    a charge that gains armour and damage the further it runs
//   MOODENG   db  MUD WALLOW  leaves a mud patch that bogs down anyone who walks through it
//   CASHCAT   nb  COIN FLIP   a gamble: heads pays double, tails is a dud (seeded, so replays match)
//   MYSTIC    nb  HEX         marks them; the mark goes off on its own three seconds later
//   POPCAT    nb  POP         swallows a shot and spits it back bigger and faster
//   GIGACHAD  db  FLEX        a parry that leaves him pumped instead of hitting back
//   WOLVERINU --  THE WHOLE KIT. He is the lead of the key art and he gets the lead's moveset: see the
//                 block at the bottom of this file. Nobody else on the roster has a held sprint with
//                 three cancels out of it, a hanging hitbox, or a rage state.
{
  // ---- WHALE: MAELSTROM ----
  const w = CHAR_BY_ID.whale;
  if (w) {
    const MAELSTROM = {
      total: 78, clip: 'cast', fx: 'wave', color: '#5ad8ff', shout: 'MAELSTROM', sigText: 'WASHED OUT', sfx: 'none',
      hits: [H(40, 46, 0, -w.h * 0.5, 96, 12, 70, 44, 78, { radial: true, after: SIG })],
      tick(f, t) {
        f.vx *= 0.8; if (f.air) f.vy = Math.min(f.vy, 1.4);
        if (t === 6) { Sfx.tone(120, 700, 0.45, 'sine', 0.1); Game.shake(6); }
        if (t < 10 || t > 40) return;
        for (const v of Game.fighters) {                       // the pull itself
          if (v === f || v.state === 'dead' || v.untouchable || v.state === 'grabbed') continue;
          const dx = f.x - v.x, dy = (f.y - f.h * 0.5) - (v.y - v.h * 0.5), d = dhypot(dx, dy);
          if (d > 420 || d < 4) continue;
          const k = (1 - d / 420) * 0.9;
          v.vx += (dx / d) * k * 2.4; v.vy += (dy / d) * k * 1.5;
          if (!v.air && Math.abs(v.vx) > 6) v.vx *= 0.94;
        }
        if (t % 3 === 0) for (const s of [-1, 1]) Game.parts.push({ x: f.x + s * rand(120, 300), y: f.y - rand(10, 90), vx: -s * rand(3, 6), vy: rand(-1, 1), life: 18, max: 18, color: '#9fe8ff', size: rand(6, 12), g: 0, soft: true });
      },
    };
    w.moves2 = Object.assign({}, w.moves, { db: MAELSTROM });
  }
}
{
  // ---- BEAR: MAUL (the only life-steal on the roster) ----
  const b = CHAR_BY_ID.bear;
  if (b) {
    const FEED = (a) => { if (a.dmg > 0) { a.dmg = Math.max(0, a.dmg - 0.9); a.flashT = 4; } };
    const MAUL = {
      total: 54, clip: 'punch', fx: 'rush', color: '#c8503a', shout: 'MAUL', sfx: 'none',
      hits: [
        H(10, 12, b.w * 0.5 + 14, -b.h * 0.55, 30, 2.6, 70, 16, 12, { after: (a, v, hb) => { LINK(a, v, hb); FEED(a); } }),
        H(16, 18, b.w * 0.5 + 18, -b.h * 0.45, 30, 2.6, 70, 16, 12, { after: (a, v, hb) => { LINK(a, v, hb); FEED(a); } }),
        H(22, 24, b.w * 0.5 + 20, -b.h * 0.5, 32, 2.8, 70, 16, 12, { after: (a, v, hb) => { LINK(a, v, hb); FEED(a); } }),
        fin(H(30, 34, b.w * 0.5 + 24, -b.h * 0.5, 36, 9, 42, 46, 88, { after: (a, v) => { FEED(a); FEED(a); } })),
      ],
      tick(f, t) {
        if (f.air) f.vy = Math.min(f.vy, 1.6);
        if (t <= 34) { f.vx = approach(f.vx, f.face * 3.4, 0.6); if (t % 6 === 0) Sfx.swing(); } else f.vx *= 0.86;
      },
    };
    b.moves2 = Object.assign({}, b.moves, { nb: MAUL });
  }
}
{
  // ---- BULL: STAMPEDE (armour and damage build with the distance run) ----
  const u = CHAR_BY_ID.bull;
  if (u) {
    const STAMPEDE = {
      total: 86, clip: 'flykick', fx: 'blitz', color: '#3ec46d', shout: 'STAMPEDE', sigText: 'FLATTENED',
      airOnce: 'side', armor: 40, armorF: [8, 60], sfx: 'none',
      hits: [H(10, 60, u.w * 0.5 + 8, -u.h * 0.5, 34, 9, 40, 40, 78, { rehit: 18, after: SIG })],
      tick(f, t) {
        if (t < 8) { f.vx *= 0.82; if (t === 2) { Sfx.tone(90, 420, 0.4, 'sawtooth', 0.12); Game.shake(5); } return; }
        if (t <= 60) {
          f.run = Math.min(60, (f.run || 0) + 1);                   // how long the charge has been going
          const k = f.run / 60;
          f.vx = f.face * (8 + 9 * k);
          if (f.air) f.vy = Math.min(f.vy, 1.1);
          const hb = f.move.def.hits[0];
          hb.dmg = 9 + 8 * k; hb.kbg = 78 + 40 * k;                 // it hurts more the longer it runs
          if (t % 4 === 0) Game.parts.push({ x: f.x - f.face * u.w * 0.5, y: f.y - rand(0, 10), vx: -f.face * rand(1, 3), vy: rand(-2, 0), life: 20, max: 20, color: t % 8 ? '#cdb28a' : '#efe0c0', size: rand(8, 16), g: 0.2, soft: true });
          // it stops at the ledge instead of running itself off the stage
          const M = Game.stage.main, ahead = f.face > 0 ? M.x1 - f.x : f.x - M.x0;
          if (!f.air && ahead < 40) { f.vx *= 0.4; f.move.t = 62; }
        } else { f.vx *= 0.84; f.run = 0; }
      },
      start(f) { f.run = 0; },
    };
    u.moves2 = Object.assign({}, u.moves, { sb: STAMPEDE });
  }
}
{
  // ---- MOODENG: MUD WALLOW (the only ground hazard a fighter can lay down) ----
  const m = CHAR_BY_ID.moodeng;
  if (m) {
    const MUD = {
      total: 52, clip: 'slam', fx: 'pound', color: '#7a5a3a', shout: 'WALLOW', sfx: 'none',
      hits: [H(14, 18, 0, -8, 52, 7, 50, 34, 52, { radial: true })],
      tick(f, t) {
        if (t < 12) { f.vx *= 0.7; if (f.air) f.vy = Math.max(f.vy, 8); return; }
        if (t === 14) {
          Game.shake(9); Sfx.hit(0.6); Game.shock(f.x, f.y, '#8a6a46');
          for (const s of [-1, 1]) MV2.spawn(f, { kind: 'mud', vx: s * 2.2, vy: 0, grav: 0, r: 30, dmg: 0.4, ang: 20, bkb: 0, kbg: 0,
            life: 260, step: true, crawl: true, speed: 0.0001, pierce: true, rehit: 12, color: '#7a5a3a',
            after: (p, v) => { v.vx *= 0.45; if (!v.air) { v.vy = 0; } } }, 6 * s, 6);
          for (let i = 0; i < 12; i++) Game.parts.push({ x: f.x + rand(-40, 40), y: f.y - rand(0, 10), vx: rand(-3, 3), vy: rand(-5, -1), life: 26, max: 26, color: i % 3 ? '#6a4a2a' : '#8a6a46', size: rand(7, 14), g: 0.3, soft: true });
        }
        f.vx *= 0.8;
      },
    };
    m.moves2 = Object.assign({}, m.moves, { db: MUD });
  }
}
{
  // ---- CASHCAT: COIN FLIP (the only gamble; seeded, so a replay always flips the same) ----
  const c = CHAR_BY_ID.cashcat;
  if (c) {
    const FLIP = {
      total: 46, clip: 'cast', shout: 'CALL IT', sigText: 'JACKPOT', sfx: 'none',
      tick(f, t) {
        if (f.air) f.vy = Math.min(f.vy, 1.4);
        f.vx *= 0.86;
        if (t === 4) Sfx.coin();
        if (t !== 18) return;
        const heads = irand(0, 1) === 0;                              // seeded: the arena never runs this anyway
        Game.text(f.x, f.y - f.h - 26, heads ? 'HEADS' : 'TAILS', heads ? '#ffd23f' : '#9fa4b4', 1.3);
        MV2.spawn(f, heads
          ? { kind: 'cash', vx: 11, vy: -1.5, grav: 0.16, r: 20, dmg: 14, ang: 48, bkb: 42, kbg: 84, life: 70, big: true, color: '#ffd23f', after: SIG }
          : { kind: 'cash', vx: 8, vy: -1, grav: 0.3, r: 12, dmg: 3, ang: 30, bkb: 12, kbg: 20, life: 44, color: '#9fa4b4' },
          c.w * 0.5 + 10, c.h * 0.6);
        if (heads) { Game.flashT = Math.max(Game.flashT, 3); Sfx.coin(); }
      },
    };
    c.moves2 = Object.assign({}, c.moves, { nb: FLIP });
  }
}
{
  // ---- MYSTIC: HEX (the only delayed damage; STATUS.hex in 65_balance ticks it) ----
  const y = CHAR_BY_ID.mystic;
  if (y) {
    const HEX = {
      total: 44, clip: 'cast', fx: 'confuse', color: '#c9a6ff', shout: 'HEXED', sfx: 'none',
      hits: [H(14, 20, y.w * 0.5 + 26, -y.h * 0.5, 34, 4, 60, 18, 20, { after: (a, v) => {
        STATUS.hex(v, a, 180);
        Game.text(v.x, v.y - v.h - 20, 'MARKED', '#c9a6ff', 1.1); Game.ring(v.x, v.y - v.h * 0.5, '#c9a6ff', 64);
      } })],
      tick(f, t) { if (f.air) f.vy = Math.min(f.vy, 1.5); f.vx *= 0.84; if (t === 6) Sfx.tone(680, 220, 0.12, 'sine', 0.07); },
    };
    y.moves2 = Object.assign({}, y.moves, { nb: HEX });
  }
}
{
  // ---- POPCAT: POP (swallow a shot, spit it back bigger - the only projectile eater) ----
  const p = CHAR_BY_ID.popcat;
  if (p) {
    const POP = {
      total: 46, clip: 'cast', fx: 'inhale', color: '#ffd23f', shout: 'POP', sfx: 'none',
      reflect: [6, 30], reflectGain: 1.8,
      hits: [H(32, 36, p.w * 0.5 + 16, -p.h * 0.5, 34, 7, 55, 34, 60)],
      tick(f, t) { if (f.air) f.vy = Math.min(f.vy, 1.3); f.vx *= 0.8; if (t === 6) Sfx.tone(520, 120, 0.1, 'sine', 0.08); if (t === 32) Sfx.tone(900, 90, 0.12, 'square', 0.1); },
    };
    p.moves2 = Object.assign({}, p.moves, { nb: POP });
  }
}
{
  // ---- GIGACHAD: FLEX (a parry that pumps him instead of hitting back) ----
  const g = CHAR_BY_ID.gigachad;
  if (g) {
    const FLEXED = {
      total: 30, clip: 'taunt', sfx: 'none',
      start(f) {
        f.powerT = Math.max(f.powerT || 0, 300);                      // the same buff the Pump Pill gives
        Game.text(f.x, f.y - f.h - 30, 'FLEXED', '#ffd23f', 1.5); Game.ring(f.x, f.y - f.h * 0.5, '#ffd23f', 90);
        Game.flashT = Math.max(Game.flashT, 3); Game.shake(8); Sfx.tone(160, 420, 0.4, 'square', 0.12);
      },
      tick(f) { f.fric(0.8); },
    };
    const FLEX = {
      total: 46, clip: 'block', fx: 'barrier', color: '#ffd23f', shout: 'WATCH THIS', sfx: 'shield',
      counter: [4, 24], counterHit: { mult: 0.6, min: 4, ang: 40, bkb: 30, kbg: 40, shout: 'FLEX', def: FLEXED },
      tick(f) { f.fric(0.82); if (f.air) f.vy = Math.min(f.vy, 1.2); },
    };
    g.moves2 = Object.assign({}, g.moves, { db: FLEX });
  }
}
{
  // ================================ WOLVERINU: the lead's kit ====================================
  // 2026-10-15. He is the front of the hero key art and the partner character, and he played like a
  // reskin: his four specials were mkDash / mkRise / mkSlam with VOLT's numbers and a different
  // colour, so "the main character" picked up the pad and did exactly what DOGE does. The 10/13 pass
  // gave him claw normals (6g_styles) and ONE unique special (CROSS RAKE, below). This is the rest:
  // all four slots, a rage state, and a passive, built around the one thing the model actually has.
  //
  //   nb  CROSS RAKE   an X cut that HANGS in the air where it was made and keeps cutting (kept)
  //   sb  PROWL        a HELD sprint -- the roster's only one -- with three cancels out of it:
  //                      Attack -> SHRED    a four-cut crossing flurry that carries forward
  //                      Special-> POUNCE   a leap into a claws-first dive spike
  //                      Down   -> SLIDE    a low claw slide that ducks high attacks and trips
  //                      Shield -> a hard skid, so the sprint is a neutral tool and not a commitment
  //                    running THROUGH his own hanging X detonates it (the kit's one combination)
  //   ub  CLIMB        a vertical claw rip, and Attack at the apex drops him straight back down as
  //                    PLUNGE instead of leaving him helpless
  //   db  FERAL        ground: he drives both claws into the deck, splits it, and goes feral for 5 s
  //                    air:    PLUNGE, the claws-first meteor
  //
  // Every number here is local-match only (c.moves2, read by 40_fighter when Game.sigs is on), so the
  // bet arena at ARENA.version 1 and online lockstep replay the old kit untouched. Seeded rand() only.
  // Energy is CIRCUIT green, never lightning -- lightning is VOLT's (see [[wolverinu-claw-set]]).
  const wv = CHAR_BY_ID.wolverinu;
  if (wv) {
    const CIRC = '#9bf000';        // circuit green: his claws, his trails, his waves
    const HOT = '#eaffb0';         // what the claws burn to while he is feral
    const FW = wv.w * 0.5;         // half-width, i.e. the front of the body
    const FH = wv.h;

    // the closest live opponent within `d` px, or null. No RNG: the CPU's cancels have to replay.
    const near = (f, d) => {
      let best = null, bd = d;
      for (const g of Game.fighters) {
        if (g === f || g.state === 'dead' || g.untouchable) continue;
        const dx = Math.abs(g.x - f.x);
        if (dx < bd && Math.abs(g.y - f.y) < 100) { bd = dx; best = g; }
      }
      return best;
    };
    // claw dust off the deck: one spark per call, his colour, cheap
    const spark = (f, x, y, n, c) => {
      for (let i = 0; i < n; i++) Game.parts.push({ x: x + rand(-10, 10), y: y - rand(0, 10), vx: -f.face * rand(1, 5), vy: rand(-3.4, -0.4),
        life: 20, max: 20, color: i % 3 ? (c || CIRC) : '#ffffff', size: rand(3, 7), g: 0.12 });
    };
    const WAVES = (f, dmg) => {
      const w = Object.assign({}, WAVE_ROCK, { color: CIRC, dmg });
      MV2.wave(f, 1, w); MV2.wave(f, -1, w);
      Game.shock(f.x, f.y, CIRC);
    };

    // ---------------------------------------------------------------------------------------------
    // nb  CROSS RAKE -- the only hitbox on the roster a fighter leaves standing and walks away from.
    // Every other projectile MOVES (coin, bone, bolt, star, flame) or sits on the deck (MOODENG's
    // mud). This one is the CUT ITSELF: he slashes an X in front of him and the X stays where it was
    // made for 1.3 s, cutting anyone who walks into it every 18 frames, while he is free to keep
    // pressing. It is his wall: he fences a lane off, then forces them through it with PROWL -- and
    // running through it himself sets it off. One at a time so he can never fence the stage; two
    // while he is feral, because that is what the rage state is for.
    const CUT = (p, v) => { Game.burst(v.x, v.y - v.h * 0.5, p.color || CIRC, 8); Sfx.swing(); };
    const XRAKE = {
      total: 42, clip: 'punch', fx: 'slash', color: CIRC, weapon: CIRC, shout: 'CROSS RAKE', sfx: 'none',
      hits: [
        H(7, 9, FW + 20, -FH * 0.58, 26, 4.2, 58, 16, 20, { after: LINK }),   // the first arc keeps them there
        fin(H(12, 14, FW + 24, -FH * 0.44, 28, 5.8, 38, 24, 48)),             // the second crosses it
      ],
      tick(f, t) {
        if (f.air) f.vy = Math.min(f.vy, 1.6);
        if (t <= 14) f.vx = approach(f.vx, f.face * 2.6, 0.5); else f.vx *= 0.84;
        if (t === 7 || t === 12) Sfx.swing();
        if (t !== 16 || Game.projCount(f, 'rake') >= (f.feralT > 0 ? 2 : 1)) return;
        const hot = f.feralT > 0;
        MV2.spawn(f, {
          // 2.8 every 18 frames over 72 is four cuts at most, and only if they stand in it: measured
          // 26 damage at 3.2/16/78 with the victim pinned inside, which is more than the move is worth
          kind: 'rake', vx: 0, vy: 0, grav: 0, r: 34, dmg: hot ? 3.2 : 2.8, ang: 36, bkb: 14, kbg: 24,
          life: 72, pierce: true, rehit: 18, noReflect: true, color: hot ? HOT : CIRC, after: CUT,
        }, FW + 34, FH * 0.52);
        Game.ring(f.x + f.face * (FW + 34), f.y - FH * 0.52, hot ? HOT : CIRC, 64);
        Sfx.tone(2200, 520, 0.14, 'sawtooth', 0.07);
      },
    };
    // he ran through his own X: it goes off instead of waiting to be walked into
    const BURST_X = (f) => {
      for (const p of Game.projs) {
        if (p.owner !== f || p.kind !== 'rake' || p.burst) continue;
        if (Math.abs(p.x - f.x) > 70 || Math.abs(p.y - (f.y - FH * 0.5)) > 80) continue;
        p.burst = true;
        p.r = 62; p.dmg = 9.5; p.ang = 46; p.bkb = 40; p.kbg = 78; p.rehit = 0; p.hitT = null; p.hitSet = null;
        p.life = p.age + 7; p.color = HOT;
        Game.ring(p.x, p.y, HOT, 170); Game.burst(p.x, p.y, CIRC, 20); Game.shake(9);
        Game.flashT = Math.max(Game.flashT, 3); Sfx.tone(1500, 420, 0.2, 'sawtooth', 0.11);
        return true;
      }
      return false;
    };

    // ---------------------------------------------------------------------------------------------
    // the three cancels out of the sprint. Declared before PROWL so its tick can name them.
    //
    // SHRED: the payoff. Four cuts that cross each other, the first three link the victim in front of
    // him and the last one launches with the signature freeze. 16.6 damage if the whole string lands,
    // which is what a committed four-hit string off a sprint is worth.
    const SHRED = {
      total: 40, clip: 'punch', fx: 'slash', color: CIRC, weapon: CIRC, shout: 'SHRED', sigText: 'SHREDDED', sfx: 'none',
      hits: [
        H(3, 4, FW + 18, -FH * 0.62, 26, 2.8, 30, 10, 14, { after: LINK }),
        H(7, 8, FW + 22, -FH * 0.40, 26, 2.8, 22, 10, 14, { after: LINK }),
        H(11, 12, FW + 25, -FH * 0.58, 27, 3.2, 34, 12, 16, { after: LINK }),
        fin(H(16, 19, FW + 30, -FH * 0.50, 33, 7.8, 46, 36, 94, { after: SIG })),
      ],
      tick(f, t) {
        if (f.air) f.vy = Math.min(f.vy, 1.4);
        if (t <= 19) f.vx = approach(f.vx, f.face * 7.5, 0.9); else f.vx *= 0.82;
        if (t === 3 || t === 7 || t === 11) { Sfx.swing(); spark(f, f.x + f.face * (FW + 22), f.y - FH * 0.5, 3); }
        if (t === 16) { Sfx.swing(); Game.shake(5); }
      },
    };
    // POUNCE: the leap. A real spike in the air, and the landing cracks the deck.
    const POUNCE_LAND = {
      total: 24, clip: 'slam', fx: 'slash', color: CIRC, weapon: CIRC, sfx: 'none',
      hits: [H(1, 5, 0, -14, 58, 7.5, 62, 48, 46, { radial: true })],
      start(f) { WAVES(f, 5); Game.shake(11); Sfx.hit(0.7); spark(f, f.x, f.y, 10); },
      tick(f) { f.fric(0.7); },
    };
    const POUNCE = {
      total: 150, clip: 'flykick', fx: 'dive', color: CIRC, weapon: CIRC, shout: 'POUNCE', sfx: 'none',
      hits: [H(6, 149, FW * 0.45, -FH * 0.3, 30, 11.5, -74, 26, 80)],
      tick(f, t) {
        if (t === 2) { f.vy = -12.8; f.vx = f.face * 12.5; Sfx.jump(); spark(f, f.x, f.y, 8); return; }
        if (t < 14) { f.vx = f.face * 12.5; return; }            // the leap arc, gravity does the rest
        f.vy = f.vy < 7 ? f.vy + 2.8 : 17;                       // then the claws come down
        f.vx = approach(f.vx, f.face * 6.5, 0.5);
        if (t % 3 === 0) spark(f, f.x, f.y - FH * 0.4, 1);
      },
      onLand(f) { f.startMove(POUNCE_LAND); },
    };
    // SLIDE: the low option. f.crouch is re-cleared by Fighter.update every frame, so setting it here
    // holds the hurtbox down for exactly as long as the slide runs -- he goes UNDER a high attack, and
    // (27_tekken TK.ducks) he cannot be thrown out of it either.
    const SLIDE = {
      total: 34, clip: 'sweep', fx: 'slash', color: CIRC, weapon: CIRC, shout: 'SLIDE', sfx: 'none',
      hits: [H(3, 20, FW + 24, -9, 23, 6.5, 12, 22, 54, { after: TRIP(24) })],
      start(f) { Sfx.slide(); Sfx.noise(0.22, 0.1, 1600); },
      tick(f, t) {
        f.crouch = true;
        if (t <= 20) { f.vx = f.face * (14.5 - t * 0.34); if (!f.air) f.vy = 0; if (t % 3 === 0) spark(f, f.x - f.face * 10, f.y, 2, '#cfd8c0'); }
        else f.vx *= 0.72;
      },
    };

    // ---------------------------------------------------------------------------------------------
    // sb  PROWL -- the held sprint, and the thing that makes him the fastest closer in the game.
    //
    // Everyone else's side special is a fixed-length dash: it travels a set distance and ends. This
    // one is a STATE. He drops onto the claws, runs at 17.5 and keeps accelerating to ~21 (23 feral),
    // can turn around mid-run, and stays in it for 46 frames (62 feral) or until the player cancels.
    // The run clip is the rig's own `run`, so he visibly runs rather than sliding with a hitbox on.
    // The body check is deliberately weak (3.2, almost no knockback, re-hits every 14 frames): the
    // damage is in what you cancel into, which is the whole point of giving him three exits.
    const PROWL = {
      total: 72, airOnce: 'side', clip: 'run', fx: 'prowl', color: CIRC, weapon: CIRC, shout: 'PROWL', sfx: 'none',
      hits: [H(6, 62, FW + 6, -FH * 0.45, 25, 3.2, 30, 10, 16, { rehit: 14, after: LINK })],
      start(f) {
        f.move.lim = f.feralT > 0 ? 62 : 46;
        Sfx.tone(260, 220, 0.16, 'sawtooth', 0.08);
      },
      tick(f, t) {
        const mv = f.move, lim = mv.lim || 46;
        if (t <= 4) { f.vx *= 0.66; f.crouch = !f.air; if (t === 4) spark(f, f.x, f.y, 5); return; }
        if (t > lim) { f.vx *= 0.74; return; }                 // the skid out

        // steer: a held direction turns him, so the sprint is not a one-way commitment
        const dx = f.dirX();
        if (dx && dx !== f.face && t > 8) { f.face = dx; f.vx *= 0.4; spark(f, f.x, f.y, 4); }
        const top = (f.feralT > 0 ? 20.5 : 17.5) + Math.min(3.2, (t - 5) * 0.14);
        f.vx = f.face * top;
        if (f.air) f.vy = Math.min(f.vy, 1.5); else f.vy = 0;

        // the cancels. Checked before anything else can end the move, and only once he is actually
        // running, so a tap of Special+direction can never come out as an instant SHRED.
        if (t >= 8) {
          if (f.pressed('attack')) return f.startMove(SHRED);
          if (f.pressed('special')) return f.startMove(POUNCE);
          if (f.pressed('down') && !f.air) return f.startMove(SLIDE);
          if (f.pressed('shield')) { mv.t = lim + 1; f.vx *= 0.45; spark(f, f.x, f.y, 6); return; }
          // the CPU runs the same kit: close the gap, then pick an exit the way a player would --
          // pounce at someone above him, slide under a shield, shred everything else. Seeded Rng,
          // like the rest of the AI, so a replay takes the same exits.
          if (f.cpu && t >= 12) {
            const g = near(f, 92);
            if (g && g.air && g.y < f.y - 36) return f.startMove(POUNCE);
            if (g && (g.state === 'shield' || Rng.next() < 0.22) && !f.air) return f.startMove(SLIDE);
            if (g) return f.startMove(SHRED);
          }
        }
        // his own hanging X, detonated by running through it
        if (t % 2 === 0) BURST_X(f);
        // never runs itself off the deck (BULL's STAMPEDE rule, extended to platforms)
        if (!f.air) {
          const p = f.plat, M = Game.stage.main;
          const x0 = p ? p.x0 : M.x0, x1 = p ? p.x1 : M.x1;
          if ((f.face > 0 ? x1 - f.x : f.x - x0) < 46) { f.vx *= 0.3; mv.t = lim; }
        }
        // claw gouges and afterimages
        if (t % 2 === 0) spark(f, f.x - f.face * FW * 0.6, f.y, 1, f.feralT > 0 ? HOT : CIRC);
        if (t % 3 === 0) Game.parts.push({ x: f.x - f.face * 6, y: f.y - FH * 0.5, vx: 0, vy: 0, life: 14, max: 14,
          color: f.feralT > 0 ? HOT : CIRC, size: 13, g: 0, soft: true });
        if (t % 8 === 0) Sfx.tone(180, 90, 0.07, 'sawtooth', 0.05);
      },
    };
    // In the air there is no sprint to hold: a short claws-out air dash instead, once per jump. No
    // `shout` of its own on purpose -- split2 keeps PROWL's on the outer def, so either version calls
    // out once and the select-screen strip (8d_movehint) reads "Prowl" for the slot.
    const AIRCUT = Object.assign(mkDash({ total: 34, a: 5, b: 15, speed: 17, hit: H(0, 0, FW + 24, -FH * 0.5, 31, 9.5, 40, 36, 86) }),
      { clip: 'flykick', fx: 'slash', weapon: CIRC, color: CIRC });

    // ---------------------------------------------------------------------------------------------
    // db air / ub apex  PLUNGE -- the claws-first meteor. One def, two ways in.
    const PLUNGE_LAND = {
      total: 26, clip: 'slam', fx: 'slash', color: CIRC, weapon: CIRC, sfx: 'none',
      hits: [H(1, 5, 0, -14, 64, 8.5, 60, 50, 48, { radial: true })],
      start(f) { WAVES(f, 6); Game.shake(14); Game.flashT = Math.max(Game.flashT, 3); Sfx.hit(0.85); spark(f, f.x, f.y, 14); },
      tick(f) { f.fric(0.66); },
    };
    const PLUNGE = {
      total: 150, clip: 'slam', fx: 'dive', color: CIRC, weapon: CIRC, shout: 'PLUNGE', sfx: 'none',
      hits: [H(5, 149, 0, 6, 29, 12.5, -82, 26, 84)],
      tick(f, t) {
        if (t < 5) { f.vy = -3; f.vx *= 0.5; return; }
        f.vy = 19; f.vx = approach(f.vx, f.dirX() * 3.4, 0.4);
        if (t % 2 === 0) spark(f, f.x, f.y - FH * 0.3, 1);
      },
      onLand(f) { f.startMove(PLUNGE_LAND); },
    };

    // ---------------------------------------------------------------------------------------------
    // ub  CLIMB -- he hooks the claws and rips straight up, a tight multi-hit spiral with a real
    // finisher on it, and Attack from frame 24 drops him out of it as PLUNGE. Every other recovery on
    // the roster leaves you helpless with nothing to decide; this one asks a question on the way down.
    const CLIMB = {
      total: 54, helpless: true, airOnce: 'up', clip: 'spin', fx: 'spin', color: CIRC, weapon: CIRC, shout: 'CLIMB', sfx: 'jump',
      hits: [
        H(4, 28, 0, -FH * 0.62, 42, 2.6, 86, 28, 13, { rehit: 5, radial: true }),
        fin(H(29, 33, 0, -FH * 0.66, 47, 6.8, 68, 46, 96, { radial: true })),
      ],
      tick(f, t) {
        if (t === 3) { f.vy = -13.8; Sfx.swing(); }
        else if (t > 3 && t <= 24) f.vy = Math.min(f.vy, -11.4);          // held rise, taller than the old spin
        if (t >= 3) f.vx = lerp(f.vx, f.dirX() * 4.8, 0.16);
        if (t >= 3 && t < 30 && t % 2 === 0) Game.parts.push({ x: f.x + rand(-14, 14), y: f.y - rand(0, FH), vx: rand(-1, 1), vy: rand(1, 3),
          life: 16, max: 16, color: f.feralT > 0 ? HOT : CIRC, size: rand(5, 9), g: 0, soft: true });
        if (t >= 24 && f.pressed('attack')) return f.startMove(PLUNGE);   // bail out of the spin, claws down
      },
    };

    // ---------------------------------------------------------------------------------------------
    // db ground  FERAL -- the rage state, and the reason to pick him.
    //
    // Nobody else on the roster transforms. He plants both claws in the deck, splits it two ways (the
    // GROUND SPLIT motif his grapple finishes on), and for five seconds the claws burn: +15% on
    // everything he lands, a longer and faster PROWL, and two hanging X cuts instead of one. It is 22
    // frames of armour and then 24 frames of nothing, so it is a read and not a free press, and the
    // buff is on a 9 s cooldown -- the crack and the waves still come out meanwhile, so the press is
    // never dead.
    const FERAL = {
      total: 48, clip: 'slam', fx: 'pound', color: CIRC, weapon: CIRC, shout: 'FERAL', sfx: 'none',
      armor: 42, armorF: [4, 22],
      hits: [H(16, 20, 0, -12, 56, 7, 56, 38, 56, { radial: true })],
      tick(f, t) {
        f.vx *= 0.72;
        if (f.air) f.vy = Math.max(f.vy, 9);
        if (t === 6) { Sfx.tone(90, 420, 0.4, 'sawtooth', 0.12); spark(f, f.x, f.y, 6); }
        if (t === 16) { WAVES(f, 6); Game.shake(12); }
        if (t !== 20) return;
        if (f.feralCd > 0) return;                       // still cooling: the crack landed, the rage does not
        f.feralT = 300; f.feralCd = 540;
        Game.text(f.x, f.y - FH - 34, 'FERAL', HOT, 1.7);
        Game.rings.push({ x: f.x, y: f.y - FH * 0.5, r: 12, max: 200, color: HOT, life: 20, w: 12 });
        Game.burst(f.x, f.y - FH * 0.5, HOT, 24);
        Game.flashT = Math.max(Game.flashT, 5); Game.shake(16);
        Sfx.tone(150, 620, 0.42, 'sawtooth', 0.13);
      },
    };

    wv.moves2 = Object.assign({}, wv.moves, {
      nb: XRAKE,
      sb: split2(PROWL, AIRCUT),
      ub: CLIMB,
      db: { ground: FERAL, air: PLUNGE },
    });
  }
}
{
  // ---- WOLVERINU: the FERAL state itself ----
  // Two hooks, both no-ops for every other fighter and for every seeded fight: `feralT` is only ever
  // set by the db above, which only exists in moves2. 66_traits wrapped these first, so this sits
  // outside its wrappers and its multiplier compounds with the profile's -- which is intended, the
  // rage state is supposed to be felt.
  const up0 = Fighter.prototype.update;
  Fighter.prototype.update = function (stage) {
    const r = up0.call(this, stage);
    if (this.feralCd > 0) this.feralCd--;
    if (this.state === 'dead') { this.feralT = 0; return r; }   // a stock lost ends the rage
    if (!(this.feralT > 0) || this.hitlag > 0) return r;
    this.feralT--;
    if (this.t % 2 === 0) Game.parts.push({ x: this.x + rand(-this.w * 0.5, this.w * 0.5), y: this.y - rand(0, this.h * 1.05),
      vx: rand(-0.5, 0.5), vy: rand(-3.4, -1.2), life: 20, max: 20, color: this.t % 5 ? '#9bf000' : '#eaffb0', size: rand(4, 8), g: 0 });
    if (this.feralT === 0) Game.text(this.x, this.y - this.h - 20, 'CALM', '#8c9a86', 0.9);
    return r;
  };
  const take0 = Fighter.prototype.takeHit;
  Fighter.prototype.takeHit = function (hb, att, mult, srcX, srcFace) {
    if (att && att !== this && att.feralT > 0) mult = (mult || 1) * 1.15;
    return take0.call(this, hb, att, mult, srcX, srcFace);
  };
}
