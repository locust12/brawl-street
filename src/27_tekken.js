// ===== the Tekken layer: throw buttons, throw escapes, gun aiming, one-button item drop =====
// Named 2x_ on purpose: build.py and net/tools/build-engine.js pull every src/2[0-9]_*.js into the
// headless fight engines, so the page, the arena sim and the game server run this exact file.
// It loads BEFORE 40_fighter.js, so it only defines data and functions; the engine hooks call in at
// run time (40_fighter groundAct/airAct, 41_combat grabbingUpdate/grabConnect, 24_grapple, 55/56 items).
//
// ---- the scheme ----
// Tekken has four limb buttons - 1 Left Punch, 2 Right Punch, 3 Left Kick, 4 Right Kick - and throws
// live on two-button pairs: 1+3 is the left throw, 2+4 the right throw, and every character also owns
// command throws on their own motions. Brawl Street has Attack / Smash / Special / Shield / Jump, so
// the two throw pairs become two dedicated neighbouring keys:
//   E  = GRAB     Tekken's 1+3. The generic throw: catch them, then a direction picks the throw.
//   R  = GRAPPLE  Tekken's 2+4. The fighter's own scripted command throw (24/26/28_grapple*).
//   E then R inside TK.PAIR frames = GRAPPLE, so pressing the pair always gives the big one.
// Smash moves off R onto T (10_core KEYMAPS); a direction tap + Attack still fires a smash as before.
//
// ---- the throw break (Tekken's 20 frames) ----
// The victim gets TK.ESC frames from the catch to get out; a throw that caught someone mid-move is a
// counter-hit throw and only gives TK.ESC_CH, and a throw taken from behind is unbreakable, all as in
// Tekken 7/8. The generic throw goes to either throw button, one press - Tekken 7 unified generic
// breaks the same way. A command throw wants its own button (E, R or E+R, shown over the victim's
// head when it catches) and pressing the WRONG throw button locks you out for the rest of the window,
// so it is a read, not a mash. Hitlag freezes both fighters, so the window pauses with the animation.
// Ducking beats throws outright, Tekken's other half of the rock-paper-scissors.
//
// ---- determinism ----
// Every entry point is gated on Game.combos (Game.start turns that on for unseeded local matches only).
// Seeded fights - the bet arena at ARENA.version 1 and online lockstep - have it off, so TK.keys never
// runs, TK.aim returns null and every weapon keeps its stock numbers. Fight maths here uses the seeded
// Rng and dsin/dcos/dhypot only.

const TK = {
  ESC: 20,                       // throw-break window in frames (Tekken 7 and 8 both use 20)
  ESC_CH: 14,                    // ...cut in half-ish when the throw catches someone mid-move
  PAIR: 4,                       // frames two buttons may be apart and still count as pressed together
  GRABW: 12,                     // last frame of the command throw's grab window (startup is 1-4)
  // the generic throw goes to either throw button; anything at all counts as a struggle input
  ESC_KEYS: ['grab', 'grapple'],

  // ---------- the two throw buttons ----------
  // hook: 40_fighter.js groundAct, behind Game.combos. Returns true when the press was consumed.
  keys(f) {
    if (f.item && f.pressed('drop')) return Items2.dropItem(f);           // Q / U / L3: one button, no combo
    if (f.finalReady) return false;                                       // Special is the Final Smash right now
    if (f.pressed('grapple')) return f.item ? false : GRAPPLE.start(f);   // R: the command throw
    if (f.pressed('grab')) {                                              // E: the generic throw
      if (f.item) { f.throwItem(); return true; }                         // hands full: E throws what you hold
      f.tkGrab = Game.frame;
      const dx = f.dirX(); if (dx) f.face = dx;
      f.startMove(f.m.grab);
      return true;
    }
    return false;
  },
  // hook: 24_grapple.js GRAPPLE.late, on the first frames of a move. E then R = the command throw.
  late(f) {
    const mv = f.move, d = mv.def.base || mv.def;
    if (f.air || mv.air || f.finalReady || d !== f.m.grab) return false;
    if (!f.pressed('grapple') || Game.frame - (f.tkGrab || -99) > TK.PAIR) return false;
    return GRAPPLE.start(f);
  },
  // Tekken's counterplay: a crouching fighter cannot be thrown at all.
  ducks(g) { return !!(Game.combos && g.crouch && !g.air); },

  // ---------- throw escapes ----------
  // hook: 41_combat.js grabConnect and 24_grapple.js seek, both at the moment of the catch, while the
  // victim's own state and facing are still intact.
  // caught from behind = the victim's back is toward the grabber. Tekken's back throw: unbreakable.
  ctx(g, v) { return { back: (g.x - v.x) * v.face < 0, cnt: v.state === 'move' }; },
  // set the window up on the grabber. `want` is the break button for a command throw, null = generic.
  open(g, want) {
    const c = g.tkCtx || {}; g.tkCtx = null;
    const back = !!c.back && !!Game.combos;
    const st = { t: 0, want, back, win: c.cnt ? TK.ESC_CH : TK.ESC, off: !Game.combos || back };
    g.tkEsc = st;
    if (back) TK.backFx(g, !!want);
    else if (!st.off) {
      const v = g.grabbed;
      if (v && !v.cpu) Game.text(v.x, v.y - v.h - 26, want ? 'BREAK: ' + want : 'BREAK: E / R', '#ffffff', 1.05);
    }
    return st;
  },
  // a back throw connecting: the finisher treatment. `big` = the command throw, not the plain one.
  backFx(g, big) {
    const v = g.grabbed;
    Game.text(g.x, g.y - g.h - 44, 'BACK THROW', '#ffe27a', big ? 2 : 1.3);
    Game.shake(big ? 18 : 10);
    Game.flashT = Math.max(Game.flashT, big ? 7 : 4);
    if (v) {
      Game.impact = { x: v.x, y: v.y - v.h * 0.5, t: 30 };                    // camera punch-in + speed lines
      Game.rings.push({ x: v.x, y: v.y - v.h * 0.5, r: 12, max: big ? 230 : 140, color: '#ffe27a', life: 22, w: big ? 14 : 8 });
      if (big) Game.burst(v.x, v.y - v.h * 0.5, '#ffe27a', 22);
    }
    if (big && !Game.demo) Game.slowT = Math.max(Game.slowT, 16);            // the little cinematic pause
    Sfx.hit(1); Sfx.tone(140, 60, 0.3, 'sawtooth', 0.14);
  },
  // one frame of the window, from whichever hold move is running. Returns true when the victim got out.
  esc(g) { const v = g.grabbed; return !!v && TK.tick(g, v); },
  tick(g, v) {
    const st = g.tkEsc;
    if (!st || st.off) return false;
    if (st.t++ >= st.win) { st.off = true; return false; }
    if (v.cpu) { if (Rng.next() >= 0.002 + (v.level || 5) * 0.0025) return false; }
    else {
      const r = TK.read(v, st);
      if (r < 0) { st.off = true; Game.text(v.x, v.y - v.h - 26, 'LOCKED', '#ff6a6a', 0.95); return false; }
      if (r === 0) return false;
    }
    st.off = true;
    return TK.breakOut(g, v);
  },
  // 1 = broke out, 0 = nothing yet, -1 = wrong button, locked out for the rest of the window
  read(v, st) {
    const e = !!v.in.grab && !v.prev.grab, r = !!v.in.grapple && !v.prev.grapple;
    if (!e && !r) return 0;
    if (!st.want) return 1;                                               // generic throw: either button
    if (st.want === 'E+R') {
      if (e) st.e = st.t; if (r) st.r = st.t;
      return (st.e != null && st.r != null && Math.abs(st.e - st.r) <= TK.PAIR) ? 1 : 0;
    }
    if (st.want === 'R') return r ? 1 : -1;
    return e ? 1 : -1;
  },
  BREAKLAG: { total: 22, clip: 'block', sfx: 'none', tick(f) { f.vx *= 0.82; } },
  // both fighters bounce apart, nobody takes the throw
  breakOut(g, v) {
    g.grabbed = null; v.grabber = null; v.cgrabbed = false;
    if (v.state === 'grabbed') v.setState(v.air ? 'air' : 'ground');
    const s = v.x >= g.x ? 1 : -1;
    v.vx = s * 5.5; v.vy = v.air ? -2 : 0; v.invuln = Math.max(v.invuln, 12); v.flashT = 8;
    g.vx = -s * 3.5;
    if (g.gpl) g.gpl.thrown = true;                                       // the stages stop hunting for a victim
    g.startMove(TK.BREAKLAG);
    const mx = (g.x + v.x) / 2, my = Math.min(g.y - g.h, v.y - v.h) - 14;
    Game.text(mx, my, 'BREAK!', '#ffffff', 1.5);
    Game.ring(mx, v.y - v.h * 0.5, '#ffffff', 90); Game.shake(7);
    Sfx.shield(); Sfx.tone(520, 260, 0.1, 'square', 0.1);
    return true;
  },
  // the grab window opening: a white flash so the catch is readable in 3D (visual only)
  tell(f) {
    Game.ring(f.x + f.face * (f.w * 0.55 + 14), f.y - f.h * 0.5, '#ffffff', 44);
    Sfx.tone(520, 900, 0.05, 'square', 0.07);
  },

  // ---------- per-fighter command-throw data (the table lives in 28_grapples3.js) ----------
  ESCOF: {},                     // id -> 'E' | 'R' | 'E+R'   which button breaks that command throw
  DMG: {},                       // id -> damage multiplier over the throw's scripted numbers
  SCALE: 1,                      // global knob over every command throw
  escOf(c) { return TK.ESCOF[c.id] || 'R'; },
  scale(f) {
    const st = f.tkEsc, k = TK.SCALE * (TK.DMG[f.c.id] || 1);
    return st && st.back && st.bk ? k * st.bk : k;   // a back throw is worth TK.BACK_RATIO front throws
  },

  // ---------- back throws (29_backthrows.js) ----------
  // Catch someone whose back is turned and you get their ultra instead of their normal command throw:
  // a longer sequence, a bigger launch, and no escape window at all. Tekken's back throws, same rule.
  BACK: {},                      // id -> spec (or a function of the character)
  BACKDEF: null,                 // the fallback for a fighter a later roster file adds
  bcache: new Map(),
  BACK_RATIO: 1.75,              // a back throw is worth this many of the SAME fighter's front throw
  BACK_GEN: 1.5,                 // ...and the plain throw (E) from behind hits this much harder
  backOf(f) {
    const c = f.c;
    let S = TK.bcache.get(c);
    if (S) return S;
    const src = TK.BACK[c.id] || TK.BACKDEF;
    if (!src) { S = GRAPPLE.of(c); TK.bcache.set(c, S); return S; }   // nothing written: the front throw, unbreakable
    const spec = typeof src === 'function' ? src(c) : src;
    let next = null, dmg = 0;
    for (let i = spec.stages.length - 1; i >= 0; i--) {
      const o = spec.stages[i];
      if (i === 0 && spec.shout && !o.shout) o.shout = spec.shout;
      for (const h of o.hit || []) dmg += h[1];
      if (o.toss) dmg += o.toss.dmg;
      next = GRAPPLE.stage(o, next);
    }
    const front = GRAPPLE.of(c).dmg || dmg || 1;
    S = { name: spec.name, first: next, dmg, k: dmg > 0 ? front * TK.BACK_RATIO / dmg : 1 };
    TK.bcache.set(c, S);
    return S;
  },
  // the CPU wants a back grab far more than a front one
  aiBack(f, tgt) { return (f.x - tgt.x) * tgt.face < 0; },

  // ---------- gun aiming ----------
  // Neutral fires straight ahead. Up or Down alone tilts it steeply (75 deg); with a direction held it
  // is a clean 45-deg diagonal, so down-forward and down-back shoot down at an angle and down on its
  // own drops the shot at your feet. Returns null in seeded fights, which keeps the stock numbers.
  D45: dcos(deg(45)), S45: dsin(deg(45)), D75: dcos(deg(75)), S75: dsin(deg(75)),
  aim(f) {
    if (!Game.combos) return null;
    const up = !!f.in.up, dn = !!f.in.down;
    if (up === dn) return null;                                           // neutral, or both at once
    const diag = f.dirX() !== 0;
    return { c: diag ? TK.D45 : TK.D75, s: (dn ? 1 : -1) * (diag ? TK.S45 : TK.S75) };
  },
  // rotate a weapon's own forward velocity by the aim angle (y grows downward, so +s aims down)
  rot(a, vx, vy) { return a ? [vx * a.c - vy * a.s, vx * a.s + vy * a.c] : [vx, vy]; },
};
