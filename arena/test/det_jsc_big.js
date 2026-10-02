load('../fightsim.js');
const rows = JSON.parse(readFile('big_hashes.json'));
let bad = 0, same = 0;
for (const [seed, a, b, st, winner, ticks, hash] of rows) {
  const r = FightSim.runFight(seed, a, b, st);
  if (r.hash === hash && r.winner === winner && r.ticks === ticks) same++; else { bad++; print('DIFF ' + seed.slice(0, 12) + ' node=' + hash + '/' + winner + ' jsc=' + r.hash + '/' + r.winner); }
}
print(JSON.stringify({ engine: 'JavaScriptCore', fights: rows.length, identical: same, different: bad }));
