// ===== achievements =====
// Epic requires an achievement system on self-published products, and it is worth having
// regardless: it is the cheapest retention hook available for a game that already records
// everything one needs.
//
// Nothing new is measured. Every achievement below reads fields the fight already keeps
// (f.stats.kos / dealt / taken / falls / combo, f.stocks, f.dmg) or the account already
// stores (games, wins, elo, season). That is deliberate -- a definition needing fresh
// telemetry would become a second source of truth about what happened in a match.
//
// Pure by design: evaluate() takes a plain context and returns ids. No account writes, no
// I/O, no clock. server.js does the persisting, and the tests drive this directly.

// tier drives the badge colour in the UI and maps to Epic's XP buckets on submission
const BRONZE = 'bronze', SILVER = 'silver', GOLD = 'gold', PLATINUM = 'platinum';
const XP = { [BRONZE]: 5, [SILVER]: 15, [GOLD]: 50, [PLATINUM]: 100 };

// ctx, built by server.js at finish():
//   won        bool    did this player take the pot
//   stocks     int     stocks this player had left
//   maxStocks  int     the match's stock count (cfg.stocks)
//   dmg        number  damage % this player was carrying at the end
//   kos, dealt, taken, falls, combo  this player's fight stats (Fighter.stats + stocks/dmg)
//   timeUp     bool    decided on the clock rather than a KO
//   oppStocks  int     stocks the best-placed opponent had left
//   real       bool    wagered match
//   ranked     bool    ranked match
//   charId     string  fighter used
//   acct       object  { games, wins, elo, streak, chars: [ids], rankedWins }
const DEFS = [
  // ---- first steps
  { id: 'first_match',  name: 'Step Up',           desc: 'Play your first match.',                     tier: BRONZE, test: c => c.acct.games >= 1 },
  { id: 'first_win',    name: 'First Blood',       desc: 'Win a match.',                               tier: BRONZE, test: c => c.won },
  { id: 'first_ranked', name: 'On the Ladder',     desc: 'Play a ranked match.',                       tier: BRONZE, test: c => c.ranked },

  // ---- single-match skill; these are the ones that make people try things
  { id: 'flawless',     name: 'Flawless',          desc: 'Win without losing a single stock.',         tier: SILVER,   test: c => c.won && c.stocks >= c.maxStocks },
  { id: 'untouched',    name: 'Untouchable',       desc: 'Win a match without taking a hit.',          tier: PLATINUM, test: c => c.won && c.taken === 0 },
  { id: 'comeback',     name: 'Comeback',          desc: 'Win on your last stock while your opponent still had all of theirs.', tier: GOLD, test: c => c.won && c.stocks === 1 && c.oppStocks >= c.maxStocks - 1 && c.maxStocks >= 2 },
  { id: 'dominant',     name: 'Dominant',          desc: 'Win having dealt three times the damage you took.', tier: GOLD, test: c => c.won && c.taken > 0 && c.dealt >= c.taken * 3 },
  { id: 'punisher',     name: 'Punisher',          desc: 'Deal 500% damage in a single match.',        tier: GOLD,     test: c => c.dealt >= 500 },
  // Thresholds are measured, not guessed: 24 matches of the game's own level-9 AI (48 fighters)
  // reached max 12, mean 3.5, with 8% at >=8 and 4% at >=12. Nothing reached 15, so a 15-hit
  // tier would have been a dead achievement -- the exact trap that caught the first draft.
  // Combo length needs Fighter.stats.combo, added 9/27: src/23_combo.js keeps the string on the
  // VICTIM and nulls it the moment it drops, so the attacker's high-water mark is recorded there
  // instead. These two are the achievements that make people go and learn the game.
  { id: 'combo_8',      name: 'Chained',           desc: 'Land an 8-hit combo.',                       tier: SILVER,   test: c => c.combo >= 8 },
  { id: 'combo_12',     name: 'Unbroken',          desc: 'Land a 12-hit combo.',                       tier: PLATINUM, test: c => c.combo >= 12 },
  { id: 'ko_three',     name: 'Triple KO',         desc: 'Knock an opponent out three times in one match.', tier: SILVER, test: c => c.kos >= 3 },
  { id: 'decision',     name: 'Went the Distance', desc: 'Win a match on the clock.',                  tier: SILVER,   test: c => c.won && c.timeUp },
  { id: 'heavy_hitter', name: 'Heavy Hitter',      desc: 'Deal 300% damage in a single match.',        tier: SILVER,   test: c => c.dealt >= 300 },
  { id: 'iron_chin',    name: 'Iron Chin',         desc: 'Win a match while carrying over 120% damage.', tier: GOLD,   test: c => c.won && c.dmg >= 120 },
  { id: 'no_falls',     name: 'Sure Footed',       desc: 'Win without falling off the stage once.',    tier: BRONZE,   test: c => c.won && c.falls === 0 },

  // ---- volume
  { id: 'games_10',     name: 'Regular',           desc: 'Play 10 matches.',                           tier: BRONZE,   test: c => c.acct.games >= 10 },
  { id: 'games_50',     name: 'Local Legend',      desc: 'Play 50 matches.',                           tier: SILVER,   test: c => c.acct.games >= 50 },
  { id: 'games_250',    name: 'Ever Present',      desc: 'Play 250 matches.',                          tier: GOLD,     test: c => c.acct.games >= 250 },
  { id: 'wins_10',      name: 'Contender',         desc: 'Win 10 matches.',                            tier: BRONZE,   test: c => c.acct.wins >= 10 },
  { id: 'wins_50',      name: 'Hard to Beat',      desc: 'Win 50 matches.',                            tier: SILVER,   test: c => c.acct.wins >= 50 },
  { id: 'wins_250',     name: 'Champion',          desc: 'Win 250 matches.',                           tier: PLATINUM, test: c => c.acct.wins >= 250 },

  // ---- streaks
  { id: 'streak_3',     name: 'Hot Hand',          desc: 'Win 3 in a row.',                            tier: BRONZE,   test: c => c.acct.streak >= 3 },
  { id: 'streak_5',     name: 'On a Run',          desc: 'Win 5 in a row.',                            tier: SILVER,   test: c => c.acct.streak >= 5 },
  { id: 'streak_10',    name: 'Untouchable Run',   desc: 'Win 10 in a row.',                           tier: PLATINUM, test: c => c.acct.streak >= 10 },

  // ---- roster: pushes people off their one comfort character, which is what keeps a
  // fighting game alive past the first week
  { id: 'roster_5',     name: 'Trying Things',     desc: 'Win with 5 different fighters.',             tier: BRONZE,   test: c => c.acct.chars.length >= 5 },
  { id: 'roster_15',    name: 'Well Rounded',      desc: 'Win with 15 different fighters.',            tier: SILVER,   test: c => c.acct.chars.length >= 15 },
  { id: 'roster_all',   name: 'Knows Everyone',    desc: 'Win with every fighter on the roster.',      tier: PLATINUM, test: (c, o) => c.acct.chars.length >= (o.rosterSize || 46) },

  // ---- ranked
  { id: 'ranked_10',    name: 'Climbing',          desc: 'Win 10 ranked matches.',                     tier: SILVER,   test: c => c.acct.rankedWins >= 10 },
  { id: 'elo_1200',     name: 'Rated',             desc: 'Reach 1200 rating.',                         tier: SILVER,   test: c => c.acct.elo >= 1200 },
  { id: 'elo_1500',     name: 'Sharp',             desc: 'Reach 1500 rating.',                         tier: GOLD,     test: c => c.acct.elo >= 1500 },
  { id: 'elo_1800',     name: 'Feared',            desc: 'Reach 1800 rating.',                         tier: PLATINUM, test: c => c.acct.elo >= 1800 },
];

const BY_ID = new Map(DEFS.map(d => [d.id, d]));

// Everything a store submission or the UI needs, without exposing the test functions.
function catalog() {
  return DEFS.map(d => ({ id: d.id, name: d.name, desc: d.desc, tier: d.tier, xp: XP[d.tier] }));
}

// Which achievements this match just earned. `have` is the account's existing map, so an
// achievement is only ever returned the first time it becomes true.
function evaluate(ctx, have, opts) {
  const o = opts || {};
  const out = [];
  for (const d of DEFS) {
    if (have && have[d.id]) continue;
    let ok = false;
    // A bad definition must never be able to break match settlement: the pot matters, the
    // badge does not.
    try { ok = !!d.test(ctx, o); } catch (e) { ok = false; }
    if (ok) out.push(d.id);
  }
  return out;
}

function describe(ids) {
  return (ids || []).map(id => BY_ID.get(id)).filter(Boolean)
    .map(d => ({ id: d.id, name: d.name, desc: d.desc, tier: d.tier, xp: XP[d.tier] }));
}

function totalXp(have) {
  let n = 0;
  for (const id of Object.keys(have || {})) { const d = BY_ID.get(id); if (d) n += XP[d.tier]; }
  return n;
}

function progress(have) {
  const h = have || {};
  return {
    earned: DEFS.filter(d => h[d.id]).length,
    total: DEFS.length,
    xp: totalXp(h),
    maxXp: DEFS.reduce((n, d) => n + XP[d.tier], 0),
  };
}

module.exports = { DEFS, XP, catalog, evaluate, describe, totalXp, progress, BRONZE, SILVER, GOLD, PLATINUM };
