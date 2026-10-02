// ===== match: stages, loop, hits, effects, camera, render =====
// LOCAL GEOMETRY (Duane's Brawl Royale brief, rule #7: "a stage is a LOCATION, not just a background
// with platforms"). Measured first: three of the five shipped stages were the SAME layout --
//     isle   840 main, 180w @-150 x2, 160w @-275
//     chart  860 main, no platforms
//     dojo   820 main, 160w @-150 x2      <- identical shape to keep
//     roof   880 main, 220w @-170
//     keep   800 main, 180w @-165 x2      <- identical shape to dojo
// so a fight played out the same way on Rune Isle, Sakura Dojo and Shadow Keep, with only the art
// changing. isle stays the balanced three-platform default and chart stays the flat one -- those two
// are already distinct. The other three each get a shape that asks a different question:
//     dojo  VERTICAL   high narrow side platforms over a low centre one -- the inverse of isle, so
//                      up-airs and platform camping decide it
//     keep  OVERHANG   a narrow floor with wide platforms that extend PAST its edges, so you can
//                      fight out over the void; nothing else on the roster does that
//     roof  TIGHT      the narrowest floor and one small high platform: close quarters, fast KOs
// `local` is passed IN, not read from Game.sigs, because Game.start sets this.stage on the line BEFORE
// it sets this.sigs -- reading the global here would use the PREVIOUS match's value.
function makeStage(id, local) {
  const S = id === 'isle'
    ? { id, name: 'Rune Isle', main: { x0: -420, x1: 420, top: 0, bot: 130 }, plats: [{ x0: -330, x1: -150, y: -150, soft: true }, { x0: 150, x1: 330, y: -150, soft: true }, { x0: -80, x1: 80, y: -275, soft: true }], theme: 'isle' }
    : id === 'roof'
    ? { id, name: 'Neon Rooftop', main: { x0: -440, x1: 440, top: 0, bot: 120 }, plats: [{ x0: -110, x1: 110, y: -170, soft: true }], theme: 'roof' }
    : id === 'dojo'
    ? { id, name: 'Sakura Dojo', main: { x0: -410, x1: 410, top: 0, bot: 100 }, plats: [{ x0: -290, x1: -130, y: -150, soft: true }, { x0: 130, x1: 290, y: -150, soft: true }], theme: 'dojo' }
    : id === 'keep'
    ? { id, name: 'Shadow Keep', main: { x0: -400, x1: 400, top: 0, bot: 100 },
        plats: [{ x0: -330, x1: -150, y: -165, soft: true }, { x0: 150, x1: 330, y: -165, soft: true }], theme: 'keep' }
    : id === 'chart'
    ? { id, name: 'Tropic Dock', main: { x0: -430, x1: 430, top: 0, bot: 110 }, plats: [], theme: 'chart' }
    : { id: 'moon', name: 'Lava Temple', main: { x0: -380, x1: 380, top: 0, bot: 90 },
        plats: [{ x0: -300, x1: -120, y: -140, soft: true }, { x0: 120, x1: 300, y: -140, soft: true }, { x0: -90, x1: 90, y: -270, soft: true }], theme: 'moon' };
  // Local-only reshape. The seeded bet arena replays recorded fights on isle/moon/chart/keep/roof/dojo
  // (62_rules ARENA.stages), so its geometry must not move by a pixel -- `local` is false there and
  // this block never runs. detcheck + guard prove it.
  if (local && !Game.flatStages) {
    const P = (x0, x1, y) => ({ x0, x1, y, soft: true });
    if (id === 'dojo') {                       // VERTICAL: high narrow sides over a low centre
      S.plats = [P(-270, -150, -240), P(150, 270, -240), P(-100, 100, -105)];
    } else if (id === 'keep') {                // OVERHANG: platforms reach out past the floor edges
      S.main = { x0: -340, x1: 340, top: 0, bot: 100 };
      S.plats = [P(-440, -240, -150), P(240, 440, -150)];
    } else if (id === 'roof') {                // TIGHT: the narrowest floor, one small high platform
      S.main = { x0: -350, x1: 350, top: 0, bot: 120 };
      S.plats = [P(-70, 70, -215)];
    }
  }
  S.blast = { l: -980, r: 980, t: -560, b: 480 };
  S.mainSurf = { y: S.main.top, x0: S.main.x0, x1: S.main.x1, soft: false };
  S.ledges = [{ x: S.main.x0, y: S.main.top, side: -1, holder: null }, { x: S.main.x1, y: S.main.top, side: 1, holder: null }];
  S.spawns = [-240, 240, -90, 90];
  S.respawn = [-200, 200, -60, 60];
  return S;
}
function circleRect(cx, cy, r, f) {
  // Game.duck: local matches duck for real - the head and chest drop to 40% of standing (the 3D crouch in
  // 97_v3_pose goes down with it), and anything aimed above that sails over: jabs and head-high shots whiff,
  // low attacks and blasts still land. Seeded fights (bet arena, online) keep Game.duck off and the old box.
  const duck = f.crouch ? (Game.duck ? 0.4 : Game.feel ? 0.6 : 0.72) : 1;
  const x0 = f.x - f.w * 0.4, x1 = f.x + f.w * 0.4, y0 = f.y - f.h * duck, y1 = f.y;
  if (f.crouch && Game.duck && cy + r * 0.15 < y0) return false;
  const nx = clamp(cx, x0, x1), ny = clamp(cy, y0, y1);
  return (cx - nx) * (cx - nx) + (cy - ny) * (cy - ny) < r * r;
}

const STARS = Array.from({ length: 140 }, () => ({ x: Rng.next(), y: Rng.next() * 0.8, s: Rng.next() * 1.8 + 0.4, p: Rng.next() * TAU }));
const CANDLES = (() => { let v = 0.5; return Array.from({ length: 70 }, () => { const o = v; v = clamp(v + rand(-0.09, 0.1), 0.15, 0.85); return { o, c: v, hi: Math.max(o, v) + rand(0, 0.05), lo: Math.min(o, v) - rand(0, 0.05) }; }); })();

const Game = {
  state: 'title', paused: false, frame: 0, fighters: [], projs: [], parts: [], texts: [], rings: [],
  stage: makeStage('moon'), stockCount: 3, cam: { x: 0, y: -160, z: 0.7 }, shakeT: 0, countdown: 0, endT: 0, demo: true, holes: [], itemSet: 1, sigs: false, duck: false,
  slots: [], stageId: 'moon', stakes: [], pot: 0, winner: null,

  start(slots, stageId, stocks, demo, itemsOn, seed) {
    if (seed) Rng.seed(seed);
    this.itemsOn = itemsOn !== false; this.tick = 0; this.timeLimit = 0; this.timeUpT = 0;
    // `!seed` passed IN: this.sigs is not assigned until two lines below, so makeStage cannot read it
    this.demo = !!demo; this.stage = makeStage(stageId, !seed); this.stockCount = stocks;
    // item set 2 + signature moves for unseeded local matches; seeded fights (bet arena, online) stay on set 1
    this.itemSet = seed ? 1 : 2; this.sigs = !seed; this.holes = [];
    // bought weapons (57_items3): OFF unless the caller turns them on after start, and never in a
    // wagered or ranked match. Clearing both here stops a casual loadout leaking into the next fight.
    this.arsenalOn = false; this.loadouts = null;
    this.reach = seed ? 1 : 1.3;   // longer arms in local play (9/20: "range is way too short")   // items + signature specials stay on
    this.duck = !seed;             // a real crouch that ducks chest-high attacks (circleRect above, pose in 97_v3_pose)
    // combo cancels (23_combo) are rules v2: on for unseeded local matches; seeded fights keep v1 unless the caller opts in after start
    this.combos = !seed;
    // game feel (25_feel: buffer, hitlag, DI, tech, parry, PUMP meter, CPU) is rules v2 too: same rule as combos
    // 9/20: Duane found the v2 feel layer worse to play (short reach, wrong facing, sticky hits), so it is OFF
    // by default. Set localStorage tb_feel = '1' to try it again; the arena and online never used it while off.
    this.feel = !seed && (() => { try { return localStorage.getItem('tb_feel') === '1'; } catch (e) { return false; } })();
    // 9/21: these two MUST be set before the fighters are built. The Fighter constructor calls
    // FEEL.jumps(), which reads Game.combos, so building first left the very first match of a page
    // load on the previous (undefined) value and everyone got one air jump instead of two.
    this.fighters = slots.map((s, i) => new Fighter(i, s, this.stage));
    this.projs = []; this.parts = []; this.texts = []; this.rings = []; Items.reset(); this.slowT = 0; this.flashT = 0; this.finalBy = null;
    this.frame = 0; this.endT = 0; this.winner = null; this.paused = false;
    this.countdown = demo ? 0 : 200;
    this.cam = { x: 0, y: -160, z: this.cam.z || 0.7 };
  },
  togglePause() {
    if (this.state !== 'match' || this.endT || this.arena) return;
    this.paused = !this.paused; UI.onPause(this.paused);
  },
  step() {
    const live = this.state === 'match' || this.state === 'title' || this.state === 'menu';
    if (!live || this.paused) { endInputFrame(); return; }
    this.tick++;
    if (this.countdown > 0) {
      this.countdown--;
      if (this.countdown % 50 === 0) Sfx.count(this.countdown === 0);
      for (const f of this.fighters) { f.prev = f.in; f.in = {}; }
    } else if (this.slowT > 0 && --this.slowT % 3) {
      // impact slow-motion: simulate one frame in three
    } else if (!this.endT || this.endT % 3 === 0 || this.endT > 90) {
      this.frame++;
      for (const f of this.fighters) {
        if (f.state === 'dead') { if (f.stocks > 0 && --f.deadT <= 0) this.respawn(f); continue; }
        f.update(this.stage);
      }
      this.resolveHits(); this.updateProjs(); Items.update(); if (this.feel) FEEL.tick(); this.checkBlast();   // craters heal (25_feel)
      if (this.timeLimit && this.frame >= this.timeLimit && !this.endT) this.timeUp();
      // launch trails: fast-flying fighters leave a streak of their colour
      for (const f of this.fighters) if (f.state === 'hitstun' && f.vx * f.vx + f.vy * f.vy > 81 && this.frame % 2 === 0)
        this.parts.push({ x: f.x, y: f.y - f.h / 2, vx: 0, vy: 0, life: 26, max: 26, color: f.color, size: 11, g: 0, soft: true });
    }
    if (this.endT) { this.endT++; if (this.endT > 150) this.finish(); }
    this.updateFx(); this.updateCam();
    endInputFrame();
  },
  resolveHits() {
    const F = this.fighters;
    for (const a of F) {
      if (a.hitlag > 0 || !(a.state === 'move' || a.state === 'hammer')) continue;
      const hs = a.activeHits(); if (!hs.length) continue;
      Items.hitItems(a, hs, a.chargeMult());
      for (const b of F) {
        if (!a.move) break;
        if (b === a || b.untouchable || b.state === 'grabbed') continue;
        for (const h of hs) {
          if (!circleRect(h.x, h.y, h.r, b)) continue;
          const prevT = a.move.hits.get(b);
          if (prevT != null && !(h.hb.rehit && a.move.t - prevT >= h.hb.rehit)) continue;
          a.move.hits.set(b, a.move.t);
          if (h.hb.grab) { if (b.state !== 'grabbing' && !TK.ducks(b)) a.grabConnect(b); break; }   // ducking beats throws (27_tekken)
          if (h.hb.cgrab) { MV2.cgrab(a, b, h.hb); break; }   // command grab (21_roster2)
          const bm = b.move;
          if (b.state === 'move' && bm && bm.def.counter && bm.t >= bm.def.counter[0] && bm.t <= bm.def.counter[1]) {
            const ch = bm.def.counterHit;   // opt-in custom retaliation (21_roster2)
            b.face = a.x > b.x ? 1 : -1; b.move = null; b.startMove(ch && ch.def || { total: 24 }); b.invuln = 12;
            this.text(b.x, b.y - b.h - 16, ch && ch.shout || 'COUNTER', '#ffffff', 1.2);
            a.takeHit(ch ? MV2.counterHit(ch, h.hb) : { dmg: Math.max(8, h.hb.dmg * 1.3), ang: 40, bkb: 50, kbg: 82, x: 10 }, b, 1, b.x, b.face);
            break;
          }
          if (h.hb.pre && h.hb.pre(a, b, h.hb)) break;
          const mult = a.chargeMult() * (a.powerT > 0 ? 1.4 : 1);
          if (this.feel && FEEL.dropParry(b, h.hb.dmg * mult, a)) break;   // parry just after the shield came down (25_feel)
          if (b.state === 'shield') { this.shieldHit(b, h.hb.dmg * mult, a.x, a); break; }
          const bonk = a.move.def.bonk;
          b.takeHit(h.hb, a, mult, a.x, a.face);
          COMBO.landed(a, b);   // opens the cancel window (23_combo)
          if (h.hb.after) h.hb.after(a, b, h.hb);
          if (bonk) this.text(b.x, b.y - b.h - 16, 'BONK!', '#ffd45c', 1.7);
          break;
        }
      }
    }
  },
  shieldHit(b, dmg, srcX, a) {
    if (this.feel && FEEL.shield(b, dmg, srcX, a)) return;   // perfect shield = parry (25_feel)
    b.shieldHP -= dmg * 1.3;
    b.vx = (b.x >= srcX ? 1 : -1) * Math.min(7, 1 + dmg * 0.4);
    const lag = clamp(Math.floor(dmg * 0.3 + 3), 3, 12);
    b.hitlag = lag; if (a) a.hitlag = Math.max(a.hitlag, lag);
    Sfx.shield(); this.ring(b.x, b.y - b.h / 2, b.color, 40);
    if (b.shieldHP <= 0) b.shieldBreak();
  },
  spawnProj(f, p) {
    this.projs.push(Object.assign({}, p, { x: f.x + f.face * (f.w * 0.5 + 10), y: f.y - f.h * 0.55, vx: p.vx * f.face, vy: p.vy, owner: f, age: 0 }));
  },
  projCount(f, kind) { let n = 0; for (const p of this.projs) if (p.owner === f && p.kind === kind) n++; return n; },
  updateProjs() {
    const M = this.stage.main;
    for (const p of this.projs) {
      p.age++;
      if (p.step) MV2.projStep(p, this, M);   // opt-in motion: beams, bouncers, crawlers, sky bolts (21_roster2)
      else {
      if (p.boomer && p.age > p.boomer) {
        const o = p.owner, dx = o.x - p.x, dy = (o.y - o.h * 0.55) - p.y, d = dhypot(dx, dy) || 1;
        p.vx = lerp(p.vx, dx / d * 14, 0.1); p.vy = lerp(p.vy, dy / d * 14, 0.1);
        if (d < 34 || o.state === 'dead') p.dead = true;
      } else p.vy += p.grav || 0;
      p.x += p.vx; p.y += p.vy;
      if (p.age > p.life + (p.boomer ? 90 : 0)) p.dead = true;
      if (!p.boomer && p.y > M.top && p.y < M.bot && p.x > M.x0 && p.x < M.x1 && !(this.holes.length && Items2.inHole(p.x))) { p.dead = true; this.puff(p.x, M.top, 5, '#ffffff'); }
      }
      if (p.dead) continue;
      for (const b of this.fighters) {
        if (b === p.owner || b.untouchable || b.state === 'grabbed') continue;
        if (!(p.len ? MV2.beamHit(p, b) : circleRect(p.x, p.y, p.r, b))) continue;
        if (b.state === 'move' && b.move.def.reflect && MV2.reflect(p, b)) break;
        if (p.rehit ? MV2.rehitWait(p, b) : p.hitSet && p.hitSet.has(b)) continue;
        if (!p.rehit) (p.hitSet = p.hitSet || new Set()).add(b);
        if (b.state === 'shield') { this.shieldHit(b, p.dmg, p.x, null); if (!p.boomer && !p.pierce) p.dead = true; continue; }
        const keep = p.owner.hitlag;
        b.takeHit({ dmg: p.dmg, ang: p.ang, bkb: p.bkb, kbg: p.kbg, radial: true, kind: p.kind }, p.owner, 1, p.x - p.vx, 1);
        p.owner.hitlag = keep;
        if (p.after) p.after(p, b);
        if (p.kind === 'coin') Sfx.coin();
        if (!p.boomer && !p.pierce) { p.dead = true; break; }
      }
    }
    this.projs = this.projs.filter(p => !p.dead);
  },
  checkBlast() {
    const B = this.stage.blast;
    for (const f of this.fighters) {
      if (f.state === 'dead' || f.state === 'respawn') continue;
      if (f.x < B.l || f.x > B.r || f.y > B.b || (f.y - f.h < B.t && f.state === 'hitstun')) this.ko(f);
    }
  },
  ko(f) {
    if (this.feel) FEEL.ko(f);   // KO event + fresh stale queue (25_feel)
    const B = this.stage.blast;
    const ex = clamp(f.x, B.l + 40, B.r - 40), ey = clamp(f.y - f.h / 2, B.t + 40, B.b - 40);
    for (let i = 0; i < 40; i++) this.parts.push({ x: ex, y: ey, vx: rand(-1, 1) * 14 - Math.sign(ex) * 8, vy: rand(-1, 1) * 14 - Math.sign(ey + 100) * 6, life: 60, max: 60, color: i % 2 ? f.color : '#ffffff', size: rand(4, 10), g: 0 });
    this.rings.push({ x: ex, y: ey, r: 20, max: 380, color: f.color, life: 40, w: 16 });
    this.text(clamp(ex, B.l + 220, B.r - 220), clamp(ey, B.t + 140, B.b - 160), 'REKT', f.color, 2.4);
    this.shake(24); Sfx.ko();
    f.stocks--; f.stats.falls++;
    if (f.lastHitBy && this.frame - f.lastHitT < 600 && f.lastHitBy !== f) f.lastHitBy.stats.kos++;
    f.releaseLedge(); if (f.grabbed) { f.grabbed.grabber = null; f.grabbed.setState('air'); f.grabbed = null; }
    if (f.grabber) { f.grabber.grabbed = null; f.grabber = null; }
    f.state = 'dead'; f.deadT = 70; f.move = null; f.lastHitBy = null; f.item = null; f.hammerT = 0;
    if (!this.demo) this.slowT = Math.max(this.slowT, 24);
    const alive = this.fighters.filter(g => g.stocks > 0);
    if (alive.length <= 1 && !this.endT) {
      this.winner = alive[0] || f; this.endT = 1;
      if (!this.demo) { this.text(this.cam.x, this.cam.y - 60, 'GAME!', '#ffffff', 3.2); Sfx.count(true); }
    }
  },
  // time limit (arena fights): most stocks left, then least damage, then most dealt
  timeUp() {
    const rank = [...this.fighters].sort((p, q) => (q.stocks - p.stocks) || (p.dmg - q.dmg) || (q.stats.dealt - p.stats.dealt) || (p.idx - q.idx));
    this.winner = rank[0]; this.endT = 1; this.timeUpT = this.frame;
    this.text(this.cam.x, this.cam.y - 60, 'TIME!', '#ffffff', 3.2); Sfx.count(true);
  },
  respawn(f) {
    const st = this.stage;
    f.reset(st.respawn[f.idx], st.blast.t + 200, st);
    f.air = true; f.plat = null; f.setState('respawn');
  },
  finish() {
    if (this.arena) { this.state = 'arenaEnd'; this.arena.onEnd(this.winner); return; }
    if (this.demo) { UI.startDemo(); return; }
    // clear the end sequence: leaving the results screen sets the state back to 'menu', and a leftover
    // endT would step the finished match again and bounce straight back to results (9/20 bug)
    const won = this.winner;
    this.endT = 0;
    this.state = 'results'; UI.showResults(won);
  },

  // ---- effects ----
  puff(x, y, n, color) { for (let i = 0; i < n; i++) this.parts.push({ x: x + rand(-14, 14), y: y - rand(0, 6), vx: rand(-2.5, 2.5), vy: rand(-2, -0.2), life: 22, max: 22, color: color || '#ffffff', size: rand(4, 9), g: 0, soft: true }); },
  burst(x, y, color, n) { for (let i = 0; i < n; i++) { const a = rand(0, TAU), s = rand(2, 7); this.parts.push({ x, y, vx: dcos(a) * s, vy: dsin(a) * s, life: 26, max: 26, color, size: rand(3, 6), g: 0.1 }); } },
  trail(f) { this.parts.push({ x: f.x + rand(-8, 8), y: f.y - 4, vx: rand(-1, 1), vy: rand(1, 3), life: 18, max: 18, color: Rng.next() < 0.5 ? '#ffd45c' : '#ff4fd8', size: rand(5, 10), g: 0, soft: true }); },
  chargeSpark(f) { const a = rand(0, TAU); this.parts.push({ x: f.x + dcos(a) * 50, y: f.y - f.h / 2 + dsin(a) * 50, vx: -dcos(a) * 3, vy: -dsin(a) * 3, life: 16, max: 16, color: '#ffd45c', size: 4, g: 0 }); },
  shock(x, y, color) { this.rings.push({ x, y: y - 6, r: 10, max: 120, color, life: 22, w: 8, flat: true }); this.puff(x, y, 12, '#ffffff'); },
  ring(x, y, color, max) { this.rings.push({ x, y, r: 6, max: max || 60, color, life: 16, w: 5 }); },
  text(x, y, s, color, scale) { this.texts.push({ x, y, s, color, scale: scale || 1, life: 70, max: 70 }); },
  shake(n) { this.shakeT = Math.max(this.shakeT, n); },
  onHit(v, att, hb, d, kb) {
    const x = v.x, y = v.y - v.h / 2, c = att ? att.color : '#ffffff';
    const n = 8 + Math.min(24, kb / 8);
    for (let i = 0; i < n; i++) { const a = rand(0, TAU), s = rand(3, 6 + kb / 25); this.parts.push({ x, y, vx: dcos(a) * s, vy: dsin(a) * s, life: 18, max: 18, color: i % 3 ? '#ffffff' : c, size: rand(3, 7), g: 0, streak: true }); }
    this.rings.push({ x, y, r: 8, max: 30 + kb * 0.4, color: kb > 140 ? '#ffd45c' : '#ffffff', life: 12, w: kb > 140 ? 10 : 5 });
    this.shake(Math.min(22, kb / 14)); Sfx.hit(kb / 220);
    // 9/22: slow-motion is for the FINISHING blow only (it still fires on the KO itself, in the death
    // handler above). It used to fire on every hit over kb 150, stacked on the hitstop: ~0.58 s frozen
    // on every strong hit, several times per stock once anyone is past ~90%. That is the "gameplay
    // became slower" the owner kept feeling. Smash slows only the lethal hit. The flash and the camera
    // punch stay, so a big hit still lands hard. The seeded bet arena keeps the old behaviour exactly.
    if (kb > 150 && !this.demo) { if (!this.combos) this.slowT = Math.max(this.slowT, 21); this.flashT = Math.max(this.flashT, 5); this.cam.z *= 1.06; }
    if (kb > 120) {
      this.impact = { x, y, t: 30 };
      for (let i = 0; i < 14; i++) { const a = rand(0, TAU), s = rand(1, 5); this.parts.push({ x, y, vx: dcos(a) * s, vy: dsin(a) * s - 1, life: 26, max: 26, color: i % 3 ? '#ff9a2a' : '#ffe27a', size: rand(18, 34), g: 0, fire: true }); }
    }
  },
  updateFx() {
    for (const p of this.parts) { p.x += p.vx; p.y += p.vy; p.vy += p.g; p.vx *= 0.94; p.vy *= p.g ? 1 : 0.94; p.life--; }
    this.parts = this.parts.filter(p => p.life > 0);
    for (const r of this.rings) { r.r = lerp(r.r, r.max, 0.25); r.life--; }
    this.rings = this.rings.filter(r => r.life > 0);
    for (const t of this.texts) { t.life--; t.y -= 0.6; }
    this.texts = this.texts.filter(t => t.life > 0);
    if (this.shakeT > 0) this.shakeT *= 0.86; if (this.shakeT < 0.4) this.shakeT = 0;
    if (this.flashT > 0) this.flashT--;
    if (this.impact && --this.impact.t <= 0) this.impact = null;
  },
  // The 2D fallback renderer's camera (70_render.js). The 3D view no longer reads this at all:
  // 91_v3_render.mjs solves its own framing against the HUD insets. Nothing here feeds fighter state
  // or the seeded Rng, so the arena replay hashes cannot move -- but keep it that way.
  // 9/20 fixes, same bugs as the 3D one had: the `* 0.85` pulled the view back toward the stage centre
  // (stand in a corner, watch it frame the middle), and `f.y - f.h` is the collision box, not the
  // drawing, so heads and name tags were clipped.
  updateCam() {
    const act = this.fighters.filter(f => f.state !== 'dead');
    let x0 = -300, x1 = 300, y0 = -220, y1 = 40;
    if (act.length) { x0 = Math.min(...act.map(f => f.x)); x1 = Math.max(...act.map(f => f.x)); y0 = Math.min(...act.map(f => f.y - f.h * 1.6)); y1 = Math.max(...act.map(f => f.y + 20)); }
    const B = this.stage.blast;
    x0 = Math.max(x0, B.l + 100); x1 = Math.min(x1, B.r - 100); y0 = Math.max(y0, B.t + 60); y1 = Math.min(y1, B.b - 60);
    const W = R.w, Hh = R.h;
    const hud = 210;   // the top bars plus the bottom plates, in screen px: keep the action out of them
    const tz = clamp(Math.min(W / (x1 - x0 + 420), Math.max(1, Hh - hud) / (y1 - y0 + 180)), Math.min(W / 2000, Hh / 1150), Math.min(W / 760, Hh / 520));
    const tx = (x0 + x1) / 2, ty = (y0 + y1) / 2 - 40;
    this.cam.x = lerp(this.cam.x, tx, 0.08); this.cam.y = lerp(this.cam.y, ty, 0.08); this.cam.z = lerp(this.cam.z, tz, 0.06);
  },
};
