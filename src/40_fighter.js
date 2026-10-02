// ===== fighter: movement, states, ledges =====
const KB_SCALE = 0.105;
const DI_MAX = 18;   // max degrees DI can rotate a launch (41_combat takeHit). Smash Ultimate's number.
const approach = (v, t, a) => (v < t ? Math.min(v + a, t) : Math.max(v - a, t));
const GROUNDISH = ['ground', 'shield', 'roll', 'spot', 'land', 'jumpsquat', 'dizzy'];

class Fighter {
  constructor(idx, slot, stage) {
    this.idx = idx; this.slot = slot;
    this.c = CHAR_BY_ID[slot.char]; this.look = this.c.look;
    this.m = (Game.sigs && this.c.moves2) || this.c.moves;   // local matches can swap in a fighter's showpiece set (21_roster2)
    this.color = PCOLORS[idx]; this.ctrl = slot.ctrl; this.cpu = slot.ctrl === 'cpu'; this.level = slot.level || 5;
    this.stocks = Game.stockCount;
    this.stats = { kos: 0, falls: 0, dealt: 0, taken: 0, combo: 0 };   // combo = longest string landed (23_combo.js hit)
    this.in = {}; this.prev = {}; this.tap = { left: 99, right: 99, up: 99, down: 99 };
    this.ai = {}; this.t = 0; this.legs = 0; this.shieldHP = 60; this.flashT = 0;
    this.reset(stage.spawns[idx], stage.main.top, stage);
  }
  get w() { return this.c.w; }
  get h() { return this.c.h; }
  reset(x, y, st) {
    this.x = x; this.y = y; this.vx = 0; this.vy = 0; this.face = x < 0 ? 1 : -1;
    this.air = false; this.plat = st.mainSurf; this.state = 'ground'; this.st = 0; this.move = null;
    this.hitstun = 0; this.hitlag = 0; this.invuln = 0; this.intang = false; this.jumps = FEEL.jumps(this);
    this.airOnce = {}; this.airdodged = false; this.fastFall = false; this.dropT = 0; this.ledge = null; this.ledgeCd = 0;
    this.ledgeUsed = false; this.grabbed = null; this.grabber = null; this.dmg = 0; this.tumble = false; this.sq = 0; this.crouch = false;
    this.item = null; this.hammerT = 0; this.finalReady = false; this.powerT = 0;
  }
  pressed(a) { return !!this.in[a] && !this.prev[a]; }
  dirX() { return (this.in.right ? 1 : 0) - (this.in.left ? 1 : 0); }
  setState(s) { this.state = s; this.st = 0; }
  fric(k) { this.vx *= k; if (Math.abs(this.vx) < 0.05) this.vx = 0; }
  drift(k) { const F = Game.feel, dx = this.dirX(); if (dx) this.vx = approach(this.vx, dx * this.c.air * k * (this.powerT > 0 ? 1.2 : 1) * (F ? FEEL.AIR : 1), F ? FEEL.AIR_A : 0.45); else this.vx *= F ? 0.965 : 0.97; }
  get untouchable() { return this.intang || this.invuln > 0 || this.state === 'dead' || this.state === 'respawn'; }

  update(stage) {
    this.t++;
    if (this.flashT > 0) this.flashT--;
    if (this.state === 'dead') return;
    if (this.hitlag > 0) { this.hitlag--; if (Game.combos && !this.cpu) COMBO.peek(this); if (Game.feel) FEEL.lag(this); return; }   // buffer presses for cancels (23_combo); SDI/DI (25_feel)
    this.prev = this.in;
    this.in = this.cpu ? AI.think(this, stage) : readInput(this.ctrl);
    if (Game.feel) FEEL.input(this);   // buffer, hops, Shield+Special (25_feel)
    for (const d of ['left', 'right', 'up', 'down']) this.tap[d] = this.in[d] && !this.prev[d] ? 0 : this.tap[d] + 1;
    if (this.invuln > 0) this.invuln--;
    if (this.ledgeCd > 0) this.ledgeCd--;
    if (this.dropT > 0) this.dropT--;
    if (this.state !== 'shield' && this.shieldHP < 60) this.shieldHP = Math.min(60, this.shieldHP + 0.12);
    this.st++; this.intang = false; this.crouch = false;
    if (this.powerT > 0) {
      this.powerT--;
      if (this.t % 2 === 0) Game.parts.push({ x: this.x + rand(-this.w * 0.45, this.w * 0.45), y: this.y - rand(0, this.h * 1.1), vx: rand(-0.4, 0.4), vy: rand(-3.5, -1.5), life: 20, max: 20, color: this.t % 6 ? '#ffd23f' : '#fff6b0', size: rand(4, 8), g: 0 });
      if (this.powerT === 0) Game.text(this.x, this.y - this.h - 20, 'DUMPED', '#aaa', 0.9);
    }
    switch (this.state) {
      case 'ground': this.groundAct(); break;
      case 'air': this.airAct(); break;
      case 'jumpsquat': this.jumpSquat(); break;
      case 'move': this.moveUpdate(); break;
      case 'land': this.fric(0.8); if (Game.itemSet >= 2 && this.pressed('attack') && !this.item && this.tryPickup()) break; if (this.st >= this.landT) this.setState('ground'); break;   // set 2: picking up works through landing lag
      case 'hitstun': if (Game.feel && FEEL.stun(this)) break; if (!this.air) this.fric(0.9); if (this.st >= this.hitstun) { this.tumble = false; this.setState(this.hammerT > 0 ? 'hammer' : this.air ? 'air' : 'ground'); } break;
      case 'hammer': this.hammerUpdate(); break;
      case 'final': this.finalUpdate(); break;
      case 'shield': this.shieldUpdate(); break;
      case 'roll': case 'spot': this.dodgeUpdate(); break;
      case 'airdodge': this.airdodgeUpdate(); break;
      case 'helpless': if (Game.feel && FEEL.helpless(this)) break; this.drift(0.6); if (this.pressed('down') && this.vy > 0) this.fastFall = true; break;
      case 'ledge': this.ledgeUpdate(stage); break;
      case 'climb': this.climbUpdate(); break;
      case 'grabbing': this.grabbingUpdate(); break;
      case 'grabbed': if (!this.grabber || (this.grabber.state !== 'grabbing' && !MV2.holds(this.grabber, this))) { if (this.cgrabbed) MV2.unhold(this); this.setState(this.air ? 'air' : 'ground'); } break;   // MV2: command grabs (21_roster2)
      case 'dizzy': this.fric(0.85); if (this.st >= 150) this.setState(this.air ? 'air' : 'ground'); break;
      case 'respawn': this.respawnUpdate(); break;
    }
    if (!['ledge', 'climb', 'grabbed', 'respawn', 'dead'].includes(this.state)) this.physics(stage);
    this.checkLedge(stage);
    this.sq *= 0.8;
    if (Game.feel) FEEL.post(this);   // buffer unused presses, coyote / hop windows (25_feel)
  }

  groundAct() {
    const dx = this.dirX();
    if (Game.combos && GRAPPLE.input(this)) return;   // Attack + Special on one frame: grapple (24_grapple)
    if (Game.combos && TK.keys(this)) return;         // E grab · R grapple · Q drop the item (27_tekken)
    if (this.in.shield) {
      if (this.item && Game.itemSet >= 2 && this.pressed('down')) return Items2.dropItem(this);   // shield + down = drop what you hold
      if (Game.sigs && this.pressed('up') && !this.item) return TAUNT(this);   // shield + up = taunt
      if (this.pressed('attack')) return this.item ? this.throwItem() : this.startMove(this.m.grab);
      if (this.pressed('left') || this.pressed('right')) return this.startRoll(dx);
      if (this.pressed('down')) return this.setState('spot');
      Sfx.shield(); return this.setState('shield');
    }
    if (this.pressed('special')) return this.finalReady ? this.startFinal() : this.special();
    if (this.pressed('attack') && !this.item && this.tryPickup()) return;
    if ((this.pressed('attack') || this.pressed('smash')) && this.item && this.useItem()) return;
    if (this.pressed('smash')) return this.smashAttack(dx);
    if (this.pressed('attack')) {
      const recent = Math.min(dx > 0 ? this.tap.right : dx < 0 ? this.tap.left : 99, this.in.up ? this.tap.up : 99, this.in.down ? this.tap.down : 99);
      if (recent <= 4) return this.smashAttack(dx);
      if (this.in.up) return this.startMove(this.m.utilt);
      if (this.in.down) return this.startMove(this.m.dtilt);
      if (dx) { this.face = dx; return this.startMove(this.m.ftilt); }
      return this.startMove(this.m.jab);
    }
    if (this.pressed('jump')) return this.setState('jumpsquat');
    if (this.pressed('down') && this.plat && this.plat.soft) {
      this.dropT = 14; this.leaveGround(); this.vy = 2; return;
    }
    this.crouch = this.in.down && !dx;
    if (dx && !this.crouch) {
      if (Game.feel && dx * this.vx < 0) this.vx *= FEEL.TURN;   // turning on the spot kills the slide
      this.face = dx; this.vx = approach(this.vx, dx * this.c.walk * (this.powerT > 0 ? 1.25 : 1), Game.feel ? FEEL.ACC : 1.1); this.legs += Math.abs(this.vx) * 0.09;
    } else this.fric(Game.feel ? FEEL.FRIC : 0.78);
  }
  airAct() {
    if (Game.feel && FEEL.air(this)) return;   // coyote jump (25_feel)
    const dx = this.dirX();
    if (this.pressed('special')) return this.finalReady ? this.startFinal() : this.special();
    if (this.pressed('attack') && !this.item && this.tryPickup()) return;
    if ((this.pressed('attack') || this.pressed('smash')) && this.item && this.useItem()) return;
    if (this.pressed('attack') || this.pressed('smash')) return this.aerial(dx);
    if (Game.combos && this.item && this.pressed('drop')) return Items2.dropItem(this);   // one-button drop, in the air too (27_tekken)
    if (Game.combos && this.item && this.pressed('grab')) return this.throwItem();        // E throws what you hold
    if (Game.itemSet >= 2 && this.item && this.in.shield && this.pressed('down')) return Items2.dropItem(this);   // shield + down = drop, in the air too
    if (this.pressed('shield') && this.item) return this.throwItem();
    if (this.pressed('shield') && !this.airdodged) return this.startAirdodge(dx);
    if (this.pressed('jump') && this.jumps > 0) {
      this.jumps--; this.vy = -this.c.djump; this.fastFall = false;
      if (dx) this.vx = dx * this.c.air;
      Sfx.jump(); Game.puff(this.x, this.y, 6, '#ffffff'); this.sq = -0.15; this.flip = 1;
      return;
    }
    if (this.pressed('down') && this.vy > -1) this.fastFall = true;
    this.drift(1);
  }
  jumpSquat() {
    if (Game.feel && FEEL.squat(this)) return;   // jump + attack = short-hop aerial (25_feel)
    this.fric(0.9);
    if (this.pressed('attack') || this.pressed('smash')) return this.startMove(this.m.usmash);
    if (this.pressed('special')) return this.special();
    if (this.st >= 3) {
      const full = this.in.jump || this.in.up;
      this.leaveGround(); this.vy = -this.c.jump * (full ? 1 : 0.68);
      const dx = this.dirX(); if (dx) this.vx = approach(this.vx, dx * this.c.air, 3);
      this.setState('air'); Sfx.jump(); Game.puff(this.x, this.y, 6, '#ffffff'); this.sq = -0.2;
    }
  }
  aerial(dx) {
    if (Game.feel) { const d = FEEL.aerial(this, dx); if (d) return this.startMove(d); }   // diagonal kicks (25_feel)
    const m = this.m;
    // Press a direction in the air and you TURN and kick that way. Smash would pick a back-air here
    // and leave you facing the other way, which read as "I kicked right and he faced left".
    // Back-air is still there: it comes out when you attack with no direction held and someone is
    // behind you, so nothing is lost.
    // GATE (9/21): seeded fights keep the original selection. This block was shipped ungated and it
    // silently rewrote 12 of the 24 golden bet-arena fights (dev/aaa/guard.sh caught it) — the arena
    // is CPU vs CPU, so changing which aerial comes out changes the whole replay.
    let def;
    if (!Game.combos) {
      def = this.in.up ? m.uair : this.in.down ? m.dair : dx === this.face ? m.fair : dx === -this.face ? m.bair : m.nair;
      return this.startMove(def);
    }
    if (this.in.up) def = m.uair;
    else if (this.in.down) def = m.dair;
    else if (dx) { this.face = dx; def = m.fair; }
    else {
      const behind = Game.fighters && Game.fighters.some(g => g !== this && g.state !== 'dead' &&
        (g.x - this.x) * this.face < 0 && Math.abs(g.x - this.x) < this.w * 2.4 && Math.abs(g.y - this.y) < this.h * 1.3);
      def = behind ? m.bair : m.nair;
    }
    this.startMove(def);
  }
  smashAttack(dx) {
    if (this.air) return this.aerial(dx);
    if (this.in.up) return this.startMove(this.m.usmash);
    if (this.in.down) return this.startMove(this.m.dsmash);
    if (dx) this.face = dx;
    this.startMove(this.m.fsmash);
  }
  special() {
    const dx = this.dirX(), m = this.m;
    if (this.in.up) { if (this.air && this.airOnce.up) return; return this.startMove(m.ub); }
    if (this.in.down) { const d = m.db; if (d.shout && d.ground) Game.text(this.x, this.y - this.h - 30, d.shout, this.color, 1.15); return this.startMove(d.ground ? (this.air ? d.air : d.ground) : d); }
    if (dx) { if (this.air && this.airOnce.side) return; this.face = dx; return this.startMove(m.sb); }
    this.startMove(m.nb);
  }
  startMove(def) {
    if (!def) return;
    if (this.item && ITEM_DEFS[this.item.kind].sword && NORMALS.some(n => this.m[n] === def)) {
      const D = ITEM_DEFS[this.item.kind];
      const sw = swordify(def, (Game.feel && D.feelSword) || D.sword); sw.base = def; def = sw;   // softer swords under local rules (55_items)
    }
    this.move = { def, t: 0, charge: 0, hits: new Map(), air: this.air };
    this.setState('move');
    if (def.airOnce && this.air) this.airOnce[def.airOnce] = true;
    if (def.airOnce === 'up') this.airOnce.up = true;
    if (def.start) def.start(this);
    if (def.shout) Game.text(this.x, this.y - this.h - 30, def.shout, this.color, 1.15);
  }
  moveUpdate() {
    const mv = this.move, d = mv.def, ch = d.charge;
    if (Game.combos && mv.t <= 2 && GRAPPLE.late(this)) return;   // partner press up to 3 frames late: grapple (24_grapple)
    const keys = ch && (ch.key === 'special' ? ['special'] : ['attack', 'smash']);
    if (ch && mv.t === ch.at && mv.charge < (ch.max || 60) && keys.some(k => this.in[k])) {
      mv.charge++; if (mv.charge % 5 === 0) Game.chargeSpark(this);
    } else mv.t++;
    const t = mv.t;
    if (this.air) this.drift(d.landLag ? 0.8 : 0.5); else this.fric(0.84);
    if (d.tick) d.tick(this, t);
    if (d.hits && d.sfx !== 'none' && d.hits.some(hb => hb.f[0] === t)) Sfx.swing();
    if (d.counter && t === d.counter[0]) Game.ring(this.x, this.y - this.h / 2, '#ffffff', 50);
    if (this.state !== 'move' || this.move !== mv) return;
    if (Game.combos && mv.landedT != null && COMBO.cancel(this)) return;   // hit-confirm cancels (23_combo)
    if (d.iasa && t >= d.iasa && this.pressed('attack')) return this.startMove(d);
    if (t >= d.total) this.endMove();
  }
  endMove() {
    const d = this.move && this.move.def;
    this.move = null;
    if (this.air) this.setState(d && d.helpless ? 'helpless' : 'air'); else this.setState('ground');
  }

  shieldUpdate() {
    this.fric(0.8);
    if (!this.in.shield) return Game.feel ? FEEL.unshield(this) : this.setState('ground');   // shield drop lag (25_feel)
    this.shieldHP -= 0.14;
    if (this.shieldHP <= 0) return this.shieldBreak();
    if (this.pressed('jump')) return this.setState('jumpsquat');
    if (this.pressed('attack')) return this.startMove(this.m.grab);
    if (this.pressed('left') || this.pressed('right')) return this.startRoll(this.dirX());
    if (this.pressed('down')) return this.setState('spot');
  }
  shieldBreak() {
    this.shieldHP = 30; this.setState('dizzy'); this.vy = -9; this.leaveGround(); this.setState('dizzy');
    Sfx.ko(); Game.text(this.x, this.y - this.h - 20, 'SHIELD BROKE', '#ff4d6d');
  }
  startRoll(dx) { this.rollDir = dx || this.face; this.setState('roll'); }
  dodgeUpdate() {
    const s = this.st;
    if (this.state === 'roll') {
      this.intang = s >= 4 && s <= 16;
      this.vx = s >= 3 && s <= 18 ? this.rollDir * 8.5 : this.vx * 0.7;
      if (s >= 28) { this.face = -this.rollDir; this.setState('ground'); }
    } else {
      this.intang = s >= 3 && s <= 16; this.fric(0.7);
      if (s >= 24) this.setState('ground');
    }
  }
  startAirdodge(dx) {
    this.airdodged = true; this.setState('airdodge'); this.fastFall = false;
    const dy = (this.in.down ? 1 : 0) - (this.in.up ? 1 : 0);
    if (dx || dy) { const m = dhypot(dx, dy); this.vx = dx / m * 9.5; this.vy = dy / m * 9.5; this.adv = true; } else this.adv = false;
  }
  airdodgeUpdate() {
    this.intang = this.st >= 2 && this.st <= 20;
    if (this.adv && this.st <= 18) { this.vx *= 0.9; this.vy *= 0.9; this.noGrav = true; }
    else this.drift(0.4);
    if (this.st >= 32) this.setState('air');
  }

  physics(st) {
    const c = this.c, hs = this.state === 'hitstun';
    if (this.air && !this.noGrav) {
      this.vy += hs ? c.grav * 0.6 : c.grav;
      const cap = hs ? c.fall * 1.5 : this.fastFall ? c.fall * 1.55 : c.fall;
      if (this.vy > cap) this.vy = hs ? Math.max(cap, this.vy * 0.98) : cap;
    }
    if (this.air && hs) this.vx *= 0.975;
    this.noGrav = false;
    const px = this.x, py = this.y;
    this.x += this.vx; this.y += this.vy;
    this.collide(st, px, py);
  }
  collide(st, px, py) {
    if (Game.holes.length) return this.collideHoles(st, px, py);   // TNT craters (56_items2)
    const w2 = this.w * 0.4, h = this.h, M = st.main;
    let landed = null;
    if (this.vy >= 0) {
      if (py <= M.top + 0.01 && this.y >= M.top && this.x >= M.x0 - 2 && this.x <= M.x1 + 2) landed = st.mainSurf;
      else if (this.dropT <= 0 && !(this.in.down && this.air && this.state !== 'hitstun')) {
        for (const p of st.plats) if (py <= p.y + 0.01 && this.y >= p.y && this.x >= p.x0 && this.x <= p.x1) { landed = p; break; }
      }
    }
    if (landed) {
      this.y = landed.y; this.plat = landed;
      if (this.air) this.onLand(); else this.vy = 0;
    } else if (!this.air) {
      const p = this.plat;
      if (!p || this.vy < 0 || this.x < p.x0 - 1 || this.x > p.x1 + 1) this.leaveGround();
      else { this.y = p.y; this.vy = 0; }
    }
    // solid sides + underside of the main stage
    if (this.y > M.top + 1 && this.y - h < M.bot && this.x + w2 > M.x0 && this.x - w2 < M.x1) {
      const hs = this.state === 'hitstun';
      if (py - h >= M.bot - 1) { this.y = M.bot + h; if (this.vy < 0) this.vy = hs ? -this.vy * 0.4 : 0; }
      else if (this.x < (M.x0 + M.x1) / 2) { this.x = M.x0 - w2; if (this.vx > 0) this.vx = hs ? -this.vx * 0.5 : 0; }
      else { this.x = M.x1 + w2; if (this.vx < 0) this.vx = hs ? -this.vx * 0.5 : 0; }
    }
  }
  leaveGround() {
    this.air = true; this.plat = null;
    if (GROUNDISH.includes(this.state)) this.setState('air');
  }
  onLand() {
    const vy = this.vy, S = this.state;
    this.air = false; this.vy = 0; this.jumps = FEEL.jumps(this); this.airOnce = {}; this.airdodged = false; this.fastFall = false; this.ledgeUsed = false;
    if (S === 'hitstun') {
      if (Game.feel && FEEL.tech(this, vy)) return;   // tech / knockdown (25_feel)
      if (this.tumble && vy > 8) { this.vy = -vy * 0.45; this.air = true; this.plat = null; this.tumble = false; Game.puff(this.x, this.y, 10, '#ffffff'); Sfx.land(); return; }
      if (this.tumble) { this.tumble = false; this.setState('land'); this.landT = 24; }
      Sfx.land(); return;
    }
    if (S === 'move') {
      const d = this.move.def;
      if (d.onLand) return d.onLand(this);
      if (Game.feel && FEEL.landMove(this, d)) return;   // autocancel / clean landing (25_feel)
      if (d.landLag) { this.move = null; this.setState('land'); this.landT = d.landLag; Sfx.land(); return; }
      if (this.move.air) { this.move = null; this.setState('land'); this.landT = d.helpless ? 14 : 8; return; }
      return;
    }
    if (S === 'helpless') { this.setState('land'); this.landT = 14; }
    else if (S === 'airdodge') { this.setState('land'); this.landT = 10; }
    else if (S === 'air') { this.setState('land'); this.landT = 2; }
    this.sq = 0.18; Sfx.land(); Game.puff(this.x, this.y, 4, '#ffffff');
  }

  checkLedge(st) {
    if (!this.air || this.ledgeCd > 0 || this.in.down) return;
    if (this.vy < 0 && !(Game.feel && FEEL.snap(this))) return;   // rising: only the local-rules snap from below
    const S = this.state;
    if (!(S === 'air' || S === 'helpless' || S === 'hammer' || (S === 'move' && this.move.def.helpless))) return;
    if (Game.feel && !FEEL.ledgeOK(this)) return;   // the coyote window is for jumping, not for grabbing (25_feel)
    for (const L of st.ledges) {
      if (L.holder && L.holder !== this && L.holder.state === 'ledge') continue;
      const out = (this.x - L.x) * L.side;
      const W = Game.feel ? FEEL.LEDGE : null;
      if (out < -this.w * (W ? W[0] : 0.35) || out > this.w * (W ? W[1] : 0.95)) continue;
      if (this.y < L.y + (W ? W[2] : 4) || this.y > L.y + this.h + (W ? W[3] : 26)) continue;
      return this.grabLedge(L);
    }
  }
  grabLedge(L) {
    this.setState('ledge'); this.ledge = L; L.holder = this; this.move = null; this.hammerT = 0;
    this.face = -L.side; this.x = L.x + L.side * this.w * 0.42; this.y = L.y + this.h * 0.82; this.vx = this.vy = 0;
    this.jumps = FEEL.jumps(this); this.airOnce = {}; this.airdodged = false; this.fastFall = false;
    if (!this.ledgeUsed) this.invuln = Math.max(this.invuln, 50);
    this.ledgeUsed = true;
  }
  releaseLedge() { if (this.ledge && this.ledge.holder === this) this.ledge.holder = null; }
  ledgeUpdate(st) {
    const L = this.ledge, s = this.st;
    if (s < 8) return;
    const dx = this.dirX();
    if (this.pressed('jump')) {
      this.releaseLedge(); this.air = true; this.vy = -this.c.jump * 1.02; this.vx = -L.side * 2; this.ledgeCd = 20;
      this.setState('air'); Sfx.jump(); return;
    }
    if (this.pressed('attack') || this.pressed('smash') || this.pressed('special')) {
      this.releaseLedge(); this.placeOnStage(st); this.invuln = Math.max(this.invuln, 14); return this.startMove(this.m.getup);
    }
    if (this.pressed('shield')) { this.releaseLedge(); this.placeOnStage(st); this.startRoll(-L.side); this.invuln = 16; return; }
    if (dx === -L.side || this.in.up) {
      this.releaseLedge(); this.climbFrom = { x: this.x, y: this.y }; this.setState('climb'); return;
    }
    if (s >= 150 || this.pressed('down') || dx === L.side) {
      this.releaseLedge(); this.air = true; this.plat = null; this.ledgeCd = 36; this.vy = 1; this.vx = L.side * 1.5; this.setState('air');
    }
  }
  placeOnStage(st) {
    const L = this.ledge; this.x = L.x - L.side * this.w * 0.6; this.y = L.y; this.air = false; this.plat = st.mainSurf; this.vx = this.vy = 0;
  }
  climbUpdate() {
    const L = this.ledge, k = Math.min(1, this.st / 14);
    this.intang = true;
    this.x = lerp(this.climbFrom.x, L.x - L.side * this.w * 0.6, k);
    this.y = lerp(this.climbFrom.y, L.y, Math.min(1, k * 1.6));
    if (this.st >= 14) { this.placeOnStage(Game.stage); this.setState('ground'); }
  }
  respawnUpdate() {
    this.intang = true; this.vx = this.vy = 0;
    const any = ['left', 'right', 'down', 'jump', 'attack', 'special', 'shield', 'smash'].some(a => this.pressed(a));
    if ((this.st > 30 && any) || this.st > 220) { this.air = true; this.plat = null; this.setState('air'); this.invuln = 110; }
  }
}
