// ===== game feel: rules v2 (buffer, hops, hitlag, DI/SDI, tech, parry, staling, rage, PUMP meter, CPU) =====
// Not a roster file: named 2x_ so build.py and net/tools/build-engine.js pull it into the headless fight
// engines. It loads before 40_fighter.js, so it only defines data and functions; one-line hooks in
// 40_fighter / 41_combat / 50_ai / 55_items / 60_game call in at run time, each behind `Game.feel`.
//
// Game.start sets Game.feel for unseeded (local) matches, next to Game.combos. Seeded fights (bet arena
// at ARENA.version 1, online) keep the old rules unless the caller sets `Game.feel = true` after start
// (online: every peer and the server together). Fight code here uses only the seeded Rng and
// dsin/dcos/dhypot. Visuals read FEEL.ev (96_v3_feel.mjs, 83_feel_hud.js) and never write back.
//
// What it does (numbers from Smash Ultimate unless noted, see docs/GAMEFEEL.md):
//   input   8-frame buffer for presses made during lag; coyote jump; hold-to-hop (let go of jump early
//           = short hop); jump + attack together = short-hop aerial; aerials autocancel late, and shield
//           just before touchdown halves landing lag (CLEAN); shield release costs 7 frames
//   hits    hitlag d*0.65+6 (multi-hits half, projectiles 3/4, cap 24); lethal hits (a cheap flight
//           sim of the launch) freeze longer and punch the camera in; the hit that ends the match gets the
//           Finish Zoom; counter hits (caught in start-up) +10%; stale-move queue of 9; rage to 1.1x
//   escape  SDI during hitlag, DI on its last frame; tech (shield within 11 frames of touchdown, 40-frame
//           lockout) or knockdown with get-up options; airdodge / act out of a long tumble; combos scale
//           from their 4th move and their hitstun decays from the 5th
//   defense parry: shield raised <= 4 frames before the hit, or dropped <= 5 frames before it; the attacker
//           freezes, the defender acts at once
//   PUMP    meter from damage dealt / taken / parries. Shield + Special: in hitstun or held = BURST (half),
//           in neutral with a full bar = PUMP MODE (6 s of the Pump Pill power-up, 55_items)
//   CPU     human reaction times, parries, spot dodges, punishes, techs, DI, bursts, get-ups by level
const FEEL = {
  BUF: 8, COYOTE: 6, HOP: 9, SHORT: 0.68,
  TECH: 11, TECH_LOCK: 40, PARRY_UP: 4, PARRY_DROP: 5, DROP_LAG: 7, LCANCEL: 7,
  DI: 0.21,           // max launch rotation, radians (12 degrees)
  SDI: 7,             // px per SDI press during hitlag
  STALE: [0.09, 0.08545, 0.07635, 0.0679, 0.05945, 0.05035, 0.04255, 0.03345, 0.025], FRESH: 1.05,
  KB: 1.06,            // global knockback scale under local rules (tuned with dev/feelbench.js)
  // per-fighter balance under local rules only: [damage dealt x, knockback taken x], fitted by dev/tune.js from
  // CPU-vs-CPU win rates without items (the bet arena keeps every fighter's raw data)
  // TUNE-BEGIN
  TUNE: {
    ape: [0.881, 1.059],
    bear: [0.937, 1.032],
    bling: [1.012, 0.994],
    bogdanoff: [1.012, 0.994],
    bonk: [0.908, 1.047],
    brett: [0.966, 1.017],
    bull: [0.919, 1.041],
    cashcat: [1.131, 0.939],
    cheems: [1.022, 0.989],
    chop: [0.954, 1.022],
    clanker: [0.95, 1.023],
    doge: [1.051, 0.974],
    ember: [0.955, 1.022],
    fartcoin: [1.03, 0.985],
    floki: [0.952, 1.024],
    fro: [0.892, 1.054],
    gigachad: [0.916, 1.043],
    ginga: [1.007, 0.996],
    gwei: [1.068, 0.967],
    hoodie: [0.952, 1.024],
    kaiju: [0.859, 1.075],
    lobster: [0.904, 1.048],
    mochi: [1.079, 0.962],
    moodeng: [0.984, 1.007],
    mystic: [0.981, 1.01],
    omen: [1.25, 0.88],
    pengu: [0.959, 1.01],
    pepe: [1.195, 0.91],
    popcat: [1.048, 0.976],
    ronin: [0.888, 1.054],
    shib: [1.047, 0.977],
    shroom: [0.99, 1.005],
    sifu: [0.988, 1.006],
    sin: [1.048, 0.976],
    slam: [0.88, 1.055],
    spark: [1.025, 0.987],
    techno: [0.925, 1.039],
    topg: [0.903, 1.049],
    trump: [0.967, 1.014],
    turbo: [0.974, 1.01],
    tyrant: [1.15, 0.929],
    whale: [0.924, 1.039],
    wif: [1.042, 0.979],
    wisp: [1.074, 0.962],
    wojak: [1.105, 0.95],
  },
  // TUNE-END
  RATES: { off: null, normal: [[450, 800], [600, 1000], [1000, 1500], [1650, 2550]], mayhem: [[300, 520], [420, 760], [700, 1100], [1100, 1700]] },
  BURST_COST: 50, GAIN_DEALT: 0.22, GAIN_TAKEN: 0.16, GAIN_PARRY: 8, PUMP_T: 360,
  AIR: 1.08, AIR_A: 0.62,      // air speed and air acceleration (40_fighter drift)
  ACC: 1.6, FRIC: 0.62, TURN: 0.35,   // ground acceleration, stopping friction, slide killed on a turn
  LEDGE: [0.6, 1.25, 6, 58],    // ledge grab window: behind, in front, below the lip, further below
  GRAB_HOLD: 4,                 // frames of Attack + Special held together that start a grapple
  BK: ['attack', 'special', 'smash', 'jump', 'shield'],
  LAGS: ['move', 'land', 'hitstun', 'roll', 'spot', 'airdodge', 'climb', 'dizzy', 'helpless'],
  n: { buffered: 0, coyote: 0, shortHop: 0, shAerial: 0, autoCancel: 0, clean: 0, parry: 0, tech: 0, knock: 0, getup: 0,
       stunCancel: 0, burst: 0, pump: 0, lethal: 0, finish: 0, counter: 0, di: 0, sdi: 0, shatter: 0, wallTech: 0, saveJump: 0, saveDodge: 0, grabHold: 0 },
  ev: [], evN: 0,     // visual events: { id, k, x, y, t, c, f } (read by 96_v3_feel.mjs / 83_feel_hud.js)
  best: null,         // the match's longest combo { n, dmg, by }

  emit(k, x, y, o) {
    const e = Object.assign({ id: ++FEEL.evN, k, x, y, t: Game.frame }, o);
    FEEL.ev.push(e); if (FEEL.ev.length > 48) FEEL.ev.shift();
    return e;
  },
  fs(f) { return f.fs || (f.fs = { maxCombo: 0, maxDmg: 0, parries: 0, techs: 0, bursts: 0, pumps: 0, lethal: 0, clean: 0, counters: 0, shortHops: 0 }); },
  say(f, s, c, k) { Game.text(f.x, f.y - f.h - 16, s, c, k || 1.1); },
  prs(f, k) { return !!f.in[k] && !f.prev[k]; },

  // ================= input (40_fighter update, after the input is read) =================
  input(f) {
    const fr = Game.frame, i = f.in, p = f.prev, S = f.state;
    f.fpre = S; f.fmv = f.move;
    if (Game.fighters !== FEEL.game) { FEEL.game = Game.fighters; FEEL.ev.length = 0; FEEL.best = null; }
    if (i.shield && !p.shield) {
      f.fSh = fr;
      if (S === 'hitstun' && (!f.fTechL || fr - f.fTechL >= FEEL.TECH_LOCK)) f.fTechT = f.fTechL = fr;
      if (f.air && S === 'move') f.fLcT = fr;
    }
    if (i.special && !p.special) f.fSp = fr;
    if (f.fKnock && S !== 'land') f.fKnock = false;
    if (!f.air && f.jumps < FEEL.jumps(f)) f.jumps = FEEL.jumps(f);   // grounded = full jumps, also when feel is switched on after Game.start
    if (FEEL.command(f)) return;
    if (f.fKnock && f.st >= 6 && FEEL.getup(f)) return;
    if (FEEL.grab(f)) return;   // Attack + Special held: grapple (24_grapple)
    if (f.fKnock && f.st >= f.landT - 1) f.invuln = Math.max(f.invuln, 10);
    // hold-to-hop: jump let go in the first frames of a full ground jump trims it to a short hop
    if (f.fHopT) {
      if (fr - f.fHopT > FEEL.HOP || !f.air || f.vy >= 0) f.fHopT = 0;
      else if (!(i.jump || i.up)) { f.vy += f.c.jump * (1 - FEEL.SHORT); f.fHopT = 0; FEEL.n.shortHop++; FEEL.fs(f).shortHops++; }
    }
    // jump + attack on the same frame: short-hop aerial (else the attack would win as a jab)
    if (S === 'ground' && i.jump && !p.jump && i.attack && !p.attack && !i.shield && !f.item && !Items.near(f)) {
      f.setState('jumpsquat'); f.fShA = true; return;
    }
    // a buffered press fires on the first free frame, unless something new was pressed now
    const b = f.fbuf;
    if (b && (S === 'ground' || S === 'air')) {
      f.fbuf = null;
      if (fr - b.t <= FEEL.BUF && !FEEL.BK.some(k => i[k] && !p[k])) {
        for (const k in b.k) if (b.t - b.k[k] <= 2 && !(k === 'shield' && f.air)) { i[k] = true; p[k] = false; }
        FEEL.n.buffered++;
      }
    }
  },
  // end of update: presses that went unused during lag are buffered; coyote and hop windows open here
  post(f) {
    const pre = f.fpre, S = f.state, fr = Game.frame, i = f.in, p = f.prev;
    if (pre === 'ground' && S === 'air' && f.vy >= 0 && f.dropT <= 0) f.fCoyT = fr;
    if (pre === 'jumpsquat' && S !== 'jumpsquat' && f.air && f.vy < -f.c.jump * 0.8) f.fHopT = fr;
    // wall tech: thrown into the side of the stage while tumbling, with a tech press in the window
    if (pre === 'hitstun' && f.tumble && f.air && f.fpvx && f.fpvx * f.vx <= 0 && Math.abs(f.fpvx) > 3) {
      const M = Game.stage.main, w2 = f.w * 0.4;
      if (f.y > M.top && (Math.abs(f.x - (M.x0 - w2)) < 1.5 || Math.abs(f.x - (M.x1 + w2)) < 1.5)) {
        const ok = f.cpu ? Rng.next() < clamp(f.level * 0.08 - 0.05, 0, 0.7) : !!f.fTechT && fr - f.fTechT <= FEEL.TECH;
        if (ok) {
          const side = f.x < 0 ? 1 : -1;
          f.tumble = false; f.vx = side * 4; f.vy = -5; f.invuln = Math.max(f.invuln, 14); f.setState('air'); f.jumps = f.c.jumps; f.airdodged = false;
          FEEL.say(f, 'WALL TECH', '#9fe8ff', 0.9); Game.ring(f.x, f.y - f.h * 0.5, '#9fe8ff', 46); Sfx.land();
          FEEL.emit('tech', f.x, f.y - f.h * 0.5, { c: f.color }); FEEL.n.wallTech++; FEEL.fs(f).techs++;
        }
      }
    }
    // recovery: up-specials steer harder and hold their rise a touch longer while up is held
    if (S === 'move' && f.air && f.move) {
      const d = f.move.def;
      if (d.airOnce === 'up' || (d.helpless && !d.diag)) {
        const dx = f.dirX();
        if (dx) { f.vx = approach(f.vx, dx * Math.max(4.6, f.c.air * 1.3), 0.55); f.face = dx; }
        if (i.up && f.vy > -2.5 && f.move.t < d.total * 0.6) f.vy -= 0.3;
      }
    }
    f.fpvx = f.vx;
    if (f.fUsed === fr || !FEEL.LAGS.includes(pre)) return;
    if (S === 'move' && f.move !== f.fmv) return;                              // a cancel / iasa / grapple took it
    if (pre === 'move' && S !== 'move' && f.fmv && f.fmv.t < f.fmv.def.total) return;   // the press ended the move early
    if (S !== pre && S !== 'ground' && S !== 'air') return;
    for (const k of FEEL.BK) {
      if (!i[k] || p[k] || (k === 'shield' && f.air)) continue;              // no buffered airdodges
      const b = f.fbuf && fr - f.fbuf.t <= FEEL.BUF ? f.fbuf : (f.fbuf = { t: fr, k: {} });
      b.k[k] = fr; b.t = fr;
    }
  },

  // ================= movement =================
  // airAct start: a jump in the first frames after walking off an edge is still a ground jump
  air(f) {
    const fr = Game.frame;
    if (!f.fCoyT || fr - f.fCoyT > FEEL.COYOTE || !FEEL.prs(f, 'jump')) return false;
    f.fCoyT = 0; f.fUsed = fr;
    f.vy = -f.c.jump; f.fastFall = false; f.fHopT = fr;
    const dx = f.dirX(); if (dx) f.vx = approach(f.vx, dx * f.c.air, 3);
    Sfx.jump(); f.sq = -0.2; FEEL.n.coyote++;
    return true;
  },
  // jumpSquat start: jump + attack together (or attack on the first squat frame) = short-hop aerial
  squat(f) {
    if (!f.fShA) {
      if (f.st <= 1 && FEEL.prs(f, 'attack') && !f.item) { f.fShA = true; f.fUsed = Game.frame; } else return false;
    }
    f.fric(0.9);
    if (f.st >= 3) {
      f.fShA = false;
      f.leaveGround(); f.vy = -f.c.jump * FEEL.SHORT;
      const dx = f.dirX(); if (dx) f.vx = approach(f.vx, dx * f.c.air, 3);
      f.setState('air'); Sfx.jump(); f.sq = -0.2; FEEL.n.shAerial++;
      f.aerial(dx);
    }
    return true;
  },
  // every fighter gets at least two air jumps under local rules (multi-jump fighters keep theirs)
  // Everyone gets two air jumps in normal play (three total), so you can always climb back from a
  // fall; multi-jump fighters keep whatever more they have. The seeded bet arena is excluded, so
  // ARENA.version 1 stays bit-identical.
  jumps(f) { return (Game.feel || Game.combos) ? Math.max(2, f.c.jumps) : f.c.jumps; },
  // rising fighters below the stage lip can still snap to a ledge
  snap(f) { return f.vy > -9 && f.y > Game.stage.main.top + 6; },
  // but walking off an edge must not grab it: that window belongs to the coyote jump
  ledgeOK(f) { return !f.fCoyT || Game.frame - f.fCoyT > FEEL.COYOTE; },
  // helpless (after an up-special) still allows one air jump or an airdodge: recoveries stop being a death sentence
  helpless(f) {
    const fr = Game.frame;
    if (FEEL.prs(f, 'jump') && f.jumps > 0) {
      f.jumps--; f.fUsed = fr; f.setState('air'); f.vy = -f.c.djump * 0.92; f.fastFall = false;
      const dx = f.dirX(); if (dx) { f.vx = dx * f.c.air; f.face = dx; }
      Sfx.jump(); Game.ring(f.x, f.y - f.h * 0.4, f.color, 34); FEEL.n.saveJump++;
      return true;
    }
    if (FEEL.prs(f, 'shield') && !f.airdodged) { f.fUsed = fr; f.setState('air'); f.startAirdodge(f.dirX()); FEEL.n.saveDodge++; return true; }
    return false;
  },
  // aerials: holding down with a direction is a diagonal kick (down-forward / down-back), built from the
  // fighter's own fair / bair so every roster file gets one for free
  DIAG: new Map(),
  aerial(f, dx) {
    if (!dx || !f.in.down || f.in.up || f.item) return null;
    const m = f.m, base = dx === f.face ? m.fair : m.bair;
    if (!base || !base.hits || !base.hits.length || base.tick || base.start) return null;
    let d = FEEL.DIAG.get(base);
    if (!d) {
      d = Object.assign({}, base, { base, clip: 'flykick', diag: true });
      d.hits = base.hits.map(h => Object.assign({}, h, { y: h.y + f.h * 0.42, x: h.x * 0.82, ang: -40, dmg: h.dmg * 0.96, r: h.r + 2 }));
      FEEL.DIAG.set(base, d);
    }
    return d;
  },
  // Attack + Special HELD together near a grounded opponent starts the grapple, so it is findable by mashing
  // (24_grapple keeps its frame-perfect version)
  grab(f) {
    const i = f.in, S = f.state, mv = f.move;
    if (!i.attack || !i.special) { f.fGrabT = 0; return false; }
    if (!Game.combos || f.finalReady || f.item || f.air) return false;
    // neutral, or the first frames of the jab / special that the other button just interrupted
    const early = S === 'move' && mv && mv.t <= 8 && mv.def !== GRAPPLE.LUNGE && !mv.def.gStage && !mv.def.holdVictim && !mv.def.charge;
    if (S !== 'ground' && !early) { f.fGrabT = 0; return false; }
    if (!f.fGrabT) { f.fGrabT = Game.frame; return false; }
    if (Game.frame - f.fGrabT < (early ? 2 : FEEL.GRAB_HOLD)) return false;
    let near = false;
    for (const g of Game.fighters) {
      if (g === f || g.air || g.untouchable || g.state === 'dead' || Math.abs(g.y - f.y) > 30) continue;
      if (Math.abs(g.x - f.x) < f.w * 0.5 + 58 + g.w * 0.4) { near = true; if ((g.x - f.x) * f.face < 0) f.face = -f.face; break; }
    }
    if (!near) return false;
    f.fGrabT = 0; f.fUsed = Game.frame; FEEL.n.grabHold++;
    return GRAPPLE.start(f);
  },
  // onLand, an aerial touching down: late autocancel, clean landing (shield just before touchdown)
  landMove(f, d) {
    const mv = f.move;
    if (!mv.air || d.helpless) return false;
    let lag = d.landLag || 8, last = -1;
    if (d.hits) for (const h of d.hits) last = Math.max(last, h.f[1]);
    if (last >= 0 && last < 100 && mv.t > last + 6) { lag = Math.min(lag, 4); FEEL.n.autoCancel++; }
    const clean = f.cpu ? Rng.next() < f.level * 0.05 : f.fLcT && Game.frame - f.fLcT <= FEEL.LCANCEL;
    if (clean && lag > 4) {
      lag = Math.max(3, Math.ceil(lag / 2)); f.fLcT = 0; FEEL.n.clean++; FEEL.fs(f).clean++;
      Game.ring(f.x, f.y - 4, '#bff4ff', 34); FEEL.emit('clean', f.x, f.y, { c: f.color });
    }
    f.move = null; f.setState('land'); f.landT = lag; f.sq = 0.18; Sfx.land();
    return true;
  },
  // shield released: 7 frames of lag, unless a parry just happened (then the defender is free)
  unshield(f) {
    if (f.fParryT && Game.frame - f.fParryT <= 20) return f.setState('ground');
    f.fDropT = Game.frame; f.setState('land'); f.landT = FEEL.DROP_LAG;
  },

  // ================= getting hit (41_combat takeHit) =================
  // before damage: stale moves, counter hits, combo scaling. Returns the new damage multiplier.
  mult(v, hb, att, m) {
    v.fCounter = false;
    if (!att || att === v || hb.fPush) return m;
    let k = 1;
    const mv = att.move, melee = !!hb.f && !!mv && !!mv.def.hits && mv.def.hits.includes(hb);
    if (melee) {
      if (mv.fStale == null) { const key = mv.def.base || mv.def; mv.fStale = FEEL.stale(att, key); FEEL.queue(att, key); }
      k *= mv.fStale;
      const vm = v.move;
      if (v.state === 'move' && vm && vm.def.hits && vm.def.hits.length && !vm.def.gStage) {
        let f0 = 1e9; for (const h of vm.def.hits) f0 = Math.min(f0, h.f[0]);
        if (vm.t < f0) { v.fCounter = true; k *= 1.1; }
      }
    }
    // combo scaling counts moves, not hits: a flurry is one step
    const c = v.combo, live = c && c.by === att && (v.state === 'hitstun' || v.state === 'grabbed');
    const src = melee ? mv : hb;
    if (!live) { v.fPro = 1; v.fProSrc = src; }
    else if (v.fProSrc !== src) { v.fPro = (v.fPro || 1) + 1; v.fProSrc = src; }
    const toss = !hb.f && Math.abs(hb.x || 0) === 10;
    if (v.fPro >= 4 && !toss) k *= Math.max(0.5, 1 - 0.1 * (v.fPro - 3));
    const tu = FEEL.TUNE[att.c.id]; if (tu) k *= tu[0];
    return m * k;
  },
  stale(a, key) {
    const q = a.fQ || []; let s = 1, seen = false;
    for (let i = 0; i < q.length; i++) if (q[i] === key) { s -= FEEL.STALE[i]; seen = true; }
    return seen ? s : FEEL.FRESH;
  },
  queue(a, key) { const q = a.fQ || (a.fQ = []); q.unshift(key); if (q.length > 9) q.pop(); },
  // knockback: rage (the attacker's own damage), global scale
  kb(v, hb, att, kb) {
    FEEL.slow0 = Game.slowT; FEEL.lag0 = att ? att.hitlag : 0;
    if (att && att !== v && !hb.fPush) kb *= 1 + clamp((att.dmg - 35) / 115, 0, 1) * 0.1;
    const tu = FEEL.TUNE[v.c.id]; if (tu) kb *= tu[1];
    v.fCrouched = !!v.crouch;
    if (v.fCrouched) kb *= 0.85;   // ducking under a hit softens it (Smash's crouch cancel)
    return kb * FEEL.KB;
  },
  // after the stock hit handling (velocities, hitstun, hitlag and the stock effects are set)
  hit(v, att, hb, d, kb) {
    const G = Game, fr = G.frame, other = att && att !== v;
    if (v.fPro >= 5) v.hitstun = Math.floor(v.hitstun * Math.max(0.55, 1 - 0.06 * (v.fPro - 4)));
    const proj = !hb.f && !!hb.radial;
    let lag = Math.floor(d * 0.65 + 6);
    if (hb.rehit) lag = Math.floor(lag * 0.5);
    if (proj) lag = Math.floor(lag * 0.75);
    if (G.fighters.length > 2) lag = Math.floor(lag * 0.85);
    if (v.fCrouched) lag = Math.floor(lag * 0.67);
    lag = clamp(lag, 3, 24);
    let lethal = false, finish = false;
    if (kb > 85 && other && v.state === 'hitstun' && !hb.fPush) {
      // the hit that would end the match gets the loose check (Smash's Finish Zoom ignores DI too); others must be sure
      finish = !G.demo && v.stocks === 1 && G.fighters.filter(g => g !== v && g.stocks > 0).length === 1 && FEEL.flight(v, v.vx, v.vy, 20);
      lethal = finish || FEEL.sure(v);
    }
    if (G.slowT > FEEL.slow0 && !lethal && kb < 220) G.slowT = FEEL.slow0;   // stock slow-mo only on hits that matter
    if (lethal) {
      lag = finish ? 30 : Math.min(30, Math.floor(lag * 1.4) + 2);
      v.fLethalT = fr; FEEL.n.lethal++; FEEL.fs(att).lethal++;
      G.impact = { x: v.x, y: v.y - v.h / 2, t: 30 };
      G.shake(finish ? 26 : 14);
      if (finish) { G.slowT = Math.max(G.slowT, 48); G.flashT = Math.max(G.flashT, 3); FEEL.n.finish++; }
      else if (!G.demo) G.slowT = Math.max(G.slowT, 10);
      FEEL.emit(finish ? 'finish' : 'lethal', v.x, v.y - v.h / 2, { c: att.color, f: v, a: att, dir: v.vx >= 0 ? 1 : -1 });
    }
    if (v.fCounter && other) {
      lag += 4; FEEL.n.counter++; FEEL.fs(att).counters++;
      FEEL.emit('counter', v.x, v.y - v.h / 2, { c: att.color, a: att });   // drawn as a side tag by 83_feel_hud (Tekken style), not in the world
    }
    v.hitlag = lag;
    if (other && !proj) att.hitlag = Math.max(FEEL.lag0, lag);
    // swords wear out: feelSword.hits landed swings, then they shatter (they were 18.5% of all KOs)
    const it = other && att.item, sw = it && ITEM_DEFS[it.kind] && ITEM_DEFS[it.kind].feelSword;
    if (sw && hb.f && att.move && att.move.def.weapon && !att.move.fWore) {
      att.move.fWore = true; it.fDur = (it.fDur == null ? sw.hits : it.fDur) - 1;
      if (it.fDur <= 0) { att.item = null; FEEL.n.shatter++; FEEL.say(att, 'SHATTERED', '#bfe6ff', 1); Game.burst(att.x + att.face * att.w * 0.6, att.y - att.h * 0.5, sw.color, 18); Sfx.tone(1800, 400, 0.2, 'square', 0.08); }
    }
    if (other && !hb.fPush) {
      if (!(att.powerT > 0)) FEEL.gain(att, d * FEEL.GAIN_DEALT);
      FEEL.gain(v, d * FEEL.GAIN_TAKEN);
      const c = v.combo, s = FEEL.fs(att);
      if (c && c.by === att && c.n >= 2) {
        if (c.n > s.maxCombo) s.maxCombo = c.n;
        if (c.dmg > s.maxDmg) s.maxDmg = c.dmg;
        if (!FEEL.best || c.n > FEEL.best.n) FEEL.best = { n: c.n, dmg: c.dmg, by: att.idx };
      }
    }
  },
  gain(f, x) {
    const was = f.pump || 0;
    f.pump = Math.min(100, was + x);
    if (was < FEEL.BURST_COST && f.pump >= FEEL.BURST_COST) FEEL.emit('meter', f.x, f.y, { f, lvl: 1 });
    if (was < 100 && f.pump >= 100) { FEEL.emit('meter', f.x, f.y, { f, lvl: 2 }); FEEL.say(f, 'PUMP READY', '#ffd23f', 0.9); }
  },
  // lethal whatever the victim does: the launch KOs with no DI, with DI either way, and 4% weaker
  sure(v) {
    for (const a of [0, FEEL.DI, -FEEL.DI]) {
      const c = dcos(a) * 0.96, s = dsin(a) * 0.96;
      if (!FEEL.flight(v, v.vx * c - v.vy * s, v.vx * s + v.vy * c)) return false;
    }
    return true;
  },
  // will this launch cross a blast line? (the fight's own hitstun physics, no DI, no recovery)
  // strict (default): once hitstun ends (plus a human beat) the victim can airdodge its momentum away, and a
  // slowed tumble can from frame 40; loose (extra frames given): the launch alone, like Smash's Finish Zoom
  flight(v, vx, vy, extra) {
    const loose = extra != null, st = Game.stage, B = st.blast, M = st.main, c = v.c, n = Math.min(v.hitstun + (loose ? extra : 6), 160), cap = c.fall * 1.5;
    let x = v.x, y = v.y;
    for (let t = 0; t < n; t++) {
      if (!loose && t >= 40 && vx * vx + vy * vy <= 72) return false;
      vy += c.grav * 0.6; if (vy > cap) vy = Math.max(cap, vy * 0.98);
      vx *= 0.975;
      const py = y; x += vx; y += vy;
      if (x < B.l || x > B.r || y > B.b) return true;
      if (y - v.h < B.t && t < v.hitstun) return true;
      if (vy > 0 && py <= M.top && y >= M.top && x >= M.x0 && x <= M.x1) return false;
    }
    return false;
  },

  // ================= hitlag (40_fighter update, frozen frames) =================
  // victim: SDI on fresh stick presses, DI on the last frozen frame; a tech or burst press counts here too
  lag(f) {
    if (f.state !== 'hitstun') return;
    const fr = Game.frame;
    if (!f.cpu) {
      const inp = readInput(f.ctrl), was = f.fLagT === fr - 1 && f.fLagIn ? f.fLagIn : f.in;
      f.fLagIn = inp; f.fLagT = fr;
      const dx = (inp.right && !was.right ? 1 : 0) - (inp.left && !was.left ? 1 : 0), dy = (inp.down && !was.down ? 1 : 0) - (inp.up && !was.up ? 1 : 0);
      if ((dx || dy) && (!f.fSdiT || fr - f.fSdiT >= 3)) { const m = dhypot(dx, dy); f.x += dx / m * FEEL.SDI; f.y += Math.min(0, dy / m * FEEL.SDI); f.fSdiT = fr; FEEL.n.sdi++; }
      if (inp.shield && !was.shield) { f.fSh = fr; if (!f.fTechL || fr - f.fTechL >= FEEL.TECH_LOCK) f.fTechT = f.fTechL = fr; }
      if (inp.special && !was.special) f.fSp = fr;
      if (f.fSh && f.fSp && Math.abs(f.fSh - f.fSp) <= 6 && fr - Math.max(f.fSh, f.fSp) <= 1) f.fBQ = fr;   // Burst asked for during the freeze: fires when it ends
      if (f.hitlag === 0) FEEL.di(f, (inp.right ? 1 : 0) - (inp.left ? 1 : 0), (inp.down ? 1 : 0) - (inp.up ? 1 : 0));
    } else if (f.hitlag === 0) FEEL.cpuDI(f);
  },
  di(f, sx, sy) {
    if (!sx && !sy) return;
    const V = dhypot(f.vx, f.vy); if (V < 0.5) return;
    const m = dhypot(sx, sy), lx = f.vx / V, ly = f.vy / V;
    FEEL.rot(f, FEEL.DI * (lx * (sy / m) - ly * (sx / m)));
  },
  rot(f, a) {
    const c = dcos(a), s = dsin(a), vx = f.vx, vy = f.vy;
    f.vx = vx * c - vy * s; f.vy = vx * s + vy * c; FEEL.n.di++;
  },
  // CPU DI: better CPUs DI more often; lethal launches get survival DI, the rest DI away from the attacker
  cpuDI(f) {
    if (Rng.next() >= f.level * 0.085) return;
    const V = dhypot(f.vx, f.vy); if (V < 2) return;
    const tries = [FEEL.DI, -FEEL.DI], att = f.lastHitBy;
    let best = 0, score = -1e9;
    for (const a of tries) {
      const c = dcos(a), s = dsin(a), vx = f.vx * c - f.vy * s, vy = f.vx * s + f.vy * c;
      let sc = FEEL.flight(f, vx, vy) ? -1000 : 0;
      if (att) sc += Math.abs(f.x + vx * 10 - att.x) * 0.1;
      sc -= Math.abs(f.x + vx * 20) * 0.02;   // and stay nearer the stage
      if (sc > score) { score = sc; best = a; }
    }
    FEEL.rot(f, best);
  },

  // ================= hitstun + landing =================
  // hitstun state: out of a long tumble, airdodge from frame 40 and act from frame 45 once the launch has slowed
  stun(f) {
    if (!f.tumble || !f.air || f.st < 40 || f.vx * f.vx + f.vy * f.vy > 72) return false;
    const fr = Game.frame;
    if (FEEL.prs(f, 'shield') && !f.airdodged && !FEEL.floorSoon(f, 12)) { f.tumble = false; f.fUsed = fr; f.setState('air'); f.startAirdodge(f.dirX()); FEEL.n.stunCancel++; return true; }
    if (f.st >= 45 && (FEEL.prs(f, 'attack') || FEEL.prs(f, 'smash') || FEEL.prs(f, 'special') || (FEEL.prs(f, 'jump') && f.jumps > 0))) {
      f.tumble = false; f.fUsed = fr; f.setState('air'); f.airAct(); FEEL.n.stunCancel++; return true;
    }
    return false;
  },
  // falling onto a floor within n frames? (then a shield press is a tech, not an airdodge)
  floorSoon(f, n) {
    if (f.vy <= 0) return false;
    const st = Game.stage, M = st.main, y1 = f.y + f.vy * n;
    if (f.x >= M.x0 && f.x <= M.x1 && f.y <= M.top && y1 >= M.top) return true;
    for (const p of st.plats) if (f.x >= p.x0 && f.x <= p.x1 && f.y <= p.y && y1 >= p.y) return true;
    return false;
  },
  // onLand while tumbling: tech (in place or roll) or a knockdown with get-up options
  tech(f, vy) {
    if (!f.tumble) return false;
    const fr = Game.frame;
    const ok = f.cpu ? Rng.next() < clamp(f.level * 0.095 - 0.05, 0, 0.8) : !!f.fTechT && fr - f.fTechT <= FEEL.TECH;
    if (ok) {
      f.tumble = false; f.fTechT = 0; f.fUsed = fr; f.vy = 0;
      const dx = f.cpu ? [0, -1, 1][irand(0, 2)] : f.dirX();
      if (dx) { f.startRoll(dx); f.invuln = Math.max(f.invuln, 16); }
      else { f.setState('land'); f.landT = 18; f.vx = 0; f.invuln = Math.max(f.invuln, 18); }
      FEEL.say(f, 'TECH', '#9fe8ff', 0.9); Game.ring(f.x, f.y - 6, '#9fe8ff', 46); Sfx.land();
      FEEL.emit('tech', f.x, f.y, { c: f.color }); FEEL.n.tech++; FEEL.fs(f).techs++;
      return true;
    }
    if (vy > 8) return false;   // a hard landing keeps the stock ground bounce
    f.tumble = false; f.setState('land'); f.landT = 34; f.fKnock = true; f.vx *= 0.3;
    Sfx.land(); FEEL.n.knock++;
    return true;
  },
  getup(f) {
    let did = true;
    if (FEEL.prs(f, 'attack') || FEEL.prs(f, 'smash')) { f.fKnock = false; f.startMove(f.m.getup); f.invuln = Math.max(f.invuln, 12); }
    else if (FEEL.prs(f, 'left') || FEEL.prs(f, 'right')) { f.fKnock = false; f.startRoll(f.dirX()); f.invuln = Math.max(f.invuln, 14); }
    else if (FEEL.prs(f, 'jump') || FEEL.prs(f, 'up') || FEEL.prs(f, 'shield')) { f.fKnock = false; f.setState('ground'); f.invuln = Math.max(f.invuln, 10); }
    else did = false;
    if (did) { f.fUsed = Game.frame; FEEL.n.getup++; }
    return did;
  },

  // ================= defense =================
  // Game.shieldHit: a hit on a fresh shield is a parry
  shield(b, dmg, srcX, a) {
    if (b.state !== 'shield' || b.st > FEEL.PARRY_UP) return false;
    return FEEL.parry(b, dmg, a);
  },
  // Game.resolveHits: a hit that arrives just after the shield came down is a parry too
  dropParry(b, dmg, a) {
    if (b.state !== 'land' || !b.fDropT || Game.frame - b.fDropT > FEEL.PARRY_DROP) return false;
    b.setState('ground');
    return FEEL.parry(b, dmg, a);
  },
  parry(b, dmg, a) {
    const G = Game;
    b.fParryT = G.frame; b.hitlag = 3; b.flashT = 6; b.vx = 0;
    if (a && a !== b) { a.hitlag = Math.max(a.hitlag, clamp(Math.floor(14 + dmg * 0.6), 14, 28)); a.flashT = 10; }
    FEEL.gain(b, FEEL.GAIN_PARRY);
    FEEL.say(b, 'PARRY', '#7ff0ff', 1.3); G.ring(b.x, b.y - b.h / 2, '#7ff0ff', 76); G.ring(b.x, b.y - b.h / 2, '#ffffff', 40);
    Sfx.shield(); Sfx.tone(1568, 2349, 0.14, 'sine', 0.16);
    if (!G.demo) G.slowT = Math.max(G.slowT, 9);
    FEEL.emit('parry', b.x, b.y - b.h / 2, { c: b.color, f: b }); FEEL.n.parry++; FEEL.fs(b).parries++;
    return true;
  },

  // ================= PUMP meter: Shield + Special =================
  command(f) {
    const fr = Game.frame, S = f.state, sh = f.fSh || -99, sp = f.fSp || -99, stun = S === 'hitstun' || S === 'grabbed';
    const win = stun ? 6 : 3, queued = stun && f.fBQ && fr - f.fBQ <= 30;
    if (!queued && (fr - sh > win || fr - sp > win || (sh !== fr && sp !== fr && !stun))) return false;
    f.fBQ = 0;
    const pump = f.pump || 0;
    // Burst breaks combos and holds, not a lone launch: the combo counter must be up (2+ hits) or the fighter held,
    // and never out of a launch that was already called lethal
    const breakable = S === 'grabbed' || (f.combo && f.combo.n >= 2);
    if (stun && breakable && pump >= FEEL.BURST_COST && !(f.fLethalT != null && fr - f.fLethalT < 120)) { f.fSh = f.fSp = -99; return FEEL.burst(f); }
    if (pump >= 100 && !(f.powerT > 0) && FEEL.free(f)) { f.fSh = f.fSp = -99; return FEEL.pumpUp(f); }
    return false;
  },
  free(f) {
    const S = f.state, mv = f.move;
    if (S === 'ground' || S === 'air' || S === 'shield' || S === 'jumpsquat') return true;
    if (S === 'airdodge') return f.st <= 3;
    if (S === 'move' && mv && mv.t <= 3) { const d = mv.def.base || mv.def, m = f.m; return d === m.nb || d === m.sb || d === m.ub || d === m.db || (!!m.db && (d === m.db.ground || d === m.db.air)); }
    return false;
  },
  BURST: { total: 28, clip: 'cast', sfx: 'none', tick(f, t) { if (t < 12) { f.noGrav = true; f.vx *= 0.5; f.vy *= 0.5; } } },
  PUMP: { total: 26, clip: 'cast', sfx: 'none', tick(f) { f.vx *= 0.7; if (f.air) f.vy = Math.min(f.vy, 1); } },
  // push everyone near f away (a light, fixed launch)
  shove(f, R, hb) {
    for (const g of Game.fighters) {
      if (g === f || g.state === 'dead' || g.untouchable || dhypot(g.x - f.x, (g.y - g.h / 2) - (f.y - f.h / 2)) > R) continue;
      g.takeHit(Object.assign({ radial: true, fPush: true }, hb), f, 1, f.x, 1);
    }
  },
  burst(f) {
    const G = Game;
    f.pump -= FEEL.BURST_COST;
    if (f.state === 'grabbed') {
      const g = f.grabber;
      if (g) { if (g.grabbed === f) g.grabbed = null; if (g.state === 'grabbing') g.setState(g.air ? 'air' : 'ground'); }
      f.grabber = null; f.cgrabbed = false;
    }
    f.combo = null; f.tumble = false; f.hitlag = 0; f.fUsed = G.frame; f.airdodged = false;
    f.startMove(FEEL.BURST); f.invuln = Math.max(f.invuln, 30); f.vx = 0; f.vy = f.air ? -2 : 0;
    FEEL.shove(f, 200, { dmg: 3, ang: 40, bkb: 80, kbg: 0 });
    FEEL.say(f, 'BURST', '#ffffff', 1.6); G.ring(f.x, f.y - f.h / 2, f.color, 220); G.ring(f.x, f.y - f.h / 2, '#ffffff', 120);
    G.shake(12); G.flashT = Math.max(G.flashT, 4); Sfx.hit(0.7); Sfx.tone(220, 880, 0.3, 'sawtooth', 0.12);
    FEEL.emit('burst', f.x, f.y - f.h / 2, { c: f.color, f }); FEEL.n.burst++; FEEL.fs(f).bursts++;
    return true;
  },
  pumpUp(f) {
    const G = Game;
    f.pump = 0; f.fUsed = G.frame; f.airdodged = f.state === 'airdodge' ? true : f.airdodged;
    f.startMove(FEEL.PUMP); f.powerT = FEEL.PUMP_T; f.invuln = Math.max(f.invuln, 26);
    FEEL.shove(f, 170, { dmg: 4, ang: 45, bkb: 66, kbg: 0 });
    FEEL.say(f, 'PUMP MODE', '#ffd23f', 1.8); G.ring(f.x, f.y - f.h / 2, '#ffd23f', 200); G.ring(f.x, f.y - f.h / 2, '#7dff8a', 120);
    G.flashT = Math.max(G.flashT, 6); G.shake(14); Sfx.ko();
    if (!G.demo) G.slowT = Math.max(G.slowT, 18);
    FEEL.emit('pump', f.x, f.y - f.h / 2, { c: f.color, f }); FEEL.n.pump++; FEEL.fs(f).pumps++;
    return true;
  },

  // ================= items and stages under local rules =================
  // Game.itemRate: 'off' | 'normal' (default, the calmer cadence) | 'mayhem' (the old rate).
  // RATES[rate] = [first item, next item, first crate, next crate] frame ranges (55_items, 56_items2).
  rate() { const r = Game.itemRate; return r === 'off' || r === 'mayhem' ? r : 'normal'; },
  span(i) { const R = FEEL.RATES[FEEL.rate()]; return R ? irand(R[i][0], R[i][1]) : 99999; },
  spawnT(first) { return FEEL.span(first ? 0 : 1); },
  crateT(first) { return FEEL.span(first ? 2 : 3); },

  // blast-line trims for the stages that played slowest (see docs/GAMEFEEL.md). Local rules only; the stage
  // files (64_stages2.js, 95_v3_stages.mjs) are the stage agent's, so this is a data override, not an edit.
  STAGE: {
    moon:   { l: -900, r: 900, t: -530 }, isle:  { l: -910, r: 910, t: -535 },
    city:   { l: -990, r: 990, t: -560 }, peak:  { l: -900, r: 900, t: -520 },
    floor:  { l: -920, r: 920, t: -525 }, casino: { l: -920, r: 920, t: -535 },
    lunar:  { l: -930, r: 930, t: -525 }, swamp: { l: -920, r: 920, t: -530 },
    street: { l: -950, r: 950, t: -570 }, ship:  { l: -960, r: 960, t: -580 },
  },
  // applied on the first frame of a match, not in Game.start: callers that flip Game.feel on after start
  // (the online driver, dev/feelbench.js) must get it too
  stage(st) {
    if (!st || st.fBlast) return;
    st.fBlast = true;
    const o = FEEL.STAGE[st.id];
    if (o) for (const k of ['l', 'r', 't', 'b']) if (o[k] != null) st.blast[k] = o[k];
  },

  // once per frame (Game.step): TNT craters close again after HOLE_T frames
  HOLE_T: 1200,
  tick() {
    const G = Game, H = G.holes;
    FEEL.stage(G.stage);
    if (!H.length) return;
    const keep = H.filter(q => G.frame - q.t < FEEL.HOLE_T);
    if (keep.length === H.length) return;
    const gone = H.filter(q => !keep.includes(q)), st = G.stage, M = st.main;
    G.holes = keep;
    // rebuild the ledge list the way Items2.hole does: the stage's own two plus both edges of every live crater
    if (st.baseLedges) {
      const next = st.baseLedges.slice();
      for (const q of keep) {
        next.push(st.ledges.find(L => L.x === q.x0 && L.side === 1) || { x: q.x0, y: M.top, side: 1, holder: null });
        next.push(st.ledges.find(L => L.x === q.x1 && L.side === -1) || { x: q.x1, y: M.top, side: -1, holder: null });
      }
      for (const L of st.ledges) if (!next.includes(L) && L.holder && L.holder.state === 'ledge') { const h = L.holder; h.ledge = null; h.air = true; h.plat = null; h.setState('air'); }
      st.ledges = next;
    }
    for (const q of gone) {
      const x = (q.x0 + q.x1) / 2;
      for (const f of G.fighters) {   // anyone still down in the crater is lifted back onto the floor
        if (f.state === 'dead' || f.x < q.x0 || f.x > q.x1 || f.y <= M.top || f.y > M.bot + 60) continue;
        f.y = M.top; f.vy = Math.min(f.vy, -2); f.air = true; f.plat = null;
      }
      Game.text(x, M.top - 60, 'REPAIRED', '#9fe8ff', 1.1); Game.ring(x, M.top - 10, '#9fe8ff', (q.x1 - q.x0) * 0.8);
      FEEL.emit('heal', x, M.top - 10, { c: '#9fe8ff', w: q.x1 - q.x0 });
    }
  },

  // ================= results: highlights for the results screen (read only) =================
  // [{ idx, id, name, cpu, kos, falls, dealt, maxCombo, maxComboDmg, parries, techs, bursts, pumps, lethal, counters, clean }]
  // plus the match's best combo and the finishing blow. Safe to call any time; never changes the fight.
  summary() {
    const F = Game.fighters, fin = [...FEEL.ev].reverse().find(e => e.k === 'finish');
    return {
      fighters: F.map(f => {
        const s = f.fs || {};
        return { idx: f.idx, id: f.c.id, name: f.c.name, cpu: f.cpu, kos: f.stats.kos, falls: f.stats.falls, dealt: Math.round(f.stats.dealt),
          maxCombo: s.maxCombo || 0, maxComboDmg: Math.round(s.maxDmg || 0), parries: s.parries || 0, techs: s.techs || 0, bursts: s.bursts || 0,
          pumps: s.pumps || 0, lethal: s.lethal || 0, counters: s.counters || 0, clean: s.clean || 0 };
      }),
      best: FEEL.best ? { n: FEEL.best.n, dmg: Math.round(FEEL.best.dmg), by: FEEL.best.by } : null,
      finish: fin && fin.a ? { by: fin.a.idx, on: fin.f ? fin.f.idx : null } : null,
    };
  },

  // ================= KO (Game.ko, before the stock is taken) =================
  ko(f) {
    f.fQ = null; f.fKnock = false; f.fbuf = null;
    FEEL.emit('ko', f.x, f.y - f.h / 2, { c: f.color, f, last: f.stocks <= 1 });
  },

  // ================= CPU (50_ai think, after the combo follow-ups) =================
  // returns true when it decided this frame's input
  ai(f, st, o, press) {
    const a = f.ai, lv = f.level, S = f.state;
    if (S === 'hitstun' || S === 'grabbed') {
      const c = f.combo;
      if ((f.pump || 0) >= FEEL.BURST_COST && lv >= 3 && c && c.n >= 2 && f.hitlag <= 0) {
        const key = c.id * 100 + c.n;
        if (a.fBK !== key) { a.fBK = key; a.fBG = c.n >= 3 + Math.floor((9 - lv) / 2) && Rng.next() < 0.1 * lv; }
        if (a.fBG) { press('shield'); press('special'); return true; }
      }
      if (S === 'hitstun' && f.tumble && f.air && f.st >= 45 && lv >= 4 && f.vx * f.vx + f.vy * f.vy <= 72 && Rng.next() < 0.025 * lv) {
        o[f.x < 0 ? 'right' : 'left'] = true; press(Rng.next() < 0.5 ? 'shield' : 'jump'); return true;
      }
      return true;
    }
    // helpless after an up-special: a CPU can now save itself with the extra air jump or an airdodge
    if (S === 'helpless' && f.air && lv >= 2) {
      const M = st.main, home = f.x < 0 ? 'right' : 'left', out = f.x < M.x0 || f.x > M.x1 || f.y > M.top + 20;
      o[home] = true;
      if (out && f.vy > 0 && Rng.next() < 0.05 + lv * 0.03) {
        if (f.jumps > 0) press('jump');
        else if (!f.airdodged && f.y > M.top - 40) press('shield');
      }
      return true;
    }
    if (S === 'land' && f.fKnock) {
      if (!a.fGetT) a.fGetT = 6 + irand(0, Math.max(1, 16 - lv));
      if (f.st >= a.fGetT) {
        a.fGetT = 0; const tgt = AI.target(f), r = Rng.next();
        if (tgt && Math.abs(tgt.x - f.x) < 100 && r < 0.45) press('attack');
        else if (r < 0.75) o[f.x < 0 ? 'right' : 'left'] = true;
        else press('jump');
      }
      return true;
    }
    const tgt = AI.target(f); if (!tgt) return false;
    const dx = tgt.x - f.x, adx = Math.abs(dx), dir = dx > 0 ? 1 : -1, key = d => (d > 0 ? 'right' : 'left');
    // attention: lower levels hesitate now and then (a beginner's pause), never while recovering
    const M = st.main, onStage = !f.air || (f.x > M.x0 - 6 && f.x < M.x1 + 6 && f.y <= M.top + 4);
    if (a.fIdle > 0) { a.fIdle--; if (onStage && (S === 'ground' || S === 'air')) { if (a.fIdleDir) o[a.fIdleDir] = true; return true; } }
    else if (lv < 9 && onStage && S === 'ground' && Rng.next() < (9 - lv) * 0.0045) {
      a.fIdle = (9 - lv) * 4 + irand(0, 8); a.fIdleDir = Rng.next() < 0.5 ? null : Rng.next() < 0.5 ? 'left' : 'right';
    }
    if ((f.pump || 0) >= 100 && !(f.powerT > 0) && (S === 'ground' || S === 'air') && dhypot(dx, tgt.y - f.y) < 220 && Rng.next() < 0.02 + lv * 0.01) {
      press('shield'); press('special'); return true;
    }
    // just parried: the attacker is frozen, punish it
    if (f.fParryT && Game.frame - f.fParryT <= 16 && tgt.hitlag > 1 && adx < 150 && (S === 'shield' || S === 'ground')) {
      o.shield = false; if (S === 'shield') return true;
      if (f.face !== dir) { o[key(dir)] = true; return true; }
      const r = Rng.next();
      if (adx < f.w * 0.5 + 40 + tgt.w * 0.4 && r < 0.4) { o[key(dir)] = true; press('attack'); press('special'); }   // grapple (24_grapple)
      else if (tgt.dmg > 85 || r < 0.6) { o[key(dir)] = true; press('smash'); }
      else { o.up = true; press('attack'); }
      return true;
    }
    if ((S === 'ground' || S === 'shield') && FEEL.aiGuard(f, tgt, o, press)) return true;
    if (S === 'ground' && FEEL.aiPunish(f, tgt, o, press)) return true;
    return FEEL.aiChase(f, tgt, o, press);
  },
  // whiff / landing punish: the opponent's move is past its hitboxes (or it is stuck landing) and close enough
  // to reach in time: run in and hit it. Decided once per opening, better CPUs more often.
  aiPunish(f, tgt, o, press) {
    const a = f.ai, lv = f.level, tm = tgt.state === 'move' ? tgt.move : null;
    let left = 0, id = null;
    if (tm && tm.def.hits && tm.def.hits.length && !tm.def.gStage) {
      let last = -1; for (const h of tm.def.hits) last = Math.max(last, h.f[1]);
      if (last < 100 && tm.t > last) { left = tm.def.total - tm.t; id = tm; }
    } else if (tgt.state === 'land') { left = tgt.fKnock ? Math.min(tgt.landT - tgt.st, 22) : tgt.landT - tgt.st; id = 'land' + (tgt.t - tgt.st); }
    else if (tgt.state === 'dizzy') { left = 150 - tgt.st; id = 'dizzy'; }
    if (!id || tgt.air || Math.abs(tgt.y - f.y) > 30) { a.fPun = null; return false; }
    if (a.fPunId !== id) { a.fPunId = id; a.fPun = lv >= 3 && Rng.next() < 0.09 * lv; }
    if (!a.fPun) return false;
    const dx = tgt.x - f.x, adx = Math.abs(dx), dir = dx > 0 ? 1 : -1, toward = dir > 0 ? 'right' : 'left';
    const range = f.w * 0.5 + 44 * (f.c.reach || 1) + tgt.w * 0.35;
    if (adx > range + (left - 6) * f.c.walk) return false;   // can't get there in time
    if (adx > range * 0.9) { o[toward] = true; return true; }
    if (f.face !== dir) { o[toward] = true; return true; }
    a.fPun = false;
    const r = Rng.next();
    if (tgt.dmg > 95) { o[toward] = true; press('smash'); a.holdK = ['smash']; a.holdT = irand(0, 6); }
    else if (lv >= 6 && adx < f.w * 0.5 + 40 + tgt.w * 0.4 && r < 0.3) { o[toward] = true; press('attack'); press('special'); }   // grapple (24_grapple)
    else if (r < 0.65) { o.up = true; press('attack'); }   // up-tilt: the combo launcher (23_combo)
    else { o[toward] = true; press('attack'); }
    return true;
  },
  // platforms: climb to someone standing high above (full hop + double jump near the apex), drop through a
  // soft platform to someone below. The stock AI only short-hops, so two CPUs could stand a platform apart forever.
  aiChase(f, tgt, o, press) {
    const a = f.ai, S = f.state, fr = Game.frame, dy = tgt.y - f.y, adx = Math.abs(tgt.x - f.x), toward = tgt.x > f.x ? 'right' : 'left';
    if (a.fClimb) {
      if (fr - a.fClimb > 80 || (S !== 'jumpsquat' && S !== 'air' && S !== 'ground') || (S === 'ground' && fr - a.fClimb > 8)) a.fClimb = 0;
      else if (S === 'air') { if (adx > 16) o[toward] = true; if (f.vy > -3 && f.jumps > 0 && f.y > tgt.y - 10) press('jump'); return true; }
      else return true;
    }
    if (S !== 'ground' || tgt.air || tgt.state === 'respawn' || tgt.state === 'dead') return false;
    const go = Rng.next() < 0.03 + f.level * 0.006;
    if (dy < -110 && adx < 260 && go) { a.fClimb = fr; press('jump'); a.holdK = ['jump']; a.holdT = 14; if (adx > 30) o[toward] = true; return true; }
    if (dy > 90 && f.plat && f.plat.soft && go) { press('down'); return true; }
    return false;
  },
  // reading the opponent's start-up after a human reaction time, once per move: parry, shield, spot dodge or nothing
  aiGuard(f, tgt, o, press) {
    const a = f.ai, lv = f.level, fr = Game.frame, tm = tgt.state === 'move' ? tgt.move : null;
    if (!tm || !tm.def.hits || !tm.def.hits.length) { a.fSeen = null; return false; }
    if (a.fSeen !== tm) { a.fSeen = tm; a.fSeenT = fr; a.fPlan = null; }
    if (fr - a.fSeenT < Math.max(6, 26 - lv * 2)) return false;
    let until = 1e9;
    for (const h of tm.def.hits) {
      if (h.f[1] < tm.t || h.grab || h.cgrab) continue;
      if (!circleRect(tgt.x + tgt.face * h.x, tgt.y + h.y, h.r + 24, f)) continue;
      until = Math.min(until, Math.max(0, h.f[0] - tm.t));
    }
    if (until > 40) return false;
    if (!a.fPlan) {
      const r = Rng.next(), pp = lv >= 4 ? 0.05 * (lv - 3) : 0, ps = 0.045 * lv, pd = 0.02 * lv, pb = lv >= 5 ? 0.1 * (lv - 4) : 0;
      a.fPlan = r < pp ? 'parry' : r < pp + ps ? 'shield' : r < pp + ps + pd ? 'spot' : r < pp + ps + pd + pb ? 'back' : 'none';
    }
    const P = a.fPlan;
    if (P === 'none' || P === 'done') return false;
    if (P === 'back') { if (f.state === 'ground' && until > 0) { o[tgt.x > f.x ? 'left' : 'right'] = true; return true; } return false; }   // step out of range, then punish (aiPunish)
    if (f.state === 'shield') { if (P === 'shield') { o.shield = true; return true; } return false; }
    if (P === 'parry') { if (until <= 2) { press('shield'); a.holdK = ['shield']; a.holdT = 5; a.fPlan = 'done'; } return true; }
    if (P === 'shield') { press('shield'); a.holdK = ['shield']; a.holdT = until + 8 + irand(0, 10); a.fPlan = 'done'; return true; }
    if (P === 'spot') { if (until <= 3) { o.shield = true; press('down'); a.fPlan = 'done'; } return true; }
    return false;
  },
};
