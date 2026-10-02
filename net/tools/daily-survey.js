#!/usr/bin/env node
'use strict';
// Daily fight survey. Walks the stored replays and writes a dated markdown report:
// who got flagged, which wins look wrong, which fighters/stages/items are outliers, how often
// matches crash, desync or get abandoned.
//
//   node tools/daily-survey.js                       # today, from $DATA_DIR/replays
//   node tools/daily-survey.js --date 2026-09-19
//   node tools/daily-survey.js --days 7 --out ../dev/reports
//   node tools/daily-survey.js --replays /srv/data/replays --all
//
// On lw this wants to run once a day, after midnight UTC:
//   docker exec brawlstreet node tools/daily-survey.js --date "$(date -u -d yesterday +%F)"
const fs = require('fs');
const path = require('path');
const integrity = require('../lib/integrity');

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const has = k => args.includes('--' + k);

const REPLAYS = arg('replays', path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'replays'));
const OUT = arg('out', path.join(__dirname, '..', '..', 'dev', 'reports'));
const DAYS = +arg('days', 1);
const DATE = arg('date', new Date().toISOString().slice(0, 10));
const ALL = has('all');

const pct = (a, b) => (b ? (100 * a / b).toFixed(1) + '%' : '-');
const bar = (v, max, w = 18) => '#'.repeat(Math.max(0, Math.round(w * v / (max || 1)))).padEnd(w, '.');

// Wilson lower bound: stops a 2-from-2 fighter topping the win-rate table.
function wilson(wins, n, z = 1.96) {
  if (!n) return 0;
  const p = wins / n, d = 1 + z * z / n;
  return ((p + z * z / (2 * n) - z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n)) / d);
}

function load() {
  let files = [];
  try { files = fs.readdirSync(REPLAYS).filter(f => /^m[0-9a-z]+\.json$/.test(f)); }
  catch (e) { console.error('cannot read replay dir ' + REPLAYS + ': ' + e.message); process.exit(1); }
  const from = new Date(DATE + 'T00:00:00Z').getTime();
  const to = from + DAYS * 864e5;
  const out = [];
  for (const f of files) {
    let r; try { r = JSON.parse(fs.readFileSync(path.join(REPLAYS, f), 'utf8')); } catch (e) { continue; }
    if (!r || !r.result || !r.cfg) continue;
    const t = Date.parse(r.created || '') || 0;
    if (!ALL && !(t >= from && t < to)) continue;
    out.push(r);
  }
  return out.sort((a, b) => Date.parse(a.created) - Date.parse(b.created));
}

function survey(recs) {
  const S = {
    matches: recs.length, real: 0, ranked: 0, ticks: 0,
    reasons: {}, desync: 0, crashed: 0, timedOut: 0, dropped: 0, stalled: 0, forfeits: 0,
    chars: {}, stages: {}, items: { on: 0, off: 0 }, stocks: {},
    flagged: [], held: [], degenerate: [], pairs: {}, players: {}, drops: [],
    shortest: null, longest: null,
  };
  const charRow = c => S.chars[c] || (S.chars[c] = { picks: 0, wins: 0, losses: 0, ko: 0, dmgDealt: 0, seen: 0 });
  const stageRow = s => S.stages[s] || (S.stages[s] = { played: 0, ticks: 0, timeUps: 0 });

  for (const r of recs) {
    const res = r.result, cfg = r.cfg;
    S.ticks += res.ticks || 0;
    S.reasons[res.reason] = (S.reasons[res.reason] || 0) + 1;
    if (r.real) S.real++;
    if (res.reason === 'forfeit') S.forfeits++;
    if (res.reason === 'cancelled') S.crashed++;
    if (r.timedOut) S.timedOut++;
    if (r.dropped && r.dropped.length) S.dropped += r.dropped.length;
    // WHERE in a match people leave. The replay does not record a drop timestamp, but it does
    // record every input frame: a seat's input log simply stops when they went, so the length of
    // their log IS the moment they left. Expressed against the longest log in the match, because
    // in lockstep every seat is blocked when one stalls and the match clock is not wall clock.
    for (const slot of (r.dropped || [])) {
      const logs = r.log || [];
      const mine = (logs[slot] || []).length;
      const longest = Math.max(1, ...logs.map(l => (l || []).length));
      S.drops.push({ id: r.id, slot, atSecs: +(mine / 60).toFixed(1), frac: mine / longest,
        stalled: (r.stalled || []).includes(slot), real: !!r.real });
    }
    if (r.stalled && r.stalled.length) S.stalled += r.stalled.length;
    if (cfg.items) S.items.on++; else S.items.off++;
    S.stocks[cfg.stocks] = (S.stocks[cfg.stocks] || 0) + 1;

    const st = stageRow(cfg.stage);
    st.played++; st.ticks += res.ticks || 0;
    if (res.reason === 'time') st.timeUps++;

    const humans = (cfg.players || []).map((p, i) => ({ i, char: p.char, cpu: !!p.cpu })).filter(p => !p.cpu);
    for (const p of humans) {
      const row = charRow(p.char);
      row.picks++;
      if (p.i === res.payee) row.wins++; else if (res.payee >= 0) row.losses++;
    }

    // integrity: use what the server stored; recompute for replays written before that existed
    let ia = r.integrity;
    if (!ia) {
      try { ia = integrity.analyseMatch(r, (cfg.players || []).map((p, i) => ({ human: !p.cpu, acct: 'anon' + i })), null); }
      catch (e) { ia = null; }
    }
    if (ia) {
      if (ia.hold) S.held.push({ id: r.id, score: ia.maxScore, flags: ia.flags, real: !!r.real });
      for (const s of ia.slots || []) {
        if (s.cpu) continue;
        const key = s.acct || ('slot' + s.slot + '@' + r.id);
        const pl = S.players[key] || (S.players[key] = { matches: 0, wins: 0, scoreSum: 0, worst: 0, flags: {}, name: (r.names || [])[s.slot] || '?' });
        pl.matches++; pl.scoreSum += s.score || 0; pl.worst = Math.max(pl.worst, s.score || 0);
        if (s.slot === res.payee) pl.wins++;
        for (const f of s.flags || []) pl.flags[f] = (pl.flags[f] || 0) + 1;
        if ((s.score || 0) >= 35) S.flagged.push({ id: r.id, slot: s.slot, name: (r.names || [])[s.slot] || '?', score: s.score, verdict: s.verdict, flags: s.flags, won: s.slot === res.payee, real: !!r.real });
        if ((s.degenerate || []).length && s.slot === res.payee) S.degenerate.push({ id: r.id, slot: s.slot, name: (r.names || [])[s.slot] || '?', flags: s.degenerate, real: !!r.real });
      }
      if (ia.flags && ia.flags.length) for (const f of ia.flags) if (/share one|played each other/.test(f)) S.pairs[f] = (S.pairs[f] || 0) + 1;
    }
    if ((r.names || []).length && res.ticks) {
      if (!S.shortest || res.ticks < S.shortest.ticks) S.shortest = { id: r.id, ticks: res.ticks };
      if (!S.longest || res.ticks > S.longest.ticks) S.longest = { id: r.id, ticks: res.ticks };
    }
    if (Array.isArray(r.desyncSlots) && r.desyncSlots.length) S.desync++;
  }
  return S;
}

function report(S, recs) {
  const L = [];
  const range = ALL ? 'all stored replays' : DAYS > 1 ? `${DATE} + ${DAYS} days` : DATE;
  L.push(`# Brawl Street — daily fight survey`, ``, `**Range:** ${range}  `, `**Replays read:** ${S.matches}  `, `**Generated:** ${new Date().toISOString()}  `, `**Source:** \`${REPLAYS}\``, ``);
  if (!S.matches) { L.push('No matches in this range.', ''); return L.join('\n'); }

  const mins = (S.ticks / 60 / 60).toFixed(1);
  L.push(`## At a glance`, ``,
    `| | |`, `|---|---|`,
    `| Matches | ${S.matches} |`,
    `| Real-ETH matches | ${S.real} |`,
    `| Fight time played | ${mins} minutes |`,
    `| Median match length | ${(median(recs.map(r => r.result.ticks || 0)) / 60).toFixed(0)}s |`,
    `| Ended by KO | ${S.reasons.ko || 0} (${pct(S.reasons.ko || 0, S.matches)}) |`,
    `| Ended on the clock | ${S.reasons.time || 0} (${pct(S.reasons.time || 0, S.matches)}) |`,
    `| Ended by forfeit | ${S.forfeits} (${pct(S.forfeits, S.matches)}) |`,
    `| Cancelled / crashed | ${S.crashed} (${pct(S.crashed, S.matches)}) |`,
    `| Hit the wall-clock cap | ${S.timedOut} |`,
    `| Seats dropped mid-match | ${S.dropped} |`,
    `| Seats forfeited for stalling | ${S.stalled} |`,
    ``);

  // ---- integrity
  L.push(`## Integrity`, ``);
  if (S.held.length) {
    L.push(`### ⚠ Payouts held (${S.held.length})`, ``, `These matches were NOT settled automatically. Review the replay, then report or cancel by hand.`, ``,
      `| match | score | real | why |`, `|---|---|---|---|`);
    for (const h of S.held) L.push(`| \`${h.id}\` | ${h.score} | ${h.real ? 'YES' : 'no'} | ${(h.flags || []).join('; ') || 'automation score'} |`);
    L.push('');
  } else L.push(`No payouts were held.`, ``);

  if (S.flagged.length) {
    L.push(`### Flagged players (${S.flagged.length} seat-matches at score 35+)`, ``,
      `| match | player | score | verdict | won | signals |`, `|---|---|---|---|---|---|`);
    for (const f of S.flagged.slice(0, 40)) L.push(`| \`${f.id}\` | ${esc(f.name)} | ${f.score} | ${f.verdict} | ${f.won ? '**yes**' : 'no'} | ${(f.flags || []).join('; ')} |`);
    L.push('');
  } else L.push(`### Flagged players`, ``, `None above the 35 threshold.`, ``);

  // repeat offenders across the range
  const repeat = Object.entries(S.players).filter(([, p]) => p.matches >= 3 && p.scoreSum / p.matches >= 30)
    .sort((a, b) => b[1].scoreSum / b[1].matches - a[1].scoreSum / a[1].matches);
  if (repeat.length) {
    L.push(`### Repeat offenders`, ``, `Averaged 30+ automation score over 3 or more matches in this range.`, ``,
      `| player | matches | wins | mean score | worst | most common signal |`, `|---|---|---|---|---|---|`);
    for (const [k, p] of repeat.slice(0, 25)) {
      const top = Object.entries(p.flags).sort((a, b) => b[1] - a[1])[0];
      L.push(`| ${esc(p.name)} (\`${k.slice(0, 12)}\`) | ${p.matches} | ${p.wins} | ${Math.round(p.scoreSum / p.matches)} | ${p.worst} | ${top ? esc(top[0]) + ' ×' + top[1] : '-'} |`);
    }
    L.push('');
  }

  if (S.degenerate.length) {
    L.push(`### Wins on a degenerate line (${S.degenerate.length})`, ``,
      `Matches the WINNER took while spamming one input, or without moving. This is the balance list, not the cheat list.`, ``,
      `| match | winner | what |`, `|---|---|---|`);
    for (const d of S.degenerate.slice(0, 30)) L.push(`| \`${d.id}\` | ${esc(d.name)} | ${d.flags.join('; ')} |`);
    L.push('');
  }

  const pairFlags = Object.entries(S.pairs).sort((a, b) => b[1] - a[1]);
  if (pairFlags.length) {
    L.push(`### Possible self-matching`, ``, `| signal | times |`, `|---|---|`);
    for (const [f, n] of pairFlags) L.push(`| ${esc(f)} | ${n} |`);
    L.push('');
  }

  // ---- balance
  L.push(`## Balance`, ``);
  const chars = Object.entries(S.chars).filter(([, c]) => c.picks > 0).sort((a, b) => b[1].picks - a[1].picks);
  const maxPick = chars.length ? chars[0][1].picks : 1;
  const totalPicks = chars.reduce((a, [, c]) => a + c.picks, 0);
  L.push(`### Fighters — pick rate`, ``, `${chars.length} fighters seen across ${totalPicks} seats.`, ``, '```');
  for (const [c, v] of chars.slice(0, 25)) L.push(`${c.padEnd(11)} ${bar(v.picks, maxPick)} ${String(v.picks).padStart(4)}  ${pct(v.picks, totalPicks)}`);
  L.push('```', '');

  const rated = chars.map(([c, v]) => ({ c, ...v, n: v.wins + v.losses, wr: v.wins / Math.max(1, v.wins + v.losses), lb: wilson(v.wins, v.wins + v.losses) }))
    .filter(x => x.n >= 5).sort((a, b) => b.lb - a.lb);
  if (rated.length) {
    L.push(`### Fighters — win rate (5+ decided matches, ranked by Wilson lower bound so small samples do not top the list)`, ``,
      `| fighter | picks | W-L | win rate | 95% lower bound |`, `|---|---|---|---|---|`);
    for (const x of rated) L.push(`| ${x.c} | ${x.picks} | ${x.wins}-${x.losses} | ${(100 * x.wr).toFixed(1)}% | ${(100 * x.lb).toFixed(1)}% |`);
    L.push('');
    const hi = rated.filter(x => x.lb > 0.60), lo = rated.filter(x => x.n >= 8 && x.wr < 0.35);
    if (hi.length || lo.length) {
      L.push(`**Outliers to look at:**`, ``);
      for (const x of hi) L.push(`- \`${x.c}\` wins ${(100 * x.wr).toFixed(0)}% over ${x.n} matches — above the band even allowing for sample size.`);
      for (const x of lo) L.push(`- \`${x.c}\` wins only ${(100 * x.wr).toFixed(0)}% over ${x.n} matches — candidate for a buff.`);
      L.push('');
    }
  } else L.push(`### Fighters — win rate`, ``, `Not enough decided matches yet (need 5 per fighter).`, ``);

  const stages = Object.entries(S.stages).sort((a, b) => b[1].played - a[1].played);
  if (stages.length) {
    L.push(`### Stages`, ``, `| stage | played | share | mean length | time-ups |`, `|---|---|---|---|---|`);
    const tot = stages.reduce((a, [, v]) => a + v.played, 0);
    for (const [s, v] of stages) L.push(`| ${s} | ${v.played} | ${pct(v.played, tot)} | ${(v.ticks / v.played / 60).toFixed(0)}s | ${v.timeUps} (${pct(v.timeUps, v.played)}) |`);
    L.push('');
  }
  L.push(`### Rules in play`, ``, `| setting | count |`, `|---|---|`,
    `| Items on | ${S.items.on} |`, `| Items off | ${S.items.off} |`,
    ...Object.entries(S.stocks).sort().map(([k, v]) => `| ${k} stocks | ${v} |`), ``);

  // ---- health
  L.push(`## Health`, ``, `| | count | rate |`, `|---|---|---|`,
    `| Cancelled (engine error or everyone gone) | ${S.crashed} | ${pct(S.crashed, S.matches)} |`,
    `| Desync flagged | ${S.desync} | ${pct(S.desync, S.matches)} |`,
    `| Seats dropped | ${S.dropped} | ${pct(S.dropped, S.matches)} |`,
    `| Forfeits | ${S.forfeits} | ${pct(S.forfeits, S.matches)} |`,
    `| Wall-clock timeouts | ${S.timedOut} | ${pct(S.timedOut, S.matches)} |`, ``);
  if (S.forfeits / S.matches > 0.3) L.push(`> A forfeit rate of ${pct(S.forfeits, S.matches)} is high. Either players are rage-quitting, or something is dropping connections.`, ``);

  // ---- drop-off: WHERE in a match people go, which is the difference between "the netcode drops
  // people" and "players quit when they are losing". They need opposite responses, and the counts
  // above cannot tell them apart.
  if (S.drops.length) {
    const buckets = [
      ['first quarter  ', d => d.frac < 0.25],
      ['second quarter ', d => d.frac >= 0.25 && d.frac < 0.5],
      ['third quarter  ', d => d.frac >= 0.5 && d.frac < 0.75],
      ['final quarter  ', d => d.frac >= 0.75],
    ];
    L.push(`### Drop-off points`, ``, `Where a seat's input stream stopped, as a share of the longest stream in that match.`, ``,
      `| when they left | seats | share |`, `|---|---|---|`);
    for (const [name, f] of buckets) {
      const n = S.drops.filter(f).length;
      L.push(`| ${name.trim()} | ${n} | ${pct(n, S.drops.length)} |`);
    }
    const stalls = S.drops.filter(d => d.stalled).length;
    const secs = S.drops.map(d => d.atSecs).sort((a, b) => a - b);
    L.push('', `Median drop at **${secs[Math.floor(secs.length / 2)]}s** of fight time. `
      + `${stalls} of ${S.drops.length} were forfeited for holding the match up rather than disconnecting.`, '');
    const early = S.drops.filter(d => d.frac < 0.25).length;
    if (early / S.drops.length > 0.5) {
      L.push(`> Over half of all drops are in the first quarter of the match. That pattern is a connection or`,
        `> matchmaking problem, not rage-quitting — people who are losing leave late, not early.`, ``);
    }
    const real = S.drops.filter(d => d.real).length;
    if (real) L.push(`> ${real} of these were REAL-ETH matches. A drop there is a forfeited stake, so each one is worth reading individually.`, ``);
  }
  if (S.crashed / S.matches > 0.02) L.push(`> ${pct(S.crashed, S.matches)} of matches cancelled. Check \`docker logs brawlstreet\` for engine errors.`, ``);

  L.push(`## Reasons`, ``, `| reason | count |`, `|---|---|`);
  for (const [k, v] of Object.entries(S.reasons).sort((a, b) => b[1] - a[1])) L.push(`| ${k} | ${v} |`);
  L.push('');
  L.push(`---`, ``, `Generated by \`net/tools/daily-survey.js\`. Every number here comes from the stored replay files,`,
    `which are the same bytes the winner was decided from — re-run any match with \`lib/engine.replay()\`.`, ``);
  return L.join('\n');
}
const esc = s => String(s).replace(/\|/g, '\\|');
function median(xs) { if (!xs.length) return 0; const s = xs.slice().sort((a, b) => a - b); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; }

const recs = load();
const S = survey(recs);
const md = report(S, recs);
fs.mkdirSync(OUT, { recursive: true });
const file = path.join(OUT, (ALL ? 'all-time' : DATE) + '.md');
fs.writeFileSync(file, md);
console.log(`${S.matches} matches -> ${file}`);
if (S.held.length) console.log(`  ${S.held.length} payout(s) HELD for review`);
if (S.flagged.length) console.log(`  ${S.flagged.length} flagged seat-match(es)`);
