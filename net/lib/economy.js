'use strict';
// ECONOMY, server side: entitlements, XP + levels, the monthly ladder, and the one rule that keeps
// the betting product alive. Design and reasoning: ../../docs/ECONOMY.md.
//
// THE FAIRNESS RULE (server-enforced, not a client toggle):
//   `arsenalFor(room)` is the ONLY place that decides whether bought weapons enter a match. It says
//   no to anything staked or ranked, always, and the client's opinion is never consulted. A page can
//   send whatever it likes: the loadout that reaches the fight config comes from this file, from the
//   account's stored loadout, filtered against the account's stored entitlements.
//
// WHY ENTITLEMENTS LIVE IN THEIR OWN FILE, not on the account record:
//   accounts.json is rewritten whole every 2 s (accounts.js flush). Entitlements change rarely and
//   would make that file bigger for no reason, and keeping them separate means this session never
//   has to edit accounts.js while the security session is working in it.
//
// PAYMENTS ARE NOT WIRED. `buy()` goes through a stub provider and is refused unless
//   PAYMENTS=stub is set explicitly. Nothing here takes a card, holds a card number, or touches a
//   payment processor. See "before this can take money" at the bottom of docs/ECONOMY.md and
//   docs/SECURITY-REVIEW.md.
const fs = require('fs');
const path = require('path');
const C = require('./catalog');

const MAX_LOADOUT = 3;
const SLOTS = ['finish', 'aura', 'trail', 'ko', 'pose', 'plate'];
const monthId = (t = Date.now()) => { const d = new Date(t); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0'); };
const monthEnds = (t = Date.now()) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); };
const ELO0 = 1200;

// ---------------------------------------------------------------------------------------------
// SEASON ELIGIBILITY — the anti-farm gate on the payout. See docs/ECONOMY.md §7.
//
// The per-MATCH integrity layer (net/lib/integrity.js, the security session's) already withholds
// Elo from a held match and refuses two seats on one device token in a ranked room. What it cannot
// see is the shape of a whole MONTH: two real people on two real devices, on two real connections,
// playing each other four hundred times and feeding one of them to the top of the ladder is not a
// suspicious match, it is four hundred unsuspicious matches. That is finding 16 in
// dev/NOTES-security.md, and a prize is exactly what makes it worth doing.
//
// So the payout has its own gate, and it is deliberately about the SHAPE of a season, not about
// catching a cheat in the act:
//   MIN_GAMES        a single lucky match cannot take a cash prize
//   MIN_OPPONENTS    the two-account feed loop dies here, and it is the one that matters most:
//                    no amount of grinding against your own alt produces a 5th distinct opponent
//   MAX_PAIR_SHARE   no more than this fraction of your rated games against any ONE opponent, so
//                    "five alts, two hundred games" does not work either
//   MAX_BOT_SCORE    an account the integrity store has been scoring as automated is HELD for
//                    review rather than paid. Held, never denied — the detector is not a court.
//
// Every threshold is an env knob so this can be tuned without a deploy, and every one of them is
// checked again at close time from the server's OWN records. A page cannot influence any of it.
const SEASON = {
  minGames: +process.env.SEASON_MIN_GAMES || 10,
  minGamesBadge: +process.env.SEASON_MIN_GAMES_BADGE || 5,
  minOpponents: +process.env.SEASON_MIN_OPPONENTS || 5,
  maxPairShare: +process.env.SEASON_MAX_PAIR_SHARE || 0.5,
  maxBotScore: +process.env.SEASON_MAX_BOT_SCORE || 50,
  maxOppTracked: 400,
};

class Economy {
  constructor(opts) {
    this.dir = opts.dataDir;
    this.accounts = opts.accounts;
    this.log = opts.log || (() => {});
    this.file = path.join(this.dir, 'economy.json');
    this.mode = String(process.env.PAYMENTS || 'off').toLowerCase();   // 'off' | 'stub'
    this.rows = new Map();     // accountId -> { own:[], equip:{}, loadout:[], xp, credits, rec:{w,l,ko}, month:{} }
    this.dirty = false; this.timer = null; this.boardAt = 0; this.board = null;
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (raw && raw.v === 1) for (const [id, r] of Object.entries(raw.rows || {})) this.rows.set(id, r);
    } catch (e) { /* first run */ }
    this.attach();
  }

  // ---------- storage ----------
  row(id) {
    let r = this.rows.get(id);
    if (!r) { r = { own: [], equip: {}, loadout: [], xp: 0, credits: 0, rec: { w: 0, l: 0, ko: 0 }, month: null, badges: [] }; this.rows.set(id, r); this.touch(); }
    if (!r.rec) r.rec = { w: 0, l: 0, ko: 0 };
    if (!r.badges) r.badges = [];
    return r;
  }
  touch() { this.dirty = true; if (!this.timer) this.timer = setTimeout(() => this.flush(), 3000); }
  flush() {
    clearTimeout(this.timer); this.timer = null;
    if (!this.dirty) return;
    this.dirty = false;
    try {
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ v: 1, rows: Object.fromEntries(this.rows) }));
      fs.renameSync(tmp, this.file);
    } catch (e) { this.log('economy save failed', e.message); }
  }

  // ---------- entitlements ----------
  level(id) { return C.levelFor(this.row(id).xp || 0); }
  // Everything this account may use: what it bought, plus what its level earned. Nothing else,
  // ever. This list is the answer to "does this player own X" for the store, the loadout and the
  // fight config alike.
  owned(id) {
    const r = this.row(id);
    const set = new Set(r.own);
    for (const wid of C.levelGrants(C.levelFor(r.xp || 0))) set.add(wid);
    return [...set];
  }
  owns(id, item) { return this.owned(id).indexOf(item) >= 0; }
  grant(id, items, why) {
    const r = this.row(id);
    let n = 0;
    for (const it of items) {
      if (!C.BY.has(it)) continue;
      const d = C.BY.get(it);
      if (d.type === 'bundle') { n += this.grant(id, d.grants.flatMap(g => (g === 'ALL_WEAPONS' ? C.WEAPON_IDS : [g])), why || 'bundle'); continue; }
      if (r.own.indexOf(it) < 0) { r.own.push(it); n++; }
    }
    if (n) { this.touch(); this.log('economy grant', id, items.join(','), why || ''); }
    return n;
  }

  // ---------- the state a page is allowed to see about ITSELF ----------
  state(acctId) {
    const r = this.row(acctId), lvl = C.levelFor(r.xp || 0), own = this.owned(acctId);
    return {
      k: 'econ', owned: own, equip: this.cleanEquip(r, own), loadout: this.cleanLoadout(r, own),
      xp: r.xp || 0, level: lvl, credits: r.credits || 0, record: r.rec, badges: r.badges,
      season: this.seasonOf(acctId), payments: this.mode,
    };
  }
  cleanEquip(r, own) {
    const out = {};
    for (const s of SLOTS) { const id = r.equip && r.equip[s]; if (id && own.indexOf(id) >= 0) out[s] = id; }
    return out;
  }
  cleanLoadout(r, own) { return (r.loadout || []).filter(id => own.indexOf(id) >= 0 && C.KIND_OF[id]).slice(0, MAX_LOADOUT); }

  // a page asking to change its own equip / loadout. Anything it does not own is dropped silently.
  set(acctId, msg) {
    const r = this.row(acctId), own = this.owned(acctId);
    if (msg && msg.equip && typeof msg.equip === 'object') {
      const e = {};
      for (const s of SLOTS) { const id = msg.equip[s]; if (typeof id === 'string' && own.indexOf(id) >= 0 && C.BY.get(id) && C.BY.get(id).slot === s) e[s] = id; }
      r.equip = e;
    }
    if (Array.isArray(msg.loadout)) {
      r.loadout = msg.loadout.filter(id => typeof id === 'string' && own.indexOf(id) >= 0 && C.KIND_OF[id]).slice(0, MAX_LOADOUT);
    }
    this.touch();
    return this.state(acctId);
  }

  // ---------- purchases: STUB ONLY ----------
  // There is no payment provider here and no card ever touches this process. With PAYMENTS unset
  // every purchase is refused with a reason the page shows the player. With PAYMENTS=stub the item
  // is granted with no money involved, which is for playtests and the automated tests only.
  buy(acctId, msg) {
    const id = msg && msg.id;
    const d = id && C.BY.get(id);
    if (!d || d.price == null) return { k: 'buyres', ok: false, msg: 'That is not for sale.' };
    if (this.owns(acctId, id)) return { k: 'buyres', ok: false, msg: 'You already own it.', owned: this.owned(acctId) };
    if (this.mode !== 'stub') {
      return { k: 'buyres', ok: false, off: true,
        msg: 'The store is not taking payments yet. Weapons unlock by level in the meantime — everything on the $15 shelf is free by level 10.' };
    }
    this.grant(acctId, [id], 'stub-purchase');
    const st = this.state(acctId);
    return Object.assign({ k: 'buyres', ok: true, msg: d.name + ' unlocked.' }, st, { k: 'buyres' });
  }

  // ---------- THE FAIRNESS GATE ----------
  // room -> whether bought weapons may enter this match, and each human's loadout if they may.
  // Called from launch(). A room that stakes anything or is ranked gets `{ on: false }`, full stop.
  arsenalFor(room, players) {
    const staked = !!(room && (room.stake > 0 || room.real));
    const ranked = !!(room && room.ranked);
    if (staked || ranked || !room || room.items === false) return { on: false, why: staked ? 'wagered' : ranked ? 'ranked' : 'items off' };
    const loadouts = players.map(p => {
      if (!p || !p.human || !p.th) return [];
      const a = this.accounts.get(p.th);
      if (!a) return [];
      const ids = this.cleanLoadout(this.row(a.id), this.owned(a.id));
      return ids.map(id => C.KIND_OF[id]).filter(Boolean);
    });
    return { on: loadouts.some(l => l.length > 0), loadouts, why: 'casual' };
  }

  // ---------- XP, record, the monthly ladder ----------
  // Fed from the server's OWN copy of the fight, never from a page. A page cannot report a win,
  // cannot report damage, and therefore cannot buy or farm a level.
  matchDone(M, info) {
    const { payee, stats, cancelled, ranked, held } = info;
    const out = {};
    if (cancelled) return out;
    for (const s of M.slots) {
      if (!s.human || !s.th) continue;
      const a = this.accounts.get(s.th);
      if (!a || a.test) continue;
      const r = this.row(a.id), won = s.i === payee;
      const st = (stats && stats[s.i]) || {};
      const before = C.levelFor(r.xp || 0);
      // a player who dropped out gets the participation XP and nothing else
      const gain = s.dropped || s.left ? Math.round(C.CAT.xp.match * 0.4) : C.matchXp(st, won);
      r.xp = (r.xp || 0) + gain;
      r.rec.w += won ? 1 : 0; r.rec.l += won ? 0 : 1; r.rec.ko += st.kos || 0;
      const after = C.levelFor(r.xp);
      out[s.i] = { xp: gain, total: r.xp, level: after, levelled: after > before,
        unlocked: after > before ? C.CAT.weapons.filter(w => w.unlock != null && w.unlock > before && w.unlock <= after).map(w => w.id) : [] };
      if (after > before) this.log('economy level', a.id, before, '->', after);
    }
    // the monthly ladder only counts ranked 1v1s the server itself judged, and never a held match
    if (ranked && !held && payee >= 0) {
      const w = M.slots[payee], l = M.slots.find(x => x.human && x.i !== payee);
      if (w && l && w.th && l.th) this.rateMonth(w.th, l.th);
    }
    this.touch();
    return out;
  }
  month(a) {
    const id = monthId();
    if (!a.month || a.month.id !== id) a.month = { id, elo: ELO0, g: 0, w: 0, l: 0, peak: ELO0 };
    if (a.month.peak == null) a.month.peak = a.month.elo;
    return a.month;
  }
  // who this account has actually PLAYED this month, and how often. Kept in economy.json rather
  // than on the account record because accounts.json is rewritten whole every 2 s, and this map is
  // the one piece of season state that grows with activity.
  oppMap(acctId, id) {
    const r = this.row(acctId);
    if (!r.mopp || r.mopp.id !== id) r.mopp = { id, opp: {} };
    return r.mopp.opp;
  }
  noteOpponent(aId, bId, id) {
    const m = this.oppMap(aId, id);
    m[bId] = (m[bId] || 0) + 1;
    const keys = Object.keys(m);
    if (keys.length > SEASON.maxOppTracked) delete m[keys[0]];
  }
  rateMonth(wTh, lTh) {
    const w = this.accounts.get(wTh), l = this.accounts.get(lTh);
    if (!w || !l || w.id === l.id) return null;
    const mw = this.month(w), ml = this.month(l);
    this.noteOpponent(w.id, l.id, mw.id);
    this.noteOpponent(l.id, w.id, ml.id);
    const E = 1 / (1 + Math.pow(10, (ml.elo - mw.elo) / 400));
    const d = Math.round(32 * (1 - E));
    mw.elo += d; ml.elo -= d; mw.g++; ml.g++; mw.w++; ml.l++;
    // PEAK, not final. Valorant's Act Rank badge is built from your best wins of the act and the
    // single highest one sets the border — you never have to HOLD the rank, so the badge rewards
    // your best night and can never be lost on a bad one. Copying that: the season badge is issued
    // from the peak rating, while the leaderboard and the prizes use the live one.
    if (mw.elo > mw.peak) mw.peak = mw.elo;
    this.board = null;
    return d;
  }
  // the tier a rating earns a permanent badge for. Peak-based, so it can never be taken away.
  tierOf(elo) {
    if (elo >= 1700) return { id: 'apex', name: 'Apex', icon: '👑', color: '#ffc83a' };
    if (elo >= 1550) return { id: 'elite', name: 'Elite', icon: '💠', color: '#27e1ff' };
    if (elo >= 1400) return { id: 'contender', name: 'Contender', icon: '🔺', color: '#ff6a3d' };
    if (elo >= 1250) return { id: 'challenger', name: 'Challenger', icon: '🔸', color: '#9398a8' };
    return null;
  }
  // The monthly board, computed from the accounts the server rated itself. Top 10 take the prizes.
  monthly(limit = 100) {
    const now = Date.now();
    if (this.board && now - this.boardAt < 15000) return this.board;
    const id = monthId(), rows = [];
    for (const a of this.accounts.acc.values()) {
      if (a.test && !this.accounts.showTests) continue;
      if (!a.month || a.month.id !== id || !a.month.g) continue;
      rows.push(a);
    }
    rows.sort((x, y) => y.month.elo - x.month.elo || y.month.w - x.month.w);
    const out = rows.slice(0, limit).map((a, i) => ({
      rank: i + 1, name: a.name || 'Player', x: (a.look && a.look.x) || null,
      elo: a.month.elo, games: a.month.g, wins: a.month.w, losses: a.month.l,
      main: a.main || null, look: a.look ? a.look.base : null,
      plate: (this.rows.get(a.id) && this.rows.get(a.id).equip && this.rows.get(a.id).equip.plate) || null,
      level: C.levelFor((this.rows.get(a.id) || {}).xp || 0),
    }));
    this.board = { id, ends: new Date(monthEnds(now)).toISOString(), rows: out, prizes: C.CAT.season.prizes };
    this.boardIds = rows.slice(0, limit).map(a => a.id);
    this.boardAt = now;
    return this.board;
  }
  seasonOf(acctId) {
    const b = this.monthly(100);
    const a = this.accounts.byId(acctId);
    const m = a && a.month && a.month.id === b.id ? a.month : null;
    const rank = this.boardIds ? this.boardIds.indexOf(acctId) + 1 : 0;
    // Tell the player where they stand against the payout rules WHILE the season is running.
    // Two reasons, and the second is the important one: it is a straightforward retention nudge
    // ("three more opponents"), and it means nobody finds out on the 1st that the month did not
    // count. A rule you only learn about when it costs you is indistinguishable from a scam.
    const el = a ? this.seasonEligible(a, b.id) : null;
    return { id: b.id, ends: b.ends, elo: m ? m.elo : null, peak: m ? m.peak : null, games: m ? m.g : 0,
      rank: rank || null, tier: m ? this.tierOf(m.peak) : null,
      eligible: el ? el.ok : false, why: el ? el.why : 'no rated games this season',
      need: { games: SEASON.minGames, opponents: SEASON.minOpponents, maxPairShare: SEASON.maxPairShare },
      have: el && el.shape ? el.shape : { games: 0, opponents: 0, topPairShare: 0 } };
  }

  // ---------- can this account be PAID for this season? (docs/ECONOMY.md §7) ----------
  // `bot(acctId)` is an optional lookup into net/lib/integrity.js's store, passed in by the close
  // tool so this file never has to know that module exists. It returns the account's slow-moving
  // automation reputation; a high one holds the prize instead of paying it.
  seasonEligible(a, id, bot) {
    const m = a && a.month;
    if (!m || m.id !== id || !m.g) return { ok: false, badge: false, why: 'no rated games this season' };
    const opp = (this.row(a.id).mopp && this.row(a.id).mopp.id === id) ? this.row(a.id).mopp.opp : {};
    const names = Object.keys(opp);
    const top = names.length ? Math.max(...names.map(k => opp[k])) : m.g;
    const share = m.g ? top / m.g : 1;
    const shape = { games: m.g, opponents: names.length, topPairShare: +share.toFixed(3) };
    // the shape rules, hardest-hitting first
    if (names.length < SEASON.minOpponents)
      return { ok: false, badge: false, why: `${names.length} distinct opponent(s), ${SEASON.minOpponents} needed`, shape };
    if (share > SEASON.maxPairShare)
      return { ok: false, badge: false, why: `${Math.round(share * 100)}% of rated games against one opponent (max ${Math.round(SEASON.maxPairShare * 100)}%)`, shape };
    // the automation reputation, if the caller gave us one
    const b = bot ? bot(a.id) : null;
    if (b && b.matches >= 5 && b.score >= SEASON.maxBotScore)
      return { ok: false, badge: false, hold: true, why: `automation score ${b.score}/100 over ${b.matches} matches — held for review, not denied`, shape };
    // volume. The badge bar is lower than the money bar on purpose: a badge is the reason a
    // non-paying player comes back, and a real player clears 5 games against 5 people easily.
    if (m.g < SEASON.minGamesBadge)
      return { ok: false, badge: false, why: `${m.g} rated games, ${SEASON.minGamesBadge} needed for a badge`, shape };
    if (m.g < SEASON.minGames)
      return { ok: false, badge: true, why: `${m.g} rated games, ${SEASON.minGames} needed for a prize`, shape };
    return { ok: true, badge: true, why: 'eligible', shape };
  }

  // ---------- season rollover: pay the prizes, archive the standings, start clean ----------
  // Run daily from a schedule (`node net/tools/season-close.js --auto`). Idempotent: a season that
  // has already paid out is skipped, so a cron that double-fires — or one that missed the 1st and
  // fires on the 4th — costs nothing and loses nothing.
  //
  // The next season needs no action: `month()` stamps a fresh record the first time an account is
  // rated under a new month id, so a player who never comes back leaves nothing behind.
  closeSeason(id, opts) {
    const bot = opts && opts.bot;
    const dry = !!(opts && opts.dry);
    const done = this.rows.get('__seasons') || (this.rows.set('__seasons', { own: [], paid: [] }), this.rows.get('__seasons'));
    done.paid = done.paid || [];
    if (done.paid.indexOf(id) >= 0) return { ok: false, msg: 'already paid', season: id };
    const rows = [];
    for (const a of this.accounts.acc.values()) if (!a.test && a.month && a.month.id === id && a.month.g > 0) rows.push(a);
    rows.sort((x, y) => y.month.elo - x.month.elo || y.month.w - x.month.w);

    // The board is everybody who played. The PRIZE ranking only counts the eligible, so somebody
    // who farmed their way to #1 does not also push a legitimate player out of the top 10.
    const table = rows.map((a, i) => {
      const el = this.seasonEligible(a, id, bot);
      return { id: a.id, name: a.name || 'Player', boardRank: i + 1, elo: a.month.elo, peak: a.month.peak || a.month.elo,
        games: a.month.g, wins: a.month.w, losses: a.month.l, eligible: el.ok, badgeOk: el.badge, hold: !!el.hold,
        why: el.why, shape: el.shape || null, acct: a };
    });
    const paid = [], held = [], skipped = [];
    // Peak-based badges first: EVERY eligible rated player keeps the tier they reached, even if
    // they slid back before the month closed. Losing a badge you already earned is how a ladder
    // stops being fun; Valorant works this way and it is the right call.
    for (const t of table) {
      if (!t.badgeOk) continue;
      const tier = this.tierOf(t.peak);
      if (!tier) continue;
      t.tier = tier.id;
      if (dry) continue;
      const r = this.row(t.id);
      const bid = 'tier:' + id + ':' + tier.id;
      if (!r.badges.some(b => b.id === bid)) r.badges.push({ id: bid, icon: tier.icon, name: tier.name + ' · ' + id });
    }
    let rank = 0;
    for (const t of table) {
      if (!t.eligible) {
        (t.hold ? held : skipped).push({ id: t.id, name: t.name, boardRank: t.boardRank, why: t.why, shape: t.shape });
        continue;
      }
      rank++;
      t.prizeRank = rank;
      const p = C.CAT.season.prizes.find(q => rank <= q.rank);
      if (!p) continue;
      const credits = rank === 1 ? 10000 : rank === 2 ? 6000 : rank === 3 ? 4000 : rank <= 10 ? 2000 : 500;
      t.credits = credits; t.plate = p.plate || null; t.title = p.title;
      if (dry) { paid.push({ id: t.id, name: t.name, rank, credits, plate: p.plate }); continue; }
      const r = this.row(t.id);
      if (p.plate) this.grant(t.id, [p.plate], 'season ' + id);
      r.credits = (r.credits || 0) + credits;
      r.badges.push({ id: 'season:' + id + ':' + rank, icon: rank === 1 ? '👑' : rank <= 10 ? '🔟' : '🏅', name: p.title + ' · ' + id });
      paid.push({ id: t.id, name: t.name, rank, credits, plate: p.plate });
    }
    const archive = {
      v: 1, season: id, closedAt: new Date().toISOString(), dry,
      rules: { minGames: SEASON.minGames, minGamesBadge: SEASON.minGamesBadge, minOpponents: SEASON.minOpponents,
        maxPairShare: SEASON.maxPairShare, maxBotScore: SEASON.maxBotScore },
      players: rows.length, paid: paid.length, held: held.length, skipped: skipped.length,
      standings: table.map(t => ({ boardRank: t.boardRank, prizeRank: t.prizeRank || null, id: t.id, name: t.name,
        elo: t.elo, peak: t.peak, games: t.games, wins: t.wins, losses: t.losses, tier: t.tier || null,
        eligible: t.eligible, hold: t.hold, why: t.why, shape: t.shape, credits: t.credits || 0, plate: t.plate || null })),
      heldForReview: held,
    };
    if (dry) return { ok: true, dry: true, season: id, paid, held, skipped, archive };
    this.archiveSeason(id, archive);
    done.paid.push(id);
    this.touch(); this.flush();
    this.log('season', id, 'closed:', paid.length, 'paid,', held.length, 'held,', skipped.length, 'not eligible');
    return { ok: true, season: id, paid, held, skipped, archive };
  }
  // The standings as they were at close, on disk, forever. A payout with no audit trail is a
  // payout you cannot defend when somebody asks why they did not get paid.
  archiveSeason(id, archive) {
    try {
      const dir = path.join(this.dir, 'seasons');
      fs.mkdirSync(dir, { recursive: true });
      const f = path.join(dir, id + '.json');
      fs.writeFileSync(f + '.tmp', JSON.stringify(archive, null, 1));
      fs.renameSync(f + '.tmp', f);
      this.log('season', id, 'archived ->', f);
      return f;
    } catch (e) { this.log('season archive failed', id, e.message); return null; }
  }
  // every month that has ended and has not been paid yet, oldest first
  unpaidSeasons(now = Date.now()) {
    const done = this.rows.get('__seasons');
    const paid = new Set((done && done.paid) || []);
    const cur = monthId(now), out = new Set();
    for (const a of this.accounts.acc.values()) {
      if (a.test || !a.month || !a.month.g) continue;
      if (a.month.id >= cur || paid.has(a.month.id)) continue;
      out.add(a.month.id);
    }
    return [...out].sort();
  }

  // ---------- wiring ----------
  // The public leaderboard route spreads whatever accounts.leaderboard() returns, so adding the
  // monthly board here makes `GET /api/leaderboard` carry it with no route change.
  attach() {
    if (!this.accounts || this.accounts.__econ) return;
    this.accounts.__econ = this;
    const base = this.accounts.leaderboard.bind(this.accounts);
    const self = this;
    this.accounts.leaderboard = function (limit) {
      const d = base(limit);
      try { const m = self.monthly(limit || 100); d.month = m.rows; d.monthSeason = { id: m.id, ends: m.ends, prizes: m.prizes }; }
      catch (e) { self.log('monthly board failed', e.message); }
      return d;
    };
  }

  // one place for the three client messages this session owns. Returns true when it handled one.
  handle(c, msg, api) {
    if (!c || !c.acct) return false;
    if (msg.k === 'econ') { api.sendTo(c, this.state(c.acct)); return true; }
    if (msg.k === 'econset') { api.sendTo(c, this.set(c.acct, msg)); return true; }
    if (msg.k === 'buy') { api.sendTo(c, this.buy(c.acct, msg)); return true; }
    return false;
  }
}

module.exports = { Economy, monthId, monthEnds, MAX_LOADOUT, SLOTS, SEASON };
