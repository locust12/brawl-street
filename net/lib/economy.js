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
// PAYMENTS. Nothing here takes a card, holds a card number or touches a payment processor, in any
//   mode. `buy()` is refused outright unless PAYMENTS is set; PAYMENTS=stub grants with no money
//   (playtests and tests); PAYMENTS=chain sends the page to the crypto checkout in lib/pay.js,
//   which takes ETH, USDC, USDT or WOLVERINU to a receive-only treasury address and verifies the
//   transaction on-chain here before `deliver()` grants anything. No key for any wallet is on this
//   server and this server never signs a transaction. See docs/PAYMENTS.md and docs/ECONOMY.md.
const fs = require('fs');
const path = require('path');
const C = require('./catalog');

const MAX_LOADOUT = 3;
const SLOTS = ['finish', 'aura', 'trail', 'ko', 'pose', 'plate', 'taunt', 'title'];
// Ten of one grade become one of the grade above, the way CS2's trade-up contract works. It is the
// sink that stops a market's floor collapsing under duplicates.
const TRADE_NEED = 10;
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
    this.mode = String(process.env.PAYMENTS || 'off').toLowerCase();   // 'off' | 'stub' | 'chain'
    this.rows = new Map();     // accountId -> { own:[], equip:{}, loadout:[], xp, credits, rec:{w,l,ko}, month:{} }
    this.dirty = false; this.timer = null; this.boardAt = 0; this.board = null;
    // How many of each gear item have ever been handed out, which is what a serial MEANS. It was
    // held in memory only (`this.mint = this.mint || {}` inside openCase), so every restart reset
    // every serial to 1 and the hundredth Visor and the first would both be stamped #1. A number
    // that is supposed to be unique has to outlive the process that issues it.
    this.mint = {};
    // The public verdict on every item: id -> { fire, love, meh, yuck, poo }. fortnite.gg puts this
    // bar under every card and it does two jobs at once — it moderates the catalogue in public, and
    // it tells us what to build next. Counts are global, so they live here and not on an account.
    this.react = {};
    // How many matches each gear item has been WORN for, which is fortnite.gg's Most Used page.
    // It is the visibility rule made measurable, and the best advert the top items could have.
    this.worn = {};
    this.matches = 0;
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (raw && raw.v === 1) for (const [id, r] of Object.entries(raw.rows || {})) this.rows.set(id, r);
      if (raw && raw.mint && typeof raw.mint === 'object') this.mint = raw.mint;
      if (raw && raw.react && typeof raw.react === 'object') this.react = raw.react;
      if (raw && raw.worn && typeof raw.worn === 'object') this.worn = raw.worn;
      if (raw && raw.matches) this.matches = raw.matches | 0;
    } catch (e) { /* first run */ }
    this.attach();
  }

  // ---------- storage ----------
  row(id) {
    let r = this.rows.get(id);
    if (!r) { r = { own: [], equip: {}, loadout: [], xp: 0, credits: 0, rec: { w: 0, l: 0, ko: 0 }, month: null, badges: [],
                   inv: [], crates: 0, keys: 0, played: 0, nextUid: 1, wear: {} }; this.rows.set(id, r); this.touch(); }
    // rows written before the locker shipped have none of its fields
    if (!r.inv) { r.inv = []; r.crates = r.crates || 0; r.keys = r.keys || 0; r.played = r.played || 0; r.nextUid = r.nextUid || 1; r.wear = r.wear || {}; }
    // rows written before the market layer have neither of these
    if (!r.skins) r.skins = {};
    if (r.arenaCrates == null) r.arenaCrates = 0;
    if (!r.mine) r.mine = {};
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
      fs.writeFileSync(tmp, JSON.stringify({ v: 1, rows: Object.fromEntries(this.rows), mint: this.mint || {},
        react: this.react || {}, worn: this.worn || {}, matches: this.matches || 0 }));
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
  // ---- signing in with X carries the purchases over --------------------------------------------
  // A player can buy something on this device, THEN connect an X account that already has a row
  // (bought on their laptop, say). Pointing the device at the older account without this would hide
  // what they just paid for, which is the exact failure the X sign-in exists to prevent.
  //
  // Entitlements, keys, crates and worn instances move; XP, Elo, the record and the badges DO NOT.
  // Those are earned, and merging them is how a fresh account becomes a laundry for a rating.
  mergeInto(from, to) {
    if (!from || !to || from === to || !this.rows.has(from)) return 0;
    const a = this.row(from), b = this.row(to);
    let n = 0;
    for (const it of a.own) if (b.own.indexOf(it) < 0) { b.own.push(it); n++; }
    if (a.keys) { b.keys = (b.keys || 0) + a.keys; n++; }
    if (a.crates) { b.crates = (b.crates || 0) + a.crates; n++; }
    // instances carry their own uid, which is per row, so they are renumbered on the way in
    for (const inst of (a.inv || [])) { const uid = b.nextUid++; b.inv.push(Object.assign({}, inst, { uid })); n++; }
    if (n) { this.touch(); this.log('economy merged', from, '->', to, n + ' things'); }
    // the emptied row is left in place rather than deleted: it still holds that account's XP and
    // record, and the account itself is untouched by the device token moving.
    a.own = []; a.keys = 0; a.crates = 0; a.inv = []; a.wear = {};
    return n;
  }
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

  // ---------- the locker: crates, and what comes out of them ----------
  // The server owns every roll. A client that could roll its own Unusual would be a client that
  // owns a $400 hat for free, so the page only ever asks and renders the answer.
  lk() { return C.CAT.locker; }

  // A crate every `every` matches, capped. Free, earned by playing, never sold: this is the half of
  // Team Fortress 2's model that makes the other half acceptable.
  // `arena` is true when the match it was earned in was ranked or staked. A crate earned that way is
  // tracked separately and opens into an ARENA EDITION item: Counter-Strike's Souvenir, which only
  // drops from a live tournament match and is stamped with it. Souvenir Bloodsport Factory New sells
  // for MORE than the StatTrak version, on nothing but where it came from. Supply control for free:
  // we decide how many matches are stamped.
  earnCrate(r, arena) {
    const L = this.lk(); if (!L) return 0;
    r.played = (r.played || 0) + 1;
    if (r.played % L.crate.every !== 0) return 0;
    if ((r.crates || 0) >= L.crate.cap) return 0;
    r.crates = (r.crates || 0) + 1;
    if (arena) r.arenaCrates = (r.arenaCrates || 0) + 1;
    return 1;
  }

  // which of the five condition bands a float lands in. The bands live in the catalogue so the
  // client, the server and the tests all read the same table.
  static condOf(L, f) {
    const CS = (C.CAT.conditions || []);
    for (const c of CS) if (f < c.hi) return c.id;
    return CS.length ? CS[CS.length - 1].id : null;
  }

  // Weighted pick over a list of {w} (or {p}), with a float in [0,1).
  static pick(list, roll, key) {
    let total = 0; for (const x of list) total += (key ? x[key] : x.w) || 0;
    let n = roll * total;
    for (const x of list) { n -= (key ? x[key] : x.w) || 0; if (n <= 0) return x; }
    return list[list.length - 1];
  }

  // Open one crate. Keys were removed 15 Oct on Duane's call: a crate is earned by playing and
  // opens on its own, so nothing in the locker is paywalled.
  // Returns the instance that came out, or an error the page can show.
  openCase(acctId, rnd) {
    const L = this.lk(); if (!L) return { ok: false, msg: 'Locker is not configured.' };
    const r = this.row(acctId);
    if ((r.crates || 0) < 1) return { ok: false, msg: 'No crates. Play a few matches.' };
    const R = typeof rnd === 'function' ? rnd : Math.random;

    const tier = Economy.pick(L.odds, R(), 'p').tier;
    const pool = L.gear.filter(g => g.tier === tier);
    if (!pool.length) return { ok: false, msg: 'Nothing in that tier.' };
    const item = pool[Math.floor(R() * pool.length) % pool.length];

    // The Unusual roll. Orthogonal to the tier: it does not change WHICH item came out, only
    // whether it is on fire. This one line is the whole reason a common hat can be worth anything.
    let unusual = null;
    if (R() < L.unusualChance) unusual = Economy.pick(L.unusuals, R()).id;

    // Serial: how many of this exact item the server has ever handed out. Top Shot and Sorare both
    // put this on the face of the card, and it costs nothing to keep.
    // loaded from economy.json in the constructor and flushed with it, so a serial survives a deploy
    const serial = (this.mint[item.id] = (this.mint[item.id] || 0) + 1);

    // CONDITION, 2026-10-16. Every copy carries a float rolled once at mint time and never changed,
    // and the float decides which of the five bands it is in. Three uniforms averaged give a bell,
    // raised to 2.2 to pull it down the scale: that lands ~10% Mint, ~21% Clean, ~51% Scuffed and
    // the rest below — the same shape as CS2, where Field-Tested is by far the commonest exterior
    // and Factory New is the one people actually pay for. Measured, not guessed: `dev/cond_test.js`.
    const float = Math.min(0.999, Math.max(0, Math.pow((R() + R() + R()) / 3, 2.2)));
    const cond = Economy.condOf(L, float);

    // THE COUNTER IS A VARIANT, NOT A FEATURE. In CS2 the same gun with a kill counter costs 2.3x
    // more ($134 vs $310 on Bloodsport). Ours used to put a KO counter on every single piece, which
    // makes the number worth nothing: if everyone has one, nobody wants one. It is a 1-in-10 roll
    // now, orthogonal to the grade, exactly like the Unusual.
    const counter = R() < 0.1;
    // ARENA EDITION: spends an arena crate first if one is held, and stamps the item with it.
    const arena = (r.arenaCrates || 0) > 0;
    if (arena) r.arenaCrates--;

    const inst = { uid: r.nextUid++, id: item.id, slot: item.slot, tier,
                   unusual, ko: 0, serial, at: Date.now(), float: +float.toFixed(4), cond, plus: 0,
                   counter, series: arena ? 'arena' : null };
    r.inv.push(inst);
    r.crates--;
    this.touch();
    this.log('locker open', acctId, item.id, tier, unusual || '-', '#' + serial);
    return { ok: true, inst, item, crates: r.crates };
  }

  // What the fighter is wearing, per slot, as instance uids. An unowned uid is dropped rather than
  // trusted, which is the same rule cleanEquip already applies to cosmetics.
  cleanWear(r) {
    const out = {}, L = this.lk(); if (!L) return out;
    const own = new Map(r.inv.map(i => [i.uid, i]));
    for (const sl of L.slots) {
      const uid = r.wear && r.wear[sl.id];
      if (uid && own.has(uid) && own.get(uid).slot === sl.id) out[sl.id] = uid;
    }
    return out;
  }
  setWear(acctId, slot, uid) {
    const r = this.row(acctId), L = this.lk();
    if (!L || !L.slots.some(s => s.id === slot)) return { ok: false, msg: 'No such slot.' };
    r.wear = r.wear || {};
    if (uid == null) delete r.wear[slot];
    else {
      const inst = r.inv.find(i => i.uid === uid);
      if (!inst || inst.slot !== slot) return { ok: false, msg: 'You do not own that.' };
      r.wear[slot] = uid;
    }
    this.touch();
    return { ok: true, wear: this.cleanWear(r) };
  }

  // The counter. TF2 calls it Strange, CS2 calls it StatTrak: a number welded to YOUR copy that
  // nobody else's has. Only what you were actually wearing scores, so the number means something.
  addKos(acctId, n) {
    if (!(n > 0)) return 0;
    const r = this.row(acctId), worn = this.cleanWear(r);
    let hit = 0;
    for (const uid of Object.values(worn)) {
      const inst = r.inv.find(i => i.uid === uid);
      // only a COUNTER copy scores. A number everybody's item carries is a number nobody wants.
      if (inst && inst.counter) { inst.ko = (inst.ko || 0) + n; hit++; }
    }
    if (hit) this.touch();
    return hit;
  }

  // Mint one instance of a named piece. The shop uses it with `clean`, which is the whole reason a
  // bought piece is worth less on a market than a pulled one: no Unusual, no counter, Mint float.
  mintGear(acctId, id, opts) {
    const L = this.lk(); if (!L) return { ok: false, msg: 'Locker is not configured.' };
    const item = L.gear.find(g => g.id === id);
    if (!item) return { ok: false, msg: 'No such item.' };
    const r = this.row(acctId);
    const clean = !!(opts && opts.clean);
    const R = Math.random;
    const float = clean ? 0.01 + R() * 0.05 : Math.pow((R() + R() + R()) / 3, 2.2);
    const serial = (this.mint[item.id] = (this.mint[item.id] || 0) + 1);
    const inst = { uid: r.nextUid++, id: item.id, slot: item.slot, tier: item.tier,
                   unusual: clean ? null : (R() < L.unusualChance ? Economy.pick(L.unusuals, R()).id : null),
                   ko: 0, serial, at: Date.now(), float: +float.toFixed(4),
                   cond: Economy.condOf(L, float), plus: 0,
                   counter: clean ? false : R() < 0.1, series: null, bought: clean || undefined };
    r.inv.push(inst);
    this.touch();
    this.log('gear minted', acctId, item.id, '#' + serial, clean ? 'bought' : 'granted');
    return { ok: true, inst };
  }

  // ---------- THE TRADE-UP CONTRACT ----------
  // Ten of one grade go in, one of the grade above comes out. Only copies that are NOT being worn
  // are eligible, so a trade-up can never eat the thing on your fighter, and the server picks which
  // ten so a page cannot hand-pick its best floats to burn and keep the worst.
  //
  // The output carries `plus`: the enhancement stamp. It is fed by the duplicates that were spent
  // and it rides on the thumbnail and in front of the name. It is a TROPHY and never a stat — no
  // number a hitbox can see is allowed anywhere near it.
  tradeUp(acctId, tier, rnd) {
    const L = this.lk(); if (!L) return { ok: false, msg: 'Locker is not configured.' };
    const order = L.odds.map(o => o.tier);
    const i = order.indexOf(tier);
    if (i < 0) return { ok: false, msg: 'No such grade.' };
    if (i >= order.length - 1) return { ok: false, msg: 'Nothing trades up from the top grade.' };
    const up = order[i + 1];
    const r = this.row(acctId), worn = new Set(Object.values(this.cleanWear(r)));
    const pool = r.inv.filter(x => x.tier === tier && !worn.has(x.uid));
    if (pool.length < TRADE_NEED) return { ok: false, msg: TRADE_NEED + ' spare copies of that grade are needed. You have ' + pool.length + '.' };
    const R = typeof rnd === 'function' ? rnd : Math.random;
    // oldest first, so the ten that go in are the ten that have been sitting there longest
    pool.sort((a, b) => (a.at || 0) - (b.at || 0));
    const spend = pool.slice(0, TRADE_NEED);
    const spendUids = new Set(spend.map(x => x.uid));
    const gear = L.gear.filter(g => g.tier === up);
    if (!gear.length) return { ok: false, msg: 'Nothing in that grade yet.' };
    const item = gear[Math.floor(R() * gear.length) % gear.length];
    // The new copy's float is the AVERAGE of what went in, which is CS2's actual rule and the whole
    // reason people hunt low-float commons to feed a contract.
    const avg = spend.reduce((a, x) => a + (typeof x.float === 'number' ? x.float : 0.37), 0) / spend.length;
    const float = Math.min(0.999, Math.max(0, avg));
    let unusual = null;
    if (R() < L.unusualChance) unusual = Economy.pick(L.unusuals, R()).id;
    const serial = (this.mint[item.id] = (this.mint[item.id] || 0) + 1);
    const plus = 1 + Math.max(0, ...spend.map(x => x.plus || 0));
    const inst = { uid: r.nextUid++, id: item.id, slot: item.slot, tier: up, unusual, ko: 0, serial,
                   at: Date.now(), float: +float.toFixed(4), cond: Economy.condOf(L, float), plus,
                   // a contract keeps the counter if ANY copy that went in had one, which is the
                   // only reason to feed it a counter copy rather than sell that one on
                   counter: spend.some(x => x.counter), series: spend.some(x => x.series === 'arena') ? 'arena' : null };
    r.inv = r.inv.filter(x => !spendUids.has(x.uid));
    r.inv.push(inst);
    this.touch();
    this.log('trade-up', acctId, tier, '->', up, item.id, '+' + plus);
    return { ok: true, inst, spent: TRADE_NEED, inv: r.inv, mint: this.mint };
  }

  // ---------- the reaction bar ----------
  // One reaction per account per item, changeable, so the counts cannot be farmed by one person
  // pressing fire two thousand times. The account's own choice is stored on its row so the bar can
  // show it back on another device.
  setReaction(acctId, id, kind) {
    if (!id || !C.BY.has(id)) return { ok: false, msg: 'No such item.' };
    const kinds = (C.CAT.shop && C.CAT.shop.reactions || []).map(x => x.id);
    if (kind != null && kinds.indexOf(kind) < 0) return { ok: false, msg: 'No such reaction.' };
    const r = this.row(acctId);
    r.mine = r.mine || {};
    const was = r.mine[id] || null;
    const row = this.react[id] = this.react[id] || {};
    if (was) row[was] = Math.max(0, (row[was] || 1) - 1);
    if (kind && kind !== was) { row[kind] = (row[kind] || 0) + 1; r.mine[id] = kind; }
    else delete r.mine[id];
    this.touch();
    return { ok: true, react: this.react, mine: r.mine };
  }

  // ---------- most worn ----------
  // Counted from what was actually ON a fighter in a finished match, never from what is owned.
  // Owning a thing nobody sees is exactly the case this number exists to tell apart.
  noteWorn(acctId) {
    const r = this.row(acctId), worn = this.cleanWear(r);
    const seen = new Set();
    for (const uid of Object.values(worn)) {
      const inst = r.inv.find(i => i.uid === uid);
      if (inst && !seen.has(inst.id)) { this.worn[inst.id] = (this.worn[inst.id] || 0) + 1; seen.add(inst.id); }
    }
    this.matches = (this.matches || 0) + 1;
  }
  // the ranking a page draws: rank, item, share of matches, matches seen
  mostWorn(limit = 100) {
    const tot = Math.max(1, this.matches || 0);
    return Object.keys(this.worn)
      .map(id => ({ id, n: this.worn[id], pct: +(this.worn[id] / tot * 100).toFixed(2) }))
      .sort((a, b) => b.n - a.n)
      .slice(0, limit)
      .map((x, i) => Object.assign({ rank: i + 1 }, x));
  }

  // ---------- the state a page is allowed to see about ITSELF ----------
  state(acctId) {
    const r = this.row(acctId), lvl = C.levelFor(r.xp || 0), own = this.owned(acctId);
    return {
      k: 'econ', owned: own, equip: this.cleanEquip(r, own), loadout: this.cleanLoadout(r, own),
      xp: r.xp || 0, level: lvl, credits: r.credits || 0, record: r.rec, badges: r.badges,
      season: this.seasonOf(acctId), payments: this.mode,
      inv: r.inv || [], crates: r.crates || 0, wear: this.cleanWear(r), mint: this.mint || {},
      // the market layer
      skins: this.cleanSkins(r, own), react: this.react || {}, mine: r.mine || {},
      worn: this.mostWorn(60), matches: this.matches || 0,
    };
  }
  // a finish is equipped PER WEAPON, so this is a map of weapon id -> finish id. A finish the
  // account does not own, or one that belongs to a different weapon, is dropped rather than trusted.
  cleanSkins(r, own) {
    const out = {};
    for (const [wid, id] of Object.entries(r.skins || {})) {
      const d = C.BY.get(id);
      if (d && d.type === 'skin' && d.weapon === wid && own.indexOf(id) >= 0) out[wid] = id;
    }
    return out;
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
    if (msg && msg.skins && typeof msg.skins === 'object') {
      const s = {};
      for (const [wid, id] of Object.entries(msg.skins)) {
        const d = typeof id === 'string' && C.BY.get(id);
        if (d && d.type === 'skin' && d.weapon === wid && own.indexOf(id) >= 0) s[wid] = id;
      }
      r.skins = s;
    }
    this.touch();
    return this.state(acctId);
  }

  // ---------- purchases ----------
  // Three modes, and the mode is the whole of the policy:
  //   PAYMENTS unset   every purchase is refused with a reason the page shows the player
  //   PAYMENTS=stub    the item is granted with no money involved — playtests and tests only
  //   PAYMENTS=chain   the page is sent to the CRYPTO CHECKOUT (lib/pay.js): ETH, USDC, USDT or
  //                    WOLVERINU, verified on-chain by this server before anything is granted
  // No card ever touches this process in any of them.
  buy(acctId, msg) {
    const id = msg && msg.id;
    const d = id && C.BY.get(id);
    if (!d || d.price == null) return { k: 'buyres', ok: false, msg: 'That is not for sale.' };
    const dd = C.BY.get(id);
    if (dd && dd.type !== 'consumable' && this.owns(acctId, id)) return { k: 'buyres', ok: false, msg: 'You already own it.', owned: this.owned(acctId) };
    if (this.mode === 'chain') {
      const p = this.pay();
      if (!p || !p.enabled()) return { k: 'buyres', ok: false, off: true, msg: 'The store is not taking payments yet.' };
      // Nothing is granted here. The page opens the checkout on this item and comes back with a
      // transaction hash; `payclaim` is the only route from a payment to an entitlement.
      return { k: 'buyres', ok: false, checkout: { id, name: d.name, cents: d.price, type: d.type },
        msg: 'Choose how to pay for ' + d.name + '.' };
    }
    if (this.mode !== 'stub') {
      return { k: 'buyres', ok: false, off: true,
        msg: 'The store is not taking payments yet. Weapons unlock by level in the meantime — everything on the $15 shelf is free by level 10.' };
    }
    return this.deliver(acctId, id, 'stub-purchase');
  }

  // THE ONLY PLACE A PURCHASE TURNS INTO AN ENTITLEMENT, for the stub and for a verified crypto
  // payment alike. One path, so the paid route cannot drift away from the one the tests cover.
  //
  // BUYING A PIECE OF GEAR MINTS AN INSTANCE. It is not an entitlement: a wearable is a thing with
  // a serial, a condition and possibly a counter on it, and two copies of the same hat are two
  // different objects. A bought one is CLEAN -- Mint condition, no Unusual, no counter -- because
  // the gamble is what the free crate is for, and paying money to be told no is how a shop loses
  // somebody. That is also the honest version of the split the references run: Fortnite sells you
  // the outfit outright, Counter-Strike makes you open a case for the roll.
  deliver(acctId, id, why) {
    const d = C.BY.get(id);
    if (!d) return { k: 'buyres', ok: false, msg: 'That is not for sale.' };
    if (d.type === 'gear') {
      const inst = this.mintGear(acctId, id, { clean: true });
      if (!inst.ok) return Object.assign({ k: 'buyres', ok: false }, inst);
      const st2 = this.state(acctId);
      return Object.assign({ k: 'buyres', ok: true, msg: d.name + ' added to your locker.' }, st2, { k: 'buyres' });
    }
    // A paid item the account already holds is reported as held rather than refused: the money has
    // already moved, and "you already own it" after a payment reads as a shop that took it twice.
    if (d.type !== 'consumable' && this.owns(acctId, id)) {
      return Object.assign({ k: 'buyres', ok: true, msg: d.name + ' is already on your account.' }, this.state(acctId), { k: 'buyres' });
    }
    this.grant(acctId, [id], why || 'purchase');
    const st = this.state(acctId);
    return Object.assign({ k: 'buyres', ok: true, msg: d.name + ' unlocked.' }, st, { k: 'buyres' });
  }

  // The checkout, built once and only in chain mode. A missing or broken pay.json leaves it null and
  // the store answers "not taking payments yet" rather than throwing on a player's click.
  pay() {
    if (this.mode !== 'chain') return null;
    if (this._pay === undefined) {
      try { const { Pay } = require('./pay'); this._pay = new Pay({ dataDir: this.dir, log: this.log }); }
      catch (e) { this.log('checkout unavailable:', e.message); this._pay = null; }
    }
    return this._pay;
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
      const gotCrate = this.earnCrate(r, !!ranked);  // free, for playing; ranked stamps it ARENA
      this.addKos(a.id, st.kos || 0);                // the counter, on what was actually worn
      this.noteWorn(a.id);                           // the Most Worn ranking, from what was ON them
      const after = C.levelFor(r.xp);
      out[s.i] = { xp: gain, total: r.xp, level: after, levelled: after > before, crate: gotCrate, crates: r.crates,
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
    // ---- the crypto checkout, wired 2026-10-16 (lib/pay.js) ----
    // Three messages, and the page cannot skip a step: a menu to choose a currency, a quote that
    // locks an amount against a wallet, and a claim that proves the payment. Every one of them
    // answers from THIS account; `msg` never names an account, a price or an amount.
    if (msg.k === 'paymenu' || msg.k === 'payquote' || msg.k === 'payclaim') {
      const p = this.pay();
      const kind = msg.k === 'paymenu' ? 'paymenu' : msg.k === 'payquote' ? 'payq' : 'payres';
      if (!p || !p.enabled()) { api.sendTo(c, { k: kind, ok: false, off: true, msg: 'The store is not taking payments yet.' }); return true; }
      const bad = e => { this.log('checkout ' + msg.k + ' failed', e && e.message); api.sendTo(c, { k: kind, ok: false, retry: true, msg: 'The checkout did not answer. Try again.' }); };
      if (msg.k === 'paymenu') {
        // The sheet shows what the item costs in every currency at once, the way Gods Unchained's
        // does, so nobody has to pick blind and then discover the amount.
        const d = typeof msg.id === 'string' ? C.BY.get(msg.id) : null;
        const cents = d && d.price != null ? d.price : null;
        p.menu(cents).then(curs => api.sendTo(c, { k: 'paymenu', ok: true, id: d ? msg.id : null, cents, curs })).catch(bad);
        return true;
      }
      if (msg.k === 'payquote') {
        // The PRICE comes from the catalogue here, never from the page: a page that could name its
        // own `cents` could buy a legendary for a penny.
        const id = typeof msg.id === 'string' ? msg.id : '';
        const d = C.BY.get(id);
        if (!d || d.price == null) { api.sendTo(c, { k: 'payq', ok: false, msg: 'That is not for sale.' }); return true; }
        if (d.type !== 'consumable' && this.owns(c.acct, id)) { api.sendTo(c, { k: 'payq', ok: false, msg: 'You already own it.' }); return true; }
        p.quote(c.acct, { id, name: d.name, cents: d.price, cur: msg.cur, payer: msg.payer })
          .then(q => api.sendTo(c, Object.assign({ k: 'payq' }, q))).catch(bad);
        return true;
      }
      // payclaim: the item comes out of the QUOTE the server issued, not out of this message, so a
      // verified payment for a $1.99 weapon can never be claimed against a $14.99 one.
      p.verify(c.acct, { ref: msg.ref, tx: msg.tx }).then(r => {
        if (!r.ok) { api.sendTo(c, Object.assign({ k: 'payres', ok: false }, r)); return; }
        const out = this.deliver(c.acct, r.item, 'paid:' + (r.paid && r.paid.cur) + ':' + (r.paid && r.paid.tx));
        api.sendTo(c, Object.assign({}, out, { k: 'payres', paid: r.paid, msg: out.ok ? out.msg : r.msg }));
      }).catch(bad);
      return true;
    }
    // THE LOCKER, wired 2026-10-15. `openCase` and `setWear` were written on 10/15 and never routed:
    // the methods existed, the tests covered them, and no message could reach them, so a crate could
    // be earned and never opened. Every roll still happens here -- the page sends `lkopen` with no
    // arguments and gets back whatever the server decided.
    if (msg.k === 'lkopen') {
      const r = this.openCase(c.acct);
      const out = Object.assign({ k: 'lkres' }, r);
      if (r.ok) { out.mint = this.mint || {}; out.crates = this.row(c.acct).crates || 0; }
      api.sendTo(c, out);
      return true;
    }
    if (msg.k === 'wear') {
      // `slot` and `uid` are the only two fields read, and both are checked against this account's
      // own inventory inside setWear. A uid the account does not hold is refused, not trusted.
      const slot = typeof msg.slot === 'string' ? msg.slot : null;
      const uid = msg.uid == null ? null : (typeof msg.uid === 'number' && isFinite(msg.uid) ? msg.uid : undefined);
      if (uid === undefined) { api.sendTo(c, { k: 'wearres', ok: false, msg: 'Bad item.' }); return true; }
      api.sendTo(c, Object.assign({ k: 'wearres' }, this.setWear(c.acct, slot, uid)));
      return true;
    }
    // ---- the market layer, wired 2026-10-16 ----
    if (msg.k === 'react') {
      const id = typeof msg.id === 'string' ? msg.id : null;
      const kind = msg.r == null ? null : (typeof msg.r === 'string' ? msg.r : undefined);
      if (kind === undefined) { api.sendTo(c, { k: 'reactres', ok: false, msg: 'Bad reaction.' }); return true; }
      api.sendTo(c, Object.assign({ k: 'reactres' }, this.setReaction(c.acct, id, kind)));
      return true;
    }
    if (msg.k === 'tradeup') {
      const tier = typeof msg.tier === 'string' ? msg.tier : null;
      const out = this.tradeUp(c.acct, tier);
      api.sendTo(c, Object.assign({ k: 'traderes' }, out));
      return true;
    }
    if (msg.k === 'worn') { api.sendTo(c, { k: 'wornres', worn: this.mostWorn(100), matches: this.matches || 0 }); return true; }
    return false;
  }
}

module.exports = { Economy, monthId, monthEnds, MAX_LOADOUT, SLOTS, SEASON };
