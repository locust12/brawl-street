// ===== combos: hit-confirm cancels + combo tracking =====
// Not a roster file: it is named 2x_ so build.py and net/tools/build-engine.js pull it into the
// headless fight engines along with the fighters.
//
// Cancels are rules v2 and run only while Game.combos is on. Game.start turns it on for unseeded
// (local) matches. Seeded fights (bet arena at ARENA.version 1, online) keep v1 rules unless the
// caller sets Game.combos = true after start. A normal that LANDS on a fighter (not a shield,
// not a whiff) can be cut short into a stronger move, Tekken-string style:
//   ground: jab -> tilt -> smash -> special, and a landed jab or tilt -> jump (launcher -> juggle)
//   air:    aerial -> a different aerial (each once per string) -> special, or -> double jump
// A cancelled normal skips most of its wind-up, so a string lands inside the victim's hitstun.
// Presses made during hitlag are buffered for a few frames, so a human can mash through the freeze.
//
// Combo tracking is always on and never changes a fight (no Rng, no physics). Each hit on a fighter
// still in hitstun from the same attacker adds to that fighter's `combo`. 82_combo_hud.js draws it.
const COMBO = {
  TIER: { jab: 1, ftilt: 2, utilt: 2, dtilt: 2, nair: 3, fair: 3, bair: 3, uair: 3, dair: 3, fsmash: 4, usmash: 4, dsmash: 4 },
  SPECIAL: 5,
  BUF: 8,       // frames a press made during hitlag stays buffered
  STRING: 45,   // frames after the last cancel that a string stays open
  MAX: 8,       // moves in one string
  LEAD: 3,      // a cancelled normal's first hitbox comes out this many frames after the cancel
  seq: 0,

  tier(f, d) {
    if (!d) return 0;
    d = d.base || d;   // sword-held normals (55_items swordify)
    const m = f.m;
    for (const k in COMBO.TIER) if (m[k] === d) return COMBO.TIER[k];
    if (d === m.nb || d === m.sb || d === m.ub || d === m.db || (m.db && (d === m.db.ground || d === m.db.air))) return COMBO.SPECIAL;
    return 0;
  },

  // ---- tracking (called from takeHit before the hit changes the victim's state) ----
  hit(v, att, d) {
    v.cstr = null;   // getting hit ends the victim's own string
    if (!att || att === v) { v.combo = null; return; }
    const c = v.combo, live = v.state === 'hitstun' || v.state === 'grabbed';
    if (c && c.by === att && live) { c.n++; c.dmg += d; c.t = Game.frame; }
    else v.combo = { id: ++COMBO.seq, by: att, n: 1, dmg: d, t: Game.frame };
    // Longest combo the ATTACKER landed this match. v.combo is cleared the moment the string
    // drops, so without this high-water mark nothing survives to the end of the fight for the
    // result screen or achievements to read. Integer only, and derived purely from state the
    // sim already computed, so it cannot change a fight or its determinism.
    const n = v.combo.n;
    if (att.stats && n > att.stats.combo) att.stats.combo = n;
  },
  // the attacker's move connected with a fighter (called from Game.resolveHits)
  landed(a, b) { if (a.move && a.move.landedT == null) { a.move.landedT = a.move.t; a.move.landedOn = b; } },

  // ---- input buffer during hitlag (humans only; CPUs think after the freeze) ----
  peek(f) {
    const i = readInput(f.ctrl);
    for (const k of ['attack', 'smash', 'special', 'jump']) if (i[k] && !f.in[k]) (f.cbuf = f.cbuf || {})[k] = Game.frame;
  },
  want(f, k) { return f.pressed(k) || !!(f.cbuf && f.cbuf[k] != null && Game.frame - f.cbuf[k] <= COMBO.BUF); },

  // the open string, or a fresh one that starts with the current move
  string(f) {
    const s = f.cstr;
    if (s && Game.frame - s.t <= COMBO.STRING) return s;
    return (f.cstr = { n: 0, used: [f.move.def.base || f.move.def], t: Game.frame });
  },
  // inside a string, attack + direction is always a tilt (no tap-for-smash): a stick pressed during the
  // hitlag freeze would otherwise read as a fresh tap. Smashes come from the smash button.
  groundDef(f, dx) {
    const m = f.m;
    return f.in.up ? COMBO.launcher(f) : f.in.down ? m.dtilt : dx ? m.ftilt : m.jab;
  },
  // Up-tilt cancelled out of a string becomes a launcher: an extra hitbox in front at chest height that
  // pops the victim straight up with low knockback growth, so jump -> aerials can follow at any percent.
  // It keeps `base`, so animation, sound and the string's used-list all treat it as the up-tilt.
  launchers: new Map(),
  launcher(f) {
    const u = f.m.utilt;
    if (!u || !u.hits || u.tick || u.start) return u;
    let L = COMBO.launchers.get(u);
    if (!L) {
      const c = f.c, R = c.reach || 1;
      let a = 1e9, b = 0; for (const h of u.hits) { a = Math.min(a, h.f[0]); b = Math.max(b, h.f[1]); }
      L = Object.assign({}, u, { base: u, launcher: true, hits: [H(a, b, c.w * 0.5 + 14 * R, -c.h * 0.45, 26 * R, 6 * (c.power || 1), 88, 58, 28), ...u.hits] });
      COMBO.launchers.set(u, L);
    }
    return L;
  },
  aerialDef(f, dx) {
    const m = f.m;
    return f.in.up ? m.uair : f.in.down ? m.dair : dx === f.face ? m.fair : dx === -f.face ? m.bair : m.nair;
  },

  // Called from moveUpdate once the move has landed. Returns true when it started something new.
  cancel(f) {
    const mv = f.move, from = COMBO.tier(f, mv.def);
    if (!from || from >= COMBO.SPECIAL || mv.t <= mv.landedT) return false;
    const s = COMBO.string(f);
    if (s.n >= COMBO.MAX) return false;
    const dx = f.dirX(), heldItem = f.item && !ITEM_DEFS[f.item.kind].sword;
    const go = () => { s.n++; s.t = Game.frame; f.cbuf = null; };
    if (COMBO.want(f, 'special')) {
      go();
      if (f.finalReady) { f.startFinal(); return true; }
      const before = f.move; f.special();
      if (f.move !== before || f.state !== 'move') return true;
      s.n--; return false;   // that special was already spent in this jump
    }
    let def = null;
    if (!heldItem && (COMBO.want(f, 'attack') || COMBO.want(f, 'smash'))) {
      if (f.air) def = COMBO.aerialDef(f, dx);
      else if (COMBO.want(f, 'smash')) def = f.in.up ? f.m.usmash : f.in.down ? f.m.dsmash : f.m.fsmash;
      else def = COMBO.groundDef(f, dx);
      const to = COMBO.tier(f, def);
      const ok = to > from || (to === 3 && from === 3);
      if (!def || !ok || s.used.includes(def)) return false;
      go(); s.used.push(def);
      if (dx && (def === f.m.ftilt || def === f.m.fsmash)) f.face = dx;
      f.startMove(def);
      const nm = f.move, hits = nm && nm.def.hits;
      if (hits && hits.length && !nm.def.tick && !nm.def.start) {
        let first = 1e9; for (const h of hits) first = Math.min(first, h.f[0]);
        nm.t = Math.max(0, first - COMBO.LEAD);
      }
      return true;
    }
    if (COMBO.want(f, 'jump') && from <= 3) {
      if (!f.air) { go(); f.move = null; f.setState('jumpsquat'); return true; }
      if (f.jumps > 0) {
        go(); f.move = null; f.setState('air');
        f.jumps--; f.vy = -f.c.djump; f.fastFall = false; if (dx) f.vx = dx * f.c.air;
        Sfx.jump(); Game.puff(f.x, f.y, 6, '#ffffff'); f.sq = -0.15; f.flip = 1;
        return true;
      }
    }
    return false;
  },

  // CPU follow-ups. Called from AI.think while the CPU is in a move. The CPU decides once per
  // landed move whether to go for a string (better CPUs more often), then waits a few frames.
  ai(f, o, press) {
    const mv = f.move, v = mv && mv.landedOn;
    if (!mv || mv.landedT == null || !v || v.state === 'dead') return false;
    const from = COMBO.tier(f, mv.def);
    if (!from || from >= COMBO.SPECIAL) return false;
    if (mv.aiGo == null) { mv.aiGo = Rng.next() < 0.15 + f.level * 0.08; mv.aiAt = mv.landedT + Math.floor(Rng.next() * Math.max(1, 10 - f.level)); }
    if (!mv.aiGo || mv.t < mv.aiAt) return false;
    const dx = v.x - f.x, dy = (v.y - v.h / 2) - (f.y - f.h / 2), toward = dx > 0 ? 'right' : 'left', r = Rng.next();
    if (f.air) {
      if (r < 0.25) { o[toward] = true; press('special'); return true; }
      if (dy < -35) o.up = true; else if (dy > 35) o.down = true; else if (Math.abs(dx) > 8) o[toward] = true;
      press('attack'); return true;
    }
    if (from <= 2 && dy < -50 && r < 0.6) { press('jump'); return true; }   // launched: chase it up
    if (from === 1) { o[toward] = true; press(r < 0.8 ? 'attack' : 'special'); return true; }
    if (from === 2 && v.dmg > 90 && r < 0.5) { o[toward] = true; press('smash'); return true; }
    if (r < 0.75) { if (r < 0.4) o[toward] = true; press('special'); return true; }
    return false;
  },
};
