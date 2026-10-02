// ===== grapples: Attack + Special = a close-range command grab into a signature throw =====
// Not a roster file: named 2x_ so build.py and net/tools/build-engine.js pull it into the headless
// fight engines with the fighters (it loads before 40_fighter.js, so it only defines data and
// functions; the engine hooks call in at run time).
//
// Rules v2, like 23_combo.js: the three hooks that can start a grapple (40_fighter groundAct and
// moveUpdate, 50_ai think) run only while Game.combos is on. Game.start turns that on for unseeded
// local matches only, so seeded fights (bet arena at ARENA.version 1, online) play exactly as before.
// Fight code here uses the seeded Rng and dsin/dcos only; the touch button at the bottom is page-only.
//
// Input: Attack + Special on the same frame, or the partner press up to 3 frames after the first one
// (the jab or special the first press started turns into the grapple). Grounded fighters only.
// The grab: a short lunge whose box catches a grounded fighter on frames 5-10. It reuses the MV2
// command-grab machinery (21_roster2): MV2.catch holds the victim, MV2.hold positions it, and the
// engine's existing hooks let go when the grabber is hit (takeHit -> MV2.drop) or KO'd (Game.ko).
// Like the MV2 command grabs it beats shields and counters; it whiffs on airborne fighters; two
// grapples that meet on the same frame CLASH and push both fighters apart.
// The throw: a chain of hold moves (holdVictim) built from the fighter's data the first time it is used:
//   c.grapple (any roster file can give its fighter one), else GRAPPLE.NAMED[c.id], else
//   GRAPPLE.DEFAULT (a 3-hit hold combo plus a throw shaped by weight), so fighters added later by new
//   2x_ roster files get one automatically.
// Stage options (see GRAPPLE.stage):
//   n: frames   clip: animation clip   fx/color: 3D effect (visual only)   shout: text on entry
//   swallow / vanish: MV2 flags (victim hidden inside the grabber / grabber hidden on those frames)
//   hold: victim offset in clinch units, x 1 = touching in front, y -1 = one grabber-height up:
//         [x, y] | [[x0, y0], [x1, y1]] eased over `ease` frames (default n) | (f, v, k, t) => [x, y] | null (leave it)
//   hit: [[t, dmg], ...]   damage while held; the victim stays held and the combo counter keeps counting
//   toss: { at, dmg, ang, bkb, kbg, ground, back, shake }   the release: fixed damage and launch
//   go(f, t, G): scripted motion / effects (the grabber stands still otherwise)
//   air: true   a jump stage: landing starts the next stage (soft platforms can't be dropped through)
const GRAPPLE = {
  CAN: ['ground', 'shield', 'move', 'land', 'jumpsquat', 'dizzy'],   // grounded states a grapple can catch
  n: { tries: 0, catches: 0, clashes: 0, backs: 0 },                 // counters for tests; nothing reads them
  cache: new Map(),                                                   // char -> built sequence

  // ---- input (hooks in 40_fighter.js) ----
  // groundAct, before the special / attack checks: both buttons on this frame. It also stamps the frame
  // of a lone Attack / Special press, so late() only converts a move that press started (not one from the
  // Smash button, a combo cancel, a jump squat or a shield).
  input(f) {
    const a = f.pressed('attack'), s = f.pressed('special');
    if (a) f.gAtk = Game.frame;
    if (s) f.gSpc = Game.frame;
    if (f.finalReady || !a || !s) return false;
    return GRAPPLE.start(f);
  },
  // moveUpdate, while a move is on its first 3 frames: the partner button arrived late
  late(f) {
    if (TK.late(f)) return true;   // E then R inside the pair window: the command throw (27_tekken)
    const mv = f.move, d = mv.def.base || mv.def, m = f.m, fr = Game.frame;
    if (f.air || mv.air || f.finalReady || d === GRAPPLE.LUNGE) return false;
    const byAtk = fr - (f.gAtk || -99) <= 3 && (d === m.jab || d === m.ftilt || d === m.utilt || d === m.dtilt || d === m.fsmash || d === m.usmash || d === m.dsmash);
    const bySpc = !byAtk && fr - (f.gSpc || -99) <= 3 && (d === m.nb || d === m.sb || d === m.ub || d === m.db || (!!m.db && d === m.db.ground));
    if (!(byAtk ? f.pressed('special') : bySpc && f.pressed('attack'))) return false;
    if (f.cstr && fr - f.cstr.t <= 3) return false;   // that move came from a combo cancel (23_combo), not a fresh press
    return GRAPPLE.start(f);
  },
  start(f) {
    const dx = f.dirX(); if (dx) f.face = dx;
    GRAPPLE.n.tries++;
    f.startMove(GRAPPLE.LUNGE);
    return true;
  },

  // ---- the grab ----
  LUNGE: {
    total: 32, clip: 'punch', sfx: 'none',
    start(f) { f.move.gT = Game.frame; },
    tick(f, t) {
      if (t === 4) Sfx.swing();
      if (f.air) return;
      f.vx = t >= 3 && t <= 9 ? f.face * 4.5 : f.vx * 0.6;
      GRAPPLE.keep(f, f.plat);   // never lunges off a ledge
      // frames 1-4 are startup, 5-TK.GRABW are the grab window, the rest is whiff recovery (27_tekken)
      if (t === 5) TK.tell(f);
      if (t >= 5 && t <= TK.GRABW) GRAPPLE.seek(f);
    },
  },
  BOUNCE: { total: 22, clip: 'block', sfx: 'none', tick(f) { if (!f.air) GRAPPLE.keep(f, f.plat); } },
  RECOVER: { total: 12, clip: 'guard', sfx: 'none' },
  seek(f) {
    const c = f.c, hx = f.x + f.face * (c.w * 0.5 + 14), hy = f.y - c.h * 0.5;
    for (const g of Game.fighters) {
      if (g === f || g.air || g.untouchable || !GRAPPLE.CAN.includes(g.state) || Math.abs(g.y - f.y) > 30) continue;
      if (!circleRect(hx, hy, 26, g)) continue;
      const gm = g.move;
      // both lunges started within 2 frames of each other (by start frame, so update order doesn't matter)
      if (g.state === 'move' && gm && gm.def === GRAPPLE.LUNGE && g.face === -f.face && gm.t <= 10 && Math.abs(gm.gT - f.move.gT) <= 2) return GRAPPLE.clash(f, g);
      if (TK.ducks(g)) continue;                        // ducking beats throws, like Tekken (27_tekken)
      const cx = TK.ctx(f, g);                          // read the catch before MV2.catch changes g
      if (MV2.catch(f, g)) { f.tkCtx = cx; return GRAPPLE.begin(f, g); }
    }
    return false;
  },
  begin(f, v) {
    GRAPPLE.n.catches++;
    f.gpl = { plat: f.plat, thrown: false };
    f.cbuf = null; f.cstr = null;
    v.combo = null;   // a fresh combo: the grapple's hits count from 1
    // the throw-break window and which button gets out of it; caught from behind it is the ultra
    // back throw instead, with no way out at all (27_tekken, 29_backthrows)
    const st = TK.open(f, TK.escOf(f.c));
    const S = st.back ? TK.backOf(f) : GRAPPLE.of(f.c);
    st.bk = S.k || 1;
    GRAPPLE.n.backs += st.back ? 1 : 0;
    Game.shake(5); Game.ring(v.x, v.y - v.h * 0.5, f.color, 70);
    f.startMove(S.first);
    return true;
  },
  // both grabbed at once: nobody gets caught
  clash(f, g) {
    GRAPPLE.n.clashes++;
    for (const a of [f, g]) { a.startMove(GRAPPLE.BOUNCE); a.vx = -a.face * 7; }
    const x = (f.x + g.x) / 2, y = Math.min(f.y - f.h, g.y - g.h);
    Game.text(x, y - 16, 'CLASH', '#ffffff', 1.4); Game.ring(x, y + f.h * 0.5, '#ffffff', 80); Game.shake(8); Sfx.hit(0.5);
    return true;
  },

  // ---- sequence helpers ----
  // keep the grabber's next position on platform p (grapples never carry anyone off a ledge)
  keep(f, p) {
    if (!p) return;
    const nx = clamp(f.x + f.vx, p.x0 + 6, p.x1 - 6);
    f.vx = nx - f.x;
  },
  put(f, x, y) { const v = f.grabbed; if (v) MV2.hold(f, x * (f.w * 0.5 + v.w * 0.35), y * f.h); },
  pos(o, f, v, t) {
    const h = o.hold, k = Math.min(1, t / (o.ease || o.n));
    if (typeof h === 'function') return h(f, v, k, t);
    if (typeof h[0] === 'number') return h;
    const e = k * k * (3 - 2 * k);
    return [lerp(h[0][0], h[1][0], e), lerp(h[0][1], h[1][1], e)];
  },
  // rise from a to top, then slam down to the floor in front by frame `at`
  slamPath(a, top, at) {
    const up = Math.max(1, Math.round(at * 0.6));
    return (f, v, k, t) => {
      if (t <= up) { const e = t / up; return [lerp(a[0], top[0], e), lerp(a[1], top[1], e)]; }
      const e = Math.min(1, (t - up) / Math.max(1, at - up));
      return [top[0], lerp(top[1], 0, e * e)];
    };
  },
  // damage while held: no knockback, the victim stays 'grabbed' so COMBO.hit counts it in the running combo
  hit(f, dmg) {
    const v = f.grabbed; if (!v) return;
    dmg *= TK.scale(f);   // per-fighter damage scale + the global knob (27/28_tekken)
    COMBO.hit(v, f, dmg);
    v.dmg = Math.min(999, v.dmg + dmg); v.stats.taken += dmg; f.stats.dealt += dmg; v.lastHitBy = f; v.lastHitT = Game.frame;
    const lag = clamp(Math.floor(dmg * 0.6 + 3), 3, 8);
    v.hitlag = lag; f.hitlag = Math.max(f.hitlag, lag); v.flashT = 8;
    Game.onHit(v, f, null, dmg, 30 + dmg * 8);
  },
  // the release. MV2.throwV sets the victim to 'air' before the hit; here it stays 'grabbed' until
  // takeHit runs, so the throw lands as the last hit of the grapple's combo.
  toss(f, T) {
    const v = f.grabbed; if (!v) return null;
    if (f.gpl) f.gpl.thrown = true;
    f.grabbed = null; v.grabber = null; v.cgrabbed = false; v.air = true; v.plat = null;
    if (T.ground && !f.air && f.plat) { v.y = f.y; v.air = false; v.plat = f.plat; }
    f.cbuf = null;
    v.takeHit({ dmg: T.dmg * TK.scale(f), ang: T.ang, bkb: T.bkb, kbg: T.kbg, x: 10 }, f, 1, f.x, T.back ? -f.face : f.face);
    if (v.state === 'grabbed') v.setState(v.air ? 'air' : 'ground');   // a bubble shield or super armor ate the throw: just let go
    Game.impact = { x: v.x, y: v.y - v.h * 0.5, t: 30 };   // camera punch-in + speed lines
    Game.shake(T.shake || 12);
    return v;
  },

  // one hold move of a sequence; `next` is the stage after it (null: the sequence ends here)
  stage(o, next) {
    const d = {
      total: o.n, holdVictim: true, clip: o.clip || 'punch', sfx: 'none', gStage: true,
      tick(f, t) {
        const G = f.gpl || (f.gpl = { plat: null, thrown: true }), v = f.grabbed, mv = f.move;
        if (!v && !G.thrown) return f.startMove(GRAPPLE.RECOVER);   // the victim got away (KO, explosion, ...)
        if (TK.esc(f)) return;   // the victim broke the throw inside the window (27_tekken)
        f.vx = 0;
        if (o.air) { f.in.down = false; f.fastFall = false; }
        if (o.go) o.go(f, t, G);
        if (f.move !== mv) return;
        if (o.hold && f.grabbed) { const p = GRAPPLE.pos(o, f, f.grabbed, t); GRAPPLE.put(f, p[0], p[1]); if (o.face) f.grabbed.face = f.face * o.face; }   // face 1: held facing away (back throws)
        if (o.hit) for (const h of o.hit) if (h[0] === t) GRAPPLE.hit(f, h[1]);
        if (o.toss && t === o.toss.at) GRAPPLE.toss(f, o.toss);
        GRAPPLE.keep(f, G.plat);
        if (t >= o.n && next) f.startMove(next);
      },
    };
    for (const k of ['fx', 'color', 'shout', 'swallow', 'vanish']) if (o[k] != null) d[k] = o[k];
    if (o.air) d.onLand = f => { if (next && f.move && f.move.def === d) f.startMove(next); };
    return d;
  },
  // the fighter's sequence, built from its data on first use
  of(c) {
    let S = GRAPPLE.cache.get(c);
    if (S) return S;
    const src = c.grapple || GRAPPLE.NAMED[c.id] || GRAPPLE.DEFAULT;
    const spec = typeof src === 'function' ? src(c) : src;
    let next = null, dmg = 0, hits = 0;
    for (let i = spec.stages.length - 1; i >= 0; i--) {
      const o = spec.stages[i];
      if (i === 0 && spec.shout && !o.shout) o.shout = spec.shout;
      for (const h of o.hit || []) { dmg += h[1]; hits++; }
      if (o.toss) { dmg += o.toss.dmg; hits++; }
      next = GRAPPLE.stage(o, next);
    }
    S = { name: spec.name, first: next, dmg, hits, named: src !== GRAPPLE.DEFAULT };
    GRAPPLE.cache.set(c, S);
    return S;
  },

  // ---- CPU (hook in 50_ai.js): now and then when adjacent, much more against a shield, better CPUs more ----
  ai(f, tgt, o, press) {
    if (f.state !== 'ground' || f.air || f.finalReady || f.prev.attack || f.prev.special) return false;
    if (tgt.air || tgt.untouchable || !GRAPPLE.CAN.includes(tgt.state) || Math.abs(tgt.y - f.y) > 12) return false;
    const dx = tgt.x - f.x;
    if (Math.abs(dx) > f.w * 0.5 + 44 + tgt.w * 0.4) return false;
    // behind them? go for it: that is the unbreakable back throw (27_tekken)
    const lv = f.level, back = TK.aiBack(f, tgt);
    const p = back ? 0.012 + lv * 0.013 : tgt.state === 'shield' ? 0.05 + lv * 0.018 : 0.002 + lv * 0.0012;
    if (Rng.next() >= p) return false;
    o.left = o.right = o.up = o.down = false; o[dx > 0 ? 'right' : 'left'] = true;
    press('attack'); press('special');
    return true;
  },

  // ---- the data ----
  // Any fighter without a named grapple: three quick hits in the clinch, then a throw by weight class.
  DEFAULT(c) {
    const P = c.power || 1, w = c.weight || 100;
    const fin = w >= 112 ? { clip: 'slam', hold: GRAPPLE.slamPath([0.9, -0.5], [0.95, -0.95], 8), toss: { at: 8, dmg: 9 * P, ang: 80, bkb: 64, kbg: 64, ground: true } }
      : w <= 90 ? { clip: 'flykick', hold: [0.9, -0.5], toss: { at: 6, dmg: 7 * P, ang: 50, bkb: 58, kbg: 74 } }
      : { clip: 'kick', hold: [0.9, -0.5], toss: { at: 6, dmg: 8 * P, ang: 40, bkb: 60, kbg: 72 } };
    return {
      name: 'Clinch Combo', shout: 'LOCKED IN',
      stages: [
        { n: 13, clip: 'jab', hold: [1, -0.05], hit: [[6, 2]] },
        { n: 13, clip: 'punch', hold: [1, -0.05], hit: [[6, 2.5]] },
        { n: 15, clip: 'uppercut', hold: [[1, -0.05], [0.9, -0.5]], hit: [[8, 3]] },
        Object.assign({ n: 26 }, fin),
      ],
    };
  },
  NAMED: {
    doge: () => ({
      name: 'Coin Flip Suplex', shout: 'MUCH WOW',
      stages: [
        { n: 12, clip: 'punch', hold: [1, -0.05], hit: [[6, 2]] },
        { n: 18, clip: 'uppercut', fx: 'coins', hold: [[1, -0.05], [0, -1.1]], ease: 12,
          go(f, t) { if (t === 8) { Sfx.coin(); MV2.say(f, Game.frame % 2 ? 'HEADS' : 'TAILS', 1); } } },
        { n: 14, clip: 'spin', hold: (f, v, k) => { const a = k * k * HALF_PI; return [-1.05 * dsin(a), -1.1 * dcos(a)]; } },
        { n: 26, clip: 'slam', hold: [-1.05, 0], toss: { at: 2, dmg: 12, ang: 65, bkb: 62, kbg: 74, ground: true, back: true, shake: 16 },
          go(f, t) { if (t === 2) { Game.shock(f.x - f.face * f.w * 0.6, f.y, '#f2b43c'); Sfx.coin(); } } },
      ],
    }),
    trump: () => ({
      name: "You're Fired Toss",
      stages: [
        { n: 12, clip: 'punch', hold: [1, -0.1], hit: [[6, 2]] },
        { n: 20, clip: 'jab', hold: (f, v, k, t) => [1 + 0.1 * dsin(t * 1.3), -0.12], hit: [[6, 2], [14, 2]] },
        { n: 16, clip: 'cast', fx: 'coins', shout: "YOU'RE FIRED", hold: [1, -0.15] },
        { n: 26, clip: 'kick', hold: [[1, -0.15], [1.2, -0.6]], ease: 5, toss: { at: 5, dmg: 11, ang: 35, bkb: 64, kbg: 80, shake: 16 },
          go(f, t) { if (t === 5) Game.burst(f.x + f.face * f.w, f.y - f.h * 0.6, '#ffd23f', 14); } },
      ],
    }),
    clanker: () => ({
      name: 'EMP Piledriver', shout: 'EMP DRIVER',
      stages: [
        { n: 12, clip: 'punch', hold: [1, -0.05], hit: [[6, 2]] },
        { n: 12, clip: 'uppercut', hold: [[1, -0.05], [0, -1.05]] },
        { n: 16, clip: 'jump', fx: 'bash', color: '#8fd8ff', hold: [0, -1.05], hit: [[12, 3]],
          go(f, t) { if (t === 1) f.vy = -11; if (t === 12) { Game.burst(f.x, f.y - f.h * 1.5, '#8fd8ff', 12); Sfx.tone(1800, 200, 0.25, 'sawtooth', 0.1); } } },
        { n: 50, clip: 'slam', fx: 'bash', color: '#8fd8ff', air: true, hold: [0, -1], go(f) { f.vy = 17; } },
        { n: 26, clip: 'slam', hold: [0.7, 0], toss: { at: 1, dmg: 12, ang: 84, bkb: 70, kbg: 62, ground: true, shake: 18 },
          go(f, t) { if (t === 1) Game.shock(f.x, f.y, '#8fd8ff'); } },
      ],
    }),
    // SLAM's special is already a power bomb, so his grapple is a chokeslam
    slam: () => ({
      name: 'Chokeslam', shout: 'CHOKESLAM',
      stages: [
        { n: 12, clip: 'punch', hold: [[1, -0.05], [1, -0.3]], hit: [[6, 2]] },
        { n: 22, clip: 'uppercut', fx: 'pound', color: '#ffd23f', hold: [[1, -0.3], [0.85, -1.25]], ease: 16, go(f, t) { if (t === 20) Game.shake(4); } },
        { n: 30, clip: 'slam', hold: [[0.85, -1.25], [1, 0]], ease: 6, toss: { at: 6, dmg: 15, ang: 80, bkb: 72, kbg: 62, ground: true, shake: 18 },
          go(f, t) { if (t === 6) Game.shock(f.x + f.face * f.w * 0.6, f.y, '#ffd23f'); } },
      ],
    }),
    giga: () => ({
      name: 'Teleport-Behind Kick', shout: 'NOTHING PERSONAL',
      stages: [
        { n: 12, clip: 'punch', hold: [1, -0.05], hit: [[6, 2]] },
        { n: 16, clip: 'cast', vanish: [3, 12], hold: null,
          go(f, t, G) {
            if (t === 3) Sfx.tone(1200, 300, 0.12, 'sine', 0.1);
            const v = f.grabbed;
            if (t === 8 && v) {
              const x = v.x + f.face * (v.w * 0.4 + f.w * 0.5 + 6), p = G.plat;
              f.x = p ? clamp(x, p.x0 + 6, p.x1 - 6) : x; f.face = -f.face;
            }
          } },
        { n: 32, clip: 'flykick', fx: 'blitz', color: '#7ff0ff', hold: [1, -0.1], hit: [[5, 2.5]], toss: { at: 12, dmg: 11, ang: 38, bkb: 62, kbg: 82, shake: 14 } },
      ],
    }),
    mochi: () => ({
      name: 'Swallow and Spit', shout: 'GULP',
      stages: [
        { n: 16, clip: 'cast', fx: 'inhale', hold: [[1, -0.05], [0, 0]], ease: 14 },
        { n: 32, clip: 'guard', swallow: true, hold: [0, 0], hit: [[8, 2], [16, 2], [24, 2]], go(f, t) { if (t % 8 === 0) f.sq = 0.16; } },
        { n: 26, clip: 'cast', swallow: true, hold: (f, v, k, t) => (t >= 6 ? [1.2, -0.05] : [0, 0]), toss: { at: 6, dmg: 9, ang: 20, bkb: 62, kbg: 64 },
          go(f, t) {
            if (t !== 6) return;
            MV2.say(f, 'PTOO'); Sfx.tone(700, 200, 0.12, 'square', 0.12);
            const s = MV2.spawn(f, { kind: 'star', vx: 15, vy: 0, grav: 0, r: 22, dmg: 8, ang: 35, bkb: 40, kbg: 60, life: 30, pierce: true, color: '#ffe066' });
            if (f.grabbed) s.hitSet = new Set([f.grabbed]);   // the star is for anyone else
          } },
      ],
    }),
    kaiju: () => ({
      name: 'Tail-Spin Throw', shout: 'TAIL SPIN',
      stages: [
        { n: 12, clip: 'punch', hold: [[1, -0.05], [1.25, -0.35]], hit: [[6, 2]] },
        { n: 40, clip: 'spin', fx: 'shell', color: '#ff7a1a', hold: (f, v, k) => [1.25 * dcos(k * TAU * 2), -0.35], hit: [[13, 1.5], [26, 1.5]],
          go(f, t) { if (t % 10 === 5) Sfx.swing(); } },
        { n: 24, clip: 'spin', hold: [1.25, -0.35], toss: { at: 1, dmg: 12, ang: 32, bkb: 66, kbg: 84, shake: 16 } },
      ],
    }),
    turbo: () => ({
      name: 'Flame-Knee Launch', shout: 'BLAZE KNEE',
      stages: [
        { n: 12, clip: 'punch', hold: [1, -0.05], hit: [[6, 2]] },
        { n: 14, clip: 'kick', fx: 'blitz', color: '#ff9a2a', hold: [1, -0.1], hit: [[6, 2.5]] },
        { n: 14, clip: 'kick', fx: 'blitz', color: '#ff9a2a', hold: [1, -0.15], hit: [[6, 2.5]] },
        { n: 30, clip: 'flykick', fx: 'dive', color: '#ff9a2a', hold: [[1, -0.15], [0.95, -0.8]], ease: 6, toss: { at: 6, dmg: 10, ang: 82, bkb: 68, kbg: 70, shake: 14 },
          go(f, t) { if (t === 5) f.vy = -9; if (t === 6) Game.burst(f.x + f.face * f.w * 0.5, f.y - f.h * 0.6, '#ff9a2a', 16); } },
      ],
    }),
    bonk: () => ({
      name: 'Home Run', shout: 'HOME RUN',
      stages: [
        { n: 12, clip: 'punch', hold: [1, -0.05], hit: [[6, 2]] },
        { n: 18, clip: 'uppercut', hold: [[1, -0.05], [1.1, -1.5]], ease: 12, go(f, t) { if (t === 4) Sfx.swing(); } },
        { n: 32, clip: 'kick', hold: [[1.1, -1.5], [1.2, -0.45]], ease: 9, toss: { at: 9, dmg: 13, ang: 40, bkb: 62, kbg: 96, shake: 16 },
          go(f, t) { const v = f.grabbed; if (t === 9 && v) Game.text(v.x, v.y - v.h - 16, 'BONK!', '#ffd45c', 1.7); } },
      ],
    }),
    pepe: () => ({
      name: 'Frog Splash', shout: 'FROG SPLASH',
      stages: [
        { n: 12, clip: 'punch', hold: [1, -0.05], hit: [[6, 2]] },
        { n: 12, clip: 'kick', hold: [[1, -0.05], [1.45, 0]], ease: 6, hit: [[5, 2.5]] },
        { n: 50, clip: 'jump', air: true, hold: null,
          go(f, t, G) { const v = f.grabbed; if (t === 1) G.jx = v ? (v.x - f.x) / 23 : 0; f.vx = G.jx || 0; f.vy = -10.5 + t * 0.85; } },
        { n: 26, clip: 'slam', hold: [0.3, 0], toss: { at: 1, dmg: 12, ang: 78, bkb: 64, kbg: 68, ground: true, shake: 16 },
          go(f, t) { if (t === 1) Game.shock(f.x, f.y, '#56b847'); } },
      ],
    }),
    lobster: () => ({
      name: 'Claw Crusher', shout: 'CLAW CRUSH',
      stages: [
        { n: 12, clip: 'punch', hold: [1.1, -0.1], hit: [[6, 2]] },
        { n: 30, clip: 'jab', hold: (f, v, k, t) => [1.1, -0.2 - 0.05 * dsin(t * 0.8)], hit: [[6, 2], [14, 2], [22, 2]] },
        { n: 26, clip: 'kick', hold: [[1.1, -0.2], [1.15, -0.6]], ease: 6, toss: { at: 6, dmg: 10, ang: 45, bkb: 60, kbg: 80 } },
      ],
    }),
    wojak: () => ({
      name: "It's Over", shout: "IT'S OVER",
      stages: [
        { n: 14, clip: 'punch', hold: [1, -0.05], hit: [[6, 2]] },
        { n: 24, clip: 'guard', hold: [0.8, -0.1], hit: [[12, 2]], go(f, t) { if (t % 6 === 0) Game.burst(f.x + f.face * f.w * 0.2, f.y - f.h * 0.8, '#9fd8ff', 3); } },
        { n: 28, clip: 'slam', hold: GRAPPLE.slamPath([0.8, -0.1], [0.9, -0.95], 8), toss: { at: 8, dmg: 11, ang: 70, bkb: 62, kbg: 72, ground: true },
          go(f, t) { if (t === 8) MV2.say(f, "WE'RE SO BACK", 1.3); } },
      ],
    }),
    cheems: () => ({
      name: 'Hostile Takeover', shout: 'HOSTILE TAKEOVER',
      stages: [
        { n: 12, clip: 'punch', hold: [1, -0.1], hit: [[6, 2]] },
        { n: 26, clip: 'cast', fx: 'coins', hold: [1, -0.1], hit: [[8, 2], [18, 2]], go(f, t) { if (t === 8 || t === 18) Sfx.coin(); } },
        { n: 28, clip: 'kick', hold: [[1, -0.1], [1.15, -0.5]], ease: 6, toss: { at: 6, dmg: 10, ang: 40, bkb: 60, kbg: 78 },
          go(f, t) { if (t === 6) MV2.say(f, 'MUCH PROFIT', 1.2); } },
      ],
    }),
    bull: () => ({
      name: 'Horn Toss', shout: 'TO THE MOON',
      stages: [
        { n: 12, clip: 'punch', hold: [1, -0.05], hit: [[6, 2]] },
        { n: 18, clip: 'guard', hold: [1, -0.05], hit: [[10, 3]], go(f, t) { if (t < 12) f.vx = f.face * 2; } },
        { n: 30, clip: 'uppercut', fx: 'cannon', hold: [[1, -0.05], [0.9, -1.05]], ease: 6, toss: { at: 6, dmg: 12, ang: 88, bkb: 72, kbg: 70, shake: 16 },
          go(f, t) { if (t === 6) Game.burst(f.x + f.face * f.w * 0.5, f.y - f.h, '#3ec46d', 16); } },
      ],
    }),
    bear: () => ({
      name: 'Capitulation', shout: 'CAPITULATION',
      stages: [
        { n: 12, clip: 'punch', hold: [1, -0.05], hit: [[6, 2]] },
        { n: 30, clip: 'guard', hold: [0.75, -0.15], hit: [[8, 2], [16, 2], [24, 2]], go(f, t) { if (t % 8 === 0) Game.burst(f.x + f.face * f.w * 0.4, f.y - f.h * 0.5, '#ff3b30', 5); } },
        { n: 30, clip: 'slam', hold: GRAPPLE.slamPath([0.75, -0.15], [0.95, -1], 9), toss: { at: 9, dmg: 12, ang: -80, bkb: 52, kbg: 72, ground: true, shake: 16 },
          go(f, t) { if (t === 9) Game.shock(f.x + f.face * f.w * 0.6, f.y, '#ff3b30'); } },
      ],
    }),
    hoodie: () => ({
      name: 'Tap Out', shout: 'TAP OUT',
      stages: [
        { n: 14, clip: 'sweep', hold: [[1, -0.05], [1.3, 0]], ease: 8, hit: [[8, 2]], go(f, t) { if (t === 8) Game.puff(f.x + f.face * f.w * 0.8, f.y, 8, '#ffffff'); } },
        { n: 32, clip: 'slam', hold: [1.3, 0], hit: [[6, 1.5], [13, 1.5], [20, 1.5], [27, 1.5]] },
        { n: 26, clip: 'kick', hold: [1.3, 0], toss: { at: 6, dmg: 9, ang: 30, bkb: 60, kbg: 74, ground: true } },
      ],
    }),
    sin: () => ({
      name: 'Seven Sins', shout: 'SEVEN SINS',
      stages: [
        { n: 10, clip: 'punch', hold: [1, -0.05], hit: [[5, 1]] },
        { n: 40, clip: 'jab', fx: 'blitz', color: '#ff3b30', hold: [1, -0.05], hit: [[4, 1], [10, 1], [16, 1], [22, 1], [28, 1], [34, 1]] },
        { n: 26, clip: 'kick', shout: 'JUDGMENT', hold: [[1, -0.05], [1.1, -0.4]], ease: 6, toss: { at: 6, dmg: 9, ang: 40, bkb: 64, kbg: 80 } },
      ],
    }),
    chop: () => ({
      name: 'One Inch Punch', shout: 'ONE INCH',
      stages: [
        { n: 12, clip: 'punch', hold: [1, -0.05], hit: [[6, 2]] },
        { n: 18, clip: 'jab', hold: [1, -0.05], hit: [[5, 1.5], [12, 1.5]] },
        { n: 14, clip: 'guard', hold: [0.85, -0.05], go(f, t) { if (t === 8) Game.ring(f.x + f.face * f.w * 0.55, f.y - f.h * 0.55, '#ffd23f', 36); } },
        { n: 26, clip: 'punch', hold: [0.85, -0.05], toss: { at: 3, dmg: 11, ang: 22, bkb: 72, kbg: 86, shake: 16 },
          go(f, t) { if (t === 3) MV2.say(f, 'WATAA', 1.4); } },
      ],
    }),
    ape: () => ({
      name: 'Ape Smash', shout: 'APE SMASH',
      stages: [
        { n: 12, clip: 'punch', hold: [[1, -0.05], [1.1, 0]], hit: [[6, 2]] },
        { n: 18, clip: 'slam', hold: (f, v, k) => [1.1 * dcos(k * Math.PI), -1.1 * dsin(k * Math.PI)], hit: [[18, 3]], go(f, t) { if (t === 18) Game.shake(8); } },
        { n: 18, clip: 'slam', hold: (f, v, k) => [-1.1 * dcos(k * Math.PI), -1.1 * dsin(k * Math.PI)], hit: [[18, 3]], go(f, t) { if (t === 18) Game.shake(8); } },
        { n: 26, clip: 'kick', hold: [1.1, -0.05], toss: { at: 3, dmg: 9, ang: 70, bkb: 62, kbg: 72, ground: true } },
      ],
    }),
    techno: () => ({
      name: 'Launch Sequence', shout: 'T-MINUS 3',
      stages: [
        { n: 12, clip: 'punch', hold: [1, -0.05], hit: [[6, 2]] },
        { n: 34, clip: 'cast', hold: [1, -0.05], hit: [[10, 1.5], [22, 1.5]],
          go(f, t) { if (t === 10) MV2.say(f, '2', 1.4); if (t === 22) MV2.say(f, '1', 1.6); } },
        { n: 28, clip: 'uppercut', fx: 'rocket', color: '#ff9a2a', hold: [[1, -0.05], [1, -1]], ease: 4, toss: { at: 4, dmg: 11, ang: 88, bkb: 76, kbg: 66, shake: 16 },
          go(f, t) { if (t === 4) MV2.say(f, 'LIFTOFF', 1.5); } },
      ],
    }),
    ember: () => ({
      name: 'Dragon Dive', shout: 'DRAGON DIVE',
      stages: [
        { n: 12, clip: 'punch', hold: [1, -0.05], hit: [[6, 2]] },
        { n: 20, clip: 'spin', fx: 'wings', color: '#ff8a2a', hold: [0.75, -0.1], hit: [[14, 2]], go(f, t) { if (t === 2) f.vy = -12.5; } },
        { n: 50, clip: 'slam', fx: 'blitz', color: '#ff6a1a', air: true, hold: [0.75, -0.1], go(f) { f.vy = 15; } },
        { n: 26, clip: 'slam', hold: [0.8, 0], toss: { at: 1, dmg: 13, ang: 76, bkb: 66, kbg: 70, ground: true, shake: 18 },
          go(f, t) { if (t === 1) Game.shock(f.x, f.y, '#ff8a2a'); } },
      ],
    }),
  },
};

// ---- page only: the THROW button on the touch controls (the `grapple` action, i.e. the R key) ----
// Its partner GRAB button and the DROP chip live in 88_touch2.js.
(function () {
  if (typeof document === 'undefined' || typeof Touch === 'undefined') return;
  const box = document.getElementById('tbtns'); if (!box) return;
  const css = document.createElement('style');
  css.textContent = '#tbtns .tb.gbtn{right:152px;bottom:108px;width:54px;height:54px;font-size:13px;border-color:var(--pink,#ff4fd8);color:var(--pink,#ff4fd8)}';
  document.head.appendChild(css);
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'tb gbtn'; b.textContent = 'THROW'; b.setAttribute('aria-label', "Command throw: this fighter's own grapple");
  const held = k => { const o = box.querySelector('.tb[data-k=' + k + ']'); return !!(o && o.classList.contains('on')); };
  // these listeners are added before setupTouch (10_core) binds every .tb; stopImmediatePropagation keeps its
  // single-key handlers off this button
  const on = e => {
    e.preventDefault(); e.stopImmediatePropagation(); try { b.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
    Touch.tap = Touch.tap || {};
    for (const k of ['grapple']) { Touch.held[k] = true; Touch.tap[k] = true; }
    b.classList.add('on'); try { Sfx.unlock(); } catch (err) { /* sound is optional */ }
  };
  const off = e => {
    e.stopImmediatePropagation();
    if (!b.classList.contains('on')) return;
    b.classList.remove('on');
    for (const k of ['grapple']) if (!held(k)) Touch.held[k] = false;
  };
  b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off);
  b.addEventListener('pointercancel', off); b.addEventListener('lostpointercapture', off);
  box.appendChild(b);
  // grapples are rules v2 (local matches): hide the button in bet-arena and online fights
  setInterval(() => { const show = !!Game.combos; if ((b.style.display !== 'none') !== show) b.style.display = show ? '' : 'none'; }, 300);
})();
