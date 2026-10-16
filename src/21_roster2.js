// ===== roster 2: 22 more fighters, and the opt-in move mechanics they use =====
// Fight code: runs in the page and in the headless arena sim (build.py puts src/2x_*.js in
// arena/fightsim.js), so it only uses the seeded rand()/irand() and dsin/dcos/dhypot. Every mechanic
// here is switched on by a flag on a move def, hitbox or projectile. The first 14 fighters (the
// arena roster, ARENA.version 1) carry none of these flags, so they play bit-for-bit as before.
//
// ---- engine flags (reusable by any roster file) ----
// Move def:
//   clip: 'punch'            3D animation clip for this move (idle guard run jump jab punch uppercut
//                            kick sweep flykick slam cast hit block hang spin taunt)
//   fx: 'firebird'           3D effect drawn while the move runs (see 94_v3_moves.mjs), visual only
//   color: '#hex'            tint for that effect
//   vanish: [a, b]           fighter is not drawn on these move frames (tick should also set f.intang)
//   reflect: [a, b]          projectiles touching the fighter on these frames turn around, change owner
//   armor: kb, armorF: [a,b] super armor: hits whose knockback is under `kb` don't flinch (frames optional)
//   counter: [a, b] + counterHit: { mult, min, ang, bkb, kbg, shout, def }   custom counter retaliation
//                            (dmg = max(min, incoming * mult); def = the move played while answering)
//   holdVictim: true         command-grab hold: the grabbed fighter stays 'grabbed' while this move runs
//   swallow: true            ...and is hidden (inside the grabber)
//   aiHold: [min, max]       CPU keeps special held for that many frames (charge / stream / inhale moves)
// Hitbox (H(...) extra):
//   cgrab: <def>             command grab: beats shields and counters, starts <def> holding the victim
//   pre(a, b, hb)            runs before the hit (after counters); return true to replace the hit
//   after(a, b, hb)          runs after the hit lands (see LINK, FLIP, TRIP, RECOIL)
// Projectile (spawnProj / MV2.spawn def):
//   step: true               custom motion (MV2.projStep): needed by anchor, track, drag, rgrow, bounce, crawl
//   pierce: true             keeps going after a hit (one hit per fighter unless rehit)
//   rehit: n                 can hit the same fighter again every n frames
//   len/maxLen/grow + anchor: [x, yFrac] + srcMove    beam: a box from the owner's hand, dies with the move
//   track: true + srcMove    sky bolt: falls onto its owner's x, stops at the owner
//   drag: k, rgrow: px       slow down / grow each frame
//   bounce: vy               hops along floors and platforms
//   crawl: true (+ wrap, speed)   runs along floors; with wrap it follows the stage down the side and under
//   noReflect, after(p, b), big (bigger burst when it hits the stage), boom (explodes on floors / at end
//   of life through Items2.projBoom, see 56_items2), color (visual tint)
// Fighter data: ai2: [[slot, kind], ...]   CPU special use (slot nb/sb/ub/db; kind zone beam trap
//   close inhale grab dash slam stone up punish counter reflect breaker)
//   blade: '#hex'            tints the slash trail of every normal (sword fighters)
// Builders (hoisted): split2 (ground/air versions of one special), withTick, linkTo (dash that turns
//   into a follow-up on contact), mkTeleport, mkZip, mkHover, mkStream (held breath), mkCgrab, fin.
// Callbacks (hoisted): LINK FLIP TRIP(n) RECOIL(n) DISABLE SHIELD_SMASH NOVA_BOOM.
//
// Builders and hit callbacks below are function declarations (hoisted), so roster files that sort
// before this one can still call them while they load. MV2 and WAVE_ROCK are consts: they only exist
// once this file has run, so reference them inside ticks/callbacks (run time), not at load time.

// ---- hit callbacks ----
// multi-hit: keep the victim in front of the attacker for the next hit
function LINK(a, b, hb) {
  if (b.state !== 'hitstun') return;
  const tx = a.x + a.face * hb.x, ty = a.y + hb.y + b.h * 0.5;
  b.vx = clamp((tx - b.x) * 0.25, -8, 8) + a.vx * 0.8;
  b.vy = clamp((ty - b.y) * 0.25, -8, 8) + a.vy * 0.8;
}
// turn the victim around
function FLIP(a, b) { if (b.state === 'hitstun') { b.face = -b.face; b.vx = -b.vx * 0.5; } }
// knock a grounded victim flat for n frames
function TRIP(n) {
  return (a, b) => { if (b.state === 'hitstun' && !b.air) { b.setState('land'); b.landT = n; b.vx *= 0.3; b.tumble = false; } };
}
// the attacker takes a little damage too
function RECOIL(n) {
  return a => { a.dmg = Math.min(999, a.dmg + n); a.stats.taken += n; a.vx = -a.face * 4; a.flashT = 6; };
}
// psychic flash: stuns a grounded opponent that is facing you
function DISABLE(a, b) {
  const facing = b.face === (a.x > b.x ? 1 : -1);
  if (facing && !b.air && b.state !== 'dizzy' && b.state !== 'shield') {
    MV2.interrupt(b);
    b.move = null; b.setState('dizzy'); b.st = 150 - 84; b.vx = 0; b.flashT = 10;
    b.dmg = Math.min(999, b.dmg + 2);
    Game.text(b.x, b.y - b.h - 16, 'DISABLED', '#c9a6ff', 1.2); Game.ring(b.x, b.y - b.h * 0.7, '#c9a6ff', 70); Sfx.hit(0.3);
  } else Game.ring(a.x + a.face * 60, a.y - a.h * 0.7, '#c9a6ff', 34);
  return true;
}
// shatters a shield outright; a normal hit otherwise
function SHIELD_SMASH(a, b) {
  if (b.state !== 'shield') return false;
  b.shieldBreak(); Game.shake(10); Game.ring(b.x, b.y - b.h * 0.5, '#ffb347', 90);
  return true;
}
// a fighter's signature move landing: the hit hangs for a beat, flashes and shouts
function SIG(a, b) {
  if (a && a.owner) a = a.owner;                      // called from a projectile
  if (!a || !b) return;
  const G = Game;
  b.hitlag += 8; a.hitlag = Math.max(a.hitlag, 4);
  G.shake(18); G.flashT = Math.max(G.flashT, 5);
  if (!G.demo) G.slowT = Math.max(G.slowT, 20);       // the little cinematic pause
  G.burst(b.x, b.y - b.h * 0.5, a.color, 22);
  G.rings.push({ x: b.x, y: b.y - b.h * 0.5, r: 12, max: 210, color: a.color, life: 20, w: 12 });
  const d = a.move && a.move.def;
  if (d && d.sigText) G.text(b.x, b.y - b.h - 42, d.sigText, '#ffe27a', 1.7);
}
// taunt: shield + up on the ground. Pure show, but it is the fighter's own gag.
function TAUNT(f) {
  f.startMove({ total: 64, clip: 'taunt', sfx: 'none', shout: f.c.taunt || 'COME ON', tick(g, t) { g.fric(0.8); if (t === 10 || t === 30) Game.puff(g.x, g.y, 4, '#ffffff'); } });
  return true;
}
// a real downward / diagonal kick for every roster-2 fighter: low boot on the ground, stomp in the air
function kicks(c) {
  const W = c.w, Hh = c.h, P = c.power, R = c.reach, fx = W * 0.5;
  return {
    dtilt: { total: 24, clip: 'sweep', hits: [H(6, 10, fx + 26 * R, -9, 22 * R, 7 * P, 16, 26, 62)] },
    dair: { total: 40, landLag: 15, clip: 'slam', fx: 'downkick',
      hits: [H(11, 15, fx * 0.55, 16, 26 * R, 12 * P, -84, 26, 80), H(16, 24, fx * 0.45, 14, 22 * R, 7 * P, -55, 18, 58, { rehit: 9 })] },
  };
}
// big orbs burst when they connect
function NOVA_BOOM(p) { Game.burst(p.x, p.y, p.color || '#ff5a3a', 26); Game.ring(p.x, p.y, p.color || '#ff5a3a', p.r * 3); Game.shake(8); }

// ---- builders ----
// one def on the ground, another in the air (for side/neutral/up specials; db can also use mkSlam)
function split2(ground, air) {
  return Object.assign({}, ground, { start(f) { if (f.air) f.startMove(air); else if (ground.start) ground.start(f); } });
}
// run `pre` every frame before the def's own tick
function withTick(def, pre) { const tk = def.tick; def.tick = (f, t) => { pre(f, t); if (tk) tk(f, t); }; return def; }
// a dash that turns into `next` as soon as it connects
function linkTo(def, next) {
  const tk = def.tick;
  def.tick = (f, t) => { if (f.move.hits.size && t > 2) return f.startMove(next); if (tk) tk(f, t); };
  return def;
}
// vanish, reappear `dist` px in the held direction (stick at start or at the vanish frame), helpless after
function mkTeleport({ total = 38, at = 7, frames = 7, dist = 210 }) {
  return {
    total, helpless: true, airOnce: 'up', clip: 'jump', fx: 'blink', vanish: [at - 1, at + frames], sfx: 'none',
    start(f) { f.move.d0 = MV2.stick(f); },
    tick(f, t) {
      const mv = f.move;
      if (t < at) { f.vx *= 0.6; f.vy *= 0.6; f.noGrav = true; }
      if (t >= at - 1 && t <= at + frames) f.intang = true;
      if (t === at) { mv.dv = MV2.aim(f, mv.d0); if (mv.dv.x) f.face = mv.dv.x > 0 ? 1 : -1; Sfx.tone(1200, 300, 0.12, 'sine', 0.1); }
      if (t >= at && t < at + frames) { f.vx = mv.dv.x * dist / frames; f.vy = mv.dv.y * dist / frames; f.noGrav = true; }
      if (t === at + frames) { f.vx *= 0.2; f.vy = f.vy < 0 ? -2 : 0; }
    },
  };
}
// two quick dashes that follow the stick (the second only if the stick moved)
function mkZip({ total = 42, at = 4, frames = 7, dist = 150, dist2 = 125, hits }) {
  const t2 = at + frames + 3;
  return {
    total, helpless: true, airOnce: 'up', clip: 'flykick', fx: 'zip', hits, sfx: 'none',
    start(f) { f.move.d0 = MV2.stick(f); },
    tick(f, t) {
      const mv = f.move;
      if (t < at) { f.vx *= 0.5; f.vy *= 0.5; f.noGrav = true; return; }
      if (t === at) { mv.dv = MV2.aim(f, mv.d0); if (mv.dv.x) f.face = mv.dv.x > 0 ? 1 : -1; Sfx.tone(900, 1800, 0.06, 'square', 0.06); }
      if (t === t2) {
        const s = MV2.stick(f);
        if (s.x || s.y) { const m = dhypot(s.x, s.y), d = { x: s.x / m, y: s.y / m }; if (d.x * mv.dv.x + d.y * mv.dv.y < 0.7) { mv.dv2 = d; if (d.x) f.face = d.x > 0 ? 1 : -1; Sfx.tone(900, 1800, 0.06, 'square', 0.06); } }
      }
      let d = null, L = dist;
      if (t < at + frames) d = mv.dv; else if (mv.dv2 && t >= t2 && t < t2 + frames) { d = mv.dv2; L = dist2; }
      if (d) { f.vx = d.x * L / frames; f.vy = d.y * L / frames; f.noGrav = true; }
      else if (t < t2 || (mv.dv2 && t < t2 + frames + 1)) { f.vx *= 0.3; f.vy *= 0.3; f.noGrav = true; }
    },
  };
}
// slow steerable float upward, helpless after
function mkHover({ total = 84, at = 4, rise = 4.4, speed = 5.2, hits }) {
  return {
    total, helpless: true, airOnce: 'up', clip: 'jump', fx: 'hover', hits,
    tick(f, t) {
      if (t < at) { f.vx *= 0.7; f.vy = Math.min(f.vy, 1); return; }
      f.noGrav = true;
      const dy = f.in.up ? -1 : f.in.down ? 1 : 0;
      f.vx = approach(f.vx, f.dirX() * speed, 0.6);
      f.vy = approach(f.vy, dy ? dy * speed : -rise, 0.6);
    },
  };
}
// breath held on the special button: shoots `fire(f, fuel)` every few frames, fuel drains with use
// and refills over time, so a long breath gets shorter
function mkStream({ total = 84, from = 10, to = 70, min = 22, every = 3, drain = 0.02, fx = 'breath', fire }) {
  return {
    total, clip: 'cast', fx, aiHold: [22, 60], sfx: 'none',
    tick(f, t) {
      if (f.air) f.vy = Math.min(f.vy, 2);
      if (t < from || t >= to) return;
      if (t > min && !f.in.special) { f.move.t = to; return; }
      if ((t - from) % every) return;
      fire(f, MV2.fuel(f, -drain));
    },
  };
}
// command grab: a short lunge whose hitbox catches and starts `hold`
function mkCgrab({ total = 36, a = 8, b = 14, x, y, r = 30, lunge = 0, hold, clip = 'punch', airOnce }) {
  return {
    total, clip, airOnce, hits: [H(a, b, x, y, r, 0, 0, 0, 0, { cgrab: hold })],
    tick(f, t) { if (lunge && t >= a - 2 && t <= b) f.vx = f.face * lunge; else f.vx *= 0.8; if (f.air) f.vy = Math.min(f.vy, 2); },
  };
}
// the last hit of a multi-hit move must be allowed to hit someone the earlier hits already touched
function fin(hb) { hb.rehit = hb.f[1] - hb.f[0] + 1; return hb; }

// ---- runtime helpers used by the engine hooks (40/41/50/60) ----
const MV2 = {
  PULLABLE: ['ground', 'air', 'hitstun', 'move', 'shield', 'land', 'jumpsquat', 'helpless', 'dizzy', 'hammer'],
  say(f, s, k) { Game.text(f.x, f.y - f.h - 30, s, f.color, k || 1.15); },
  stick(f) { return { x: f.dirX(), y: f.in.down ? 1 : f.in.up ? -1 : 0 }; },
  aim(f, d0) {
    const s = MV2.stick(f);
    const x = s.x || d0.x; let y = s.y || d0.y;
    if (!x && !y) y = -1;
    const m = dhypot(x, y); return { x: x / m, y: y / m };
  },
  // spawn a projectile; x/y override the spawn point (forward / up from the feet)
  spawn(f, p, x, y) {
    Game.spawnProj(f, p);
    const q = Game.projs[Game.projs.length - 1];
    q.dir = f.face;
    if (x != null) q.x = f.x + f.face * x;
    if (y != null) q.y = f.y - y;
    if (f.move && f.move.def.sigProj) { const prev = q.after; q.after = (p2, b) => { if (prev) prev(p2, b); SIG(p2.owner, b); }; }
    return q;
  },
  // ground shockwave that runs along the floor under `f`
  wave(f, dir, o) {
    const s = !f.air && f.plat ? f.plat : null;
    const p = Object.assign({ kind: 'wave', vx: dir * (o.speed || 8), vy: 0, grav: 0.6, r: 18, dmg: 6, ang: 60, bkb: 40, kbg: 40, life: 30, step: true, crawl: true, speed: 8, pierce: true, color: f.color }, o);
    p.vx = dir * p.speed;
    Game.projs.push(Object.assign(p, { x: f.x + dir * (f.w * 0.5 + 6), y: (s ? s.y : f.y) - p.r * 0.7, owner: f, age: 0, dir, cs: s ? 'top' : undefined, surf: s }));
  },
  fuel(f, d) {
    if (f.fuel == null) { f.fuel = 1; f.fuelT = Game.frame; }
    f.fuel = Math.min(1, f.fuel + (Game.frame - f.fuelT) * 0.0022); f.fuelT = Game.frame;
    f.fuel = Math.max(0.2, f.fuel + d);
    return f.fuel;
  },

  // ---- command grabs ----
  catch(a, b) {
    if (b.state === 'grabbing' || b.state === 'grabbed' || b.state === 'dead' || (b.grabbed && MV2.holds(b, b.grabbed))) return false;
    if (b.state === 'ledge') b.releaseLedge();
    b.move = null; b.setState('grabbed'); b.grabber = a; b.cgrabbed = true; b.vx = b.vy = 0; b.fastFall = false;
    a.grabbed = b;
    Sfx.tone(300, 200, 0.08, 'square', 0.12);
    return true;
  },
  // (only from the move that owns the hitbox: once it has caught someone, the old hitbox list must not catch a second fighter)
  cgrab(a, b, hb) { if (!a.grabbed && a.move.def.hits && a.move.def.hits.includes(hb) && MV2.catch(a, b)) a.startMove(hb.cgrab); },
  holds(g, v) { return g.state === 'move' && !!g.move && !!g.move.def.holdVictim && g.grabbed === v; },
  hold(f, dx, dy) {
    const v = f.grabbed; if (!v) return null;
    v.x = f.x + f.face * dx; v.y = f.y + dy; v.face = -f.face; v.air = true; v.plat = null; v.vx = v.vy = 0;
    return v;
  },
  // release the held fighter with a hit; ground: put them on the floor first (when the thrower stands)
  throwV(f, T) {
    const v = f.grabbed; if (!v) return null;
    f.grabbed = null; v.grabber = null; v.cgrabbed = false; v.state = 'air'; v.air = true; v.plat = null;
    if (T.ground && !f.air && f.plat) { v.y = f.y; v.air = false; v.plat = f.plat; }
    v.takeHit({ dmg: T.dmg, ang: T.ang, bkb: T.bkb, kbg: T.kbg, x: 10 }, f, 1, f.x, f.face);
    if (f.move && f.move.def.sigText) SIG(f, v);
    return v;
  },
  // the holder got hit: let go
  drop(a) {
    const v = a.grabbed; a.grabbed = null;
    if (v && v.grabber === a && v.state === 'grabbed') { v.grabber = null; v.cgrabbed = false; v.air = true; v.plat = null; v.setState('air'); }
  },
  // a command-grabbed fighter let itself go (its holder left the hold move): clear both references
  unhold(v) { const g = v.grabber; if (g && g.grabbed === v) g.grabbed = null; v.grabber = null; v.cgrabbed = false; },
  interrupt(b) {
    if (b.grabbed) { const v = b.grabbed; b.grabbed = null; if (v.grabber === b) { v.grabber = null; v.setState(v.air ? 'air' : 'ground'); } }
    if (b.state === 'ledge') b.releaseLedge();
  },
  hidden(f) {
    const mv = f.move;
    if (f.state === 'move' && mv && mv.def.vanish) return mv.t >= mv.def.vanish[0] && mv.t <= mv.def.vanish[1];
    return f.state === 'grabbed' && !!f.grabber && !!f.grabber.move && !!f.grabber.move.def.swallow;
  },
  armor(f, att, hb, d, kb) {
    const def = f.move.def, fr = def.armorF, t = f.move.t;
    if (kb >= def.armor || (fr && (t < fr[0] || t > fr[1]))) return false;
    f.flashT = 6; f.hitlag = 4; if (att && att !== f) att.hitlag = Math.max(att.hitlag, 4);
    Game.onHit(f, att, hb, d, kb * 0.5);
    return true;
  },
  counterHit(ch, hb) { return { dmg: Math.max(ch.min, hb.dmg * ch.mult), ang: ch.ang, bkb: ch.bkb, kbg: ch.kbg, x: 10 }; },

  // ---- projectiles ----
  projStep(p, G, M) {
    const o = p.owner;
    if (p.rgrow) p.r += p.rgrow;
    if (p.falloff) p.dmg = p.dmg0 * Math.max(0.4, 1 - p.age / Math.max(1, p.life) * 0.75);   // buckshot loses bite downrange
    if (p.anchor) {
      if (o.state !== 'move' || o.move !== p.srcMove) { p.dead = true; return; }
      p.dir = o.face; p.x = o.x + o.face * p.anchor[0]; p.y = o.y - o.h * p.anchor[1];
      p.len = Math.min(p.maxLen, p.len + p.grow);
      if (p.age > p.life) p.dead = true;
      return;
    }
    if (p.track) {
      if (o.state !== 'move' || o.move !== p.srcMove) p.track = false;
      else { p.x = o.x; if (p.y + p.vy >= o.y - o.h * 0.6) { p.dead = true; return; } }
    }
    if (p.crawl) return MV2.crawl(p, G, M);
    if (p.boomer) MV2.boomer(p);                 // chakram: out, then back to the hand that threw it
    if (p.home) MV2.steer(p, p.home);            // arcing bolt: bends toward whoever it is chasing
    if (p.drag) { p.vx *= p.drag; p.vy *= p.drag; }
    p.vy += p.grav || 0;
    const px = p.x, py = p.y, lift = p.r * 0.6;
    p.x += p.vx; p.y += p.vy;
    if (p.age > p.life) { p.dead = true; if (p.boom) return Items2.projBoom(p); }
    if (p.bounce) { const s = MV2.surf(G.stage, px, py + lift, p.x, p.y + lift); if (s) { p.y = s.y - lift; p.vy = -p.bounce; } }
    if (p.boom && MV2.surf(G.stage, px, py, p.x, p.y)) { p.dead = true; return Items2.projBoom(p); }   // rockets burst on any floor
    if (p.y > M.top && p.y < M.bot && p.x > M.x0 && p.x < M.x1 && !(G.holes.length && Items2.inHole(p.x))) {
      p.dead = true;
      if (p.boom) Items2.projBoom(p); else if (p.big) NOVA_BOOM(p); else if (p.spark) G.burst(p.x, p.y, '#ffd08a', 4); else G.puff(p.x, M.top, 5, '#ffffff');
    }
  },
  // BOOMERANG, 2026-10-16. Out for `out` frames on the velocity it was thrown with, then pulled
  // back to the fighter who threw it, accelerating the whole way home. It keeps its hitbox on both
  // legs, which is the entire point: throwing a chakram PAST someone is the correct play.
  // dhypot, not Math.hypot: this runs in the seeded sim ([[determinism]] lint in build.py).
  boomer(p) {
    if (p.out > 0) { p.out--; return; }
    const o = p.boomer;
    if (!o || o.state === 'dead') { p.boomer = null; return; }
    const dx = o.x - p.x, dy = (o.y - o.h * 0.55) - p.y;
    const d = dhypot(dx, dy) || 1;
    p.vx += (dx / d) * 1.6; p.vy += (dy / d) * 1.6;
    p.vx *= 0.92; p.vy *= 0.92;
    if (d < 28) p.dead = true;                   // caught
  },
  // homing: bend the velocity toward the nearest live opponent without changing its speed
  steer(p, k) {
    const o = p.owner;
    let t = null, bd = 1e9;
    for (const f of Game.fighters) {
      if (f === o || f.state === 'dead' || f.untouchable) continue;
      const d = dhypot(f.x - p.x, (f.y - f.h * 0.5) - p.y);
      if (d < bd) { bd = d; t = f; }
    }
    if (!t || bd > 620) return;
    const sp = dhypot(p.vx, p.vy); if (sp < 0.01) return;
    const dx = (t.x - p.x) / (bd || 1), dy = ((t.y - t.h * 0.5) - p.y) / (bd || 1);
    p.vx += dx * sp * k; p.vy += dy * sp * k;
    const s2 = dhypot(p.vx, p.vy) || 1;
    p.vx = p.vx / s2 * sp; p.vy = p.vy / s2 * sp;
  },
  // floor-runner: falls until it finds a surface, runs along it; `wrap` follows the stage down its side and under
  crawl(p, G, M) {
    const st = G.stage, lift = p.r * 0.7, sp = p.speed || 7;
    if (p.age > p.life) p.dead = true;
    if (p.cs === 'top') {
      p.x += p.vx;
      const s = p.surf;
      if (s === st.mainSurf && G.holes.length && Items2.inHole(p.x)) { p.cs = 'air'; p.vy = 0; return; }   // runs into a crater
      if (p.x < s.x0 || p.x > s.x1) {
        if (s === st.mainSurf && p.wrap) { const side = p.x > s.x1 ? 1 : -1; p.cs = 'wall'; p.side = side; p.x = (side > 0 ? M.x1 : M.x0) + side * lift; p.y = M.top + lift; p.vx = 0; }
        else if (s === st.mainSurf) p.dead = true;
        else { p.cs = 'air'; p.vy = 0; }
      }
      return;
    }
    if (p.cs === 'wall') {
      p.y += sp;
      if (p.y > M.bot + lift) { p.cs = 'under'; p.y = M.bot + lift; p.vx = -p.side * sp; }
      return;
    }
    if (p.cs === 'under') { p.x += p.vx; if (p.x < M.x0 || p.x > M.x1) p.dead = true; return; }
    p.vy += p.grav || 0.5;
    const px = p.x, py = p.y;
    p.x += p.vx; p.y += p.vy;
    const s = MV2.surf(st, px, py + lift, p.x, p.y + lift);
    if (s) { p.cs = 'top'; p.surf = s; p.y = s.y - lift; p.vy = 0; p.vx = (p.vx < 0 ? -1 : 1) * sp; }
    else if (p.y > M.top && p.y < M.bot && p.x > M.x0 && p.x < M.x1 && !(G.holes.length && Items2.inHole(p.x))) { p.dead = true; G.puff(p.x, p.y, 5, '#ffffff'); }
  },
  // the floor (main stage or platform) crossed from above between two points, or null
  surf(st, px, py, x, y) {
    if (y < py) return null;
    const M = st.main;
    if (py <= M.top + 0.01 && y >= M.top && x >= M.x0 && x <= M.x1 && !(Game.holes.length && Items2.inHole(x))) return st.mainSurf;
    for (const s of st.plats) if (py <= s.y + 0.01 && y >= s.y && x >= s.x0 && x <= s.x1) return s;
    return null;
  },
  beamHit(p, b) {
    const x0 = p.dir > 0 ? p.x : p.x - p.len, x1 = p.dir > 0 ? p.x + p.len : p.x;
    const bx0 = b.x - b.w * 0.4, bx1 = b.x + b.w * 0.4, by0 = b.y - b.h * (b.crouch ? 0.72 : 1);
    return x1 > bx0 && x0 < bx1 && p.y + p.r > by0 && p.y - p.r < b.y;
  },
  // a fighter in a reflect window turns the projectile around; returns true when it did
  reflect(p, b) {
    const R = b.move.def.reflect, t = b.move.t;
    if (p.noReflect || t < R[0] || t > R[1]) return false;
    p.owner = b; p.vx = -p.vx; if (p.vx) p.dir = p.vx > 0 ? 1 : -1;
    const gain = b.move.def.reflectGain || 1.25;                 // POPCAT spits it back bigger (67_unique)
    p.dmg *= gain; if (gain > 1.4) { p.r *= 1.35; p.vx *= 1.25; p.kbg = (p.kbg || 0) * 1.2; }
    p.hitSet = null; p.hitT = null; p.age = 0;
    if (p.boomer) p.boomer = 24;
    if (p.cs === 'wall' || p.cs === 'under') p.dead = true;
    Game.ring(p.x, p.y, '#ffffff', 46); Game.text(b.x, b.y - b.h - 16, 'REFLECT', '#9fe8ff', 1); Sfx.shield();
    return true;
  },
  // rehit projectiles: true while this fighter is still inside the wait; records the hit otherwise
  rehitWait(p, b) {
    const m = p.hitT || (p.hitT = new Map()), t0 = m.get(b);
    if (t0 != null && p.age - t0 < p.rehit) return true;
    m.set(b, p.age); return false;
  },

  // ---- CPU ----
  // while in a move: keep special held for charge / stream / inhale moves
  aiMove(f, o, a) {
    const mv = f.move, d = mv.def;
    if (!d.aiHold) return;
    if (a.hsMv !== mv) { a.hsMv = mv; a.hsT = irand(d.aiHold[0], d.aiHold[1]); }
    if (a.hsT > 0) { a.hsT--; o.special = true; }
  },
  aiIncoming(f) {
    for (const p of Game.projs) {
      if (p.owner === f || p.noReflect) continue;
      const dx = f.x - p.x, dy = (f.y - f.h / 2) - p.y;
      if (Math.abs(dy) < 70 && Math.abs(dx) < 170 && dx * p.vx > 0) return true;
    }
    return false;
  },
  // pick a special for fighters with an ai2 table; returns true when it pressed something
  aiPick(f, tgt, o, press, c) {
    const a = f.ai, lv = f.level, M = c.M, ady = Math.abs(c.dy), P = f.c.ai2;
    const toward = c.dir > 0 ? 'right' : 'left';
    const room = c.dir > 0 ? M.x1 - f.x : f.x - M.x0;
    const onStage = f.x > M.x0 + 40 && f.x < M.x1 - 40;
    const clear = () => { o.left = o.right = o.up = o.down = false; };
    const fire = (slot, now) => {
      clear();
      if (slot === 'sb') { o[toward] = true; press('special'); return true; }
      if (slot === 'nb' && f.face !== c.dir && !now) { o[toward] = true; a.queueNb = 8; return true; }
      if (slot === 'db') o.down = true; else if (slot === 'ub') o.up = true;
      press('special'); return true;
    };
    if (a.queueNb > 0) {
      a.queueNb--;
      if (f.face === c.dir && !f.prev.special) { a.queueNb = 0; clear(); press('special'); return true; }
    }
    for (const [slot, kind] of P) {
      if (kind === 'counter' && tgt.state === 'move' && tgt.move && tgt.move.def.hits && c.adx < 130 && ady < 90 && !f.air && Rng.next() < 0.02 + lv * 0.01) return fire(slot, true);
      if (kind === 'reflect' && MV2.aiIncoming(f) && Rng.next() < 0.1 + lv * 0.03) return fire(slot, true);
      if ((kind === 'grab' || kind === 'breaker') && tgt.state === 'shield' && c.adx < c.range + 16 && ady < 40 && !f.air && Rng.next() < 0.12) return fire(slot, true);
    }
    if (Rng.next() > 0.014 + lv * 0.004) return false;
    for (const [slot, kind] of P) {
      let ok = false;
      switch (kind) {
        case 'zone': ok = c.adx > 150 && c.adx < 560 && ady < 70 && !c.tgtOff; break;
        case 'beam': ok = c.adx > 110 && c.adx < 620 && ady < 50 && !c.tgtOff; break;
        case 'trap': ok = c.adx < 220 && ady < 90; break;
        case 'close': ok = c.adx < c.range * 1.15 && ady < 60; break;
        case 'inhale': ok = c.adx < 170 && ady < 50 && !f.air; break;
        case 'grab': case 'breaker': ok = c.adx < c.range + 12 && ady < 40 && !f.air && room > 150; break;
        case 'dash': ok = c.adx > 80 && c.adx < 300 && ady < 50 && room > 170 && !c.tgtOff; break;
        case 'slam': case 'stone': ok = f.air && onStage && c.dy > 60 && c.adx < 50; break;
        case 'up': ok = !f.air && c.dy < -80 && c.adx < 70 && f.x > M.x0 + 120 && f.x < M.x1 - 120; break;
        case 'punish': ok = c.adx < 200 && ady < 60 && (tgt.state === 'dizzy' || tgt.state === 'land' || tgt.state === 'helpless' || tgt.dmg > 110); break;
      }
      if (ok && Rng.next() < 0.7) return fire(slot);
    }
    return false;
  },
};

// ---- the fighters ----
const WAVE_ROCK = { speed: 8.5, r: 18, dmg: 7, ang: 70, bkb: 40, kbg: 44, life: 30 };
const ROSTER2 = [
  {
    id: 'giga', name: 'GIGA', title: 'Limit Breaker', blurb: 'Balanced and strong. Charged Moon Wave, vanish step.',
    w: 56, h: 80, walk: 6.6, air: 4.8, grav: 0.62, fall: 11, jump: 14.8, djump: 13.8, jumps: 1, weight: 100, power: 1.08, reach: 1.02,
    look: { kind: 'dog', fur: '#f4f6ff', belly: '#138f8a', ear: '#dfe6ff', dark: '#10202a', eye: 'fierce', acc: 'none' },
    ai2: [['nb', 'beam'], ['sb', 'dash'], ['db', 'zone'], ['ub', 'up']],
    specials: c => {
      const flurry = {
        total: 42, clip: 'jab', fx: 'rush', color: '#7ff0ff',
        hits: [H(1, 26, c.w * 0.5 + 14, -c.h * 0.5, 32, 1.4, 45, 14, 4, { rehit: 3, after: LINK }), fin(H(30, 33, c.w * 0.5 + 18, -c.h * 0.5, 36, 7, 40, 52, 92))],
        tick(f) { f.vx *= 0.6; if (f.air) f.vy = Math.min(f.vy, 0.8); },
      };
      return {
        nb: {
          total: 58, clip: 'cast', fx: 'kicharge', color: '#7ff0ff', charge: { at: 12, key: 'special', max: 90 }, aiHold: [10, 90],
          tick(f, t) {
            if (f.air) f.vy = Math.min(f.vy, 1);
            if (t === 16) {
              const k = f.move.charge / 90;
              MV2.say(f, 'MOON WAVE', 1.1 + k * 0.6); Sfx.tone(160, 900, 0.5, 'sawtooth', 0.12); Game.shake(3 + k * 6);
              MV2.spawn(f, { kind: 'kibeam', vx: 0, vy: 0, grav: 0, step: true, anchor: [c.w * 0.5 + 8, 0.55], len: 0, maxLen: 240 + 380 * k, grow: 70,
                r: 15 + 16 * k, dmg: 7 + 13 * k, ang: 28, bkb: 34 + 26 * k, kbg: 62 + 40 * k, life: 22 + 8 * k, pierce: true, noReflect: true, srcMove: f.move, color: '#7ff0ff' });
            }
          },
        },
        sb: Object.assign(linkTo(mkDash({ total: 34, a: 5, b: 18, speed: 16, hit: H(0, 0, c.w * 0.5, -c.h * 0.5, 26, 3, 50, 20, 10) }), flurry), { clip: 'flykick', fx: 'rush', color: '#7ff0ff' }),
        ub: mkTeleport({ at: 7, frames: 7, dist: 220 }),
        db: {
          total: 44, clip: 'cast', shout: 'KI STORM',
          tick(f, t) {
            if (f.air) f.vy = Math.min(f.vy, 1.2);
            if (t >= 8 && t <= 32 && (t - 8) % 4 === 0 && Game.projCount(f, 'ki') < 8)
              MV2.spawn(f, { kind: 'ki', vx: 15, vy: ((t - 8) / 4 % 3 - 1) * 1.1, grav: 0, r: 10, dmg: 2.5, ang: 30, bkb: 14, kbg: 12, life: 32, color: '#9ff4ff' }, c.w * 0.5 + 14, c.h * (0.45 + ((t - 8) / 4 % 2) * 0.15));
          },
        },
      };
    },
  },
  {
    id: 'ronin', name: 'RONIN', title: 'Future Blade', blurb: 'Sword reach. Energy volley, rising spin slash.',
    w: 56, h: 80, walk: 6.5, air: 4.8, grav: 0.64, fall: 11.5, jump: 14.8, djump: 13.6, jumps: 1, weight: 98, power: 1.04, reach: 1.2, blade: '#9fd8ff',
    look: { kind: 'dog', fur: '#20222c', belly: '#8a8e9a', ear: '#9fc8ff', dark: '#0c0e16', eye: 'fierce', acc: 'none' },
    ai2: [['nb', 'zone'], ['sb', 'dash'], ['db', 'close'], ['db', 'slam'], ['ub', 'up']],
    specials: c => ({
      nb: {
        total: 38, clip: 'cast', shout: 'VOLLEY',
        tick(f, t) {
          if (f.air) f.vy = Math.min(f.vy, 1.5);
          if ((t === 9 || t === 15 || t === 21) && Game.projCount(f, 'volley') < 6)
            MV2.spawn(f, { kind: 'volley', vx: 13, vy: 0, grav: 0, r: 12, dmg: 4, ang: 35, bkb: 18, kbg: 30, life: 44, color: '#ffd45c' }, c.w * 0.5 + 14, c.h * (t === 15 ? 0.66 : 0.5));
        },
      },
      sb: Object.assign(mkDash({ total: 40, a: 8, b: 18, speed: 14, hit: H(0, 0, c.w * 0.5 + 36, -c.h * 0.5, 34, 12, 36, 42, 86) }), { clip: 'punch', fx: 'slash', weapon: '#9fd8ff' }),
      ub: Object.assign(mkRise({ total: 46, at: 4, vy: -10.5, hold: 22, steer: 4, hits: [
        H(4, 26, 0, -c.h * 0.6, 46, 2.5, 88, 30, 14, { rehit: 5, radial: true }), fin(H(29, 32, 0, -c.h * 0.6, 50, 6, 62, 44, 96, { radial: true }))] }), { clip: 'spin', fx: 'spin', weapon: '#9fd8ff', color: '#9fd8ff' }),
      db: Object.assign(mkSlam({
        ground: { total: 40, clip: 'slam', fx: 'slash', weapon: '#9fd8ff', hits: [H(12, 16, c.w * 0.5 + 20, -12, 30, 11, 55, 40, 70)],
          tick(f, t) { if (t === 13) { const w = Object.assign({}, WAVE_ROCK, { color: '#9fd8ff', dmg: 6 }); MV2.wave(f, 1, w); MV2.wave(f, -1, w); Game.shock(f.x, f.y, '#9fd8ff'); } } },
        air: { drop: 18, clip: 'slam', hits: [H(6, 199, 0, 4, 28, 12, -80, 26, 80)],
          land: { total: 28, clip: 'slam', hits: [H(1, 5, 0, -12, 60, 8, 60, 50, 44, { radial: true })], start(f) { const w = Object.assign({}, WAVE_ROCK, { color: '#9fd8ff', dmg: 6 }); MV2.wave(f, 1, w); MV2.wave(f, -1, w); } } },
      }), { shout: 'SHATTER' }),
    }),
  },
  {
    id: 'tyrant', name: 'TYRANT', title: 'Space Emperor', blurb: 'Floaty. Finger laser, hover, Supernova.',
    w: 54, h: 80, walk: 6.0, air: 4.7, grav: 0.52, fall: 9.5, jump: 14.6, djump: 13.8, jumps: 1, weight: 94, power: 1.05, reach: 1.02,
    look: { kind: 'frog', fur: '#1c1a24', belly: '#d8a830', ear: '#b0202a', dark: '#08060c', eye: 'fierce', acc: 'none' },
    ai2: [['nb', 'zone'], ['db', 'beam'], ['sb', 'dash'], ['ub', 'up']],
    specials: c => ({
      nb: {
        total: 26, clip: 'punch',
        tick(f, t) {
          if (f.air) f.vy = Math.min(f.vy, 1.5);
          if (t === 7 && Game.projCount(f, 'finger') < 2) {
            MV2.spawn(f, { kind: 'finger', vx: 34, vy: 0, grav: 0, r: 7, dmg: 4, ang: 18, bkb: 14, kbg: 16, life: 30, pierce: true, color: '#ff3a6e' }, c.w * 0.5 + 16, c.h * 0.62);
            Sfx.tone(1700, 500, 0.08, 'sawtooth', 0.08);
          }
        },
      },
      sb: Object.assign(mkDash({ total: 38, a: 6, b: 18, speed: 13, hit: H(0, 0, c.w * 0.5 + 22, -c.h * 0.25, 32, 10, 30, 40, 80) }), { clip: 'kick', fx: 'tail' }),
      ub: mkHover({ total: 84, hits: [H(4, 10, 0, -c.h * 0.5, 36, 4, 80, 36, 40, { radial: true })] }),
      db: {
        total: 60, clip: 'cast', fx: 'novacharge', color: '#ff5a3a', charge: { at: 12, key: 'special', max: 80 }, aiHold: [20, 80],
        tick(f, t) {
          if (f.air) f.vy = Math.min(f.vy, 1);
          if (t === 18) {
            const k = f.move.charge / 80;
            MV2.say(f, 'SUPERNOVA', 1.1 + k * 0.5); Game.shake(4 + k * 6); Sfx.tone(90, 40, 0.6, 'sawtooth', 0.16);
            MV2.spawn(f, { kind: 'supernova', vx: 2.8, vy: 0.45, grav: 0, step: true, big: true, r: 26 + 24 * k, dmg: 12 + 12 * k, ang: 45, bkb: 40 + 20 * k, kbg: 76 + 24 * k, life: 150, color: '#ff5a3a', after: NOVA_BOOM }, c.w * 0.3, c.h * 1.3);
          }
        },
      },
    }),
  },
  {
    id: 'gwei', name: 'WRENCH', title: 'Pipe Hero', blurb: 'All-rounder. Bouncing fireball, wrench spin, coin uppercut.',
    w: 54, h: 74, walk: 6.3, air: 4.7, grav: 0.64, fall: 11, jump: 15, djump: 13.8, jumps: 1, weight: 98, power: 1.0, reach: 1.0,
    look: { kind: 'dog', fur: '#f0c090', belly: '#1fa8a0', ear: '#ff8a1a', dark: '#2a1206', eye: 'dot', acc: 'none' },
    ai2: [['nb', 'zone'], ['sb', 'reflect'], ['sb', 'close'], ['ub', 'up'], ['db', 'slam'], ['db', 'close']],
    specials: c => ({
      nb: Object.assign(mkProj({ max: 2, total: 30, at: 10, proj: { kind: 'fireball', vx: 7.5, vy: 1.5, grav: 0.42, r: 12, dmg: 5, ang: 40, bkb: 22, kbg: 30, life: 90, bounce: 7.2, step: true, color: '#ff8a1a' } }), { clip: 'cast' }),
      sb: {
        total: 38, clip: 'spin', fx: 'wrench', reflect: [6, 20], hits: [H(6, 14, c.w * 0.5 + 16, -c.h * 0.5, 32, 6, 50, 30, 22, { after: FLIP })],
        tick(f, t) { if (f.air) { if (t === 6 && !f.airOnce.stall) { f.airOnce.stall = true; f.vy = -4; } f.vy = Math.min(f.vy, 2); } },
      },
      ub: {
        total: 46, helpless: true, airOnce: 'up', clip: 'uppercut', fx: 'coins', shout: 'COIN UP',
        hits: [H(3, 5, c.w * 0.35, -c.h * 0.5, 28, 1.5, 88, 30, 8, { rehit: 3, after: LINK }), H(7, 9, c.w * 0.3, -c.h * 0.7, 28, 1.5, 88, 30, 8, { rehit: 3, after: LINK }),
          H(11, 13, c.w * 0.25, -c.h * 0.85, 28, 1.5, 88, 30, 8, { rehit: 3, after: LINK }), fin(H(15, 18, c.w * 0.2, -c.h, 32, 5, 80, 52, 80))],
        tick(f, t) {
          if (t === 3) { f.vy = -16.5; f.vx = f.dirX() * 2.5; }
          if (t > 3) f.vx = approach(f.vx, f.dirX() * 3, 0.3);
          if (t >= 3 && t < 18) Game.trail(f);
          if (t === 3 || t === 7 || t === 11 || t === 15) { Sfx.coin(); Game.burst(f.x + f.face * c.w * 0.3, f.y - c.h * 0.8, '#ffd23f', 6); }
        },
      },
      db: mkSlam({
        ground: { total: 40, clip: 'slam', hits: [H(12, 16, c.w * 0.5 + 26, -12, 32, 12, 70, 42, 70), H(12, 16, -c.w * 0.5 - 26, -12, 32, 12, 70, 42, 70)] },
        air: { drop: 16, clip: 'slam', hits: [H(6, 199, 0, 4, 28, 11, -80, 24, 76)], land: { total: 24, clip: 'slam', hits: [H(1, 4, 0, -10, 60, 6, 60, 44, 36, { radial: true })] } },
      }),
    }),
  },
  {
    id: 'shroom', name: 'SHROOM', title: 'Spore Kid', blurb: 'Light. Poison spores, headbutt, cap parachute.',
    w: 50, h: 66, walk: 6.4, air: 4.9, grav: 0.58, fall: 10.5, jump: 15, djump: 13.6, jumps: 1, weight: 84, power: 0.95, reach: 0.95,
    look: { kind: 'bird', fur: '#8a4ad8', belly: '#fff4e0', ear: '#ffd23f', dark: '#2a1040', eye: 'dot', acc: 'none' },
    ai2: [['nb', 'trap'], ['db', 'close'], ['sb', 'dash'], ['ub', 'up']],
    specials: c => ({
      nb: Object.assign(mkProj({ max: 2, total: 34, at: 12, proj: { kind: 'spore', vx: 3.2, vy: -0.6, grav: 0, r: 30, rgrow: 0.12, dmg: 1.5, ang: 70, bkb: 12, kbg: 4, life: 110, pierce: true, rehit: 12, drag: 0.955, step: true, color: '#b86cff' } }), { clip: 'cast' }),
      sb: Object.assign(mkDash({ total: 36, a: 6, b: 18, speed: 13, hit: H(0, 0, c.w * 0.5, -c.h * 0.6, 26, 10, 42, 36, 72) }), { clip: 'flykick' }),
      ub: Object.assign(mkRise({ total: 170, at: 5, vy: -16, glide: 22, hits: [H(5, 14, 0, -c.h * 0.6, 30, 6, 85, 36, 50, { radial: true })] }), { clip: 'jump', fx: 'cap', color: '#b86cff' }),
      db: {
        total: 42, clip: 'spin', fx: 'spin', color: '#c890ff', shout: 'SPORE BURST',
        hits: [H(6, 24, 0, -c.h * 0.5, 56, 2, 60, 20, 8, { rehit: 6, radial: true }), fin(H(28, 31, 0, -c.h * 0.5, 60, 5, 55, 40, 70, { radial: true }))],
        tick(f, t) { if (f.air) f.vy = Math.min(f.vy, 1.5); if (t % 4 === 0 && t >= 6 && t <= 30) Game.burst(f.x, f.y - c.h * 0.5, '#c890ff', 3); },
      },
    }),
  },
  {
    id: 'kaiju', name: 'KAIJU', title: 'Shell King', blurb: 'Heaviest. Fire breath, flying slam, shell spin.',
    w: 72, h: 90, walk: 5.0, air: 4.0, grav: 0.72, fall: 12.5, jump: 13.8, djump: 12.4, jumps: 1, weight: 128, power: 1.2, reach: 1.15,
    look: { kind: 'frog', fur: '#4a6a9a', belly: '#f0e6c8', ear: '#ff7a1a', dark: '#141c2a', eye: 'fierce', acc: 'none' },
    ai2: [['sb', 'grab'], ['nb', 'close'], ['ub', 'close'], ['db', 'slam']],
    specials: c => {
      const slamLand = { total: 26, clip: 'slam', hits: [H(1, 4, 0, -12, 70, 7, 60, 50, 40, { radial: true })] };
      const slamHold = {
        total: 92, holdVictim: true, clip: 'jump', sfx: 'none', shout: 'FLYING SLAM',
        tick(f, t) {
          MV2.hold(f, c.w * 0.5, -c.h * 0.35);
          if (t === 1) f.vy = -12.5;
          if (t <= 18) f.vx = f.face * 3.4; else { f.vx *= 0.9; f.vy = Math.max(f.vy, 17); }
          if (t === 90) MV2.throwV(f, { dmg: 9, ang: 45, bkb: 40, kbg: 60 });
        },
        onLand(f) {
          const v = f.grabbed; if (v) v.x = f.x + f.face * c.w * 0.5;
          MV2.throwV(f, { dmg: 17, ang: 75, bkb: 60, kbg: 72, ground: true });
          Game.shake(14); Game.shock(f.x, f.y, '#ff8a2a'); Sfx.hit(0.9); f.startMove(slamLand);
        },
      };
      const bombLand = { total: 30, clip: 'slam', hits: [H(1, 5, 0, -12, 82, 10, 62, 52, 50, { radial: true })],
        start(f) { const w = Object.assign({}, WAVE_ROCK, { color: '#ff8a2a' }); MV2.wave(f, 1, w); MV2.wave(f, -1, w); } };
      const bomb = hop => ({
        total: 200, clip: 'slam', fx: 'shell', color: '#ff7a1a', sfx: 'none',
        hits: [H(4, 14, c.w * 0.5, -c.h * 0.5, 34, 9, 80, 40, 40), H(18, 199, 0, 6, 38, 15, -80, 28, 84, { rehit: 12 })],
        tick(f, t) { if (t === 2) f.vy = -hop; if (t < 16) f.vx *= 0.9; else { f.vy = 19; f.vx *= 0.8; } },
        onLand(f) { Game.shake(12); Sfx.hit(0.8); Game.shock(f.x, f.y, '#ff8a2a'); f.startMove(bombLand); },
      });
      return {
        nb: mkStream({ fire(f, fuel) {
          MV2.spawn(f, { kind: 'flame', vx: 6 + 6 * fuel, vy: -0.3, grav: -0.03, drag: 0.97, step: true, r: 14 + 6 * fuel, rgrow: 0.5, dmg: 1.2, ang: 30, bkb: 22, kbg: 4, life: 9 + 10 * fuel, color: '#ff7a1a' }, c.w * 0.5 + 6, c.h * 0.7);
        } }),
        sb: mkCgrab({ total: 36, a: 8, b: 14, x: c.w * 0.5 + 10, y: -c.h * 0.5, r: 34, lunge: 7, hold: slamHold, airOnce: 'side' }),
        ub: {
          total: 62, helpless: true, airOnce: 'up', clip: 'spin', fx: 'shell', color: '#ff7a1a',
          hits: [H(4, 46, 0, -c.h * 0.45, 52, 2, 60, 26, 10, { rehit: 5, radial: true }), fin(H(50, 53, 0, -c.h * 0.45, 56, 6, 50, 44, 82, { radial: true }))],
          tick(f, t) {
            const dx = f.dirX();
            if (!f.move.air) { if (t >= 4 && t <= 50) { f.vx = approach(f.vx, (dx || f.face) * 7.5, 1); if (dx) f.face = dx; } }
            else { if (t >= 4 && t <= 32) f.vy = -7.2; f.vx = approach(f.vx, dx * 4.5, 0.5); }
          },
        },
        db: Object.assign(split2(bomb(13), bomb(7)), { shout: 'SHELL BOMB' }),
      };
    },
  },
  {
    id: 'mochi', name: 'MOCHI', title: 'Puffball', blurb: 'Five air jumps. Inhale, mallet, stone drop.',
    w: 54, h: 58, walk: 5.6, air: 4.3, grav: 0.5, fall: 9, jump: 13.2, djump: 9.6, jumps: 5, weight: 78, power: 0.96, reach: 0.92,
    look: { kind: 'bird', fur: '#9ee8c8', belly: '#fff6e6', ear: '#ff9ab8', dark: '#1e4a3a', eye: 'dot', acc: 'none' },
    ai2: [['nb', 'inhale'], ['sb', 'close'], ['db', 'stone'], ['ub', 'up']],
    specials: c => {
      const full = {
        total: 40, holdVictim: true, swallow: true, clip: 'guard', sfx: 'none',
        tick(f, t) {
          MV2.hold(f, 0, 0);
          if (f.air) f.vy = Math.min(f.vy, 2.5);
          if (t === 22) {
            const v = f.grabbed;
            if (v) {
              v.x = f.x + f.face * (c.w * 0.5 + v.w * 0.45); v.y = f.y - 4;
              MV2.throwV(f, { dmg: 9, ang: 16, bkb: 62, kbg: 36 });
              const s = MV2.spawn(f, { kind: 'star', vx: 15, vy: 0, grav: 0, r: 22, dmg: 8, ang: 35, bkb: 40, kbg: 60, life: 30, pierce: true, color: '#ffe066' });
              s.hitSet = new Set([v]);
            }
            MV2.say(f, 'PTOO'); Sfx.tone(700, 200, 0.12, 'square', 0.12);
          }
        },
      };
      const stoneLand = { total: 34, armor: 999, clip: 'guard', fx: 'stone', hits: [H(1, 4, 0, -12, 50, 6, 60, 44, 40, { radial: true })] };
      const stoneAir = {
        total: 200, armor: 999, clip: 'guard', fx: 'stone', sfx: 'none', hits: [H(8, 199, 0, 4, 30, 14, -80, 26, 80)],
        tick(f, t) { if (t < 8) { f.vy = Math.min(f.vy, -1); f.vx *= 0.6; } else { f.vy = 20; f.vx *= 0.85; } if (t > 24 && f.pressed('special')) f.endMove(); },
        onLand(f) { Game.shake(10); Sfx.hit(0.8); Game.shock(f.x, f.y, '#b8b8c0'); f.startMove(stoneLand); },
      };
      const stoneGround = {
        total: 70, armor: 999, clip: 'guard', fx: 'stone', hits: [H(4, 7, 0, -c.h * 0.3, 40, 6, 60, 30, 40, { radial: true })],
        tick(f, t) { f.vx *= 0.5; if (t > 24 && f.pressed('special')) f.endMove(); },
      };
      return {
        nb: {
          total: 62, clip: 'cast', fx: 'inhale', aiHold: [16, 44], sfx: 'none',
          tick(f, t) {
            if (f.air) f.vy = Math.min(f.vy, 1.4);
            if (t < 8 || t > 50) return;
            if (t > 22 && !f.in.special) { f.move.t = 50; return; }
            for (const g of Game.fighters) {
              if (g === f || g.untouchable || g.hitlag > 0 || !MV2.PULLABLE.includes(g.state) || g.grabbed) continue;
              const ahead = (g.x - f.x) * f.face, dy = (g.y - g.h * 0.5) - (f.y - c.h * 0.5);
              if (ahead < -8 || ahead > 190 || Math.abs(dy) > 70) continue;
              if (ahead < c.w * 0.5 + g.w * 0.4 + 6) { if (MV2.catch(f, g)) return f.startMove(full); continue; }
              g.x -= f.face * (1.8 + (190 - ahead) * 0.018);   // sideways only: the next physics step still collides it
            }
          },
        },
        sb: split2(
          { total: 50, clip: 'kick', fx: 'mallet', charge: { at: 10, key: 'special', max: 60, mult: 1.2 }, aiHold: [0, 40], hits: [H(16, 20, c.w * 0.5 + 34, -c.h * 0.5, 38, 15, 38, 44, 96)] },
          { total: 48, clip: 'spin', fx: 'mallet', airOnce: 'side', hits: [H(6, 30, 0, -c.h * 0.5, 48, 2.5, 60, 24, 10, { rehit: 6, radial: true }), fin(H(34, 37, 0, -c.h * 0.5, 50, 6, 45, 40, 86, { radial: true }))],
            tick(f) { f.vy = Math.min(f.vy, 1.2); } }),
        ub: {
          total: 200, helpless: true, airOnce: 'up', clip: 'uppercut', fx: 'cutter', color: '#ffe066',
          hits: [H(4, 16, c.w * 0.4, -c.h * 0.6, 30, 6, 85, 30, 30, { after: LINK }), H(24, 199, c.w * 0.3, -c.h * 0.2, 28, 5, -70, 20, 40, { rehit: 8 })],
          tick(f, t) {
            if (t === 4) f.vy = -15;
            if (t < 18) f.vx = f.dirX() * 2.5;
            if (t >= 18 && t < 22) { f.vy = 0; f.noGrav = true; }
            if (t >= 22) { f.vy = 17; f.vx *= 0.9; }
          },
          onLand(f) {
            MV2.wave(f, f.face, { speed: 9, r: 16, dmg: 6, ang: 60, bkb: 36, kbg: 40, life: 28, color: '#ffe066' }); Game.shake(5);
            f.startMove({ total: 18, clip: 'slam', hits: [H(1, 4, c.w * 0.5, -12, 32, 5, 50, 40, 50)] });
          },
        },
        db: Object.assign(split2(stoneGround, stoneAir), { shout: 'STONE' }),
      };
    },
  },
  {
    id: 'omen', name: 'OMEN', title: 'Psi Clone', blurb: 'Tall and floaty. Shadow orb, teleport, disable.',
    w: 58, h: 92, walk: 6.2, air: 4.8, grav: 0.5, fall: 9.5, jump: 15, djump: 14, jumps: 1, weight: 88, power: 1.05, reach: 1.1,
    look: { kind: 'frog', fur: '#1c2a5a', belly: '#3fd8ff', ear: '#2a3a7a', dark: '#060a1c', eye: 'fierce', acc: 'none' },
    ai2: [['nb', 'beam'], ['sb', 'reflect'], ['db', 'trap'], ['sb', 'close'], ['ub', 'up']],
    specials: c => ({
      nb: {
        total: 44, clip: 'cast', fx: 'orbcharge', color: '#9a6cff', charge: { at: 10, key: 'special', max: 100 }, aiHold: [20, 100],
        tick(f, t) {
          if (f.air) f.vy = Math.min(f.vy, 1);
          if (t === 16) {
            const k = f.move.charge / 100;
            if (k > 0.8) MV2.say(f, 'SHADOW ORB', 1.3);
            MV2.spawn(f, { kind: 'shadow', vx: 8 + 4 * k, vy: 0, grav: 0, r: 12 + 18 * k, dmg: 4 + 19 * k, ang: 40, bkb: 22 + 38 * k, kbg: 40 + 50 * k, life: 70, color: '#9a6cff' });
            Sfx.tone(400, 120, 0.25, 'sawtooth', 0.1);
          }
        },
      },
      sb: {
        total: 40, clip: 'cast', fx: 'confuse', color: '#4ff0ff', reflect: [5, 18], hits: [H(6, 14, c.w * 0.5 + 18, -c.h * 0.5, 34, 5, 60, 30, 18, { after: FLIP })],
        tick(f, t) { if (f.air) { if (t === 5 && !f.airOnce.stall) { f.airOnce.stall = true; f.vy = -3; } f.vy = Math.min(f.vy, 1.5); } },
      },
      ub: mkTeleport({ at: 8, frames: 8, dist: 240 }),
      db: { total: 40, clip: 'cast', fx: 'disable', color: '#c9a6ff', hits: [H(10, 14, c.w * 0.5 + 30, -c.h * 0.72, 30, 0, 0, 0, 0, { pre: DISABLE })] },
    }),
  },
  {
    id: 'wisp', name: 'WISP', title: 'Psi Sprite', blurb: 'Tiny, three air jumps. Bubble, blink, barrier.',
    w: 44, h: 52, walk: 6.4, air: 5.0, grav: 0.42, fall: 8.5, jump: 14.2, djump: 11.5, jumps: 3, weight: 76, power: 0.94, reach: 0.92,
    look: { kind: 'dog', fur: '#e8d0ff', belly: '#fff4ff', ear: '#c8a0ff', dark: '#4a2a6a', eye: 'dot', acc: 'none' },
    ai2: [['nb', 'zone'], ['db', 'reflect'], ['db', 'counter'], ['sb', 'dash'], ['ub', 'up']],
    specials: c => ({
      nb: Object.assign(mkProj({ max: 2, total: 34, at: 12, proj: { kind: 'bubble', vx: 4.5, vy: -0.4, grav: 0, r: 22, dmg: 9, ang: 50, bkb: 36, kbg: 60, life: 110, color: '#ff9ae8' } }), { clip: 'cast' }),
      sb: Object.assign(mkDash({ total: 34, a: 5, b: 17, speed: 14, lift: 4, air: { lift: 2 }, hit: H(0, 0, c.w * 0.5, -c.h * 0.5, 24, 8, 42, 36, 64) }), { clip: 'flykick' }),
      ub: mkTeleport({ at: 6, frames: 7, dist: 220 }),
      db: {
        total: 44, clip: 'block', fx: 'barrier', color: '#ff9ae8', counter: [4, 28], reflect: [4, 28], sfx: 'shield',
        counterHit: { mult: 1.2, min: 7, ang: 45, bkb: 50, kbg: 70, shout: 'BARRIER', def: { total: 20, clip: 'cast' } },
        tick(f) { if (f.air) f.vy = Math.min(f.vy, 1); },
      },
    }),
  },
  {
    id: 'spark', name: 'SPARK', title: 'Volt Critter', blurb: 'Light and fast. Wall-running jolt, zig-zag dash.',
    w: 50, h: 58, walk: 7.2, air: 5.0, grav: 0.66, fall: 11.5, jump: 15, djump: 13.4, jumps: 1, weight: 82, power: 0.96, reach: 0.95,
    look: { kind: 'dog', fur: '#ffd23f', belly: '#fff3c8', ear: '#e0a820', dark: '#4a3000', eye: 'dot', acc: 'none' },
    ai2: [['nb', 'zone'], ['db', 'trap'], ['sb', 'dash'], ['ub', 'up']],
    specials: c => ({
      nb: Object.assign(mkProj({ max: 2, total: 30, at: 10, proj: { kind: 'jolt', vx: 7.5, vy: 1, grav: 0.5, r: 12, dmg: 5, ang: 50, bkb: 20, kbg: 28, life: 110, crawl: true, wrap: true, speed: 7.5, step: true, color: '#ffe84a' } }), { clip: 'cast' }),
      sb: {
        total: 52, clip: 'flykick', fx: 'bash', color: '#ffe84a', airOnce: 'side', charge: { at: 8, key: 'special', max: 60, mult: 0.9 }, aiHold: [0, 36],
        hits: [H(12, 26, c.w * 0.5, -c.h * 0.45, 26, 8, 38, 32, 62)],
        tick(f, t) {
          const k = f.move.charge / 60;
          if (t < 12) { f.vx *= 0.8; if (f.air) f.vy = Math.min(f.vy, 1); }
          else if (t <= 26) { f.vx = f.face * (11 + 9 * k); f.vy = f.air ? Math.min(f.vy, 1) : 0; }
          else f.vx *= 0.85;
        },
      },
      ub: mkZip({ hits: [H(4, 24, 0, -c.h * 0.5, 26, 4, 70, 30, 34)] }),
      db: {
        total: 50, clip: 'cast', fx: 'thunder', color: '#ffe84a', shout: 'THUNDERCLAP', hits: [H(20, 26, 0, -c.h * 0.5, 72, 13, 72, 44, 86, { radial: true })],
        tick(f, t) {
          if (f.air) f.vy = Math.min(f.vy, 1.5);
          if (t === 6) MV2.spawn(f, { kind: 'bolt', vx: 0, vy: 34, grav: 0, step: true, track: true, srcMove: f.move, r: 22, dmg: 8, ang: -80, bkb: 36, kbg: 50, life: 22, pierce: true, noReflect: true, color: '#ffe84a' }, 0, 470);
          if (t === 20) { Game.burst(f.x, f.y - c.h * 0.5, '#ffe84a', 18); Game.shake(6); Sfx.hit(0.7); }
        },
      },
    }),
  },
  {
    id: 'turbo', name: 'TURBO', title: 'Grand Prix', blurb: 'Fastest runner. Blaze Punch, dive grab, flame kick.',
    w: 58, h: 84, walk: 7.9, air: 5.0, grav: 0.74, fall: 13, jump: 15, djump: 13.6, jumps: 1, weight: 106, power: 1.1, reach: 1.02,
    look: { kind: 'dog', fur: '#c8ccd8', belly: '#1a1a20', ear: '#d8a830', dark: '#101018', eye: 'fierce', acc: 'scarf' },
    ai2: [['nb', 'punish'], ['sb', 'dash'], ['db', 'dash'], ['ub', 'up']],
    specials: c => {
      const diveHold = {
        total: 34, holdVictim: true, clip: 'punch', sfx: 'none',
        tick(f, t) {
          if (t < 12) { f.noGrav = true; f.vx = 0; f.vy = 0; MV2.hold(f, c.w * 0.55, -c.h * 0.1); }
          if (t === 12) {
            MV2.throwV(f, { dmg: 12, ang: 55, bkb: 56, kbg: 74 });
            Game.burst(f.x + f.face * c.w * 0.6, f.y - c.h * 0.5, '#ff9a2a', 20); Game.shake(10); Sfx.hit(0.8);
            f.vy = -10; f.vx = -f.face * 3; MV2.say(f, 'GOTCHA');
          }
        },
      };
      return {
        nb: {
          total: 80, clip: 'punch', fx: 'firebird', color: '#ff9a2a', shout: 'BLAZE',
          hits: [H(48, 52, c.w * 0.5 + 30, -c.h * 0.55, 38, 25, 30, 44, 110)],
          tick(f, t) {
            if (t <= 12 && !f.move.turned && f.dirX() === -f.face) { f.face = -f.face; f.move.turned = true; }
            if (f.air) f.vy = Math.min(f.vy, t < 48 ? 1.2 : 3);
            if (t === 46) f.vx = f.face * 6;
            if (t === 48) { MV2.say(f, 'PUNCH!', 1.6); Game.burst(f.x + f.face * (c.w * 0.5 + 40), f.y - c.h * 0.55, '#ff9a2a', 14); Sfx.tone(120, 60, 0.3, 'sawtooth', 0.14); }
          },
        },
        sb: split2(
          { total: 44, clip: 'uppercut', fx: 'flamefist', color: '#ff9a2a', airOnce: 'side', hits: [H(10, 22, c.w * 0.5 + 6, -c.h * 0.5, 30, 9, 86, 52, 44)],
            tick(f, t) { if (t >= 6 && t <= 22) f.vx = f.face * 14; else f.vx *= 0.8; } },
          { total: 44, clip: 'flykick', fx: 'flamefist', color: '#ff9a2a', airOnce: 'side', hits: [H(10, 22, c.w * 0.5 + 6, -c.h * 0.5, 30, 9, -60, 30, 60)],
            tick(f, t) { if (t >= 6 && t <= 22) { f.vx = f.face * 12; f.vy = Math.min(f.vy, 1); } else f.vx *= 0.9; } }),
        ub: {
          total: 64, helpless: true, airOnce: 'up', clip: 'uppercut', fx: 'dive', color: '#ff9a2a', hits: [H(8, 34, c.w * 0.4, -c.h * 0.6, 34, 0, 0, 0, 0, { cgrab: diveHold })],
          tick(f, t) {
            if (t < 8) { f.vx *= 0.7; f.vy = Math.min(f.vy, 1); return; }
            if (t === 8) f.vy = -15.5;
            f.vx = approach(f.vx, f.dirX() * 3.2 + f.face * 1.5, 0.4);
          },
        },
        db: split2(
          { total: 46, clip: 'kick', fx: 'flamekick', color: '#ff9a2a', shout: 'BLAZE KICK', hits: [H(8, 26, c.w * 0.5 + 10, -14, 30, 12, 35, 44, 82)],
            tick(f, t) { if (t >= 8 && t <= 26) f.vx = f.face * 15; else f.vx *= 0.8; } },
          { total: 44, clip: 'flykick', fx: 'flamekick', color: '#ff9a2a', hits: [H(8, 40, c.w * 0.5, 0, 30, 11, 40, 40, 76)],
            tick(f, t) { if (t < 8) { f.vx *= 0.8; f.vy = Math.min(f.vy, 0); } else if (t <= 40) { f.vx = f.face * 11; f.vy = 11; } },
            onLand(f) { Game.puff(f.x, f.y, 8, '#ffb347'); f.startMove({ total: 16, clip: 'guard' }); } }),
      };
    },
  },
  {
    id: 'chop', name: 'CHOP', title: 'Kung Fu Legend', blurb: 'Fast and light. Nunchaku flurry, dragon kick.',
    w: 52, h: 78, walk: 7.0, air: 5.0, grav: 0.66, fall: 11.5, jump: 15.4, djump: 14, jumps: 1, weight: 90, power: 1.0, reach: 1.0,
    look: { kind: 'dog', fur: '#e8b890', belly: '#1a1a1a', ear: '#141010', dark: '#2a1208', eye: 'fierce', acc: 'bandana' },
    ai2: [['nb', 'close'], ['sb', 'dash'], ['db', 'close'], ['ub', 'up']],
    specials: c => ({
      nb: {
        total: 40, clip: 'jab', fx: 'nunchaku', shout: 'WATAA', weapon: '#ffd23f',
        hits: [H(6, 26, c.w * 0.5 + 22, -c.h * 0.55, 32, 1.6, 45, 16, 5, { rehit: 4, after: LINK }), fin(H(30, 33, c.w * 0.5 + 26, -c.h * 0.55, 34, 6, 40, 46, 86))],
        tick(f) { if (f.air) f.vy = Math.min(f.vy, 1.5); },
      },
      sb: Object.assign(mkDash({ total: 40, a: 6, b: 20, speed: 15, lift: 5, air: { lift: 3 }, hit: H(0, 0, c.w * 0.5 + 8, -c.h * 0.45, 28, 12, 38, 42, 84) }), { clip: 'flykick', fx: 'dragon', color: '#ff3a3a' }),
      ub: {
        total: 44, helpless: true, airOnce: 'up', clip: 'flykick', hits: [H(4, 16, c.w * 0.1, -c.h * 0.85, 38, 10, 88, 44, 72, { radial: true })],
        tick(f, t) { if (t === 4) { f.vy = -17; f.vx = -f.face * 2.5; } if (t > 4) f.vx = approach(f.vx, f.dirX() * 3.5, 0.3); if (t >= 4 && t < 18) Game.trail(f); },
      },
      db: { total: 30, clip: 'sweep', hits: [H(6, 10, c.w * 0.5 + 24, -8, 30, 6, 0, 26, 14, { after: TRIP(40) }), H(12, 16, -c.w * 0.5 - 24, -8, 30, 6, 0, 26, 14, { after: TRIP(40), rehit: 6 })] },
    }),
  },
  {
    id: 'ginga', name: 'GINGA', title: 'Roda Master', blurb: 'Tricky. Handstand spins, helicopter kicks.',
    w: 54, h: 80, walk: 6.6, air: 4.9, grav: 0.62, fall: 11, jump: 15, djump: 13.8, jumps: 1, weight: 96, power: 1.0, reach: 1.08,
    look: { kind: 'dog', fur: '#8a5a3a', belly: '#1fa87a', ear: '#2a1a10', dark: '#1a0e06', eye: 'happy', acc: 'none' },
    ai2: [['nb', 'close'], ['sb', 'dash'], ['db', 'close'], ['ub', 'up']],
    specials: c => ({
      nb: {
        total: 46, clip: 'spin', fx: 'spin', color: '#3ff0b0', shout: 'GINGA',
        hits: [H(8, 30, 0, -c.h * 0.35, 58, 2.2, 55, 20, 8, { rehit: 5, radial: true }), fin(H(34, 37, 0, -c.h * 0.35, 62, 6, 42, 44, 82, { radial: true }))],
        tick(f) { f.vx = approach(f.vx, f.dirX() * 2.5, 0.4); if (f.air) f.vy = Math.min(f.vy, 1.5); },
      },
      sb: {
        total: 42, airOnce: 'side', clip: 'spin',
        hits: [H(6, 22, c.w * 0.4, -c.h * 0.7, 30, 3, 60, 22, 12, { rehit: 6, after: LINK }), fin(H(26, 29, c.w * 0.5, -c.h * 0.6, 32, 7, 45, 40, 78))],
        tick(f, t) { if (t >= 6 && t <= 26) { f.vx = f.face * 10; if (f.air) f.vy = Math.min(f.vy, 1); } else f.vx *= 0.8; },
      },
      ub: Object.assign(mkRise({ total: 52, at: 4, vy: -9.5, hold: 30, steer: 4, hits: [
        H(4, 34, 0, -c.h * 0.5, 46, 2, 88, 30, 14, { rehit: 5, radial: true }), fin(H(38, 41, 0, -c.h * 0.5, 48, 6, 62, 44, 96, { radial: true }))] }), { clip: 'spin', fx: 'spin', color: '#3ff0b0' }),
      db: { total: 32, clip: 'sweep', hits: [H(8, 13, 0, -8, 64, 9, 38, 36, 70, { radial: true })] },
    }),
  },
  {
    id: 'sifu', name: 'SIFU', title: 'Five Animals', blurb: 'Snake jabs, tiger pounce, crane kick, drunken roll.',
    w: 54, h: 78, walk: 6.8, air: 4.9, grav: 0.64, fall: 11.5, jump: 15, djump: 13.8, jumps: 1, weight: 94, power: 0.98, reach: 1.0,
    look: { kind: 'dog', fur: '#e8c098', belly: '#c01a2a', ear: '#141010', dark: '#2a1208', eye: 'happy', acc: 'none' },
    ai2: [['nb', 'close'], ['sb', 'dash'], ['db', 'counter'], ['ub', 'up']],
    specials: c => ({
      nb: {
        total: 34, clip: 'jab', fx: 'snake',
        hits: [H(4, 22, c.w * 0.5 + 18, -c.h * 0.6, 22, 1.5, 40, 16, 5, { rehit: 3, after: LINK }), fin(H(26, 28, c.w * 0.5 + 22, -c.h * 0.6, 26, 5, 38, 40, 76))],
        tick(f) { if (f.air) f.vy = Math.min(f.vy, 1.5); },
      },
      sb: Object.assign(mkDash({ total: 42, a: 6, b: 24, speed: 12, lift: 8, air: { lift: 3 }, hit: H(0, 0, c.w * 0.5, -c.h * 0.5, 30, 11, 40, 40, 80) }), { clip: 'flykick', fx: 'tiger', color: '#ffb347' }),
      ub: Object.assign(mkRise({ at: 5, vy: -17, hits: [H(5, 16, c.w * 0.35, -c.h * 0.8, 32, 10, 80, 44, 72)] }), { clip: 'kick' }),
      db: {
        total: 64, clip: 'spin', fx: 'stance', color: '#ffd23f', counter: [22, 50],
        counterHit: { mult: 1.4, min: 9, ang: 60, bkb: 50, kbg: 88, shout: 'DRUNKEN FIST', def: { total: 22, clip: 'kick' } },
        tick(f, t) { if (t >= 2 && t <= 18) { f.vx = f.face * 8.5; if (t >= 4 && t <= 14) f.intang = true; } else f.vx *= 0.7; if (f.air) f.vy = Math.min(f.vy, 2); },
      },
    }),
  },
  {
    id: 'fro', name: 'FRO', title: 'Number Two', blurb: 'Sword reach. Quick-draw counter, dash-through slash.',
    w: 54, h: 84, walk: 6.6, air: 4.8, grav: 0.64, fall: 11.5, jump: 14.8, djump: 13.6, jumps: 1, weight: 92, power: 1.04, reach: 1.22, blade: '#e8f4ff',
    look: { kind: 'dog', fur: '#7a5238', belly: '#2a2a30', ear: '#0c0a0a', dark: '#100a06', eye: 'fierce', acc: 'none' },
    ai2: [['nb', 'counter'], ['sb', 'dash'], ['nb', 'close'], ['db', 'slam'], ['ub', 'up']],
    specials: c => ({
      nb: {
        total: 50, clip: 'block', fx: 'iaido', weapon: '#e8f4ff', counter: [4, 28],
        counterHit: { mult: 1.6, min: 12, ang: 36, bkb: 60, kbg: 94, shout: 'IAI', def: { total: 22, clip: 'kick', fx: 'iai', weapon: '#e8f4ff' } },
        hits: [H(32, 35, c.w * 0.5 + 62, -c.h * 0.5, 40, 11, 35, 44, 84)],
        tick(f) { if (f.air) f.vy = Math.min(f.vy, 1.5); },
      },
      sb: withTick(Object.assign(mkDash({ total: 40, a: 8, b: 20, speed: 18, hit: H(0, 0, 0, -c.h * 0.5, 36, 12, 40, 44, 82) }), { clip: 'punch', fx: 'slash', weapon: '#e8f4ff' }),
        (f, t) => { if (t >= 8 && t <= 20) f.intang = true; }),
      ub: Object.assign(mkRise({ total: 44, at: 4, vy: -11, hold: 18, steer: 4, hits: [
        H(4, 22, 0, -c.h * 0.6, 46, 2.5, 88, 30, 14, { rehit: 5, radial: true }), fin(H(25, 28, 0, -c.h * 0.6, 50, 6, 62, 44, 94, { radial: true }))] }), { clip: 'spin', fx: 'spin', weapon: '#e8f4ff', color: '#e8f4ff' }),
      db: mkSlam({
        ground: { total: 36, clip: 'slam', fx: 'slash', weapon: '#e8f4ff', hits: [H(10, 14, c.w * 0.5 + 30, -10, 30, 12, 80, 44, 76)] },
        air: { drop: 19, clip: 'slam', hits: [H(6, 199, 0, 8, 26, 12, -85, 26, 80)], land: { total: 24, clip: 'slam', hits: [H(1, 4, 0, -10, 50, 6, 60, 44, 36, { radial: true })] } },
      }),
    }),
  },
  {
    id: 'bling', name: 'OG BOBBY', title: 'Platinum Flow', blurb: 'Sidearm, money-cannon jump, mic drop.',   // 9/20: renamed from BLING; the id stays for the model/voice files
    w: 58, h: 82, walk: 6.3, air: 4.7, grav: 0.64, fall: 11.5, jump: 14.6, djump: 13.4, jumps: 1, weight: 100, power: 1.0, reach: 1.0,
    look: { kind: 'dog', fur: '#7a5238', belly: '#7a3ad8', ear: '#141018', dark: '#140a06', eye: 'side', acc: 'none' },
    ai2: [['nb', 'zone'], ['sb', 'dash'], ['db', 'close'], ['db', 'slam'], ['ub', 'up']],
    specials: c => {
      const W = { speed: 9, r: 16, dmg: 6, ang: 65, bkb: 38, kbg: 40, life: 26, color: '#ffd23f' };
      return {
        nb: {
          total: 46, clip: 'punch', fx: 'pistol', shout: 'BANG BANG',
          tick(f, t) {
            if (f.air) f.vy = Math.min(f.vy, 1.5);
            if ((t === 8 || t === 15 || t === 22) && Game.projCount(f, 'tracer') < 4) {
              const A = TK.aim(f), V = TK.rot(A, 26, 0);
              MV2.spawn(f, { kind: 'tracer', vx: V[0], vy: V[1], grav: 0, r: 7, dmg: 3, ang: 22, bkb: 14, kbg: 16, life: 32, spark: true, step: true, color: '#ffe9a0' }, c.w * 0.5 + 20, c.h * 0.55);
              f.vx -= f.face * 0.8; Sfx.pistol(); Sfx.brass(0.22);
            }
          },
        },
        sb: Object.assign(mkDash({ total: 40, a: 4, b: 22, speed: 12.5, air: { drop: 4 }, hit: H(0, 0, c.w * 0.5, -12, 24, 9, 70, 40, 55) }), { clip: 'sweep' }),
        ub: withTick(Object.assign(mkRise({ total: 46, at: 6, vy: -18, hits: [H(6, 14, 0, 12, 34, 7, -80, 30, 60)] }), { clip: 'jump', fx: 'cannon', shout: 'MAKE IT RAIN' }), (f, t) => {
          if (t !== 6) return;
          MV2.spawn(f, { kind: 'cashblast', vx: 0, vy: 12, grav: 0, step: true, r: 26, dmg: 6, ang: -70, bkb: 30, kbg: 50, life: 16, pierce: true, color: '#3ec46d' }, 0, -6);
          for (let i = 0; i < 16; i++) Game.parts.push({ x: f.x + rand(-20, 20), y: f.y + rand(-4, 10), vx: rand(-4, 4), vy: rand(2, 8), life: 34, max: 34, color: i % 3 ? '#3ec46d' : '#ffd45c', size: rand(5, 9), g: 0.15 });
        }),
        db: Object.assign(mkSlam({
          ground: { total: 40, clip: 'slam', hits: [H(12, 16, 0, -10, 56, 8, 70, 44, 50, { radial: true })],
            tick(f, t) { if (t === 12) { MV2.wave(f, 1, W); MV2.wave(f, -1, W); Game.shock(f.x, f.y, '#ffd23f'); } } },
          air: { drop: 17, clip: 'slam', hits: [H(6, 199, 0, 4, 28, 11, -80, 24, 76)],
            land: { total: 28, clip: 'slam', hits: [H(1, 5, 0, -12, 60, 8, 60, 50, 40, { radial: true })], start(f) { MV2.wave(f, 1, W); MV2.wave(f, -1, W); } } },
        }), { shout: 'MIC DROP' }),
      };
    },
  },
  {
    id: 'techno', name: 'TECHNOKING', title: 'Rocket Mogul', blurb: 'Flamethrower, steel truck ram, rocket launch.',
    w: 56, h: 84, walk: 5.9, air: 4.5, grav: 0.66, fall: 11.5, jump: 14.4, djump: 13.2, jumps: 1, weight: 104, power: 1.05, reach: 1.02,
    look: { kind: 'dog', fur: '#e8c8a8', belly: '#16161c', ear: '#3a2a20', dark: '#1a1208', eye: 'side', acc: 'none' },
    ai2: [['nb', 'close'], ['sb', 'dash'], ['db', 'slam'], ['ub', 'up']],
    specials: c => ({
      nb: {
        total: 44, clip: 'cast',
        tick(f, t) {
          if (f.air) f.vy = Math.min(f.vy, 1.5);
          if (t >= 8 && t <= 32 && (t - 8) % 3 === 0)
            MV2.spawn(f, { kind: 'flame', vx: 10, vy: -0.2, grav: -0.03, drag: 0.96, step: true, r: 14, rgrow: 0.6, dmg: 1.3, ang: 30, bkb: 22, kbg: 4, life: 13, color: '#ff9a3a' }, c.w * 0.5 + 12, c.h * 0.55);
        },
      },
      sb: Object.assign(mkDash({ total: 52, a: 8, b: 34, speed: 13, hit: H(0, 0, c.w * 0.5 + 14, -c.h * 0.45, 46, 14, 36, 50, 86) }), { clip: 'guard', fx: 'truck', shout: 'STEEL TRUCK' }),
      ub: {
        total: 62, helpless: true, airOnce: 'up', clip: 'jump', fx: 'rocket', color: '#ff9a2a', shout: 'LIFTOFF', hits: [H(6, 34, 0, 26, 30, 5, -80, 30, 40, { rehit: 8 })],
        tick(f, t) {
          if (t < 6) { f.vx *= 0.7; f.vy = Math.min(f.vy, 0); return; }
          if (t <= 36) {
            f.vy = approach(f.vy, -14.5, 3); f.vx = approach(f.vx, f.dirX() * 2.5, 0.3);
            if (t % 2 === 0) Game.parts.push({ x: f.x + rand(-8, 8), y: f.y + 8, vx: rand(-1, 1), vy: rand(3, 5), life: 20, max: 20, color: t % 4 ? '#ff9a2a' : '#ffe27a', size: rand(10, 18), g: 0, fire: true });
          }
        },
      },
      db: Object.assign(mkSlam({
        ground: { total: 40, clip: 'slam', fx: 'thrust', color: '#ff9a2a', hits: [H(10, 16, 0, 0, 60, 10, 70, 44, 60, { radial: true })] },
        air: { drop: 13, clip: 'slam', fx: 'thrust', color: '#ff9a2a', hits: [H(6, 199, 0, 20, 30, 10, -80, 26, 72)],
          land: { total: 30, clip: 'slam', hits: [H(1, 6, 0, -10, 78, 10, 60, 50, 50, { radial: true })],
            start(f) { for (let i = 0; i < 14; i++) { const a = rand(0, TAU), s = rand(2, 6); Game.parts.push({ x: f.x, y: f.y - 10, vx: dcos(a) * s, vy: -Math.abs(dsin(a)) * s, life: 26, max: 26, color: i % 3 ? '#ff8a1a' : '#ffe27a', size: rand(18, 30), g: 0, fire: true }); } } } },
      }), { shout: 'TOUCHDOWN' }),
    }),
  },
  {
    id: 'hoodie', name: 'HOODIE', title: 'Cage Coder', blurb: 'Takedown grab, flying knee, ground and pound.',
    w: 54, h: 78, walk: 6.5, air: 4.8, grav: 0.66, fall: 11.5, jump: 14.8, djump: 13.6, jumps: 1, weight: 96, power: 1.02, reach: 0.98,
    look: { kind: 'dog', fur: '#f4dcc8', belly: '#8a8a94', ear: '#6a4a2a', dark: '#2a1e14', eye: 'dot', acc: 'none' },
    ai2: [['nb', 'grab'], ['sb', 'dash'], ['db', 'punish'], ['db', 'slam'], ['ub', 'up']],
    specials: c => {
      const hold = {
        total: 34, holdVictim: true, clip: 'slam', sfx: 'none', shout: 'TAKEDOWN',
        tick(f, t) {
          if (t < 14) MV2.hold(f, c.w * 0.55, -c.h * (0.3 - t * 0.02));
          if (t === 14) {
            const v = MV2.throwV(f, { dmg: 10, ang: 0, bkb: 22, kbg: 20, ground: true });
            if (v) TRIP(46)(f, v);
            Game.shake(8); Sfx.hit(0.6); Game.puff(f.x + f.face * c.w * 0.5, f.y, 8, '#ffffff');
          }
        },
      };
      return {
        nb: mkCgrab({ total: 38, a: 8, b: 15, x: c.w * 0.5 + 12, y: -c.h * 0.3, r: 30, lunge: 7, hold, clip: 'sweep' }),
        sb: Object.assign(mkDash({ total: 38, a: 6, b: 18, speed: 15, lift: 6, air: { lift: 2 }, hit: H(0, 0, c.w * 0.5, -c.h * 0.6, 26, 13, 40, 44, 88) }), { clip: 'flykick', fx: 'knee' }),
        ub: Object.assign(mkRise({ at: 5, vy: -17.5, steer: 3, hits: [H(5, 16, c.w * 0.45, -c.h * 0.85, 30, 11, 70, 44, 80)] }), { clip: 'uppercut' }),
        db: Object.assign(split2(
          { total: 40, clip: 'slam', hits: [H(6, 26, c.w * 0.5 + 14, -8, 30, 1.8, 80, 12, 4, { rehit: 4 }), fin(H(30, 32, c.w * 0.5 + 14, -8, 32, 5, 70, 40, 60))] },
          mkSlam({ ground: null, air: { drop: 17, clip: 'slam', hits: [H(6, 199, 0, 4, 28, 12, -80, 24, 78)], land: { total: 22, clip: 'slam', hits: [H(1, 4, 0, -10, 50, 6, 60, 44, 36, { radial: true })] } } }).air),
          { shout: 'GROUND N POUND' }),
      };
    },
  },
  {
    id: 'slam', name: 'SLAM', title: 'Main Eventer', blurb: 'Very heavy. Power bomb grab, shoulder tackle.',
    w: 70, h: 90, walk: 5.2, air: 4.0, grav: 0.74, fall: 12.5, jump: 13.8, djump: 12.4, jumps: 1, weight: 126, power: 1.18, reach: 1.08,
    look: { kind: 'dog', fur: '#d8a078', belly: '#141418', ear: '#141010', dark: '#2a1408', eye: 'fierce', acc: 'none' },
    ai2: [['nb', 'grab'], ['sb', 'dash'], ['db', 'close'], ['db', 'slam'], ['ub', 'up']],
    specials: c => {
      const bomb = {
        total: 46, holdVictim: true, clip: 'slam', sfx: 'none', shout: 'POWER BOMB',
        tick(f, t) {
          if (t < 26) { const k = Math.min(1, t / 14); MV2.hold(f, c.w * 0.55 * (1 - k), -c.h * (0.35 + 0.8 * k)); }
          if (t === 26) {
            const v = f.grabbed; if (v) v.x = f.x + f.face * (c.w * 0.5 + v.w * 0.3);
            MV2.throwV(f, { dmg: 19, ang: 82, bkb: 70, kbg: 64, ground: true });
            Game.shake(16); Sfx.hit(1); Game.shock(f.x + f.face * c.w * 0.5, f.y, '#ffd23f');
          }
        },
      };
      const bsLand = { total: 28, clip: 'slam', hits: [H(1, 5, 0, -12, 74, 9, 62, 50, 46, { radial: true })] };
      const body = hop => ({
        total: 200, clip: 'slam', sfx: 'none', hits: [H(14, 199, 0, 0, 44, 15, -75, 30, 82)],
        tick(f, t) { if (t === 2 && hop) f.vy = -hop; if (t >= 14) { f.vy = 18; f.vx *= 0.85; } },
        onLand(f) { Game.shake(12); Sfx.hit(0.9); Game.shock(f.x, f.y, '#ffd23f'); f.startMove(bsLand); },
      });
      return {
        nb: mkCgrab({ total: 40, a: 8, b: 14, x: c.w * 0.5 + 10, y: -c.h * 0.45, r: 32, lunge: 5, hold: bomb }),
        sb: Object.assign(mkDash({ total: 46, a: 8, b: 30, speed: 13, hit: H(0, 0, c.w * 0.5 + 8, -c.h * 0.55, 34, 13, 36, 48, 86) }), { clip: 'flykick', armor: 60, armorF: [6, 30] }),
        ub: Object.assign(mkRise({ at: 6, vy: -15.5, hits: [H(6, 16, c.w * 0.4, -c.h * 0.85, 36, 14, 82, 48, 84)] }), { clip: 'uppercut' }),
        db: Object.assign(split2(body(10), body(3)), { shout: 'BODY SLAM' }),
      };
    },
  },
  {
    id: 'mystic', name: 'MYSTIC', title: 'Left Hand', blurb: 'Fast striker. Counter left, spinning back kick.',
    w: 54, h: 78, walk: 7.0, air: 5.0, grav: 0.68, fall: 12, jump: 15, djump: 13.8, jumps: 1, weight: 92, power: 1.08, reach: 1.0,
    look: { kind: 'dog', fur: '#f0c8a8', belly: '#1f8a4a', ear: '#c8601a', dark: '#2a1408', eye: 'fierce', acc: 'none' },
    ai2: [['nb', 'counter'], ['sb', 'dash'], ['db', 'close'], ['ub', 'up']],
    specials: c => ({
      nb: {
        total: 44, clip: 'block', fx: 'stance', color: '#ffd23f', counter: [4, 30],
        counterHit: { mult: 2.0, min: 14, ang: 34, bkb: 72, kbg: 100, shout: 'LIGHTS OUT', def: { total: 26, clip: 'punch' } },
        tick(f) { if (f.air) f.vy = Math.min(f.vy, 1.5); },
      },
      sb: Object.assign(mkDash({ total: 40, a: 8, b: 16, speed: 11, hit: H(0, 0, c.w * 0.5 + 22, -c.h * 0.55, 32, 13, 38, 46, 88) }), { clip: 'kick' }),
      ub: Object.assign(mkRise({ at: 4, vy: -17.5, hits: [H(4, 14, c.w * 0.35, -c.h * 0.7, 30, 12, 75, 44, 80)] }), { clip: 'flykick' }),
      db: { total: 42, clip: 'kick', hits: [H(14, 18, c.w * 0.5 + 24, -c.h * 0.3, 32, 14, -70, 30, 80)], tick(f, t) { if (f.air) f.vy = Math.min(f.vy, t < 14 ? 1 : 4); } },
    }),
  },
  {
    id: 'ape', name: 'APE', title: 'Bored Ape', blurb: 'Heavy and strong. Banana boomerang, chest pound.',
    w: 64, h: 82, walk: 5.6, air: 4.3, grav: 0.68, fall: 12, jump: 14.2, djump: 13, jumps: 1, weight: 116, power: 1.15, reach: 1.08,
    look: { kind: 'dog', fur: '#7a4a28', belly: '#d8b088', ear: '#4ab8e8', dark: '#241206', eye: 'side', acc: 'none' },
    ai2: [['nb', 'zone'], ['sb', 'dash'], ['db', 'close'], ['db', 'slam'], ['ub', 'up']],
    specials: c => {
      const W = Object.assign({}, WAVE_ROCK, { color: '#ffb347' });
      const slamLand = { total: 28, clip: 'slam', hits: [H(1, 5, 0, -12, 72, 9, 62, 50, 46, { radial: true })] };
      return {
        nb: Object.assign(mkProj({ max: 1, total: 32, at: 10, proj: { kind: 'banana', vx: 11, vy: -1, grav: 0, r: 16, dmg: 8, ang: 45, bkb: 30, kbg: 50, life: 90, boomer: 28, color: '#ffe04a' } }), { clip: 'punch' }),
        sb: Object.assign(mkDash({ total: 46, a: 6, b: 28, speed: 13.5, hit: H(0, 0, c.w * 0.5 + 6, -c.h * 0.45, 34, 13, 38, 46, 88) }), { clip: 'flykick', shout: 'APE IN' }),
        ub: {
          total: 50, helpless: true, airOnce: 'up', clip: 'jump', fx: 'vine', hits: [H(6, 26, c.w * 0.3, -c.h * 0.5, 32, 8, 70, 40, 60)],
          tick(f, t) {
            if (t < 6) { f.vx *= 0.7; f.vy = Math.min(f.vy, 0); return; }
            if (t <= 30) { const k = (t - 6) / 24; f.vx = f.face * (2 + 7 * dsin(k * Math.PI)) + f.dirX() * 1.5; f.vy = -15 + k * 12; f.noGrav = true; }
          },
        },
        db: Object.assign(split2(
          { total: 48, clip: 'taunt', fx: 'pound', color: '#ffb347', hits: [H(12, 16, 0, -c.h * 0.5, 70, 7, 60, 40, 56, { radial: true })],
            tick(f, t) { if (t === 14) { MV2.wave(f, 1, W); MV2.wave(f, -1, W); Game.shock(f.x, f.y, '#ffb347'); Game.shake(6); } } },
          { total: 200, clip: 'slam', sfx: 'none', hits: [H(6, 199, 0, 4, 36, 13, -80, 28, 80)],
            tick(f, t) { if (t < 6) { f.vy = -3; f.vx *= 0.5; } else f.vy = 17; f.vx *= 0.9; },
            onLand(f) { Game.shake(10); Sfx.hit(0.7); Game.shock(f.x, f.y, '#ffb347'); f.startMove(slamLand); } }),
          { shout: 'APE STRONG' }),
      };
    },
  },
  {
    id: 'ember', name: 'EMBER', title: 'Wing Blaze', blurb: 'Heavy flyer, two wing flaps. Fire breath, blaze tackle.',
    w: 64, h: 86, walk: 5.9, air: 5.1, grav: 0.64, fall: 11.5, jump: 14.6, djump: 12.6, jumps: 2, weight: 110, power: 1.12, reach: 1.08,
    look: { kind: 'frog', fur: '#ff8a2a', belly: '#ffe0a0', ear: '#1f8a9a', dark: '#3a1606', eye: 'fierce', acc: 'none' },
    ai2: [['nb', 'close'], ['db', 'breaker'], ['sb', 'dash'], ['db', 'close'], ['ub', 'up']],
    specials: c => ({
      nb: mkStream({ total: 90, to: 76, drain: 0.016, fire(f, fuel) {
        MV2.spawn(f, { kind: 'flame', vx: 8 + 7 * fuel, vy: -0.2, grav: -0.03, drag: 0.975, step: true, r: 15 + 7 * fuel, rgrow: 0.55, dmg: 1.3, ang: 30, bkb: 22, kbg: 4, life: 12 + 12 * fuel, color: '#ff6a1a' }, c.w * 0.5 + 8, c.h * 0.72);
      } }),
      sb: {
        total: 56, clip: 'flykick', fx: 'blitz', color: '#ff6a1a', airOnce: 'side', shout: 'INFERNO RUSH',
        hits: [H(12, 30, c.w * 0.5 + 6, -c.h * 0.5, 34, 16, 38, 50, 92, { after: RECOIL(5) })],
        tick(f, t) {
          if (t < 12) { f.vx *= 0.8; if (f.air) f.vy = Math.min(f.vy, 0.5); }
          else if (t <= 30) { f.vx = f.face * 14; f.vy = f.air ? Math.min(f.vy, 0.8) : 0; if (t % 2 === 0) Game.parts.push({ x: f.x - f.face * 20 + rand(-10, 10), y: f.y - c.h * 0.5 + rand(-20, 20), vx: -f.face * rand(1, 3), vy: rand(-2, 0), life: 18, max: 18, color: t % 4 ? '#ff7a1a' : '#ffd45c', size: rand(14, 24), g: 0, fire: true }); }
          else f.vx *= 0.85;
        },
      },
      ub: Object.assign(mkRise({ total: 58, at: 4, vy: -11.5, flaps: [4, 15, 26], steer: 4, hits: [
        H(4, 32, 0, -c.h * 0.55, 50, 2, 85, 28, 12, { rehit: 5, radial: true }), fin(H(35, 38, 0, -c.h * 0.55, 54, 6, 70, 44, 88, { radial: true }))] }), { clip: 'spin', fx: 'wings', color: '#ff8a2a' }),
      db: {
        total: 48, clip: 'punch', fx: 'rock', color: '#b89a7a', armor: 999, armorF: [1, 15],
        hits: [H(16, 20, c.w * 0.5 + 14, -c.h * 0.55, 36, 14, 40, 44, 88, { pre: SHIELD_SMASH })],
        tick(f, t) { if (t >= 14 && t <= 18) f.vx = f.face * 5; else f.vx *= 0.8; if (f.air) f.vy = Math.min(f.vy, 2); },
      },
    }),
  },
  {
    // VOLT, added 10/05. The partner character: Volt Inu, taken from voltinu.meme's own art -- a white
    // and silver wolf with lime-green lightning, lime eyes and the grey bolt markings in the ears. It is
    // also a playable fighter in the METABRAWL trailer (2024-03-30), where its stated style is Northern
    // Wolf Kung Fu and its special is Volt Power Blast; both are kept here.
    // title 10/09 Duane: the old one was meaningless and he said so. Northern Wolf is the style Volt
    // Inu's own METABRAWL trailer gives it, so it is the one name here that is not invented.
    id: 'volt', name: 'VOLT', title: 'Northern Wolf', blurb: 'Throws lightning. Rail dash, rising arc, ground surge.',
    w: 56, h: 76, walk: 6.3, air: 4.6, grav: 0.66, fall: 11.5, jump: 14.4, djump: 13.4, jumps: 1, weight: 104, power: 1.1, reach: 0.92,
    look: { kind: 'dog', fur: '#eef2f4', belly: '#cfd6da', ear: '#9aa4ab', dark: '#1b2028', eye: 'fierce', acc: 'none' },
    ai2: [['nb', 'zone'], ['sb', 'dash'], ['db', 'slam'], ['ub', 'up']],
    specials: c => ({
      // THROWN BOLT, 10/09 Duane: VOLT throws the lightning now. It was a short lance off the glove,
      // which only ever reached punching range; this winds up and hurls a forked bolt that crosses
      // the stage, pierces, and on a deep charge lands fat enough to stagger. Charge scales speed,
      // size, damage and knockback. The shout stays VOLT POWER BLAST -- that name is Volt Inu's own,
      // off the 2024 METABRAWL trailer. SPARK's bolts home and chase; this one is thrown straight and
      // hits like a spear, so the two electric fighters still read apart.
      nb: {
        total: 56, clip: 'cast', fx: 'thunder', color: '#c6ff2e', charge: { at: 12, key: 'special', max: 72 }, aiHold: [10, 72],
        tick(f, t) {
          if (f.air) f.vy = Math.min(f.vy, 1);
          f.vx *= 0.82;
          if (t === 12) {
            const ch = f.move.charge;
            if (ch && ch % 4 === 0) Game.chargeSpark(f);
            if (ch === 1) Sfx.tone(280, 880, 0.5, 'sawtooth', 0.05);
          }
          if (t === 20 && Game.projCount(f, 'voltbolt') < 2) {
            const k = f.move.charge / 72;
            MV2.say(f, 'VOLT POWER BLAST', 1.0 + k * 0.5);
            Sfx.tone(170, 740, 0.4, 'sawtooth', 0.15); Sfx.noise(0.28, 0.22, 1000);
            Game.shake(3 + 7 * k); Game.flashT = Math.max(Game.flashT, 2 + 2 * k);
            MV2.spawn(f, { kind: 'voltbolt', vx: 13 + 3 * k, vy: 0, grav: 0, r: 13 + 11 * k, dmg: 7 + 9 * k, ang: 38,
              bkb: 26 + 16 * k, kbg: 52 + 32 * k, life: 64, step: true, pierce: true, big: k > 0.6, color: '#c6ff2e',
              after: (p, b) => {
                if (p.big) STATUS.stagger(b, 20, '#c6ff2e');
                Game.ring(b.x, b.y - b.h * 0.5, '#e8ff9a', 58); Sfx.tone(1400, 240, 0.1, 'square', 0.1);
              } }, c.w * 0.5 + 10, c.h * 0.6);
          }
        },
      },
      sb: Object.assign(mkDash({ total: 38, a: 6, b: 18, speed: 15, hit: H(0, 0, c.w * 0.5 + 10, -c.h * 0.5, 28, 12, 36, 44, 84) }), { clip: 'punch', fx: 'rush', color: '#c6ff2e' }),
      ub: Object.assign(mkRise({ total: 44, at: 4, vy: -16.5, hits: [
        H(4, 10, 0, -c.h * 0.55, 30, 7, 88, 36, 44, { radial: true }), fin(H(11, 16, 0, -c.h * 0.7, 32, 8, 80, 48, 92, { radial: true }))] }), { clip: 'uppercut', fx: 'spin', color: '#c6ff2e' }),
      db: Object.assign(mkSlam({
        ground: { total: 40, clip: 'slam', hits: [H(13, 17, c.w * 0.5 + 12, -10, 30, 12, 60, 42, 74)],
          tick(f, t) { if (t === 14) { const w = Object.assign({}, WAVE_ROCK, { color: '#c6ff2e', dmg: 6 }); MV2.wave(f, 1, w); MV2.wave(f, -1, w); Game.shock(f.x, f.y, '#c6ff2e'); } } },
        air: { drop: 17, clip: 'slam', hits: [H(6, 199, 0, 4, 28, 12, -78, 26, 78)],
          land: { total: 26, clip: 'slam', hits: [H(1, 5, 0, -12, 62, 8, 62, 50, 44, { radial: true })], start(f) { const w = Object.assign({}, WAVE_ROCK, { color: '#c6ff2e', dmg: 6 }); MV2.wave(f, 1, w); MV2.wave(f, -1, w); } } },
      }), { shout: 'GROUND SURGE' }),
    }),
  },
  {
    // WOLVERINU, the partner character: carbon armour, lime circuit seams, green eyes, white muzzle,
    // chrome claws. A rushdown with claw reach: it closes fast, cuts on the way in, and its energy is
    // CIRCUIT, never lightning -- lightning is VOLT's.
    //
    // 10/10, read off the source: this entry used to say the design came "straight off wolverinu.fun's
    // own upright poster". There is no upright poster. Every image on wolverinu.fun AND the @WolverinuRH
    // X header show a FOUR-LEGGED armoured wolf with a big bushy lime-tipped tail. assets3d/wolverinu_ref.png
    // (and so wolverinu_glb.wasm, the model this fighter actually uses) is a biped with no tail, which is
    // the roster convention but is NOT what the brand looks like. The real art is now kept beside it as
    // assets3d/wolverinu_site_ref.png and wolverinu_site_poster.jpg, and the site roster tile uses it.
    // Re-rigging the playable model as a quadruped is a separate job and has not been done.
    //
    // 10/15: the kit below is the ARENA kit (ARENA.version 1, seeded fights). What he actually plays
    // like in a local match is 67_unique.js -- held sprint with three cancels, hanging cross rake,
    // claw climb, FERAL -- plus the claw normals in 6g_styles, the Scent of Blood passive and the
    // stat profile in 66_traits, and ADAMANT DRIVER in 26_grapples2. Read those, not this.
    id: 'wolverinu', name: 'WOLVERINU', title: 'Circuit Prowl', blurb: 'Rushdown. Held sprint into claws, a cut that hangs, and he goes feral.',
    w: 56, h: 80, walk: 7.0, air: 5.0, grav: 0.66, fall: 12, jump: 14.8, djump: 13.8, jumps: 1, weight: 102, power: 1.06, reach: 1.16, blade: '#9bf000',
    look: { kind: 'dog', fur: '#1c2026', belly: '#8e9aa2', ear: '#9bf000', dark: '#0a0d12', eye: 'fierce', acc: 'none' },
    ai2: [['sb', 'dash'], ['nb', 'trap'], ['db', 'punish'], ['ub', 'up']],   // nb is a wall, not a zoning shot; db is FERAL on the deck and PLUNGE off it
    specials: c => ({
      nb: {
        total: 36, clip: 'punch', fx: 'slash', weapon: '#9bf000', shout: 'RAKE',
        tick(f, t) {
          if (f.air) f.vy = Math.min(f.vy, 1.5);
          if (t === 10 && Game.projCount(f, 'volley') < 3)
            MV2.spawn(f, { kind: 'volley', vx: 12, vy: 0, grav: 0, r: 13, dmg: 5, ang: 34, bkb: 22, kbg: 34, life: 30, color: '#9bf000' }, c.w * 0.5 + 14, c.h * 0.55);
        },
      },
      sb: Object.assign(mkDash({ total: 38, a: 6, b: 18, speed: 16.5, hit: H(0, 0, c.w * 0.5 + 26, -c.h * 0.5, 32, 12, 38, 42, 86) }), { clip: 'flykick', fx: 'slash', weapon: '#9bf000', color: '#9bf000' }),
      ub: Object.assign(mkRise({ total: 46, at: 4, vy: -11, hold: 22, steer: 4, hits: [
        H(4, 26, 0, -c.h * 0.6, 44, 2.4, 88, 30, 14, { rehit: 5, radial: true }), fin(H(29, 32, 0, -c.h * 0.6, 48, 6, 62, 44, 94, { radial: true }))] }), { clip: 'spin', fx: 'spin', weapon: '#9bf000', color: '#9bf000' }),
      db: Object.assign(mkSlam({
        ground: { total: 40, clip: 'slam', fx: 'slash', weapon: '#9bf000', hits: [H(12, 16, c.w * 0.5 + 18, -12, 30, 11, 56, 40, 72)],
          tick(f, t) { if (t === 13) { const w = Object.assign({}, WAVE_ROCK, { color: '#9bf000', dmg: 6 }); MV2.wave(f, 1, w); MV2.wave(f, -1, w); Game.shock(f.x, f.y, '#9bf000'); } } },
        air: { drop: 18, clip: 'slam', hits: [H(6, 199, 0, 4, 28, 12, -80, 26, 80)],
          land: { total: 28, clip: 'slam', hits: [H(1, 5, 0, -12, 60, 8, 60, 50, 44, { radial: true })], start(f) { const w = Object.assign({}, WAVE_ROCK, { color: '#9bf000', dmg: 6 }); MV2.wave(f, 1, w); MV2.wave(f, -1, w); } } },
      }), { shout: 'GROUND SPLIT' }),
    }),
  },
];
// one signature move each: [slot, the shout that lands with it]. The showpiece gets the freeze-flash.
const SIGNATURE = {
  giga: ['nb', 'MOON WAVE'], ronin: ['db', 'SHATTER'], tyrant: ['db', 'SUPERNOVA'], gwei: ['ub', 'COIN UP'],
  shroom: ['db', 'SPORE BURST'], kaiju: ['sb', 'FLYING SLAM'], mochi: ['sb', 'MALLET'], omen: ['nb', 'SHADOW ORB'],
  wisp: ['nb', 'BUBBLE'], spark: ['db', 'THUNDERCLAP'], turbo: ['nb', 'BLAZE PUNCH'], chop: ['nb', 'WATAA'],
  ginga: ['ub', 'GINGA'], sifu: ['sb', 'TIGER'], fro: ['nb', 'ONE CUT'], bling: ['db', 'MIC DROP'],
  techno: ['sb', 'STEEL TRUCK'], hoodie: ['nb', 'TAKEDOWN'], slam: ['nb', 'POWER BOMB'], mystic: ['db', 'AXE KICK'],
  ape: ['db', 'APE STRONG'], ember: ['sb', 'INFERNO RUSH'], volt: ['nb', 'VOLT POWER BLAST'], wolverinu: ['sb', 'PROWL'],
};
const TAUNTS = {
  giga: 'SNACK TIME', ronin: 'NICE SWORD', tyrant: 'KNEEL', gwei: 'ITS LEAKING', shroom: 'FUN GUY', kaiju: 'ROAR',
  mochi: 'HI', omen: 'THINK', wisp: 'WHEEE', spark: 'ZAP ZAP', turbo: 'SHOW ME', chop: 'WAAAH', ginga: 'DANCE',
  sifu: 'BOW', fro: 'HMPH', bling: 'WAGWAN MY G', techno: 'TO THE MOON', hoodie: 'GG', slam: 'FLEX', mystic: 'WHO',
  ape: 'OOH OOH', ember: 'TOASTY', volt: 'STEP UP', wolverinu: 'COME ON',
};
for (const c of ROSTER2) {
  c.moves = Object.assign(baseMoves(c), c.specials(c), kicks(c));
  if (c.blade) for (const n of ['jab', 'ftilt', 'utilt', 'dtilt', 'fsmash', 'usmash', 'dsmash', 'nair', 'fair', 'bair', 'uair', 'dair']) c.moves[n] = Object.assign({}, c.moves[n], { weapon: c.blade });
  c.taunt = TAUNTS[c.id] || 'COME ON';
  CHARS.push(c); CHAR_BY_ID[c.id] = c;
}
for (const [id, [slot, text]] of Object.entries(SIGNATURE)) {
  const c = CHAR_BY_ID[id], d0 = c.moves[slot], d = d0.ground || d0;
  d.sigText = text;
  const hbs = d.hits || [], cg = hbs.find(h => h.cgrab);
  if (cg) cg.cgrab.sigText = text;                                   // the hold move pays off on the throw
  else {
    const hb = hbs.filter(h => !h.grab).pop();
    if (hb) { const prev = hb.after; hb.after = (a, b, h) => { if (prev) prev(a, b, h); SIG(a, b); }; }
    else d.sigProj = true;                                           // the showpiece is the shot it fires
  }
}
// TOP G bails out of the car: he jumps clear with his recovery back, and the car keeps going on its own
// as a runaway that still flattens anyone in its path before it leaves the stage.
function TOPG_BAIL(f) {
  const M = Game.stage.main, cx = (M.x0 + M.x1) * 0.5;
  // He must never die to his own special, so the leap goes UP and toward the middle of the stage
  // whenever the car has carried him near a lip. Bailing at x = 290 with the old forward 5.5 threw him
  // straight past the ledge and off the bottom (measured 9/21, dev/aaa/topg_car_test.js).
  const lip = Math.min(f.x - M.x0, M.x1 - f.x), inward = f.x > cx ? -1 : 1;
  f.move = null;
  f.air = true; f.plat = null; f.ledge = null;
  f.vy = -f.c.jump * 1.02;
  f.vx = lip < 190 ? inward * 5.2 : f.face * 4.2;
  // and he lands with everything back: both air jumps, the recovery, the air dodge
  f.jumps = Math.max(f.jumps, FEEL.jumps(f)); f.airOnce = {}; f.airdodged = false; f.fastFall = false;
  f.setState('air');
  Game.projs.push({ kind: 'topgcar', x: f.x, y: f.y - 2, vx: f.face * 19, vy: 0, grav: 0, r: 34, dmg: 13, ang: 28, bkb: 56, kbg: 92,
    life: 60, pierce: true, color: '#2aa8ff', owner: f, age: 0, dir: f.face, h: f.h });
  Game.text(f.x, f.y - f.h - 30, 'BAIL OUT', '#2aa8ff', 1.3);
  Game.puff(f.x, f.y - 6, 10, '#cfd4e8'); Sfx.jump(); Sfx.noise(0.25, 0.18, 1600);
}
// TOP G: a Bugatti that drives across the stage, and the bottom-G dance. Local matches only
// (Game.sigs), so the bet arena's version-1 fighters play exactly as they always did.
{
  const t = CHAR_BY_ID.topg;
  if (t) {
    const CAR = {
      total: 84, clip: 'guard', fx: 'bugatti', color: '#2aa8ff', shout: 'TOP SPEED', sigText: 'RUN OVER', airOnce: 'side', sfx: 'none',
      hits: [H(16, 66, t.w * 0.5 + 34, -t.h * 0.45, 48, 15, 26, 54, 92, { rehit: 24, after: SIG })],
      tick(f, tt) {
        // Jump bails out, at ANY point in the move including the launch squat: the one thing this move
        // must never do is trap him in it (9/20 + 9/21: "i cant jump out of top gs car, it just drives
        // off the edge of the map and he dies").
        if (tt >= 2 && tt <= 74 && f.pressed('jump')) return TOPG_BAIL(f);
        if (tt < 14) { f.vx *= 0.7; if (tt === 8) Sfx.tone(180, 90, 0.5, 'sawtooth', 0.12); return; }
        if (tt <= 66) {
          // The car can never carry him off the map. The old brake was grounded-only (`!f.air`), so an
          // AIRBORNE drive glided at 19 px/frame with gravity capped and sailed straight through the
          // blast zone — he died every single time (measured, dev/aaa/topg_car_test.js). The brake now
          // aims at a stop point 34 units inboard of the ledge ahead and eases into it geometrically,
          // on the ground and over it alike, so it can never overshoot.
          const M = Game.stage.main, stop = (f.face > 0 ? M.x1 : M.x0) - f.face * 34, room = (stop - f.x) * f.face;
          if (room <= 1) {
            f.vx = 0;
            // started (or ended) the drive already out past the lip: cut it short and hand him a jump
            // back, so even the worst possible moment to press it is survivable
            if (f.air) f.jumps = Math.max(f.jumps, 1);
            if (f.move && f.move.t <= 66) { f.move.t = 67; Sfx.noise(0.3, 0.2, 2400); Game.puff(f.x, f.y, 8, '#d8d8e0'); }
          } else {
            f.vx = f.face * Math.min(19, Math.max(1.6, room * 0.42));
            if (f.air && room > 70) f.vy = Math.min(f.vy, 1.2);   // it flies, but only while there is stage left
          }
          if (tt % 3 === 0) Game.parts.push({ x: f.x - f.face * t.w * 0.7 + rand(-6, 6), y: f.y - 10, vx: -f.face * rand(1, 3), vy: rand(-1.4, 0.2), life: 22, max: 22, color: tt % 6 ? '#8a8a96' : '#d8d8e0', size: rand(8, 15), g: 0, soft: true });
        } else f.vx *= 0.86;
      },
    };
    t.taunt = 'BOTTOM G';
    t.moves2 = Object.assign({}, t.moves, { sb: CAR });
  }
}
// MOCHI: the Smash-sized mallet and the inhale / swallow / spit. Local matches only (Game.sigs), so
// seeded fights - the bet arena and online lockstep - keep the version they have always replayed with.
{
  const m = CHAR_BY_ID.mochi;
  if (m) {
    const oldSb = m.moves.sb;
    // ---- side special: a two-handed mallet. Rear it over the head (holding Special heats it up like a
    // poker), heave it through a 180 degree arc, bury it in the deck, and let the weight drag you on.
    const MALLET = {
      total: 62, clip: 'guard', fx: 'mallet', sigText: 'MALLET', sfx: 'none',
      charge: { at: 12, key: 'special', max: 60, mult: 1.35 }, aiHold: [0, 48],
      hits: [H(24, 28, m.w * 0.5 + 48, -m.h * 0.45, 56, 17, 40, 52, 112, { after: SIG })],
      tick(f, t) {
        if (f.air) f.vy = Math.min(f.vy, 1.2);
        if (t <= 12) { f.vx *= 0.6; if (t === 2) Sfx.tone(120, 80, 0.4, 'sine', 0.08); }           // plant, heave it up
        else if (t < 24) { f.vx *= 0.82; if (t === 13) Sfx.swing(); }                              // the swing itself
        else if (t <= 31) f.vx = f.face * 2.4;                                                     // dragged on by the head
        else f.vx *= 0.86;
        if (t === 12 && f.move.charge > 20 && f.move.charge % 6 === 0) Game.chargeSpark(f);
        if (t === 24) Game.shake(9);
        if (t === 28) {                                                                            // impact: dust and a shock ring
          const hx = f.x + f.face * (m.w * 0.5 + 44);
          Game.shake(20); Game.flashT = Math.max(Game.flashT, 3);
          Sfx.hit(0.9); Sfx.tone(90, 55, 0.34, 'square', 0.14);
          if (!f.air) {
            Game.shock(hx, f.y, '#ffd8a0');
            for (let i = 0; i < 16; i++) Game.parts.push({ x: hx + rand(-28, 28), y: f.y - rand(0, 8), vx: rand(-4.5, 4.5), vy: rand(-6, -1), life: 30, max: 30, color: i % 3 ? '#c8b088' : '#efe0c0', size: rand(7, 15), g: 0.34, soft: true });
          }
        }
      },
    };
    // ---- neutral special: inhale. Wider and longer than the v1 one, and it drags in loose items and
    // light shots as well as fighters.
    const INHALE = {
      total: 72, clip: 'cast', fx: 'inhale', aiHold: [16, 52], sfx: 'none',
      tick(f, t) {
        if (f.air) f.vy = Math.min(f.vy, 1.4);
        f.vx *= 0.72;                                                   // planted while the mouth is open
        if (t < 8 || t > 58) return;
        if (t > 24 && !f.in.special) { f.move.t = 58; return; }
        if (t === 8) Sfx.noise(0.55, 0.1, 320);
        const REACH = 230, mouthY = f.y - m.h * 0.5;
        for (const g of Game.fighters) {
          if (g === f || g.untouchable || g.hitlag > 0 || !MV2.PULLABLE.includes(g.state) || g.grabbed) continue;
          const ahead = (g.x - f.x) * f.face, dy = (g.y - g.h * 0.5) - mouthY;
          if (ahead < -8 || ahead > REACH || Math.abs(dy) > 78) continue;
          if (ahead < m.w * 0.5 + g.w * 0.4 + 6) { if (MV2.catch(f, g)) return f.startMove(FULL); continue; }
          const pull = 1.9 + (REACH - ahead) * 0.017;
          g.x -= f.face * pull;                                          // sideways only: physics still collides them
          if (!g.air) { g.vx *= 0.82; if (Game.frame % 3 === 0) Game.parts.push({ x: g.x + rand(-8, 8), y: g.y, vx: -f.face * rand(1, 3), vy: rand(-1.6, -0.2), life: 18, max: 18, color: '#cfd4e8', size: rand(5, 10), g: 0, soft: true }); }
          else g.vy = Math.min(g.vy, 1.2);
        }
        // loose items slide in, and MOCHI ends up holding whatever reaches the mouth
        for (const it of Game.items) {
          if (it.dead || ITEM_DEFS[it.kind].floating) continue;
          const ahead = (it.x - f.x) * f.face;
          if (ahead < -6 || ahead > REACH || Math.abs(it.y - mouthY) > 90) continue;
          it.x -= f.face * (1.6 + (REACH - ahead) * 0.016); it.y += (mouthY - it.y) * 0.12; it.vx *= 0.7;
          if (ahead < m.w * 0.6 + 10 && !it.armed && !f.item) f.tryPickup();
        }
        // and light shots get swallowed whole
        for (const p of Game.projs) {
          if (p.dead || p.owner === f || p.len || p.pierce || p.big || p.dmg > 9) continue;
          const ahead = (p.x - f.x) * f.face;
          if (ahead < -6 || ahead > REACH * 0.8 || Math.abs(p.y - mouthY) > 70) continue;
          p.x -= f.face * 3.2; p.y += (mouthY - p.y) * 0.18; p.vx *= 0.75;
          if (ahead < m.w * 0.6) { p.dead = true; Game.puff(f.x + f.face * m.w * 0.4, mouthY, 4, '#e0f8ff'); Sfx.tone(520, 200, 0.06, 'sine', 0.07); }
        }
      },
    };
    // ---- swallowed: MOCHI puffs up with them inside, waddles, and spits them out as a star ----
    const FULL = {
      total: 170, holdVictim: true, swallow: true, clip: 'guard', sfx: 'none', sigText: 'SPAT OUT',
      tick(f, t) {
        const mv = f.move, v = f.grabbed;
        MV2.hold(f, 0, 0);
        if (f.air) f.vy = Math.min(f.vy, 2.5);
        if (!v) { if (t < 162) mv.t = 162; f.vx *= 0.85; return; }        // they got loose
        if (t <= 14) {                                                    // the gulp
          f.vx *= 0.7;
          if (t === 3) Sfx.tone(280, 110, 0.2, 'sine', 0.13);
          if (t === 12) { Sfx.tone(140, 70, 0.3, 'sine', 0.16); Game.text(f.x, f.y - m.h - 34, 'GULPED ' + v.c.name, v.color, 1.3); Game.puff(f.x, f.y - m.h * 0.5, 9, '#ffe8c0'); Game.ring(f.x, f.y - m.h * 0.5, v.color, 70); }
          return;
        }
        if (mv.spit) {                                                    // rear back, then fire
          const s = mv.spit++;
          f.vx *= 0.72;
          if (s === 7) {
            v.x = f.x + f.face * (m.w * 0.5 + v.w * 0.45); v.y = f.y - 4;
            MV2.throwV(f, { dmg: 11, ang: 18, bkb: 68, kbg: 44 });
            v.tumble = true; v.hitstun = Math.max(v.hitstun, 34);
            const st = MV2.spawn(f, { kind: 'star', vx: 21, vy: -0.6, grav: 0, r: 26, dmg: 10, ang: 35, bkb: 44, kbg: 66, life: 40, pierce: true, color: '#ffe066' }, m.w * 0.5 + 16, m.h * 0.55);
            st.hitSet = new Set([v]);
            MV2.say(f, 'PTOO', 1.4); Sfx.tone(700, 180, 0.14, 'square', 0.13); Sfx.noise(0.16, 0.3, 1800);
            Game.shake(16); Game.flashT = Math.max(Game.flashT, 3);
            Game.rings.push({ x: f.x + f.face * m.w * 0.7, y: f.y - m.h * 0.55, r: 10, max: 150, color: '#ffe066', life: 16, w: 11 });
            Game.puff(f.x + f.face * m.w * 0.8, f.y - m.h * 0.55, 10, '#fff2c0');
            f.vx = -f.face * 3.5;
          }
          if (s > 26) f.endMove();
          return;
        }
        const dx = f.dirX();                                              // waddle with a full belly
        if (dx) { f.face = dx; f.vx = approach(f.vx, dx * m.walk * 0.42, 0.5); } else f.vx *= 0.82;
        for (const k of ['attack', 'special', 'jump', 'shield', 'left', 'right', 'up', 'down']) if (v.in[k] && !v.prev[k]) mv.mash = (mv.mash || 0) + 1;
        if ((mv.mash || 0) >= 14 && t > 26) {                             // mashed free
          MV2.drop(f); Game.text(f.x, f.y - m.h - 30, 'SPAT OUT', '#ffffff', 1.2); Game.puff(f.x + f.face * m.w * 0.6, f.y - m.h * 0.5, 10, '#ffe8c0');
          Sfx.tone(380, 160, 0.14, 'square', 0.12); Game.shake(8); mv.t = 150; return;
        }
        if (t >= 150 || f.pressed('special') || f.pressed('attack') || f.pressed('smash')) mv.spit = 1;
      },
    };
    m.moves2 = Object.assign({}, m.moves, {
      nb: INHALE,
      sb: Object.assign({}, MALLET, { start(f) { if (f.air) oldSb.start(f); } }),
    });
  }
}

// ===== identity pass (9/20 Duane): SPARK electric, KAIJU breathed fire, RONIN the sword =====
// All three go in `moves2`, the local-match move table (40_fighter.js picks it when Game.sigs is on),
// so the bet arena keeps replaying the version-1 sets exactly. Status effects (burn, stagger) come
// from STATUS in 65_balance.js, which is gated the same way.

// ---- SPARK: everything is electric now. The bolt bends through the air onto whoever it is chasing,
// and the charged one leaves them lit up and twitching. ----
{
  const s = CHAR_BY_ID.spark;
  if (s) {
    const HOME_AFTER = (p, b) => {
      STATUS.stagger(b, 24, '#ffe84a');
      STATUS.burn(b, p.owner, 36, 0.7);
      Game.ring(b.x, b.y - b.h * 0.5, '#fff3a0', 54); Sfx.tone(1500, 260, 0.1, 'square', 0.1);
    };
    const ARC = {
      total: 40, clip: 'cast', fx: 'thunder', color: '#ffe84a', shout: 'ARC',
      tick(f, t) {
        if (f.air) f.vy = Math.min(f.vy, 1.6);
        f.vx *= 0.82;
        if (t === 6) Sfx.tone(900, 120, 0.08, 'square', 0.07);
        if (t === 13 && Game.projCount(f, 'arcbolt') < 2) {
          MV2.spawn(f, { kind: 'arcbolt', vx: 9.5, vy: -1.4, grav: 0, r: 13, dmg: 6, ang: 42, bkb: 14, kbg: 26, life: 62,
            step: true, home: 0.17, color: '#ffe84a', after: HOME_AFTER }, s.w * 0.5 + 10, s.h * 0.62);
          Sfx.tone(1700, 220, 0.12, 'sawtooth', 0.1);
        }
      },
    };
    // the super: hold Special to wind it up (the crackle grows), let go and a fat bolt hunts them down.
    // On contact it staggers, then burns for about two seconds of small ticks.
    const SURGE_AFTER = (p, b) => {
      SIG(p, b);
      STATUS.stagger(b, 44, '#fff3a0');
      STATUS.burn(b, p.owner, 120, 1.2);
      Game.shock(b.x, b.y, '#fff3a0');
    };
    const SURGE = {
      total: 74, clip: 'cast', fx: 'thunder', color: '#fff3a0', shout: 'CHARGE', sigText: 'OVERLOAD', sfx: 'none',
      charge: { at: 12, key: 'special', max: 70, mult: 0.9 }, aiHold: [24, 70],
      tick(f, t) {
        if (f.air) f.vy = Math.min(f.vy, 1.2);
        f.vx *= 0.7;
        if (t === 12) { const c = f.move.charge; if (c && c % 4 === 0) Game.chargeSpark(f); if (c === 1) Sfx.tone(300, 900, 0.5, 'sawtooth', 0.05); }
        if (t === 20) {
          const k = f.move.charge / 70;                                  // how long it was held
          Sfx.tone(140, 420, 0.5, 'sawtooth', 0.16); Sfx.noise(0.3, 0.25, 900); Game.shake(8 + 8 * k); Game.flashT = Math.max(Game.flashT, 3);
          MV2.spawn(f, { kind: 'arcbolt', vx: 10, vy: -0.6, grav: 0, r: 20 + 12 * k, dmg: 9 + 7 * k, ang: 46, bkb: 30, kbg: 58, life: 70,
            step: true, home: 0.2, pierce: true, big: true, color: '#fff3a0', after: SURGE_AFTER }, s.w * 0.5 + 12, s.h * 0.6);
        }
      },
    };
    s.moves2 = Object.assign({}, s.moves, { nb: ARC, db: SURGE });
  }
}

// ---- KAIJU: the breath is the move. A held cone out of the mouth that shoves them back and leaves
// them burning, instead of the little puff it was. ----
{
  const k = CHAR_BY_ID.kaiju;
  if (k) {
    const BREATH_AFTER = (p, b) => {
      b.vx += (p.vx > 0 ? 1 : -1) * 1.9;                                 // the cone pushes
      if (b.air) b.vy = Math.min(b.vy, -0.6);
      STATUS.burn(b, p.owner, 54, 0.9);
    };
    const BREATH = mkStream({
      total: 104, from: 12, to: 88, min: 26, every: 2, drain: 0.013, fx: 'breath',
      fire(f, fuel) {
        const V = TK.rot(TK.aim(f), 7 + 6 * fuel, 0);                    // up / down aim tilts the cone
        MV2.spawn(f, { kind: 'flame', vx: V[0], vy: V[1] - 0.25, grav: -0.028, drag: 0.972, step: true,
          r: 16 + 8 * fuel, rgrow: 0.62, dmg: 1.35, ang: 28, bkb: 20, kbg: 5, life: 13 + 13 * fuel,
          color: '#ff7a1a', after: BREATH_AFTER }, k.w * 0.5 + 8, k.h * 0.78);
        if (f.move.t % 8 === 0) Sfx.noise(0.18, 0.12, 700);
      },
    });
    BREATH.shout = 'FIRE BREATH';
    k.moves2 = Object.assign({}, k.moves, { nb: BREATH });
  }
}

// ---- RONIN: a real sword set. Draw it slowly and it cuts deep, spin through them, or bring it down
// overhead through a guard. Long reach, slow to recover - you commit to every swing. ----
{
  const r = CHAR_BY_ID.ronin;
  if (r) {
    const B = r.blade || '#9fd8ff';
    // neutral: the draw. Held Special winds the cut up; the release is one long horizontal slash.
    const DRAW = {
      total: 78, clip: 'iaido', fx: 'iaido', weapon: B, color: B, shout: 'STEEL', sigText: 'ONE CUT', sfx: 'none',
      charge: { at: 14, key: 'special', max: 72, mult: 1.5 }, aiHold: [20, 72],
      hits: [H(26, 30, r.w * 0.5 + 56, -r.h * 0.5, 44, 13, 34, 42, 92, { after: SIG })],
      tick(f, t) {
        if (f.air) f.vy = Math.min(f.vy, 1.4);
        if (t === 14) { const c = f.move.charge; if (c === 1) Sfx.tone(520, 700, 0.35, 'sine', 0.06); if (c && c % 6 === 0) Game.chargeSpark(f); }
        if (t < 26) f.vx *= 0.72;
        else if (t <= 30) { f.vx = f.face * 3.6; if (t === 26) { Sfx.swing(); Sfx.tone(2200, 160, 0.1, 'sine', 0.09); Game.shake(6); } }
        else f.vx *= 0.9;                                                // long recovery: the sword is heavy
      },
    };
    // side: the spinning rush. He turns into a wheel of steel and carries through them.
    const SPIN = {
      total: 58, clip: 'spin', fx: 'spin', weapon: B, color: B, airOnce: 'side', shout: 'WHEEL', sfx: 'none',
      hits: [H(10, 36, r.w * 0.5 + 10, -r.h * 0.5, 40, 2.4, 60, 22, 12, { rehit: 5, after: LINK }),
        fin(H(38, 42, r.w * 0.5 + 24, -r.h * 0.5, 44, 8, 42, 46, 94))],
      tick(f, t) {
        if (t < 10) { f.vx *= 0.8; if (f.air) f.vy = Math.min(f.vy, 1); if (t === 6) Sfx.swing(); }
        else if (t <= 38) { f.vx = f.face * 12.5; if (f.air) f.vy = Math.min(f.vy, 0.9); if (t % 6 === 0) Sfx.tone(1800 + (t % 3) * 200, 90, 0.06, 'sine', 0.05); }
        else f.vx *= 0.84;
      },
    };
    // down: the overhead. Slow, telegraphed, and it goes straight through a shield - block is not an answer,
    // moving is. It is the one move that beats a turtle.
    const OVERHEAD = {
      total: 72, clip: 'slam', fx: 'slash', weapon: B, color: '#ffd45c', shout: 'NO GUARD', sigText: 'UNBLOCKABLE', sfx: 'none',
      hits: [H(30, 34, r.w * 0.5 + 34, -r.h * 0.35, 40, 17, 62, 48, 92, { pre: SHIELD_SMASH, after: SIG })],
      tick(f, t) {
        if (f.air) f.vy = Math.min(f.vy, 2);
        if (t < 30) { f.vx *= 0.7; if (t === 4) Sfx.tone(300, 600, 0.3, 'sine', 0.07); if (t === 18) Game.chargeSpark(f); }
        else if (t === 30) { Sfx.swing(); Game.shake(12); }
        else if (t === 34 && !f.air) { Game.shock(f.x + f.face * (r.w * 0.5 + 30), f.y, B); Sfx.hit(0.8); }
        else f.vx *= 0.88;
      },
    };
    r.moves2 = Object.assign({}, r.moves, { nb: DRAW, sb: SPIN, db: OVERHEAD });
    // the CPU's special picks for the sword set live in PROFILE.ronin (66_traits.js): that table is only
    // applied in local matches, so the arena's CPU keeps choosing exactly what it always chose
  }
}
