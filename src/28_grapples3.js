// ===== command throws for the last seven fighters, plus the break-button and damage tables =====
// 24_grapple.js looks a fighter's throw up in order: c.grapple, GRAPPLE.NAMED[id], then a shared
// default. 24 ships 21 named ones and 26_grapples2.js adds 25; these seven (dev, mog, spx, hood,
// diamond, blackbox, sniper) were the only ones still falling back to the default, so every fighter
// on the roster now has a throw of its own.
//
// Stage fields (see 24_grapple.js): n frames, clip, fx/color, shout, hold [x, y] (x 1 = touching in
// front, y -1 = one grabber-height up) or [[from], [to]] + ease or a function, hit [[frame, dmg], ...],
// toss { at, dmg, ang, bkb, kbg, ground, back, shake }, go(f, t, G), air: true (a jump stage).
// Fight code: seeded rand only, and only the grapple system ever calls it.

Object.assign(GRAPPLE.NAMED, {
  // THE DEV: pulls the rug out from under them, literally, then walks off with it
  dev: () => ({
    name: 'Rug Pull Drop', shout: 'GM EVERYONE',
    stages: [
      { n: 12, clip: 'punch', hold: [1, -0.05], hit: [[6, 2]] },
      { n: 18, clip: 'sweep', hold: [[1, -0.05], [1.3, 0]], ease: 10, hit: [[7, 2.5]],
        go(f, t) { if (t === 7) { Game.puff(f.x + f.face * f.w * 0.9, f.y, 8, '#c8b48c'); Sfx.swing(); } } },
      { n: 26, clip: 'spin', fx: 'coins', hold: (f, v, k, t) => [dcos(t * 0.55) * 1.25, -0.1 + dsin(t * 0.55) * 0.12], hit: [[9, 2], [19, 2]],
        go(f, t) { if (t === 13) MV2.say(f, 'WHERES THE LIQUIDITY', 1.1); } },
      { n: 28, clip: 'slam', shout: 'RUG PULLED', hold: [-1.1, 0],
        toss: { at: 5, dmg: 12, ang: 26, bkb: 64, kbg: 84, ground: true, back: true, shake: 17 },
        go(f, t) { if (t === 5) { Game.shock(f.x - f.face * f.w * 0.7, f.y, '#c8b48c'); Sfx.hit(0.9); } if (t === 14) MV2.say(f, 'DELETED', 1.2); } },
    ],
  }),
  // MOG: puts its own shades on them, makes them look, then folds them backwards
  mog: () => ({
    name: 'Deal With It', shout: 'MOGGED',
    stages: [
      { n: 11, clip: 'punch', hold: [1, -0.05], hit: [[6, 2]] },
      { n: 20, clip: 'cast', fx: 'confuse', color: '#141414', hold: [[1, -0.05], [0.9, -0.2]], ease: 8, hit: [[9, 2.5]],
        go(f, t) { if (t === 9) { Game.ring(f.x + f.face * f.w * 0.7, f.y - f.h * 0.9, '#141414', 52); Sfx.tone(180, 90, 0.16, 'square', 0.12); MV2.say(f, 'SHADES ON', 1.1); } } },
      { n: 16, clip: 'uppercut', hold: [[0.9, -0.2], [-0.15, -1.2]], ease: 12, go(f, t) { if (t === 12) Sfx.swing(); } },
      { n: 26, clip: 'slam', hold: [-0.9, -0.1],
        toss: { at: 5, dmg: 12, ang: 70, bkb: 64, kbg: 84, ground: true, back: true, shake: 17 },
        go(f, t) { if (t === 5) { Game.shock(f.x - f.face * f.w * 0.7, f.y, '#eeeeee'); Sfx.hit(0.9); } } },
    ],
  }),
  // SPX6900: turns them upside down - the chart inverts - holds the peak, then drops it
  spx: () => ({
    name: 'Reverse Split', shout: 'FLIP THE MARKET',
    stages: [
      { n: 12, clip: 'punch', hold: [1, -0.05], hit: [[6, 2]] },
      { n: 22, clip: 'spin', fx: 'coins', color: '#3ec46d',
        hold: (f, v, k) => { const a = k * k * HALF_PI; return [1 - 0.8 * dsin(a), -0.08 - 1 * dsin(a)]; }, hit: [[10, 2.5]],
        go(f, t) { if (t === 11) MV2.say(f, 'REVERSE SPLIT', 1.2); } },
      { n: 14, clip: 'guard', hold: (f, v, k, t) => [0.2, -1.05 + dsin(t * 0.5) * 0.06], hit: [[7, 2]] },
      { n: 28, clip: 'slam', hold: [[0.3, -1], [0.4, 0]], ease: 4,
        toss: { at: 4, dmg: 12, ang: 84, bkb: 66, kbg: 76, ground: true, shake: 18 },
        go(f, t) { if (t === 4) { Game.shock(f.x + f.face * f.w * 0.35, f.y, '#3ec46d'); Sfx.coin(); } } },
    ],
  }),
  // HOOD: loads them onto the bowstring, draws back until it creaks, fires them across the stage
  hood: () => ({
    name: 'Nocked', shout: 'NOCKED',
    stages: [
      { n: 12, clip: 'punch', hold: [1, -0.05], hit: [[6, 2]] },
      { n: 18, clip: 'cast', hold: [[1, -0.05], [-0.5, -0.45]], ease: 12, hit: [[8, 2.5]],
        go(f, t) { if (t === 8) Sfx.tone(300, 160, 0.12, 'triangle', 0.1); } },
      { n: 20, clip: 'block', fx: 'stance', color: '#9ad62a', hold: (f, v, k, t) => [-0.5 - t * 0.018, -0.45], hit: [[10, 2]],
        go(f, t) { if (t % 6 === 0) { Sfx.tone(240 + t * 12, 200, 0.05, 'triangle', 0.06); Game.chargeSpark(f); } } },
      { n: 26, clip: 'kick', fx: 'thrust', color: '#9ad62a', hold: [-0.9, -0.45],
        toss: { at: 4, dmg: 13, ang: 14, bkb: 68, kbg: 92, shake: 18 },
        go(f, t) { if (t === 4) { Sfx.noise(0.12, 0.3, 3200); Game.burst(f.x + f.face * f.w * 0.8, f.y - f.h * 0.5, '#9ad62a', 16); MV2.say(f, 'LOOSE', 1.3); } } },
    ],
  }),
  // DIAMOND HANDS: the bear hug that never sells. Long clinch, four squeezes, then straight through the floor.
  diamond: () => ({
    name: 'Never Selling', shout: 'NEVER SELLING',
    stages: [
      { n: 13, clip: 'punch', hold: [1, -0.05], hit: [[6, 3]] },
      { n: 34, clip: 'block', fx: 'barrier', color: '#7fd8ff', hold: [0.75, -0.2], hit: [[8, 2], [16, 2], [24, 2], [32, 2]],
        go(f, t) {
          if (t % 8 === 0) { Game.burst(f.x + f.face * f.w * 0.4, f.y - f.h * 0.5, '#bff0ff', 5); Sfx.tone(1400 + t * 10, 900, 0.04, 'sine', 0.05); }
          if (t === 18) MV2.say(f, 'STILL HOLDING', 1.1);
        } },
      { n: 16, clip: 'uppercut', hold: [[0.75, -0.2], [0.85, -1.15]], ease: 11, go(f, t) { if (t === 11) Game.shake(5); } },
      { n: 30, clip: 'slam', fx: 'bash', color: '#7fd8ff', hold: [[0.85, -1.15], [0.95, 0]], ease: 6,
        toss: { at: 6, dmg: 16, ang: 80, bkb: 74, kbg: 64, ground: true, shake: 22 },
        go(f, t) { if (t === 6) { Game.shock(f.x + f.face * f.w * 0.6, f.y, '#7fd8ff'); Sfx.hit(1); } } },
    ],
  }),
  // BLACK BOX: folds them into a cube, spins the cube, dunks the cube
  blackbox: () => ({
    name: 'Boxed', shout: 'BOXED',
    stages: [
      { n: 12, clip: 'punch', hold: [1, -0.05], hit: [[6, 2]] },
      { n: 24, clip: 'cast', fx: 'stone', color: '#b6f34e', hold: (f, v, k) => [1 - 0.25 * k, -0.08 - 0.12 * k], hit: [[8, 2], [17, 2]],
        go(f, t) {
          if (t === 8 || t === 17) { Game.ring(f.x + f.face * f.w * 0.6, f.y - f.h * 0.45, '#b6f34e', 44); Sfx.tone(700, 200, 0.07, 'square', 0.1); }
          if (t === 20) MV2.say(f, 'CUBE SQUARED', 1.15);
        } },
      { n: 16, clip: 'spin', hold: (f, v, k, t) => [dcos(t * 0.6) * 0.9, -0.55 + dsin(t * 0.6) * 0.45] },
      { n: 28, clip: 'slam', fx: 'bash', color: '#b6f34e', hold: [[0.8, -0.85], [0.9, 0]], ease: 5,
        toss: { at: 5, dmg: 13, ang: 82, bkb: 66, kbg: 78, ground: true, shake: 19 },
        go(f, t) { if (t === 5) { Game.shock(f.x + f.face * f.w * 0.5, f.y, '#b6f34e'); Sfx.hit(0.95); } } },
    ],
  }),
  // SNIPER BOT: paints the dot on them at point-blank range, then a muzzle-flash piledriver
  sniper: () => ({
    name: 'Front Run', shout: 'FRONT RUN',
    stages: [
      { n: 12, clip: 'punch', hold: [1, -0.05], hit: [[6, 2]] },
      { n: 22, clip: 'cast', fx: 'blitz', color: '#27e1ff', hold: [1, -0.15], hit: [[9, 2], [17, 2]],
        go(f, t) {
          if (t === 5 || t === 13 || t === 21) { Game.ring(f.x + f.face * f.w * 0.8, f.y - f.h * 0.75, '#27e1ff', 26); Sfx.tone(1800, 1800, 0.04, 'sine', 0.05); }
          if (t === 12) MV2.say(f, 'BLOCK ZERO', 1.15);
        } },
      { n: 14, clip: 'uppercut', hold: [[1, -0.15], [0, -1.15]], ease: 10 },
      { n: 30, clip: 'slam', fx: 'bash', color: '#27e1ff', hold: [[0, -1.15], [0.2, 0]], ease: 6,
        toss: { at: 6, dmg: 14, ang: 86, bkb: 70, kbg: 66, ground: true, shake: 20 },
        go(f, t) { if (t === 6) { Game.shock(f.x, f.y, '#27e1ff'); Sfx.noise(0.2, 0.45, 5000); Game.burst(f.x, f.y - f.h * 0.4, '#27e1ff', 18); } } },
    ],
  }),
});

// ---- which throw button breaks each command throw (Tekken: 1, 2 or 1+2 per throw) ----
// E   = the clinches, locks and hand throws     R   = the kicks, spins and launchers
// E+R = the big multi-stage showpieces, the heavies and every throw with a jump in it
Object.assign(TK.ESCOF, {
  doge: 'E+R', shib: 'R', pepe: 'E+R', bonk: 'R', wif: 'E', pengu: 'E', floki: 'R', cheems: 'E',
  cashcat: 'E', lobster: 'E', wojak: 'E', topg: 'E+R', trump: 'R', clanker: 'E+R', bogdanoff: 'R',
  fartcoin: 'E', bull: 'R', bear: 'E', whale: 'E+R', sin: 'R', gigachad: 'E+R', popcat: 'E',
  brett: 'E', moodeng: 'R', dev: 'E', mog: 'R', spx: 'E+R', hood: 'R', diamond: 'E+R',
  blackbox: 'E', sniper: 'R', giga: 'R', ronin: 'E', tyrant: 'E', gwei: 'R', shroom: 'E',
  kaiju: 'R', mochi: 'E+R', omen: 'E+R', wisp: 'R', spark: 'E', turbo: 'R', chop: 'E',
  ginga: 'R', sifu: 'E+R', fro: 'R', bling: 'E', techno: 'E+R', hoodie: 'E', slam: 'E+R',
  mystic: 'E', ape: 'E+R', ember: 'E+R',
});

// ---- damage scale over a fighter's scripted throw numbers (TK.SCALE is the global knob) ----
// Anything not listed rides at 1.0. The heavies hit a little harder with a throw, the featherweights
// a little softer, which is the same weight logic GRAPPLE.DEFAULT uses for its finisher.
Object.assign(TK.DMG, {
  diamond: 1.12, slam: 1.08, whale: 1.06, gigachad: 1.05, ape: 1.04, clanker: 1.04,
  wisp: 0.92, mog: 0.94, wif: 0.96, cashcat: 0.96,
});
