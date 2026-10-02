// ===== back throws: the ultra grapple you get for catching someone from behind =====
// Tekken's rule, lifted whole: grab a fighter whose back is turned and you get a different, longer,
// much harder throw, and there is NO escape from it (front throws all have the 20-frame break window
// in 27_tekken.js). Here it is worth TK.BACK_RATIO times the fighter's own front throw, and every one
// of the 53 fighters has their own.
//
// Named 2x_ so build.py and net/tools/build-engine.js pull it into the headless engines with the rest
// of the fight code. Loads after 24/26/27/28. Seeded rand and dsin/dcos only; the whole system only
// runs while Game.combos is on, so the bet arena never sees it.
//
// Rather than 53 hand-written sequences, there are seven archetypes built from the shared clips -
// drop (back suplex), mount (climb on and pound), spin (swing them round by whatever sticks out),
// carry (shoulder it, walk, put them through the floor), crush (bear hug, squeeze, fall backwards),
// launch (something to the spine, then a finisher), eat (inhale and spit) - and each fighter picks
// one and brings its own shout, line, colour, effect and extra beat. The stage fields are the same
// ones 24_grapple.js documents, plus `face: 1`, which keeps the victim facing away while they are held.

const TKB = {
  // hoist them off their feet, arch backwards, spike them head first behind you
  drop: (c, o) => [
    { n: 14, clip: 'punch', face: 1, hold: [0.9, -0.05], hit: [[5, 3]],
      go(f, t) { if (t === 5) { Sfx.hit(0.5); Game.puff(f.x + f.face * f.w * 0.6, f.y - f.h * 0.5, 6, '#ffffff'); } } },
    { n: 20, clip: 'uppercut', face: 1, fx: o.fx, color: o.color, hold: [[0.9, -0.05], [0.55, -1.15]], ease: 14, hit: [[10, 3]],
      go(f, t) { if (t === 12) { Game.shake(6); if (o.say) MV2.say(f, o.say, 1.25); } if (o.beat) o.beat(f, t); } },
    { n: 16, clip: 'slam', face: 1, hold: (f, v, k) => [0.55 - 1.45 * k, -1.15 + 0.3 * k], hit: [[8, 3]],
      go(f, t) { if (t === 3) Sfx.swing(); } },
    { n: 30, clip: 'slam', face: 1, fx: o.fx, color: o.color, hold: [-0.9, -0.05],
      toss: { at: 5, dmg: 13, ang: 78, bkb: 78, kbg: 82, ground: true, back: true, shake: 24 },
      go(f, t) { if (t === 5) { Game.shock(f.x - f.face * f.w * 0.7, f.y, o.color || '#ffe27a'); Sfx.hit(1); } } },
  ],
  // climb onto their back and go to work on the back of the head
  mount: (c, o) => [
    { n: 12, clip: 'punch', face: 1, hold: [0.9, -0.05], hit: [[5, 3]] },
    { n: 14, clip: 'jump', face: 1, hold: [[0.9, -0.05], [0.25, -0.15]], ease: 8,
      go(f, t) { if (t === 4) { f.sq = -0.2; Sfx.jump(); } } },
    { n: 40, clip: 'slam', face: 1, fx: o.fx, color: o.color, hold: [0.2, -0.12], hit: [[7, 3], [15, 3], [23, 3], [31, 3]],
      go(f, t) {
        if (t % 8 === 7) { Game.burst(f.x + f.face * f.w * 0.3, f.y - f.h * 0.95, o.color || '#ffffff', 6); Sfx.hit(0.55); Game.shake(5); }
        if (t === 20 && o.say) MV2.say(f, o.say, 1.3);
        if (o.beat) o.beat(f, t);
      } },
    { n: 28, clip: 'kick', face: 1, hold: [0.3, -0.1],
      toss: { at: 5, dmg: 12, ang: 30, bkb: 74, kbg: 92, shake: 22 },
      go(f, t) { if (t === 5) { Game.burst(f.x + f.face * f.w * 0.8, f.y - f.h * 0.4, o.color || '#ffe27a', 18); Sfx.hit(1); } } },
  ],
  // grab whatever is sticking out and swing them round three times
  spin: (c, o) => [
    { n: 12, clip: 'sweep', face: 1, hold: [[0.9, -0.05], [1.15, 0]], ease: 8, hit: [[6, 3]] },
    { n: 36, clip: 'spin', face: 1, fx: o.fx, color: o.color, hit: [[10, 3], [20, 3], [30, 3]],
      hold: (f, v, k, t) => [dcos(t * 0.42) * 1.2, -0.35 + dsin(t * 0.42) * 0.55],
      go(f, t) { if (t % 9 === 4) Sfx.swing(); if (t === 18 && o.say) MV2.say(f, o.say, 1.3); if (o.beat) o.beat(f, t); } },
    { n: 30, clip: 'kick', face: 1, fx: o.fx, color: o.color, hold: [1.2, -0.4],
      toss: { at: 4, dmg: 14, ang: 34, bkb: 76, kbg: 96, shake: 22 },
      go(f, t) { if (t === 4) { Game.burst(f.x + f.face * f.w, f.y - f.h * 0.5, o.color || '#ffe27a', 18); Sfx.hit(1); } } },
  ],
  // onto the shoulder, walk them somewhere better, then straight through the floor
  carry: (c, o) => [
    { n: 13, clip: 'punch', face: 1, hold: [0.9, -0.05], hit: [[5, 3]] },
    { n: 18, clip: 'uppercut', face: 1, hold: [[0.9, -0.05], [0.15, -1.25]], ease: 12, hit: [[9, 3]] },
    { n: 26, clip: 'run', face: 1, fx: o.fx, color: o.color, hit: [[13, 3]],
      hold: (f, v, k, t) => [0.15, -1.25 + dsin(t * 0.6) * 0.05],
      go(f, t) {
        f.vx = f.face * 3.4;
        if (t % 7 === 0) Game.puff(f.x, f.y, 4, '#ffffff');
        if (t === 10 && o.say) MV2.say(f, o.say, 1.3);
        if (o.beat) o.beat(f, t);
      } },
    { n: 30, clip: 'slam', face: 1, fx: o.fx, color: o.color, hold: [[0.15, -1.25], [0.85, 0]], ease: 6,
      toss: { at: 6, dmg: 15, ang: 84, bkb: 80, kbg: 76, ground: true, shake: 26 },
      go(f, t) { if (t === 6) { Game.shock(f.x + f.face * f.w * 0.6, f.y, o.color || '#ffe27a'); Sfx.hit(1); } } },
  ],
  // arms round the middle from behind, squeeze four times, then fall backwards on top of them
  crush: (c, o) => [
    { n: 13, clip: 'punch', face: 1, hold: [0.9, -0.05], hit: [[5, 3]] },
    { n: 36, clip: 'block', face: 1, fx: o.fx, color: o.color, hold: [0.7, -0.15], hit: [[8, 3], [17, 3], [26, 3], [34, 3]],
      go(f, t) {
        if (t % 9 === 8) { Game.shake(5); Sfx.hit(0.5); Game.burst(f.x + f.face * f.w * 0.4, f.y - f.h * 0.55, o.color || '#ffffff', 6); }
        if (t === 20 && o.say) MV2.say(f, o.say, 1.3);
        if (o.beat) o.beat(f, t);
      } },
    { n: 16, clip: 'uppercut', face: 1, hold: [[0.7, -0.15], [0.5, -1.2]], ease: 11 },
    { n: 30, clip: 'slam', face: 1, hold: (f, v, k) => [0.5 - 1.35 * k, -1.2 + 1.2 * k], ease: 8,
      toss: { at: 8, dmg: 14, ang: 76, bkb: 76, kbg: 84, ground: true, back: true, shake: 26 },
      go(f, t) { if (t === 8) { Game.shock(f.x - f.face * f.w * 0.7, f.y, o.color || '#ffe27a'); Sfx.hit(1); } } },
  ],
  // something hard into the spine, they fold upwards, then the finisher
  launch: (c, o) => [
    { n: 12, clip: 'kick', face: 1, hold: [0.9, -0.05], hit: [[5, 4]],
      go(f, t) { if (t === 5) { Game.shake(6); Sfx.hit(0.6); } } },
    { n: 18, clip: 'uppercut', face: 1, fx: o.fx, color: o.color, hold: [[0.9, -0.05], [0.8, -1]], ease: 10, hit: [[8, 4]],
      go(f, t) { if (t === 8) { Game.burst(f.x + f.face * f.w * 0.5, f.y - f.h * 0.95, o.color || '#ffe27a', 14); if (o.say) MV2.say(f, o.say, 1.3); } if (o.beat) o.beat(f, t); } },
    { n: 14, clip: 'guard', face: 1, hold: (f, v, k, t) => [0.8, -1 - dsin(t * 0.4) * 0.06], hit: [[7, 3]] },
    { n: 30, clip: 'flykick', face: 1, fx: o.fx, color: o.color, hold: [0.9, -0.85],
      toss: { at: 5, dmg: 15, ang: 44, bkb: 80, kbg: 98, shake: 24 },
      go(f, t) { if (t === 5) { Game.burst(f.x + f.face * f.w, f.y - f.h * 0.8, o.color || '#ffe27a', 20); Sfx.hit(1); } } },
  ],
  // in one end, out the other, backwards
  eat: (c, o) => [
    { n: 14, clip: 'cast', face: 1, fx: 'inhale', hold: [[0.9, -0.05], [0.25, 0]], ease: 12,
      go(f, t) { if (t === 4) Sfx.noise(0.3, 0.15, 700); } },
    { n: 38, clip: 'guard', face: 1, swallow: true, hold: [0, 0], hit: [[8, 4], [18, 4], [28, 4]],
      go(f, t) { if (t % 9 === 0) { f.sq = 0.2; Sfx.hit(0.4); } if (t === 20 && o.say) MV2.say(f, o.say, 1.3); if (o.beat) o.beat(f, t); } },
    { n: 30, clip: 'cast', face: 1, swallow: true, hold: (f, v, k, t) => (t >= 6 ? [-1.3, -0.1] : [0, 0]),
      toss: { at: 6, dmg: 14, ang: 40, bkb: 76, kbg: 90, back: true, shake: 24 },
      go(f, t) { if (t === 6) { Sfx.tone(700, 200, 0.14, 'square', 0.14); Game.burst(f.x - f.face * f.w * 0.8, f.y - f.h * 0.5, o.color || '#ffe066', 18); } } },
  ],
};

// one line per fighter: [archetype, name, shout, mid-throw line, colour, effect, extra beat]
function tkb(a, name, shout, say, color, fx, beat) {
  return c => ({ name, shout, stages: TKB[a](c, { say, color, fx, beat }) });
}
const TKB_COIN = (f, t) => { if (t === 12) Sfx.coin(); };
const TKB_DRUM = (f, t) => { if (t === 10 || t === 18 || t === 26 || t === 34) Sfx.tone(160 + (t % 3) * 40, 80, 0.09, 'sine', 0.13); };

Object.assign(TK.BACK, {
  // ---- the arena fourteen ----
  doge:      tkb('spin',   'Coin Toss Whirl',      'TAILS AGAIN',        'MUCH SPIN',      '#f2b43c', 'coins', TKB_COIN),
  shib:      tkb('spin',   'Leash Law',            'LEASH LAW',          'WALKIES',        '#e8582c'),
  pepe:      tkb('drop',   'Feels Bad Drop',       'FEELS BAD',          'FEELS BAD MAN',  '#56b847'),
  bonk:      tkb('launch', 'Back Nine',            'BACK NINE',          'FORE',           '#ffd45c', 'mallet'),
  wif:       tkb('mount',  'Hat Over The Eyes',    'HAT OVER EYES',      'CANT SEE ME',    '#ff8cc6', 'coins'),
  pengu:     tkb('carry',  'Pudgy Express',        'ALL ABOARD',         'PUDGY EXPRESS',  '#9fe8ff'),
  floki:     tkb('drop',   'Walk The Plank',       'WALK THE PLANK',     'OVERBOARD',      '#f08a24'),
  cheems:    tkb('crush',  'Hostile Merger',       'MERGER',             'SYNERGY',        '#d9a441', 'coins'),
  cashcat:   tkb('crush',  'Tax Audit',            'TAX AUDIT',          'ITS ALL GONE',   '#7ec8ff'),
  lobster:   tkb('crush',  'Pincer From Behind',   'PINCER',             'CLAWED',         '#ff5a3a'),
  wojak:     tkb('drop',   'NGMI Drop',            'NGMI',               'ITS OVER',       '#9fd8ff'),
  topg:      tkb('carry',  'Into The Boot',        'IN THE BOOT',        'BUGATTI TIME',   '#c98f6a'),
  trump:     tkb('carry',  'Escorted Out',         'SECURITY',           'SEE YOU LATER',  '#ffd23f', 'coins'),
  clanker:   tkb('crush',  'Magnet Yank',          'MAGNET YANK',        'E M P',          '#8fd8ff', 'bash'),
  // ---- the meme-coin roster ----
  bogdanoff: tkb('drop',   'Dump It From Behind',  'DUMP IT',            'HE BOUGHT',      '#9a6cff'),
  fartcoin:  tkb('mount',  'Silent But Deadly',    'SILENT BUT',         'DEADLY',         '#9be15d'),
  bull:      tkb('launch', 'Gored',                'GORED',              'TO THE MOON',    '#3ec46d', 'cannon'),
  bear:      tkb('mount',  'Mauled',               'MAULED',             'BEARISH',        '#ff3b30'),
  whale:     tkb('eat',    'Swallowed Whole',      'SWALLOWED',          'GULP',           '#4fd8ff'),
  sin:       tkb('mount',  'Wrath',                'WRATH',              'JUDGMENT',       '#ff3b30', 'blitz'),
  gigachad:  tkb('carry',  'One More Rep',         'BACK GAINS',         'ONE MORE REP',   '#e8f0ff'),
  popcat:    tkb('mount',  'Pop Pop Pop',          'POP POP',            'POP POP POP',    '#ffffff'),
  brett:     tkb('crush',  'Bro Hug',              'BRO HUG',            'LOVE YOU BRO',   '#5aa7ff'),
  moodeng:   tkb('mount',  'Hippo Sit',            'HIPPO SIT',          'BOUNCE',         '#ffb6c1'),
  // ---- roster 2 ----
  giga:      tkb('launch', 'Already Behind You',   'BEHIND YOU',         'NOTHING PERSONAL', '#7ff0ff', 'blitz'),
  ronin:     tkb('launch', 'Iai Back Cut',         'IAI BACK CUT',       'SHEATHED',       '#9fd8ff', 'slash'),
  tyrant:    tkb('spin',   'Tail Noose',           'TAIL NOOSE',         'BENEATH ME',     '#b86cff', 'tail'),
  gwei:      tkb('drop',   'Gas Spike',            'GAS SPIKE',          'TIGHTEN UP',     '#ffd23f', 'wrench'),
  shroom:    tkb('crush',  'Spore Bloom',          'SPORE BLOOM',        'FUN GUY',        '#c890ff', 'spin'),
  kaiju:     tkb('spin',   'Tail Whip',            'TAIL WHIP',          'TAIL SPIN',      '#ff7a1a', 'shell'),
  mochi:     tkb('eat',    'Inhale From Behind',   'INHALE',             'PTOO',           '#ffe066'),
  omen:      tkb('launch', 'Mind Crush',           'MIND CRUSH',         'MIND OVER',      '#9a6cff', 'confuse'),
  wisp:      tkb('spin',   'Whirlwind',            'WHIRLWIND',          'WHEEE',          '#bff4ff'),
  spark:     tkb('crush',  'Back Shock',           'BACK SHOCK',         'FULL CHARGE',    '#ffe84a', 'thunder'),
  turbo:     tkb('launch', 'Afterburner',          'AFTERBURNER',        'BLAZE KNEE',     '#ff9a2a', 'blitz'),
  chop:      tkb('launch', 'Spine Tap',            'SPINE TAP',          'WATAA',          '#ffd23f'),
  ginga:     tkb('spin',   'Role Reversal',        'ROLE REVERSAL',      'DANCE',          '#3ff0b0', 'spin'),
  sifu:      tkb('drop',   'Drunken Back Drop',    'DRUNKEN DROP',       'HIC',            '#e8c098'),
  fro:       tkb('launch', 'Back Cut',             'BACK CUT',           'CLEAN CUT',      '#e8f4ff', 'slash'),
  bling:     tkb('carry',  'Backstage Pass',       'BACKSTAGE PASS',     'MIC DROP',       '#ffd23f', 'cannon'),
  techno:    tkb('launch', 'Booster Stage',        'BOOSTER STAGE',      'LIFTOFF',        '#ff9a2a', 'rocket'),
  hoodie:    tkb('crush',  'Rear Naked',           'REAR NAKED',         'TAP OUT',        '#cfd4e8'),
  slam:      tkb('drop',   'Back Drop Driver',     'BACK DROP DRIVER',   'CHOKESLAM',      '#ffd23f', 'pound'),
  mystic:    tkb('launch', 'Blind Side',           'BLIND SIDE',         'GOOD NIGHT',     '#ffd23f'),
  ape:       tkb('mount',  'Bongo Time',           'BONGO TIME',         'OOH OOH AAH',    '#c98f6a', null, TKB_DRUM),
  ember:     tkb('carry',  'Wing Pin',             'WING PIN',           'DRAGON DIVE',    '#ff8a2a', 'wings'),
  // ---- written, waiting on a 3D model (22_chars_more) ----
  dev:       tkb('drop',   'Backdoor',             'BACKDOOR',           'ITS A MULTISIG', '#c8b48c'),
  mog:       tkb('mount',  'Mogged From Behind',   'MOGGED',             'DEAL WITH IT',   '#141414', 'confuse'),
  spx:       tkb('crush',  'Short Squeeze',        'SHORT SQUEEZE',      'NUMBER GO UP',   '#3ec46d', 'coins'),
  hood:      tkb('launch', 'Point Blank',          'POINT BLANK',        'NOCKED',         '#9ad62a', 'thrust'),
  diamond:   tkb('crush',  'Vice Grip',            'VICE GRIP',          'NEVER SELLING',  '#7fd8ff', 'barrier'),
  blackbox:  tkb('carry',  'Black Boxed',          'BLACK BOXED',        'CUBE SQUARED',   '#b6f34e', 'stone'),
  sniper:    tkb('launch', 'Back Of The Head',     'BACK OF THE HEAD',   'FRONT RUN',      '#27e1ff', 'blitz'),
});

// Any fighter a later roster file adds and does not list above still gets a real back throw, picked
// by weight class, so nothing ever falls through to a front throw.
TK.BACKDEF = c => {
  const w = c.weight || 100;
  const a = w >= 110 ? 'carry' : w >= 100 ? 'crush' : w <= 88 ? 'spin' : 'drop';
  return { name: 'Back Throw', shout: 'BACK THROW', stages: TKB[a](c, { say: c.taunt || 'TURN AROUND', color: '#ffe27a' }) };
};
