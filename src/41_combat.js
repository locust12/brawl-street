// ===== fighter: getting hit, grabs, throws, drawing pose =====
Object.assign(Fighter.prototype, {
  takeHit(hb, att, mult, srcX, srcFace) {
    if (this.bubbleHits > 0 && Items2.absorb(this, att)) return 0;   // bubble shield (56_items2)
    if (Game.feel) mult = FEEL.mult(this, hb, att, mult || 1);   // stale moves, counter hits, combo scaling (25_feel)
    const d = hb.dmg * (mult || 1);
    COMBO.hit(this, att, d);   // combo counter (23_combo): reads the state before this hit changes it
    if (this.state === 'grabbing' && this.grabbed) { const v = this.grabbed; v.grabber = null; v.setState(v.air ? 'air' : 'ground'); this.grabbed = null; }
    if (this.state === 'grabbed' && this.grabber) { this.grabber.grabbed = null; if (this.grabber.state === 'grabbing') this.grabber.setState('ground'); this.grabber = null; }
    if (this.state === 'ledge') this.releaseLedge();
    this.dmg = Math.min(999, this.dmg + d);
    this.stats.taken += d;
    if (att && att !== this) { att.stats.dealt += d; this.lastHitBy = att; this.lastHitT = Game.frame; }
    const p = this.dmg;
    let kb = ((p / 10 + p * d / 20) * (200 / (this.c.weight + 100)) * 1.4 + 18) * (hb.kbg / 100) + hb.bkb;
    if (Game.feel) kb = FEEL.kb(this, hb, att, kb);   // rage (25_feel)
    if (att && att.powerT > 0) kb *= 1.22;
    // Pump Pill super armor: light hits don't make a pumped fighter flinch
    if (this.powerT > 0 && kb < 75) { this.flashT = 6; this.hitlag = 4; if (att && att !== this) att.hitlag = Math.max(att.hitlag, 4); Game.onHit(this, att, hb, d, kb * 0.5); return kb; }
    // opt-in move flags (21_roster2): super armor, and letting go of a command-grabbed fighter
    if (this.move && this.move.def.armor && this.state === 'move' && MV2.armor(this, att, hb, d, kb)) return kb;
    if (this.grabbed && this.state === 'move' && this.move.def.holdVictim) MV2.drop(this);
    let ang = hb.ang;
    const dir = hb.radial ? (this.x >= srcX ? 1 : -1) : srcFace * ((hb.x || 0) < -4 ? -1 : 1);
    if (ang < 0 && !this.air) { ang = 80; kb *= 0.55; }
    const V = kb * KB_SCALE;
    // ---- DI (directional influence) ----
    // A launched fighter had no agency at all: hitstun just decayed vx under reduced gravity, so a
    // strong hit was a coin already flipped. Smash's rule, unchanged because it is the learnable one:
    // ONLY the component of the held stick at right angles to the launch does anything, and it rotates
    // the trajectory by at most DI_MAX degrees. Holding straight into or straight along the launch does
    // nothing whatsoever, and the SPEED is never touched -- so DI buys you an angle, never a let-off,
    // and a well-aimed kill still kills. The cross product below IS the perpendicular component
    // (|L x S| = sin of the angle between two unit vectors), which is why no special cases are needed.
    let lx = dcos(deg(ang)) * dir, ly = -dsin(deg(ang));
    this.diDeg = 0;                                       // degrees this launch was actually rotated
    if (Game.sigs && !Game.noDI) {
      const sx = (this.in.right ? 1 : 0) - (this.in.left ? 1 : 0);
      const sy = (this.in.down ? 1 : 0) - (this.in.up ? 1 : 0);
      if (sx || sy) {
        const sl = Math.sqrt(sx * sx + sy * sy), ux = sx / sl, uy = sy / sl;
        const cross = lx * uy - ly * ux;                 // signed perpendicular component, -1..1
        // dcos/dsin, not Math.cos/sin: this rotates the launch vector, so a last-bit
        // difference between JS engines decides whether a hit kills (see dsin, 10_core.js).
        const r = deg(DI_MAX) * cross, cr = dcos(r), sr = dsin(r);
        const nx = lx * cr - ly * sr, ny = lx * sr + ly * cr;
        lx = nx; ly = ny;
        this.diDeg = -DI_MAX * cross;                     // signed, + = launched higher than unaided
      }
    }
    this.vx = lx * V;
    this.vy = ly * V;
    this.hitstun = Math.floor(kb * 0.4);
    this.tumble = kb > 80;
    this.move = null;
    if (this.vy < -1.5 || this.air) { this.air = true; this.plat = null; }
    this.setState('hitstun');
    this.fastFall = false; this.airOnce = {}; this.airdodged = false;
    this.face = -dir;
    const lag = clamp(Math.floor(d * 0.45 + 4), 4, 18);
    this.hitlag = lag; if (att && att !== this) att.hitlag = Math.max(att.hitlag, lag);
    this.flashT = 8;
    Game.onHit(this, att, hb, d, kb);
    if (Game.feel) FEEL.hit(this, att, hb, d, kb);   // hitlag, lethal hits, juggle decay, meter (25_feel)
    return kb;
  },

  grabbingUpdate() {
    const v = this.grabbed;
    if (!v || v.state !== 'grabbed') { this.grabbed = null; return this.setState(this.air ? 'air' : 'ground'); }
    v.x = this.x + this.face * (this.w * 0.5 + v.w * 0.3); v.y = this.y - 4; v.face = -this.face;
    this.fric(0.7);
    if (Game.combos && TK.esc(this)) return;   // Tekken's 20-frame throw break (27_tekken)
    if (this.st < 8) return;
    const dx = this.dirX();
    let k = this.in.up ? 'u' : this.in.down ? 'd' : dx === this.face ? 'f' : dx === -this.face ? 'b' : null;
    if (!k && (this.st >= 50 || this.pressed('attack') || this.pressed('grab'))) k = 'f';
    if (k) this.doThrow(k);
  },
  doThrow(k) {
    const v = this.grabbed, T = this.m.throws[k];
    // caught from behind: the plain throw hits harder too (27_tekken)
    const bk = (this.tkEsc && this.tkEsc.back) ? TK.BACK_GEN : 1;
    this.grabbed = null; v.grabber = null; v.state = 'air';
    v.air = true; v.plat = null; v.y = this.y - 2;
    v.takeHit({ dmg: T.dmg * bk, ang: T.ang, bkb: T.bkb * bk, kbg: T.kbg, x: T.dir * 10 }, this, 1, this.x, this.face);
    if (k === 'b') this.face = -this.face;
    this.startMove({ total: 18, throwAnim: k });
    Sfx.swing();
  },
  grabConnect(v) {
    if (Game.combos) this.tkCtx = TK.ctx(this, v);   // read the catch before v's state and facing change (27_tekken)
    this.move = null; this.setState('grabbing'); this.grabbed = v;
    v.move = null; v.releaseLedge(); v.setState('grabbed'); v.grabber = this; v.vx = v.vy = 0;
    if (v.state === 'shield') v.setState('grabbed');
    Sfx.tone(300, 200, 0.08, 'square', 0.12);
    if (Game.combos) TK.open(this, null);            // generic throw: either throw button breaks it
  },

  // Active hitboxes this frame, in world space
  activeHits() {
    const mv = this.move;
    if (!(this.state === 'move' || this.state === 'hammer') || !mv || !mv.def.hits) return [];
    const out = [];
    for (const hb of mv.def.hits) {
      if (mv.t < hb.f[0] || mv.t > hb.f[1]) continue;
      // reach: local matches swing a bit further so attacks actually connect (Game.reach; the seeded
      // bet arena keeps 1 so old fights replay the same)
      const R = Game.reach || 1;
      out.push({ hb, x: this.x + this.face * hb.x * R, y: this.y + hb.y, r: hb.r * R });
    }
    return out;
  },
  chargeMult() {
    const mv = this.move; if (!mv || !mv.def.charge) return 1;
    const ch = mv.def.charge;
    return 1 + (ch.mult || 0.45) * mv.charge / (ch.max || 60);
  },

  // pose for the renderer (in facing-right local space)
  pose() {
    const w = this.w, h = this.h, S = this.state;
    const P = { t: this.t, legs: this.legs, sq: this.sq, flash: this.flashT > 0 && this.flashT % 4 < 2, hatGone: Game.projCount(this, 'hat') > 0 };
    if (S === 'ground' && Math.abs(this.vx) < 0.3) P.legs = 0;
    if (S === 'ground' && Math.abs(this.vx) > 0.3) P.hand = { x: w * 0.3 + dsin(this.legs) * 8, y: -h * 0.3 };
    if (this.crouch || S === 'spot') P.crouch = true;
    if (S === 'jumpsquat' || S === 'land') P.sq = Math.max(P.sq, 0.14);
    if (S === 'air' || S === 'helpless') { P.hand = { x: w * 0.35, y: -h * 0.62 }; P.back = { x: -w * 0.3, y: -h * 0.55 }; P.legs = 1.2; }
    if (S === 'air' && this.flip && this.st < 18 && this.vy < 0) P.spin = -this.st / 18 * TAU;
    if (S === 'hitstun') { P.hand = { x: w * 0.1, y: -h * 0.85 }; P.back = { x: -w * 0.35, y: -h * 0.75 }; if (this.tumble) P.spin = this.st * 0.35; }
    if (S === 'roll') { P.spin = (this.rollDir === this.face ? 1 : -1) * Math.min(1, this.st / 20) * TAU; P.crouch = true; }
    if (S === 'ledge') { P.hand = { x: w * 0.42, y: -h * 0.84 }; P.back = { x: w * 0.3, y: -h * 0.86 }; P.legs = 0.6; }
    if (S === 'climb') P.hand = { x: w * 0.4, y: -h * 0.7 };
    if (S === 'dizzy') P.dizzy = true;
    if (S === 'grabbing') P.hand = { x: w * 0.55, y: -h * 0.45 };
    if (S === 'grabbed') P.hand = { x: w * 0.2, y: -h * 0.8 };
    if (S === 'move' && this.move) {
      const d = this.move.def, t = this.move.t, hb = d.hits && d.hits[0];
      if (d.throwAnim) P.hand = { x: w * 0.6 - t * 1.5, y: -h * 0.7 };
      else if (hb && !hb.grab) {
        const k = clamp((t - hb.f[0] + 6) / 6, -0.6, 1);
        const target = { x: clamp(hb.x, -w * 0.9, w * 1.1), y: clamp(hb.y, -h * 1.2, 0) };
        const rest = { x: w * 0.1, y: -h * 0.35 };
        const pos = k < 0 ? { x: rest.x - w * 0.3 * -k, y: rest.y - h * 0.1 * -k } : { x: lerp(rest.x, target.x, k), y: lerp(rest.y, target.y, k) };
        if (t > hb.f[1] + 4) { pos.x = lerp(target.x, rest.x, 0.6); pos.y = lerp(target.y, rest.y, 0.6); }
        if (hb.x < -4) P.back = pos; else P.hand = pos;
        if (d === this.m.nair || (d.hits.length > 1 && d.hits[0].radial && d.airOnce === 'up')) P.spin = t * 0.5;
        if (d === this.m.dair || (hb.ang < 0)) { P.legs = 2.4; }
        if (this.look.acc === 'bat') P.batAng = k < 0 ? -2.6 : k < 1 ? lerp(-2.6, 0.3, k) : 0.3;
        if (d.charge && t === d.charge.at) P.sq = 0.06 + dsin(this.t * 0.8) * 0.03;
      } else if (hb && hb.grab) P.hand = { x: w * (0.3 + clamp(t / 7, 0, 1) * 0.4), y: -h * 0.45 };
      if (d.tongue) P.tongue = t >= d.tongue[0] - 2 && t <= d.tongue[1] + 4;
      if (d.fx === 'stone') P.stone = true;
    }
    if (MV2.hidden(this)) P.hidden = true;   // teleport frames / swallowed (21_roster2)
    return P;
  },
});
