// ===== fighters, wave 3 (session 61118e0c): meme coins, market archetypes, Robinhood Chain cameos =====
// Loaded after 20_chars.js + 21_roster2.js and pushed onto CHARS / CHAR_BY_ID. Not in ARENA.roster, so bet-arena
// fights are unchanged. A fighter only joins the roster once its model exists (MORE_READY);
// the rest are written and wait for their 3D model (see assets3d/jobs4.json).
// New projectile kinds (stink, redcandle, seam, shades, greencandle, arrow, cube) draw with the
// renderer's default orb until src/96_v3_more.mjs gives them their own mesh. Uses the opt-in move
// flags from 21_roster2.js (mkCgrab/MV2 swallow, vanish, armor), resolved at run time.

const MORE_READY = ['bogdanoff', 'fartcoin', 'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'brett', 'moodeng'];

function mkPhase(d, a, b) {
  // intangible during frames a..b of a move (shadow steps)
  const tk = d.tick;
  d.tick = (f, t) => { tk(f, t); if (t >= a && t <= b) f.intang = true; };
  return d;
}

const CHARS_MORE = [
  {
    id: 'bogdanoff', name: 'BOGDANOFF', title: 'He Bought?', blurb: 'Tricky. Dump-it call spikes, pump jump, counter.',
    w: 54, h: 84, walk: 6.2, air: 4.8, grav: 0.6, fall: 11, jump: 14.8, djump: 13.6, jumps: 1, weight: 96, power: 1.02, reach: 1.05,
    look: { kind: 'dog', fur: '#f0c7a4', belly: '#15151a', ear: '#e6cf8a', dark: '#2a1a10', eye: 'side', acc: 'none' },
    specials: c => ({
      nb: Object.assign(mkProj({ max: 2, total: 34, at: 11, proj: { kind: 'redcandle', color: '#ff3b30', vx: 8, vy: -4, grav: 0.5, r: 15, dmg: 9, ang: -60, bkb: 24, kbg: 60, life: 80 } }), { shout: 'DUMP IT' }),
      sb: Object.assign(mkDash({ total: 38, a: 5, b: 20, speed: 14, hit: H(0, 0, c.w * 0.5, -c.h * 0.5, 26, 10, 40, 40, 70) }), { shout: 'HE BOUGHT?' }),
      ub: Object.assign(mkRise({ vy: -18, hits: [H(6, 18, 0, -c.h * 0.6, 32, 7, 82, 40, 60)] }), { shout: 'PUMP IT' }),
      db: { total: 40, counter: [4, 24], sfx: 'shield', shout: 'HE SOLD' },
    }),
  },
  {
    id: 'fartcoin', name: 'FARTCOIN', title: 'Hot Air', blurb: 'Floaty, three jumps. Stink clouds, toot jump, stink bomb.',
    w: 56, h: 76, walk: 6.3, air: 5, grav: 0.54, fall: 10, jump: 15, djump: 13, jumps: 2, weight: 98, power: 1.06, reach: 1.02,
    look: { kind: 'frog', fur: '#9be15d', belly: '#d9f5b8', ear: '#6fbf3a', dark: '#1d4a18', eye: 'happy', acc: 'none' },
    specials: c => ({
      nb: Object.assign(mkProj({ max: 2, total: 36, at: 12, proj: { kind: 'stink', color: '#9be15d', vx: 5, vy: -0.4, grav: 0, r: 30, dmg: 10, ang: 55, bkb: 34, kbg: 54, life: 90 } }), { shout: 'PFFT' }),
      sb: Object.assign(mkDash({ total: 38, a: 4, b: 20, speed: 15, lift: 4, air: { lift: 3 }, hit: H(0, 0, c.w * 0.5, -c.h * 0.45, 28, 9, 45, 36, 66) }), { shout: 'TOOT' }),
      ub: Object.assign(mkRise({ total: 54, vy: -12, flaps: [4, 16, 28], hits: [0, 12, 24].map(o => H(4 + o, 10 + o, 0, 10, 40, 4, -80, 24, 40))
        .concat([H(28, 34, 0, -c.h * 0.5, 42, 5, 70, 44, 78, { radial: true })]) }), { shout: 'TOOT TOOT' }),
      db: Object.assign(mkSlam({
        ground: { total: 40, hits: [H(12, 18, 0, -c.h * 0.4, 86, 11, 55, 44, 78, { radial: true })] },
        air: { drop: 15, hits: [H(6, 199, 0, 4, 30, 11, -75, 24, 74)], land: { total: 28, hits: [H(1, 6, 0, -14, 88, 10, 60, 50, 50, { radial: true })] } },
      }), { shout: 'STINK BOMB' }),
    }),
  },
  {
    id: 'bull', name: 'BULL', title: 'Green Candle', blurb: 'Heavy charger. Horn rush launches them up.',
    w: 64, h: 84, walk: 5.8, air: 4.4, grav: 0.68, fall: 12, jump: 14.2, djump: 13, jumps: 1, weight: 118, power: 1.2, reach: 1.08,
    look: { kind: 'dog', fur: '#6a3f22', belly: '#a8784e', ear: '#4a2a14', dark: '#1e1008', eye: 'fierce', acc: 'none' },
    specials: c => ({
      nb: { total: 42, sfx: 'swing', shout: 'SEND IT', charge: { at: 8, key: 'special', max: 70, mult: 1.1 }, hits: [H(14, 18, c.w * 0.5 + 24, -c.h * 0.6, 34, 13, 75, 44, 96)] },
      sb: Object.assign(mkDash({ total: 46, a: 6, b: 28, speed: 16, hit: H(0, 0, c.w * 0.5 + 10, -c.h * 0.5, 32, 14, 50, 50, 92) }), { shout: 'BULL RUN' }),
      ub: Object.assign(mkRise({ at: 5, vy: -16.5, hits: [H(5, 18, 0, -c.h * 0.8, 36, 9, 86, 42, 70)] }), { shout: 'PUMP' }),
      db: Object.assign(mkSlam({
        ground: { total: 42, hits: [H(15, 19, c.w * 0.5 + 28, -12, 36, 15, 50, 46, 88), H(15, 19, -c.w * 0.5 - 28, -12, 36, 15, 50, 46, 88)] },
        air: { drop: 17, hits: [H(6, 199, 0, 4, 32, 13, -80, 26, 82)], land: { total: 30, hits: [H(1, 5, 0, -12, 74, 9, 62, 50, 46, { radial: true })] } },
      }), { shout: 'STAMPEDE' }),
    }),
  },
  {
    id: 'bear', name: 'BEAR', title: 'Red Candle', blurb: 'Heavy. Claw swipes, crashes that spike them down.',
    w: 64, h: 84, walk: 5.3, air: 4.2, grav: 0.7, fall: 12.5, jump: 13.8, djump: 12.6, jumps: 1, weight: 122, power: 1.15, reach: 1.08,
    look: { kind: 'dog', fur: '#5a3a24', belly: '#8a6446', ear: '#3a2414', dark: '#1a0e06', eye: 'fierce', acc: 'none' },
    specials: c => ({
      nb: { total: 40, sfx: 'swing', shout: 'SWIPE', hits: [H(10, 13, c.w * 0.5 + 20, -c.h * 0.55, 30, 6, 40, 20, 30), H(18, 22, c.w * 0.5 + 24, -c.h * 0.45, 32, 10, 34, 42, 80)],
            tick(f) { if (f.air) f.vy = Math.min(f.vy, 2); } },
      sb: Object.assign(mkDash({ total: 42, a: 6, b: 22, speed: 12.5, hit: H(0, 0, c.w * 0.5 + 8, -c.h * 0.45, 32, 12, 22, 44, 84) }), { shout: 'MAUL' }),
      ub: mkRise({ at: 5, vy: -16.5, hits: [H(5, 18, 0, -c.h * 0.6, 36, 8, 82, 40, 62, { radial: true })] }),
      db: Object.assign(mkSlam({
        ground: { total: 44, hits: [H(16, 20, c.w * 0.5 + 30, -10, 38, 16, 45, 48, 90)] },
        air: { drop: 18, hits: [H(6, 199, 0, 4, 32, 15, -88, 28, 88)], land: { total: 30, hits: [H(1, 5, 0, -12, 76, 9, 60, 50, 48, { radial: true })] } },
      }), { shout: 'CRASH' }),
    }),
  },
  {
    id: 'whale', name: 'WHALE', title: 'Deep Pockets', blurb: 'Heaviest. Water spout, swallow and spit, belly flop.',
    w: 70, h: 82, walk: 4.8, air: 3.9, grav: 0.74, fall: 13, jump: 13.6, djump: 12.2, jumps: 1, weight: 128, power: 1.15, reach: 1.1,
    look: { kind: 'bird', fur: '#1f3f8f', belly: '#e8eef8', ear: '#15306e', dark: '#0a1638', eye: 'dot', acc: 'none' },
    ai2: [['sb', 'grab'], ['nb', 'zone'], ['db', 'slam'], ['ub', 'up']],
    specials: c => {
      const gulp = {
        total: 44, holdVictim: true, swallow: true, clip: 'guard', sfx: 'none',
        tick(f, t) {
          MV2.hold(f, 0, 0);
          if (f.air) f.vy = Math.min(f.vy, 2.5);
          if (t === 26) {
            const v = f.grabbed;
            if (v) { v.x = f.x + f.face * (c.w * 0.5 + v.w * 0.45); v.y = f.y - 4; MV2.throwV(f, { dmg: 9, ang: 30, bkb: 50, kbg: 48 }); }
            MV2.say(f, 'SPLOOSH'); Sfx.hit(0.5);
          }
        },
      };
      return {
      nb: Object.assign(mkProj({ max: 2, total: 36, at: 12, proj: { kind: 'tear', vx: 7.5, vy: -3, grav: 0.18, r: 22, dmg: 9, ang: 45, bkb: 32, kbg: 54, life: 80 } }), { shout: 'SPLASH' }),
      sb: Object.assign(mkCgrab({ total: 42, a: 10, b: 16, x: c.w * 0.5 + 14, y: -c.h * 0.45, r: 34, lunge: 7, hold: gulp, airOnce: 'side' }), { shout: 'GULP' }),
      ub: Object.assign(mkRise({ total: 50, vy: -13, flaps: [4, 18], hits: [H(4, 12, 0, -c.h - 10, 40, 6, 88, 34, 50), H(18, 26, 0, -c.h - 10, 44, 7, 85, 44, 76)] }), { shout: 'SPOUT' }),
      db: Object.assign(mkSlam({
        ground: { total: 44, hits: [H(16, 20, c.w * 0.5 + 24, -12, 40, 15, 45, 46, 88), H(16, 20, -c.w * 0.5 - 24, -12, 40, 15, 45, 46, 88)] },
        air: { drop: 18, hits: [H(6, 199, 0, 4, 36, 14, -80, 28, 84)], land: { total: 32, hits: [H(1, 6, 0, -12, 96, 10, 60, 52, 50, { radial: true })] } },
      }), { shout: 'BELLY FLOP' }),
      grab: { total: 34, hits: [H(6, 9, c.w * 0.5 + 24, -c.h * 0.5, 32, 0, 0, 0, 0, { grab: true })] },
      };
    },
  },
  {
    id: 'sin', name: 'SIN', title: 'No Filter', blurb: 'Tricky. Red seam beam, shadow step, judgment counter.',
    w: 54, h: 82, walk: 6.6, air: 5, grav: 0.58, fall: 10.5, jump: 15, djump: 13.8, jumps: 1, weight: 92, power: 1.02, reach: 1.05,
    look: { kind: 'frog', fur: '#121214', belly: '#1c1c20', ear: '#ff3b30', dark: '#050505', eye: 'fierce', acc: 'none' },
    specials: c => ({
      nb: Object.assign(mkProj({ max: 2, total: 28, at: 9, proj: { kind: 'seam', color: '#ff3b30', vx: 22, vy: 0, grav: 0, r: 11, dmg: 7, ang: 30, bkb: 26, kbg: 40, life: 40 } }), { shout: 'NO FILTER' }),
      sb: Object.assign(mkPhase(mkDash({ total: 34, a: 4, b: 16, speed: 19, hit: H(0, 0, c.w * 0.5, -c.h * 0.5, 26, 9, 40, 40, 66) }), 3, 14), { shout: 'CROSS THE LINE', vanish: [3, 14] }),
      ub: mkRise({ vy: -18, hits: [H(6, 18, 0, -c.h * 0.6, 32, 7, 82, 40, 60)] }),
      db: { total: 40, counter: [4, 26], sfx: 'shield', shout: 'JUDGMENT' },
    }),
  },
  {
    id: 'gigachad', name: 'GIGACHAD', title: 'Average Enjoyer', blurb: 'Bruiser. Armored chad dash, charged punch, flex shockwave.',
    w: 62, h: 84, walk: 5.8, air: 4.3, grav: 0.68, fall: 12, jump: 14.2, djump: 13, jumps: 1, weight: 118, power: 1.18, reach: 1.05,
    look: { kind: 'dog', fur: '#bdbdbd', belly: '#d8d8d8', ear: '#8a8a8a', dark: '#1a1a1a', eye: 'fierce', acc: 'none' },
    specials: c => ({
      nb: { total: 42, sfx: 'swing', shout: 'YES.', charge: { at: 8, key: 'special', max: 70, mult: 1.1 }, hits: [H(14, 18, c.w * 0.5 + 30, -c.h * 0.55, 34, 13, 38, 44, 100)] },
      sb: Object.assign(mkDash({ total: 42, a: 6, b: 22, speed: 15, hit: H(0, 0, c.w * 0.5 + 10, -c.h * 0.45, 32, 13, 34, 48, 86) }), { shout: 'CHAD', armor: 70, armorF: [4, 22] }),
      ub: Object.assign(mkRise({ at: 5, vy: -17, hits: [H(5, 16, c.w * 0.3, -c.h * 0.9, 34, 11, 85, 44, 80)] }), { shout: 'GIGA' }),
      db: Object.assign(mkSlam({
        ground: { total: 42, hits: [H(14, 18, 0, -c.h * 0.5, 90, 12, 55, 46, 80, { radial: true })] },
        air: { drop: 17, hits: [H(6, 199, 0, 4, 30, 14, -85, 26, 84)], land: { total: 30, hits: [H(1, 5, 0, -10, 72, 9, 70, 50, 50, { radial: true })] } },
      }), { shout: 'FLEX' }),
    }),
  },
  {
    id: 'popcat', name: 'POPCAT', title: 'Pop Pop', blurb: 'Light and fast, three jumps. Pop shockwave.',
    w: 50, h: 70, walk: 7.3, air: 5.3, grav: 0.6, fall: 11, jump: 15.2, djump: 13.2, jumps: 2, weight: 86, power: 1, reach: 0.98,
    look: { kind: 'dog', fur: '#f3e6d2', belly: '#ffffff', ear: '#d9b48a', dark: '#3a3028', eye: 'dot', acc: 'none' },
    specials: c => ({
      nb: { total: 30, sfx: 'swing', shout: 'POP', hits: [H(9, 12, c.w * 0.5 + 26, -c.h * 0.6, 42, 11, 45, 40, 78, { radial: true })], tick(f) { if (f.air) f.vy = Math.min(f.vy, 2); } },
      sb: mkDash({ total: 36, a: 5, b: 20, speed: 16, hit: H(0, 0, c.w * 0.5, -c.h * 0.45, 26, 3, 50, 20, 16, { rehit: 4 }) }),
      ub: mkRise({ at: 4, vy: -19, hits: [H(4, 14, 0, -c.h * 0.5, 30, 6, 84, 36, 50, { radial: true })] }),
      db: mkSlam({
        ground: { total: 30, hits: [H(9, 13, c.w * 0.4, -10, 30, 9, 60, 36, 70), H(9, 13, -c.w * 0.4, -10, 30, 9, 60, 36, 70)] },
        air: { drop: 15, hits: [H(6, 199, 0, 2, 26, 9, -70, 24, 70)], land: { total: 20, hits: [] } },
      }),
    }),
  },
  {
    id: 'brett', name: 'BRETT', title: 'Chill Blue', blurb: 'Easy to play. Balanced, bubble shot, based slam.',
    w: 56, h: 76, walk: 6.4, air: 4.8, grav: 0.6, fall: 11, jump: 14.8, djump: 13.6, jumps: 1, weight: 104, power: 1.08, reach: 1.04,
    look: { kind: 'frog', fur: '#2f7fe8', belly: '#9cc7ff', ear: '#1f5fb8', dark: '#0a2248', eye: 'frog', acc: 'none' },
    specials: c => ({
      nb: mkProj({ max: 2, total: 32, at: 10, proj: { kind: 'tear', vx: 10, vy: -1, grav: 0.05, r: 17, dmg: 8, ang: 45, bkb: 30, kbg: 50, life: 80 } }),
      sb: mkDash({ total: 38, a: 5, b: 20, speed: 13, hit: H(0, 0, c.w * 0.5, -c.h * 0.5, 26, 10, 40, 40, 70) }),
      ub: mkRise({ vy: -17.5, hits: [H(6, 20, 0, -c.h * 0.6, 32, 7, 80, 40, 60)] }),
      db: Object.assign(mkSlam({
        ground: { total: 36, hits: [H(10, 14, c.w * 0.5 + 30, -12, 30, 12, 40, 40, 80), H(10, 14, -c.w * 0.5 - 30, -12, 30, 12, 40, 40, 80)] },
        air: { hits: [H(6, 199, 0, 6, 26, 10, -70, 24, 70)], land: { total: 26, hits: [H(1, 5, 0, -14, 70, 8, 60, 50, 40, { radial: true })] } },
      }), { shout: 'BASED' }),
    }),
  },
  {
    id: 'moodeng', name: 'MOODENG', title: 'Baby Hippo', blurb: 'Small tank. Chomp, roll, bounce.',
    w: 58, h: 70, walk: 5.6, air: 4.4, grav: 0.7, fall: 12, jump: 14.2, djump: 13, jumps: 1, weight: 112, power: 1.05, reach: 0.95,
    look: { kind: 'dog', fur: '#5e5a66', belly: '#f2a6b4', ear: '#e58a9c', dark: '#24202a', eye: 'happy', acc: 'none' },
    specials: c => ({
      nb: { total: 34, sfx: 'swing', shout: 'CHOMP', hits: [H(10, 14, c.w * 0.5 + 14, -c.h * 0.45, 26, 12, 40, 40, 84)], tick(f) { if (f.air) f.vy = Math.min(f.vy, 2); } },
      sb: Object.assign(mkDash({ total: 44, a: 5, b: 30, speed: 13, hit: H(0, 0, c.w * 0.5, -c.h * 0.4, 28, 3, 45, 22, 18, { rehit: 6 }) }), { shout: 'ROLL' }),
      ub: Object.assign(mkRise({ total: 50, vy: -13.5, flaps: [4, 18], hits: [H(4, 12, 0, -c.h * 0.5, 36, 5, 82, 32, 44, { radial: true }), H(18, 26, 0, -c.h * 0.5, 38, 6, 75, 44, 76, { radial: true })] }), { shout: 'BOING' }),
      db: mkSlam({
        ground: { total: 40, hits: [H(14, 18, c.w * 0.5 + 24, -12, 34, 14, 45, 44, 84), H(14, 18, -c.w * 0.5 - 24, -12, 34, 14, 45, 44, 84)] },
        air: { drop: 17, hits: [H(6, 199, 0, 4, 32, 13, -80, 26, 80)], land: { total: 28, hits: [H(1, 5, 0, -12, 70, 8, 60, 50, 44, { radial: true })] } },
      }),
    }),
  },
  // ---- written, waiting for a 3D model ----
  {
    id: 'dev', name: 'THE DEV', title: 'Rug Puller', blurb: 'Tricky. Rug pull flips them, ship-it dash, counter.',
    w: 54, h: 78, walk: 6.4, air: 4.9, grav: 0.6, fall: 10.5, jump: 15, djump: 13.6, jumps: 1, weight: 90, power: 0.98, reach: 1.05,
    look: { kind: 'frog', fur: '#f0d2b4', belly: '#2a2a30', ear: '#b8201a', dark: '#1a1a1e', eye: 'dot', acc: 'none' },
    specials: c => ({
      nb: { total: 44, sfx: 'swing', shout: 'RUG PULL', hits: [H(12, 18, c.w * 0.5 + 50, -6, 52, 10, 85, 50, 62)] },
      sb: Object.assign(mkDash({ total: 38, a: 5, b: 20, speed: 14, hit: H(0, 0, c.w * 0.5, -c.h * 0.5, 26, 9, 40, 40, 66) }), { shout: 'SHIP IT' }),
      ub: Object.assign(mkRise({ vy: -17.5, hits: [H(6, 18, 0, -c.h * 0.6, 32, 7, 82, 40, 58)] }), { shout: 'DEPLOY' }),
      db: { total: 40, counter: [4, 24], sfx: 'shield', shout: 'NOT A RUG' },
    }),
  },
  {
    id: 'mog', name: 'MOG', title: 'Deal With It', blurb: 'Agile cat, three jumps. Shades boomerang, counter.',
    w: 52, h: 72, walk: 7, air: 5.2, grav: 0.6, fall: 11, jump: 15.2, djump: 13.2, jumps: 2, weight: 84, power: 0.95, reach: 0.96,
    look: { kind: 'dog', fur: '#eeeeee', belly: '#ffffff', ear: '#9a9a9a', dark: '#1a1a1a', eye: 'fierce', acc: 'none' },
    specials: c => ({
      nb: Object.assign(mkProj({ max: 1, total: 30, at: 9, proj: { kind: 'shades', color: '#141414', vx: 12, vy: 0, grav: 0, r: 15, dmg: 6, ang: 50, bkb: 28, kbg: 44, life: 84, boomer: 26 } }), { shout: 'MOGGED' }),
      sb: mkDash({ total: 34, a: 5, b: 18, speed: 16, hit: H(0, 0, c.w * 0.5, -c.h * 0.45, 26, 9, 45, 36, 64) }),
      ub: mkRise({ at: 4, vy: -19, hits: [H(4, 14, 0, -c.h * 0.5, 30, 6, 84, 36, 50, { radial: true })] }),
      db: { total: 40, counter: [4, 24], sfx: 'shield', shout: 'DEAL WITH IT' },
    }),
  },
  {
    id: 'spx', name: 'SPX6900', title: 'Flip The Market', blurb: 'Balanced trader. Green candles, buy dash.',
    w: 56, h: 78, walk: 6.3, air: 4.7, grav: 0.62, fall: 11, jump: 14.6, djump: 13.5, jumps: 1, weight: 98, power: 1.02, reach: 1,
    look: { kind: 'dog', fur: '#f0c9a4', belly: '#1f2a4a', ear: '#3a2414', dark: '#1a1008', eye: 'happy', acc: 'none' },
    specials: c => ({
      nb: Object.assign(mkProj({ max: 2, total: 32, at: 10, proj: { kind: 'greencandle', color: '#3ec46d', vx: 7, vy: -9, grav: 0.34, r: 15, dmg: 8, ang: 80, bkb: 30, kbg: 56, life: 80 } }), { shout: 'NUMBER GO UP' }),
      sb: Object.assign(mkDash({ total: 38, a: 5, b: 20, speed: 14, hit: H(0, 0, c.w * 0.5, -c.h * 0.5, 26, 10, 50, 40, 70) }), { shout: 'BUY' }),
      ub: Object.assign(mkRise({ vy: -18, hits: [H(6, 20, 0, -c.h * 0.6, 34, 8, 86, 42, 64)] }), { shout: 'ATH' }),
      db: Object.assign(mkSlam({
        ground: { total: 40, hits: [H(14, 18, c.w * 0.5 + 26, -12, 34, 14, 50, 44, 84), H(14, 18, -c.w * 0.5 - 26, -12, 34, 14, 50, 44, 84)] },
        air: { drop: 16, hits: [H(6, 199, 0, 4, 30, 12, -80, 26, 80)], land: { total: 28, hits: [H(1, 5, 0, -12, 72, 8, 60, 50, 44, { radial: true })] } },
      }), { shout: 'CIRCUIT BREAKER' }),
    }),
  },
  {
    id: 'hood', name: 'HOOD', title: 'Chain Archer', blurb: 'Zoner. Fast arrows, feather glide home.',
    w: 54, h: 78, walk: 6.6, air: 4.9, grav: 0.6, fall: 10.5, jump: 15, djump: 13.8, jumps: 1, weight: 92, power: 0.98, reach: 1,
    look: { kind: 'dog', fur: '#f0c9a4', belly: '#3a3a36', ear: '#9ad62a', dark: '#2a1a0a', eye: 'side', acc: 'none' },
    specials: c => ({
      nb: mkProj({ max: 3, total: 28, at: 10, proj: { kind: 'arrow', color: '#9ad62a', vx: 18, vy: -0.6, grav: 0.08, r: 11, dmg: 6, ang: 35, bkb: 22, kbg: 40, life: 60 } }),
      sb: mkDash({ total: 34, a: 4, b: 18, speed: 15, hit: H(0, 0, c.w * 0.5, -c.h * 0.45, 26, 8, 45, 36, 62) }),
      ub: Object.assign(mkRise({ total: 150, at: 5, vy: -16, glide: 24, hits: [H(5, 14, 0, -c.h * 0.55, 30, 6, 85, 36, 52, { radial: true })] }), { shout: 'FEATHER' }),
      db: mkSlam({
        ground: { total: 30, hits: [H(9, 13, c.w * 0.4, -10, 30, 9, 60, 36, 70), H(9, 13, -c.w * 0.4, -10, 30, 9, 60, 36, 70)] },
        air: { drop: 15, hits: [H(6, 199, 0, 2, 26, 9, -70, 24, 70)], land: { total: 20, hits: [] } },
      }),
    }),
  },
  {
    id: 'diamond', name: 'DIAMOND HANDS', title: 'Never Sells', blurb: 'Heavy hands. Armored crystal punch, HODL counter.',
    w: 60, h: 80, walk: 5.8, air: 4.4, grav: 0.66, fall: 11.5, jump: 14.4, djump: 13.2, jumps: 1, weight: 112, power: 1.12, reach: 1.06,
    look: { kind: 'dog', fur: '#f0d2b4', belly: '#e8f8ff', ear: '#7fd8ff', dark: '#10304a', eye: 'fierce', acc: 'none' },
    specials: c => ({
      nb: { total: 42, sfx: 'swing', shout: 'DIAMOND', armor: 80, armorF: [1, 18], charge: { at: 8, key: 'special', max: 80, mult: 1.12 }, hits: [H(14, 18, c.w * 0.5 + 28, -c.h * 0.55, 34, 14, 38, 44, 100)] },
      sb: mkDash({ total: 40, a: 6, b: 22, speed: 13, hit: H(0, 0, c.w * 0.5 + 8, -c.h * 0.5, 30, 12, 36, 44, 80) }),
      ub: mkRise({ at: 5, vy: -17, hits: [H(5, 16, c.w * 0.3, -c.h * 0.9, 34, 10, 85, 44, 76)] }),
      db: { total: 44, counter: [4, 30], sfx: 'shield', shout: 'HODL' },
    }),
  },
  {
    id: 'blackbox', name: 'BLACK BOX', title: 'Cube Squared', blurb: 'Cube volley, rebase slam.',
    w: 58, h: 80, walk: 6, air: 4.6, grav: 0.64, fall: 11.5, jump: 14.6, djump: 13.4, jumps: 1, weight: 104, power: 1.05, reach: 1.02,
    look: { kind: 'bird', fur: '#141418', belly: '#0b0b0c', ear: '#b6f34e', dark: '#050507', eye: 'dot', acc: 'none' },
    specials: c => ({
      nb: Object.assign(mkProj({ max: 3, total: 26, at: 8, proj: { kind: 'cube', color: '#b6f34e', vx: 12, vy: -2, grav: 0.14, r: 13, dmg: 5, ang: 40, bkb: 24, kbg: 40, life: 70 } }), { shout: 'CUBE' }),
      sb: mkDash({ total: 38, a: 5, b: 22, speed: 15, hit: H(0, 0, c.w * 0.5, -c.h * 0.5, 28, 11, 36, 44, 76) }),
      ub: mkRise({ vy: -17.5, hold: 8, hits: [H(6, 22, 0, -c.h * 0.3, 30, 7, 82, 40, 58)] }),
      db: Object.assign(mkSlam({
        ground: { total: 40, hits: [H(12, 18, 0, -c.h * 0.5, 92, 13, 55, 46, 82, { radial: true })] },
        air: { drop: 16, hits: [H(6, 199, 0, 4, 30, 12, -80, 26, 80)], land: { total: 28, hits: [H(1, 6, 0, -14, 90, 10, 60, 50, 50, { radial: true })] } },
      }), { shout: 'REBASE' }),
    }),
  },
  {
    id: 'sniper', name: 'SNIPER BOT', title: 'Block Zero', blurb: 'Zoner. Long-range shot, rocket hop.',
    w: 54, h: 78, walk: 6.2, air: 4.7, grav: 0.64, fall: 11.5, jump: 14.6, djump: 13.4, jumps: 1, weight: 96, power: 1, reach: 1,
    look: { kind: 'bird', fur: '#1a1c20', belly: '#2a2c30', ear: '#27e1ff', dark: '#08090a', eye: 'dot', acc: 'none' },
    specials: c => ({
      nb: Object.assign(mkProj({ max: 1, total: 42, at: 18, proj: { kind: 'laser', vx: 30, vy: 0, grav: 0, r: 10, dmg: 10, ang: 30, bkb: 30, kbg: 50, life: 50 } }), { shout: 'SNIPED' }),
      sb: Object.assign(mkDash({ total: 38, a: 5, b: 22, speed: 16, hit: H(0, 0, c.w * 0.5, -c.h * 0.5, 28, 10, 36, 44, 74) }), { shout: 'FRONTRUN' }),
      ub: mkRise({ vy: -17.5, hold: 8, hits: [H(6, 22, 0, -c.h * 0.3, 30, 7, 82, 40, 58)] }),
      db: mkSlam({
        ground: { total: 36, hits: [H(10, 14, c.w * 0.5 + 30, -12, 30, 12, 40, 40, 80), H(10, 14, -c.w * 0.5 - 30, -12, 30, 12, 40, 40, 80)] },
        air: { hits: [H(6, 199, 0, 6, 26, 10, -70, 24, 70)], land: { total: 26, hits: [H(1, 5, 0, -14, 70, 8, 60, 50, 40, { radial: true })] } },
      }),
    }),
  },
];

for (const c of CHARS_MORE) {
  if (!MORE_READY.includes(c.id) || CHAR_BY_ID[c.id]) continue;
  c.moves = Object.assign(baseMoves(c), c.specials(c));
  CHARS.push(c); CHAR_BY_ID[c.id] = c;
}
