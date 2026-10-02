'use strict';
// Close a monthly season: pay the prizes, issue the peak-based badges, archive the standings, and
// leave the next season to start itself. Design and the reasoning behind every rule below:
// docs/ECONOMY.md §7. The anti-farm gate lives in net/lib/economy.js (`seasonEligible`).
//
//   node net/tools/season-close.js --auto         # close EVERY ended month that has not paid yet
//   node net/tools/season-close.js                # close LAST month
//   node net/tools/season-close.js 2026-09        # close a named season
//   node net/tools/season-close.js --auto --dry   # show exactly what would happen, write nothing
//   node net/tools/season-close.js --board        # the live board + who is not eligible yet
//
// RUN IT DAILY, NOT MONTHLY. `--auto` closes any ended, unpaid month, and closing is idempotent, so
// a daily run is safe to double-fire and — the part that matters — a run that is missed on the 1st
// still pays out on the 2nd. A monthly cron that misses its window silently loses a whole season's
// prizes, and nobody finds out until a player asks.
//
//   # crontab on the game host, inside the container's data dir:
//   10 0 * * *  docker exec brawlstreet node tools/season-close.js --auto >> /var/log/brawl-season.log 2>&1
//
//   # or as a systemd timer (net/tools/season-close.timer + .service)
//
// WHY THERE IS A GATE AT ALL — coordinated with the security session (dev/NOTES-security.md #16).
//   net/lib/integrity.js scores each MATCH and already withholds Elo from a held one. It cannot see
//   a whole month: two real people on two real devices playing each other four hundred times is not
//   a suspicious match, it is four hundred unsuspicious matches, and a cash prize is exactly what
//   makes that worth doing. So the payout is gated on the SHAPE of the season — how many games,
//   against how many DIFFERENT people, and how concentrated on any one of them — and on the
//   automation reputation this tool reads straight out of the integrity store.
//   A flagged account is HELD for review, never silently denied. The detector is not a court.
//
// NO MONEY MOVES HERE. Prizes are in-game credits, plates and badges. Nothing in this file touches
// a payment provider or the escrow contract; see docs/SECURITY-REVIEW.md.
const path = require('path');
const fs = require('fs');
const { Accounts } = require('../lib/accounts');
const { Economy, monthId, SEASON } = require('../lib/economy');

const args = process.argv.slice(2);
const has = f => args.includes(f);
const dry = has('--dry') || has('-n');
const auto = has('--auto');
const boardOnly = has('--board');
const quiet = has('--quiet');
const named = args.find(a => /^\d{4}-\d{2}$/.test(a));
const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));

function lastMonth() {
  const d = new Date();
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1);
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
}

const accounts = new Accounts(dataDir);
const econ = new Economy({ dataDir, accounts, log: (...a) => { if (!quiet) console.log(...a); } });

// The automation reputation, read from the security session's store. Optional on purpose: if that
// file is missing or a different shape, the gate still runs on the season-shape rules alone rather
// than crashing the payout.
let bot = null;
try {
  const integrity = require('../lib/integrity');
  const store = new integrity.Store(dataDir);
  bot = id => { try { const a = store.data.accounts[id]; return a ? { score: a.score || 0, matches: a.matches || 0 } : null; } catch (e) { return null; } };
  console.log(`integrity store loaded (${Object.keys((store.data && store.data.accounts) || {}).length} accounts scored)`);
} catch (e) {
  console.log('integrity store unavailable (' + String(e.message).split('\n')[0] + ') — season-shape rules only');
}

const pad = (s, n) => String(s).padEnd(n).slice(0, n);
function printRules() {
  console.log(`rules: >=${SEASON.minGames} rated games for a prize (>=${SEASON.minGamesBadge} for a badge), ` +
    `>=${SEASON.minOpponents} distinct opponents, <=${Math.round(SEASON.maxPairShare * 100)}% of games vs any one of them, ` +
    `automation score <${SEASON.maxBotScore}`);
}

// ---------------------------------------------------------------- --board
if (boardOnly) {
  const id = named || monthId();
  const rows = [];
  for (const a of accounts.acc.values()) if (!a.test && a.month && a.month.id === id && a.month.g > 0) rows.push(a);
  rows.sort((x, y) => y.month.elo - x.month.elo || y.month.w - x.month.w);
  console.log(`\nseason ${id} — live board, ${rows.length} rated players`);
  printRules();
  console.log('');
  console.log(' # ' + pad('player', 18) + pad('elo', 6) + pad('peak', 6) + pad('w-l', 9) + pad('opp', 5) + 'prize eligibility');
  rows.slice(0, 40).forEach((a, i) => {
    const el = econ.seasonEligible(a, id, bot);
    const sh = el.shape || { opponents: 0 };
    console.log(String(i + 1).padStart(2) + ' ' + pad(a.name || 'Player', 18) + pad(a.month.elo, 6) +
      pad(a.month.peak || a.month.elo, 6) + pad(a.month.w + '-' + a.month.l, 9) + pad(sh.opponents, 5) +
      (el.ok ? 'YES' : (el.hold ? 'HELD  ' : 'no    ') + el.why));
  });
  process.exit(0);
}

// ---------------------------------------------------------------- close
const seasons = auto ? econ.unpaidSeasons() : [named || lastMonth()];
if (!seasons.length) { console.log('nothing to close — no ended season is unpaid'); process.exit(0); }
console.log(`closing ${seasons.length} season(s): ${seasons.join(', ')}${dry ? '   [--dry: nothing will be written]' : ''}`);
printRules();

let anyPaid = 0;
for (const season of seasons) {
  console.log(`\n=== ${season}${season === monthId() ? '   (NOTE: this month is still running)' : ''} ===`);
  const r = econ.closeSeason(season, { bot, dry });
  if (!r.ok) { console.log('  skipped:', r.msg); continue; }
  const A = r.archive;
  console.log(`  ${A.players} rated players — ${A.paid} paid, ${A.held} held for review, ${A.skipped} not eligible`);
  if (r.paid.length) {
    console.log('\n  PAID');
    for (const p of r.paid.slice(0, 20)) console.log(`    #${String(p.rank).padStart(3)}  ${pad(p.name || 'Player', 18)} ${String(p.credits).padStart(6)} credits${p.plate ? '  + ' + p.plate : ''}`);
    if (r.paid.length > 20) console.log(`    … and ${r.paid.length - 20} more`);
  }
  if (r.held.length) {
    console.log('\n  HELD FOR REVIEW (not paid, not denied — look at these by hand)');
    for (const h of r.held.slice(0, 20)) console.log(`    board #${String(h.boardRank).padStart(3)}  ${pad(h.name || 'Player', 18)} ${h.why}`);
  }
  if (r.skipped.length) {
    console.log('\n  NOT ELIGIBLE');
    const byWhy = {};
    for (const s of r.skipped) { const k = s.why.replace(/^\d+/, 'N'); byWhy[k] = (byWhy[k] || 0) + 1; }
    for (const [k, n] of Object.entries(byWhy).sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(4)} x  ${k}`);
  }
  if (!dry) {
    const f = path.join(dataDir, 'seasons', season + '.json');
    console.log(`\n  standings archived -> ${f}${fs.existsSync(f) ? '' : '  (WRITE FAILED)'}`);
    anyPaid += r.paid.length;
  }
}

if (!dry) { econ.flush(); accounts.flush(); }
console.log(`\ndone${dry ? ' (dry run — nothing written)' : ''}. The next season starts itself: a fresh month record is stamped the first time an account is rated under a new month id.`);
