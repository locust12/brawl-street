// Replays every recorded bet-arena fight (arena/test/big_hashes.json, 1,092 fights) through the current
// arena/fightsim.js and checks winner, tick count and path hash. Online work must leave these unchanged.
//   node net/test/arena_replay_all.js
const path = require('path');
const root = path.join(__dirname, '..', '..');
const S = require(path.join(root, 'arena', 'fightsim.js'));
const rows = require(path.join(root, 'arena', 'test', 'big_hashes.json'));
let bad = 0, same = 0; const t0 = Date.now();
for (const [seed, a, b, st, winner, ticks, hash] of rows) {
  const r = S.runFight(seed, a, b, st);
  if (r.hash === hash && r.winner === winner && r.ticks === ticks) same++; else { bad++; if (bad < 4) console.log('DIFF', seed.slice(0, 12), hash, r.hash); }
}
console.log(JSON.stringify({ engine: 'node', fights: rows.length, identical: same, different: bad, ms: Date.now() - t0 }));
process.exit(bad ? 1 : 0);
