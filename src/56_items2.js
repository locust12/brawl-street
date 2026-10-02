// ===== items, set 2: banana bomb (shrapnel), holy bomb, TNT (blows a hole in the stage), landmine,
// jetpack, supply crate, bubble shield, and four weapons (bazooka, shotgun, machine gun, sniper) =====
// Fight code (runs in the page and the headless sims): seeded rand()/irand() only.
// Every kind here has `set: 2`. Items.spawn only draws set-2 kinds when Game.itemSet >= 2, and
// Game.start gives seeded fights (bet arena, online) itemSet 1, so the arena's spawn sequence and
// every arena fight stay byte-identical. Local matches (no seed) get set 2; the online driver can opt
// in with `Game.itemSet = 2` right after Game.start. Items2.update (crates, jetpack fuel, bubble
// timers) only runs for set 2, and Game.holes stays empty unless TNT goes off.
//
// Hooks the engine calls (all no-ops for set-1 items): def.tick(it) (own motion, return true to skip the
// default), def.after(it) (after an explosion), def.pick(f, it) (on pickup, return true = consumed),
// def.use(f, it) (attack while held), def.hittable(it, a, h) (an attack touched it), def.lob (thrown on an arc),
// def.shootable (any projectile sets it off), def.cool (frames the weapon is locked after a shot),
// Fighter.collideHoles (floor with holes), Items2.absorb (bubble shield in takeHit).

Object.assign(ITEM_DEFS, {
  banana:  { name: 'Banana Bomb', r: 18, weight: 2.4, set: 2, throwable: true, lob: true, shootable: true, fuse: 110, boom: { r: 95, dmg: 12, bkb: 55, kbg: 82 }, icon: '🍌', after: it => Items2.shrapnel(it) },
  // the banana's shrapnel: each piece lands, sits there blinking, then pops. weight 0 = never spawns on its own
  banalet: { name: 'Bomblet', r: 13, weight: 0, set: 2, shootable: true, fuse: 54, boom: { r: 74, dmg: 8, bkb: 46, kbg: 66 }, icon: '🍌',
             tick: it => Items2.banaletTick(it), hittable: (it, a) => { if (a) it.thrownBy = a; Items2.smallBoom(it); } },
  holy:    { name: 'Holy Bomb', r: 20, weight: 0.8, set: 2, throwable: true, fuse: 100, boom: { r: 235, dmg: 32, bkb: 110, kbg: 118 }, icon: '😇',
             tick: it => Items2.holyTick(it), after: it => { Game.flashT = 10; Game.shake(30); Game.text(it.x, it.y - 70, 'AMEN', '#fff3b0', 2); } },
  tnt:     { name: 'TNT', r: 22, weight: 1.6, set: 2, fuse: 360, shootable: true, boom: { r: 150, dmg: 26, bkb: 82, kbg: 100 }, icon: '🧱',
             use: (f, it) => Items2.placeTnt(f, it), hittable: (it, a) => Items2.setOff(it, a), after: it => Items2.hole(it.x, it.y) },
  mine:    { name: 'Landmine', r: 14, weight: 1.8, set: 2, shootable: true, boom: { r: 92, dmg: 15, bkb: 58, kbg: 80 }, icon: '🛑',
             use: (f, it) => Items2.placeMine(f, it), hittable: (it, a) => Items2.setOff(it, a), tick: (it, G, st) => Items2.mineTick(it, G, st) },
  jetpack: { name: 'Jetpack', r: 20, weight: 2, set: 2, ammo: 360, icon: '🚀' },
  bubble:  { name: 'Bubble Shield', r: 18, weight: 1, set: 2, instant: true, icon: '🫧', pick: f => Items2.giveBubble(f) },
  // weapons: held, attack fires (up / down tilts the aim), `ammo` shots then they're gone
  bazooka: { name: 'Bazooka', r: 22, weight: 1.8, set: 2, ammo: 2, cool: 55, icon: '💥', use: (f, it) => Items2.fire(f, it) },
  shotgun: { name: 'Shotgun', r: 20, weight: 1.8, set: 2, ammo: 3, cool: 45, icon: '🎆', use: (f, it) => Items2.fire(f, it) },
  mgun:    { name: 'Machine Gun', r: 22, weight: 1.6, set: 2, ammo: 2, cool: 70, icon: '⚙️', use: (f, it) => Items2.fire(f, it) },
  sniper:  { name: 'Sniper Rifle', r: 22, weight: 1.2, set: 2, ammo: 2, cool: 80, icon: '🎯', use: (f, it) => Items2.fire(f, it) },
  blastx:  { name: 'Rocket Blast', r: 10, weight: 0, set: 2, boom: { r: 88, dmg: 14, bkb: 58, kbg: 86 }, icon: '💥' },   // the bazooka's explosion (never spawns)
  crate:   { name: 'Supply Crate', r: 26, weight: 0, set: 2, throwable: true, icon: '📦',
             tick: (it, G, st) => Items2.crateTick(it, G, st), pick: (f, it) => { Items2.openCrate(it); return true; }, hittable: (it, a, h) => Items2.hitCrate(it, a, h) },
});

// weapon moves: a recoil pose, the machine-gun burst, the sniper's aim-then-shoot. They end in real
// recovery frames, and the weapon itself is locked for `cool` frames after firing, so mashing can't chain.
// weapon moves: a recoil pose, the machine-gun burst, the sniper's aim-then-shoot
const I2_KICK = { total: 30, clip: 'punch', gunAnim: true, fx: 'muzzle', sfx: 'none', tick(f, t) { if (f.air) f.vy = Math.min(f.vy, 1.5); } };
const I2_BURST = { total: 64, clip: 'punch', gunAnim: true, fx: 'burst', sfx: 'none', tick(f, t) { Items2.burst(f, t); } };
const I2_SNIPE = { total: 70, clip: 'punch', gunAnim: true, fx: 'scope', sfx: 'none', tick(f, t) { Items2.snipe(f, t); } };

const Items2 = {
  game: null, crateT: 0,
  inSet(d) { return !d.set || (d.weight > 0 && d.set <= (Game.itemSet || 1)); },
  inHole(x) { for (const q of Game.holes) if (x > q.x0 && x < q.x1) return true; return false; },
  offStage(f) { const M = Game.stage.main; return f.x < M.x0 || f.x > M.x1 || f.y > M.top + 4 || (Game.holes.length > 0 && Items2.inHole(f.x)); },

  // per frame, set-2 matches only (called at the end of Items.update)
  update(G, st) {
    if (this.game !== G.fighters) { this.game = G.fighters; this.crateT = G.feel ? FEEL.crateT(true) : irand(700, 1100); }   // Game.itemRate (25_feel)
    if (G.itemsOn && !G.demoNoItems && G.countdown <= 0 && !G.endT && !(G.feel && FEEL.rate() === 'off') && --this.crateT <= 0) {
      this.crateT = G.feel ? FEEL.crateT(false) : irand(1100, 1700);
      if (G.items.filter(i => i.kind === 'crate').length < 2) {
        const x = rand(st.main.x0 + 80, st.main.x1 - 80);
        G.items.push({ kind: 'crate', x, y: st.blast.t + 110, vx: 0, vy: 0, age: 0, chute: true, hp: 0, ammo: 0 });
        G.ring(x, st.blast.t + 180, '#ffd45c', 40);
      }
    }
    this.shootCheck(G);
    for (const f of G.fighters) {
      if (f.state === 'dead') { f.bubbleHits = 0; f.bubbleT = 0; f.dropAfter = null; continue; }
      if (f.item && f.item.cd > 0) f.item.cd--;
      if (f.dropAfter && f.state !== 'move') { f.item = null; f.dropAfter = null; G.text(f.x, f.y - f.h - 20, 'EMPTY', '#aaa', 0.9); G.puff(f.x, f.y - f.h * 0.5, 5, '#9a9aa8'); }
      if (f.bubbleT > 0 && --f.bubbleT <= 0) this.pop(f);
      const it = f.item;
      if (it && it.kind === 'jetpack') {
        if (f.in.jump && f.air && (f.state === 'air' || f.state === 'helpless') && it.ammo > 0) {
          f.vy = Math.max(f.vy - 1.35, -8); f.fastFall = false; it.ammo--; f.jetT = G.frame;
          if (f.state === 'helpless') f.setState('air');
          if (G.frame % 2 === 0) G.parts.push({ x: f.x - f.face * f.w * 0.3 + rand(-5, 5), y: f.y - f.h * 0.3, vx: rand(-0.6, 0.6), vy: rand(3, 5), life: 18, max: 18, color: G.frame % 4 ? '#ff9a2a' : '#ffe27a', size: rand(8, 14), g: 0, fire: true });
        }
        if (it.ammo <= 0) { f.item = null; G.text(f.x, f.y - f.h - 20, 'OUT OF FUEL', '#aaa', 0.9); G.puff(f.x, f.y - f.h * 0.5, 8, '#9a9aa8'); }
      }
    }
  },

  // ---- banana bomb: the blast throws seven pieces out, and every piece is a live bomblet ----
  // They arc out, bounce, settle on the deck with the fuse spark blinking, then pop a beat later - and
  // one popping sets off the ones beside it, so the floor goes off in a rolling chain.
  shrapnel(it) {
    const N = 7;
    for (let i = 0; i < N; i++) {
      const a = deg(-158 + i * (116 / (N - 1))), sp = rand(6.5, 9.5);
      Game.items.push({ kind: 'banalet', x: it.x + dcos(a) * 14, y: it.y - 12 + dsin(a) * 8, vx: dcos(a) * sp, vy: dsin(a) * sp - 1.5,
        age: 0, armed: true, thrownBy: it.thrownBy || null, fuse: irand(44, 74), hp: 0, ammo: 0 });
    }
    Game.text(it.x, it.y - 46, 'SPLIT', '#ffe04a', 1.1);
  },
  banaletTick(it) {
    if (it.armed && it.fuse != null && it.fuse <= 1) { this.smallBoom(it); return true; }   // own, quieter blast
    return false;                                                                           // otherwise normal item physics
  },
  smallBoom(it) {
    if (it.dead) return;
    it.dead = true;
    const G = Game, b = ITEM_DEFS.banalet.boom;
    for (const f of G.fighters) {
      if (f.state === 'dead' || f.untouchable) continue;
      if (dhypot(f.x - it.x, (f.y - f.h / 2) - it.y) > b.r + f.w * 0.4) continue;
      const keep = it.thrownBy ? it.thrownBy.hitlag : 0;
      f.takeHit({ dmg: b.dmg, ang: 62, bkb: b.bkb, kbg: b.kbg, radial: true }, it.thrownBy || null, 1, it.x, 1);
      if (it.thrownBy && it.thrownBy !== f) it.thrownBy.hitlag = keep;
    }
    for (let i = 0; i < 16; i++) { const a = rand(0, TAU), s = rand(2, 7); G.parts.push({ x: it.x, y: it.y, vx: dcos(a) * s, vy: dsin(a) * s, life: 22, max: 22, color: i % 3 ? '#ffe04a' : '#ffffff', size: rand(4, 9), g: 0.06 }); }
    for (let i = 0; i < 8; i++) { const a = rand(0, TAU), s = rand(1, 4); G.parts.push({ x: it.x, y: it.y, vx: dcos(a) * s, vy: dsin(a) * s - 1, life: 24, max: 24, color: i % 2 ? '#ff8a1a' : '#ffe27a', size: rand(14, 26), g: 0, fire: true }); }
    G.rings.push({ x: it.x, y: it.y, r: 8, max: b.r * 1.15, color: '#ffe04a', life: 14, w: 9 });
    G.shake(7); Sfx.tone(150, 60, 0.18, 'square', 0.09);
    let n = 0;
    for (const o of G.items) if (!o.dead && o.kind === 'banalet' && o !== it && dhypot(o.x - it.x, o.y - it.y) < b.r) { o.armed = true; o.fuse = Math.min(o.fuse == null ? 99 : o.fuse, 5 + (++n) * 3); }
  },
  // ---- holy bomb: when the fuse runs out it hangs in the air for a beat, then goes off huge ----
  holyTick(it) {
    if (it.holyT > 0) { it.vx = 0; it.vy = 0; if (--it.holyT <= 0) Items.explode(it); return true; }
    if (it.armed && it.fuse != null && it.fuse <= 1) {
      it.holyT = 54; it.y -= 30;
      Game.text(it.x, it.y - 60, 'HALLELUJAH', '#fff3b0', 1.6); Game.rings.push({ x: it.x, y: it.y, r: 10, max: 150, color: '#fff3b0', life: 30, w: 10 });
      for (const [n, d] of [[523, 0], [659, 0.05], [784, 0.1], [1047, 0.18]]) Sfx.tone(n, n, 0.9, 'sine', 0.07, d);
      return true;
    }
    return false;
  },
  // ---- bubble shield ----
  giveBubble(f) {
    f.bubbleHits = 3; f.bubbleT = 600;
    Game.text(f.x, f.y - f.h - 30, 'BUBBLE SHIELD', '#9fe8ff', 1.2); Game.ring(f.x, f.y - f.h / 2, '#9fe8ff', 80);
    return true;
  },
  absorb(f, att) {
    f.bubbleHits--; f.flashT = 4; f.hitlag = 3; if (att && att !== f) att.hitlag = Math.max(att.hitlag, 3);
    Game.ring(f.x, f.y - f.h / 2, '#9fe8ff', 70); Sfx.shield();
    if (f.bubbleHits <= 0) this.pop(f);
    return true;
  },
  pop(f) {
    f.bubbleHits = 0; f.bubbleT = 0;
    Game.text(f.x, f.y - f.h - 20, 'POP', '#9fe8ff', 1); Game.burst(f.x, f.y - f.h / 2, '#bff4ff', 16); Sfx.tone(900, 300, 0.1, 'sine', 0.1);
  },
  // ---- TNT: placed where you stand, long fuse, blows a hole in the main stage ----
  placeTnt(f, it) {
    Game.items.push({ kind: 'tnt', x: f.x + f.face * f.w * 0.3, y: f.y - 4, vx: 0, vy: f.air ? 2 : 0, age: 0, armed: true, thrownBy: f, fuse: it.fuse != null ? it.fuse : ITEM_DEFS.tnt.fuse, hp: 0, ammo: 0 });
    f.item = null; f.startMove({ total: 14, throwAnim: 'f' });
    Game.text(f.x, f.y - f.h - 24, 'FUSE LIT', '#ff6a3a', 1); Sfx.tone(200, 120, 0.2, 'square', 0.1);
    return true;
  },
  // shot or struck: TNT and mines go off on the spot
  setOff(it, a) {
    if (it.dead) return;
    if (a) it.thrownBy = a;
    Game.text(it.x, it.y - 40, 'SET OFF', '#ff8a3a', 1.1);
    Items.explode(it);
  },
  // any projectile touching a shootable item sets it off (set-2 only, so the arena never sees it)
  shootCheck(G) {
    for (const it of G.items) {
      const def = ITEM_DEFS[it.kind];
      if (it.dead || !def.shootable) continue;
      for (const p of G.projs) {
        if (p.dead || dhypot(p.x - it.x, p.y - it.y) > def.r + p.r + 4) continue;
        if (!p.pierce && !p.boomer) p.dead = true;
        this.setOff(it, p.owner);
        break;
      }
    }
  },
  // ---- landmine: arms after a second, then anyone stepping near starts its three-second fuse ----
  placeMine(f, it) {
    Game.items.push({ kind: 'mine', x: f.x + f.face * f.w * 0.25, y: f.y - 2, vx: 0, vy: f.air ? 2 : 0, age: 0, armed: true, thrownBy: f, armT: 60, hp: 0, ammo: 0 });
    f.item = null; f.startMove({ total: 14, throwAnim: 'f' });
    Game.text(f.x, f.y - f.h - 24, 'MINE SET', '#ff6a6a', 1); Sfx.tone(600, 900, 0.08, 'square', 0.08);
    return true;
  },
  mineTick(it, G) {
    if (it.armT > 0) { it.armT--; return false; }
    if (it.fuse != null) return false;   // already triggered: the fuse countdown takes over
    for (const f of G.fighters) {
      if (f.state === 'dead' || f.state === 'respawn' || (f === it.thrownBy && it.age < 100)) continue;
      if (dhypot(f.x - it.x, (f.y - f.h * 0.4) - it.y) > 46 + f.w * 0.4) continue;
      it.fuse = 180; Game.text(it.x, it.y - 36, 'TRIGGERED', '#ff4a4a', 1.1); Sfx.tone(1200, 1200, 0.06, 'square', 0.1);
      break;
    }
    return false;
  },
  // ---- dropping: shield + down puts what you hold on the floor, instantly ----
  dropItem(f) {
    const it = f.item; if (!it) return false;
    const def = ITEM_DEFS[it.kind];
    Game.items.push({ kind: it.kind, x: f.x + f.face * f.w * 0.3, y: f.y - 2, vx: 0, vy: f.air ? 1 : 0, age: 0, hp: def.hp || 0, ammo: it.ammo || 0, fuse: it.fuse });
    f.item = null; f.dropAfter = null;
    Game.text(f.x, f.y - f.h - 18, 'DROPPED', '#cfd4e8', 0.9); Game.puff(f.x, f.y - 6, 5, '#cfd4e8'); Sfx.tone(300, 180, 0.07, 'square', 0.08);
    return true;
  },
  hole(x, y) {
    const st = Game.stage, M = st.main;
    if (Math.abs(y - M.top) > 40 || x < M.x0 + 10 || x > M.x1 - 10) return;
    let x0 = clamp(x - 60, M.x0 + 36, M.x1 - 36), x1 = clamp(x + 60, M.x0 + 36, M.x1 - 36);
    if (x1 - x0 < 40) return;
    const keep = [];
    for (const q of Game.holes) { if (q.x1 < x0 || q.x0 > x1) keep.push(q); else { x0 = Math.min(x0, q.x0); x1 = Math.max(x1, q.x1); } }
    keep.push({ x0, x1, t: Game.frame }); keep.sort((p, q) => p.x0 - q.x0);
    Game.holes = keep;
    // ledges: the stage's own two, plus both edges of every hole
    if (!st.baseLedges) st.baseLedges = st.ledges.slice();
    const next = st.baseLedges.slice();
    for (const q of Game.holes) {
      next.push(st.ledges.find(L => L.x === q.x0 && L.side === 1) || { x: q.x0, y: M.top, side: 1, holder: null });
      next.push(st.ledges.find(L => L.x === q.x1 && L.side === -1) || { x: q.x1, y: M.top, side: -1, holder: null });
    }
    for (const L of st.ledges) if (!next.includes(L) && L.holder && L.holder.state === 'ledge') { const h = L.holder; h.ledge = null; h.air = true; h.plat = null; h.setState('air'); }
    st.ledges = next;
    Game.text(x, M.top - 90, 'CRATER', '#ff8a3a', 1.6); Game.shake(20);
    for (let i = 0; i < 24; i++) Game.parts.push({ x: x + rand(-50, 50), y: M.top + rand(-4, 20), vx: rand(-4, 4), vy: rand(-9, -3), life: 40, max: 40, color: i % 3 ? '#4a3a30' : '#8a7058', size: rand(6, 12), g: 0.4 });
  },
  // ---- supply crate: parachutes down; attack beside it or hit it to break it open, grab to carry and throw ----
  crateTick(it, G, st) {
    const M = st.main, py = it.y;
    if (it.chute) { it.vy = Math.min(it.vy + 0.04, 1.3); it.x += dsin(it.age * 0.045) * 0.9; }
    else it.vy = Math.min(it.vy + 0.5, 14);
    it.x += it.vx; it.y += it.vy;
    let top = null;
    if (it.vy >= 0) {
      if (py <= M.top && it.y >= M.top && it.x > M.x0 && it.x < M.x1 && !(G.holes.length && this.inHole(it.x))) top = M.top;
      else for (const p of st.plats) if (py <= p.y && it.y >= p.y && it.x > p.x0 && it.x < p.x1) { top = p.y; break; }
    }
    if (top !== null) {
      if (it.armed && (Math.abs(it.vx) > 1.5 || it.vy > 3)) { it.y = top; this.openCrate(it); return true; }
      it.y = top; it.vy = 0; it.vx *= 0.6; if (Math.abs(it.vx) < 0.3) it.vx = 0; it.chute = false; it.armed = false;
    }
    if (it.y > M.top + 2 && it.y < M.bot && it.x > M.x0 && it.x < M.x1 && !(G.holes.length && this.inHole(it.x))) { it.x = it.x < 0 ? M.x0 - 2 : M.x1 + 2; it.vx = -it.vx * 0.5; }
    if (it.y > st.blast.b || it.x < st.blast.l || it.x > st.blast.r) it.dead = true;
    if (it.armed && Math.abs(it.vx) + Math.abs(it.vy) > 3) {
      for (const f of G.fighters) {
        if (f === it.thrownBy || f.untouchable || f.state === 'dead' || !circleRect(it.x, it.y, 26, f)) continue;
        const keep = it.thrownBy ? it.thrownBy.hitlag : 0;
        if (f.state === 'shield') G.shieldHit(f, 10, it.x, null);
        else f.takeHit({ dmg: 10, ang: 40, bkb: 42, kbg: 60, radial: true }, it.thrownBy, 1, it.x - it.vx, 1);
        if (it.thrownBy) it.thrownBy.hitlag = keep;
        this.openCrate(it); break;
      }
    }
    if (!it.armed && !it.chute && it.age > 1800) it.dead = true;
    return true;
  },
  hitCrate(it, a, h) {
    if (h.hb.grab && !a.item) { it.dead = true; a.item = { kind: 'crate', ammo: 0 }; Sfx.coin(); return; }
    this.openCrate(it);
  },
  openCrate(it) {
    if (it.dead && it.opened) return;
    it.dead = true; it.opened = true;
    const G = Game, hasFinal = G.fighters.some(f => f.finalReady) || G.items.some(i => i.kind === 'moonball' && !i.dead);
    const pool = Object.entries(ITEM_DEFS).filter(([k, d]) => k !== 'crate' && this.inSet(d) && !(k === 'moonball' && hasFinal));
    let tot = pool.reduce((s, [, d]) => s + d.weight, 0), r = Rng.next() * tot, kind = pool[0][0];
    for (const [k, d] of pool) { r -= d.weight; if (r <= 0) { kind = k; break; } }
    const def = ITEM_DEFS[kind];
    G.items.push({ kind, x: it.x, y: def.floating ? it.y - 60 : it.y - 12, vx: def.floating ? 0 : rand(-2, 2), vy: def.floating ? 0 : -7, age: 0, baseY: it.y - 60, hp: def.hp || 0, ammo: (Game.feel && def.feelAmmo != null ? def.feelAmmo : def.ammo) || 0 });
    G.text(it.x, it.y - 50, 'SUPPLY DROP', '#ffd45c', 1.1); Sfx.coin();
    for (let i = 0; i < 18; i++) { const an = rand(0, TAU), s = rand(2, 7); G.parts.push({ x: it.x, y: it.y - 16, vx: dcos(an) * s, vy: dsin(an) * s - 2, life: 30, max: 30, color: i % 3 ? '#b8864a' : '#ffd45c', size: rand(5, 10), g: 0.3 }); }
  },
  // ---- weapons ----
  // Aim: neutral shoots straight ahead, Up or Down alone tilts it steeply, Up/Down + a direction is a
  // clean 45-degree diagonal (27_tekken TK.aim/TK.rot). TK.aim returns null in seeded fights, so the
  // bet arena and online keep the exact numbers below and `up` keeps doing the old fixed tilt.
  fire(f, it) {
    const k = it.kind, A = TK.aim(f), up = A ? 0 : (f.in.up ? 1 : f.in.down ? -1 : 0);
    if (it.cd > 0) return true;                       // still cooling down: the press does nothing
    it.cd = ITEM_DEFS[k].cool || 40;
    it.ammo--; if (it.ammo <= 0) f.dropAfter = k;      // last shot: the empty weapon goes once the move ends
    if (k === 'mgun') { f.startMove(I2_BURST); f.move.up = up; f.move.aim = A; return true; }
    if (k === 'sniper') { f.startMove(I2_SNIPE); f.move.up = up; f.move.aim = A; Sfx.tone(1800, 1800, 0.05, 'sine', 0.05); Sfx.slide(0.05); return true; }
    f.startMove(I2_KICK);
    if (k === 'bazooka') {
      const V = TK.rot(A, 12.5, -1.2 - up * 5);
      MV2.spawn(f, { kind: 'rocket', vx: V[0], vy: V[1], grav: 0.13, step: true, boom: true, r: 11, dmg: 4, ang: 40, bkb: 20, kbg: 20, life: 110, after: p => Items2.projBoom(p), color: '#ff8a2a' }, f.w * 0.5 + 16, f.h * 0.62);
      f.vx -= f.face * 3; Sfx.rocketFire(); Game.puff(f.x - f.face * f.w * 0.4, f.y - f.h * 0.6, 6, '#c8c0b8');
    } else {   // shotgun: a tight cone of nine buckshot pellets, damage falling off with distance
      for (let i = 0; i < 9; i++) {
        const spread = (i - 4) * 0.9 + rand(-0.7, 0.7);
        const bx = 20 + rand(-1.5, 1.5), by = spread - up * 4, P = TK.rot(A, bx, by);
        MV2.spawn(f, { kind: 'pellet', vx: P[0], vy: P[1], grav: 0.02, r: 7, dmg: 2.6, dmg0: 2.6, falloff: true, spark: true, step: true, ang: 28, bkb: 18, kbg: 30, life: 16, color: '#ffc04a' }, f.w * 0.5 + 18, f.h * 0.58);
      }
      f.vx -= f.face * 5.5;                                  // the kick shoves the shooter back
      Sfx.shotgun(); Sfx.rack(0.34); Sfx.brass(0.3);
      Game.puff(f.x + f.face * (f.w * 0.5 + 26), f.y - f.h * 0.58, 7, '#d8d0c4');
    }
    return true;
  },
  burst(f, t) {
    if (f.air) f.vy = Math.min(f.vy, 1.2);
    if (t > 40) f.vx *= 0.9;
    if (t < 6 || t > 40 || (t - 6) % 7) return;
    const by = rand(-0.7, 0.7) - (f.move.up || 0) * 3, V = TK.rot(f.move.aim, 22, by);
    MV2.spawn(f, { kind: 'bullet', vx: V[0], vy: V[1], grav: 0, r: 6, dmg: 1.5, ang: 22, bkb: 8, kbg: 12, life: 28, color: '#ffe27a' }, f.w * 0.5 + 18, f.h * 0.58);
    f.vx -= f.face * 0.5; Sfx.mgunTap();
  },
  snipe(f, t) {
    if (f.air) f.vy = Math.min(f.vy, t < 28 ? 0.6 : 2);
    if (t < 26) { f.vx *= 0.7; return; }
    if (t === 26) {
      const V = TK.rot(f.move.aim, 58, -(f.move.up || 0) * 9);
      MV2.spawn(f, { kind: 'snipe', vx: V[0], vy: V[1], grav: 0, r: 7, dmg: 19, ang: 16, bkb: 52, kbg: 92, life: 22, pierce: true, color: '#9ff4ff' }, f.w * 0.5 + 20, f.h * 0.6);
      f.vx -= f.face * 5; Sfx.sniperShot(); Sfx.brass(0.22); Game.shake(4);
    }
  },
  projBoom(p) {
    if (p.boomed) return; p.boomed = true; p.dead = true;
    Items.explode({ kind: 'blastx', x: p.x, y: p.y, vx: 0, vy: 0, thrownBy: p.owner, age: 0 });
  },
  holeOf(f) { for (const q of Game.holes) if (f.x > q.x0 - 10 && f.x < q.x1 + 10 && f.y > Game.stage.main.top + 4) return q; return null; },
  // ---- CPU ----
  ai(f, tgt, o, press) {
    const k = f.item.kind, dx = tgt.x - f.x, toward = dx > 0 ? 'right' : 'left';
    if ((k === 'banana' || k === 'holy') && Math.abs(dx) < 420 && Rng.next() < 0.05) { o[toward] = true; press('attack'); return true; }
    if (k === 'tnt' && Math.abs(dx) < 160 && !f.air && Rng.next() < 0.03) { press('attack'); return true; }
    const reach = { bazooka: 520, shotgun: 190, mgun: 400, sniper: 760 }[k];
    // local rules: the CPU can tilt the shot, so someone under you on a platform is worth shooting at
    const dy2 = (tgt.y - tgt.h / 2) - (f.y - f.h / 2), band = Game.combos ? 230 : 60;
    if (reach && !(f.item.cd > 0) && Math.abs(dx) < reach && Math.abs(dy2) < band && Rng.next() < 0.05) {
      if ((dx > 0 ? 1 : -1) !== f.face) { o[toward] = true; return true; }
      if (Game.combos && dy2 > 70) o.down = true; else if (Game.combos && dy2 < -70) o.up = true;
      press('attack'); return true;
    }
    return false;
  },
  aiRecover(f, st, o, press) {
    const it = f.item, M = st.main, home = f.x < 0 ? 'right' : 'left';
    if (it.kind === 'jetpack' && it.ammo > 0 && (f.state === 'air' || f.state === 'helpless') && f.y > M.top - 140) { o[home] = true; o.jump = true; return true; }
    return false;
  },
  // fallen into a crater: climb back out over the nearer edge
  aiHole(f, st, o, press) {
    const q = this.holeOf(f); if (!q) return false;
    o[(f.x - q.x0 < q.x1 - f.x) ? 'left' : 'right'] = true;
    if (f.state === 'air' && f.vy > -1) { if (f.jumps > 0) press('jump'); else if (!f.airOnce.up) { o.up = true; press('special'); } }
    return true;
  },
};

// floor collision once TNT has cut holes in the main stage (Fighter.collide hands over while Game.holes is non-empty)
Fighter.prototype.collideHoles = function (st, px, py) {
  const w2 = this.w * 0.4, h = this.h, M = st.main, H = Game.holes;
  let landed = null;
  if (this.vy >= 0) {
    if (py <= M.top + 0.01 && this.y >= M.top && this.x >= M.x0 - 2 && this.x <= M.x1 + 2 && !Items2.inHole(this.x)) landed = st.mainSurf;
    else if (this.dropT <= 0 && !(this.in.down && this.air && this.state !== 'hitstun')) {
      for (const p of st.plats) if (py <= p.y + 0.01 && this.y >= p.y && this.x >= p.x0 && this.x <= p.x1) { landed = p; break; }
    }
  }
  if (landed) {
    this.y = landed.y; this.plat = landed;
    if (this.air) this.onLand(); else this.vy = 0;
  } else if (!this.air) {
    const p = this.plat;
    if (!p || this.vy < 0 || this.x < p.x0 - 1 || this.x > p.x1 + 1 || (p === st.mainSurf && Items2.inHole(this.x))) this.leaveGround();
    else { this.y = p.y; this.vy = 0; }
  }
  // solid pieces of the stage between the holes
  if (this.y > M.top + 1 && this.y - h < M.bot) {
    let a = M.x0;
    for (let i = 0; i <= H.length; i++) {
      const s0 = a, s1 = i < H.length ? H[i].x0 : M.x1; if (i < H.length) a = H[i].x1;
      if (!(this.x + w2 > s0 && this.x - w2 < s1)) continue;
      const hs = this.state === 'hitstun';
      if (py - h >= M.bot - 1) { this.y = M.bot + h; if (this.vy < 0) this.vy = hs ? -this.vy * 0.4 : 0; }
      else if (this.x < (s0 + s1) / 2) { this.x = s0 - w2; if (this.vx > 0) this.vx = hs ? -this.vx * 0.5 : 0; }
      else { this.x = s1 + w2; if (this.vx < 0) this.vx = hs ? -this.vx * 0.5 : 0; }
      break;
    }
  }
};
