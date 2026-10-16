// ===== a grapple for every other fighter =====
// 24_grapple.js runs the Attack + Special throws and looks up, in order: c.grapple, GRAPPLE.NAMED[id],
// then a shared default. It ships with 21 named ones; this file fills in the remaining 25 so no fighter
// falls back to the default. Loads after 24_grapple.js (2x_ files join the headless engines too).
// Stage fields (see 24_grapple.js): n frames, clip, fx/color, shout, hold [x, y] (x 1 = in front,
// y -1 = one grabber-height up) or [[from], [to]] + ease or a function, hit [[frame, dmg], ...],
// toss { at, dmg, ang, bkb, kbg, ground, back, shake }, go(f, t), air: true (a jump stage).
// Fight code: seeded rand only, and only the grapple system calls any of it.

Object.assign(GRAPPLE.NAMED, {
  // ---- the first fourteen that had none ----
  shib: () => ({
    name: 'Leash Spin', shout: 'HOLD ON',
    stages: [
      { n: 12, clip: 'punch', hold: [1, -0.05], hit: [[6, 2]] },
      { n: 22, clip: 'spin', hold: (f, v, k, t) => { const a = t * 0.5; return [dcos(a) * 1.05, -0.5 + dsin(a) * 0.45]; }, hit: [[8, 2], [16, 2]],
        go(f, t) { if (t % 7 === 0) Sfx.swing(); } },
      { n: 10, clip: 'spin', hold: (f, v, k, t) => { const a = (t + 22) * 0.6; return [dcos(a) * 1.15, -0.55 + dsin(a) * 0.5]; } },
      { n: 24, clip: 'kick', hold: [1.1, -0.5], toss: { at: 3, dmg: 10, ang: 42, bkb: 66, kbg: 82, shake: 14 },
        go(f, t) { if (t === 3) Game.burst(f.x + f.face * f.w, f.y - f.h * 0.5, '#e8582c', 12); } },
    ],
  }),
  wif: () => ({
    name: 'Hat Trick', shout: 'WIF HAT',
    stages: [
      { n: 12, clip: 'punch', hold: [1, -0.05], hit: [[6, 2]] },
      { n: 18, clip: 'cast', fx: 'coins', color: '#ff8cc6', hold: [1, -0.1], hit: [[10, 3]],
        go(f, t) { if (t === 10) { Game.ring(f.x + f.face * f.w * 0.9, f.y - f.h * 0.9, '#ff8cc6', 50); Sfx.coin(); } } },
      { n: 12, clip: 'uppercut', hold: [[1, -0.1], [0.9, -0.75]], ease: 8 },
      { n: 26, clip: 'slam', hold: [0.9, -0.2], toss: { at: 4, dmg: 11, ang: 70, bkb: 60, kbg: 76, ground: true, shake: 15 } },
    ],
  }),
  pengu: () => ({
    name: 'Belly Bounce', shout: 'PUDGY',
    stages: [
      { n: 12, clip: 'punch', hold: [1, -0.05], hit: [[6, 2]] },
      { n: 16, clip: 'block', hold: [[1, -0.1], [0.8, -0.35]], ease: 6, hit: [[8, 3]], go(f, t) { if (t === 8) { f.sq = 0.25; Sfx.hit(0.4); } } },
      { n: 16, clip: 'block', hold: [[0.8, -0.35], [1, -0.1]], ease: 6, hit: [[8, 3]], go(f, t) { if (t === 8) { f.sq = 0.3; Game.puff(f.x, f.y, 6, '#f4f8ff'); } } },
      { n: 24, clip: 'slam', hold: [0.9, -0.3], toss: { at: 4, dmg: 12, ang: 46, bkb: 64, kbg: 78, shake: 16 } },
    ],
  }),
  floki: () => ({
    name: 'Overboard Toss', shout: 'OVERBOARD',
    stages: [
      { n: 12, clip: 'punch', hold: [1, -0.05], hit: [[6, 2.5]] },
      { n: 16, clip: 'uppercut', hold: [[1, -0.05], [0, -1.15]], ease: 12 },
      { n: 14, clip: 'spin', hold: (f, v, k, t) => [dsin(t * 0.45) * 0.9, -1.1] },
      { n: 26, clip: 'kick', hold: [-0.4, -1], toss: { at: 4, dmg: 13, ang: 52, bkb: 70, kbg: 82, back: true, shake: 18 },
        go(f, t) { if (t === 4) Game.burst(f.x - f.face * f.w * 0.6, f.y - f.h, '#f08a24', 14); } },
    ],
  }),
  cashcat: () => ({
    name: 'Cry For Help', shout: 'SO SAD',
    stages: [
      { n: 12, clip: 'punch', hold: [1, -0.05], hit: [[6, 2]] },
      { n: 22, clip: 'cast', hold: [1, -0.15], hit: [[8, 2], [16, 2]],
        go(f, t) { if (t % 6 === 0) Game.parts.push({ x: f.x + f.face * f.w * 0.5, y: f.y - f.h * 0.8, vx: rand(-1, 1) + f.face, vy: rand(-1, 1), life: 26, max: 26, color: '#7ec8ff', size: rand(5, 9), g: 0.3 }); } },
      { n: 12, clip: 'uppercut', hold: [[1, -0.15], [0.9, -0.7]], ease: 8 },
      { n: 24, clip: 'slam', hold: [0.9, -0.2], toss: { at: 4, dmg: 10, ang: 64, bkb: 58, kbg: 78, ground: true, shake: 13 } },
    ],
  }),
  topg: () => ({
    name: 'Alpha Suplex', shout: 'BOTTOM G',
    stages: [
      { n: 12, clip: 'punch', hold: [1, -0.05], hit: [[6, 3]] },
      { n: 14, clip: 'taunt', shout: 'WHAT COLOUR', hold: [1, -0.05] },
      { n: 16, clip: 'uppercut', hold: [[1, -0.05], [-0.2, -1.2]], ease: 12, go(f, t) { if (t === 12) Sfx.swing(); } },
      { n: 28, clip: 'slam', hold: [-0.9, -0.15], toss: { at: 5, dmg: 14, ang: 72, bkb: 66, kbg: 80, ground: true, back: true, shake: 20 },
        go(f, t) { if (t === 5) { Game.shock(f.x - f.face * f.w * 0.7, f.y, '#c98f6a'); Sfx.hit(0.9); } } },
    ],
  }),
  // ---- roster 2 ----
  ronin: () => ({
    name: 'Sheath Slam', shout: 'SHEATHED',
    stages: [
      { n: 12, clip: 'punch', hold: [1, -0.05], hit: [[6, 2.5]] },
      { n: 16, clip: 'kick', fx: 'slash', color: '#9fd8ff', hold: [1, -0.1], hit: [[8, 3]] },
      { n: 14, clip: 'uppercut', hold: [[1, -0.1], [0.95, -0.8]], ease: 9 },
      { n: 26, clip: 'slam', fx: 'slash', color: '#9fd8ff', hold: [0.95, -0.15], toss: { at: 4, dmg: 12, ang: 68, bkb: 62, kbg: 80, ground: true, shake: 16 } },
    ],
  }),
  tyrant: () => ({
    name: 'Tail Wrap', shout: 'BENEATH ME',
    stages: [
      { n: 12, clip: 'punch', hold: [1, -0.05], hit: [[6, 2]] },
      { n: 20, clip: 'cast', fx: 'tail', hold: [[1, -0.05], [0.7, -0.6]], ease: 10, hit: [[8, 2], [15, 2]] },
      { n: 14, clip: 'spin', hold: (f, v, k, t) => [dcos(t * 0.5) * 0.8, -0.6 + dsin(t * 0.5) * 0.35] },
      { n: 26, clip: 'kick', hold: [0.9, -0.6], toss: { at: 4, dmg: 12, ang: 38, bkb: 66, kbg: 84, shake: 15 } },
    ],
  }),
  gwei: () => ({
    name: 'Pipe Wrench Spin', shout: 'TIGHTEN UP',
    stages: [
      { n: 12, clip: 'punch', hold: [1, -0.05], hit: [[6, 2]] },
      { n: 18, clip: 'spin', fx: 'wrench', hold: (f, v, k, t) => [dcos(t * 0.55) * 1, -0.45 + dsin(t * 0.55) * 0.4], hit: [[9, 3]] },
      { n: 12, clip: 'spin', hold: (f, v, k, t) => [dcos((t + 18) * 0.6) * 1.05, -0.5 + dsin((t + 18) * 0.6) * 0.45] },
      { n: 24, clip: 'slam', hold: [1, -0.2], toss: { at: 4, dmg: 11, ang: 56, bkb: 62, kbg: 78, shake: 14 },
        go(f, t) { if (t === 4) { Sfx.coin(); Game.burst(f.x + f.face * f.w * 0.8, f.y - f.h * 0.4, '#ffd23f', 12); } } },
    ],
  }),
  shroom: () => ({
    name: 'Spore Hug', shout: 'FUN GUY',
    stages: [
      { n: 12, clip: 'punch', hold: [1, -0.05], hit: [[6, 2]] },
      { n: 22, clip: 'block', fx: 'spin', color: '#b86cff', hold: [0.85, -0.15], hit: [[7, 2], [15, 2]],
        go(f, t) { if (t % 6 === 0) Game.burst(f.x + f.face * f.w * 0.6, f.y - f.h * 0.5, '#c890ff', 4); } },
      { n: 12, clip: 'uppercut', hold: [[0.85, -0.15], [0.9, -0.7]], ease: 8 },
      { n: 24, clip: 'kick', hold: [0.95, -0.4], toss: { at: 4, dmg: 10, ang: 48, bkb: 58, kbg: 78, shake: 12 } },
    ],
  }),
  omen: () => ({
    name: 'Mind Lift', shout: 'MIND OVER',
    stages: [
      { n: 12, clip: 'cast', hold: [1, -0.05], hit: [[6, 2]] },
      { n: 20, clip: 'cast', fx: 'confuse', color: '#9a6cff', hold: [[1, -0.05], [0.6, -1.25]], ease: 14, hit: [[10, 3]] },
      { n: 16, clip: 'cast', hold: (f, v, k, t) => [0.6 + dsin(t * 0.4) * 0.25, -1.25], hit: [[8, 2]] },
      { n: 26, clip: 'slam', fx: 'confuse', color: '#9a6cff', hold: [0.7, -1.2], toss: { at: 4, dmg: 13, ang: -70, bkb: 56, kbg: 84, shake: 16 },
        go(f, t) { if (t === 4) { Game.ring(f.x + f.face * f.w * 0.7, f.y - f.h, '#9a6cff', 90); Sfx.hit(0.8); } } },
    ],
  }),
  wisp: () => ({
    name: 'Tiny Tornado', shout: 'WHEEE',
    stages: [
      { n: 12, clip: 'punch', hold: [1, -0.05], hit: [[6, 1.5]] },
      { n: 24, clip: 'spin', hold: (f, v, k, t) => [dcos(t * 0.7) * 0.9, -0.55 + dsin(t * 0.7) * 0.5], hit: [[8, 2], [16, 2]] },
      { n: 10, clip: 'spin', hold: (f, v, k, t) => [dcos((t + 24) * 0.8) * 1, -0.6 + dsin((t + 24) * 0.8) * 0.5] },
      { n: 22, clip: 'cast', hold: [0.9, -0.6], toss: { at: 3, dmg: 9, ang: 58, bkb: 58, kbg: 80, shake: 12 } },
    ],
  }),
  spark: () => ({
    name: 'Static Cling', shout: 'FULL CHARGE',
    stages: [
      { n: 12, clip: 'punch', hold: [1, -0.05], hit: [[6, 2]] },
      { n: 22, clip: 'cast', fx: 'bash', color: '#ffe84a', hold: [0.9, -0.2], hit: [[7, 2], [14, 2], [20, 2]],
        go(f, t) { if (t % 5 === 0) Sfx.tone(1400, 900, 0.04, 'square', 0.06); } },
      { n: 12, clip: 'uppercut', hold: [[0.9, -0.2], [0.8, -0.8]], ease: 8 },
      { n: 24, clip: 'kick', fx: 'thunder', color: '#ffe84a', hold: [0.85, -0.5], toss: { at: 4, dmg: 11, ang: 66, bkb: 60, kbg: 82, shake: 15 } },
    ],
  }),
  ginga: () => ({
    name: 'Roda Flip', shout: 'DANCE',
    stages: [
      { n: 12, clip: 'punch', hold: [1, -0.05], hit: [[6, 2]] },
      { n: 18, clip: 'spin', fx: 'spin', color: '#3ff0b0', hold: (f, v, k, t) => [dcos(t * 0.5) * 1, -0.5 + dsin(t * 0.5) * 0.45], hit: [[9, 3]] },
      { n: 14, clip: 'flykick', hold: [[1, -0.5], [0.6, -1.1]], ease: 10 },
      { n: 24, clip: 'sweep', hold: [0.8, -0.9], toss: { at: 4, dmg: 12, ang: -60, bkb: 54, kbg: 86, shake: 16 } },
    ],
  }),
  sifu: () => ({
    name: 'Drunken Piledriver', shout: 'HIC',
    stages: [
      { n: 12, clip: 'punch', hold: [1, -0.05], hit: [[6, 2]] },
      { n: 18, clip: 'spin', hold: (f, v, k, t) => [1 + dsin(t * 0.6) * 0.2, -0.1], hit: [[8, 2], [15, 2]] },
      { n: 16, clip: 'jump', air: true, hold: [0, -1.1], go(f, t) { if (t === 1) f.vy = -10.5; } },
      { n: 28, clip: 'slam', hold: [0, -1], toss: { at: 6, dmg: 14, ang: 76, bkb: 62, kbg: 80, ground: true, shake: 20 },
        go(f, t) { if (t < 6) f.vy = 16; if (t === 6) { Game.shock(f.x, f.y, '#e8c098'); Sfx.hit(1); } } },
    ],
  }),
  fro: () => ({
    name: 'One Cut Toss', shout: 'CLEAN CUT',
    stages: [
      { n: 12, clip: 'block', hold: [1, -0.05], hit: [[6, 2]] },
      { n: 16, clip: 'punch', fx: 'slash', color: '#e8f4ff', hold: [1, -0.1], hit: [[8, 4]] },
      { n: 12, clip: 'block', hold: [1, -0.1] },
      { n: 26, clip: 'kick', fx: 'slash', color: '#e8f4ff', hold: [1, -0.15], toss: { at: 4, dmg: 13, ang: 34, bkb: 68, kbg: 86, shake: 17 },
        go(f, t) { if (t === 4) Sfx.noise(0.12, 0.3, 4000); } },
    ],
  }),
  bling: () => ({
    name: 'Encore Slam', shout: 'ENCORE',
    stages: [
      { n: 12, clip: 'punch', hold: [1, -0.05], hit: [[6, 2]] },
      { n: 18, clip: 'cast', fx: 'cannon', hold: [1, -0.12], hit: [[9, 3]],
        go(f, t) { if (t === 9) { Sfx.coin(); Game.burst(f.x + f.face * f.w * 0.7, f.y - f.h * 0.6, '#3ec46d', 12); } } },
      { n: 14, clip: 'uppercut', hold: [[1, -0.12], [0.9, -0.85]], ease: 9 },
      { n: 26, clip: 'slam', hold: [0.9, -0.2], toss: { at: 4, dmg: 12, ang: 70, bkb: 62, kbg: 80, ground: true, shake: 18 },
        go(f, t) { if (t === 4) Game.text(f.x, f.y - f.h - 30, 'MIC DROP', '#ffd23f', 1.2); } },
    ],
  }),
  mystic: () => ({
    name: 'Left Hand Lock', shout: 'GOOD NIGHT',
    stages: [
      { n: 12, clip: 'punch', hold: [1, -0.05], hit: [[6, 2.5]] },
      { n: 16, clip: 'uppercut', hold: [1, -0.15], hit: [[7, 3]], go(f, t) { if (t === 7) Sfx.hit(0.5); } },
      { n: 14, clip: 'uppercut', hold: [1, -0.15], hit: [[7, 3]] },
      { n: 26, clip: 'punch', hold: [1, -0.2], toss: { at: 4, dmg: 14, ang: 36, bkb: 70, kbg: 88, shake: 19 },
        go(f, t) { if (t === 4) { Game.burst(f.x + f.face * f.w, f.y - f.h * 0.6, '#ffd23f', 16); Sfx.hit(1); } } },
    ],
  }),
  // ---- the meme-coin roster (22_chars_more) ----
  bogdanoff: () => ({
    name: 'Dump It Drop', shout: 'DUMP IT',
    stages: [
      { n: 12, clip: 'punch', hold: [1, -0.05], hit: [[6, 2]] },
      { n: 18, clip: 'cast', shout: 'HE BOUGHT?', hold: [1, -0.1], hit: [[9, 3]] },
      { n: 12, clip: 'uppercut', hold: [[1, -0.1], [0.9, -0.9]], ease: 8 },
      { n: 26, clip: 'slam', hold: [0.9, -0.15], toss: { at: 4, dmg: 12, ang: -66, bkb: 56, kbg: 84, shake: 16 } },
    ],
  }),
  fartcoin: () => ({
    name: 'Stink Lock', shout: 'PFFT',
    stages: [
      { n: 12, clip: 'punch', hold: [1, -0.05], hit: [[6, 2]] },
      { n: 22, clip: 'block', hold: [0.85, -0.2], hit: [[7, 2], [15, 2]],
        go(f, t) { if (t % 6 === 0) Game.burst(f.x + f.face * f.w * 0.5, f.y - f.h * 0.4, '#9be15d', 5); } },
      { n: 12, clip: 'spin', hold: (f, v, k, t) => [dcos(t * 0.6) * 0.9, -0.5 + dsin(t * 0.6) * 0.4] },
      { n: 24, clip: 'kick', hold: [0.95, -0.4], toss: { at: 4, dmg: 10, ang: 60, bkb: 58, kbg: 78, shake: 13 } },
    ],
  }),
  whale: () => ({
    name: 'Tidal Toss', shout: 'SPLASH',
    stages: [
      { n: 13, clip: 'punch', hold: [1, -0.05], hit: [[6, 3]] },
      { n: 16, clip: 'uppercut', hold: [[1, -0.05], [0, -1.2]], ease: 12 },
      { n: 14, clip: 'spin', hold: (f, v, k, t) => [dsin(t * 0.5) * 0.8, -1.15] },
      { n: 28, clip: 'slam', hold: [0.4, -1], toss: { at: 5, dmg: 15, ang: 74, bkb: 66, kbg: 78, ground: true, shake: 22 },
        go(f, t) { if (t === 5) { Game.shock(f.x + f.face * f.w * 0.4, f.y, '#4fd8ff'); Sfx.hit(1); } } },
    ],
  }),
  gigachad: () => ({
    name: 'Chad Press', shout: 'YES',
    stages: [
      { n: 12, clip: 'punch', hold: [1, -0.05], hit: [[6, 3]] },
      { n: 18, clip: 'uppercut', hold: [[1, -0.05], [0.2, -1.3]], ease: 12, hit: [[10, 3]] },
      { n: 16, clip: 'taunt', shout: 'FLEX', hold: (f, v, k, t) => [0.2, -1.3 + dsin(t * 0.4) * 0.08] },
      { n: 26, clip: 'slam', hold: [0.8, -0.9], toss: { at: 4, dmg: 14, ang: 40, bkb: 70, kbg: 84, shake: 20 } },
    ],
  }),
  popcat: () => ({
    name: 'Pop Slam', shout: 'POP',
    stages: [
      { n: 12, clip: 'punch', hold: [1, -0.05], hit: [[6, 2]] },
      { n: 16, clip: 'cast', hold: [1, -0.12], hit: [[8, 3]], go(f, t) { if (t === 8) Sfx.tone(900, 300, 0.06, 'sine', 0.12); } },
      { n: 14, clip: 'uppercut', hold: [[1, -0.12], [0.9, -0.85]], ease: 9 },
      { n: 24, clip: 'slam', hold: [0.9, -0.2], toss: { at: 4, dmg: 11, ang: 68, bkb: 60, kbg: 80, ground: true, shake: 15 },
        go(f, t) { if (t === 4) { Sfx.tone(1200, 400, 0.08, 'sine', 0.14); Game.ring(f.x + f.face * f.w * 0.6, f.y - 20, '#ffffff', 70); } } },
    ],
  }),
  brett: () => ({
    name: 'Buddy Bump', shout: 'BUDDY',
    stages: [
      { n: 12, clip: 'punch', hold: [1, -0.05], hit: [[6, 2]] },
      { n: 18, clip: 'block', hold: [[1, -0.05], [0.8, -0.3]], ease: 8, hit: [[9, 3]], go(f, t) { if (t === 9) f.sq = 0.22; } },
      { n: 12, clip: 'flykick', hold: [[0.8, -0.3], [1, -0.6]], ease: 8 },
      { n: 24, clip: 'kick', hold: [1, -0.5], toss: { at: 4, dmg: 11, ang: 44, bkb: 62, kbg: 80, shake: 15 } },
    ],
  }),
  moodeng: () => ({
    name: 'Hippo Roll', shout: 'BOUNCE',
    stages: [
      { n: 12, clip: 'punch', hold: [1, -0.05], hit: [[6, 2.5]] },
      { n: 20, clip: 'spin', hold: (f, v, k, t) => [dcos(t * 0.45) * 0.95, -0.45 + dsin(t * 0.45) * 0.4], hit: [[8, 2], [16, 2]] },
      { n: 12, clip: 'block', hold: [0.9, -0.25], go(f, t) { if (t === 6) f.sq = 0.24; } },
      { n: 26, clip: 'slam', hold: [0.9, -0.2], toss: { at: 4, dmg: 13, ang: 62, bkb: 64, kbg: 78, ground: true, shake: 18 } },
    ],
  }),
  // WOLVERINU: ADAMANT DRIVER. The 10/13 version was four stages at 18 damage, mid-table, which is
  // the wrong size for the fighter on the front of the key art. Rebuilt 10/15 as the showpiece throw
  // of the whole roster -- six stages, 25.5 held-and-thrown plus the floor wave, so it is the biggest
  // command throw in the game by a clear margin. What pays for it is TIME: it runs a full two seconds
  // and he is wide open for all of it, so in a 3-4P match the third fighter walks over and takes it
  // off him. (The 20-frame break window does not grow with it -- 27_tekken opens it once, at the
  // catch -- so the length is a cost in the free-for-all, not in the 1v1.)
  //
  // Reference is Tekken's KING: a long hold with real cuts in it, not a quick toss. Hook the claws
  // in, shred across five times, hoist them off the deck, LEAP with them, and drive them head-first
  // back through the floor. It finishes on the two circuit waves his db special cracks out, so the
  // throw reads as his. Break button E+R (28_grapples3 TK.ESCOF).
  wolverinu: () => ({
    name: 'Adamant Driver', shout: 'COME HERE',
    stages: [
      // 1. the hook: both claws in, and he drags them a step toward him
      { n: 12, clip: 'punch', fx: 'slash', color: '#9bf000', hold: [[1.15, -0.05], [0.95, -0.08]], ease: 8, hit: [[6, 3]],
        go(f, t) { if (t === 6) { Game.burst(f.x + f.face * f.w * 0.8, f.y - f.h * 0.55, '#9bf000', 12); Sfx.swing(); } } },
      // 2. the shred: five cuts across, 1.6 each. The sway is what sells it as a mauling.
      { n: 32, clip: 'jab', fx: 'slash', color: '#9bf000', hold: (f, v, k, t) => [0.95 + 0.07 * dsin(t * 0.9), -0.1 - 0.04 * dcos(t * 0.7)],
        hit: [[4, 1.6], [10, 1.6], [16, 1.6], [22, 1.6], [28, 1.6]],
        go(f, t) {
          if (t % 6 !== 4) return;
          Game.ring(f.x + f.face * f.w * 0.9, f.y - f.h * (0.4 + (t % 12 === 4 ? 0.2 : 0)), '#9bf000', 40);
          Game.burst(f.x + f.face * f.w * 0.85, f.y - f.h * 0.5, '#9bf000', 5); Sfx.swing();
        } },
      // 3. hoisted off the deck, overhead, on the claws
      { n: 16, clip: 'uppercut', hold: [[0.95, -0.1], [0.1, -1.3]], ease: 12,
        go(f, t) { if (t === 12) { Sfx.tone(2000, 620, 0.12, 'sawtooth', 0.07); Game.burst(f.x + f.face * 8, f.y - f.h * 1.3, '#9bf000', 14); } } },
      // 4. the leap: he jumps WITH them
      { n: 15, clip: 'jump', hold: [0.1, -1.25], hit: [[9, 2]],
        go(f, t) { if (t === 1) { f.vy = -13.5; Sfx.jump(); } if (t === 9) Game.ring(f.x, f.y - f.h * 1.4, '#9bf000', 70); } },
      // 5. and drives them down head-first. `air: true` ends the stage on the landing, not on a count.
      { n: 60, clip: 'slam', fx: 'dive', color: '#9bf000', air: true, hold: [0.1, -1.1],
        go(f) { f.vy = 18; } },
      // 6. through the floor. 3 + 8 held + 2 + 12.5 thrown = 25.5, plus the forward wave on a victim
      // who is planted on the deck right there: ~29 all in, against a roster whose next biggest
      // command throw is MYSTIC's at 22.5.
      { n: 32, clip: 'slam', shout: 'GAME OVER', hold: [0.4, -0.15],
        toss: { at: 5, dmg: 12.5, ang: 72, bkb: 70, kbg: 88, ground: true, shake: 22 },
        go(f, t) {
          if (t !== 5) return;
          const w = Object.assign({}, WAVE_ROCK, { color: '#9bf000', dmg: 3.5 });
          MV2.wave(f, 1, w); MV2.wave(f, -1, w);
          // the shock ring, the two waves, the camera punch-in and the screen flash all land on this
          // one frame: a second big ring on top of them turned the whole finish into a white ball
          // with no fighters in it. The shock ring is enough.
          Game.shock(f.x, f.y, '#9bf000');
          Game.flashT = Math.max(Game.flashT, 3); Game.shake(18); Sfx.hit(1);
        } },
    ],
  }),
});
