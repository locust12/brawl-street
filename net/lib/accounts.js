// Player accounts, held by the server: practice balance, profile (name + saved custom fighter look),
// Elo (all-time + weekly season), friends, friend code, recovery code.
// A device is known only by sha256(its random token); raw tokens and raw recovery codes never touch
// disk. No IPs, no emails, nothing else is stored.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const chat = require('./chat');

const START = 1.0, REFILL_BELOW = 0.01, REFILL_COOLDOWN_MS = 30 * 1000;
const ELO0 = 1200, MAX_FRIENDS = 200, MAX_REQS = 50;
const round = v => Math.round(v * 1e9) / 1e9;
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const code = n => { let s = ''; for (let i = 0; i < n; i++) s += ABC[crypto.randomInt(ABC.length)]; return s; };

// ISO week, e.g. "2026-W38" (seasons run Monday 00:00 UTC to Monday 00:00 UTC)
function seasonId(t = Date.now()) {
  const d = new Date(t); d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const y = d.getUTCFullYear(), w1 = new Date(Date.UTC(y, 0, 4));
  const wk = 1 + Math.round(((d - w1) / 864e5 - 3 + ((w1.getUTCDay() + 6) % 7)) / 7);
  return y + '-W' + String(wk).padStart(2, '0');
}
function seasonEnds(t = Date.now()) {
  const d = new Date(t); d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + (8 - (d.getUTCDay() || 7)));
  return d.getTime();
}

class Accounts {
  constructor(dir) {
    this.file = path.join(dir, 'accounts.json');
    fs.mkdirSync(dir, { recursive: true });
    this.acc = new Map(); this.tok = new Map(); this.rec = new Map(); this.fc = new Map();
    let raw = null;
    try { raw = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (e) { /* first run */ }
    if (raw && raw.v === 2) {
      for (const [id, a] of Object.entries(raw.accounts || {})) this.acc.set(id, a);
      for (const [t, id] of Object.entries(raw.tokens || {})) this.tok.set(t, id);
      for (const [r, id] of Object.entries(raw.recovery || {})) this.rec.set(r, id);
    } else if (raw) {
      // v1 file: token hash -> account
      for (const [th, a] of Object.entries(raw)) { const id = this.newId(); this.acc.set(id, Object.assign(a, { id })); this.tok.set(th, id); }
    }
    for (const a of this.acc.values()) this.fix(a);
    this.dirty = false; this.timer = null; this.boardCache = null;
    this.showTests = process.env.BOARD_SHOW_TESTS === '1';   // local test servers only
  }
  static hashToken(token) { return sha('brawlstreet:' + token); }
  newId() { for (;;) { const id = crypto.randomBytes(6).toString('hex'); if (!this.acc.has(id)) return id; } }
  fix(a) {
    if (a.name && !chat.nameOk(a.name)) a.name = 'Player ' + (1000 + (parseInt(a.id.slice(0, 4), 16) % 9000));
    if (!a.fc || this.fc.has(a.fc) && this.fc.get(a.fc) !== a.id) { let c; do c = code(6); while (this.fc.has(c)); a.fc = c; }
    this.fc.set(a.fc, a.id);
    if (a.elo == null) Object.assign(a, { elo: ELO0, rg: 0, rw: 0, rl: 0 });
    a.friends = a.friends || []; a.reqIn = a.reqIn || []; a.reqOut = a.reqOut || [];
    a.games = a.games || 0; a.wins = a.wins || 0;
    return a;
  }
  // the account behind a device token (a new one for a new device)
  get(th) {
    let id = this.tok.get(th), a = id && this.acc.get(id);
    if (!a) {
      id = this.newId();
      a = this.fix({ id, bal: START, name: '', games: 0, wins: 0, won: 0, refills: 0, created: Date.now(), look: null });
      this.acc.set(id, a); this.tok.set(th, id); this.touch();
    }
    return a;
  }
  // is this device token already known? (lets the server rate-limit the minting of NEW accounts
  // without charging a returning player for it)
  has(th) { const id = this.tok.get(th); return !!(id && this.acc.has(id)); }
  size() { return this.acc.size; }
  byId(id) { return this.acc.get(id) || null; }
  byFriendCode(c) { const id = this.fc.get(String(c || '').toUpperCase()); return id ? this.acc.get(id) : null; }
  findByName(name) { const n = String(name || '').trim().toLowerCase(); if (!n) return []; const out = []; for (const a of this.acc.values()) if ((a.name || '').toLowerCase() === n) out.push(a); return out; }

  add(th, v) { const a = this.get(th); a.bal = round(Math.max(0, a.bal + v)); this.touch(); return a.bal; }
  refill(th) {
    const a = this.get(th), now = Date.now();
    if (a.bal >= REFILL_BELOW) return { ok: false, msg: 'Refill unlocks below ' + REFILL_BELOW + ' ETH' };
    if (now - (a.refilledAt || 0) < REFILL_COOLDOWN_MS) return { ok: false, msg: 'Refill again in a few seconds' };
    a.bal = START; a.refilledAt = now; a.refills = (a.refills || 0) + 1; this.touch();
    return { ok: true, bal: a.bal };
  }

  // ---- recovery codes: shown once, stored hashed; a new one replaces the old one
  newRecovery(th) {
    const a = this.get(th), c = code(4) + '-' + code(4) + '-' + code(4) + '-' + code(4);
    for (const [h, id] of this.rec) if (id === a.id) this.rec.delete(h);
    this.rec.set(sha('recovery:' + c), a.id); a.recAt = Date.now(); this.touch();
    return c;
  }
  // link this device token to the account the code belongs to
  recover(th, c) {
    const norm = String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (norm.length !== 16) return null;
    const pretty = norm.match(/.{4}/g).join('-');
    const id = this.rec.get(sha('recovery:' + pretty)); const a = id && this.acc.get(id);
    if (!a) return null;
    this.tok.set(th, a.id); this.touch();
    return a;
  }

  // ---- Elo (chess-style): K 32 for the first 30 rated games, 16 after; the weekly season starts everyone at 1200
  season(a) { const sid = seasonId(); if (!a.season || a.season.id !== sid) a.season = { id: sid, elo: ELO0, g: 0, w: 0, l: 0 }; return a.season; }
  rate(wTh, lTh, char) {
    const w = this.get(wTh), l = this.get(lTh); if (w.id === l.id) return null;
    const k = a => (a.rg < 30 ? 32 : 16);
    const E = (x, y) => 1 / (1 + Math.pow(10, (y - x) / 400));
    const ew = E(w.elo, l.elo), dw = Math.round(k(w) * (1 - ew)), dl = Math.round(k(l) * (1 - ew));
    w.elo += dw; l.elo -= dl; w.rg++; l.rg++; w.rw++; l.rl++;
    const sw = this.season(w), sl = this.season(l), es = E(sw.elo, sl.elo), sdw = Math.round(32 * (1 - es)), sdl = sdw;
    sw.elo += sdw; sl.elo -= sdl; sw.g++; sl.g++; sw.w++; sl.l++;
    if (char) w.main = char;
    this.boardCache = null; this.touch();
    return { winner: { elo: w.elo, d: dw, season: sw.elo }, loser: { elo: l.elo, d: -dl, season: sl.elo } };
  }
  leaderboard(limit = 100) {
    const now = Date.now();
    if (this.boardCache && now - this.boardCache.at < 15000) return this.boardCache.data;
    const sid = seasonId();
    const row = (a, i, elo, g, w, l) => ({ rank: i + 1, name: a.name || 'Player', x: (a.look && a.look.x) || null, elo, games: g, wins: w, losses: l, main: a.main || null, look: a.look ? a.look.base : null });
    const allA = [...this.acc.values()].filter(a => a.rg > 0 && (!a.test || this.showTests)).sort((x, y) => y.elo - x.elo || y.rw - x.rw).slice(0, limit);
    const weekA = [...this.acc.values()].filter(a => (!a.test || this.showTests) && a.season && a.season.id === sid && a.season.g > 0).sort((x, y) => y.season.elo - x.season.elo || y.season.w - x.season.w).slice(0, limit);
    const data = { updated: new Date(now).toISOString(), season: { id: sid, ends: new Date(seasonEnds(now)).toISOString() },
      all: allA.map((a, i) => row(a, i, a.elo, a.rg, a.rw, a.rl)), week: weekA.map((a, i) => row(a, i, a.season.elo, a.season.g, a.season.w, a.season.l)) };
    // account ids stay private: only used to tell a player where they are on the board
    this.boardCache = { at: now, data, allIds: allA.map(a => a.id), weekIds: weekA.map(a => a.id) };
    return data;
  }
  boardPlace(id) { this.leaderboard(); const c = this.boardCache; return { all: c.allIds.indexOf(id) + 1 || null, week: c.weekIds.indexOf(id) + 1 || null }; }
  rankOf(a) { if (!a.rg || a.test) return null; let r = 1; for (const b of this.acc.values()) if (b.rg > 0 && !b.test && b.elo > a.elo) r++; return r; }
  // accounts made by the automated tests (hello.test) never show on the boards and are deleted after an hour
  pruneTests(maxAgeMs = 3600e3) {
    const now = Date.now(), gone = new Set();
    for (const [id, a] of this.acc) if (a.test && now - (a.created || 0) > maxAgeMs) gone.add(id);
    if (!gone.size) return 0;
    for (const id of gone) { const a = this.acc.get(id); this.fc.delete(a.fc); this.acc.delete(id); }
    for (const m of [this.tok, this.rec]) for (const [k, id] of m) if (gone.has(id)) m.delete(k);
    for (const a of this.acc.values()) for (const f of ['friends', 'reqIn', 'reqOut']) a[f] = a[f].filter(x => !gone.has(x));
    this.boardCache = null; this.touch();
    return gone.size;
  }

  // ---- friends: request, accept, remove
  request(from, to) {
    if (from.id === to.id) return 'That is you.';
    if (from.friends.includes(to.id)) return 'You are already friends.';
    if (to.reqOut.includes(from.id)) { this.accept(from, to); return 'accepted'; }
    if (from.reqOut.includes(to.id)) return 'Request already sent.';
    if (from.friends.length >= MAX_FRIENDS || to.reqIn.length >= MAX_REQS) return 'Friend list is full.';
    from.reqOut.push(to.id); to.reqIn.push(from.id); this.touch();
    return 'sent';
  }
  accept(me, other) {
    const had = me.reqIn.includes(other.id) || other.reqOut.includes(me.id);
    if (!had) return false;
    me.reqIn = me.reqIn.filter(x => x !== other.id); other.reqOut = other.reqOut.filter(x => x !== me.id);
    me.reqOut = me.reqOut.filter(x => x !== other.id); other.reqIn = other.reqIn.filter(x => x !== me.id);
    if (!me.friends.includes(other.id)) me.friends.push(other.id);
    if (!other.friends.includes(me.id)) other.friends.push(me.id);
    this.touch(); return true;
  }
  unlink(me, other) {
    for (const [a, b] of [[me, other], [other, me]]) { a.friends = a.friends.filter(x => x !== b.id); a.reqIn = a.reqIn.filter(x => x !== b.id); a.reqOut = a.reqOut.filter(x => x !== b.id); }
    this.touch();
  }

  touch() { this.dirty = true; if (!this.timer) this.timer = setTimeout(() => this.flush(), 2000); }
  flush() {
    clearTimeout(this.timer); this.timer = null;
    if (!this.dirty) return;
    this.dirty = false;
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ v: 2, accounts: Object.fromEntries(this.acc), tokens: Object.fromEntries(this.tok), recovery: Object.fromEntries(this.rec) }));
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { Accounts, START, REFILL_BELOW, seasonId, seasonEnds };
