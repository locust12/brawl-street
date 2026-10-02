// ===== bet arena rules =====
// One rules version = one exact fight engine. A round stores its version, fighters, stage and
// seed; anyone can replay it with runFight() (browser or `node arena/verify.js`) and get the
// same winner. Changing anything that affects a fight means bumping `version` and keeping the old
// build around for replays.
const ARENA = {
  version: 1,
  roster: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'wojak', 'topg', 'trump', 'clanker'],
  stages: ['isle', 'moon', 'chart', 'keep', 'roof', 'dojo'],
  stocks: 2, items: true, level: 8, limit: 60 * 150,
};

function fightSlots(a, b) {
  return [{ ctrl: 'cpu', char: ARENA.roster[a], level: ARENA.level }, { ctrl: 'cpu', char: ARENA.roster[b], level: ARENA.level }];
}

// Start a seeded arena fight on the shared Game object (the live view and the headless runner
// both come through here, so they cannot drift apart).
function startFight(seedHex, a, b, stage, onEnd) {
  Game.state = 'match'; Game.pot = 0;
  Game.start(fightSlots(a, b), ARENA.stages[stage], ARENA.stocks, false, ARENA.items, seedHex);
  Game.timeLimit = ARENA.limit;
  Game.arena = onEnd ? { onEnd } : null;
}

function fightHash(h, s) {
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}

// Run a whole fight with no rendering. Returns the winner side (1 = fighter A, 2 = fighter B),
// how many ticks the fight lasts on screen, and a hash of the fight's path for cross-checks.
function runFight(seedHex, a, b, stage) {
  let done = null, h = 2166136261;
  startFight(seedHex, a, b, stage, w => { done = w; });
  while (!done && Game.tick < 60 * 60 * 10) {
    Game.step();
    if (Game.tick % 60 === 0) for (const f of Game.fighters) h = fightHash(h, f.x + ',' + f.y + ',' + f.dmg + ',' + f.stocks + ';');
  }
  const F = Game.fighters;
  const res = {
    version: ARENA.version, seed: seedHex, a, b, stage,
    winner: done ? done.idx + 1 : 0, winnerId: done ? done.c.id : null,
    ticks: Game.tick, frames: Game.frame, timeUp: !!Game.timeUpT,
    stocks: F.map(f => f.stocks), dmg: F.map(f => Math.round(f.dmg)), kos: F.map(f => f.stats.kos),
    hash: (h >>> 0).toString(16),
  };
  Game.arena = null;
  return res;
}
