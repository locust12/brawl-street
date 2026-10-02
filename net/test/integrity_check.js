// Calibration for lib/integrity.js: synthetic players with known behaviour, then every replay
// the local server has stored. Run:  node test/integrity_check.js [replayDir]
const I = require('../lib/integrity');
const fs = require('fs');
const path = require('path');
const B = I.BIT;

const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const push = (log, mask, n) => { for (let i = 0; i < n; i++) log.push(mask); };

// A script: exact hold, exact gap, forever.
function scripted(ticks, hold = 4, gap = 10, mask = B.attack) {
  const l = []; while (l.length < ticks) { push(l, mask, hold); push(l, 0, gap); } return l.slice(0, ticks);
}
// A human: jittery hold and gap, movement mixed in, occasional bursts and pauses.
function human(ticks) {
  const l = [];
  while (l.length < ticks) {
    const r = Math.random();
    if (r < 0.35) push(l, Math.random() < 0.5 ? B.left : B.right, rnd(6, 40));
    else if (r < 0.5) push(l, B.jump | (Math.random() < 0.5 ? B.right : 0), rnd(3, 12));
    else if (r < 0.65) push(l, B.attack, rnd(2, 9));
    else if (r < 0.72) push(l, B.smash | (Math.random() < 0.5 ? B.right : B.left), rnd(3, 11));
    else if (r < 0.8) push(l, B.shield, rnd(5, 30));
    else if (r < 0.87) push(l, B.special, rnd(2, 10));
    else push(l, 0, rnd(4, 45));
  }
  return l.slice(0, ticks);
}
// A masher: one button, human timing. Should read DEGENERATE but not automated.
function masher(ticks) {
  const l = []; while (l.length < ticks) { push(l, B.attack, rnd(2, 8)); push(l, 0, rnd(2, 12)); } return l.slice(0, ticks);
}
// A reaction bot: shields 2 frames after the opponent starts an attack.
function reactionBot(oppLog) {
  const l = new Array(oppLog.length).fill(0);
  let prev = 0;
  for (let t = 0; t < oppLog.length; t++) {
    const o = oppLog[t] | 0;
    if ((o & (B.attack | B.special | B.smash)) && !(prev & (B.attack | B.special | B.smash))) for (let d = 2; d < 14 && t + d < l.length; d++) l[t + d] = B.shield;
    prev = o;
  }
  for (let t = 0; t < l.length; t++) if (!l[t] && Math.random() < 0.3) l[t] = Math.random() < 0.5 ? B.left : B.right;
  return l;
}

const T = 60 * 90; // 90 seconds
const cases = [];
const h1 = human(T), h2 = human(T);
cases.push(['human vs human', h1, [h2], 'clean']);
cases.push(['scripted attack loop', scripted(T), [h1], 'likely-automated']);
cases.push(['scripted, slower loop', scripted(T, 7, 23, B.smash | B.right), [h1], 'likely-automated']);
cases.push(['button masher (human timing)', masher(T), [h1], 'clean']);
cases.push(['reaction bot', reactionBot(h1), [h1], 'suspicious-or-worse']);
cases.push(['short match (20 s human)', human(60 * 20), [human(60 * 20)], 'clean']);
cases.push(['idle player', new Array(T).fill(0), [h1], 'any']);

console.log('=== synthetic calibration ===');
let bad = 0;
for (const [name, log, others, want] of cases) {
  const r = I.analysePlayer(log, others);
  const d = I.analyseDegenerate(log);
  const okWant = want === 'any' ? true
    : want === 'clean' ? r.score < 35
      : want === 'likely-automated' ? r.verdict === 'likely-automated'
        : r.score >= 35;
  if (!okWant) bad++;
  console.log(`\n${okWant ? 'OK  ' : 'MISS'} ${name}`);
  console.log(`     score ${r.score} verdict=${r.verdict} (wanted ${want})  apm=${r.detail.apm} entropy=${r.detail.entropy} distinct=${r.detail.distinctMasks}`);
  console.log(`     reaction: ${r.detail.reaction.samples} samples, median ${r.detail.reaction.medianMs}ms, cv ${r.detail.reaction.cv}`);
  if (r.flags.length) console.log('     bot flags:  ' + r.flags.join(' | '));
  if (d.flags.length) console.log('     degenerate: ' + d.flags.join(' | '));
}
console.log(`\n${bad ? bad + ' MISSES' : 'all synthetic cases classified as expected'}`);

// ---- FALSE POSITIVE RATE ------------------------------------------------------
// The number that decides whether any of this may touch a payout. Freezing an honest player's
// money is worse than missing a bot, so the cost of being wrong has to be measured rather than
// asserted -- and measured on the players most likely to be wrongly accused, not on an easy case.
//
// READ THIS BEFORE QUOTING THE NUMBER. These are SYNTHETIC humans. They are generated from my
// model of how a person presses buttons, so what follows measures the detector against that model,
// not against real people. It is a lower bound on the false-positive rate and it cannot be anything
// else until there are real human replays to run it on -- of which the server currently has none
// (every stored replay is a test bot). Treat it as "the detector is not obviously trigger-happy",
// not as "3 in 1000 honest players will be flagged".
function withTurbo(ticks) {
  // A turbo/macro controller: genuinely frame-perfect presses, sold for fighting games, legal.
  const l = [], hold = 3, gap = 5;
  while (l.length < ticks) {
    if (Math.random() < 0.45) { push(l, B.attack, hold); push(l, 0, gap); }      // the turbo section
    else { const h = human(rnd(60, 240)); for (const m of h) l.push(m); }
  }
  return l.slice(0, ticks);
}
function withTouch(ticks) {
  // Mobile touch controls: a thumb sliding across the stick registers left+right together.
  const l = human(ticks);
  for (let t = 0; t < l.length; t++) if (Math.random() < 0.03) l[t] |= (B.left | B.right);
  return l;
}
function laggy(ticks) {
  // A bad connection: long flat stretches where nothing was sent, then a burst.
  const l = [];
  while (l.length < ticks) {
    if (Math.random() < 0.25) push(l, 0, rnd(30, 120));
    else { const h = human(rnd(60, 300)); for (const m of h) l.push(m); }
  }
  return l.slice(0, ticks);
}
function pro(ticks, oppLog) {
  // A strong player: reads the matchup and reacts fast on SOME exchanges, 120-180 ms, not all.
  const l = human(ticks);
  let prev = 0;
  for (let t = 1; t < Math.min(ticks, oppLog.length); t++) {
    const o = oppLog[t] | 0;
    const started = (o & (B.attack | B.special | B.smash)) && !(prev & (B.attack | B.special | B.smash));
    prev = o;
    if (started && Math.random() < 0.55) {
      const d = rnd(7, 12);                                   // 117-200 ms, genuinely human
      for (let k = 0; k < 8 && t + d + k < ticks; k++) l[t + d + k] = B.shield;
    }
  }
  return l;
}

console.log('\n=== false positive rate on synthetic honest players ===');
const N = +process.env.FP_N || 200;
const kinds = {
  'ordinary human       ': () => { const o = human(T); return [human(T), [o]]; },
  'button masher        ': () => { const o = human(T); return [masher(T), [o]]; },
  'turbo/macro pad      ': () => { const o = human(T); return [withTurbo(T), [o]]; },
  // The genuine worst case for this detector, and the one it is honest to report: a legal turbo
  // controller held down for the WHOLE match. Frame-perfect press length and a metronomic gap are
  // precisely what the strongest signal looks for, and a turbo pad produces both by design. There
  // is no input-stream signal that separates this from a script, because at the level of the input
  // stream it IS a script -- one with a human holding the button. If this scores at or above the
  // hold threshold, that is a real cost to a real player and it has to be written down.
  'turbo pad, held all m': () => { const o = human(T); return [scripted(T, 3, 5), [o]]; },
  'mobile touch controls': () => { const o = human(T); return [withTouch(T), [o]]; },
  'laggy connection     ': () => { const o = human(T); return [laggy(T), [o]]; },
  'strong player        ': () => { const o = human(T); return [pro(T, o), [o]]; },
};
const WATCH = 18, FLAG = 35, HOLD = 60;
let worstHold = 0;
console.log(`  ${N} samples per kind, ${T / 60}s each. Thresholds: watch ${WATCH}, shadow-flag ${FLAG}, PAYOUT HOLD ${HOLD}.`);
console.log('  kind                    median   p95   max   >=flag   >=HOLD');
for (const [name, gen] of Object.entries(kinds)) {
  const scores = [];
  for (let i = 0; i < N; i++) { const [log, others] = gen(); scores.push(I.analysePlayer(log, others).score); }
  scores.sort((a, b) => a - b);
  const med = scores[Math.floor(N / 2)], p95 = scores[Math.floor(N * 0.95)], max = scores[N - 1];
  const flagged = scores.filter(s => s >= FLAG).length, held = scores.filter(s => s >= HOLD).length;
  worstHold = Math.max(worstHold, held / N);
  console.log(`  ${name}   ${String(med).padStart(4)}  ${String(p95).padStart(4)}  ${String(max).padStart(4)}   `
    + `${(100 * flagged / N).toFixed(1).padStart(5)}%   ${(100 * held / N).toFixed(1).padStart(5)}%`);
}
console.log(`\n  Worst payout-hold rate across all honest kinds: ${(100 * worstHold).toFixed(2)}%`);
console.log('  A hold does not take anybody\'s money: the stakes stay in escrow and a human looks at');
console.log('  the replay. But it does make a winner wait, so this number is the cost of the system');
console.log('  being wrong, and it belongs in the report whether it is flattering or not.');

// ---- WHOSE score holds a payout ----------------------------------------------
// The first version of analyseMatch held on the highest score in the match, so an honest player who
// BEAT a bot had their payout frozen because of what their opponent did. The victim paid for the
// cheating and the cheat lost nothing. These cases pin the corrected behaviour down.
console.log('\n=== who gets held ===');
{
  const h = human(T), bot = scripted(T, 4, 10);
  const mk = (logs, payee, metas) => I.analyseMatch(
    { id: 'x', cfg: { players: logs.map(() => ({})) }, log: logs, events: [], result: { reason: 'ko', winner: payee, payee, placements: [payee, 1 - payee], ticks: T } },
    metas, null);

  const cases = [
    ['honest player BEATS a bot        ', [h, bot], 0, [{ human: true, acct: 'a', th: 't1' }, { human: true, acct: 'b', th: 't2' }], false],
    ['bot BEATS an honest player       ', [bot, h], 0, [{ human: true, acct: 'a', th: 't1' }, { human: true, acct: 'b', th: 't2' }], true],
    ['two honest players              ', [h, human(T)], 0, [{ human: true, acct: 'a', th: 't1' }, { human: true, acct: 'b', th: 't2' }], false],
    ['both seats on one device token  ', [h, human(T)], 0, [{ human: true, acct: 'a', th: 'SAME' }, { human: true, acct: 'b', th: 'SAME' }], true],
  ];
  let bad2 = 0;
  for (const [name, logs, payee, metas, want] of cases) {
    const r = mk(logs, payee, metas);
    const ok = r.hold === want;
    if (!ok) bad2++;
    console.log(`  ${ok ? 'OK  ' : 'MISS'} ${name} -> hold=${r.hold} (wanted ${want})${r.holdReason ? '  [' + r.holdReason + ']' : ''}`);
  }
  console.log(bad2 ? `  ${bad2} MISSES` : '  a payout is held for what the WINNER did, not for what the loser did');
}

// ---- real replays -------------------------------------------------------------
const dir = process.argv[2] || path.join(process.env.DATA_DIR || '', 'replays');
console.log('\n=== stored replays in ' + dir + ' ===');
let files = [];
try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json')); } catch (e) { console.log('(none)'); }
for (const f of files.slice(-12)) {
  let rec; try { rec = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { continue; }
  const metas = (rec.cfg.players || []).map((p, i) => ({ human: !p.cpu, acct: 'replay' + i }));
  const a = I.analyseMatch(rec, metas, null);
  const secs = ((rec.result.ticks || 0) / 60).toFixed(0);
  console.log(`\n${f}  ${secs}s  reason=${rec.result.reason} winner=${rec.result.winner} payee=${rec.result.payee}`);
  for (const s of a.slots) {
    if (s.cpu) { console.log(`   slot ${s.slot}: CPU`); continue; }
    console.log(`   slot ${s.slot}: score ${s.score} ${s.verdict}${s.confident ? '' : ' (low confidence)'} apm=${s.detail.apm} ent=${s.detail.entropy} top=${(s.detail.topMasks || []).slice(0, 2).map(x => x.keys + ' ' + x.pct + '%').join(', ')}`);
    if (s.flags.length) console.log(`      bot: ${s.flags.join(' | ')}`);
    if (s.degenerate.length) console.log(`      deg: ${s.degenerate.join(' | ')}`);
  }
  if (a.flags.length) console.log('   match flags: ' + a.flags.join(' | '));
  console.log('   HOLD PAYOUT: ' + a.hold);
}
