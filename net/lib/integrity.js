'use strict';
// Match integrity: bot/script detection, degenerate-strategy detection and self-match detection.
//
// The server already replays every match, so it holds the exact input of every player for every
// 1/60 s tick. That input stream is all this module needs -- no client-side anti-cheat, nothing a
// player can tamper with, and it works on finished matches as well as live ones.
//
// The output is a SCORE and a list of FLAGS, never a ban. Scores feed three things:
//   - a shadow flag on the account (invisible to the player),
//   - a payout HOLD on wagered matches, so a human looks before money moves,
//   - the daily survey (tools/daily-survey.js).
//
// Read the false-positive notes at the bottom before wiring any of this to an automatic penalty.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Bit layout of an input mask, from ACTIONS in src/10_core.js.
const ACTIONS = ['left', 'right', 'up', 'down', 'jump', 'attack', 'special', 'shield', 'smash', 'grab', 'grapple', 'drop'];
const BIT = {}; ACTIONS.forEach((a, i) => { BIT[a] = 1 << i; });
const MASK_MAX = (1 << ACTIONS.length) - 1;           // 4095
const OFFENCE = BIT.attack | BIT.special | BIT.smash | BIT.grab | BIT.grapple;
const DEFENCE = BIT.shield | BIT.jump | BIT.up | BIT.down;
const MOVE = BIT.left | BIT.right | BIT.up | BIT.down;

const TICK_MS = 1000 / 60;
const bits = m => { const o = []; for (let i = 0; i < ACTIONS.length; i++) if (m & (1 << i)) o.push(ACTIONS[i]); return o; };

// mean / standard deviation / coefficient of variation of a sample
function stats(xs) {
  const n = xs.length;
  if (!n) return { n: 0, mean: 0, sd: 0, cv: 1, med: 0 };
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n);
  const s = xs.slice().sort((a, b) => a - b);
  const med = n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  return { n, mean, sd, cv: mean ? sd / mean : 1, med };
}
// Shannon entropy of the mask stream, in bits per tick
function entropy(xs) {
  const c = new Map(); for (const x of xs) c.set(x, (c.get(x) || 0) + 1);
  let h = 0; for (const v of c.values()) { const p = v / xs.length; h -= p * Math.log2(p); }
  return { h, distinct: c.size, top: [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4) };
}
// runs of consecutive ticks where `pred` holds -> their lengths
function runsOf(log, pred) {
  const out = []; let run = 0;
  for (let t = 0; t < log.length; t++) {
    if (pred(log[t] | 0)) run++;
    else { if (run) out.push(run); run = 0; }
  }
  if (run) out.push(run);
  return out;
}
// gaps between the starts of consecutive runs
function gapsOf(log, pred) {
  const starts = []; let was = false;
  for (let t = 0; t < log.length; t++) { const is = pred(log[t] | 0); if (is && !was) starts.push(t); was = is; }
  const out = []; for (let i = 1; i < starts.length; i++) out.push(starts[i] - starts[i - 1]);
  return out;
}

// ------------------------------------------------------------------ per-player analysis
// Everything here is computed from one player's mask stream plus, for reaction timing, the
// opponents' streams. Each signal returns {score, flag} and the scores add up.
function analysePlayer(log, others, opts = {}) {
  const L = (log || []).map(x => x | 0);
  const flags = [], detail = {};
  let score = 0;
  const ticks = L.length;
  detail.ticks = ticks;
  detail.seconds = +(ticks / 60).toFixed(1);

  // Too short to judge. Say so rather than guessing.
  const MIN = opts.minTicks || 900;   // 15 s of fight
  if (ticks < MIN) return { score: 0, flags: [], detail: Object.assign(detail, { apm: 0, entropy: 0, distinctMasks: 0, topMasks: [], reaction: { samples: 0, medianFrames: 0, medianMs: 0, cv: 0 } }), verdict: 'too-short', confident: false };

  const active = L.filter(m => m !== 0).length;
  detail.activeFrac = +(active / ticks).toFixed(3);
  const ent = entropy(L);
  detail.entropy = +ent.h.toFixed(2);
  detail.distinctMasks = ent.distinct;
  detail.topMasks = ent.top.map(([m, n]) => ({ mask: m, keys: bits(m).join('+') || 'idle', pct: +(100 * n / ticks).toFixed(1) }));

  // --- 1. press-duration regularity ------------------------------------------------
  // A human holds a button for a jittery number of frames. A script holds it for exactly N.
  // Low coefficient of variation over many presses is the single strongest tell.
  const perAction = {};
  for (const a of ACTIONS) {
    const d = runsOf(L, m => (m & BIT[a]) !== 0);
    const g = gapsOf(L, m => (m & BIT[a]) !== 0);
    if (d.length >= 12) perAction[a] = { presses: d.length, dur: stats(d), gap: stats(g) };
  }
  detail.actions = {};
  let rigidActions = 0, rigidGaps = 0;
  for (const [a, v] of Object.entries(perAction)) {
    detail.actions[a] = { presses: v.presses, durMean: +v.dur.mean.toFixed(2), durCV: +v.dur.cv.toFixed(3), gapMean: +v.gap.mean.toFixed(2), gapCV: +v.gap.cv.toFixed(3) };
    // CV below 0.08 over 12+ presses is barely reachable on a keyboard at 60 Hz.
    if (v.dur.n >= 12 && v.dur.cv < 0.08) rigidActions++;
    if (v.gap.n >= 12 && v.gap.cv < 0.08) rigidGaps++;
  }
  if (rigidActions) { score += Math.min(35, 18 * rigidActions); flags.push(`frame-perfect press length on ${rigidActions} action(s)`); }
  if (rigidGaps) { score += Math.min(30, 15 * rigidGaps); flags.push(`metronomic gap between presses on ${rigidGaps} action(s)`); }
  // Both at once is the signature of a loop: a hand that is regular in one is loose in the other.
  if (rigidActions && rigidGaps) { score += 15; flags.push('press length AND gap are both machine-regular (input loop)'); }
  detail.rigidActions = rigidActions; detail.rigidGaps = rigidGaps;

  // --- 2. reaction latency to the opponent --------------------------------------
  // How many frames after an opponent commits to an attack does this player first react?
  // Human reaction is ~12-18 frames (200-300 ms) with a wide spread. A script that reads game
  // state reacts in 1-5 frames, every time.
  const react = [];
  if (others && others.length) {
    const opp = others[0].map(x => x | 0);
    let prevOpp = 0;
    for (let t = 1; t < Math.min(ticks, opp.length); t++) {
      const o = opp[t] | 0;
      const started = (o & OFFENCE) && !(prevOpp & OFFENCE);   // opponent just began an attack
      prevOpp = o;
      if (!started) continue;
      for (let d = 0; d <= 40 && t + d < ticks; d++) {
        const before = L[t + d - 1] | 0, now = L[t + d] | 0;
        if ((now & DEFENCE) && !(before & DEFENCE)) { react.push(d); break; }
      }
    }
  }
  const rs = stats(react);
  detail.reaction = { samples: rs.n, medianFrames: +rs.med.toFixed(1), medianMs: +(rs.med * TICK_MS).toFixed(0), cv: +rs.cv.toFixed(3) };
  if (rs.n >= 20 && rs.med <= 5) { score += 30; flags.push(`reacts to attacks in ${(rs.med * TICK_MS).toFixed(0)} ms median over ${rs.n} samples (human floor is ~150 ms)`); }
  else if (rs.n >= 20 && rs.med <= 8 && rs.cv < 0.3) { score += 18; flags.push(`fast and unusually consistent reactions (${(rs.med * TICK_MS).toFixed(0)} ms, CV ${rs.cv.toFixed(2)})`); }

  // --- 3. impossible input combinations -----------------------------------------
  let opposed = 0, manyKeys = 0;
  for (const m of L) {
    if ((m & BIT.left) && (m & BIT.right)) opposed++;
    if ((m & BIT.up) && (m & BIT.down)) opposed++;
    let c = 0; for (let i = 0; i < ACTIONS.length; i++) if (m & (1 << i)) c++;
    if (c >= 6) manyKeys++;
  }
  detail.opposedTicks = opposed; detail.sixPlusKeyTicks = manyKeys;
  if (opposed > ticks * 0.02) { score += 15; flags.push(`held opposite directions on ${(100 * opposed / ticks).toFixed(1)}% of ticks`); }
  if (manyKeys > ticks * 0.01) { score += 20; flags.push(`6 or more buttons at once on ${(100 * manyKeys / ticks).toFixed(1)}% of ticks`); }

  // --- 4. input entropy ----------------------------------------------------------
  // A real fight wanders through a lot of masks. A script lives in a handful.
  if (ent.distinct <= 4 && ticks > 1800) { score += 22; flags.push(`only ${ent.distinct} distinct inputs in ${(ticks / 60).toFixed(0)}s`); }
  else if (ent.h < 1.0 && ticks > 1800) { score += 12; flags.push(`very low input entropy (${ent.h.toFixed(2)} bits/tick)`); }

  // --- 5. superhuman action rate --------------------------------------------------
  let edges = 0; for (let t = 1; t < ticks; t++) { const ch = (L[t] ^ L[t - 1]) & MASK_MAX; if (ch) edges++; }
  const apm = edges / (ticks / 3600);
  detail.apm = Math.round(apm);
  if (apm > 900) { score += 25; flags.push(`${Math.round(apm)} input changes per minute sustained`); }
  else if (apm > 600) { score += 10; flags.push(`${Math.round(apm)} input changes per minute`); }

  const verdict = score >= 60 ? 'likely-automated' : score >= 35 ? 'suspicious' : score >= 18 ? 'watch' : 'clean';
  return { score, flags, detail, verdict, confident: ticks >= MIN * 2 };
}

// ------------------------------------------------------------------ degenerate strategy
// "spam the same attack 100 times and win". This is about the match, not about cheating: it is
// reported so the balance pass can see it and so a wagered win on it can be reviewed.
function analyseDegenerate(log, opts = {}) {
  const L = (log || []).map(x => x | 0);
  if (L.length < 600) return { flags: [], detail: { ticks: L.length } };
  const flags = [], detail = {};
  const ent = entropy(L.filter(m => m !== 0));
  const nonIdle = L.filter(m => m !== 0).length || 1;

  // the single most-used non-idle input, as a share of all non-idle ticks
  const topShare = ent.top.length ? ent.top[0][1] / nonIdle : 0;
  detail.topInput = ent.top.length ? bits(ent.top[0][0]).join('+') : 'none';
  detail.topInputShare = +(100 * topShare).toFixed(1);
  if (topShare > 0.7) flags.push(`${detail.topInputShare}% of all inputs were the single combination "${detail.topInput}"`);

  // how many times one offensive button was pressed, and whether anything else ever was
  const offPresses = {};
  for (const a of ['attack', 'special', 'smash', 'grab', 'grapple']) offPresses[a] = gapsOf(L, m => (m & BIT[a]) !== 0).length + 1;
  const total = Object.values(offPresses).reduce((a, b) => a + b, 0);
  const best = Object.entries(offPresses).sort((a, b) => b[1] - a[1])[0];
  detail.offence = offPresses;
  if (best && total > 40 && best[1] / total > 0.9) flags.push(`${best[1]} of ${total} attacks were the same move ("${best[0]}")`);

  // edge camping: almost never moved
  const moveTicks = L.filter(m => m & MOVE).length;
  detail.moveFrac = +(moveTicks / L.length).toFixed(3);
  if (moveTicks / L.length < 0.02 && L.length > 1800) flags.push(`barely moved (${(100 * moveTicks / L.length).toFixed(1)}% of ticks) — possible edge camping`);

  return { flags, detail };
}

// ------------------------------------------------------------------ self-match detection
// One person on two accounts trading wins. Signals available on the server, cheapest first.
// `meta` per slot: { acct, th (token hash), ip, look, created }
function analyseSelfMatch(metas, history) {
  const flags = [];
  const seen = new Map();
  for (const m of metas) {
    if (!m) continue;
    if (m.th && seen.has('th:' + m.th)) flags.push('two seats share one device token');
    if (m.ip && seen.has('ip:' + m.ip)) flags.push('two seats share one network address');
    if (m.th) seen.set('th:' + m.th, 1);
    if (m.ip) seen.set('ip:' + m.ip, 1);
  }
  // repeat pairings: the same two accounts playing each other over and over
  if (history && metas.length === 2 && metas[0] && metas[1]) {
    const key = [metas[0].acct, metas[1].acct].sort().join('|');
    const n = (history.pairs && history.pairs[key]) || 0;
    if (n >= 10) flags.push(`these two accounts have now played each other ${n + 1} times`);
  }
  return { flags };
}

// ------------------------------------------------------------------ cross-match reuse
// A fingerprint of the input stream: hashes of fixed windows. If the same windows show up in a
// later match by the same account, the inputs were replayed rather than played.
function fingerprint(log, win = 180, stride = 180) {
  const L = (log || []).map(x => x | 0), out = [];
  for (let t = 0; t + win <= L.length; t += stride) {
    if (L.slice(t, t + win).every(m => m === 0)) continue;            // skip idle stretches
    out.push(crypto.createHash('sha1').update(Buffer.from(new Uint16Array(L.slice(t, t + win)).buffer)).digest('hex').slice(0, 16));
  }
  return out;
}

// ------------------------------------------------------------------ store
// Bounded on-disk history, so cross-match signals survive a restart.
class Store {
  constructor(dir, opts = {}) {
    this.file = path.join(dir, 'integrity.json');
    this.maxAccounts = opts.maxAccounts || 20000;
    this.maxPrints = opts.maxPrints || 40;
    this.data = { v: 1, accounts: {}, pairs: {}, holds: [] };
    try { Object.assign(this.data, JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch (e) { /* first run */ }
    this.dirty = false; this.timer = null;
  }
  acct(id) { return this.data.accounts[id] || (this.data.accounts[id] = { prints: [], flags: 0, matches: 0, score: 0, last: 0 }); }
  // returns how many of this match's windows this account has played before
  reuse(id, prints) {
    const a = this.acct(id), have = new Set(a.prints);
    return prints.filter(p => have.has(p)).length;
  }
  record(id, prints, score, flagged) {
    const a = this.acct(id);
    a.matches++; a.last = Date.now();
    a.score = Math.round(a.score * 0.8 + score * 0.2);       // slow-moving reputation
    if (flagged) a.flags++;
    a.prints = a.prints.concat(prints).slice(-this.maxPrints);
    this.touch();
  }
  pair(a, b) {
    if (!a || !b) return 0;
    const k = [a, b].sort().join('|');
    this.data.pairs[k] = (this.data.pairs[k] || 0) + 1;
    this.touch();
    return this.data.pairs[k];
  }
  hold(entry) { this.data.holds.push(entry); if (this.data.holds.length > 500) this.data.holds.shift(); this.touch(); }
  prune() {
    const ids = Object.keys(this.data.accounts);
    if (ids.length > this.maxAccounts) {
      ids.sort((x, y) => this.data.accounts[x].last - this.data.accounts[y].last)
        .slice(0, ids.length - this.maxAccounts).forEach(id => delete this.data.accounts[id]);
      this.touch();
    }
    const keys = Object.keys(this.data.pairs);
    if (keys.length > this.maxAccounts) { keys.slice(0, keys.length - this.maxAccounts).forEach(k => delete this.data.pairs[k]); this.touch(); }
  }
  touch() { this.dirty = true; if (!this.timer) this.timer = setTimeout(() => this.flush(), 5000); if (this.timer.unref) this.timer.unref(); }
  flush() {
    clearTimeout(this.timer); this.timer = null;
    if (!this.dirty) return;
    this.dirty = false;
    try { const tmp = this.file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(this.data)); fs.renameSync(tmp, this.file); }
    catch (e) { /* non-fatal */ }
  }
}

// ------------------------------------------------------------------ whole-match entry point
// record: the replay record written by server.js finish() -- { cfg, log, events, result, ... }
// metas:  per-slot { acct, th, ip, human, dropped }
// store:  a Store, or null to skip every cross-match signal
function analyseMatch(record, metas = [], store = null) {
  const logs = record.log || [];
  const out = { v: 1, at: new Date().toISOString(), match: record.id, slots: [], flags: [], hold: false, maxScore: 0 };

  for (let i = 0; i < logs.length; i++) {
    const meta = metas[i] || {};
    if (!meta.human) { out.slots.push({ slot: i, cpu: true }); continue; }
    const others = logs.filter((_, j) => j !== i);
    const bot = analysePlayer(logs[i], others);
    const deg = analyseDegenerate(logs[i]);
    const s = { slot: i, acct: meta.acct || null, score: bot.score, verdict: bot.verdict, confident: bot.confident,
      flags: bot.flags, degenerate: deg.flags, detail: bot.detail, degenerateDetail: deg.detail };
    if (store && meta.acct) {
      const fp = fingerprint(logs[i]);
      const reused = store.reuse(meta.acct, fp);
      s.reusedWindows = reused;
      if (reused >= 2) { s.score += 30; s.flags.push(`${reused} input sequences from this account's earlier matches replayed verbatim`); s.verdict = s.score >= 60 ? 'likely-automated' : s.verdict; }
      const hist = store.acct(meta.acct);
      s.accountScore = hist.score; s.accountFlags = hist.flags; s.accountMatches = hist.matches;
      if (hist.matches >= 5 && hist.score >= 50) { s.flags.push(`this account has averaged a ${hist.score}/100 automation score over ${hist.matches} matches`); }
      store.record(meta.acct, fp, s.score, s.score >= 35);
    }
    out.maxScore = Math.max(out.maxScore, s.score);
    out.slots.push(s);
  }

  const self = analyseSelfMatch(metas.filter(m => m && m.human), store ? store.data : null);
  if (self.flags.length) out.flags.push(...self.flags);
  if (store && metas.filter(m => m && m.human).length === 2) {
    const [x, y] = metas.filter(m => m && m.human);
    const n = store.pair(x.acct, y.acct);
    if (n >= 10) out.flags.push(`these two accounts have played each other ${n} times`);
  }

  // Did the winner win on a degenerate line, or without actually winning the fight?
  const payee = record.result && record.result.payee;
  if (payee >= 0 && out.slots[payee] && !out.slots[payee].cpu) {
    const w = out.slots[payee];
    if (w.degenerate && w.degenerate.length) out.flags.push(`winner (slot ${payee}): ` + w.degenerate.join('; '));
    if (w.score >= 35) out.flags.push(`winner (slot ${payee}) scored ${w.score}/100 for automation`);
  }
  if (record.result && record.result.reason === 'forfeit') out.flags.push('won by forfeit, not by KO');

  // HOLD means: do not pay this out automatically, a human should look first.
  //
  // WHOSE score decides this matters, and the first version got it wrong. It held on
  // `maxScore >= 60`, the highest score in the match -- so when a bot LOST to an honest player, the
  // honest player's payout was frozen because of what their opponent did. That is the worst kind of
  // false positive: the victim of the cheating pays for it, and the cheat loses nothing they had.
  //
  // So the winner's own score is what holds a payout, plus the two patterns where a flagged LOSER
  // is itself the evidence:
  //   - a conclusive self-match signal (one device token across two seats, or input windows
  //     replayed verbatim from an earlier match). Same browser storage is the same person.
  //   - a flagged loser who has played this exact opponent many times before, which is the shape of
  //     wash trading: one account feeds another by losing on purpose, and the "winner" is clean
  //     because they genuinely won a fight nobody contested.
  // A shared network ADDRESS is deliberately not on this list: carrier-grade NAT puts thousands of
  // unrelated phone users behind one address, so it is recorded and reported but never on its own a
  // reason to sit on someone's money. (Rooms that pay out or rate already refuse two seats from one
  // address at join time.)
  const winner = payee >= 0 && out.slots[payee] && !out.slots[payee].cpu ? out.slots[payee] : null;
  const conclusive = out.flags.some(f => /share one device token|replayed verbatim/.test(f));
  const repeatPairing = out.flags.some(f => /have played each other/.test(f));
  const flaggedLoser = out.slots.some(s => !s.cpu && s.slot !== payee && s.score >= 60);
  out.hold = !!(winner && winner.score >= 60) || conclusive || (flaggedLoser && repeatPairing);
  out.holdReason = !out.hold ? null
    : winner && winner.score >= 60 ? `the winner scored ${winner.score}/100 for automation`
      : conclusive ? 'the two seats are conclusively the same person'
        : 'a flagged player lost repeatedly to the same opponent, which is the shape of wash trading';
  return out;
}

module.exports = { analyseMatch, analysePlayer, analyseDegenerate, analyseSelfMatch, fingerprint, Store, ACTIONS, BIT, MASK_MAX, stats, entropy };

// ------------------------------------------------------------------ FALSE POSITIVE NOTES
//
// This is a detector, not a judge. Every signal below has an innocent explanation:
//
// * frame-perfect press length  -- turbo/macro controllers sold for fighting games do exactly this,
//   and so does a stuck key. Also, a player mashing at the edge of their keyboard's repeat rate can
//   look regular over short samples. Needs 12+ presses before it counts, and it should never be the
//   only reason for a penalty.
//
//   MEASURED, and the one real false positive in this module: a player who holds a legal turbo
//   controller for a WHOLE match scores 80 and is held 100% of the time
//   (`node test/integrity_check.js`, the "turbo pad, held all m" row). A player who uses one in
//   bursts, which is how they are actually used, scores 0 -- mixing human presses in raises the
//   coefficient of variation straight back over the threshold.
//
//   There is no input-stream signal that separates a held-down turbo pad from a script, because at
//   the level of the input stream it IS a script; the only difference is that a human is holding
//   the button. So this cannot be fixed by tuning, and tuning it away would blind the strongest
//   signal the detector has. The resolution is a published RULE rather than a better classifier:
//   turbo and macro controllers are not allowed in wagered matches. That turns a false positive
//   into a stated rule violation, which a player can avoid on purpose and argue about if they are
//   wrong. Publish it in the room UI before any real-ETH match, or this module will freeze honest
//   people's payouts for something nobody told them not to do.
// * fast reactions -- a strong player who has read the matchup can look precognitive on a handful
//   of exchanges. The sample minimum (20) and the consistency test (CV) are what separate "good
//   read" from "reading memory". Pros genuinely hit 150 ms; the flag fires under 85 ms.
// * opposite directions at once -- normal on a d-pad-less keyboard and on some cheap pads; common
//   on mobile touch controls when a thumb slides across the stick. Threshold is deliberately 2%.
// * low entropy / one repeated move -- this is usually just a beginner, or a genuinely dominant
//   move that the balance pass should nerf. It is reported as DEGENERATE, separately from the bot
//   score, precisely so the two are not confused.
// * high APM -- shared keyboards, key-repeat settings and controller chatter all inflate it.
// * shared network address -- families, flatmates, student halls, offices, one phone hotspot, and
//   CGNAT (most mobile networks) put unrelated players behind one address. On its own this must
//   never be a ban; it is only ever a hold-and-look.
// * replayed input windows -- 3 seconds of identical input recurs naturally on a short stage with a
//   simple optimal line (walk to the ledge, shield). Two or more windows is the threshold.
//
// Suggested policy, in order of increasing cost to an innocent player:
//   score < 18  clean, do nothing
//   18-34       watch: record it, no effect on the player
//   35-59       suspicious: shadow flag, exclude from the ranked ladder's top slots pending review
//   60+         hold: pay nothing out automatically on a wagered match, review by hand
// Never auto-ban. Always keep the replay: every flag here is re-checkable, because the replay file
// is the evidence and anyone can re-run it.
