// ===== items: Smash-style pickups, throwables, explosions, Final Smash =====
const ITEM_DEFS = {
  hammer:   { name: 'Hammer', r: 26, weight: 3, instant: true, icon: '🔨' },
  // feelAmmo / feelSword: local-rules (Game.feel) values, read only when the flag is on, so the bet arena keeps
  // the originals. Swords were 18.5% of every KO and nearly every pickup ended in one, so they hit softer and
  // shatter after `hits` landed swings (25_feel.js); the ray gun's 16 free shots became 10.
  raygun:   { name: 'Laser Gun', r: 22, weight: 4, ammo: 16, feelAmmo: 10, icon: '🔫' },
  beam:     { name: 'Beam Sword', r: 26, weight: 4, sword: { reach: 42, dmg: 1.35, kb: 1.12, slow: 0, color: '#ff3a6e' },
              feelSword: { reach: 42, dmg: 1.15, kb: 1.03, slow: 0, color: '#ff3a6e', hits: 8 }, icon: '🗡️' },
  blade:    { name: 'Hero Sword', r: 30, weight: 3, sword: { reach: 58, dmg: 1.6, kb: 1.28, slow: 5, color: '#5ab8ff' },
              feelSword: { reach: 58, dmg: 1.36, kb: 1.18, slow: 5, color: '#5ab8ff', hits: 6 }, icon: '⚔️' },
  bomb:     { name: 'Rug Bomb', r: 20, weight: 3, throwable: true, impact: true, boom: { r: 125, dmg: 22, bkb: 70, kbg: 96 }, icon: '💣' },
  grenade:  { name: 'Grenade', r: 16, weight: 4, throwable: true, fuse: 100, boom: { r: 100, dmg: 16, bkb: 62, kbg: 86 }, icon: '🧨' },
  heart:    { name: 'HODL Heart', r: 20, weight: 2, instant: true, icon: '💖' },
  pill:     { name: 'Pump Pill', r: 16, weight: 3, instant: true, icon: '💊' },
  moonball: { name: 'Moon Ball', r: 30, weight: 1.8, floating: true, hp: 30, icon: '🌕' },
};
const NORMALS = ['jab', 'ftilt', 'utilt', 'dtilt', 'fsmash', 'usmash', 'dsmash', 'nair', 'fair', 'bair', 'uair', 'dair'];
const SWORD_CACHE = new WeakMap();
function swordify(def, sw) {
  let byKind = SWORD_CACHE.get(def); if (!byKind) { byKind = {}; SWORD_CACHE.set(def, byKind); }
  const key = sw.color + '|' + sw.dmg + '|' + sw.reach;   // one cache slot per sword, incl. its local-rules version
  if (byKind[key]) return byKind[key];
  const out = Object.assign({}, def, { weapon: sw.color, total: def.total + (sw.slow || 0) });
  out.hits = def.hits.map(h => {
    const up = Math.abs(h.x) < 8;
    return Object.assign({}, h, {
      f: [h.f[0] + Math.floor((sw.slow || 0) / 2), h.f[1] + Math.floor((sw.slow || 0) / 2) + 2],
      x: up ? h.x : h.x + Math.sign(h.x) * sw.reach * 0.8, y: up ? h.y - sw.reach * 0.5 : h.y,
      r: h.r + 10, dmg: h.dmg * sw.dmg, kbg: h.kbg * sw.kb,
    });
  });
  byKind[key] = out; return out;
}
const HAMMER_DEF = {
  total: 18, weapon: '#ffd45c',
  hits: [H(3, 7, 10, -100, 36, 18, 50, 44, 104, { radial: true }), H(10, 14, 60, -30, 38, 18, 40, 44, 104)],
};

const Items = {
  spawnT: 400,
  reset() { Game.items = []; this.spawnT = Game.feel ? FEEL.spawnT(true) : irand(300, 520); },   // Game.itemRate (25_feel)
  update() {
    const G = Game, st = G.stage;
    if (G.itemsOn && !G.demoNoItems && G.countdown <= 0 && !G.endT && !(G.feel && FEEL.rate() === 'off')) {
      if (--this.spawnT <= 0) {
        this.spawnT = G.feel ? FEEL.spawnT(false) : irand(420, 760);
        if (G.items.filter(i => !i.armed).length < 3) this.spawn();
      }
    }
    for (const it of G.items) {
      const def = ITEM_DEFS[it.kind]; it.age++;
      if (def.tick && def.tick(it, G, st)) continue;   // set-2 kinds with their own motion (56_items2)
      if (def.floating) {
        it.x += it.vx; it.vx += (Rng.next() - 0.5) * 0.2; it.vx = clamp(it.vx, -2.2, 2.2);
        if (it.x < st.main.x0 + 40 || it.x > st.main.x1 - 40) it.vx = -it.vx * 0.9;
        it.y = it.baseY + dsin(it.age * 0.03) * 40;
        if (it.age > 1500) it.dead = true;
        continue;
      }
      const py = it.y;
      it.vy = Math.min(it.vy + 0.5, 14); it.x += it.vx; it.y += it.vy;
      if (it.fuse != null && it.armed && --it.fuse <= 0) { this.explode(it); continue; }
      // landing
      const M = st.main;
      let top = null;
      if (it.vy >= 0) {
        if (py <= M.top && it.y >= M.top && it.x > M.x0 && it.x < M.x1 && !(G.holes.length && Items2.inHole(it.x))) top = M.top;
        else for (const p of st.plats) if (py <= p.y && it.y >= p.y && it.x > p.x0 && it.x < p.x1) { top = p.y; break; }
      }
      if (top !== null) {
        if (it.armed && def.impact && (Math.abs(it.vx) > 1.5 || it.vy > 3)) { this.explode(it); continue; }
        it.y = top;
        if (it.vy > 5) { it.vy = -it.vy * 0.35; } else { it.vy = 0; it.vx *= 0.6; if (Math.abs(it.vx) < 0.3) { it.vx = 0; if (!def.fuse) it.armed = false; } }
      }
      if (it.y > M.top + 2 && it.y < M.bot && it.x > M.x0 && it.x < M.x1 && !(G.holes.length && Items2.inHole(it.x))) { it.x = it.x < 0 ? M.x0 - 2 : M.x1 + 2; it.vx = -it.vx * 0.5; }
      if (it.y > st.blast.b || it.x < st.blast.l || it.x > st.blast.r) it.dead = true;
      if (!it.armed && it.vx === 0 && it.vy === 0 && it.age > 1100) it.dead = true;
      // thrown items hit fighters
      if (it.armed && Math.abs(it.vx) + Math.abs(it.vy) > 3) {
        for (const f of G.fighters) {
          if (f === it.thrownBy || f.untouchable || f.state === 'dead') continue;
          // a bouncing fuse item hits a fighter once, not every frame (25_feel; and always in item set 2,
          // where a fan of banana bomblets sitting on someone was worth 300% in a second). The seeded
          // bet arena runs item set 1 with feel off, so it keeps the original behaviour.
          if ((Game.feel || Game.itemSet >= 2) && it.fHit === f && Game.frame - it.fHitT < 40) continue;
          if (!circleRect(it.x, it.y, def.r, f)) continue;
          if (def.impact) { this.explode(it); break; }
          const keep = it.thrownBy ? it.thrownBy.hitlag : 0;
          if (f.state === 'shield') G.shieldHit(f, 10, it.x, null);
          else f.takeHit({ dmg: def.fuse ? 6 : 11, ang: 40, bkb: 42, kbg: 62, radial: true }, it.thrownBy, 1, it.x - it.vx, 1);
          if (it.thrownBy) it.thrownBy.hitlag = keep;
          if (Game.feel || Game.itemSet >= 2) { it.fHit = f; it.fHitT = Game.frame; }
          it.vx = -it.vx * 0.3; it.vy = -4; if (!def.fuse) it.armed = false;
          break;
        }
      }
    }
    G.items = G.items.filter(i => !i.dead);
    if (G.itemSet >= 2) Items2.update(G, st);   // crates, jetpack fuel, bubble timers (never in seeded arena fights)
  },
  spawn(kind) {
    const G = Game, st = G.stage;
    const hasFinal = G.fighters.some(f => f.finalReady) || G.items.some(i => i.kind === 'moonball');
    if (!kind) {
      const pool = Object.entries(ITEM_DEFS).filter(([k, d]) => !(k === 'moonball' && hasFinal) && Items2.inSet(d));   // set-2 kinds only when Game.itemSet >= 2
      let tot = pool.reduce((a, [, d]) => a + d.weight, 0), r = Rng.next() * tot;
      kind = pool[0][0]; for (const [k, d] of pool) { r -= d.weight; if (r <= 0) { kind = k; break; } }
    }
    const def = ITEM_DEFS[kind];
    const x = rand(st.main.x0 + 70, st.main.x1 - 70);
    const ammo = (Game.feel && def.feelAmmo != null ? def.feelAmmo : def.ammo) || 0;
    const it = { kind, x, y: def.floating ? -200 : st.blast.t + 160, vx: def.floating ? rand(-1.5, 1.5) : 0, vy: 0, age: 0, baseY: -190, hp: def.hp || 0, ammo };
    G.items.push(it);
    G.ring(x, def.floating ? -300 : -200, '#ffffff', 40);
    return it;
  },
  near(f) {
    let best = null, bd = 1e9;
    for (const it of Game.items) {
      if (it.armed || ITEM_DEFS[it.kind].floating) continue;
      const dx = Math.abs(it.x - f.x), dy = Math.abs(it.y - (f.y - (f.air ? f.h * 0.4 : 0)));
      const pad = Game.itemSet >= 2 ? 22 : 0;   // set 2: a more forgiving reach, nearest item wins
      if (dx < f.w * 0.6 + ITEM_DEFS[it.kind].r + pad && dy < 50 + pad && dx + dy < bd) { bd = dx + dy; best = it; }
    }
    return best;
  },
  explode(it) {
    const G = Game, def = ITEM_DEFS[it.kind], b = def.boom; it.dead = true;
    for (const f of G.fighters) {
      if (f.state === 'dead' || f.untouchable) continue;
      const cx = f.x, cy = f.y - f.h / 2;
      if (dhypot(cx - it.x, cy - it.y) > b.r + f.w * 0.4) continue;
      const keep = it.thrownBy ? it.thrownBy.hitlag : 0;
      f.takeHit({ dmg: b.dmg, ang: 55, bkb: b.bkb, kbg: b.kbg, radial: true }, it.thrownBy || null, 1, it.x, 1);
      if (it.thrownBy && it.thrownBy !== f) it.thrownBy.hitlag = keep;
    }
    // THE BLAST IS AS BIG AS THE BLAST. Duane, 2026-10-16: "the explosions were so small and
    // uneventful". Every number below used to be a constant, so a 196-radius Vortex Grenade threw
    // exactly the same 46 sparks the same distance as a 100-radius Grenade and read identically.
    // `k` scales the SIZE and the SPEED of what is already there, never the COUNT: the particle
    // loops run off the seeded `rand()`, so adding one would fork every replay and the bet arena
    // with it. Same number of rolls, bigger explosion.
    const k = Math.max(0.8, Math.min(2.1, b.r / 118)), k2 = k * k;
    for (let i = 0; i < 46; i++) { const a = rand(0, TAU), s = rand(3, 12) * k; G.parts.push({ x: it.x, y: it.y, vx: dcos(a) * s, vy: dsin(a) * s, life: 34, max: 34, color: i % 3 ? '#ffb347' : '#ffffff', size: rand(6, 14) * k, g: 0.05 }); }
    for (let i = 0; i < 14; i++) G.parts.push({ x: it.x + rand(-30, 30) * k, y: it.y + rand(-30, 30) * k, vx: rand(-1, 1) * k, vy: rand(-2, 0) * k, life: 50, max: 50, color: '#6a5a50', size: rand(14, 26) * k, g: 0, soft: true });
    for (let i = 0; i < 22; i++) { const a = rand(0, TAU), s = rand(1, 6) * k; G.parts.push({ x: it.x, y: it.y, vx: dcos(a) * s, vy: dsin(a) * s - 1.5, life: 32, max: 32, color: i % 3 ? '#ff8a1a' : '#ffe27a', size: rand(24, 46) * k, g: 0, fire: true }); }
    G.impact = { x: it.x, y: it.y, t: 30 };
    G.rings.push({ x: it.x, y: it.y, r: 10, max: b.r * 1.55, color: '#ffd45c', life: 22, w: 18 * k });
    G.rings.push({ x: it.x, y: it.y, r: 10, max: b.r * 1.0, color: '#ffffff', life: 14, w: 10 * k });
    G.rings.push({ x: it.x, y: it.y, r: 10, max: b.r * 2.0, color: '#ff8a1a', life: 28, w: 7 * k });
    G.shake(18 * k2); G.flashT = Math.round(5 * k); Sfx.ko();
    G.text(it.x, it.y - 40, it.kind === 'bomb' ? 'RUGGED' : 'BOOM', '#ffb347', 1.4);
    // chain reaction
    for (const o of G.items) if (!o.dead && ITEM_DEFS[o.kind].boom && dhypot(o.x - it.x, o.y - it.y) < b.r) { o.armed = true; o.fuse = 6; }
    if (def.after) def.after(it);   // bomblets, craters (56_items2)
  },
  // attack hitboxes can pop the Moon Ball and set off loose bombs
  hitItems(a, hs, mult) {
    for (const it of Game.items) {
      if (!a.move) return;   // a bomb that just went off can knock the attacker out of the swing
      const def = ITEM_DEFS[it.kind];
      if (it.dead || (it.kind !== 'moonball' && it.kind !== 'bomb' && !def.hittable)) continue;
      for (const h of hs) {
        if (dhypot(h.x - it.x, h.y - it.y) > h.r + def.r) continue;
        const key = 'item' + Game.items.indexOf(it);
        if (a.move.hits.has(it)) break;
        a.move.hits.set(it, a.move.t);
        if (def.hittable) { def.hittable(it, a, h); break; }
        if (it.kind === 'bomb') { it.thrownBy = a; this.explode(it); break; }
        it.hp -= h.hb.dmg * mult; it.vx += a.face * 2.5; Game.ring(it.x, it.y, '#ffe27a', 50); Sfx.hit(0.4);
        if (it.hp <= 0) {
          it.dead = true; a.finalReady = true;
          Game.text(a.x, a.y - a.h - 40, 'FINAL SMASH READY', '#ffe27a', 1.3); Game.flashT = 8; Game.shake(12); Sfx.coin();
          for (let i = 0; i < 40; i++) { const an = rand(0, TAU), s = rand(3, 10); Game.parts.push({ x: it.x, y: it.y, vx: dcos(an) * s, vy: dsin(an) * s, life: 40, max: 40, color: ['#22e6ff', '#ff4fd8', '#ffd45c'][i % 3], size: rand(5, 10), g: 0 }); }
        }
        break;
      }
    }
  },
};

// ---- fighter hooks: pick up, use, throw, hammer, Final Smash ----
Object.assign(Fighter.prototype, {
  tryPickup() {
    if (this.item) return false;
    const it = Items.near(this); if (!it) return false;
    it.dead = true; Game.items = Game.items.filter(i => i !== it);
    Sfx.coin(); Game.ring(this.x, this.y - this.h / 2, '#ffffff', 30);
    if (ITEM_DEFS[it.kind].pick && ITEM_DEFS[it.kind].pick(this, it)) return true;
    if (it.kind === 'hammer') { this.hammerT = Game.sigs ? BAL.HAMMER.time : 480; this.hammerHits = 0; this.move = null; this.setState('hammer'); Game.text(this.x, this.y - this.h - 20, 'HAMMER TIME', '#ffd45c', 1.1); return true; }
    if (it.kind === 'pill') {
      this.powerT = 600; Game.flashT = 6; Game.shake(10); Sfx.ko();
      Game.text(this.x, this.y - this.h - 30, 'PUMPED', '#ffd23f', 1.6);
      for (let i = 0; i < 30; i++) { const a = rand(0, TAU), s = rand(3, 9); Game.parts.push({ x: this.x, y: this.y - this.h / 2, vx: dcos(a) * s, vy: dsin(a) * s, life: 30, max: 30, color: i % 2 ? '#ffd23f' : '#7dff8a', size: rand(5, 10), g: 0 }); }
      Game.rings.push({ x: this.x, y: this.y - this.h / 2, r: 10, max: 160, color: '#ffd23f', life: 22, w: 14 });
      return true;
    }
    if (it.kind === 'heart') {
      const heal = Math.min(this.dmg, 60); this.dmg -= heal;
      Game.text(this.x, this.y - this.h - 20, '-' + Math.round(heal) + '% HODL', '#ff7ab8', 1.1);
      for (let i = 0; i < 18; i++) Game.parts.push({ x: this.x + rand(-20, 20), y: this.y - rand(0, this.h), vx: rand(-1, 1), vy: rand(-3, -1), life: 36, max: 36, color: '#ff7ab8', size: rand(5, 9), g: 0 });
      return true;
    }
    this.item = { kind: it.kind, ammo: it.ammo || ITEM_DEFS[it.kind].ammo || 0, fuse: it.fuse };
    return true;
  },
  // called on a fresh attack press; returns true when the held item consumed the input
  useItem() {
    const it = this.item; if (!it) return false;
    const def = ITEM_DEFS[it.kind];
    if (it.kind === 'raygun') {
      if (BAL.gunLock(this, it)) return true;   // local play only: fire rate + 4-shot magazine (65_balance)
      if (it.ammo <= 0) { this.throwItem(); return true; }
      it.ammo--;
      // up / down (and the diagonals) tilt the shot; TK.aim is null in seeded fights, which keeps 26, 0
      const V = TK.rot(TK.aim(this), 26, 0);
      Game.spawnProj(this, { kind: 'laser', vx: V[0], vy: V[1], grav: 0, r: 11, dmg: 5, ang: 18, bkb: 20, kbg: 22, life: 42 });
      this.startMove({ total: 12, gunAnim: true });
      Sfx.tone(1400, 300, 0.12, 'sawtooth', 0.1);
      return true;
    }
    if (def.use) return def.use(this, it);
    if (def.throwable) { this.throwItem(); return true; }
    return false;
  },
  throwItem() {
    const it = this.item; if (!it) return;
    const def = ITEM_DEFS[it.kind];
    let vx = this.face * 13, vy = -5;
    if (def.lob) { vx = this.face * 9; vy = -11.5; }   // banana bomb: lobbed on an arc (56_items2)
    if (this.in.up) { vx = this.face * 1.5; vy = -15; }
    else if (this.in.down) { vx = 0; vy = this.air ? 8 : 0; }
    else { const dx = this.dirX(); if (dx) { this.face = dx; vx = dx * 14; } }
    Game.items.push({ kind: it.kind, x: this.x + this.face * this.w * 0.4, y: this.y - this.h * 0.7, vx, vy, age: 0, armed: true, thrownBy: this,
      fuse: def.fuse ? (it.fuse != null ? it.fuse : def.fuse) : undefined, ammo: it.ammo, hp: 0 });
    this.item = null;
    this.startMove({ total: 16, throwAnim: 'f' });
    Sfx.swing();
  },
  hammerUpdate() {
    if (--this.hammerT <= 0 || this.state !== 'hammer') { this.hammerT = 0; this.move = null; return this.setState(this.air ? 'air' : 'ground'); }
    const dx = this.dirX();
    if (dx) { this.face = dx; this.vx = approach(this.vx, dx * this.c.walk * 0.72, 0.8); } else if (!this.air) this.fric(0.8); else this.vx *= 0.97;
    if (!this.air && this.pressed('jump')) { this.leaveGround(); this.vy = -this.c.jump * 0.9; this.setState('hammer'); }
    if (!this.move || this.move.def !== HAMMER_DEF) this.move = { def: HAMMER_DEF, t: 0, charge: 0, hits: new Map(), air: this.air };
    if (++this.move.t >= HAMMER_DEF.total) { this.move.t = 0; this.move.hits = new Map(); Sfx.swing(); }
  },
  startFinal() {
    this.finalReady = false; this.move = null; this.setState('final'); this.vx = this.vy = 0;
    Game.text(this.x, this.y - this.h - 50, 'TO THE MOON', '#ffe27a', 2.2); Game.flashT = 10; Game.shake(16); Sfx.ko();
    Game.finalBy = this;
  },
  finalUpdate() {
    this.intang = true; this.vx = 0; this.vy = 0; this.noGrav = true;
    const s = this.st, by = this.y - this.h * 0.55;
    if (s >= 24 && s <= 132 && s % 8 === 0) {
      for (const f of Game.fighters) {
        if (f === this || f.state === 'dead' || f.stocks <= 0) continue;
        const inFront = (f.x - this.x) * this.face > -20, inBeam = Math.abs((f.y - f.h / 2) - by) < 90;
        if (!inFront || !inBeam) continue;
        const last = s >= 128;
        f.invuln = 0; f.intang = false;
        f.takeHit(last ? { dmg: 14, ang: 32, bkb: 150, kbg: 70, x: 10 } : { dmg: 3, ang: 0, bkb: 4, kbg: 0, x: 10 }, this, 1, this.x, this.face);
        if (!last) { f.vx = this.face * 1.2; f.vy = (by - (f.y - f.h / 2)) * 0.08; }
        this.hitlag = 0;
      }
      Game.shake(8);
    }
    if (s >= 150) { Game.finalBy = null; this.setState(this.air ? 'air' : 'ground'); }
  },
});
