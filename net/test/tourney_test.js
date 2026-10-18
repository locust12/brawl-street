'use strict';
// The tournament, run for real against a stub accounts table: a 64 field drawn, every round played
// out, a champion crowned -- plus the cases that actually happen on the night and would otherwise
// be discovered during one: an unfilled bracket, a no-show, a withdrawal, a stranger with the room
// code, and a result arriving from a room the bracket never opened.
//   node test/tourney_test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Tourney, seedOrder, sizeFor } = require('../lib/tourney');

let fails = 0;
const ok = (cond, what) => { if (cond) console.log('  ok  ' + what); else { fails++; console.log('  FAIL ' + what); } };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tourney-'));

// A stand-in for lib/accounts.js: the bracket only ever reads byId, and only name, x, elo and rg.
function stubAccounts(n, opts) {
  const o = opts || {};
  const acc = new Map();
  for (let i = 1; i <= n; i++) {
    acc.set('a' + i, { id: 'a' + i, name: 'P' + i, x: o.noX ? null : 'player' + i, elo: 1200 + (n - i) * 7, rg: o.unrated ? 0 : 10, test: false });
  }
  return { byId: id => acc.get(id) || null, _acc: acc };
}
function makeEvent(dir, ev) {
  fs.writeFileSync(path.join(dir, 'tourney-event.json'), JSON.stringify(Object.assign({
    id: 'test-1', name: 'Test Open', cap: 64, waitlist: 8,
    opensAt: Date.now() - 60e3, closesAt: Date.now() + 3600e3, startsAt: Date.now() + 7200e3,
  }, ev)));
}
// Stand in for the server: hand out a fake room code per pair, remember the pushes.
function wire(t) {
  const sent = [];
  let n = 0;
  t.api = {
    room: () => 'RM' + String(++n).padStart(3, '0'),
    push: (ids, msg) => sent.push({ ids, msg }),
    sync: () => {},
    close: () => {},
  };
  return sent;
}
// A finished-match record of exactly the shape server.js builds in endMatch.
function result(pair, winnerAcct, over) {
  const players = [{ slot: 0, acct: pair.a, name: 'A', stocks: 1, dmg: 400 }, { slot: 1, acct: pair.b, name: 'B', stocks: 0, dmg: 520 }];
  return Object.assign({ id: 'm' + Math.random().toString(36).slice(2, 10), at: Date.now(), code: pair.code,
    ranked: true, reason: 'ko', cancelled: false, ticks: 9000, replay: 'deadbeef',
    winner: winnerAcct === pair.a ? 0 : 1, players }, over || {});
}
// Play the live round out, the better seed always winning, until the bracket is done.
function playOut(t, pick) {
  for (let guard = 0; guard < 400 && t.phase === 'live'; guard++) {
    const r = t.round();
    const live = r.pairs.filter(p => !p.winner && !p.done);
    if (!live.length) break;
    for (const p of live) {
      t.checkIn(p.a, {}); t.checkIn(p.b, {});
      const want = pick ? pick(p) : ((t.entrant(p.a) || {}).seed <= (t.entrant(p.b) || {}).seed ? p.a : p.b);
      // Keep feeding the set until it is taken: a Bo3 needs two, a Bo5 three.
      for (let g = 0; g < 5 && !p.winner; g++) t.onMatch(result(p, want));
    }
  }
}

console.log('seed order and bracket size');
ok(JSON.stringify(seedOrder(2)) === '[1,2]', 'seedOrder(2) is 1 v 2');
ok(JSON.stringify(seedOrder(4)) === '[1,4,2,3]', 'seedOrder(4) puts 1 v 4 and 2 v 3');
ok(JSON.stringify(seedOrder(8)) === '[1,8,4,5,2,7,3,6]', 'seedOrder(8) matches the standard draw');
for (const n of [8, 16, 32, 64, 128]) {
  const o = seedOrder(n);
  ok(o.length === n && new Set(o).size === n, 'seedOrder(' + n + ') is a permutation of 1..' + n);
  // Seeds 1 and 2 must land in opposite halves, or they meet before the final.
  ok(o.indexOf(1) < n / 2 && o.indexOf(2) >= n / 2, 'seeds 1 and 2 are in opposite halves of a ' + n + ' draw');
}
ok(sizeFor(2) === 4 && sizeFor(40) === 64 && sizeFor(64) === 64 && sizeFor(65) === 128, 'a field rounds up to the next bracket size');

console.log('\na full 64 field, drawn and played to a champion');
{
  const dir = tmp(); makeEvent(dir, { startsAt: Date.now() + 7200e3 });
  const t = new Tourney({ dataDir: dir, accounts: stubAccounts(64) });
  wire(t);
  for (let i = 1; i <= 64; i++) t.join('a' + i);
  ok(t.seats() === 64, '64 seats taken');
  ok(t.join('a1').already === true, 'entering twice is not two seats');
  const d = t.draw();
  ok(d.ok && d.size === 64 && d.field === 64, 'a 64 field draws a 64 bracket');
  ok(t.round().pairs.length === 32, 'the opening round is 32 matches');
  ok(t.round().pairs.every(p => p.a && p.b), 'no byes in a full field');
  ok(t.round().bestOf === 1, 'the round of 64 is one game');
  // Seed 1 and seed 64 must be the first pair of a standard draw.
  const first = t.round().pairs[0];
  ok(t.entrant(first.a).seed === 1 && t.entrant(first.b).seed === 64, 'seed 1 opens against seed 64');
  playOut(t);
  ok(t.phase === 'done', 'the bracket finished');
  ok(t.bracket.rounds.length === 6, 'six rounds for 64');
  ok(t.bracket.rounds.map(r => r.bestOf).join(',') === '1,1,1,3,3,5', 'games per round go 1,1,1,3,3,5');
  const champ = t.entrant(t.bracket.champion);
  ok(champ && champ.seed === 1 && champ.place === 1, 'the top seed wins when the better seed always wins');
  ok(champ.w === 6, 'the champion won six matches');
  const table = t.table();
  ok(table.length === 64 && table[0].place === 1, 'the standings table holds all 64, champion first');
  ok(table.filter(x => x.place === 33).length === 32, '32 players share 33rd, the round they went out in');
  ok(t.games.filter(g => g.round === 6).length >= 3, 'the final needed at least three games');
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'tourney.json'), 'utf8'));
  ok(saved.phase === 'done' && saved.bracket.rounds.length === 6, 'the finished bracket is on disk');
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\nan unfilled field: byes go to the top seeds and resolve at once');
{
  const dir = tmp(); makeEvent(dir, {});
  const t = new Tourney({ dataDir: dir, accounts: stubAccounts(40) });
  wire(t);
  for (let i = 1; i <= 40; i++) t.join('a' + i);
  const d = t.draw();
  ok(d.ok && d.size === 64, '40 entrants draw a 64 bracket');
  const r1 = t.bracket.rounds[0];
  const byes = r1.pairs.filter(p => p.how === 'bye');
  ok(byes.length === 24, '24 byes for a field of 40 in a 64 draw');
  ok(byes.every(p => t.entrant(p.winner).seed <= 24), 'every bye went to a top-24 seed');
  ok(t.entrant('a1').w === 1, 'the top seed is through on its bye');
  playOut(t);
  ok(t.phase === 'done' && t.entrant(t.bracket.champion).seed === 1, 'an unfilled bracket still finishes');
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\nthe waiting list');
{
  const dir = tmp(); makeEvent(dir, { cap: 8, waitlist: 4 });
  const t = new Tourney({ dataDir: dir, accounts: stubAccounts(16) });
  wire(t);
  for (let i = 1; i <= 12; i++) t.join('a' + i);
  ok(t.seats() === 8 && t.waiting() === 4, '8 in, 4 waiting');
  ok(t.join('a13').ok === false, 'a full field with a full list refuses the 13th');
  t.leave('a3');
  ok(t.seats() === 8, 'a withdrawal before the draw is backfilled to a full field');
  ok(t.entrant('a9').status === 'in', 'the earliest waiting entrant took the seat');
  ok(t.waiting() === 3, 'the list is one shorter');
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\nno-shows, withdrawals and the round clock');
{
  const dir = tmp(); makeEvent(dir, { cap: 8, checkInMs: 2 * 60e3, roundMs: 5 * 60e3 });
  const t = new Tourney({ dataDir: dir, accounts: stubAccounts(8) });
  wire(t);
  for (let i = 1; i <= 8; i++) t.join('a' + i);
  t.draw();
  const r1 = t.bracket.rounds[0];
  // Pair 0 is seed 1 v seed 8. Only seed 8 shows up.
  const p0 = r1.pairs[0];
  t.checkIn(p0.b, {});
  // Pair 1 (seed 4 v seed 5): neither shows up.
  // Pair 2 (seed 2 v seed 7): a withdrawal mid-bracket.
  const p2 = r1.pairs[2];
  const wd = t.leave(p2.a);
  ok(wd.ok && p2.winner === p2.b, 'withdrawing after the draw forfeits the live match');
  ok(t.entrant(p2.a).status === 'out' && t.entrant(p2.a).out === 'withdrew', 'the withdrawer is out, with a reason');
  // Push every deadline into the past and sweep.
  for (const p of r1.pairs) if (!p.winner) p.deadline = Date.now() - 1000;
  t.sweep();
  ok(p0.winner === p0.b && p0.how === 'no-show', 'the player who showed up advances on a no-show');
  ok(r1.pairs[1].winner && r1.pairs[1].how.indexOf('both no-show') === 0, 'both absent: the higher seed advances, and it says so');
  ok(t.entrant(r1.pairs[1].winner).seed === 4, 'that is the better seed of the two');
  ok(r1.pairs.every(p => p.winner), 'the round resolved with nobody left waiting');
  ok(t.bracket.rounds.length === 2, 'the next round opened by itself');
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\nthe round clock cuts an unfinished set');
{
  const dir = tmp(); makeEvent(dir, { cap: 4, roundMs: 60e3 });
  const t = new Tourney({ dataDir: dir, accounts: stubAccounts(4) });
  wire(t);
  for (let i = 1; i <= 4; i++) t.join('a' + i);
  t.draw();
  const r1 = t.bracket.rounds[0];
  ok(r1.bestOf === 3, 'a field of 4 opens on best of three');
  const p = r1.pairs[0];
  t.checkIn(p.a, {}); t.checkIn(p.b, {});
  t.onMatch(result(p, p.b));
  ok(p.wb === 1 && !p.winner, 'one game in, the set is not over');
  r1.endsBy = Date.now() - 1; for (const q of r1.pairs) if (!q.winner) q.deadline = Date.now() - 1;
  t.sweep();
  ok(p.winner === p.b && /ahead 1-0/.test(p.how), 'whoever is ahead on games takes a set cut short by the clock');
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\nwhat the bracket refuses');
{
  const dir = tmp(); makeEvent(dir, { cap: 8 });
  const t = new Tourney({ dataDir: dir, accounts: stubAccounts(9) });
  wire(t);
  ok(t.join('nobody').ok === false, 'an unknown account cannot enter');
  for (let i = 1; i <= 8; i++) t.join('a' + i);
  t.draw();
  ok(t.join('a9').ok === false, 'entries are closed once the bracket is drawn');
  ok(t.join('a1').already === true, 'someone already in is told so, not refused');
  const p = t.round().pairs[0];
  // A result from a room the bracket never opened.
  const stray = result(p, p.a); stray.code = 'XXXXX';
  ok(t.onMatch(stray) === false, 'a game played outside the pair room scores nothing');
  ok(p.wa === 0 && p.wb === 0, 'and the set is untouched');
  t.checkIn(p.a, {});
  const good = result(p, p.a);
  ok(t.onMatch(good) === true, 'a game in the pair room does score');
  // A result between two players who are not a live pair.
  const other = t.round().pairs[1];
  const mixed = result({ a: p.a, b: other.b, code: p.code }, p.a);
  ok(t.onMatch(mixed) === false, 'a game between two players who are not a pair scores nothing');
  // Nobody who is not in the event can check in.
  ok(t.checkIn('a1' === p.a ? 'a2' : 'a1', {}).ok !== undefined, 'checkIn always answers');
  ok(t.checkIn('nobody', {}).ok === false, 'a stranger cannot check in');
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\nX connect is the entry requirement');
{
  const dir = tmp(); makeEvent(dir, { cap: 8 });
  const t = new Tourney({ dataDir: dir, accounts: stubAccounts(8, { noX: true }) });
  wire(t);
  const r = t.join('a1');
  ok(r.ok === false && r.needX === true, 'no connected handle, no entry, and the page is told why');
  process.env.TOURNEY_X = '0';
  ok(t.join('a1').ok === true, 'TOURNEY_X=0 drops it for a LAN event');
  delete process.env.TOURNEY_X;
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\nseeding: rated players ahead of unrated, entry order breaks a tie');
{
  const dir = tmp(); makeEvent(dir, { cap: 8 });
  const acc = stubAccounts(8);
  // a5 and a6 have never played a ranked game, and a7/a8 are level on Elo.
  acc._acc.get('a5').rg = 0; acc._acc.get('a6').rg = 0;
  acc._acc.get('a7').elo = 1300; acc._acc.get('a8').elo = 1300;
  const t = new Tourney({ dataDir: dir, accounts: acc });
  wire(t);
  for (const id of ['a8', 'a7', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6']) t.join(id);
  t.draw();
  ok(t.entrant('a5').seed > 6 && t.entrant('a6').seed > 6, 'unrated players seed behind every rated one');
  ok(t.entrant('a8').seed < t.entrant('a7').seed, 'level on Elo, the earlier entrant takes the better seed');
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\nthe operator override, and the clock drawing on its own');
{
  const dir = tmp(); makeEvent(dir, { cap: 8, startsAt: Date.now() - 1000, closesAt: Date.now() - 2000 });
  const t = new Tourney({ dataDir: dir, accounts: stubAccounts(8) });
  wire(t);
  // closesAt is already past, so entries are shut and the sweep should draw by itself.
  ok(t.open() === false, 'entries are shut once closesAt has passed');
  fs.rmSync(dir, { recursive: true, force: true });
}
{
  const dir = tmp(); makeEvent(dir, { cap: 8, opensAt: Date.now() - 10e3, closesAt: Date.now() + 50, startsAt: Date.now() + 60 });
  const t = new Tourney({ dataDir: dir, accounts: stubAccounts(8) });
  wire(t);
  for (let i = 1; i <= 8; i++) t.join('a' + i);
  const until = Date.now() + 400; while (Date.now() < until) { /* let the two timestamps pass */ }
  t.sweep();
  ok(!!t.bracket && t.phase === 'live', 'the clock closed entries and drew the bracket with nobody watching');
  const p = t.round().pairs[0];
  const f = t.force(p.pid, p.b, 'opponent lagged out twice');
  ok(f.ok && p.winner === p.b, 'the operator can hand a match to either player');
  ok(/^operator: opponent lagged out twice/.test(p.how), 'and the reason lands in the bracket where players read it');
  ok(t.force(p.pid, p.a, 'again').ok === false, 'a decided match cannot be forced again');
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\nthe public board leaks nothing');
{
  const dir = tmp(); makeEvent(dir, { cap: 8 });
  const t = new Tourney({ dataDir: dir, accounts: stubAccounts(8) });
  wire(t);
  for (let i = 1; i <= 8; i++) t.join('a' + i);
  t.draw();
  const pub = JSON.stringify(t.state(null));
  ok(pub.indexOf('"a1"') < 0 && !/\ba[0-9]+\b/.test(JSON.parse(pub).entrants.map(e => e.name).join(' ')), 'no account ids in the public board');
  ok(/"name":"player1"/.test(pub) || /player1/.test(pub), 'names are the connected handles');
  const mine = t.state('a1');
  ok(mine.me && mine.me.seed === 1, 'a player sees their own seed');
  ok(mine.next && mine.next.opponent, 'and their next opponent');
  ok(t.state(null).me === undefined, 'the anonymous board has no "me"');
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\nno event announced');
{
  const dir = tmp();
  const t = new Tourney({ dataDir: dir, accounts: stubAccounts(4) });
  wire(t);
  ok(t.state(null).on === false, 'the screen is told there is nothing on');
  ok(t.join('a1').ok === false, 'nobody can enter nothing');
  const an = t.announce({ id: 'fresh-1', name: 'Fresh Open', cap: 16, opensAt: Date.now() - 1000, closesAt: Date.now() + 60e3, startsAt: Date.now() + 120e3 });
  ok(an.ok && t.ev.cap === 16, 'announcing writes the event and opens entries');
  ok(t.join('a1').ok === true, 'and the first entry lands');
  ok(fs.existsSync(path.join(dir, 'tourney-event.json')), 'the announcement is on disk');
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\nreload: a restart keeps the bracket');
{
  const dir = tmp(); makeEvent(dir, { cap: 8 });
  const t1 = new Tourney({ dataDir: dir, accounts: stubAccounts(8) });
  wire(t1);
  for (let i = 1; i <= 8; i++) t1.join('a' + i);
  t1.draw();
  const p = t1.round().pairs[0];
  t1.checkIn(p.a, {}); t1.checkIn(p.b, {});
  t1.onMatch(result(p, p.a));
  t1.flush(); t1.stop();
  const t2 = new Tourney({ dataDir: dir, accounts: stubAccounts(8) });
  wire(t2);
  ok(t2.phase === 'live' && t2.bracket && t2.round().pairs.length === 4, 'the drawn bracket came back');
  ok(t2.entrant('a1').seed === 1, 'seeds came back');
  ok(t2.round().pairs[0].winner === p.winner, 'a decided pair stayed decided');
  ok(t2.games.length === 1, 'the game record came back');
  t2.stop();
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('');
if (fails) { console.log(fails + ' FAILED'); process.exit(1); }
console.log('all tournament checks passed');
