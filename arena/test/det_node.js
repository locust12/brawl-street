// Determinism check in V8: same seeds in forward and reverse order must give identical fights.
const S = require('../fightsim.js');
const N = +process.argv[2] || 24;
const seeds = Array.from({ length: N }, (_, i) => {
  let h = ''; for (let k = 0; k < 8; k++) h += ((Math.imul(i + 1, 2654435761) ^ (k * 40503)) >>> 0).toString(16).padStart(8, '0');
  return '0x' + h.slice(0, 64);
});
const card = i => ({ a: i % 14, b: (i * 5 + 3) % 14 === i % 14 ? (i + 1) % 14 : (i * 5 + 3) % 14, st: i % 6 });
const t0 = Date.now();
const fwd = seeds.map((s, i) => { const c = card(i); return S.runFight(s, c.a, c.b, c.st); });
const ms = Date.now() - t0;
const rev = seeds.map((s, i) => i).reverse().map(i => { const c = card(i); return S.runFight(seeds[i], c.a, c.b, c.st); }).reverse();
let bad = 0;
fwd.forEach((r, i) => { if (r.hash !== rev[i].hash || r.winner !== rev[i].winner) { bad++; console.log('MISMATCH', i, r.hash, rev[i].hash); } });
const secs = fwd.map(r => r.ticks / 60).sort((a, b) => a - b);
console.log(JSON.stringify({ fights: N, mismatches: bad, msPerFight: Math.round(ms / N), timeUps: fwd.filter(r => r.timeUp).length,
  secMin: secs[0].toFixed(0), secMedian: secs[secs.length >> 1].toFixed(0), secMax: secs[secs.length - 1].toFixed(0),
  sideAWins: fwd.filter(r => r.winner === 1).length, noWinner: fwd.filter(r => !r.winner).length }));
require('fs').writeFileSync(__dirname + '/node_hashes.json', JSON.stringify(fwd.map(r => [r.seed, r.a, r.b, r.stage, r.winner, r.ticks, r.hash])));
