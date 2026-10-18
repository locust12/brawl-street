// ===== GUNPLAY: real firearms — instant rounds, 8-way aim, recoil, weight, and THROW IT WHEN IT'S DRY =====
// Owner: the gunplay session (dev/NOTES-guns.md). Brief (Duane, 9/22): "take inspiration from Madness ...
// step up the shooting to a whole new level ... all the weapons sound like lasers, and no real bullets ...
// you can also throw your gun when you're done with it — add that aspect to the game."
//
// What this file does (mechanics and feel only — nothing copied from any Madness game):
//   * five firearms with their own handling: PISTOL (snappy semi-auto), REVOLVER (slow, heavy, hammer
//     cock), SHOTGUN (8-pellet cone, pump between shells, point-blank is devastating), SMG (hold to
//     spray, climbs), SNIPER (scope glint, then one huge piercing round, bolt cycle). The BAZOOKA keeps
//     its rocket and joins the same aim / recoil / throw rules.
//   * ROUNDS ARE NEAR-INSTANT: 150-320 px per frame, swept against fighters, items and the stage in
//     12 px sub-steps so nothing tunnels. They are still real projectiles in Game.projs, so shields,
//     reflectors, the Aegis drone and shootable TNT all keep working on them.
//   * 8-WAY AIM from the direction keys / stick (deterministic, rides the existing input bits). Down on
//     its own on the ground is a crouch shot that fires LOW (and Game.duck already lets a crouch slip
//     under a standing shot). A local-only mouse aim (96g_guns.mjs) is quantised to the same 8 ways.
//   * limited ammo, no reloads. When it's empty the next Attack THROWS THE GUN along your aim: it spins,
//     BONKs for damage and a short stun, then clatters on the floor. E (grab) throws it at any time.
//     Empty guns on the floor can be picked up and thrown again; they vanish after a few seconds.
//   * weight: recoil shoves the shooter (a shotgun fired straight down in the air is a jump), the victim
//     freezes / staggers / launches by calibre, a 3+ hit SMG stream stops making them flinch (so nobody
//     is ever walked off the stage by a hose), and the shot stale-scaling in 65_balance still applies.
//
// DETERMINISM — this is a SIM file (build.py SIM_FILES; the online server runs it too):
//   * everything is gated on GUNS.on() = Game.combos && Game.itemSet >= 2. The seeded bet arena runs
//     combos off and item set 1, so no new kind can spawn there and every hook below falls straight
//     through to the original code. Proven by arena/test/det_node.js and dev/detcheck.js (1092/0).
//   * seeded rand()/Rng only; dsin/dcos/dhypot only (never Math.sin/cos/hypot/random).
//   * visuals and sound never run here. The sim writes a small fixed ring of events (GUNS.ev) that
//     nothing in the fight reads; the page (12g_gunaudio.js, 96g_guns.mjs) drains it for sound + fx.
//   * GUNS.mouse is written by the page for LOCAL matches only and read only when no fighter is a
//     network controller, so it can never reach an online match or a replay.

const GUNS = {
  on() { return !!(Game.combos && Game.itemSet >= 2); },

  // ---- the guns. rate = frames between shots, recov = frames after the last shot before the move
  // ends, spd = px/frame, range = px, rec/airRec = recoil shove, walk = move speed while shooting,
  // stop = extra freeze on the victim, stagger = min hitstun on a grounded victim, mech = [sound, frame]
  DEF: {
    pistol:   { name: 'Pistol', mag: 10, rate: 9, recov: 14, spd: 150, range: 950, r: 5, dmg: 3.8, bkb: 14, kbg: 22, ang: 24,
                spread: 0.8, rec: 0.9, airRec: 1.4, walk: 0.55, stop: 0, round: 'r9', shake: 1.5, throwDmg: 7 },
    revolver: { name: 'Revolver', mag: 6, rate: 24, recov: 18, spd: 175, range: 1200, r: 6, dmg: 9, bkb: 30, kbg: 56, ang: 32,
                spread: 0, rec: 3.4, airRec: 4, walk: 0.4, stop: 3, stagger: 16, round: 'r44', mech: ['cock', 11], shake: 5, throwDmg: 8 },
    shotgun:  { name: 'Shotgun', mag: 4, rate: 36, recov: 16, spd: 105, range: 380, r: 6, dmg: 2.4, pellets: 8, cone: 9,
                rec: 6, airRec: 8.5, walk: 0.3, round: 'buck', mech: ['pump', 12], shake: 7, throwDmg: 9 },
    smg:      { name: 'SMG', mag: 30, rate: 5, recov: 10, spd: 145, range: 820, r: 5, dmg: 1.5, bkb: 5, kbg: 9, ang: 16,
                spread: 2.2, climb: 0.35, climbMax: 6, rec: 0.35, airRec: 0.55, walk: 0.5, auto: true, round: 'rsmg', shake: 0.6, throwDmg: 7 },
    // BLASTERS and BOW: the two ranged archetypes the genre agrees on and we did not have.
    // Brawlhalla's Blasters are "long-range attacks that can be strung together"; Smash's Ray Gun is
    // the same idea. The Bow is Brawlhalla's "projectile that shoots out surprisingly fast", and
    // Smash's charged-shot slot. Between them our shooting shelf stops being three flamethrower
    // variants and an assault rifle.
    blaster:  { name: 'Twin Nines', mag: 16, rate: 6, recov: 11, spd: 230, range: 920, r: 6, dmg: 2.7, bkb: 9, kbg: 16, ang: 18,
                spread: 1.0, rec: 0.4, airRec: 0.7, walk: 0.62, auto: true, round: 'rbls', shake: 1.6, throwDmg: 7 },
    bow:      { name: 'Speargun', mag: 5, wind: 14, rate: 30, recov: 15, spd: 300, range: 1600, r: 7, dmg: 15, bkb: 44, kbg: 78, ang: 26,
                spread: 0, rec: 1.6, airRec: 2.2, walk: 0.35, stop: 2, stagger: 14, round: 'rarw', shake: 5, throwDmg: 8 },
    // STREET SWEEPER: the close-range shotgun. Smash has no shotgun, but the shop is a weapon shop
    // and every shooter the store art is modelled on carries one. Pellets, so it is devastating in
    // someone's face and nothing at all across the stage.
    sweeper:  { name: 'Street Sweeper', mag: 6, wind: 6, rate: 34, recov: 20, spd: 180, range: 360, r: 6, dmg: 4.8, bkb: 18, kbg: 28, ang: 22,
                pellets: 8, spread: 7.5, rec: 1.5, airRec: 2.1, walk: 0.4, stop: 1, round: 'rsweep', shake: 5, throwDmg: 8 },
    // CAPTIVE BOLT: a cattle stunner run off a compressed air tank, which is a real industrial tool
    // and sits on the same shelf as the Fire Axe and the Pipe Cannon. It is the shortest range in
    // the game by a wide margin -- it has to be touching -- and in exchange it hits harder than
    // anything else that fires. Two shots, and a long recovery you have to commit to.
    bolt:     { name: 'Captive Bolt', mag: 2, wind: 16, rate: 46, recov: 30, spd: 150, range: 72, r: 9, dmg: 36, bkb: 94, kbg: 136, ang: 12,
                spread: 0, rec: 2.4, airRec: 3.2, walk: 0.3, stop: 3, stagger: 24, round: 'rbolt', shake: 9, throwDmg: 9 },
    // THE AK, built from the real Madness numbers, not from feel.
    // `studio-minus/madness-interactive-reloaded` -> base/data/weapons/ak_47.json:
    //   UseDelay 0.1s -> 6 frames between shots (600 rpm) · RoundsPerMagazine 20 · Automatic true
    //   Accuracy 1.0 · Recoil 1.0 · RotationalRecoilIntensity 0.25 · BulletsPerShot 1
    // and Weapons/Systems/BulletEmitter.cs raycasts, recursing up to 8 times THROUGH targets, which
    // is why this is the only automatic here with `pierce`. Ours fires a projectile rather than a
    // hitscan ray, so `spd` is pushed to 300: a round crosses its whole range in about four frames,
    // which reads as instant at fighting distance while keeping deflection, tracers and impacts
    // working instead of bypassing the entire projectile path.
    ak:       { name: 'The Chopper', mag: 20, rate: 6, recov: 12, spd: 320, range: 1250, r: 6, dmg: 3.4, bkb: 12, kbg: 20, ang: 20,
                spread: 1.3, climb: 0.5, climbMax: 8, rec: 0.8, airRec: 1.15, walk: 0.45, auto: true, pierce: true,
                round: 'rak', shake: 3, throwDmg: 9 },
    // DESERT EAGLE. Duane, 15 Oct: *"make one of the pistols take all of the other players health
    // but leave a little bit with one shot ... only let it have one bullet ... leaves them in
    // critical health"*. This game has no health bar -- damage counts UP and a high number is what
    // gets you launched off the stage -- so "takes nearly all their health" is `crit`: the round
    // leaves the victim sitting at 160%, one clean hit from a stock, however healthy they were a
    // moment earlier. The knockback is deliberately tiny (kbg 6) so the Eagle itself does NOT get
    // the KO: it hands you the kill and makes you land it. ONE round, a heavy draw, and a recovery
    // you are stuck in if you miss.
    deagle:   { name: 'Desert Eagle', mag: 1, wind: 20, rate: 60, recov: 46, spd: 280, range: 1150, r: 9, dmg: 24,
                crit: 160, bkb: 14, kbg: 6, ang: 28,
                spread: 0, rec: 7, airRec: 9, walk: 0.25, stop: 5, stagger: 30, round: 'rdeagle',
                mech: ['cock', 14], shake: 11, throwDmg: 10 },
    sniper:   { name: 'Sniper Rifle', mag: 3, wind: 16, rate: 54, recov: 16, spd: 320, range: 2600, r: 6, dmg: 19, bkb: 52, kbg: 92, ang: 18,
                spread: 0, rec: 5, airRec: 6, walk: 0.15, stop: 7, stagger: 20, pierce: true, round: 'r308', mech: ['bolt', 20], shake: 10, throwDmg: 10 },
    bazooka:  { name: 'Bazooka', mag: 2, rate: 50, recov: 20, rocket: true, rec: 3, airRec: 5, walk: 0.2, shake: 6, throwDmg: 10 },
  },
  ROUND: {},    // round kind -> gun id (filled below)

  // ---- the event ring the page reads (sound + fx). Fixed size, reused objects, nothing in the fight reads it.
  N_EV: 256, ev: null, seq: 0,
  emit(type, x, y, ax, ay, k, fi, v) {
    const n = ++this.seq, e = this.ev[n & (this.N_EV - 1)];
    e.seq = n; e.type = type; e.x = x; e.y = y; e.ax = ax || 0; e.ay = ay || 0; e.k = k || ''; e.f = fi == null ? -1 : fi; e.v = v || 0; e.frame = Game.frame;
  },

  // ---- local-only mouse aim (written by 96g_guns.mjs): { on, dx, dy } with dx, dy in -1 / 0 / 1
  mouse: { on: false, dx: 0, dy: 0 },
  local(G) { for (const f of G.fighters) if (typeof f.ctrl === 'string' && f.ctrl.indexOf('net') === 0) return false; return true; },
  mouseOk(f) { return this.mouse.on && f.ctrl === 'kb1' && !f.cpu && this.local(Game); },

  // ---- aim: the 8 ways. Returns [ax, ay, low] (unit vector, y grows DOWN), pure: writes nothing.
  aimVec(f) {
    let dx = f.dirX(), dy = (f.in.down ? 1 : 0) - (f.in.up ? 1 : 0);
    // THE STICK WINS. THIS IS THE BUG DUANE REPORTED OVER AND OVER.
    //
    // This used to be an unconditional `if (mouseOk) { dx = mouse.dx; dy = mouse.dy; }` -- the mouse
    // REPLACED the keyboard outright. And the mouse aim arms itself after a single mouse movement
    // over the canvas and stays armed for the rest of the match, so with the pointer resting to the
    // right of the fighter, pressing LEFT could not turn him: aimVec returned right, and both the
    // facing (`if (ax > 0.1) f.face = 1`) and the shot followed the pointer. Exactly his words:
    // "i try to turn left and shoot. it stays turned right."
    //
    // dev/facegun.js reproduced it at 24 of 78 cases, every one a mouse case, on all six guns.
    //
    // The rule now: a held direction is the player's answer and nothing overrides it. The mouse aims
    // only when no direction is being pressed, which is when it is actually useful (standing still,
    // picking a target). Holding a direction gives the keyboard's own 8 ways.
    if (this.mouseOk(f) && !dx && !dy) { dx = this.mouse.dx; dy = this.mouse.dy; }
    if (!f.air && dy > 0 && !dx) return [f.face, 0, 1];      // crouch shot: forward, from the hip, low
    if (!dx && !dy) return [f.face, 0, 0];
    if (dx && dy) return [dx * TK.D45, dy * TK.S45, 0];
    return [dx, dy, 0];
  },
  // where a round leaves the gun for a given aim (roughly the right hand, pushed out along the aim)
  muzzle(f, ax, ay, low) {
    const sy = f.y - f.h * (low ? 0.34 : 0.6);
    const L = (f.w * 0.5 + 16) * Math.abs(ax) + (f.h * 0.42 + 10) * Math.abs(ay);
    return [f.x + ax * L, sy + ay * L];
  },
  isGun(k) { return !!(k && this.DEF[k]); },

  // ================= firing =================
  // Items.useItem -> def.use -> here, on a fresh Attack (or Smash) press while holding a gun
  use(f, it) {
    const g = this.DEF[it.kind];
    if (!g) return false;
    if (!(it.ammo > 0)) { this.throwGun(f); return true; }
    // one move def per fighter per gun, so the renderer's clip hint (`clip`, set every frame below:
    // stand / run / air) can differ between two fighters shooting the same kind of gun. Render-only.
    const defs = f.gnDefs || (f.gnDefs = {});
    f.startMove(defs[g.id] || (defs[g.id] = Object.assign({}, g.mv, { clip: 'idle' })));
    const mv = f.move; mv.shotT = -99; mv.buf = null; mv.gnN = 0; mv.climb = 0;
    const A = this.aimVec(f); mv.gnAx = A[0]; mv.gnAy = A[1]; mv.gnLow = A[2];
    if (A[0] > 0.1) f.face = 1; else if (A[0] < -0.1) f.face = -1;
    if (g.wind) { this.emit('wind', f.x, f.y, A[0], A[1], it.kind, f.idx); return true; }
    this.shoot(f, it, g, mv, 0);
    return true;
  },
  // the per-frame body of every gun move
  tickMove(f, t) {
    const mv = f.move, it = f.item, g = it && this.DEF[it.kind];
    if (!g || !mv) { if (mv) f.endMove(); return; }
    const since = t - mv.shotT;
    mv.def.clip = f.air ? 'jump' : Math.abs(f.vx) > 0.9 ? 'run' : 'idle';
    // run-and-gun: you can walk while you shoot (slower for the heavy guns); horizontal input also aims
    if (!f.air) { const dx = f.dirX(); if (dx) f.vx = approach(f.vx, dx * f.c.walk * g.walk, 0.7); }
    else if (f.vy > 0 && g.wind && t < g.wind) f.vy = Math.min(f.vy, 1.2);   // the scope-in hangs you a moment
    // the live aim follows the stick (and the mouse), so the arm tracks between shots
    const A = this.aimVec(f); mv.gnAx = A[0]; mv.gnAy = A[1]; mv.gnLow = A[2];
    // AND THE BODY TURNS WITH IT. This line was missing, and it is the whole of Duane's
    // "when i point left to shoot, the body still points right".
    //
    // A gun move is `total: 999` -- you hold it for as long as you hold the gun -- so FACE.onStart
    // fires exactly once, when you draw. After that the only thing that ever set `f.face` was
    // `shoot()`. So holding a gun and pressing LEFT did nothing to your facing: you turned at the
    // instant a round left the barrel and not before. A pistol fires fast enough to hide it; on the
    // SMG and the bazooka the body just stayed pointing the other way, which is exactly what he kept
    // seeing and what dev/facegun.js could never catch, because that test calls the act methods
    // directly and never runs a frame of the held move.
    if (A[0] > 0.1) f.face = 1; else if (A[0] < -0.1) f.face = -1;
    // sniper: the scope-in, then the shot
    if (g.wind && mv.shotT < 0) {
      if (t >= g.wind) { this.shoot(f, it, g, mv, t); }
      return;
    }
    if (f.pressed('attack') || f.pressed('smash')) mv.buf = t;
    // a fresh press (buffered 9 frames, so mashing never eats a shot) fires or, on an empty gun, throws
    // it; holding the trigger only keeps an automatic going — it never throws a gun by itself
    const tapped = mv.buf != null && t - mv.buf <= 9, held = g.auto && f.in.attack && mv.gnN > 0 && it.ammo > 0;
    if ((tapped || held) && since >= g.rate) {
      mv.buf = null;
      if (!(it.ammo > 0)) { f.endMove(); this.throwGun(f); return; }
      this.shoot(f, it, g, mv, t);
      return;
    }
    // the gun's own mechanism, between shots: pump / hammer / bolt (a sound + a pose beat, no gameplay)
    if (g.mech && since === g.mech[1] && it.ammo > 0) this.emit('mech', f.x, f.y - f.h * 0.6, 0, 0, g.mech[0], f.idx);
    // ready again: jump / shield / a new direction act straight out of the recovery, like Madness' dodge
    if (since >= g.rate && (f.pressed('jump') || f.pressed('shield') || f.pressed('special') || f.pressed('grab'))) {
      f.endMove(); if (f.air) f.airAct(); else f.groundAct(); return;
    }
    if (since >= g.rate + g.recov && !(g.auto && f.in.attack && it.ammo > 0)) f.endMove();
  },
  // one trigger pull
  shoot(f, it, g, mv, t) {
    const G = Game, k = it.kind;
    const A = this.aimVec(f); let ax = A[0], ay = A[1]; const low = A[2];
    if (ax > 0.1) f.face = 1; else if (ax < -0.1) f.face = -1;
    it.ammo--; mv.shotT = t; mv.gnN++;
    const M0 = this.muzzle(f, ax, ay, low), ox = M0[0], oy = M0[1];
    if (g.rocket) {
      const sp = 12.5;
      G.projs.push({ kind: 'rocket', x: ox, y: oy, vx: ax * sp, vy: ay * sp - 1.2, grav: 0.13, step: true, boom: true, r: 11, dmg: 4, ang: 40, bkb: 20, kbg: 20,
        life: 110, after: GUNS.rocketBoom, color: '#ff8a2a', owner: f, age: 0, dir: ax < 0 ? -1 : ax > 0 ? 1 : f.face, gnRocket: 1 });
    } else if (g.pellets) {
      for (let i = 0; i < g.pellets; i++) {
        const a = deg(((i - (g.pellets - 1) / 2) / ((g.pellets - 1) / 2)) * g.cone + rand(-2.2, 2.2));
        const c = dcos(a), s = dsin(a), sp = g.spd * rand(0.92, 1.06);
        this.round(f, g, ox + rand(-3, 3), oy + rand(-3, 3), (ax * c - ay * s) * sp, (ax * s + ay * c) * sp, ax, ay, 1);
      }
    } else {
      // SMG climb: every shot in a burst walks the muzzle up a little (against gravity: toward -y)
      let a = g.spread ? rand(-g.spread, g.spread) : 0;
      if (g.climb) { mv.climb = Math.min(g.climbMax, (mv.climb || 0) + g.climb); a -= mv.climb * (ax < 0 ? -1 : 1); }
      const r = deg(a), c = dcos(r), s = dsin(r);
      this.round(f, g, ox, oy, (ax * c - ay * s) * g.spd, (ax * s + ay * c) * g.spd, ax, ay, 0);
    }
    // recoil: shoves the shooter back along the aim. In the air a shot fired downward lifts you.
    if (!f.air) f.vx -= ax * g.rec;
    else {
      f.vx -= ax * g.airRec;
      if (ay > 0.5) { f.vy = Math.min(f.vy, 0) - ay * g.airRec; f.fastFall = false; }
      else f.vy -= ay * g.airRec * 0.4;
    }
    if (g.shake) G.shake(g.shake);
    this.emit('shot', ox, oy, ax, ay, k, f.idx, it.ammo);
    if (!(it.ammo > 0)) this.emit('lock', ox, oy, ax, ay, k, f.idx);
  },
  round(f, g, x, y, vx, vy, ax, ay, pellet) {
    // knockback direction follows the aim: shot upward pops them up, shot downward keeps it low
    const ang = ay < -0.9 ? 80 : ay < -0.5 ? (g.ang || 24) + 26 : ay > 0.5 ? Math.max(8, (g.ang || 24) - 12) : (g.ang || 24);
    Game.projs.push({ kind: g.round, gn: g.id, x, y, x0: x, y0: y, px: x, py: y, vx, vy, grav: 0, r: g.r || 5,
      dmg: g.dmg, dmg0: g.dmg, ang, bkb: g.bkb || 0, kbg: g.kbg || 0, life: Math.max(2, Math.ceil(g.range / g.spd)), owner: f, age: 0,
      dir: vx < 0 ? -1 : 1, step: true, pierce: !!g.pierce, pellet: pellet ? 1 : 0, noReflect: !!pellet, after: GUNS.roundHit });
  },
  rocketBoom(p) { Items2.projBoom(p); },
  // 60_game calls p.after(p, victim) once a round has landed (not on a shield): the fx/sound event
  roundHit(p, b) { GUNS.emit('hit', p.x, p.y, p.vx, p.vy, p.gn, b ? b.idx : -1, p.dmg); },

  // the round's flight (from the MV2.projStep hook below). Sub-steps so a 300 px/frame round can't skip
  // through a fighter; stops ON a fighter so 60_game's normal hit code (shield, reflect, damage) takes it.
  step(p, G, M) {
    const st = G.stage, F = G.fighters;
    p.px = p.x; p.py = p.y;
    if (p.age > p.life) { p.dead = true; this.emit('fade', p.x, p.y, p.vx, p.vy, p.gn, -1); return; }
    const sp = dhypot(p.vx, p.vy), n = Math.max(1, Math.ceil(sp / 12)), sx = p.vx / n, sy = p.vy / n;
    for (let i = 0; i < n; i++) {
      const nx = p.x + sx, ny = p.y + sy;
      for (const b of F) {
        if (b === p.owner || b.untouchable || b.state === 'grabbed' || b.state === 'dead') continue;
        if (p.hitSet && p.hitSet.has(b)) continue;
        if (!circleRect(nx, ny, p.r, b)) continue;
        p.x = nx; p.y = ny;
        if (p.pellet) this.pelletHit(p, b);
        else if (b.state === 'shield') this.emit('shld', nx, ny, p.vx, p.vy, p.gn, b.idx);
        return;
      }
      // shootable items (TNT, mines, dynamite...): stop on them so Items2.shootCheck sets them off
      for (const it of G.items) {
        if (it.dead || !ITEM_DEFS[it.kind].shootable) continue;
        if (dhypot(nx - it.x, ny - it.y) > ITEM_DEFS[it.kind].r + p.r + 2) continue;
        p.x = nx; p.y = ny; return;
      }
      // the main stage is solid: the round stops on its surface and throws sparks there
      if (ny > M.top && ny < M.bot && nx > M.x0 && nx < M.x1 && !(G.holes.length && Items2.inHole(nx))) {
        let hx = nx, hy = ny, nX = 0, nY = -1;
        if (p.y <= M.top && sy > 0) { const k = (M.top - p.y) / sy; hx = p.x + sx * k; hy = M.top; }
        else if (p.x <= M.x0 && sx > 0) { hx = M.x0; hy = p.y + sy * ((M.x0 - p.x) / sx); nX = -1; nY = 0; }
        else if (p.x >= M.x1 && sx < 0) { hx = M.x1; hy = p.y + sy * ((M.x1 - p.x) / sx); nX = 1; nY = 0; }
        else if (p.y >= M.bot && sy < 0) { hy = M.bot; nY = 1; }
        p.x = hx; p.y = hy; p.dead = true;
        this.emit('imp', hx, hy, nX, nY, p.gn, p.owner ? p.owner.idx : -1);
        return;
      }
      // platforms stop a round that comes down onto them (you can still shoot up through one)
      if (sy > 0) {
        const s = MV2.surf(st, p.x, p.y, nx, ny);
        if (s && s !== st.mainSurf) {
          const k = (s.y - p.y) / sy; p.x = p.x + sx * k; p.y = s.y; p.dead = true;
          this.emit('imp', p.x, p.y, 0, -1, p.gn, p.owner ? p.owner.idx : -1);
          return;
        }
      }
      p.x = nx; p.y = ny;
    }
    if (p.x < st.blast.l || p.x > st.blast.r || p.y < st.blast.t || p.y > st.blast.b) p.dead = true;
  },

  // ---- shotgun: every pellet that reaches the same fighter this frame becomes ONE hit, so a
  // point-blank blast lands as one huge shove instead of eight small taps that stale-scale each other
  pend: [],
  pelletHit(p, b) {
    const d = dhypot(p.x - p.x0, p.y - p.y0), g = this.DEF[p.gn];
    const dmg = g.dmg * Math.max(0.45, 1 - d / g.range * 0.7);
    p.dead = true;
    for (const q of this.pend) if (q.b === b && q.o === p.owner) { q.n++; q.dmg += dmg; q.x += p.x; q.y += p.y; q.vx += p.vx; return; }
    this.pend.push({ b, o: p.owner, n: 1, dmg, x: p.x, y: p.y, vx: p.vx, gn: p.gn });
  },
  resolvePellets(G) {
    if (!this.pend.length) return;
    const list = this.pend; this.pend = [];
    for (const q of list) {
      const b = q.b, o = q.o, x = q.x / q.n, y = q.y / q.n;
      if (b.state === 'dead' || b.untouchable) continue;
      if (b.state === 'shield') { G.shieldHit(b, q.dmg, x - q.vx, null, q.shieldEat); this.emit('hit', x, y, q.vx, 0, q.gn, b.idx, q.dmg); continue; }
      const keep = o ? o.hitlag : 0, n = q.n;
      this.curN = n;
      b.takeHit({ dmg: q.dmg, ang: n >= 6 ? 34 : 28, bkb: 10 + 5 * n, kbg: 30 + 9 * n, radial: true, kind: 'buck' }, o, 1, x - q.vx, 1);
      this.curN = 0;
      if (o) o.hitlag = keep;
      this.emit('hit', x, y, q.vx < 0 ? -1 : 1, 0, q.gn, b.idx, q.dmg);
      if (n >= 6) {                                    // point blank: the whole load
        G.impact = { x: b.x, y: b.y - b.h * 0.5, t: 30 }; G.shake(14);
        this.emit('blast', b.x, b.y - b.h * 0.5, q.vx < 0 ? -1 : 1, 0, q.gn, b.idx, n);
      }
    }
  },

  // ---- post-hit weight, by calibre (from the takeHit wrapper below)
  after(v, att, g, kb, hb) {
    if (v.state !== 'hitstun') return;
    if (g.auto) v.hitlag = Math.min(v.hitlag, 2);          // a hose is a stream of flinches, not a freeze
    else if (g.stop) v.hitlag = Math.min(22, v.hitlag + g.stop);
    if (g.stagger && !v.air && kb < 80) { v.hitstun = Math.max(v.hitstun, g.stagger); v.vx *= 0.6; }
    if (hb.kind === 'r308') { Game.impact = { x: v.x, y: v.y - v.h * 0.5, t: 30 }; }
  },

  // ================= throwing the gun =================
  throwGun(f) {
    const it = f.item; if (!it) return;
    const A = this.aimVec(f); let ax = A[0], ay = A[1];
    if (A[2]) { ax = f.face; ay = 0; }                     // no crouch throw: it goes forward
    if (ax > 0.1) f.face = 1; else if (ax < -0.1) f.face = -1;
    let vx, vy;
    if (!ay) { vx = ax * 17; vy = -3.2; }                  // a flat, fast throw with a little arc
    else if (!ax) { vx = f.face * 1.2; vy = ay * 16; if (ay > 0 && !f.air) vy = 2; }
    else { vx = ax * 14.5; vy = ay * 14.5 - 1.5; }
    Game.items.push({ kind: it.kind, x: f.x + ax * f.w * 0.45, y: f.y - f.h * 0.62 + ay * f.h * 0.3, vx, vy, age: 0, armed: true,
      thrownBy: f, gnThrow: 1, ammo: it.ammo > 0 ? it.ammo : 0, hp: 0, spin: vx < 0 ? -1 : 1 });
    f.item = null;
    f.startMove(this.THROW);
    this.emit('throw', f.x, f.y - f.h * 0.6, vx, vy, it.kind, f.idx);
  },
  THROW: { total: 16, throwAnim: 'f', sfx: 'none' },
  // a gun item's own motion (ITEM_DEFS[k].tick): the spinning throw, and spent guns tidying up
  itemTick(it, G, st) {
    if (!GUNS.on()) return false;
    if (it.gnThrow && it.armed) {
      const px = it.x, py = it.y;
      it.vy = Math.min(it.vy + 0.42, 16); it.x += it.vx; it.y += it.vy;
      for (const b of G.fighters) {
        if (b === it.thrownBy || b.untouchable || b.state === 'dead' || b.state === 'grabbed') continue;
        if (!circleRect(it.x, it.y, 20, b)) continue;
        if (b.state === 'shield') { G.shieldHit(b, 8, it.x, null); this.emit('clat', it.x, it.y, 0, 0, it.kind, -1, 8); }
        else this.bonk(b, it);
        it.vx = -it.vx * 0.28; it.vy = -5.5; it.armed = false; it.gnThrow = 0;
        return true;
      }
      const s = MV2.surf(st, px, py, it.x, it.y);
      if (s) {
        it.y = s.y; const hard = it.vy;
        this.emit('clat', it.x, it.y, 0, -1, it.kind, -1, hard);
        if (hard > 4) { it.vy = -hard * 0.32; it.vx *= 0.55; } else { it.vy = 0; it.vx *= 0.4; }
        it.gnThrow = 0; it.armed = false;
        return true;
      }
      const M = st.main;
      if (it.y > M.top + 2 && it.y < M.bot && it.x > M.x0 && it.x < M.x1 && !(G.holes.length && Items2.inHole(it.x))) {
        it.x = it.x < 0 ? M.x0 - 2 : M.x1 + 2; it.vx = -it.vx * 0.4; this.emit('clat', it.x, it.y, 1, 0, it.kind, -1, 6);
      }
      if (it.y > st.blast.b || it.x < st.blast.l || it.x > st.blast.r || it.y < st.blast.t - 200) it.dead = true;
      return true;
    }
    // an empty gun lying on the floor: pick it up and throw it again, or it's gone in 5 s
    if (!it.armed && !(it.ammo > 0) && it.age > 30) {
      it.restT = (it.restT || 0) + 1;
      if (it.restT > 300) it.dead = true;
    }
    return false;
  },
  bonk(b, it) {
    const g = this.DEF[it.kind] || this.DEF.pistol, a = it.thrownBy, keep = a ? a.hitlag : 0;
    const wasGround = !b.air;
    const kb = b.takeHit({ dmg: g.throwDmg, ang: 48, bkb: 30, kbg: 40, radial: true, kind: 'gunthrow' }, a || null, 1, it.x - it.vx, 1);
    if (a) a.hitlag = keep;
    // a gun to the head: a short daze if it didn't launch them (STATUS.stagger reuses the dizzy state)
    if (wasGround && kb < 70 && b.state === 'hitstun') STATUS.stagger(b, 26, '#ffd45c');
    Game.text(b.x, b.y - b.h - 18, 'BONK', '#ffd45c', 1.25);
    this.emit('bonk', it.x, it.y, it.vx, it.vy, it.kind, b.idx, g.throwDmg);
  },
  // picking one up: keep what's in it (a thrown / dropped empty gun comes back empty)
  pick(f, it) {
    if (!GUNS.on()) return false;
    f.item = { kind: it.kind, ammo: it.ammo > 0 ? it.ammo : 0, cd: 0 };
    GUNS.emit('pick', f.x, f.y - f.h * 0.6, 0, 0, it.kind, f.idx, f.item.ammo);
    return true;
  },

  // ================= per frame (end of Items.update, local + online rules only) =================
  tick(G) {
    this.resolvePellets(G);
    // the Laser Gun is the one gun the seeded arena knows, so it keeps its kind there. In local and
    // online play it comes out of the box as a real pistol instead (same spawn roll, same slot).
    for (const it of G.items) if (it.kind === 'raygun' && !it.gnSeen) { it.gnSeen = 1; it.kind = 'pistol'; it.ammo = this.DEF.pistol.mag; }
  },

  // ================= CPU =================
  ai(f, tgt, o, press) {
    const it = f.item, g = this.DEF[it.kind]; if (!g) return false;
    const dx = tgt.x - f.x, dy = (tgt.y - tgt.h * 0.5) - (f.y - f.h * 0.6), adx = Math.abs(dx), ady = Math.abs(dy);
    const lvl = f.level || 5;
    if (!(it.ammo > 0)) {                                   // dry: close in and throw it at them
      if (adx < 420 && ady < 110 && Rng.next() < 0.08 + lvl * 0.006) { o[dx > 0 ? 'right' : 'left'] = true; press('attack'); return true; }
      return false;
    }
    if (it.cd > 0 || adx > (g.range || 600) * 0.75) return false;
    let ax = 0, ay = 0;
    if (ady < 60) ax = dx > 0 ? 1 : -1;
    else if (adx < ady * 0.42) ay = dy > 0 ? 1 : -1;
    else { ax = dx > 0 ? 1 : -1; ay = adx < ady * 2.4 ? (dy > 0 ? 1 : -1) : 0; }
    if (ay > 0 && !ax && !f.air) return false;
    if (Rng.next() > (g.auto ? 0.08 : 0.055) + lvl * 0.004) return false;
    if (ax) o[ax > 0 ? 'right' : 'left'] = true;
    if (ay < 0) o.up = true; else if (ay > 0) o.down = true;
    press('attack');
    if (g.auto) { const K = ['attack']; if (ax) K.push(ax > 0 ? 'right' : 'left'); if (ay) K.push(ay < 0 ? 'up' : 'down'); f.ai.holdK = K; f.ai.holdT = irand(8, 24); }
    return true;
  },
};
GUNS.ev = Array.from({ length: GUNS.N_EV }, () => ({ seq: 0, type: '', x: 0, y: 0, ax: 0, ay: 0, k: '', f: -1, v: 0, frame: 0 }));

// ---- move defs: gunAnim plants + aims (91 picks the 'guard' clip, 97 lays the arm along the shot).
// `onLand` keeps the move alive through a landing, so you can shoot all the way down and keep going.
for (const id of Object.keys(GUNS.DEF)) {
  const g = GUNS.DEF[id]; g.id = id;
  if (g.round) GUNS.ROUND[g.round] = id;
  g.mv = { total: 999, clip: 'punch', gunAnim: true, sfx: 'none', gun: id, tick(f, t) { GUNS.tickMove(f, t); }, onLand(f) { if (f.move) f.move.air = false; } };
}
GUNS.ROUND.gunthrow = null;

// ---- item defs. The three new guns are set 2 (never in the seeded arena's set-1 pool). The old
// Machine Gun leaves the random pool for the SMG. Existing kinds keep their old behaviour whenever
// GUNS.on() is false.
Object.assign(ITEM_DEFS, {
  pistol:   { name: 'Pistol', r: 20, weight: 0, set: 2, ammo: GUNS.DEF.pistol.mag, icon: '🔫' },        // spawns in the Laser Gun's slot (GUNS.tick)
  revolver: { name: 'Revolver', r: 20, weight: 3, set: 2, ammo: GUNS.DEF.revolver.mag, icon: '🤠' },
  smg:      { name: 'SMG', r: 22, weight: 3, set: 2, ammo: GUNS.DEF.smg.mag, icon: '🔫' },
  ak:       { name: 'The Chopper', r: 24, weight: 2, set: 2, ammo: GUNS.DEF.ak.mag, icon: '🔫' },
  blaster:  { name: 'Twin Nines', r: 22, weight: 0, street: 0.9, set: 3, ammo: GUNS.DEF.blaster.mag, icon: '🔫' },
  bow:      { name: 'Speargun', r: 24, weight: 0, set: 3, ammo: GUNS.DEF.bow.mag, icon: '🏹' },
  sweeper:  { name: 'Street Sweeper', r: 26, weight: 0, set: 3, delay: 1200, ammo: GUNS.DEF.sweeper.mag, icon: '💥' },
  bolt:     { name: 'Captive Bolt', r: 24, weight: 0, set: 3, delay: 2400, ammo: GUNS.DEF.bolt.mag, icon: '🔩' },
  // one round, and it is locked for the first minute of the match: this is a finisher, on the same
  // warm-up shelf as the Wrecking Ball, not something you open with
  deagle:   { name: 'Desert Eagle', r: 22, weight: 0, set: 3, delay: 3600, ammo: GUNS.DEF.deagle.mag, icon: '\u{1F52B}' },
});
// THE PRACTICE SWEEP COULD NEVER REACH THE GUNS. 57_items3.js answers *"i want all of the items to
// appear in the game when you play but make them rare"* by taking every `set: 3` kind down to
// weight 0.4 / set 2 — but it builds that list with `Object.keys(ITEM_DEFS)` at its own load time,
// and THIS file runs after it, so the six guns were defined too late to be in it. They kept
// `weight: 0`, and `Items2.inSet` only ever draws a kind whose weight is above zero, so the guns
// were the one part of the store that could not drop at any item set at all.
//
// Same treatment here, after they exist. The `delay` locks are kept rather than zeroed: a round
// should not open with a Street Sweeper, and the Desert Eagle is a one-round finisher.
for (const id of ['blaster', 'bow', 'sweeper', 'bolt', 'deagle']) {
  const d = ITEM_DEFS[id];
  if (d && d.set === 3) { d.weight = 0.4; d.set = 2; }
}

ITEM_DEFS.mgun.weight = 0;
ITEM_DEFS.shotgun.weight = 3; ITEM_DEFS.shotgun.ammo = GUNS.DEF.shotgun.mag;
ITEM_DEFS.sniper.weight = 2; ITEM_DEFS.sniper.ammo = GUNS.DEF.sniper.mag;
for (const id of Object.keys(GUNS.DEF)) {
  const d = ITEM_DEFS[id], old = d.use;
  d.use = (f, it) => (GUNS.on() ? GUNS.use(f, it) : old ? old(f, it) : false);
  const oldTick = d.tick; d.tick = (it, G, st) => (GUNS.on() ? GUNS.itemTick(it, G, st) : oldTick ? oldTick(it, G, st) : false);
  const oldPick = d.pick; d.pick = (f, it) => (GUNS.on() ? GUNS.pick(f, it) : oldPick ? oldPick(f, it) : false);
}
// every round kind stale-scales on repeat hits, like every other shot (65_balance "keep shooting til they fall off")
for (const k of ['r9', 'r44', 'rsmg', 'rak', 'rbls', 'rarw', 'rsweep', 'rbolt', 'r308', 'buck', 'gunthrow']) BAL.SHOTS.add(k);

// ---- hook: the shared projectile stepper runs our rounds (anything without `gn` is untouched)
MV2.projStep = (function (base) {
  return function (p, G, M) {
    if (p.gn && p.kind !== 'rocket') return GUNS.step(p, G, M);
    return base.call(this, p, G, M);
  };
})(MV2.projStep);

// ---- hook: throwing. With a gun in hand (and gun rules on) throws go through GUNS.throwGun.
Fighter.prototype.throwItem = (function (base) {
  return function () {
    if (GUNS.on() && this.item && GUNS.isGun(this.item.kind)) return GUNS.throwGun(this);
    return base.call(this);
  };
})(Fighter.prototype.throwItem);

// ---- hook: calibre-specific hit weight, and the SMG flinch cap
Fighter.prototype.takeHit = (function (base) {
  return function (hb, att, mult, srcX, srcFace) {
    const id = hb && hb.kind && GUNS.ROUND[hb.kind];
    if (!id || !GUNS.on()) return base.call(this, hb, att, mult, srcX, srcFace);
    const g = GUNS.DEF[id];
    // after 3 SMG hits inside 40 frames, more SMG hits still hurt but stop interrupting you
    if (g.auto) {
      if (Game.frame - (this.gnFlT || -999) > 40) this.gnFlN = 0;
      this.gnFlT = Game.frame;
      if ((this.gnFlN = (this.gnFlN || 0) + 1) > 3) {
        const d = hb.dmg * 0.7;
        this.dmg = Math.min(999, this.dmg + d); this.stats.taken += d;
        if (att && att !== this) { att.stats.dealt += d; this.lastHitBy = att; this.lastHitT = Game.frame; }
        this.flashT = Math.max(this.flashT, 3);
        this.vx += (this.x >= srcX ? 1 : -1) * 0.35;
        return 0;
      }
    }
    const d0 = this.dmg;
    const kb = base.call(this, hb, att, mult, srcX, srcFace);
    // THE DESERT EAGLE'S ROUND. `crit` is a damage FLOOR, applied AFTER the hit has already worked
    // out its knockback -- so the shot itself still barely moves them, and what it leaves behind is
    // a fighter at 160% who goes off the top of the screen on the next thing that touches them.
    // Only on a hit that actually landed: a shielded or whiffed round changes nothing.
    if (g.crit && this.dmg > d0 && this.dmg < g.crit) {
      const top = g.crit - this.dmg;
      this.dmg = g.crit;
      this.stats.taken += top;
      if (att && att !== this) att.stats.dealt += top;
      this.flashT = Math.max(this.flashT, 10);
      if (typeof Game !== 'undefined' && Game.text) Game.text(this.x, this.y - this.h - 26, 'CRITICAL', '#ff3a4a', 1.4);
    }
    GUNS.after(this, att, g, kb || 0, hb);
    return kb;
  };
})(Fighter.prototype.takeHit);

// ---- hook: every round that ended this frame (hit, stopped by a shield or the floor, out of range)
// leaves its full path in the event ring, so the page can draw the tracer from the muzzle to where it
// ended — even when it died in the same frame it was fired. Writes nothing the fight reads.
Game.updateProjs = (function (base) {
  return function () {
    const before = this.projs, r = base.apply(this, arguments);
    if (GUNS.on()) for (const p of before) if (p.dead && p.gn && !p.traced && p.kind !== 'rocket') { p.traced = 1; GUNS.emit('trace', p.x0, p.y0, p.x, p.y, p.gn, p.owner ? p.owner.idx : -1, p.pellet ? 1 : 0); }
    return r;
  };
})(Game.updateProjs);

// ---- hook: per frame, after the item update (pellet hits resolve after the projectiles moved)
Items.update = (function (base) {
  return function () {
    base.call(this);
    if (GUNS.on()) GUNS.tick(Game);
  };
})(Items.update);

// ---- hook: CPU players use the guns (and throw them when they are dry)
Items2.ai = (function (base) {
  return function (f, tgt, o, press) {
    if (GUNS.on() && f.item && GUNS.isGun(f.item.kind)) return GUNS.ai(f, tgt, o, press);
    return base.call(this, f, tgt, o, press);
  };
})(Items2.ai);

// ---- hook: a fresh match clears the pellet queue and the ring cursor stays monotonic
Game.start = (function (base) {
  return function () {
    const r = base.apply(this, arguments);
    GUNS.pend = [];
    return r;
  };
})(Game.start);

if (typeof window !== 'undefined') window.GUNS = GUNS;
