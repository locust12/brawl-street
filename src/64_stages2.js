// ===== more stages: Neon City, Star Cruiser, Brawl Street =====
// Fight side only (the 3D builders live in 95_v3_stages.mjs). makeStage is wrapped, so the bet
// arena's stages (ARENA.stages) still come from the original function, unchanged.
// The one moving platform (Neon City's hover car) is a pure function of Game.frame: it moves once
// per simulated frame, after the fighters, and carries whoever stands on it. No RNG, no wall clock.
const STAGES_MENU_EXTRA = [
  ['city', 'Neon City', 'Rooftops in the skyline, a hover car in between'],
  ['ship', 'Star Cruiser', 'Top deck of a battleship in deep space'],
  ['street', 'Sunset Block', 'Sunset block: store roof, rooftop sign, billboard'],
  ['arena', 'Grand Arena', 'Round platform, lasers, hologram trophy'],
  ['swamp', 'Gloom Bayou', 'Boardwalk, bobbing lily pad, fireflies'],
  ['floor', 'Trading Floor', 'Balcony over the pit, hanging tickers'],
  ['train', 'Bullet Express', 'Train roof at full speed, jump the cars'],
  ['peak', 'Frozen Peak', 'Summit shrine, ice crystals, aurora'],
  ['lunar', 'Lunar Base', 'Landing pad with Earth rising'],
  ['casino', 'High Roller', 'Neon rooftop, slots and a roulette sign'],
  ['shibuya', 'Shibuya Crossing', 'Rain-slick crossing under the screens'],
  ['baghdad', 'Baghdad Bazaar', 'Old-city market street in the afternoon sun'],
];
// stages that progression unlocks; the economy agent reads this and flips them on
const STAGES_LOCKED = { shibuya: { xp: 12 } };

const STAGES2 = {
  // main tower roof, a taller neighbour on the left, a lower one on the right, a billboard
  // gantry in the middle and a hover car gliding over the top (12 s round trip)
  city: {
    name: 'Neon City', main: { x0: -400, x1: 400, top: 0, bot: 120 },
    plats: [
      { x0: -620, x1: -400, y: -125, soft: true },
      { x0: 415, x1: 615, y: -75, soft: true },
      { x0: -105, x1: 105, y: -140, soft: true },
      { x0: -90, x1: 90, y: -275, soft: true, mover: { x0: -90, w: 180, y: -275, ax: 235, ay: 0, period: 720, phase: 0 } },
    ],
    blast: { l: -1080, r: 1080, t: -600, b: 480 },
  },
  // armoured deck; a gun turret on the left, the bridge tower's balcony and roof on the right
  ship: {
    name: 'Star Cruiser', main: { x0: -450, x1: 450, top: 0, bot: 150 },
    plats: [
      { x0: -340, x1: -175, y: -140, soft: true },
      { x0: 150, x1: 345, y: -165, soft: true },
      // lower gun decks along the hull: a missed recovery lands here instead of dying
      { x0: -660, x1: -450, y: 300, soft: true },
      { x0: 450, x1: 660, y: 300, soft: true },
    ],
    blast: { l: -1040, r: 1040, t: -505, b: 430 },
  },
  // the street; the corner market's roof and the sign on top of it on the left, a billboard catwalk on the right
  street: {
    name: 'Sunset Block', main: { x0: -440, x1: 440, top: 0, bot: 110 },
    plats: [
      { x0: -440, x1: -165, y: -150, soft: true },
      { x0: -395, x1: -205, y: -285, soft: true },
      { x0: 165, x1: 375, y: -190, soft: true },
    ],
    blast: { l: -1000, r: 1000, t: -620, b: 480 },
  },
  // the octagon, seen from the side, with two hovering glass panels
  arena: {
    name: 'Grand Arena', main: { x0: -460, x1: 460, top: 0, bot: 130 },
    plats: [
      { x0: -315, x1: -135, y: -150, soft: true },
      { x0: 135, x1: 315, y: -150, soft: true },
    ],
    blast: { l: -1000, r: 1000, t: -580, b: 480 },
  },
  // boardwalk over the water; a giant lily pad and a log on vines (both bob), a mangrove branch on top
  swamp: {
    name: 'Gloom Bayou', main: { x0: -420, x1: 420, top: 0, bot: 90 },
    plats: [
      { x0: -335, x1: -165, y: -135, soft: true, mover: { x0: -335, w: 170, y: -135, ax: 0, ay: 7, period: 230, phase: 0 } },
      { x0: 160, x1: 340, y: -150, soft: true, mover: { x0: 160, w: 180, y: -150, ax: 0, ay: 5, period: 300, phase: 2 } },
      { x0: -95, x1: 95, y: -275, soft: true },
    ],
    blast: { l: -980, r: 980, t: -580, b: 480 },
  },
  // exchange balcony; two ticker boards hang on cables, the opening-bell gantry on top
  floor: {
    name: 'Trading Floor', main: { x0: -440, x1: 440, top: 0, bot: 110 },
    plats: [
      { x0: -325, x1: -145, y: -145, soft: true },
      { x0: 145, x1: 325, y: -145, soft: true },
      { x0: -90, x1: 90, y: -280, soft: true },
    ],
    blast: { l: -1000, r: 1000, t: -600, b: 480 },
  },
  // the middle car's roof; the next cars' roofs across the gaps are platforms too
  train: {
    name: 'Bullet Express', main: { x0: -330, x1: 330, top: 0, bot: 110 },
    plats: [
      { x0: -790, x1: -390, y: 0, soft: true },
      { x0: 390, x1: 790, y: 0, soft: true },
      { x0: -70, x1: 70, y: -150, soft: true },
    ],
    blast: { l: -1180, r: 1180, t: -560, b: 420 },
  },
  // summit shrine; two ice slabs and the shrine gate's lintel on top
  peak: {
    name: 'Frozen Peak', main: { x0: -420, x1: 420, top: 0, bot: 120 },
    plats: [
      { x0: -320, x1: -140, y: -150, soft: true },
      { x0: 140, x1: 320, y: -150, soft: true },
      { x0: -100, x1: 100, y: -285, soft: true },
    ],
    blast: { l: -980, r: 980, t: -600, b: 480 },
  },
  // landing pad on struts over a crater; comms tower catwalk, a lander's deck, a crane arm
  lunar: {
    name: 'Lunar Base', main: { x0: -440, x1: 440, top: 0, bot: 110 },
    plats: [
      { x0: -335, x1: -155, y: -150, soft: true },
      { x0: 150, x1: 330, y: -170, soft: true },
      { x0: -60, x1: 110, y: -300, soft: true },
    ],
    blast: { l: -1000, r: 1000, t: -620, b: 480 },
  },
  // rain-slick crossing under the screens (unlocked by progression, the economy agent flips it)
  shibuya: {
    name: 'Shibuya Crossing', main: { x0: -440, x1: 440, top: 0, bot: 110 },
    plats: [
      { x0: -330, x1: -150, y: -150, soft: true },
      { x0: 150, x1: 330, y: -150, soft: true },
      { x0: -90, x1: 90, y: -285, soft: true },
    ],
    blast: { l: -1000, r: 1000, t: -600, b: 480 },
    locked: { xp: 12 },
  },
  // old-city market street: market awning, mashrabiya balcony, rooftop terrace
  baghdad: {
    name: 'Baghdad Bazaar', main: { x0: -440, x1: 440, top: 0, bot: 110 },
    plats: [
      { x0: -345, x1: -165, y: -140, soft: true },
      { x0: 165, x1: 350, y: -170, soft: true },
      { x0: -95, x1: 105, y: -290, soft: true },
    ],
    blast: { l: -1000, r: 1000, t: -610, b: 480 },
  },
  // art-deco beachfront: hotel balcony, neon sign gantry, rooftop sign
  miami: {
    name: 'Miami Strip', main: { x0: -440, x1: 440, top: 0, bot: 110 },
    plats: [
      { x0: -345, x1: -155, y: -150, soft: true },
      { x0: 155, x1: 345, y: -155, soft: true },
      { x0: -85, x1: 95, y: -285, soft: true },
    ],
    blast: { l: -1000, r: 1000, t: -600, b: 480 },
  },
  // casino rooftop; slot-machine sign catwalk, the roulette sign's ledge, a dice sign on top
  casino: {
    name: 'High Roller', main: { x0: -430, x1: 430, top: 0, bot: 120 },
    plats: [
      { x0: -330, x1: -150, y: -150, soft: true },
      { x0: 150, x1: 330, y: -150, soft: true },
      { x0: -80, x1: 80, y: -280, soft: true },
    ],
    blast: { l: -1000, r: 1000, t: -600, b: 480 },
  },
};

makeStage = (function (base) {
  // `local` has to be forwarded. 60_game's makeStage takes it as a second argument (the local-only
  // stage reshape), and this wrapper used to swallow it, so the reshape silently never ran for any
  // stage -- local and seeded geometry measured byte-identical and it looked like the gate was wrong.
  return function makeStage(id, local) {
    const D = STAGES2[id];
    if (!D) return base(id, local);
    const S = base('moon', false);   // start from the stock stage so any field added there is kept
    S.id = id; S.name = D.name; S.theme = id;
    S.main = Object.assign({}, D.main);
    S.plats = D.plats.map(p => Object.assign({}, p, p.mover ? { mover: Object.assign({}, p.mover) } : null));
    S.blast = Object.assign({}, D.blast);
    S.mainSurf = { y: S.main.top, x0: S.main.x0, x1: S.main.x1, soft: false };
    S.ledges = [{ x: S.main.x0, y: S.main.top, side: -1, holder: null }, { x: S.main.x1, y: S.main.top, side: 1, holder: null }];
    S.spawns = [-240, 240, -90, 90];
    S.respawn = [-200, 200, -60, 60];
    if (D.locked) S.locked = Object.assign({}, D.locked);
    S.movers = S.plats.filter(p => p.mover);
    if (!S.movers.length) delete S.movers;
    else for (const p of S.movers) stage2Place(p, 0);
    return S;
  };
})(makeStage);

// where a moving platform is on a given simulated frame (sine glide: slows down at each end)
function stage2Place(p, frame) {
  const m = p.mover, k = dsin(frame * TAU / m.period + m.phase);
  p.x0 = m.x0 + m.ax * k; p.x1 = p.x0 + m.w; p.y = m.y + m.ay * k;
}
// move the platforms to this frame and carry fighters and resting items along
function stage2Move(S) {
  for (const p of S.movers) {
    const ox0 = p.x0, ox1 = p.x1, oy = p.y;
    stage2Place(p, Game.frame);
    const dx = p.x0 - ox0;
    if (dx === 0 && p.y === oy) continue;
    for (const f of Game.fighters) if (!f.air && f.plat === p && f.state !== 'dead') { f.x += dx; f.y = p.y; }
    for (const it of Game.items) {
      if (it.dead || ITEM_DEFS[it.kind].floating || it.vy !== 0 || it.y !== oy || it.x <= ox0 || it.x >= ox1) continue;
      it.x += dx; it.y = p.y;
    }
  }
}
// Items.update runs exactly once per simulated frame (after fighters, hits and projectiles)
Items.update = (function (base) {
  return function update() {
    base.call(this);
    const S = Game.stage;
    if (S && S.movers) stage2Move(S);
  };
})(Items.update);
