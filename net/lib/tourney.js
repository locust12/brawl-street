'use strict';
// THE TOURNAMENT, server side: one event at a time, open registration, a seeded single-elimination
// bracket, and a permanent record of every game played inside it. Design: ../../docs/TOURNAMENT.md.
//
// WHY THIS FILE EXISTS AT ALL. server.js has carried a `tourneyFeed` and an /api/matches route
// since the capacity work, with a comment promising `tools/tournament.js` would read it and run a
// bracket. That runner was never written, so the feed went nowhere: finished matches piled into a
// ring buffer that nothing consumed. A bracket that lives in an operator's head is not a product --
// players cannot see who they play, when, or whether they are still in it. So the bracket lives
// HERE, next to the matches that decide it, and the page reads it.
//
// THE RULE THAT SHAPES EVERYTHING: A PAGE NEVER REPORTS A RESULT.
//   The only thing that advances this bracket is `onMatch()`, called from the end of a real match
//   that this server simulated itself (server.js keeps a server-side copy of every fight). A client
//   cannot send "I won", cannot name its opponent, and cannot name a round. The only tournament
//   messages a player may send are: enter, withdraw, show me the bracket, and I am at my match.
//   Everything else is read off fights the server watched.
//
// NO MONEY MOVES THROUGH HERE. Entry is free, there is no stake and no escrow: a tournament pair is
//   a private RANKED room with stakes of zero. Prizes are settled by hand, off this server, from the
//   final standings. This file holds no key and signs nothing.
//
// SINGLE EVENT, ON PURPOSE. `cap` entrants, one bracket, one champion. Running two at once means
//   two check-in deadlines against one player and a page that has to ask which one you mean; the
//   first event does not need it, and the file shape (one `ev`, one `bracket`) is what keeps the
//   no-show and forfeit logic small enough to reason about.
const fs = require('fs');
const path = require('path');

const MIN = 60e3;
// Bracket sizes we are willing to draw. 64 is the first event's cap: at 64 entrants the opening
// round is 32 concurrent matches, which the capacity run measured at about a third of one core, and
// six rounds finish inside an evening. Anything above 128 wants a group stage, not a longer bracket.
const SIZES = [4, 8, 16, 32, 64, 128];
const ROUND_NAME = { 2: 'Final', 4: 'Semi-finals', 8: 'Quarter-finals', 16: 'Round of 16', 32: 'Round of 32', 64: 'Round of 64', 128: 'Round of 128' };
// Games needed per round, by how many players are left. Early rounds are one game so a 64-field
// opening round is one slot of wall clock; the rounds that decide the event are sets, because a
// single game on a random stage is a coin flip and a champion should not be one.
const BEST_OF = { 128: 1, 64: 1, 32: 1, 16: 1, 8: 3, 4: 3, 2: 5 };

const now = () => Date.now();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const need = bestOf => (bestOf + 1) >> 1;   // wins that take the set

// Standard single-elimination seed order: 1 meets the weakest survivor as late as possible, and
// seeds 1 and 2 cannot meet before the final. Built by reflection, which is the whole trick --
// [1,2] -> [1,4,2,3] -> [1,8,4,5,2,7,3,6] -- rather than by a hand-written table per size.
function seedOrder(n) {
  let o = [1, 2];
  while (o.length < n) { const m = o.length * 2 + 1, next = []; for (const s of o) next.push(s, m - s); o = next; }
  return o;
}
// The drawn bracket size for a field: the next power of two at or above it, so a field of 50 plays
// a 64 bracket and the top 14 seeds get a bye. Byes go to the TOP seeds, never at random.
function sizeFor(n) { for (const s of SIZES) if (s >= n) return s; return SIZES[SIZES.length - 1]; }

class Tourney {
  constructor(o) {
    this.dir = o.dataDir;
    this.accounts = o.accounts;
    this.log = o.log || (() => {});
    this.file = path.join(this.dir, 'tourney.json');
    this.evFile = path.join(this.dir, 'tourney-event.json');
    // Set by server.js. `room(pair, ctx)` opens the private ranked room for a pair and returns its
    // code; `push(acctIds, msg)` reaches whichever sockets those accounts have open, or none;
    // `sync()` pushes the whole board to everyone watching; `close(code)` drops a finished room.
    this.api = { room: () => null, push: () => {}, sync: () => {}, close: () => {} };
    this.dirty = false; this.timer = null;
    this.ev = null; this.entr = new Map(); this.bracket = null; this.games = []; this.standings = [];
    this.load();
    this.tick = setInterval(() => { try { this.sweep(); } catch (e) { this.log('tourney sweep', e && e.message); } }, 10e3);
    if (this.tick.unref) this.tick.unref();
  }

  // ---------------------------------------------------------------- disk
  // Two files, deliberately. tourney-event.json is the ANNOUNCEMENT and is edited by a human (or by
  // tools/tournament.js) -- name, cap, the three timestamps, the prize line. tourney.json is what
  // the server wrote: entrants, the drawn bracket, every game. Re-announcing never touches the
  // second, and a crash mid-event never costs the first.
  load() {
    fs.mkdirSync(this.dir, { recursive: true });
    let ev = null;
    try { ev = JSON.parse(fs.readFileSync(this.evFile, 'utf8')); } catch (e) { /* no event announced */ }
    let st = null;
    try { st = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (e) { /* first run */ }
    if (ev) this.ev = this.fixEvent(ev);
    if (st && this.ev && st.eid === this.ev.id) {
      for (const e of st.entrants || []) this.entr.set(e.acct, e);
      this.bracket = st.bracket || null;
      this.games = st.games || [];
      this.standings = st.standings || [];
      this.phase = st.phase || 'open';
    } else {
      // A new event id wipes the old bracket rather than trying to migrate it. The finished one is
      // kept beside it so a past champion is never lost to an announcement.
      if (st && st.eid) { try { fs.writeFileSync(path.join(this.dir, 'tourney-' + st.eid + '.json'), JSON.stringify(st)); } catch (e) {} }
      this.phase = 'open';
    }
    if (this.ev) this.log('tourney', this.ev.id, this.phase, this.entr.size + '/' + this.ev.cap, 'entrants');
  }
  fixEvent(e) {
    const t = now();
    const ev = {
      id: String(e.id || 'bs-open-1').slice(0, 40),
      name: String(e.name || 'Brawl Street Open').slice(0, 60),
      cap: SIZES.includes(+e.cap) ? +e.cap : 64,
      waitlist: clamp(+e.waitlist || 0, 0, 128),
      opensAt: +e.opensAt || t,
      closesAt: +e.closesAt || t + 24 * 60 * MIN,
      startsAt: +e.startsAt || t + 25 * 60 * MIN,
      // How long a pair has to show up and finish. A player who never checks in is forfeited at the
      // deadline, because 63 other people are not waiting on them.
      checkInMs: clamp(+e.checkInMs || 8 * MIN, 2 * MIN, 60 * MIN),
      roundMs: clamp(+e.roundMs || 25 * MIN, 5 * MIN, 180 * MIN),
      prize: String(e.prize || '').slice(0, 200),
      note: String(e.note || '').slice(0, 300),
      // Stages a tournament game may roll. Vault stages are OUT: not everyone owns them, and a
      // bracket must never put a paying player on a map their opponent cannot load.
      stages: Array.isArray(e.stages) && e.stages.length ? e.stages.slice(0, 24).map(String) : ['isle', 'moon', 'chart', 'keep', 'roof', 'dojo'],
      stocks: clamp(+e.stocks || 3, 1, 5),
      region: e.region ? String(e.region).slice(0, 12) : null,
    };
    if (ev.closesAt <= ev.opensAt) ev.closesAt = ev.opensAt + 60 * MIN;
    if (ev.startsAt < ev.closesAt) ev.startsAt = ev.closesAt;
    return ev;
  }
  touch() { this.dirty = true; if (!this.timer) this.timer = setTimeout(() => this.flush(), 1500); }
  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.dirty || !this.ev) return;
    this.dirty = false;
    const body = { v: 1, eid: this.ev.id, phase: this.phase, saved: now(),
      entrants: [...this.entr.values()], bracket: this.bracket, games: this.games.slice(-2000), standings: this.standings };
    try {
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(body));
      fs.renameSync(tmp, this.file);   // never a half-written bracket, even if the box dies mid-write
    } catch (e) { this.log('tourney save failed', e && e.message); this.dirty = true; }
  }

  // ---------------------------------------------------------------- announcing (operator only)
  // Writes the announcement file and starts a fresh event. Same id = re-announce (timestamps and
  // copy change, entrants keep their seats); new id = a new event, old bracket filed away.
  announce(e) {
    const ev = this.fixEvent(e || {});
    const same = this.ev && this.ev.id === ev.id;
    try { fs.writeFileSync(this.evFile, JSON.stringify(ev, null, 2)); } catch (err) { return { ok: false, msg: 'Could not write the event file: ' + err.message }; }
    this.ev = ev;
    if (!same) { this.entr = new Map(); this.bracket = null; this.games = []; this.standings = []; this.phase = 'open'; }
    this.touch(); this.flush();
    this.log('tourney announced', ev.id, ev.name, 'cap', ev.cap);
    this.broadcast();
    return { ok: true, ev };
  }

  // ---------------------------------------------------------------- entrants
  open() { return !!this.ev && this.phase === 'open' && now() >= this.ev.opensAt && now() < this.ev.closesAt && !this.bracket; }
  seats() { let n = 0; for (const e of this.entr.values()) if (e.status === 'in') n++; return n; }
  waiting() { let n = 0; for (const e of this.entr.values()) if (e.status === 'wait') n++; return n; }
  entrant(acctId) { return acctId ? this.entr.get(acctId) || null : null; }

  // Enter the event. Deliberately strict about WHO may enter, and every reason is one a player can
  // read and act on rather than a flat refusal.
  join(acctId) {
    if (!this.ev) return { ok: false, msg: 'No tournament is announced right now.' };
    const a = this.accounts.byId(acctId);
    if (!a) return { ok: false, msg: 'Sign in before you enter.' };
    const had = this.entr.get(acctId);
    if (had && had.status !== 'out') return { ok: true, already: true, msg: 'You are already entered.' };
    if (this.bracket) return { ok: false, msg: 'The bracket is drawn, so entries are closed. The next event is announced on the tournament screen.' };
    if (now() < this.ev.opensAt) return { ok: false, msg: 'Entries open ' + new Date(this.ev.opensAt).toISOString().slice(0, 16).replace('T', ' ') + ' UTC.' };
    if (now() >= this.ev.closesAt) return { ok: false, msg: 'Entries for this one are closed.' };
    if (a.test) return { ok: false, msg: 'Test accounts cannot enter.' };
    // A NAME OVER A FIGHTER'S HEAD IN A BRACKET HAS TO BE SOMEBODY. The X connect route is the
    // sign-in this game already has, and requiring it is what stops one person entering the field
    // forty times from forty tabs -- the cheapest and most likely way to ruin a first event.
    // X_REQUIRED=0 drops it for a LAN event or a closed playtest.
    if (process.env.TOURNEY_X !== '0' && !a.x) return { ok: false, needX: true, msg: 'Connect your X account to enter. It is the name the bracket shows.' };
    const full = this.seats() >= this.ev.cap;
    if (full && this.waiting() >= this.ev.waitlist) return { ok: false, msg: 'The field is full and so is the waiting list.' };
    const e = had || { acct: acctId };
    Object.assign(e, {
      name: a.x || a.name, x: a.x || null, elo: a.rg ? a.elo : null, rg: a.rg || 0,
      status: full ? 'wait' : 'in', joinedAt: e.joinedAt || now(), seed: null,
      w: 0, l: 0, place: null, out: null,
    });
    this.entr.set(acctId, e);
    this.touch();
    this.log('tourney', e.status === 'wait' ? 'waitlist' : 'entry', e.name, this.seats() + '/' + this.ev.cap);
    this.broadcast();
    return { ok: true, status: e.status, msg: e.status === 'wait' ? 'The field is full. You are on the waiting list and move up if anyone withdraws.' : 'You are in. Be at the tournament screen when it starts.' };
  }

  // Withdraw. Before the draw it frees the seat and the first waiting player takes it; after the
  // draw it is a forfeit of whatever match they are in, because the bracket cannot have a hole.
  leave(acctId) {
    const e = this.entr.get(acctId);
    if (!e || e.status === 'out') return { ok: true, msg: 'You were not entered.' };
    if (this.bracket) {
      const p = this.pairOf(acctId);
      if (p && !p.winner) { this.award(p, p.a === acctId ? p.b : p.a, 'withdrew'); }
      e.status = 'out'; e.out = 'withdrew'; this.touch(); this.broadcast();
      return { ok: true, msg: 'You are out of the bracket.' };
    }
    e.status = 'out'; e.out = 'withdrew';
    this.promote();
    this.touch(); this.broadcast();
    return { ok: true, msg: 'You are out of this one. Enter again any time before entries close.' };
  }
  // Move waiting players into freed seats, oldest entry first. Called on a withdrawal and again
  // right before the draw, so a field that lost three people overnight still starts full.
  promote() {
    if (!this.ev) return 0;
    let moved = 0;
    const wait = [...this.entr.values()].filter(x => x.status === 'wait').sort((a, b) => a.joinedAt - b.joinedAt);
    for (const w of wait) { if (this.seats() >= this.ev.cap) break; w.status = 'in'; moved++; this.api.push([w.acct], { k: 'ttoast', msg: 'A seat opened up. You are in the tournament.' }); }
    if (moved) this.touch();
    return moved;
  }

  // ---------------------------------------------------------------- the draw
  // Seeded by ladder Elo, with everybody who has never played a ranked game behind everybody who
  // has. Entry order breaks a tie, so the earliest entrant gets the better seed -- a rule the page
  // can state up front, unlike a random tiebreak.
  draw() {
    if (!this.ev) return { ok: false, msg: 'No event.' };
    if (this.bracket) return { ok: false, msg: 'Already drawn.' };
    this.promote();
    const field = [...this.entr.values()].filter(x => x.status === 'in');
    if (field.length < 2) { this.phase = 'void'; this.touch(); this.broadcast(); return { ok: false, msg: 'Not enough entrants to draw a bracket.' }; }
    field.sort((a, b) => (b.rg > 0) - (a.rg > 0) || (b.elo || 0) - (a.elo || 0) || a.joinedAt - b.joinedAt);
    field.forEach((e, i) => { e.seed = i + 1; e.w = 0; e.l = 0; e.place = null; });
    const size = sizeFor(field.length);
    const order = seedOrder(size);
    const bySeed = new Map(field.map(e => [e.seed, e.acct]));
    const r1 = [];
    for (let i = 0; i < order.length; i += 2) {
      const a = bySeed.get(order[i]) || null, b = bySeed.get(order[i + 1]) || null;
      r1.push(this.newPair(1, r1.length, a, b, BEST_OF[size] || 1));
    }
    this.bracket = { size, drawnAt: now(), rounds: [{ n: 1, left: size, name: ROUND_NAME[size] || ('Round of ' + size), bestOf: BEST_OF[size] || 1, pairs: r1 }] };
    this.phase = 'live';
    // Byes resolve immediately: a pair with one player in it is not a match anybody has to show up
    // for, and the page should show them through to the next round the moment the draw lands.
    this.resolveByes();
    this.touch(); this.flush();
    this.log('tourney drawn', field.length, 'entrants into a', size, 'bracket');
    this.broadcast();
    return { ok: true, size, field: field.length };
  }
  newPair(round, idx, a, b, bestOf) {
    return { pid: 'r' + round + 'm' + (idx + 1), round, idx, a, b, bestOf, wa: 0, wb: 0,
      winner: null, loser: null, how: null, code: null, inA: 0, inB: 0, deadline: 0, games: [] };
  }
  round() { return this.bracket ? this.bracket.rounds[this.bracket.rounds.length - 1] : null; }
  pairOf(acctId) {
    const r = this.round(); if (!r || !acctId) return null;
    return r.pairs.find(p => !p.winner && (p.a === acctId || p.b === acctId)) || null;
  }
  pairById(pid) { const r = this.round(); return r ? r.pairs.find(p => p.pid === pid) || null : null; }

  // A pair with an empty side, or one side already out, is over before it starts.
  resolveByes() {
    const r = this.round(); if (!r) return;
    for (const p of r.pairs) {
      if (p.winner) continue;
      const ao = p.a && this.outOf(p.a), bo = p.b && this.outOf(p.b);
      if ((!p.a || ao) && (!p.b || bo)) { p.winner = null; p.how = 'empty'; p.done = true; continue; }
      if (!p.b || bo) this.award(p, p.a, p.b ? 'walkover' : 'bye');
      else if (!p.a || ao) this.award(p, p.b, p.a ? 'walkover' : 'bye');
    }
    this.armDeadlines();
    this.advanceIfDone();
  }
  outOf(acctId) { const e = this.entr.get(acctId); return !e || e.status === 'out'; }
  // Every unresolved pair in the live round gets the same wall-clock deadline, counted from when the
  // round opened. One clock per round, not per pair: a player cannot stall their own pair into a
  // different schedule from everyone else's, and the page can show one countdown.
  armDeadlines() {
    const r = this.round(); if (!r || !this.ev) return;
    if (!r.openedAt) r.openedAt = Math.max(now(), this.ev.startsAt);
    const dl = r.openedAt + this.ev.checkInMs;
    for (const p of r.pairs) if (!p.winner && !p.done && !p.deadline) p.deadline = dl;
    r.endsBy = r.openedAt + this.ev.roundMs;
  }

  // ---------------------------------------------------------------- check-in
  // "I am at my match". The FIRST player to check in opens the room (server.js makes it); the second
  // gets the same code back and the page walks them into it. A code is never handed to anyone who is
  // not in that pair, and never before the event starts.
  checkIn(acctId, ctx) {
    if (!this.bracket || this.phase !== 'live') return { ok: false, msg: 'The bracket is not running yet.' };
    const p = this.pairOf(acctId);
    if (!p) {
      const e = this.entr.get(acctId);
      if (e && e.status === 'out') return { ok: false, msg: 'You are out of this one. ' + (e.place ? 'You finished ' + ordinal(e.place) + '.' : '') };
      const r = this.round();
      if (e && r && r.pairs.some(x => x.winner === acctId)) return { ok: false, msg: 'You won that round. Wait for the next one to open.' };
      return { ok: false, msg: 'You are not in this tournament.' };
    }
    const mine = p.a === acctId ? 'inA' : 'inB';
    if (!p[mine]) { p[mine] = now(); this.touch(); }
    if (!p.code) {
      const code = this.api.room(p, ctx);
      if (!code) return { ok: false, retry: true, msg: 'The server could not open your match room. Try again in a moment.' };
      p.code = code; this.touch();
    }
    const other = p.a === acctId ? p.b : p.a;
    const them = this.entr.get(other);
    // Tell the opponent their match is open, wherever in the game they are. The one real cause of a
    // dead bracket is two people waiting on each other.
    this.api.push([other], { k: 'ttoast', msg: (this.entr.get(acctId) || {}).name + ' is at your match. Room ' + p.code + '.' });
    this.broadcast();
    return { ok: true, pid: p.pid, code: p.code, opponent: them ? { name: them.name, seed: them.seed, elo: them.elo } : null,
      bestOf: p.bestOf, wins: [p.wa, p.wb], you: p.a === acctId ? 'a' : 'b', deadline: p.deadline };
  }

  // ---------------------------------------------------------------- results
  // THE ONLY WAY A SCORE CHANGES. `rec` is the finished-match record server.js builds for its own
  // feed: the two accounts, who won, and the replay hash. Anything that does not match the live
  // pair exactly is ignored, which covers a tournament player taking a casual quick match mid-round.
  onMatch(rec) {
    if (!this.bracket || this.phase !== 'live' || !rec) return false;
    const ids = (rec.players || []).map(p => p.acct).filter(Boolean);
    if (ids.length !== 2) return false;
    const r = this.round(); if (!r) return false;
    const p = r.pairs.find(x => !x.winner && x.a && x.b && ids.includes(x.a) && ids.includes(x.b));
    if (!p) return false;
    // Only a game played in the room this bracket opened counts. Two entrants who happen to meet in
    // a quick match do not score a tournament game, which is the hole that would let a pair settle
    // their set somewhere the bracket never looked.
    if (!p.code || rec.code !== p.code) return false;
    const wslot = rec.winner;
    const wacct = Number.isInteger(wslot) && rec.players[wslot] ? rec.players[wslot].acct : null;
    const g = { at: rec.at || now(), id: rec.id, replay: rec.replay || null, ticks: rec.ticks || 0,
      winner: rec.cancelled ? null : wacct, reason: rec.reason || null,
      players: rec.players.map(x => ({ acct: x.acct, name: x.name, stocks: x.stocks, dmg: x.dmg, dropped: !!x.dropped })) };
    p.games.push(g);
    this.games.push(Object.assign({ pid: p.pid, round: p.round }, g));
    // A cancelled or double-dropped game scores for nobody and is replayed. It still goes in the
    // record, because "we played three and one didn't count" is a thing a player will dispute.
    if (g.winner === p.a) p.wa++;
    else if (g.winner === p.b) p.wb++;
    const n = need(p.bestOf);
    if (p.wa >= n) this.award(p, p.a, 'won ' + p.wa + '-' + p.wb);
    else if (p.wb >= n) this.award(p, p.b, 'won ' + p.wb + '-' + p.wa);
    else {
      // Set not over: the room stays open for the next game and the clock gets the rest of the round.
      this.api.push([p.a, p.b], { k: 'ttoast', msg: 'Game to ' + ((g.winner === p.a ? this.nameOf(p.a) : g.winner === p.b ? this.nameOf(p.b) : 'nobody')) + '. Set is ' + p.wa + '-' + p.wb + ', first to ' + n + '.' });
    }
    this.touch();
    this.advanceIfDone();
    this.broadcast();
    return true;
  }
  nameOf(acctId) { const e = this.entr.get(acctId); return e ? e.name : 'a player'; }

  // Hand a pair to one side. `how` is the sentence the bracket shows, so a walkover reads as one.
  award(p, winner, how) {
    if (p.winner) return;
    const loser = p.a === winner ? p.b : p.a;
    p.winner = winner; p.loser = loser; p.how = how; p.done = true;
    const we = this.entr.get(winner); if (we) we.w++;
    const le = loser && this.entr.get(loser);
    if (le) {
      le.l++; le.status = 'out'; le.out = how;
      // Place by the round you went out in: everybody knocked out of the same round shares a place,
      // which is how a single-elimination bracket actually finishes. 3rd is shared unless a 3rd-place
      // match is played, and this event does not play one.
      le.place = (this.bracket.size >> (p.round - 1)) / 2 + 1;
    }
    if (p.code) this.api.close(p.code);
    if (loser) this.api.push([winner, loser], { k: 'ttoast', msg: this.nameOf(winner) + ' takes it (' + how + ').' });
    this.touch();
  }

  // Round over? Build the next one from the winners, or crown the champion.
  advanceIfDone() {
    const r = this.round(); if (!r) return;
    if (r.pairs.some(p => !p.winner && !p.done)) return;
    const winners = r.pairs.map(p => p.winner);
    const live = winners.filter(Boolean);
    if (live.length <= 1) {
      const champ = live[0] || null;
      if (champ) { const e = this.entr.get(champ); if (e) { e.place = 1; e.champ = true; } }
      this.phase = 'done'; this.bracket.endedAt = now(); this.bracket.champion = champ;
      this.standings = this.table();
      this.log('tourney', this.ev.id, 'champion', champ ? this.nameOf(champ) : '(none)');
      this.api.push(this.everyone(), { k: 'ttoast', msg: champ ? this.nameOf(champ) + ' wins ' + this.ev.name + '.' : 'The tournament ended with no champion.' });
      this.touch(); this.flush();
      return;
    }
    const left = winners.length;      // bracket slots in the NEXT round, byes included
    const bestOf = BEST_OF[left] || 1;
    const pairs = [];
    for (let i = 0; i < winners.length; i += 2) pairs.push(this.newPair(r.n + 1, pairs.length, winners[i], winners[i + 1], bestOf));
    this.bracket.rounds.push({ n: r.n + 1, left, name: ROUND_NAME[left] || ('Round of ' + left), bestOf, pairs, openedAt: now() });
    this.log('tourney round', r.n + 1, ROUND_NAME[left] || left, pairs.length, 'matches');
    this.resolveByes();
    this.api.push(this.everyone(), { k: 'ttoast', msg: (ROUND_NAME[left] || 'The next round') + ' is open. Check in at the tournament screen.' });
    this.touch();
  }
  everyone() { return [...this.entr.keys()]; }

  // ---------------------------------------------------------------- the clock
  // Everything time-driven lives here, on one 10 s tick: entries closing, the draw, and no-shows.
  // Nothing in this file waits for an operator to press anything, because the one certainty about a
  // Saturday-night bracket is that nobody is watching the console at 02:00.
  sweep() {
    if (!this.ev) return;
    const t = now();
    if (!this.bracket && this.phase === 'open' && t >= this.ev.closesAt) {
      this.phase = 'closed'; this.touch(); this.broadcast();
    }
    if (!this.bracket && (this.phase === 'closed' || this.phase === 'open') && t >= this.ev.startsAt) { this.draw(); return; }
    if (this.phase !== 'live' || !this.bracket) return;
    const r = this.round(); if (!r) return;
    let changed = false;
    for (const p of r.pairs) {
      if (p.winner || p.done || !p.deadline) continue;
      // CHECK-IN DEADLINE. One side showed up and the other did not: the one who showed up advances.
      // Neither showed up: the better seed advances, which is the only tiebreak that is already
      // public. Never a coin flip, and never both of them out -- the bracket needs a body.
      if (t >= p.deadline && !(p.inA && p.inB)) {
        if (p.inA && !p.inB) this.award(p, p.a, 'no-show');
        else if (p.inB && !p.inA) this.award(p, p.b, 'no-show');
        else {
          const sa = (this.entr.get(p.a) || {}).seed || 1e9, sb = (this.entr.get(p.b) || {}).seed || 1e9;
          this.award(p, sa <= sb ? p.a : p.b, 'both no-show, higher seed advances');
        }
        changed = true; continue;
      }
      // ROUND DEADLINE with a set unfinished: whoever is ahead on games takes it, and if the set is
      // level the better seed does. A 64-field cannot wait on one pair that keeps rematching.
      if (r.endsBy && t >= r.endsBy) {
        if (p.wa !== p.wb) this.award(p, p.wa > p.wb ? p.a : p.b, 'ahead ' + Math.max(p.wa, p.wb) + '-' + Math.min(p.wa, p.wb) + ' when time ran out');
        else {
          const sa = (this.entr.get(p.a) || {}).seed || 1e9, sb = (this.entr.get(p.b) || {}).seed || 1e9;
          this.award(p, sa <= sb ? p.a : p.b, 'time, higher seed advances');
        }
        changed = true;
      }
    }
    if (changed) { this.advanceIfDone(); this.broadcast(); }
  }

  // Operator override, for the case the automatic rules get wrong: a disputed set, a crashed box, a
  // player everyone agrees should go through. Takes a pair and a side, writes the reason into the
  // bracket where players can see it, and never invents a result for a game that was not played.
  force(pid, acctId, why) {
    const p = this.pairById(pid);
    if (!p) return { ok: false, msg: 'No such live match.' };
    if (p.winner) return { ok: false, msg: 'That match is already decided.' };
    if (acctId !== p.a && acctId !== p.b) return { ok: false, msg: 'That account is not in that match.' };
    this.award(p, acctId, 'operator: ' + String(why || 'decided by hand').slice(0, 80));
    this.advanceIfDone(); this.broadcast();
    return { ok: true };
  }

  // ---------------------------------------------------------------- views
  // Final table. Champion first, then by the round they went out in, then by seed inside a place.
  table() {
    const all = [...this.entr.values()].filter(e => e.seed);
    all.sort((a, b) => (a.place || 1e9) - (b.place || 1e9) || a.seed - b.seed);
    return all.map(e => ({ place: e.place, name: e.name, x: e.x, seed: e.seed, w: e.w, l: e.l, out: e.out || null }));
  }
  // The whole board, as the page draws it. Public: no account ids, no tokens, nothing that is not
  // already on the leaderboard. `forAcct` adds the one player's own row and their next match.
  state(forAcct) {
    if (!this.ev) return { k: 'tstate', on: false };
    const nm = id => { const e = this.entr.get(id); return e ? { name: e.name, x: e.x, seed: e.seed, elo: e.elo } : null; };
    const out = {
      k: 'tstate', on: true, now: now(), phase: this.phase,
      ev: { id: this.ev.id, name: this.ev.name, cap: this.ev.cap, waitlist: this.ev.waitlist,
        opensAt: this.ev.opensAt, closesAt: this.ev.closesAt, startsAt: this.ev.startsAt,
        checkInMs: this.ev.checkInMs, roundMs: this.ev.roundMs, prize: this.ev.prize, note: this.ev.note,
        stocks: this.ev.stocks, stages: this.ev.stages, region: this.ev.region },
      seats: this.seats(), wait: this.waiting(),
      entrants: [...this.entr.values()].filter(e => e.status !== 'out' || e.seed)
        .sort((a, b) => (a.seed || 1e9) - (b.seed || 1e9) || a.joinedAt - b.joinedAt)
        .slice(0, 160).map(e => ({ name: e.name, x: e.x, seed: e.seed, elo: e.elo, status: e.status, w: e.w, l: e.l, place: e.place })),
      champion: this.bracket && this.bracket.champion ? nm(this.bracket.champion) : null,
      standings: this.phase === 'done' ? this.standings.slice(0, 32) : [],
    };
    if (this.bracket) {
      out.bracket = {
        size: this.bracket.size, drawnAt: this.bracket.drawnAt,
        rounds: this.bracket.rounds.map(r => ({
          n: r.n, name: r.name, bestOf: r.bestOf, openedAt: r.openedAt || 0, endsBy: r.endsBy || 0,
          pairs: r.pairs.map(p => ({ pid: p.pid, a: nm(p.a), b: nm(p.b), wa: p.wa, wb: p.wb,
            winner: p.winner ? (p.winner === p.a ? 'a' : 'b') : null, how: p.how, live: !!(p.code && !p.winner),
            deadline: p.winner ? 0 : p.deadline })),
        })),
      };
    }
    if (forAcct) {
      const me = this.entr.get(forAcct);
      out.me = me ? { in: me.status, seed: me.seed, w: me.w, l: me.l, place: me.place, out: me.out || null, champ: !!me.champ } : null;
      const p = this.pairOf(forAcct);
      if (p) {
        const other = p.a === forAcct ? p.b : p.a;
        out.next = { pid: p.pid, round: p.round, bestOf: p.bestOf, code: p.code || null, deadline: p.deadline,
          checkedIn: !!(p.a === forAcct ? p.inA : p.inB), theirs: !!(p.a === forAcct ? p.inB : p.inA),
          wins: p.a === forAcct ? [p.wa, p.wb] : [p.wb, p.wa], opponent: nm(other) };
      }
      // Can this account enter right now, and if not, why not -- so the page writes one honest line
      // instead of a greyed-out button with no explanation.
      if (!me || me.status === 'out') {
        const a = this.accounts.byId(forAcct);
        out.canJoin = this.open() && (this.seats() < this.ev.cap || this.waiting() < this.ev.waitlist);
        out.needX = !!(process.env.TOURNEY_X !== '0' && a && !a.x);
      }
    }
    return out;
  }
  // One push to every open socket of every entrant, plus anyone with the screen open (server.js
  // keeps that set). Cheap: the board is a few KB and this only fires when something changed.
  broadcast() { try { this.api.sync(); } catch (e) { this.log('tourney sync', e && e.message); } }
  stop() { clearInterval(this.tick); this.flush(); }
}

function ordinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

module.exports = { Tourney, SIZES, BEST_OF, ROUND_NAME, seedOrder, sizeFor };
