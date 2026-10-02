// Every ordered matchup on every stage, fixed seeds: fighter win rates for the bet screen,
// plus a big hash list for the cross-engine check.
const S = require('../fightsim.js');
const R = S.ARENA.roster, n = R.length, ns = S.ARENA.stages.length;
const wins = R.map(() => 0), games = R.map(() => 0), h2h = R.map(() => R.map(() => [0, 0]));
const rows = []; let secs = 0, timeUps = 0, k = 0;
for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) if (a !== b) for (let st = 0; st < ns; st++) {
  k++; let seed = '0x'; for (let i = 0; i < 8; i++) seed += ((Math.imul(k * 8 + i + 17, 2246822519) ^ 0x5bd1e995) >>> 0).toString(16).padStart(8, '0');
  const r = S.runFight(seed, a, b, st), w = r.winner === 1 ? a : b, l = r.winner === 1 ? b : a;
  wins[w]++; games[a]++; games[b]++; h2h[w][l][0]++; h2h[l][w][1]++; secs += r.ticks / 60; timeUps += r.timeUp;
  rows.push([seed, a, b, st, r.winner, r.ticks, r.hash]);
}
const out = { version: S.ARENA.version, fights: rows.length, avgSec: Math.round(secs / rows.length), timeUps,
  fighters: R.map((id, i) => ({ id, wins: wins[i], games: games[i], pct: Math.round(1000 * wins[i] / games[i]) / 10 })),
  h2h: h2h.map(r => r.map(([w, l]) => w)) };
require('fs').writeFileSync(__dirname + '/../stats_v1.json', JSON.stringify(out));
require('fs').writeFileSync(__dirname + '/big_hashes.json', JSON.stringify(rows));
console.log(JSON.stringify({ fights: out.fights, avgSec: out.avgSec, timeUps, fighters: out.fighters.map(f => f.id + ' ' + f.pct + '%').join(', ') }));
