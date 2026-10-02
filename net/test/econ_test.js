'use strict';
// Tests for the economy: entitlements, level unlocks, XP from the server's own stats, the monthly
// ladder, the season payout, the stub store, and — the one that matters — that a wagered or ranked
// room can never carry a bought weapon into the fight.
//   node net/test/econ_test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { Accounts } = require('../lib/accounts');
const { Economy, monthId } = require('../lib/economy');
const C = require('../lib/catalog');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'econtest-'));
const accounts = new Accounts(dir);
accounts.showTests = true;
const log = () => {};
let fails = 0, ran = 0;
const t = (name, fn) => { ran++; try { fn(); console.log('  ok  ' + name); } catch (e) { fails++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); } };

const econ = new Economy({ dataDir: dir, accounts, log });
const mk = n => { const th = Accounts.hashToken('tok' + n); const a = accounts.get(th); a.name = 'P' + n; return { th, a, id: a.id }; };
const A = mk(1), B = mk(2), D = mk(3);

console.log('catalog');
t('catalog reads from src/89_econ.js', () => {
  assert.ok(C.CAT.weapons.length >= 15, 'at least 15 weapons, got ' + C.CAT.weapons.length);
  assert.ok(C.CAT.weapons.every(w => w.id && w.kind && w.name && w.price != null && w.blurb && w.how && w.counter),
    'every weapon needs id/kind/name/price/blurb/how/counter');
  const tiers = { 15: 0, mid: 0, 100: 0 };
  for (const w of C.CAT.weapons) { if (w.tier === 15) tiers[15]++; else if (w.tier === 100) tiers[100]++; else tiers.mid++; }
  assert.ok(tiers[15] >= 4, '$15 shelf');
  assert.ok(tiers.mid >= 12, 'the $20-50 shelf should have at least 12, got ' + tiers.mid);
  assert.ok(tiers[100] >= 2, '$100 shelf');
});
t('every weapon price is in one of the tiers Duane asked for', () => {
  for (const w of C.CAT.weapons) {
    const d = w.price / 100;
    assert.ok(d === 15 || (d >= 20 && d <= 50) || d === 100, w.id + ' is $' + d);
  }
});
t('cosmetics have no gameplay fields', () => {
  for (const c of C.CAT.cosmetics) for (const k of ['kind', 'charges', 'dmg', 'boom']) assert.ok(!(k in c), c.id + ' has ' + k);
});

console.log('entitlements');
t('a fresh account owns nothing but its level grants', () => {
  assert.deepStrictEqual(econ.owned(A.id).sort(), C.levelGrants(1).slice().sort());
  assert.strictEqual(econ.owns(A.id, 'strike'), false);
});
t('levels grant the cheap shelf for free', () => {
  econ.row(A.id).xp = C.xpForLevel(10);
  const own = econ.owned(A.id);
  for (const w of C.CAT.weapons.filter(x => x.unlock != null && x.unlock <= 10)) assert.ok(own.includes(w.id), 'level 10 should include ' + w.id);
  assert.ok(!own.includes('strike'), 'the $50 airstrike is never a level grant');
});
t('grant adds an item, a bundle expands', () => {
  econ.grant(B.id, ['strike'], 'test');
  assert.ok(econ.owns(B.id, 'strike'));
  econ.grant(B.id, ['bnd_starter'], 'test');
  for (const id of C.BY.get('bnd_starter').grants) assert.ok(econ.owns(B.id, id), 'bundle should grant ' + id);
});
t('a client cannot equip or load out what it does not own', () => {
  const st = econ.set(A.id, { loadout: ['strike', 'holy', 'peel'], equip: { aura: 'aur_rain', plate: 'plt_found' } });
  assert.ok(!st.loadout.includes('strike'), 'strike is not owned');
  assert.ok(st.loadout.includes('peel'), 'peel is a level-2 grant');
  assert.deepStrictEqual(st.equip, {}, 'no cosmetics owned yet');
});
t('a cosmetic can only go in its own slot', () => {
  econ.grant(A.id, ['aur_rain'], 'test');
  const st = econ.set(A.id, { equip: { trail: 'aur_rain' } });
  assert.strictEqual(st.equip.trail, undefined, 'an aura is not a trail');
  const st2 = econ.set(A.id, { equip: { aura: 'aur_rain' } });
  assert.strictEqual(st2.equip.aura, 'aur_rain');
});
t('the loadout is capped at three', () => {
  econ.grant(A.id, ['peel', 'prod', 'girder', 'bouncer', 'zip'], 'test');
  const st = econ.set(A.id, { loadout: ['peel', 'prod', 'girder', 'bouncer', 'zip'] });
  assert.strictEqual(st.loadout.length, 3);
});

console.log('THE FAIRNESS RULE');
const players = th => [{ human: true, th }, { human: true, th: B.th }];
t('a free casual room carries the loadout', () => {
  const r = econ.arsenalFor({ stake: 0, ranked: false, items: true }, players(A.th));
  assert.strictEqual(r.on, true);
  assert.ok(r.loadouts[0].length > 0, 'player 1 brings something');
});
t('a WAGERED room carries nothing', () => {
  for (const stake of [0.01, 0.05, 0.1, 0.25]) {
    const r = econ.arsenalFor({ stake, ranked: false, items: true }, players(A.th));
    assert.strictEqual(r.on, false, 'stake ' + stake + ' must be off');
    assert.strictEqual(r.loadouts, undefined);
  }
});
t('a RANKED room carries nothing', () => {
  const r = econ.arsenalFor({ stake: 0, ranked: true, items: true }, players(A.th));
  assert.strictEqual(r.on, false);
});
t('a REAL-ETH room carries nothing', () => {
  const r = econ.arsenalFor({ stake: 0, real: { id: 1 }, items: true }, players(A.th));
  assert.strictEqual(r.on, false);
});
t('an items-off room carries nothing', () => {
  const r = econ.arsenalFor({ stake: 0, ranked: false, items: false }, players(A.th));
  assert.strictEqual(r.on, false);
});
t('loadouts are item KINDS the fight engine knows, not store ids', () => {
  const r = econ.arsenalFor({ stake: 0, ranked: false, items: true }, players(A.th));
  for (const k of r.loadouts[0]) assert.ok(Object.values(C.KIND_OF).includes(k), k + ' is not a weapon kind');
});

console.log('store (stub)');
t('buying is refused while payments are off', () => {
  econ.mode = 'off';
  const r = econ.buy(D.id, { id: 'strike' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.off, true);
  assert.strictEqual(econ.owns(D.id, 'strike'), false);
});
t('the stub provider grants, and only with PAYMENTS=stub', () => {
  econ.mode = 'stub';
  const r = econ.buy(D.id, { id: 'strike' });
  assert.strictEqual(r.ok, true);
  assert.ok(econ.owns(D.id, 'strike'));
  assert.strictEqual(econ.buy(D.id, { id: 'strike' }).ok, false, 'no double buy');
  assert.strictEqual(econ.buy(D.id, { id: 'nope' }).ok, false, 'unknown id');
  assert.strictEqual(econ.buy(D.id, { id: 'plt_champ' }).ok, false, 'season prizes are not for sale');
  econ.mode = 'off';
});

console.log('XP from the server\'s own fight');
t('a win pays more than a loss and a level unlocks weapons', () => {
  const M = { slots: [{ i: 0, human: true, th: A.th }, { i: 1, human: true, th: B.th }] };
  const before = econ.row(A.id).xp;
  const out = econ.matchDone(M, { payee: 0, stats: [{ kos: 3, dealt: 140 }, { kos: 1, dealt: 60 }], cancelled: false, ranked: false, held: false });
  assert.ok(out[0].xp > out[1].xp, 'the winner earns more');
  assert.strictEqual(econ.row(A.id).xp, before + out[0].xp);
  assert.strictEqual(econ.row(A.id).rec.w, 1);
  assert.strictEqual(econ.row(B.id).rec.l, 1);
});
t('a cancelled match pays nothing', () => {
  const M = { slots: [{ i: 0, human: true, th: A.th }] };
  const before = econ.row(A.id).xp;
  econ.matchDone(M, { payee: -1, stats: [{}], cancelled: true, ranked: false });
  assert.strictEqual(econ.row(A.id).xp, before);
});
t('a dropped player gets participation XP only', () => {
  const M = { slots: [{ i: 0, human: true, th: D.th, dropped: true }] };
  const before = econ.row(D.id).xp;
  econ.matchDone(M, { payee: 1, stats: [{ kos: 9, dealt: 900 }], cancelled: false, ranked: false });
  assert.ok(econ.row(D.id).xp - before < 40, 'a leaver cannot farm XP, got ' + (econ.row(D.id).xp - before));
});

console.log('monthly ladder');
t('a ranked 1v1 moves the monthly rating', () => {
  const M = { slots: [{ i: 0, human: true, th: A.th }, { i: 1, human: true, th: B.th }] };
  econ.matchDone(M, { payee: 0, stats: [{ kos: 2, dealt: 100 }, { kos: 0, dealt: 40 }], cancelled: false, ranked: true, held: false });
  assert.ok(A.a.month && A.a.month.id === monthId());
  assert.ok(A.a.month.elo > 1200, 'winner up, got ' + A.a.month.elo);
  assert.ok(B.a.month.elo < 1200, 'loser down');
});
t('a HELD match does not move the ladder', () => {
  const before = A.a.month.elo;
  const M = { slots: [{ i: 0, human: true, th: A.th }, { i: 1, human: true, th: B.th }] };
  econ.matchDone(M, { payee: 0, stats: [{}, {}], cancelled: false, ranked: true, held: true });
  assert.strictEqual(A.a.month.elo, before);
});
t('the board ranks and the leaderboard route carries it', () => {
  const b = econ.monthly(10);
  assert.strictEqual(b.id, monthId());
  assert.ok(b.rows.length >= 2);
  assert.strictEqual(b.rows[0].rank, 1);
  assert.ok(b.rows[0].elo >= b.rows[1].elo);
  const lb = accounts.leaderboard(10);
  assert.ok(Array.isArray(lb.month), 'accounts.leaderboard() must now carry `month`');
  assert.ok(lb.monthSeason && lb.monthSeason.id === monthId());
});
t('a player can see their own season standing', () => {
  const s = econ.seasonOf(A.id);
  assert.strictEqual(s.id, monthId());
  assert.ok(s.rank >= 1);
});

console.log('season payout: the anti-farm gate');
// The scenario below used to BE this test: two accounts, a couple of ranked matches, pay the
// winner. That is the farm, written down — see dev/NOTES-security.md #16 — so now it has to fail.
t('two accounts trading wins are NOT paid', () => {
  const el = econ.seasonEligible(A.a, monthId());
  assert.strictEqual(el.ok, false, 'A should not be eligible off matches against B alone');
  assert.ok(/distinct opponent/.test(el.why), 'the reason should be the opponent count, got: ' + el.why);
  const r = econ.closeSeason(monthId(), { dry: true });
  assert.strictEqual(r.paid.length, 0, 'nobody is paid out of a two-account ladder');
  assert.ok(r.skipped.length >= 2, 'both accounts are listed as not eligible');
});
t('an account cannot farm one opponent for a prize', () => {
  // 30 wins, all against the same person, plus a token few against others
  const E = mk(90), F = mk(91);
  for (let i = 0; i < 30; i++) econ.matchDone({ slots: [{ i: 0, human: true, th: E.th }, { i: 1, human: true, th: F.th }] },
    { payee: 0, stats: [{}, {}], cancelled: false, ranked: true, held: false });
  for (let n = 92; n < 96; n++) {
    const G = mk(n);
    econ.matchDone({ slots: [{ i: 0, human: true, th: E.th }, { i: 1, human: true, th: G.th }] },
      { payee: 0, stats: [{}, {}], cancelled: false, ranked: true, held: false });
  }
  const el = econ.seasonEligible(E.a, monthId());
  assert.strictEqual(el.ok, false, 'E has 5 opponents and 34 games but 88% of them are one person');
  assert.ok(/against one opponent/.test(el.why), 'reason should be the pair share, got: ' + el.why);
});
t('a flagged account is HELD, not denied', () => {
  const H = mk(80);
  for (let n = 81; n < 89; n++) {
    const O = mk(n);
    for (let k = 0; k < 2; k++) econ.matchDone({ slots: [{ i: 0, human: true, th: H.th }, { i: 1, human: true, th: O.th }] },
      { payee: 0, stats: [{}, {}], cancelled: false, ranked: true, held: false });
  }
  assert.strictEqual(econ.seasonEligible(H.a, monthId()).ok, true, 'H plays a normal season');
  const bot = id => (id === H.id ? { score: 92, matches: 40 } : null);
  const el = econ.seasonEligible(H.a, monthId(), bot);
  assert.strictEqual(el.ok, false);
  assert.strictEqual(el.hold, true, 'a high automation score holds the prize for review');
  const r = econ.closeSeason(monthId(), { dry: true, bot });
  assert.ok(r.held.some(x => x.id === H.id), 'and the close lists them under held');
});

console.log('season payout: a real season');
t('a legitimate ladder pays the top ranks once, and archives the standings', () => {
  const id = monthId();
  // ten players, everyone plays everyone: no pair dominates and everyone clears the volume bar
  const P = [];
  for (let n = 100; n < 110; n++) P.push(mk(n));
  for (let i = 0; i < P.length; i++) for (let j = 0; j < P.length; j++) {
    if (i === j) continue;
    econ.matchDone({ slots: [{ i: 0, human: true, th: P[i].th }, { i: 1, human: true, th: P[j].th }] },
      { payee: i < j ? 0 : 1, stats: [{}, {}], cancelled: false, ranked: true, held: false });
  }
  assert.strictEqual(econ.seasonEligible(P[0].a, id).ok, true, 'a real season passes the gate: ' + econ.seasonEligible(P[0].a, id).why);
  const r1 = econ.closeSeason(id);
  assert.strictEqual(r1.ok, true);
  assert.ok(r1.paid.length >= 1, 'somebody is paid');
  const champ = r1.paid.find(p => p.rank === 1);
  assert.ok(econ.owns(champ.id, 'plt_champ'), 'the champion gets the plate');
  assert.ok(econ.row(champ.id).credits >= 10000);
  assert.ok(econ.row(champ.id).badges.length >= 1);
  // the farmers are on the board but not in the prize ranking
  const st = r1.archive.standings;
  assert.ok(st.length > r1.paid.length, 'the board is bigger than the payout');
  assert.ok(st.some(s => !s.eligible), 'ineligible players are still recorded, with a reason');
  assert.ok(st.every(s => s.prizeRank == null || s.eligible), 'nobody ineligible holds a prize rank');
  // and it is on disk
  const f = path.join(dir, 'seasons', id + '.json');
  assert.ok(fs.existsSync(f), 'standings archived to ' + f);
  const saved = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.strictEqual(saved.season, id);
  assert.ok(saved.rules.minOpponents >= 2, 'the archive records the rules it was closed under');
  const r2 = econ.closeSeason(id);
  assert.strictEqual(r2.ok, false, 'a season pays out exactly once');
});
t('a player can see what they still need, mid-season', () => {
  const s = econ.seasonOf(A.id);
  assert.ok(s.need && s.need.opponents >= 2, 'the rules are published to the page');
  assert.ok(s.have && typeof s.have.opponents === 'number', 'and so is where they are against them');
  assert.strictEqual(s.eligible, false);
  assert.ok(s.why && s.why.length > 4, 'with a reason in words: ' + s.why);
});
t('unpaidSeasons only ever lists months that have ENDED', () => {
  const list = econ.unpaidSeasons();
  assert.ok(!list.includes(monthId()), 'the running month is never auto-closed, got ' + list.join(','));
});
t('a season plate cannot be bought', () => {
  econ.mode = 'stub';
  assert.strictEqual(econ.buy(B.id, { id: 'plt_champ' }).ok, false);
  econ.mode = 'off';
});

console.log('persistence');
t('entitlements survive a restart', () => {
  econ.flush();
  const e2 = new Economy({ dataDir: dir, accounts, log });
  assert.ok(e2.owns(B.id, 'strike'), 'B still owns the airstrike');
  assert.strictEqual(e2.row(A.id).rec.w, econ.row(A.id).rec.w);
});
t('entitlements are in their own file, not accounts.json', () => {
  accounts.flush();
  const acc = fs.readFileSync(path.join(dir, 'accounts.json'), 'utf8');
  assert.ok(!acc.includes('"strike"'), 'accounts.json must not carry entitlements');
  assert.ok(fs.existsSync(path.join(dir, 'economy.json')));
});

console.log(`\n${ran - fails}/${ran} passed`);
try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* tmp */ }
process.exit(fails ? 1 : 0);
