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
