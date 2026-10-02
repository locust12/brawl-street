// ===== fighters: stats + move data =====
// Hitbox coords are relative to the fighter's feet, x forward, y negative = up.
// ang: launch angle in degrees (0 forward, 90 up, negative = spike). radial: launch away from attacker.

function H(f0, f1, x, y, r, dmg, ang, bkb, kbg, extra) { return Object.assign({ f: [f0, f1], x, y, r, dmg, ang, bkb, kbg }, extra || {}); }

function baseMoves(c) {
  const W = c.w, Hh = c.h, P = c.power, R = c.reach;
  const fx = W * 0.5;
  return {
    jab:    { total: 16, iasa: 11, hits: [H(3, 5, fx + 12 * R, -Hh * 0.5, 20 * R, 3 * P, 62, 16, 22)] },
    ftilt:  { total: 26, hits: [H(7, 10, fx + 22 * R, -Hh * 0.45, 24 * R, 8 * P, 35, 24, 70)] },
    utilt:  { total: 26, hits: [H(6, 10, 4, -Hh - 10, 28 * R, 7 * P, 88, 26, 76)] },
    dtilt:  { total: 20, hits: [H(5, 7, fx + 20 * R, -10, 20 * R, 6 * P, 26, 22, 58)] },
    fsmash: { total: 50, smash: true, charge: { at: 8, key: 'smash' }, hits: [H(14, 18, fx + 30 * R, -Hh * 0.45, 30 * R, 15 * P, 36, 32, 98)] },
    usmash: { total: 44, smash: true, charge: { at: 6, key: 'smash' }, hits: [H(10, 15, 0, -Hh - 20, 34 * R, 14 * P, 88, 32, 94)] },
    dsmash: { total: 44, smash: true, charge: { at: 5, key: 'smash' }, hits: [
      H(9, 12, fx + 20 * R, -10, 24 * R, 13 * P, 28, 30, 92), H(9, 12, -fx - 20 * R, -10, 24 * R, 13 * P, 28, 30, 92)] },
    nair: { total: 34, landLag: 8, hits: [H(5, 20, 0, -Hh * 0.5, W * 0.72, 8 * P, 42, 22, 72, { radial: true })] },
    fair: { total: 36, landLag: 12, hits: [H(9, 13, fx + 22 * R, -Hh * 0.5, 26 * R, 11 * P, 40, 28, 90)] },
    bair: { total: 32, landLag: 10, hits: [H(7, 10, -fx - 22 * R, -Hh * 0.5, 25 * R, 12 * P, 36, 30, 94)] },
    uair: { total: 30, landLag: 8, hits: [H(6, 10, 0, -Hh - 14, 30 * R, 9 * P, 86, 26, 86)] },
    dair: { total: 40, landLag: 16, hits: [H(12, 15, 0, 12, 26 * R, 12 * P, -80, 24, 80)] },
    grab: { total: 30, hits: [H(6, 8, fx + 18, -Hh * 0.5, 22, 0, 0, 0, 0, { grab: true })] },
    getup: { total: 30, hits: [H(10, 14, fx + 20, -Hh * 0.3, 30, 7, 30, 42, 40)] },
    throws: {
      f: { dmg: 8 * P, ang: 40, bkb: 62, kbg: 62, dir: 1 },
      b: { dmg: 10 * P, ang: 40, bkb: 62, kbg: 72, dir: -1 },
      u: { dmg: 7 * P, ang: 90, bkb: 70, kbg: 62, dir: 1 },
      d: { dmg: 6 * P, ang: 70, bkb: 55, kbg: 42, dir: 1 },
    },
  };
}

// ---- special move builders ----
function mkProj({ total = 36, at = 12, max = 2, proj, sfx = 'swing' }) {
  return {
    total, sfx,
    tick(f, t) {
      if (t === at) {
        if (Game.projCount(f, proj.kind) >= max) return;
        Game.spawnProj(f, proj);
      }
      if (f.air) f.vy = Math.min(f.vy, 3);
    },
  };
}
function mkDash({ total = 38, a = 6, b = 22, speed = 13, lift = 0, hit, air = {} }) {
  return {
    total, airOnce: 'side', sfx: 'swing',
    hits: [Object.assign({}, hit, { f: [a, b] })],
    tick(f, t) {
      if (t === a && (lift || (f.air && air.lift))) f.vy = -(lift + (f.air ? (air.lift || 0) : 0));
      if (t >= a && t <= b) {
        f.vx = f.face * speed;
        if (f.air && t > a) f.vy = Math.min(f.vy, 1.5 + (air.drop || 0));
        else if (!f.air && !lift) f.vy = 0;
      } else if (t > b) f.vx *= 0.8;
    },
  };
}
function mkRise({ total = 44, at = 6, vy = -17, steer = 3, hold = 0, hits, flaps, glide }) {
  return {
    total, helpless: true, airOnce: 'up', sfx: 'jump', hits, glide,
    tick(f, t) {
      const inp = f.in;
      const dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
      if (flaps) { if (flaps.includes(t)) { f.vy = vy; Sfx.jump(); Game.burst(f.x, f.y, f.look.fur, 6); } }
      else if (t === at || (hold && t > at && t <= at + hold)) f.vy = vy;
      if (t >= at) { f.vx = lerp(f.vx, dir * steer * 1.6, 0.15); }
      if (t >= at && t < at + 18) Game.trail(f);
      if (glide && t > glide) f.vy = Math.min(f.vy, 1.6);
    },
  };
}
function mkSlam({ ground, air }) {
  // ground: a plain move; air: fast drop with a spike box, lands into a shockwave
  const a = Object.assign({
    total: 200, sfx: 'swing',
    tick(f, t) { if (t < 6) { f.vy = -3; f.vx *= 0.5; } else f.vy = air.drop || 15; f.vx *= 0.9; },
    onLand(f) { f.startMove(this.land, true); Game.shake(8); Sfx.hit(0.6); Game.shock(f.x, f.y, f.look.fur); },
  }, air);
  return { ground, air: a };
}

const CHARS = [
  {
    id: 'doge', name: 'DOGE', title: 'Much Wow', blurb: 'Balanced all-rounder. Coin toss, moon rocket.',
    w: 58, h: 76, walk: 6.2, air: 4.6, grav: 0.62, fall: 11, jump: 14.6, djump: 13.6, jumps: 1, weight: 100, power: 1, reach: 1,
    look: { kind: 'dog', fur: '#f2b43c', belly: '#fff0cf', ear: '#d98a1f', dark: '#5a3510', eye: 'side', acc: 'coin' },
    specials: c => ({
      nb: mkProj({ max: 2, proj: { kind: 'coin', vx: 9, vy: -5.5, grav: 0.32, r: 14, dmg: 6, ang: 45, bkb: 22, kbg: 45, life: 90 } }),
      sb: mkDash({ speed: 13, hit: H(0, 0, c.w * 0.5, -c.h * 0.5, 26, 10, 38, 40, 70) }),
      ub: mkRise({ vy: -17.5, hits: [H(6, 20, 0, -c.h * 0.6, 32, 7, 80, 40, 60)] }),
      db: mkSlam({
        ground: { total: 36, hits: [H(10, 14, c.w * 0.5 + 30, -12, 30, 12, 40, 40, 80), H(10, 14, -c.w * 0.5 - 30, -12, 30, 12, 40, 40, 80)] },
        air: { hits: [H(6, 199, 0, 6, 26, 10, -70, 24, 70)], land: { total: 26, hits: [H(1, 5, 0, -14, 70, 8, 60, 50, 40, { radial: true })] } },
      }),
    }),
  },
  {
    id: 'shib', name: 'SHIB', title: 'Leash Runner', blurb: 'Fastest and lightest. Boomerang bone, counter.',
    w: 52, h: 70, walk: 7.6, air: 5.2, grav: 0.7, fall: 12, jump: 15, djump: 14, jumps: 1, weight: 84, power: 0.92, reach: 0.95,
    look: { kind: 'dog', fur: '#e8582c', belly: '#fff3e6', ear: '#b83c17', dark: '#3a1407', eye: 'fierce', acc: 'bandana' },
    specials: c => ({
      nb: mkProj({ max: 1, total: 30, at: 9, proj: { kind: 'bone', vx: 12.5, vy: 0, grav: 0, r: 15, dmg: 5, ang: 50, bkb: 26, kbg: 40, life: 84, boomer: 26 } }),
      sb: mkDash({ total: 32, a: 5, b: 16, speed: 17, hit: H(0, 0, c.w * 0.5, -c.h * 0.45, 24, 8, 45, 36, 62) }),
      ub: mkRise({ total: 40, at: 4, vy: -12, hold: 20, steer: 4, hits: [
        H(4, 22, 0, -c.h * 0.5, 38, 3, 86, 34, 16, { rehit: 5, radial: true }), H(23, 26, 0, -c.h * 0.5, 40, 5, 60, 44, 92, { radial: true })] }),
      db: { total: 40, counter: [4, 24], sfx: 'shield' },
    }),
  },
  {
    id: 'pepe', name: 'PEPE', title: 'Rare Leaper', blurb: 'Floaty, three jumps. Long tongue lash.',
    w: 56, h: 72, walk: 5.8, air: 4.9, grav: 0.5, fall: 9, jump: 15.5, djump: 12.6, jumps: 2, weight: 92, power: 0.96, reach: 1,
    look: { kind: 'frog', fur: '#56b847', belly: '#d9efa9', ear: '#3f8f33', dark: '#1d4a18', eye: 'frog', acc: 'lips' },
    specials: c => ({
      nb: { total: 40, sfx: 'swing', tongue: [12, 18], hits: [0, 1, 2, 3, 4, 5].map(i => H(12, 18, c.w * 0.5 + 18 + i * 36, -c.h * 0.6, 16, 8, 30, 30, 52)),
            tick(f) { if (f.air) f.vy = Math.min(f.vy, 2); } },
      sb: mkDash({ total: 36, a: 6, b: 20, speed: 10, lift: 7, air: { lift: 2 }, hit: H(0, 0, c.w * 0.5 + 8, -c.h * 0.35, 26, 10, 40, 34, 76) }),
      ub: mkRise({ at: 5, vy: -19.5, hits: [H(5, 14, 0, -c.h * 0.5, 30, 6, 85, 36, 50, { radial: true })] }),
      db: mkSlam({
        ground: { total: 34, hits: [H(14, 18, c.w * 0.4, -8, 36, 11, 50, 36, 78), H(14, 18, -c.w * 0.4, -8, 36, 11, 50, 36, 78)] },
        air: { drop: 16, hits: [H(6, 199, 0, 0, 36, 12, -60, 26, 72)], land: { total: 24, hits: [H(1, 4, 0, -10, 64, 6, 55, 46, 36, { radial: true })] } },
      }),
    }),
  },
  {
    id: 'bonk', name: 'BONK', title: 'Home Run King', blurb: 'Heavy hitter. Charge the bat and send them.',
    w: 62, h: 78, walk: 5.4, air: 4.2, grav: 0.66, fall: 11.5, jump: 14.2, djump: 13, jumps: 1, weight: 112, power: 1.15, reach: 1.12,
    look: { kind: 'dog', fur: '#f59d2a', belly: '#fff0d6', ear: '#c96f10', dark: '#4a2604', eye: 'happy', acc: 'bat' },
    specials: c => ({
      nb: { total: 40, sfx: 'swing', charge: { at: 8, key: 'special', max: 70, mult: 1.1 }, bonk: true,
            hits: [H(14, 18, c.w * 0.5 + 40, -c.h * 0.5, 38, 12, 40, 40, 100)] },
      sb: mkDash({ total: 40, a: 6, b: 24, speed: 11, hit: H(0, 0, c.w * 0.5 + 18, -c.h * 0.5, 30, 11, 35, 40, 82) }),
      ub: mkRise({ total: 50, at: 4, vy: -9.5, hold: 32, steer: 4, hits: [
        H(4, 34, 0, -c.h * 0.7, 44, 2.5, 90, 30, 14, { rehit: 6, radial: true }), H(36, 40, 0, -c.h * 0.7, 46, 6, 65, 44, 110, { radial: true })] }),
      db: mkSlam({
        ground: { total: 44, hits: [H(16, 20, c.w * 0.5 + 30, -10, 36, 16, 82, 50, 86)] },
        air: { drop: 16, hits: [H(6, 199, 0, 4, 30, 14, -85, 26, 82)], land: { total: 30, hits: [H(1, 5, 0, -10, 72, 9, 70, 50, 50, { radial: true })] } },
      }),
    }),
  },
  {
    id: 'wif', name: 'WIF', title: 'Dog Wif Hat', blurb: 'Hat boomerang, sliding tackle, slow glide home.',
    w: 56, h: 80, walk: 6.4, air: 4.8, grav: 0.6, fall: 10.5, jump: 14.4, djump: 13.4, jumps: 1, weight: 95, power: 1, reach: 1,
    look: { kind: 'dog', fur: '#d9a86c', belly: '#fff4e3', ear: '#b07d42', dark: '#3b2410', eye: 'dot', acc: 'hat' },
    specials: c => ({
      nb: mkProj({ max: 1, total: 32, at: 10, proj: { kind: 'hat', vx: 10.5, vy: -1, grav: 0, r: 17, dmg: 7, ang: 50, bkb: 30, kbg: 50, life: 90, boomer: 30 } }),
      sb: mkDash({ total: 40, a: 4, b: 22, speed: 12, air: { drop: 5 }, hit: H(0, 0, c.w * 0.5, -12, 24, 9, 75, 40, 55) }),
      ub: mkRise({ total: 150, at: 5, vy: -15.5, glide: 24, hits: [H(5, 14, 0, -c.h * 0.55, 30, 6, 85, 36, 52, { radial: true })] }),
      db: mkSlam({
        ground: { total: 24, hits: [H(6, 9, c.w * 0.5 + 12, -8, 24, 8, 72, 40, 50)] },
        air: { drop: 14, hits: [H(6, 199, 0, 4, 26, 10, -75, 24, 72)], land: { total: 20, hits: [] } },
      }),
    }),
  },
  {
    id: 'pengu', name: 'PENGU', title: 'Pudgy Tank', blurb: 'Heaviest. Snowballs and a belly slide.',
    w: 66, h: 72, walk: 5, air: 4, grav: 0.72, fall: 12.5, jump: 13.8, djump: 12.6, jumps: 1, weight: 120, power: 1.1, reach: 1.04,
    look: { kind: 'bird', fur: '#3b5bd6', belly: '#f4f8ff', ear: '#2a3f9e', dark: '#0e1a4a', eye: 'dot', acc: 'scarf' },
    specials: c => ({
      nb: mkProj({ max: 2, total: 34, at: 11, proj: { kind: 'snow', vx: 13, vy: -1.5, grav: 0.12, r: 14, dmg: 7, ang: 40, bkb: 28, kbg: 45, life: 70 } }),
      sb: mkDash({ total: 52, a: 6, b: 40, speed: 12, air: { drop: 3 }, hit: H(0, 0, c.w * 0.5, -16, 26, 9, 40, 40, 66) }),
      ub: mkRise({ total: 54, vy: -11.5, flaps: [4, 16, 28], hits: [0, 12, 24].map(o => H(4 + o, 10 + o, 0, -c.h * 0.5, 38, 4, 80, 30, 40, { radial: true }))
        .concat([H(28, 34, 0, -c.h * 0.5, 40, 5, 70, 44, 80, { radial: true })]) }),
      db: mkSlam({
        ground: { total: 40, hits: [H(14, 18, c.w * 0.5 + 26, -12, 34, 14, 45, 44, 84), H(14, 18, -c.w * 0.5 - 26, -12, 34, 14, 45, 44, 84)] },
        air: { drop: 17, hits: [H(6, 199, 0, 4, 32, 13, -80, 26, 80)], land: { total: 28, hits: [H(1, 5, 0, -12, 70, 8, 60, 50, 44, { radial: true })] } },
      }),
    }),
  },
  {
    id: 'floki', name: 'FLOKI', title: 'Viking Dog', blurb: 'Heavy viking. Throws axes, horn slam.',
    w: 60, h: 78, walk: 5.8, air: 4.4, grav: 0.64, fall: 11.5, jump: 14.4, djump: 13.2, jumps: 1, weight: 108, power: 1.1, reach: 1.06,
    look: { kind: 'dog', fur: '#f08a24', belly: '#fff6ea', ear: '#c9601a', dark: '#3a1a06', eye: 'happy', acc: 'none' },
    specials: c => ({
      nb: Object.assign(mkProj({ max: 2, total: 36, at: 12, proj: { kind: 'axe', vx: 10, vy: -6.5, grav: 0.36, r: 17, dmg: 9, ang: 42, bkb: 32, kbg: 62, life: 80 } }), { shout: 'SKÅL' }),
      sb: mkDash({ total: 42, a: 6, b: 24, speed: 12.5, hit: H(0, 0, c.w * 0.5, -c.h * 0.45, 30, 12, 38, 46, 84) }),
      ub: mkRise({ at: 5, vy: -17, hits: [H(5, 20, 0, -c.h * 0.6, 36, 8, 82, 40, 62, { radial: true })] }),
      db: mkSlam({
        ground: { total: 40, hits: [H(14, 18, c.w * 0.5 + 26, -12, 34, 15, 50, 44, 88), H(14, 18, -c.w * 0.5 - 26, -12, 34, 15, 50, 44, 88)] },
        air: { drop: 16, hits: [H(6, 199, 0, 4, 30, 13, -80, 26, 82)], land: { total: 28, hits: [H(1, 5, 0, -12, 72, 8, 60, 50, 44, { radial: true })] } },
      }),
    }),
  },
  {
    id: 'cheems', name: 'CHEEMS', title: 'Suit Shiba', blurb: 'Balanced exec. Cash toss, counter.',
    w: 56, h: 76, walk: 6.3, air: 4.7, grav: 0.62, fall: 11, jump: 14.6, djump: 13.5, jumps: 1, weight: 98, power: 1, reach: 1,
    look: { kind: 'dog', fur: '#e0a95a', belly: '#fff0d6', ear: '#b27a2a', dark: '#3a2206', eye: 'side', acc: 'none' },
    specials: c => ({
      nb: mkProj({ max: 3, total: 28, at: 9, proj: { kind: 'cash', vx: 14, vy: 0, grav: 0, r: 14, dmg: 6, ang: 35, bkb: 24, kbg: 40, life: 60 } }),
      sb: mkDash({ total: 36, a: 5, b: 20, speed: 14, hit: H(0, 0, c.w * 0.5, -c.h * 0.5, 26, 10, 40, 40, 70) }),
      ub: mkRise({ vy: -17.5, hits: [H(6, 18, 0, -c.h * 0.6, 32, 7, 82, 40, 58)] }),
      db: { total: 40, counter: [4, 24], sfx: 'shield', shout: 'MUCH SAFE' },
    }),
  },
  {
    id: 'cashcat', name: 'CASHCAT', title: 'Sad Money', blurb: 'Agile cat, three jumps. Tears and claws.',
    w: 52, h: 72, walk: 7.2, air: 5.3, grav: 0.6, fall: 11, jump: 15.2, djump: 13.2, jumps: 2, weight: 82, power: 0.94, reach: 0.96,
    look: { kind: 'dog', fur: '#e8dccb', belly: '#ffffff', ear: '#c8b8a0', dark: '#3a3028', eye: 'dot', acc: 'none' },
    specials: c => ({
      nb: Object.assign(mkProj({ max: 3, total: 26, at: 8, proj: { kind: 'tear', vx: 8, vy: -7, grav: 0.4, r: 12, dmg: 5, ang: 50, bkb: 22, kbg: 36, life: 70 } }), { shout: 'CRY' }),
      sb: mkDash({ total: 36, a: 5, b: 20, speed: 14, hit: H(0, 0, c.w * 0.5, -c.h * 0.45, 26, 3, 50, 20, 16, { rehit: 4 }) }),
      ub: mkRise({ at: 4, vy: -19, hits: [H(4, 14, 0, -c.h * 0.5, 30, 6, 84, 36, 50, { radial: true })] }),
      db: mkSlam({
        ground: { total: 30, hits: [H(9, 13, c.w * 0.4, -10, 30, 9, 60, 36, 70), H(9, 13, -c.w * 0.4, -10, 30, 9, 60, 36, 70)] },
        air: { drop: 15, hits: [H(6, 199, 0, 2, 26, 9, -70, 24, 70)], land: { total: 20, hits: [] } },
      }),
    }),
  },
  {
    id: 'lobster', name: 'LOBSTER', title: 'AI Claw', blurb: 'Tank with reach. Claw snap, shell slam.',
    w: 62, h: 74, walk: 5.3, air: 4.3, grav: 0.66, fall: 11.5, jump: 14, djump: 12.8, jumps: 1, weight: 115, power: 1.08, reach: 1.2,
    look: { kind: 'frog', fur: '#e8322a', belly: '#ff8a7a', ear: '#b8201a', dark: '#4a0a06', eye: 'frog', acc: 'none' },
    specials: c => ({
      nb: { total: 40, sfx: 'swing', shout: 'SNAP', hits: [0, 1, 2].map(i => H(12, 17, c.w * 0.5 + 24 + i * 34, -c.h * 0.5, 22, 11, 36, 36, 66)), tick(f) { if (f.air) f.vy = Math.min(f.vy, 2); } },
      sb: mkDash({ total: 40, a: 6, b: 26, speed: 11, hit: H(0, 0, c.w * 0.5 + 10, -c.h * 0.4, 30, 11, 30, 42, 76) }),
      ub: mkRise({ total: 46, at: 4, vy: -10, hold: 26, steer: 4, hits: [H(4, 30, 0, -c.h * 0.5, 40, 3, 88, 30, 16, { rehit: 5, radial: true }), H(31, 34, 0, -c.h * 0.5, 42, 6, 62, 44, 96, { radial: true })] }),
      db: mkSlam({
        ground: { total: 42, hits: [H(15, 19, c.w * 0.5 + 28, -12, 36, 16, 45, 46, 88), H(15, 19, -c.w * 0.5 - 28, -12, 36, 16, 45, 46, 88)] },
        air: { drop: 17, hits: [H(6, 199, 0, 4, 32, 13, -80, 26, 80)], land: { total: 28, hits: [H(1, 5, 0, -12, 72, 8, 60, 50, 44, { radial: true })] } },
      }),
    }),
  },
  {
    id: 'wojak', name: 'WOJAK', title: 'Feels Guy', blurb: 'Tricky. Cope tears, panic dash, counter.',
    w: 54, h: 78, walk: 6.4, air: 4.9, grav: 0.58, fall: 10.5, jump: 15, djump: 13.6, jumps: 1, weight: 88, power: 0.96, reach: 1,
    look: { kind: 'frog', fur: '#f0d9b5', belly: '#e8c898', ear: '#c9a878', dark: '#4a3a28', eye: 'dot', acc: 'none' },
    specials: c => ({
      nb: Object.assign(mkProj({ max: 2, total: 34, at: 12, proj: { kind: 'tear', vx: 6, vy: -2, grav: 0.07, r: 18, dmg: 7, ang: 45, bkb: 30, kbg: 44, life: 120 } }), { shout: 'COPE' }),
      sb: Object.assign(mkDash({ total: 40, a: 4, b: 24, speed: 15, hit: H(0, 0, c.w * 0.5, -c.h * 0.5, 26, 9, 40, 38, 66) }), { shout: 'PANIC SELL' }),
      ub: mkRise({ vy: -17.5, hits: [H(6, 18, 0, -c.h * 0.6, 32, 7, 82, 40, 58)] }),
      db: { total: 40, counter: [4, 26], sfx: 'shield', shout: 'FEELS' },
    }),
  },
  {
    id: 'topg', name: 'TOP G', title: 'Alpha Parody', blurb: 'Bruiser. Charged punch, Bugatti dash.',
    w: 62, h: 80, walk: 5.6, air: 4.2, grav: 0.68, fall: 12, jump: 14, djump: 12.8, jumps: 1, weight: 118, power: 1.2, reach: 1.05,
    look: { kind: 'dog', fur: '#c98f6a', belly: '#e8b894', ear: '#a06a48', dark: '#2a1608', eye: 'fierce', acc: 'none' },
    specials: c => ({
      nb: { total: 42, sfx: 'swing', shout: 'TOP G', charge: { at: 8, key: 'special', max: 70, mult: 1.1 }, hits: [H(14, 18, c.w * 0.5 + 30, -c.h * 0.55, 34, 13, 38, 44, 100)] },
      sb: Object.assign(mkDash({ total: 44, a: 6, b: 22, speed: 18, hit: H(0, 0, c.w * 0.5 + 10, -c.h * 0.4, 32, 14, 32, 50, 90) }), { shout: 'BUGATTI' }),
      ub: mkRise({ at: 5, vy: -17, hits: [H(5, 16, c.w * 0.3, -c.h * 0.9, 34, 11, 85, 44, 80)] }),
      db: mkSlam({
        ground: { total: 44, hits: [H(16, 20, c.w * 0.5 + 30, -10, 36, 16, 82, 50, 86)] },
        air: { drop: 17, hits: [H(6, 199, 0, 4, 30, 14, -85, 26, 84)], land: { total: 30, hits: [H(1, 5, 0, -10, 72, 9, 70, 50, 50, { radial: true })] } },
      }),
    }),
  },
  {
    id: 'trump', name: 'TRUMP', title: 'Big Coin Energy', blurb: 'Heavy. Tariff gold bar, yuge slam.',
    w: 62, h: 80, walk: 5.5, air: 4.3, grav: 0.66, fall: 11.5, jump: 14.2, djump: 13, jumps: 1, weight: 112, power: 1.12, reach: 1.04,
    look: { kind: 'dog', fur: '#f3b28a', belly: '#1f3a8a', ear: '#f0c050', dark: '#2a1a10', eye: 'side', acc: 'none' },
    specials: c => ({
      nb: Object.assign(mkProj({ max: 2, total: 34, at: 11, proj: { kind: 'goldbar', vx: 9.5, vy: -6, grav: 0.4, r: 16, dmg: 10, ang: 40, bkb: 34, kbg: 64, life: 80 } }), { shout: 'TARIFF' }),
      sb: Object.assign(mkDash({ total: 40, a: 6, b: 22, speed: 13, hit: H(0, 0, c.w * 0.5, -c.h * 0.5, 30, 11, 36, 44, 78) }), { shout: 'RALLY' }),
      ub: Object.assign(mkRise({ vy: -18, hits: [H(6, 20, 0, -c.h * 0.6, 34, 8, 82, 42, 62)] }), { shout: 'AIR FORCE ONE' }),
      db: Object.assign(mkSlam({
        ground: { total: 42, hits: [H(15, 19, c.w * 0.5 + 30, -12, 36, 16, 48, 46, 90), H(15, 19, -c.w * 0.5 - 30, -12, 36, 16, 48, 46, 90)] },
        air: { drop: 17, hits: [H(6, 199, 0, 4, 30, 14, -80, 26, 82)], land: { total: 30, hits: [H(1, 5, 0, -12, 74, 9, 62, 50, 46, { radial: true })] } },
      }), { shout: 'YUGE' }),
    }),
  },
  {
    id: 'clanker', name: 'CLANKER', title: 'Chrome Android', blurb: 'Laser eyes, rocket dash, EMP blast.',
    w: 56, h: 84, walk: 6.1, air: 4.7, grav: 0.64, fall: 11.5, jump: 14.6, djump: 13.4, jumps: 1, weight: 104, power: 1.05, reach: 1.05,
    look: { kind: 'bird', fur: '#c8ccd4', belly: '#eef0f4', ear: '#8a8e98', dark: '#2a2c30', eye: 'dot', acc: 'none' },
    specials: c => ({
      nb: Object.assign(mkProj({ max: 2, total: 26, at: 8, proj: { kind: 'laser', vx: 24, vy: 0, grav: 0, r: 10, dmg: 6, ang: 25, bkb: 24, kbg: 36, life: 36 } }), { shout: 'BEEP' }),
      sb: Object.assign(mkDash({ total: 38, a: 5, b: 22, speed: 16, hit: H(0, 0, c.w * 0.5, -c.h * 0.5, 28, 11, 36, 44, 76) }), { shout: 'ROCKET' }),
      ub: mkRise({ vy: -17.5, hold: 8, hits: [H(6, 22, 0, -c.h * 0.3, 30, 7, 82, 40, 58)] }),
      db: Object.assign(mkSlam({
        ground: { total: 40, hits: [H(12, 18, 0, -c.h * 0.5, 92, 13, 55, 46, 82, { radial: true })] },
        air: { drop: 16, hits: [H(6, 199, 0, 4, 30, 12, -80, 26, 80)], land: { total: 28, hits: [H(1, 6, 0, -14, 90, 10, 60, 50, 50, { radial: true })] } },
      }), { shout: 'EMP' }),
    }),
  },
];
CHARS.forEach(c => { c.moves = Object.assign(baseMoves(c), c.specials(c)); });
const CHAR_BY_ID = Object.fromEntries(CHARS.map(c => [c.id, c]));
