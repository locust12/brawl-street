// Drive every achievement definition. Catches the two mistakes that matter: a definition
// that can never fire, and one that fires on the wrong match.
//   node net/test/achievements_test.js
const A = require('../lib/achievements.js');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; return; }
  fail++; console.log('  FAIL', name, extra === undefined ? '' : extra);
};

// a losing, unremarkable match by a brand-new account
const base = {
  won: false, stocks: 0, maxStocks: 2, dmg: 60,
  kos: 1, dealt: 90, taken: 140, falls: 1, combo: 3,
  timeUp: false, oppStocks: 2, real: false, ranked: false, charId: 'doge',
  acct: { games: 1, wins: 0, elo: 1000, streak: 0, chars: [], rankedWins: 0 },
};
const ctx = (over, acct) => ({ ...base, ...over, acct: { ...base.acct, ...(acct || {}) } });

// ---- 1. every definition is reachable
console.log('\n1. every definition can fire');
const reach = {
  first_match:  ctx({}),
  first_win:    ctx({ won: true, stocks: 1 }),
  first_ranked: ctx({ ranked: true }),
  flawless:     ctx({ won: true, stocks: 2 }),
  untouched:    ctx({ won: true, stocks: 2, taken: 0 }),
  comeback:     ctx({ won: true, stocks: 1, oppStocks: 2 }),
  dominant:     ctx({ won: true, stocks: 1, dealt: 400, taken: 100 }),
  punisher:     ctx({ dealt: 500 }),
  combo_8:      ctx({ combo: 8 }),
  combo_12:     ctx({ combo: 12 }),
  ko_three:     ctx({ kos: 3 }),
  decision:     ctx({ won: true, stocks: 1, timeUp: true }),
  heavy_hitter: ctx({ dealt: 300 }),
  iron_chin:    ctx({ won: true, stocks: 1, dmg: 130 }),
  no_falls:     ctx({ won: true, stocks: 1, falls: 0 }),
  games_10:     ctx({}, { games: 10 }),
  games_50:     ctx({}, { games: 50 }),
  games_250:    ctx({}, { games: 250 }),
  wins_10:      ctx({}, { wins: 10 }),
  wins_50:      ctx({}, { wins: 50 }),
  wins_250:     ctx({}, { wins: 250 }),
  streak_3:     ctx({}, { streak: 3 }),
  streak_5:     ctx({}, { streak: 5 }),
  streak_10:    ctx({}, { streak: 10 }),
  roster_5:     ctx({}, { chars: Array.from({ length: 5 }, (_, i) => 'c' + i) }),
  roster_15:    ctx({}, { chars: Array.from({ length: 15 }, (_, i) => 'c' + i) }),
  roster_all:   ctx({}, { chars: Array.from({ length: 46 }, (_, i) => 'c' + i) }),
  ranked_10:    ctx({}, { rankedWins: 10 }),
  elo_1200:     ctx({}, { elo: 1200 }),
  elo_1500:     ctx({}, { elo: 1500 }),
  elo_1800:     ctx({}, { elo: 1800 }),
};
for (const d of A.DEFS) {
  const c = reach[d.id];
  if (!c) { fail++; console.log('  FAIL', d.id, '-- no case written for this definition'); continue; }
  ok(d.id + ' fires', A.evaluate(c, {}).includes(d.id));
}
ok('no definition is untested', Object.keys(reach).length === A.DEFS.length,
   `${Object.keys(reach).length} cases vs ${A.DEFS.length} defs`);

// ---- 2. the losing baseline earns only the participation one
console.log('2. a plain loss earns only Step Up');
{
  const got = A.evaluate(base, {});
  ok('plain loss -> [first_match]', got.length === 1 && got[0] === 'first_match', JSON.stringify(got));
}

// ---- 3. win-gated achievements must not fire on a loss
console.log('3. win-gated defs never fire on a loss');
for (const id of ['first_win', 'flawless', 'untouched', 'comeback', 'decision', 'iron_chin', 'no_falls', 'dominant']) {
  const c = { ...reach[id], won: false };
  ok(id + ' needs a win', !A.evaluate(c, {}).includes(id));
}

// ---- 4. already-earned achievements are never returned again
console.log('4. earned achievements do not repeat');
{
  const c = ctx({ won: true, stocks: 2, taken: 0 });
  const first = A.evaluate(c, {});
  ok('first pass earns several', first.length > 1, JSON.stringify(first));
  const have = {}; for (const id of first) have[id] = Date.now();
  ok('second pass earns nothing', A.evaluate(c, have).length === 0);
}

// ---- 5. comeback must not fire on a flawless win (it is the opposite match)
console.log('5. comeback and flawless are mutually exclusive');
{
  const flaw = A.evaluate(ctx({ won: true, stocks: 2, oppStocks: 0 }), {});
  ok('flawless win is not a comeback', flaw.includes('flawless') && !flaw.includes('comeback'), JSON.stringify(flaw));
  const back = A.evaluate(ctx({ won: true, stocks: 1, oppStocks: 2 }), {});
  ok('comeback win is not flawless', back.includes('comeback') && !back.includes('flawless'), JSON.stringify(back));
}

// ---- 6. a thrown test must not take the match down with it
console.log('6. a broken definition cannot break settlement');
{
  let threw = false;
  try { A.evaluate({ /* nothing -- every test will throw on ctx.acct */ }, {}); }
  catch (e) { threw = true; }
  ok('evaluate() swallows definition errors', !threw);
}

// ---- 7. xp and progress
console.log('7. xp and progress');
{
  const p0 = A.progress({});
  ok('empty progress', p0.earned === 0 && p0.xp === 0 && p0.total === A.DEFS.length);
  const all = {}; for (const d of A.DEFS) all[d.id] = 1;
  const p1 = A.progress(all);
  ok('full progress', p1.earned === A.DEFS.length && p1.xp === p1.maxXp, JSON.stringify(p1));
  ok('unknown ids ignored in xp', A.totalXp({ not_a_real_id: 1 }) === 0);
  ok('catalog matches defs', A.catalog().length === A.DEFS.length);
  ok('every catalog row is complete', A.catalog().every(r => r.id && r.name && r.desc && r.tier && r.xp > 0));
  const ids = new Set(A.DEFS.map(d => d.id));
  ok('no duplicate ids', ids.size === A.DEFS.length);
}

console.log(`\n${pass} passed, ${fail} failed`);
console.log(`catalog: ${A.DEFS.length} achievements, ${A.progress({}).maxXp} XP total\n`);
process.exit(fail ? 1 : 0);
