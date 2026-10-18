'use strict';
// Brawlstreet online: lobby, rooms, quick match, delay-based lockstep input relay, a server-side
// copy of every fight (the page's own engine, stepped as inputs arrive), practice wagers, and the
// escrow operator for real-ETH matches (off unless REAL_MONEY=1). See README.md.
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const engine = require('./lib/engine');
const { Accounts, seasonId } = require('./lib/accounts');
const chat = require('./lib/chat');
const integrity = require('./lib/integrity');
const achievements = require('./lib/achievements');
const { serveStatic, send } = require('./lib/static');

const PROTO = 1;
// An input mask carries one bit per entry of ACTIONS (src/10_core.js), currently 12.
// This MUST cover every action the page can encode, or pressing the missing ones silently
// drops the whole frame and eventually strikes the player off the socket.
const MASK_MAX = integrity.MASK_MAX;
const clampInt = (v, a, b) => Math.max(a, Math.min(b, Math.round(v)));
const CFG = {
  port: +process.env.PORT || 8787,
  host: process.env.HOST || '0.0.0.0',
  publicDir: path.resolve(process.env.PUBLIC_DIR || path.join(__dirname, 'public')),
  dataDir: path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data')),
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/$/, ''),
  maxConnPerIp: +process.env.MAX_CONN_PER_IP || 16,
  maxMatches: +process.env.MAX_MATCHES || 120,
  maxRooms: +process.env.MAX_ROOMS || 600,
  startDelayMs: +process.env.START_DELAY_MS || 2500,
  graceMs: +process.env.GRACE_MS || 10000,          // a disconnected player has this long to come back
  stallDropMs: +process.env.STALL_DROP_MS || 20000, // a connected player who sends nothing for this long is dropped
  readyWindowMs: +process.env.READY_WINDOW_MS || 45000,
  ffaCountdownMs: +process.env.FFA_COUNTDOWN_MS || 12000,
  // Hard wall-clock ceiling on one match. The fight clock is 7 minutes of GAME time, but game time
  // only advances when every player sends input, so without this a player who drips one input every
  // 19 s can hold a match open forever -- and on a real-ETH match outlast the escrow's 2 h
  // REPORT_TIMEOUT, then cancel() on chain for a refund instead of losing. Must stay well under
  // BrawlEscrow.REPORT_TIMEOUT.
  matchMaxMs: +process.env.MATCH_MAX_MS || 15 * 60e3,
  // Total time one player may hold the match up, added across the whole fight. Only stalls longer
  // than 800 ms count, so an honest client on a bad line never accrues any of it.
  maxLagMs: +process.env.MAX_LAG_MS || 90e3,
  keepReplays: +process.env.KEEP_REPLAYS || 400,
  // Tournament feed (tools/tournament.js). A bracket runner has to know who won, and there are no
  // spectators, so finished matches land in a small ring here and are read back over /api/matches.
  // OFF unless TOURNEY_KEY is set, and then only readable with that key: the leaderboard and the
  // replays are already public, but a running list of who played whom is not something to hand out
  // by default. Memory only -- a restart loses it, which is why the runner keeps its own bracket file.
  tourneyKey: process.env.TOURNEY_KEY || '',
  tourneyKeep: +process.env.TOURNEY_KEEP || 500,
  realMoney: process.env.REAL_MONEY === '1',
  maxDelay: clampInt(+process.env.MAX_DELAY || 15, 2, 15),   // input delay cap in frames (see NetLockstep.MAX_DELAY)
  quiet: process.env.QUIET === '1',
  chatFree: process.env.CHAT_FREE !== '0',   // free-text room chat (quick-chat always works)
  // Which box this is, and every box a player could pick instead. One region per server; the page measures
  // the round trip to each and plays on the closest. REGIONS is JSON: [{id,label,ws,http}]
  region: process.env.REGION || 'eu',
  regionLabel: process.env.REGION_LABEL || 'Frankfurt',
};
let REGIONS = [];
try { REGIONS = JSON.parse(process.env.REGIONS || '[]'); } catch (e) { REGIONS = []; }
if (!REGIONS.length && CFG.publicUrl) REGIONS = [{ id: CFG.region, label: CFG.regionLabel, ws: CFG.publicUrl.replace(/^http/, 'ws') + '/ws', http: CFG.publicUrl }];
const STAKES = [0, 0.01, 0.05, 0.1, 0.25];
// Defaults are ETH-sized; a stablecoin escrow wants whole-dollar steps, so set REAL_STAKES when
// ESCROW_TOKEN is on (e.g. REAL_STAKES=1,5,10,25).
const REAL_STAKES = (process.env.REAL_STAKES || (process.env.ESCROW_TOKEN ? '1,5,10,25' : '0.001,0.005,0.01,0.05')).split(',').map(Number);
let STAGES = ['isle', 'moon', 'chart', 'keep', 'roof', 'dojo'];
const CPU_LEVEL = 7;
const log = (...a) => { if (!CFG.quiet) console.log(new Date().toISOString().slice(11, 19), ...a); };

const ENGINE = engine.load();
STAGES = ENGINE.stages.map(x => x.id);
// new engine builds dropped into engine/ are picked up without a restart
setInterval(() => { const before = engine.versions().length; engine.rescan(); if (engine.versions().length !== before) log('engines', engine.versions().join(' ')); }, 30000).unref();
const accounts = new Accounts(CFG.dataDir);
accounts.pruneTests();
setInterval(() => { const n = accounts.pruneTests(); if (n) log('pruned', n, 'test accounts'); }, 10 * 60e3).unref();
const replayDir = path.join(CFG.dataDir, 'replays');
// Finished matches, newest last, for /api/matches. Bounded by CFG.tourneyKeep; empty when the
// feed is off, so it costs nothing on a normal day.
const tourneyFeed = [];
// Does this request carry the tournament key? Used for /api/matches and to mark the bracket
// runner's sockets as operator sockets. Length is compared first because timingSafeEqual throws on
// a mismatch, and false whenever the feature is off, so an unset key never authorises anything.
function tourneyAuth(given) {
  if (!CFG.tourneyKey) return false;
  const a = Buffer.from(String(given || '')), b = Buffer.from(CFG.tourneyKey);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
fs.mkdirSync(replayDir, { recursive: true });

const integrityStore = new integrity.Store(CFG.dataDir);
setInterval(() => integrityStore.prune(), 10 * 60e3).unref();

// ECONOMY (lib/economy.js): entitlements, XP + levels, the monthly ladder, and the server-side
// decision about whether bought weapons may enter a match. See docs/ECONOMY.md.
// It attaches itself to `accounts` (it wraps leaderboard() to add the monthly board) and keeps its
// own economy.json, so it never touches accounts.js. Payments are OFF unless PAYMENTS=stub.
// X handle verification: a name over a fighter's head has to be an account that player proved they
// control, not a free-text field. X_CLIENT_ID (from developer.x.com, which only Duane can create)
// additionally turns on the OAuth route; without it the bio-code route works on its own.
const { XVerify, okHandle } = require('./lib/xverify');
const xv = new XVerify({ log, clientId: process.env.X_CLIENT_ID || null });
setInterval(() => xv.prune(), 5 * 60e3).unref();

const { Economy } = require('./lib/economy');
const economy = new Economy({ dataDir: CFG.dataDir, accounts, log });
setInterval(() => economy.flush(), 30e3).unref();

// THE TOURNAMENT (lib/tourney.js): one event, open registration, a seeded single-elimination
// bracket, and the record of every game in it. It owns no sockets and no rooms of its own -- the
// four hooks below are the whole surface between it and this file, and a page can only ever ask it
// to enter, withdraw, show the board, or say "I am at my match". Results reach it from `endMatch`
// and nowhere else, so a client cannot report a score. Free entry, zero stake, no escrow.
const { Tourney } = require('./lib/tourney');
const tourney = new Tourney({ dataDir: CFG.dataDir, accounts, log });
// Everyone to push the board to: every entrant, plus anyone sitting on the tournament screen. The
// screen registers itself with `tstate`, so a spectator who never entered still sees it update.
const tWatch = new Set();
tourney.api = {
  // The room for one bracket pair. A private, ranked, zero-stake 2-player room on the engine the
  // checking-in player is running, tagged with the pair so `joinRoom` can refuse anyone else and so
  // `endMatch` can tell a tournament game from a casual one. The caller is the host, which is only
  // ever the first of the two to check in.
  room: (p, c) => {
    if (!c || !c.buildOk) return null;
    const r = makeRoom(c, { priv: true, size: 2, stake: 0, stage: 'random', stocks: tourney.ev ? tourney.ev.stocks : 3,
      items: false, cpuFill: false, real: false, ranked: true, pool: tourney.ev ? tourney.ev.stages.slice() : [] });
    if (!r) return null;
    r.tourney = { pid: p.pid, eid: tourney.ev ? tourney.ev.id : null, a: p.a, b: p.b };
    if (!joinRoom(c, r)) { closeRoom(r); return null; }
    return r.code;
  },
  push: (ids, msg) => { for (const id of ids || []) for (const x of byAcct.get(id) || []) sendTo(x, msg); },
  sync: () => {
    const seen = new Set();
    const to = c => { if (!c || seen.has(c)) return; seen.add(c); sendTo(c, tourney.state(c.acct)); };
    for (const id of tourney.everyone()) for (const x of byAcct.get(id) || []) to(x);
    for (const c of tWatch) { if (clients.has(c)) to(c); else tWatch.delete(c); }
  },
  // A decided pair's room is finished with. Players still sitting in it are told why rather than
  // being dropped silently, and a pair that is still playing its set keeps its room.
  close: code => { const r = rooms.get(code); if (!r || r.state !== 'lobby') return; for (const m of r.members.slice()) leaveRoom(m.c, 'That tournament match is decided.'); closeRoom(r); },
};

// ---- THE VAULT, enforced here and not only in the page -----------------------------------------
// Two secret stages and one secret fighter are sold rather than listed (CAT.vault in src/89_econ.js).
// The page hides what an account does not own, but the page is not the authority: the engine's own
// stage and fighter lists still carry all 19 and all 36, and they must, because both sides of a
// lockstep match have to agree on the whole table. So the check lives at the two doors where a
// PLAYER'S CHOICE enters a room -- the fighter they pick and the stage a host sets.
const VAULT_CAT = require('./lib/catalog').CAT.vault || [];
function vaultIdFor(kind, unlocks) { const v = VAULT_CAT.find(x => x.kind === kind && x.unlocks === unlocks); return v ? v.id : null; }
// `acctId` null (no account yet) means not owned, which is the safe answer
function vaultOk(acctId, kind, unlocks) { const vid = vaultIdFor(kind, unlocks); return !vid || !!(acctId && economy.owns(acctId, vid)); }
function vaultName(kind, unlocks) { const v = VAULT_CAT.find(x => x.kind === kind && x.unlocks === unlocks); return v ? v.name : ''; }

let escrow = null;
if (CFG.realMoney) {
  const { Escrow } = require('./lib/escrow');
  escrow = new Escrow({ rpc: process.env.CHAIN_RPC, chainId: +process.env.CHAIN_ID, address: process.env.ESCROW_ADDRESS,
    // ESCROW_TOKEN turns on the ERC20 escrow: stakes are that token, never native ETH
    token: process.env.ESCROW_TOKEN || null, tokenSymbol: process.env.ESCROW_TOKEN_SYMBOL || 'USDC',
    tokenDecimals: process.env.ESCROW_TOKEN_DECIMALS == null ? 6 : +process.env.ESCROW_TOKEN_DECIMALS,
    operatorKey: process.env.OPERATOR_KEY, chainName: process.env.CHAIN_NAME, explorer: process.env.EXPLORER });
  log('real-money mode ON, escrow', process.env.ESCROW_ADDRESS, 'chain', process.env.CHAIN_ID);
}

// ------------------------------------------------------------------ state
const clients = new Set();
const byToken = new Map();   // token hash -> client (one live socket per device)
const byAcct = new Map();    // account id -> Set of clients (presence for friends)
const rooms = new Map();     // code -> room
const matches = new Set();
const ipCount = new Map();   // in memory only, for the per-address connection cap; never logged or stored
let nextId = 1;

const rid = n => crypto.randomBytes(n).toString('hex');
const rint = n => crypto.randomInt(n);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// display names: same filter as chat, with the flagged word removed rather than starred out
const cleanName = s => {
  const raw = String(s || '').replace(/[^\w .\-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  return chat.nameOk(raw) ? raw : '';
};
const CODE_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
// quick-match map pools: [] means "any map". Two players pair when their pools overlap.
function stageIds(digest) { const E = engine.get(digest) || engine.get(engine.digest); return E ? E.stages.map(x => x.id) : STAGES; }
function cleanPool(list, digest, acct) {
  if (!Array.isArray(list)) return [];
  // A quick-match pool is a map REQUEST, so a vault stage somebody does not own comes straight out of
  // it. Leaving it in would hand them the stage for free the moment the pool was honoured.
  const ok = new Set(stageIds(digest).filter(id => vaultOk(acct, 'stage', id))), out = [];
  for (const x of list) if (typeof x === 'string' && ok.has(x) && !out.includes(x)) out.push(x);
  return out.length === ok.size ? [] : out;   // everything picked == any
}
function overlap(a, b) { if (!a.length) return b.slice(); if (!b.length) return a.slice(); const s = new Set(b); return a.filter(x => s.has(x)); }
// [] is "any map", so it fits any other pool; two narrow pools need a shared map
function poolsFit(a, b) { return !a.length || !b.length || a.some(x => b.includes(x)); }

function newCode() { for (;;) { let c = ''; for (let i = 0; i < 5; i++) c += CODE_ABC[rint(CODE_ABC.length)]; if (!rooms.has(c)) return c; } }

function sendTo(c, msg) { if (c && c.ws.readyState === 1) c.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); }
function err(c, msg, code) { sendTo(c, { k: 'err', msg, code: code || 'err' }); }

// ------------------------------------------------------------------ rooms
function roomView(r, forClient) {
  const M = r.match;
  return {
    k: 'room', code: r.code, priv: r.priv, quick: r.quick, size: r.size, host: r.hostId, stake: r.stake, stage: r.stage, stocks: r.stocks,
    items: r.items, cpuFill: r.cpuFill, real: r.real, ranked: !!r.ranked, pool: r.pool, picked: r.picked, state: r.state, countdown: r.countdownAt ? Math.max(0, r.countdownAt - Date.now()) : 0,
    readyBy: r.readyBy ? Math.max(0, r.readyBy - Date.now()) : 0,
    members: r.members.map(m => { const a = accounts.get(m.th); return { id: m.id, acct: a.id, name: m.name, x: handleOf(a), char: m.char, ready: m.ready, ping: m.c ? Math.round(netRtt(m.c)) : 0, wallet: m.addr || null, look: a.look || null, elo: a.rg ? a.elo : null }; }),
    you: forClient ? forClient.id : null, nonce: forClient && r.real ? (r.members.find(m => m.c === forClient) || {}).nonce : undefined,
    link: CFG.publicUrl ? CFG.publicUrl + '/#room:' + r.code : '', match: M ? M.id : null,
    region: { id: CFG.region, label: CFG.regionLabel }, delay: roomDelay(r),
    funding: r.funding ? { id: r.funding.id, deadline: r.funding.deadline, stakeWei: r.funding.stakeWei } : null,
  };
}
// what the input delay will be for this room as it stands, so a rough match is visible before it starts
function roomDelay(r) {
  // same trip measure the match itself will use, so the number the room shows is the number played
  const rt = r.members.filter(m => m.c).map(m => (typeof tripMs === 'function' ? tripMs(m.c) : netRtt(m.c)));
  if (rt.length < 2) return null;
  const top = rt.slice().sort((a, b) => b - a);
  // DELAY_MARGIN_MS, not a hardcoded 10, for the same reason: tuning the margin must move the number
  // the lobby promises as well as the one the match uses.
  return clamp(Math.ceil((top[0] / 2 + top[1] / 2 + DELAY_MARGIN_MS) / (1000 / 60)) + 1, 2, CFG.maxDelay);
}
function broadcastRoom(r) { r.touched = Date.now(); for (const m of r.members) if (m.c) sendTo(m.c, roomView(r, m.c)); }

// LOBBY EXHAUSTION (finding M3). One socket holds one room, so the room table is only as big as the
// number of sockets a host can open -- which the per-address connection cap bounds at 16, but only
// once the X-Forwarded-For fix (H6) is deployed AND the container port stays unreachable. Even then
// 600 rooms is ~38 addresses, which is nothing for a botnet or a handful of VPN exits.
//
// So do not rely on a count alone. Two extra properties:
//   1. A cap on rooms held per ADDRESS, so one host cannot hold more than its share.
//   2. When the table is genuinely full, EVICT the least valuable room -- an idle, private, empty
//      one -- instead of refusing the new player. That is the property that matters: a legitimate
//      player can always get a room, and an attacker has to keep paying to re-create theirs rather
//      than parking once and walking away.
// Plus (3), in the lobby timer: a room nobody ever joined is reaped in minutes, not half an hour.
const MAX_ROOMS_PER_IP = +process.env.MAX_ROOMS_PER_IP || 4;
const EMPTY_ROOM_MS = +process.env.EMPTY_ROOM_MS || 10 * 60e3;  // never-joined room, idle this long
function roomsHeldBy(ip) { if (!ip) return 0; let n = 0; for (const r of rooms.values()) if (r.ip === ip) n++; return n; }
// The room we would miss least: private, never filled, idle longest.
function evictableRoom() {
  let worst = null;
  for (const r of rooms.values()) {
    if (r.state !== 'lobby' || r.members.length > 1 || r.real) continue;
    if (Date.now() - r.touched < 20e3) continue;         // give a fresh room a moment to be joined
    if (!worst || r.touched < worst.touched) worst = r;
  }
  return worst;
}
function makeRoom(c, o) {
  if (!SAME_IP_OK && c.ip && roomsHeldBy(c.ip) >= MAX_ROOMS_PER_IP) {
    err(c, 'Too many open rooms on your connection. Close one and try again.', 'roomcap'); return null;
  }
  if (rooms.size >= CFG.maxRooms) {
    const victim = evictableRoom();
    if (!victim) { err(c, 'The server is full right now. Try again in a minute.'); return null; }
    log('room table full, evicting idle room', victim.code);
    for (const m of victim.members) leaveRoom(m.c, 'The room closed to make space; open a new one.');
    closeRoom(victim);
  }
  // THE CPU RULE, Duane 2026-10-14: *"if cpu is playing dont make wagering work"*. Money and bots do
  // not share a match. A wagered room never fills a seat with a CPU, which means a 4-player wager is
  // four paying humans fighting each other and nothing else. Set here, re-checked in `set`, enforced
  // again in startMatch and launch, because this is the one rule a tampered client must not get past.
  const real = !!(o.real && escrow);
  const r = {
    code: newCode(), priv: !!o.priv, quick: !!o.quick, size: o.size === 4 ? 4 : 2, hostId: c.id, stake: o.stake || 0,
    // a vault stage the host does not own falls back to Random rather than being refused: the room
    // still opens, which is the right answer for a stale page that still has the card on screen
    stage: engine.get(c.digest).stages.some(x => x.id === o.stage) && vaultOk(c.acct, 'stage', o.stage) ? o.stage : 'random', stocks: clamp(o.stocks | 0 || 3, 1, 5), items: o.items !== false,
    cpuFill: o.size === 4 && o.cpuFill !== false && !real, real, members: [], state: 'lobby', match: null, digest: c.digest,
    ranked: o.size !== 4 && !!o.ranked, challenge: o.challenge || null, pool: Array.isArray(o.pool) ? o.pool : [], picked: null,
    created: Date.now(), touched: Date.now(), countdownAt: 0, readyBy: 0, funding: null, fundAt: 0,
    ip: c.ip || null,   // for the per-address room cap only; never logged, never stored, dies with the room
    everFilled: false,
  };
  rooms.set(r.code, r);
  return r;
}

function joinRoom(c, r) {
  if (c.room === r) return true;
  if (r.state !== 'lobby') { err(c, 'That match already started.', 'started'); return false; }
  if (r.digest !== c.digest) { err(c, 'That room runs a different game version. Reload the page to get the latest.', 'version'); return false; }
  if (r.real && c.digest !== engine.digest) { err(c, 'Real-ETH matches need the current version of the game. Reload the page.', 'build'); return false; }
  if (r.members.length >= r.size) { err(c, 'That room is full.', 'full'); return false; }
  if (r.members.some(x => x.c && x.c.acct === c.acct)) { err(c, 'Your account is already in that room (another device or tab).', 'dupe'); return false; }
  // A TOURNAMENT ROOM TAKES ITS TWO PLAYERS AND NOBODY ELSE. The code is handed out by the bracket,
  // one player at a time, but a code is five characters and gets pasted into chat: without this, a
  // third party who guessed or was given it could sit in a bracket seat, and the pair would fight a
  // stranger. Checked here rather than in `join` so the friend-challenge path cannot route around it.
  if (r.tourney && c.acct !== r.tourney.a && c.acct !== r.tourney.b) { err(c, 'That room is a tournament match between two other players.', 'tourney'); return false; }
  // Money and rating rooms: one person must not be able to sit in both seats and hand themselves
  // the pot or the Elo. Same device token or same network address is enough to refuse.
  // This is a speed bump, not a wall -- a hotspot or a VPN defeats it -- so the real backstop is
  // the post-match integrity hold. It costs flatmates and families the ability to play each other
  // for money or rating; SAME_IP_OK=1 turns it off (local tests, or a LAN event).
  if (r.real || r.ranked) {
    if (r.members.some(x => x.c && x.th === c.th)) { err(c, 'That device is already in this room.', 'dupe'); return false; }
    if (c.ip && !SAME_IP_OK && r.members.some(x => x.c && x.c.ip && x.c.ip === c.ip)) {
      err(c, r.real ? 'Someone on your connection is already in this room. Real-ETH matches need two separate connections.'
        : 'Someone on your connection is already in this room. Play an unranked room instead.', 'sameip');
      return false;
    }
  }
  leaveRoom(c);
  const chars = engine.get(r.digest).chars;
  const m = { id: c.id, c, th: c.th, name: c.name, char: chars[rint(Math.min(chars.length, 14))], ready: false, addr: null, nonce: rid(8), pool: c.wantStages || [] };
  r.members.push(m); c.room = r; presence(c);
  if (r.members.length >= 2) r.everFilled = true;   // a room that really paired is never reaped early
  if (r.quick) { r.pool = overlap(r.pool, m.pool); if (r.members.length >= 2 && !r.picked) pickMap(r); }
  if (!r.members.some(x => x.id === r.hostId)) r.hostId = c.id;
  if (r.quick && r.members.length >= 2) r.readyBy = Math.max(r.readyBy || 0, Date.now() + Math.min(CFG.readyWindowMs, 20000), r.readyBy ? 0 : Date.now() + CFG.readyWindowMs);
  r.countdownAt = 0;
  broadcastRoom(r);
  return true;
}

function leaveRoom(c, why) {
  const r = c.room; if (!r) return;
  if (r.state === 'match' && c.seat) return; // match players leave through dropSeat
  c.room = null; presence(c);
  const i = r.members.findIndex(m => m.c === c);
  if (i >= 0) r.members.splice(i, 1);
  if (why) sendTo(c, { k: 'kicked', msg: why });
  if (!r.members.length) { closeRoom(r); return; }
  if (r.hostId === c.id) r.hostId = r.members[0].id;
  if (r.quick) { r.pool = r.members.reduce((acc, m) => overlap(acc, m.pool || []), []); if (r.members.length < 2) r.picked = null; }
  r.countdownAt = 0;
  if (r.members.length < 2) r.readyBy = 0;
  if (r.state === 'funding') abortFunding(r, 'A player left before the match was funded.');
  broadcastRoom(r);
}

function closeRoom(r) { rooms.delete(r.code); }

// the map a quick match will be played on: random inside the pool everyone agreed on
function pickMap(r) {
  // RANDOM ONLY ROLLS A VAULT STAGE IF EVERY PLAYER IN THE ROOM OWNS IT. An empty pool means "any
  // map" and the engine's list carries all 19, so a free quick match would otherwise have dropped
  // people onto a paid stage -- a giveaway, and the opposite of a secret. A host DELIBERATELY
  // picking one is different and still stands: both players fight on it, which costs the guest
  // nothing and is the best advertising the stage will ever get.
  const accs = r.members.map(m => m.c && m.c.acct).filter(Boolean);
  const everyoneOwns = id => !vaultIdFor('stage', id) || (accs.length > 0 && accs.every(a => vaultOk(a, 'stage', id)));
  let ids = (r.pool.length ? r.pool : stageIds(r.digest)).filter(everyoneOwns);
  if (!ids.length) ids = stageIds(r.digest).filter(id => !vaultIdFor('stage', id));   // never roll an empty list
  r.picked = ids[rint(ids.length)];
  return r.picked;
}

function maybeStart(r) {
  if (r.state !== 'lobby') return;
  const ms = r.members, allReady = ms.length >= 2 && ms.every(m => m.ready);
  if (!allReady) {
    if (r.countdownAt) { r.countdownAt = 0; broadcastRoom(r); }
    if (r.fundAt) { r.fundAt = 0; broadcastRoom(r); }   // somebody un-readied: no chain transaction
    return;
  }
  if (ms.length === r.size) {
    // A real-ETH room must hold "everyone ready" steady for a moment before anything is sent on
    // chain (H5). A ready/unready flicker then costs the operator nothing at all. The lobby timer
    // fires the actual start; un-readying clears r.fundAt above.
    if (r.real) { if (!r.fundAt) { r.fundAt = Date.now() + FUND_DEBOUNCE_MS; broadcastRoom(r); } return; }
    return startMatch(r);
  }
  if (r.size === 4 && r.quick && !r.countdownAt) { r.countdownAt = Date.now() + CFG.ffaCountdownMs; broadcastRoom(r); }
}

function startMatch(r) {
  // A FULL BOX SHOULD SEND PEOPLE SOMEWHERE, NOT JUST SAY NO. The refusal now carries a code and the
  // other regions, so a page that was quick-matching can move itself to a box with room instead of
  // leaving the player stuck on a server that is already as busy as it can usefully be.
  if (matches.size >= CFG.maxMatches) {
    const elsewhere = REGIONS.filter(x => x && x.id !== CFG.region).map(x => x.id);
    for (const m of r.members) err(m.c, elsewhere.length ? 'This region is full. Moving you to another one.' : 'The server is at capacity. Try again in a minute.', 'capacity');
    return;
  }
  r.countdownAt = 0; r.readyBy = 0; r.fundAt = 0;
  if (r.real) {
    // Every seat human, every seat present. The FFA countdown and the host's Start button both land
    // here with as few as two people in a four-seat room, and `launch` would have handed the empty
    // seats to bots; a pot fought partly by the server is not a wager. Refuse and say why.
    if (r.members.length !== r.size) {
      for (const m of r.members) err(m.c, `A wagered ${r.size}-player match needs all ${r.size} seats taken by players. ${r.size - r.members.length} still open.`, 'seats');
      broadcastRoom(r); return;
    }
    return beginFunding(r);
  }
  for (const m of r.members) {
    if (accounts.get(m.th).bal + 1e-9 < r.stake) {
      m.ready = false; err(m.c, 'Not enough practice ETH for this stake. Refill or lower the stake.', 'funds');
      broadcastRoom(r); return;
    }
  }
  for (const m of r.members) accounts.add(m.th, -r.stake);
  launch(r, null);
}

// ------------------------------------------------------------------ matches
// input delay per player: their own one-way trip + the slowest other player's, plus jitter and a frame of margin
const netRtt = c => Math.max(c.rtt, c.appRtt || 0);
// INPUT DELAY, which is the whole feel of an online fight.
//
// Lockstep advances a tick only when every player's input for it has arrived, so each player runs
// `delay` frames ahead of the fight and that lead has to cover the trip their input makes: to the
// server (half their round trip) and on to the slowest other player (half of theirs). If the lead is
// short the fight does not merely feel delayed, it FREEZES -- measured 20% of a fight spent frozen on
// a 250 ms link -- and a freeze is far worse to play than a few extra frames of delay.
//
// DELAY_MARGIN_MS is the headroom on top of that trip. It was 10 ms, which left nothing for jitter on
// the receiving side, for the 250 ms timer that relays input, or for a GC pause on either page. A
// stall costs much more than a frame, so the margin is worth more than it costs: at 60 Hz every
// 16.7 ms of margin is one frame.
const DELAY_MARGIN_MS = +process.env.DELAY_MARGIN_MS || 10;
const DELAY_JIT_MULT = process.env.DELAY_JIT_MULT == null ? 2 : +process.env.DELAY_JIT_MULT;
// THE RENDER LOOP IS NOT THE NETWORK (10/18). The delay was built from the PAGE's own ping
// (`appRtt`) plus TWICE the page's jitter, and that ping is answered by page JavaScript, so it waits
// behind whatever frame the game is drawing. A browser that hitches reports its own frame time as
// network lag, and the hitch is then counted twice. Measured on the live Singapore server with two
// real browsers: a true 45 ms link produced delay 15, the hard maximum, which is 250 ms of input lag.
//
// `c.rtt` is different: it comes from WebSocket PING/PONG frames, which the browser's network stack
// answers without touching page JavaScript, so it is the real trip and nothing else. That is what the
// trip term is built from now. Client-side irregularity still deserves headroom -- lockstep really
// does wait for a stuttering player -- but as a BOUNDED margin, not as the dominant term, because
// the stall-driven bump in NetLockstep (up to +4 frames, 63_netsim.js) already adapts to a client
// that genuinely cannot keep up, and it adapts on evidence instead of on a guess.
const DELAY_JIT_CAP_MS = +process.env.DELAY_JIT_CAP_MS || 32;    // at most ~2 frames of jitter headroom
function tripMs(c) {
  if (!c) return 200;
  // transport first; the page's own figure is only a fallback before any pong has landed
  const transport = c.rtt > 0 ? c.rtt : (c.appRtt || 0);
  const jit = Math.min(DELAY_JIT_MULT * (c.appJit || 0), DELAY_JIT_CAP_MS);
  return transport + jit;
}
function computeDelays(M) {
  const rt = M.slots.map(s => (s.human && !s.dropped ? (s.client && s.connected ? tripMs(s.client) : 200) : 0));
  return M.slots.map((s, i) => {
    if (!s.human) return 0;
    let other = 0; rt.forEach((v, j) => { if (j !== i && v > other) other = v; });
    return clamp(Math.ceil((rt[i] / 2 + other / 2 + DELAY_MARGIN_MS) / (1000 / 60)) + 1, 2, CFG.maxDelay);
  });
}

function launch(r, real) {
  const members = r.members.slice();
  const players = members.map(m => ({ char: m.char, name: m.name, human: true, th: m.th, member: m }));
  const E = engine.get(r.digest);
  if (r.size === 4 && r.cpuFill && !real) while (players.length < 4) players.push({ char: E.chars[rint(E.chars.length)], name: 'CPU', cpu: true, level: CPU_LEVEL });
  if (real && players.some(p => !p.human)) throw new Error('refusing to launch a wagered match with a CPU in it');
  const ids = E.stages.map(x => x.id);
  const want = r.quick ? (r.picked || pickMap(r)) : r.stage;
  // the last-resort roll skips the vault for the same reason pickMap does: nobody chose it here
  const roll = ids.filter(id => !vaultIdFor('stage', id));
  const stage = want === 'random' || !ids.includes(want) ? roll[rint(roll.length)] : want;
  const humans = players.filter(p => p.human).length;
  const pot = +(r.stake * humans).toFixed(9);
  // THE FAIRNESS RULE, enforced here and nowhere else: a staked or ranked room gets `arsenal: false`
  // and no loadouts, so nothing anybody bought can enter a money match. The decision is the server's;
  // the page never sends a loadout. It goes into cfg, so it is in the replay and in the fingerprinted
  // match config, which means both pages and the server run the identical fight. docs/ECONOMY.md.
  const ars = economy.arsenalFor(r, players);
  const cfg = { seed: '0x' + rid(32), stage, stocks: r.stocks, items: r.items, limit: 60 * 60 * 7, pot,
    rules: E.rules,   // the same ruleset local play uses, fixed for this match and recorded in the replay
    arsenal: !!ars.on, loadouts: ars.on ? ars.loadouts : null,
    players: players.map(p => ({ char: p.char, cpu: !!p.cpu, level: p.level || 0 })) };
  const M = {
    id: 'm' + Date.now().toString(36) + rid(3), room: r, cfg, names: players.map(p => p.name), stake: r.stake, pot, real,
    slots: players.map((p, i) => ({ i, human: !!p.human, th: p.th || null, name: p.name, member: p.member || null, client: p.member ? p.member.c : null,
      connected: !!p.human, dropped: false, left: false, log: [], cpuFrom: p.human ? Infinity : 0, discAt: 0, desync: false, addr: p.member ? p.member.addr : null,
      ip: p.member && p.member.c ? p.member.c.ip : null })),
    events: [], evIdx: 0, srvHash: new Map(), cliHash: new Map(), masks: [0, 0, 0, 0],
    startAt: Date.now() + CFG.startDelayMs, lastAdvance: 0, lastLag: 0, ended: false, created: Date.now(),
    looks: players.map(p => (p.th ? accounts.get(p.th).look || null : null)),
    handles: players.map(p => (p.th ? handleOf(accounts.get(p.th)) : null)),
    // equipped cosmetics ride alongside the look blob, not in cfg: visual only, allowed everywhere
    cosm: players.map(p => { if (!p.th) return null; const a = accounts.get(p.th); const r = economy.row(a.id); return economy.cleanEquip(r, economy.owned(a.id)); }),
    ranked: !!r.ranked && r.size === 2 && humans === 2,
  };
  M.lastAdvance = M.startAt;
  try { M.sim = E.create(); M.digest = r.digest; M.sim.NetSim.start(cfg); }
  catch (e) {
    log('engine failed to start a match:', String(e && e.message).split('\n')[0]);
    for (const m of r.members) { err(m.c, 'This build of the game could not start a match. Reload the page.', 'engine'); m.ready = false; }
    if (!real) for (const m of r.members) accounts.add(m.th, r.stake);
    r.state = 'lobby'; broadcastRoom(r); return;
  }
  M.delays = computeDelays(M);
  for (const s of M.slots) if (s.client) { s.client.seat = { M, i: s.i }; presence(s.client); }
  for (const s of M.slots) if (s.human && (!s.client || !clients.has(s.client))) log('match', M.id, 'slot', s.i, 'started without a live socket');
  matches.add(M);
  r.state = 'match'; r.match = M;
  for (const m of r.members) m.ready = false;
  for (const s of M.slots) if (s.client) sendTo(s.client, startMsg(M, s.i));
  broadcastRoom(r);
  log('match', M.id, 'start', players.length + 'p', humans + ' humans', 'stage', stage, 'stake', r.stake, real ? 'REAL' : '');
}

// Everything a page needs to pick a match back up: the start message plus every input so far. Used
// by the reconnect in `hello` and by a `join` for the room this socket is already playing in.
function resumeMsg(M, i) {
  return Object.assign(startMsg(M, i), { k: 'resume', log: M.slots.map(s => s.log), events: M.events, t: M.sim.Game.tick });
}
function startMsg(M, i) {
  return { k: 'start', id: M.id, cfg: M.cfg, names: M.names, you: i, delay: M.delays[i], startAt: M.startAt, now: Date.now(),
    stake: M.stake, pot: M.pot, real: M.real ? { id: M.real.id } : null, check: M.sim.NetSim.CHECK, looks: M.looks, handles: M.handles,
    // equipped cosmetics, per slot. Purely visual: outside cfg, outside the replay, outside the
    // engine fingerprint, and the server's copy of the fight never sees them. That is exactly why
    // they are legal in a money match. docs/ECONOMY.md.
    cosm: M.cosm, ranked: M.ranked };
}

function seatsOf(M) { return M.slots.filter(s => s.human && s.client && s.connected); }
function toPlayers(M, msg, except) { const str = JSON.stringify(msg); for (const s of seatsOf(M)) if (s.i !== except) sendTo(s.client, str); }

function insertEvent(M, e) {
  let k = M.events.length; while (k > M.evIdx && M.events[k - 1].t > e.t) k--;
  M.events.splice(k, 0, e);
}

// step the server's copy of the fight as far as the inputs allow
function advance(M) {
  if (M.ended) return;
  try { advanceInner(M); } catch (e) { simCrash(M, e); }
}
// a bug in the fight code would otherwise kill the process and drop every player: cancel that one
// match (stakes refunded) and keep serving
function simCrash(M, e) {
  log('match', M.id, 'engine error, cancelling:', String(e && e.message).split('\n')[0]);
  M.crashed = true;
  for (const S of M.slots) if (S.human) S.dropped = true;
  try { finish(M, 'cancelled'); } catch (e2) {
    M.ended = true; matches.delete(M);
    for (const S of M.slots) if (S.client) { sendTo(S.client, { k: 'err', msg: 'The match hit an engine error and was cancelled. Your stake was returned.', code: 'engine' }); S.client.seat = null; }
    for (const S of M.slots) if (S.human && !M.real) accounts.add(S.th, M.stake);
    if (M.room) { M.room.state = 'lobby'; M.room.match = null; broadcastRoom(M.room); }
  }
}
function advanceInner(M) {
  const s = M.sim, G = s.Game, n = M.slots.length, masks = M.masks;
  for (let guard = 0; guard < 20000 && !M.ended; guard++) {
    const t = G.tick;
    let blocked = false;
    for (let i = 0; i < n; i++) {
      const S = M.slots[i];
      if (!S.human || t >= S.cpuFrom) { masks[i] = 0; continue; }
      const m = S.log[t];
      if (m === undefined) { blocked = true; break; }
      masks[i] = m;
    }
    if (blocked) break;
    while (M.evIdx < M.events.length && M.events[M.evIdx].t === t) {
      const e = M.events[M.evIdx++];
      if (e.type === 'cpu') s.NetSim.toCpu(e.slot, e.level);
    }
    s.NetSim.step(masks);
    M.lastAdvance = Date.now();
    if (G.tick % s.NetSim.CHECK === 0) {
      const h = s.NetSim.hash();
      M.srvHash.set(G.tick, h);
      const pend = M.cliHash.get(G.tick);
      if (pend) { for (const [slot, ch] of pend) if (ch !== h) desync(M, slot, G.tick); M.cliHash.delete(G.tick); }
      if (M.srvHash.size > 400) M.srvHash.delete(M.srvHash.keys().next().value);
    }
    if (s.NetSim.done) { finish(M, G.timeUpT ? 'time' : 'ko'); break; }
    if (G.tick > 60 * 60 * 12) { finish(M, 'time'); break; }
  }
}

function desync(M, slot, t) {
  const S = M.slots[slot]; if (!S || S.desync) return;
  S.desync = true;
  log('match', M.id, 'desync slot', slot, 'tick', t);
  toPlayers(M, { k: 'desync', slot, t });
}

// a player is gone for good: 1v1 (or last human standing) = forfeit; free-for-all = their fighter goes CPU
function dropSeat(M, i, why) {
  const S = M.slots[i];
  if (!S || !S.human || S.dropped || M.ended) return;
  S.dropped = true;
  if (S.client) { S.client.seat = null; presence(S.client); }
  const alive = M.slots.filter(x => x.human && !x.dropped);
  log('match', M.id, 'drop slot', i, why, alive.length + ' humans left');
  if (alive.length <= 1) return finish(M, 'forfeit');
  const t = Math.max(S.log.length, M.sim.Game.tick);
  S.cpuFrom = t;
  const e = { t, type: 'cpu', slot: i, level: CPU_LEVEL };
  insertEvent(M, e);
  toPlayers(M, { k: 'drop', slot: i, t, level: CPU_LEVEL, why });
  advance(M);
}

// The match hit its wall-clock ceiling. Whoever kept feeding inputs wins; whoever was sitting on
// the clock forfeits. If everyone was equally stuck it is a time-up, judged on the fight state.
function timeoutMatch(M) {
  const live = M.slots.filter(S => S.human && !S.dropped);
  if (!live.length) return finish(M, 'cancelled');
  const best = Math.max(...live.map(S => S.log.length));
  const behind = live.filter(S => best - S.log.length > 600);   // 10 s of fight behind the leader
  log('match', M.id, 'wall-clock timeout after', Math.round((Date.now() - M.startAt) / 1000) + 's',
    'logs', M.slots.map(S => S.log.length).join(','), behind.length ? 'forfeit by slot ' + behind.map(S => S.i).join(',') : 'time');
  M.timedOut = true;
  if (behind.length && behind.length < live.length) {
    for (const S of behind) { S.dropped = true; S.stalled = true; if (S.client) { S.client.seat = null; presence(S.client); } }
    return finish(M, 'forfeit');
  }
  return finish(M, 'time');
}

// Per-human achievement pass for a finished match. Returns { [slot]: [{id,name,desc,tier,xp}] }
// for the slots that earned something, so the result screen can show badges to the player who
// got them and nobody else.
//
// The three account fields achievements need that nothing else tracked: `streak` (consecutive
// wins), `wonChars` (the fighters you have won with, for the roster line) and `ach` itself.
// They are created lazily here so no migration of the existing account file is needed.
function awardAchievements(M, o) {
  if (o.cancelled || o.held) return null;              // a held or cancelled match awards nothing
  const out = {};
  const maxStocks = (M.cfg && M.cfg.stocks) || 2;
  const rosterSize = (engine.chars && engine.chars.length) || 46;
  const bestOpp = (i) => {
    // the best-placed opponent's remaining stocks, for the comeback test
    let best = 0;
    for (const x of M.slots) {
      if (x.i === i) continue;
      const st = (o.stats[x.i] && o.stats[x.i].stocks) || 0;
      if (st > best) best = st;
    }
    return best;
  };

  for (const x of M.slots) {
    if (!x.human || !x.th) continue;
    const a = accounts.get(x.th);
    a.ach = a.ach || {};
    a.wonChars = a.wonChars || [];
    if (typeof a.streak !== 'number') a.streak = 0;

    const won = x.i === o.payee;
    const charId = (M.cfg.players[x.i] && M.cfg.players[x.i].char) || null;

    // Update the derived counters BEFORE evaluating, so "win 5 in a row" can fire on the
    // win that makes it five rather than the one after.
    a.streak = won ? a.streak + 1 : 0;
    if (won && charId && !a.wonChars.includes(charId)) a.wonChars.push(charId);

    const st = o.stats[x.i] || {};
    const ctx = {
      won, stocks: st.stocks || 0, maxStocks, dmg: st.dmg || 0,
      kos: st.kos || 0, dealt: st.dealt || 0, taken: st.taken || 0, falls: st.falls || 0, combo: st.combo || 0,
      timeUp: !!M.timedOut, oppStocks: bestOpp(x.i),
      real: !!M.real, ranked: !!M.ranked, charId,
      acct: { games: a.games || 0, wins: a.wins || 0, elo: a.elo || 0, streak: a.streak,
              chars: a.wonChars, rankedWins: a.rw || 0 },
    };

    const earned = achievements.evaluate(ctx, a.ach, { rosterSize });
    if (earned.length) {
      const now = Date.now();
      for (const id of earned) a.ach[id] = now;
      out[x.i] = achievements.describe(earned);
      log('achievements', M.id, 'slot', x.i, 'acct', a.id, earned.join(','));
    }
    accounts.touch();
  }
  return Object.keys(out).length ? out : null;
}

function finish(M, reason) {
  if (M.ended) return;
  M.ended = true; matches.delete(M);
  const s = M.sim, G = s.Game, r = M.room;
  let placements;
  try { placements = s.NetSim.placements(); } catch (e) { placements = M.slots.map(x => x.i); }
  const eligible = i => M.slots[i].human && !M.slots[i].dropped;
  let winner = s.NetSim.done ? s.NetSim.done.idx : -1;
  if (M.crashed) reason = 'cancelled';
  if (reason === 'forfeit') {
    const alive = M.slots.filter(x => x.human && !x.dropped).map(x => x.i);
    winner = alive.length ? alive[0] : -1;
    if (winner >= 0) placements = [winner, ...placements.filter(p => p !== winner)];
  }
  const payee = placements.find(eligible);
  const cancelled = payee === undefined;
  const humans = M.slots.filter(x => x.human);
  const deltas = M.slots.map(x => (x.human ? -M.stake : 0));
  // On a real match the winner does NOT receive the pot: the escrow keeps the cut, and claim() pays
  // out pot less cut. Crediting the whole pot here put a number on the results screen (and in the
  // table) that was 5% higher than what the wallet would ever receive -- on a 1 USDC-a-side fight it
  // said +1.000 USDC against an actual +0.900. Practice matches have no cut and are unchanged.
  const takeHome = M.real && escrow && escrow.cutBps != null ? M.pot * (1 - escrow.cutBps / 10000) : M.pot;
  if (cancelled) { reason = 'cancelled'; humans.forEach(x => { deltas[x.i] = 0; }); }
  else deltas[payee] += takeHome;
  // practice balances: stakes were taken at kickoff
  if (!M.real) {
    for (const x of humans) {
      if (cancelled) accounts.add(x.th, M.stake);
      const a = accounts.get(x.th); a.games++;
      if (x.i === payee) { accounts.add(x.th, M.pot); a.wins++; a.won = +((a.won || 0) + M.pot - M.stake).toFixed(9); }
    }
  }
  // ---- integrity: bot/script scoring, degenerate-strategy flags, self-match detection.
  // Runs off the recorded inputs, which are the same bytes the replay is judged from, so every
  // flag here is re-checkable by anyone. It can hold a payout; it never bans and never decides
  // the fight.
  const preRecord = { id: M.id, cfg: M.cfg, log: M.slots.map(x => x.log), events: M.events,
    result: { reason, winner, payee: cancelled ? -1 : payee, placements, ticks: G.tick } };
  const metas = M.slots.map(x => ({ human: x.human, dropped: x.dropped, acct: x.th ? accounts.get(x.th).id : null, th: x.th, ip: SAME_IP_OK ? null : x.ip }));
  let ia = null;
  try { ia = integrity.analyseMatch(preRecord, metas, integrityStore); }
  catch (e) { log('integrity analysis failed', M.id, String(e && e.message).split('\n')[0]); }
  if (ia && (ia.hold || ia.maxScore >= 35 || ia.flags.length)) {
    log('integrity', M.id, 'score', ia.maxScore, ia.hold ? 'HOLD' : 'flag',
      ia.slots.filter(s => s.flags && s.flags.length).map(s => `slot${s.slot}:${s.verdict}`).join(' '), ia.flags.join(' | '));
  }
  // ranked 1v1: chess-style Elo (a forfeit is a loss); the weekly season board runs alongside.
  // A held match does not move anyone's rating -- that is the whole point of the ladder.
  let elo = null;
  const ratingBlocked = !!(ia && ia.hold);
  if (M.ranked && !cancelled && humans.length === 2 && !ratingBlocked) {
    const loser = humans.find(x => x.i !== payee);
    const d = accounts.rate(M.slots[payee].th, loser.th, M.cfg.players[payee].char);
    if (d) elo = { [payee]: d.winner, [loser.i]: d.loser };
  } else if (M.ranked && ratingBlocked) log('integrity', M.id, 'ranked rating withheld pending review');
  const record = {
    v: 1, id: M.id, engine: M.digest, created: new Date(M.created).toISOString(), real: M.real ? M.real.id : null,
    cfg: M.cfg, names: M.names, log: M.slots.map(x => x.log), events: M.events,
    dropped: M.slots.filter(x => x.dropped).map(x => x.i),
    stalled: M.slots.filter(x => x.stalled).map(x => x.i), timedOut: !!M.timedOut,
    result: { reason, winner, payee: cancelled ? -1 : payee, placements, ticks: G.tick, frames: G.frame, stake: M.stake, pot: M.pot },
    hashes: Object.fromEntries(M.srvHash),
    integrity: ia,
  };
  const body = JSON.stringify(record);
  const replayHash = '0x' + crypto.createHash('sha256').update(body).digest('hex');
  saveReplay(M.id, body);
  let stats = [];
  try { stats = G.fighters.map(f => ({ kos: f.stats.kos, falls: f.stats.falls, dealt: Math.round(f.stats.dealt), taken: Math.round(f.stats.taken), stocks: f.stocks, dmg: Math.round(f.dmg), combo: f.stats.combo | 0 })); } catch (e) { stats = M.slots.map(() => ({})); }
  // XP, win/loss record and the MONTHLY ladder, computed from the server's own copy of the fight
  // (`stats` above comes from the server's sim, not from any page). A page cannot report a result,
  // so a level — and the weapons a level unlocks — cannot be farmed by lying. A held match pays
  // nothing toward the ladder. lib/economy.js, docs/ECONOMY.md.
  let econ = null;
  try { econ = economy.matchDone(M, { payee: cancelled ? -1 : payee, stats, cancelled, ranked: M.ranked, held: ratingBlocked }); }
  catch (e) { log('economy match failed', M.id, String(e && e.message).split('\n')[0]); }
  // ---- achievements. Scored from `stats` above, which is the SERVER's sim -- same reason the
  // economy is: a page cannot report a result, so a badge cannot be farmed by lying. A held match
  // awards nothing, matching the ladder and the economy. lib/achievements.js.
  let ach = null;
  try { ach = awardAchievements(M, { payee: cancelled ? -1 : payee, stats, cancelled, held: ratingBlocked, placements }); }
  catch (e) { log('achievements failed', M.id, String(e && e.message).split('\n')[0]); }
  const res = { k: 'result', id: M.id, reason, winner, payee: cancelled ? -1 : payee, placements, pot: M.pot, stake: M.stake, deltas, stats, ticks: G.tick,
    replay: replayHash, dropped: record.dropped, desync: M.slots.filter(x => x.desync).map(x => x.i), real: null, ranked: M.ranked, elo, econ, ach };
  if (M.real) {
    const held = ia && ia.hold;
    if (held) {
      // Do NOT report a winner the detector cannot vouch for. The stakes stay in escrow; a human
      // reviews the replay and then reports or cancels by hand. Players are told plainly.
      integrityStore.hold({ at: new Date().toISOString(), match: M.id, escrowId: M.real.id, pot: M.pot,
        winner: cancelled ? null : M.slots[payee].addr, replayHash, score: ia.maxScore, flags: ia.flags,
        slots: ia.slots.filter(s => !s.cpu).map(s => ({ slot: s.slot, acct: s.acct, score: s.score, verdict: s.verdict, flags: s.flags })) });
      integrityStore.flush();
      log('REAL MATCH HELD', M.id, 'escrow', M.real.id, 'score', ia.maxScore, '-- not reported on chain, review by hand');
      res.real = { id: M.real.id, escrow: escrow.address, claim: null, refund: false, held: true };
      res.heldMsg = 'This match was flagged for review. The stakes stay in escrow until it has been checked.';
    } else {
      settleQueue.push(M.real.id, cancelled ? null : M.slots[payee].addr, replayHash, M.id);
      res.real = { id: M.real.id, escrow: escrow.address, claim: cancelled ? null : M.slots[payee].addr, refund: cancelled };
    }
  }
  for (const x of humans) {
    if (!x.client || !x.connected || x.dropped && !x.client.room) continue;
    sendTo(x.client, Object.assign({}, res, { bal: accounts.get(x.th).bal, you: x.i }));
    if (x.client.seat && x.client.seat.M === M) { x.client.seat = null; presence(x.client); }
  }
  log('match', M.id, 'end', reason, 'winner', winner, 'payee', payee, 'ticks', G.tick);
  // THE FINISHED-MATCH RECORD. Built once and used twice: by the tournament, which is the only
  // thing that may move a bracket, and by the keyed /api/matches feed. It is built whenever a
  // tournament exists, not only when TOURNEY_KEY is set -- the key gates the HTTP feed, and gating
  // the bracket on it too is what would have left the event unable to score its own matches.
  const mrec = (CFG.tourneyKey || tourney.ev) ? { id: M.id, at: Date.now(), code: r ? r.code : null, ranked: !!M.ranked, reason,
    winner, cancelled, ticks: G.tick, replay: replayHash,
    players: M.slots.map((x, i) => ({ slot: i, name: x.name, human: !!x.human, dropped: !!x.dropped,
      acct: x.th ? accounts.get(x.th).id : null, x: (M.handles && M.handles[i]) || null,
      stocks: stats[i] ? stats[i].stocks : null, dmg: stats[i] ? stats[i].dmg : null })) } : null;
  if (mrec && CFG.tourneyKey) {
    tourneyFeed.push(mrec);
    if (tourneyFeed.length > CFG.tourneyKeep) tourneyFeed.splice(0, tourneyFeed.length - CFG.tourneyKeep);
  }
  // Only a game played in a room the bracket opened can score, which tourney.js checks against the
  // pair's own room code. A tournament player taking a casual quick match mid-round scores nothing.
  if (mrec && r && r.tourney) { try { tourney.onMatch(mrec); } catch (e) { log('tourney result', e && e.message); } }
  M.sim = null;
  // the room goes back to its lobby with whoever is still here
  if (r) {
    r.match = null; r.state = 'lobby'; r.funding = null;
    r.members = r.members.filter(m => m.c && m.c.room === r && clients.has(m.c));
    for (const m of r.members) m.ready = false;
    if (!r.members.length) closeRoom(r);
    else { if (!r.members.some(m => m.id === r.hostId)) r.hostId = r.members[0].id; if (r.quick && r.members.length >= 2) r.readyBy = Date.now() + CFG.readyWindowMs; broadcastRoom(r); }
  }
}

// THE REPLAY STORE, and the biggest single source of lag this server had.
//
// One file per finished match, oldest pruned at CFG.keepReplays. Both halves of that used to happen
// on the event loop at the instant a match ended: a synchronous write of the whole body, and then a
// readdirSync plus a statSync of every file kept. At 400 kept that is 400 blocking stat calls per
// match end -- measured under load at ~17,000 stat calls a second, ~0.5 s of every 5 s spent inside
// the prune, an event-loop p99 over a second, and 85,000 Stats objects per 5 s for the GC to clear.
//
// In lockstep a blocked loop is not one slow match. Game time only advances when every input for a
// tick has arrived, so a stalled loop is input delay added to every player in every match on the box
// at once. That is what "it lags too much" was.
//
// So the file list lives in memory, built once at boot; the write is async; and the prune is an
// unlink of a name already known. A replay is readable the instant the match ends because its body
// is held in `replayHot` until the write lands.
const replayNames = [];           // file names, oldest first
const replayHot = new Map();      // id -> body, only while its write is in flight
let replayHotBytes = 0;
const REPLAY_HOT_MAX = +process.env.REPLAY_HOT_MAX || 64 * 1024 * 1024;

function replayBoot() {
  try {
    const files = fs.readdirSync(replayDir).filter(f => f.endsWith('.json'));
    files.map(f => { let t = 0; try { t = fs.statSync(path.join(replayDir, f)).mtimeMs; } catch (e) { /* vanished */ } return { f, t }; })
      .sort((a, b) => a.t - b.t).forEach(x => replayNames.push(x.f));
    while (replayNames.length > CFG.keepReplays) dropOldestReplay();
  } catch (e) { log('replay boot failed', e.message); }
}

function dropOldestReplay() {
  const f = replayNames.shift();
  if (!f) return;
  fs.unlink(path.join(replayDir, f), e => { if (e && e.code !== 'ENOENT') log('replay unlink failed', f, e.message); });
}

// Never drops a replay: they are the record a disputed match is settled from. If writes are falling
// behind badly enough to hold REPLAY_HOT_MAX in memory, this takes the stall rather than the risk.
function saveReplay(id, body) {
  const name = id + '.json', file = path.join(replayDir, name);
  if (replayHotBytes + body.length > REPLAY_HOT_MAX) {
    try { fs.writeFileSync(file, body); replayNames.push(name); while (replayNames.length > CFG.keepReplays) dropOldestReplay(); }
    catch (e) { log('replay write failed', id, e.message); }
    return;
  }
  replayHot.set(id, body); replayHotBytes += body.length;
  fs.writeFile(file, body, e => {
    replayHot.delete(id); replayHotBytes -= body.length;
    if (e) return log('replay write failed', id, e.message);
    replayNames.push(name);
    while (replayNames.length > CFG.keepReplays) dropOldestReplay();
  });
}
// One readdir + stat pass, at boot, while nobody is playing. Declared above as `const`, so this call
// has to live below them rather than up with the mkdir.
replayBoot();

// ------------------------------------------------------------------ real-money (escrow) flow, off by default
//
// FUNDING FLOOD PROTECTION (finding H5). Opening a real-ETH match is an on-chain transaction the
// OPERATOR pays for, and it is triggered by nothing more than two players readying up. Two
// sock-puppet wallets looping ready/unready therefore burn the operator's gas for free, and -- the
// part that actually costs money -- push real settlements down the operator's transaction queue
// toward BrawlEscrow's 2 h REPORT_TIMEOUT, where the loser of a finished match can cancel() out
// from under the winner.
//
// Four layers, because no single one of them is enough:
//   1. lib/escrow.js runs `report`/`cancel` in a lane that always overtakes queued `open`s, so a
//      flood can never delay a payout however big it gets. This is the one that protects the money.
//   2. A per-account budget on chain opens. An abandoned funding cycle SPENDS budget; a cycle that
//      actually funds gives it back, so a real player who plays all evening is never blocked while
//      a puppet that never deposits runs out after FUND_PER_ACCT tries.
//   3. A global ceiling on how many rooms may sit in `funding` at once, which bounds the operator's
//      total gas exposure regardless of how many accounts an attacker controls.
//   4. A debounce: both seats must hold `ready` for FUND_DEBOUNCE_MS before anything is sent, so a
//      ready/unready flicker produces no transaction at all.
const FUND_PER_ACCT = +process.env.FUND_PER_ACCT || 6;            // chain opens per account per window
const FUND_BUDGET_WINDOW = +process.env.FUND_BUDGET_WINDOW_MS || 3600e3;
const MAX_FUNDING = +process.env.MAX_FUNDING || 8;                // rooms in the funding state at once
const FUND_DEBOUNCE_MS = +process.env.FUND_DEBOUNCE_MS || 1500;
const MAX_OPEN_QUEUE = +process.env.MAX_OPEN_QUEUE || 6;          // queued `open` txs before we stop accepting more
const fundBudget = new Map();   // account id -> { n, at }
setInterval(() => { const cut = Date.now() - FUND_BUDGET_WINDOW; for (const [k, v] of fundBudget) if (v.at < cut) fundBudget.delete(k); }, 60e3).unref();
function fundingRooms() { let n = 0; for (const x of rooms.values()) if (x.state === 'funding') n++; return n; }
function fundBudgetOf(acct) {
  const now = Date.now();
  let v = fundBudget.get(acct);
  if (!v || now - v.at > FUND_BUDGET_WINDOW) { v = { n: 0, at: now }; fundBudget.set(acct, v); }
  return v;
}
// Charged when a chain `open` is about to be sent; released again in launch() if the match really funds.
function chargeFunding(ms) {
  const ids = ms.map(m => m.c && m.c.acct).filter(Boolean);
  for (const id of ids) if (fundBudgetOf(id).n >= FUND_PER_ACCT) return false;
  for (const id of ids) fundBudgetOf(id).n++;
  return true;
}
function releaseFunding(ms) { for (const m of ms) { const id = m && m.c && m.c.acct; if (!id) continue; const v = fundBudget.get(id); if (v && v.n > 0) v.n--; } }

async function beginFunding(r) {
  const ms = r.members.slice();
  if (ms.some(m => !m.addr)) { for (const m of ms) if (!m.addr) { m.ready = false; err(m.c, 'Connect your wallet first.'); } broadcastRoom(r); return; }
  if (fundingRooms() >= MAX_FUNDING) {
    for (const m of ms) { m.ready = false; err(m.c, 'Too many real-ETH matches are being funded right now. Try again in a minute.', 'busy'); }
    broadcastRoom(r); return;
  }
  if (escrow.depth(1) >= MAX_OPEN_QUEUE) {
    for (const m of ms) { m.ready = false; err(m.c, 'The match opener is backed up. Try again in a minute.', 'busy'); }
    broadcastRoom(r); return;
  }
  if (!chargeFunding(ms)) {
    for (const m of ms) { m.ready = false; err(m.c, 'You have opened too many real-ETH matches without funding them. Try again later.', 'fundrate'); }
    log('funding budget exhausted for room', r.code, ms.map(m => m.c && m.c.acct).join(','));
    broadcastRoom(r); return;
  }
  // 6dp stablecoin units for a token escrow, wei for the native one. r.stake is a plain number of
  // whole units (1 = 1 USDC, or 1 ETH), so scale by the right number of decimals.
  const dec = escrow.token ? escrow.tokenDecimals : 18;
  const stakeUnits = BigInt(Math.round(r.stake * 1e6)) * 10n ** BigInt(Math.max(0, dec - 6));
  const stakeWei = stakeUnits;
  const id = '0x' + rid(32), windowSecs = clamp(+process.env.FUND_WINDOW_S || 120, 30, 3600);
  r.state = 'funding'; r.funding = { id, stakeWei: stakeWei.toString(), deadline: Date.now() + windowSecs * 1000, players: ms.map(m => m.addr), polling: false, charged: ms };
  broadcastRoom(r);
  try { await escrow.open(id, ms.map(m => m.addr), stakeWei, windowSecs); if (r.funding && r.funding.id === id) r.funding.opened = true; }
  catch (e) { log('escrow open failed', e.message.split('\n')[0]); abortFunding(r, 'Could not open the match on chain. Nobody was charged.'); return; }
  if (!r.funding || r.funding.id !== id) return;
  for (const m of r.members) sendTo(m.c, { k: 'fund', id, escrow: escrow.address, stakeWei: stakeWei.toString(),
    token: escrow.token, tokenSymbol: escrow.tokenSymbol, tokenDecimals: escrow.token ? escrow.tokenDecimals : 18,
    deadline: r.funding.deadline, chainId: escrow.chainId });
  pollFunding(r, id);
}
async function pollFunding(r, id) {
  while (r.funding && r.funding.id === id && r.state === 'funding') {
    await new Promise(res => setTimeout(res, 2000));
    if (!r.funding || r.funding.id !== id) return;
    try {
      const st = await escrow.getMatch(id);
      // Funded for real: give the funding budget back (H5). Only cycles that are ABANDONED cost an
      // account anything, so an honest player who keeps playing never runs out, while a puppet that
      // readies up and never deposits burns through FUND_PER_ACCT and stops.
      if (st.status === 2) { const f = r.funding; if (f.charged) { releaseFunding(f.charged); f.charged = null; } r.state = 'lobby'; launch(r, { id: f.id }); return; }
      if (Date.now() > r.funding.deadline + 3000) { abortFunding(r, 'Not every player deposited in time. Deposits can be refunded.'); return; }
    } catch (e) { log('escrow poll', e.message); }
  }
}
function abortFunding(r, msg) {
  const f = r.funding; if (!f) return;
  r.funding = null; if (r.state === 'funding') r.state = 'lobby';
  r.fundAt = 0;
  for (const m of r.members) m.ready = false;
  for (const m of r.members) sendTo(m.c, { k: 'fundfail', id: f.id, msg, escrow: escrow.address, refundable: !!f.opened });
  // An abandoned cycle keeps its budget charge -- that is what makes the budget bite a puppet loop.
  // The cancel goes through the SAME persisted, retried queue as a settlement: fire-and-forget was
  // finding H2, and it is the same mistake here. Until the cancel lands, a player who did deposit
  // has to wait for the deposit window before they can refund themselves.
  if (f.opened) settleQueue.push(f.id, null, '0x' + '0'.repeat(64), 'fund:' + r.code);
  broadcastRoom(r);
}
// A settlement must survive an RPC flake, a revert and a restart: if it is lost, the winner's pot
// sits in escrow until someone cancels it after REPORT_TIMEOUT, and they lose a fight they won.
// The queue is written to disk on every change and retried with backoff until the chain agrees.
class SettleQueue {
  constructor(dir) {
    this.file = path.join(dir, 'settlements.json');
    this.items = [];
    try { this.items = JSON.parse(fs.readFileSync(this.file, 'utf8')).items || []; } catch (e) { /* first run */ }
    this.running = false;
  }
  save() { try { const t = this.file + '.tmp'; fs.writeFileSync(t, JSON.stringify({ v: 1, items: this.items })); fs.renameSync(t, this.file); } catch (e) { log('settle queue save failed', e.message); } }
  push(escrowId, winnerAddr, replayHash, matchId) {
    this.items.push({ escrowId, winnerAddr, replayHash, matchId, tries: 0, at: Date.now(), next: 0 });
    this.save(); this.run();
  }
  // BrawlEscrow.Status: 0 None, 1 Open, 2 Funded, 3 Settled, 4 Cancelled.
  // A `report` is only meaningful on a Funded match. A `cancel` is meaningful on Open OR Funded --
  // abortFunding() cancels a match that never reached Funded, and treating Open as "already
  // resolved" would silently abandon it and leave a depositor waiting for the window to expire.
  static actionable(item, status) { return item.winnerAddr ? status === 2 : (status === 1 || status === 2); }
  async run() {
    if (this.running || !escrow) return;
    this.running = true;
    try {
      // Every item is tried on every pass, NOT just the head. The old loop broke out of the queue on
      // the first failure or backoff, so a single settlement that kept reverting -- or merely one
      // that was waiting out its backoff -- held up every payout behind it, indefinitely. That is a
      // lost pot per stuck item, from a queue whose entire job is to make sure pots are not lost.
      const now = Date.now();
      for (const it of this.items.slice()) {
        if (it.done || it.next > now) continue;
        try {
          // Ask the chain first: a restart may have replayed something already settled or cancelled.
          const st = await escrow.getMatch(it.escrowId);
          if (!SettleQueue.actionable(it, st.status)) { log('settle', it.matchId, 'already resolved on chain (status ' + st.status + ')'); it.done = true; }
          else if (it.winnerAddr) { await escrow.report(it.escrowId, it.winnerAddr, it.replayHash); log('settle', it.matchId, 'reported', it.winnerAddr); it.done = true; }
          else { await escrow.cancel(it.escrowId); log('settle', it.matchId, 'cancelled'); it.done = true; }
        } catch (e) {
          it.tries++;
          it.next = Date.now() + Math.min(5 * 60e3, 2000 * Math.pow(2, Math.min(it.tries, 7)));
          log('settle', it.matchId, 'attempt', it.tries, 'failed:', String(e && e.message).split('\n')[0], '- retrying in', Math.round((it.next - Date.now()) / 1000) + 's');
          // BrawlEscrow.REPORT_TIMEOUT is 2 h; shout well before a player can cancel out from under us.
          if (Date.now() - it.at > 45 * 60e3 && !it.shouted) { it.shouted = true; log('ALERT settlement for', it.matchId, 'has been failing for 45 minutes -- the pot is at risk of being refunded at the 2 h timeout'); }
        }
      }
      const before = this.items.length;
      this.items = this.items.filter(it => !it.done);
      if (this.items.length !== before || this.items.some(it => it.tries)) this.save();
    } finally { this.running = false; }
  }
  pending() { return this.items.length; }
  // Anything that has been failing long enough to be at risk, for /healthz and the daily survey.
  stuck(ms = 45 * 60e3) { const cut = Date.now() - ms; return this.items.filter(it => it.at < cut).length; }
}
let settleQueue = { push() {}, pending: () => 0, stuck: () => 0, run() {}, save() {} };
if (CFG.realMoney) {
  settleQueue = new SettleQueue(CFG.dataDir);
  if (settleQueue.pending()) log('resuming', settleQueue.pending(), 'unfinished settlement(s) from the last run');
  setInterval(() => settleQueue.run(), 15000).unref();
  settleQueue.run();
  // Operator gas. If the operator runs dry it stops being able to report winners, and every funded
  // match drifts toward the 2 h timeout where the loser can cancel. Nobody can top it up from here,
  // so the only useful thing this can do is shout early and loudly, in the log the owner watches.
  const GAS_FLOOR = BigInt(Math.round((+process.env.OPERATOR_GAS_FLOOR || 0.02) * 1e6)) * 10n ** 12n;
  let lastGasWarn = 0;
  const checkGas = async () => {
    try {
      const bal = await escrow.balance();
      if (bal < GAS_FLOOR && Date.now() - lastGasWarn > 15 * 60e3) {
        lastGasWarn = Date.now();
        log('ALERT operator gas low:', (Number(bal / 10n ** 12n) / 1e6).toFixed(6), 'ETH at', escrow.operatorAddress,
          '-- below', (Number(GAS_FLOOR / 10n ** 12n) / 1e6).toFixed(6), 'ETH it cannot report winners and funded matches drift to the 2 h refund timeout');
      }
    } catch (e) { /* RPC flake; the next tick tries again */ }
  };
  setInterval(checkGas, 5 * 60e3).unref();
  checkGas();
}

// ------------------------------------------------------------------ messages
const LOBBY_KINDS = new Set(['name', 'quick', 'create', 'join', 'leave', 'pick', 'ready', 'set', 'start', 'widen', 'refill', 'wallet', 'stats', 'look',
  'social', 'friend_add', 'friend_accept', 'friend_decline', 'friend_remove', 'challenge', 'challenge_reply', 'recovery_new', 'recover', 'board',
  'xclaim', 'xverify', 'xforget', 'x_start', 'x_claim', 'x_unlink',
  // the checkout: each of these costs an outbound price-feed or RPC read, so they go in the SLOW
  // bucket with the other lobby messages rather than the 400/s one
  'paymenu', 'payquote', 'payclaim']);
// Reads: they change nothing on the server and the page fires them whenever a panel opens, so they
// get their own bucket rather than spending the one Create and Ready draw from. `paymenu`/`payquote`
// stay in the action bucket on purpose -- each costs an outbound price feed or RPC read.
const QUERY_KINDS = new Set(['stats', 'board', 'social', 'x_start', 'look']);
// Actions: 30 deep refilling at 8/s. It was 24 at 5/s, which a player clicking through room settings
// or the roster can reach, and reaching it means a refused Create. The flood that this is really
// guarding against is bounded elsewhere and more tightly -- MAX_ROOMS_PER_IP caps open rooms per
// address at 4, the funding budget caps real-money opens per account -- so being a little kinder here
// costs nothing. Reads are 40 deep at 20/s: the page fires one per panel it opens.
const ACT_BURST = +process.env.ACT_BURST || 30;
const ACT_RATE = (+process.env.ACT_PER_SEC || 8) / 1000;
const QRY_BURST = +process.env.QRY_BURST || 40;
const QRY_RATE = (+process.env.QRY_PER_SEC || 20) / 1000;

function onMessage(c, raw) {
  const now = Date.now();
  c.tok = Math.min(600, c.tok + (now - c.tokAt) * 0.4); c.tokAt = now;
  if (c.tok < 1) { if (++c.strikes > 300) c.ws.close(1008, 'rate'); return; }
  c.tok -= 1;
  let msg; try { msg = JSON.parse(raw); } catch (e) { return strike(c); }
  if (!msg || typeof msg.k !== 'string') return strike(c);
  // TWO BUCKETS, NOT ONE. Everything in LOBBY_KINDS used to share one 24-deep bucket refilling at
  // 5/s, which meant opening the leaderboard, the store and the social panel -- reads that change
  // nothing -- could empty it and leave the next Create, Join or Ready refused with "Slow down a
  // little". Measured: 19 of 40 `stats` in a row were refused, and the player then could not act.
  // Reads now have their own, roomier bucket, so browsing the menus can never block playing.
  // `leave` is charged to neither: it only releases a seat or a room, and refusing it is what left a
  // player stuck in a room they had already left with a dead Create button.
  if (QUERY_KINDS.has(msg.k)) {
    c.qtok = Math.min(QRY_BURST, c.qtok + (now - c.qtokAt) * QRY_RATE); c.qtokAt = now;
    if (c.qtok < 1) return err(c, 'Slow down a little.', 'rate');
    c.qtok -= 1;
  } else if (LOBBY_KINDS.has(msg.k) && msg.k !== 'leave') {
    c.ltok = Math.min(ACT_BURST, c.ltok + (now - c.ltokAt) * ACT_RATE); c.ltokAt = now;
    if (c.ltok < 1) return err(c, 'Slow down a little.', 'rate');
    c.ltok -= 1;
  }
  if (msg.k !== 'hello' && !c.th) return;
  switch (msg.k) {
    case 'hello': return hello(c, msg);
    case 'ping': {
      // the page's own round trip (includes its main-thread jitter); used with the socket-level one for input delay
      if (Number.isFinite(msg.rtt)) c.appRtt = clamp(msg.rtt, 0, 1500);
      if (Number.isFinite(msg.jit)) c.appJit = clamp(msg.jit, 0, 500);
      return sendTo(c, { k: 'pong', t: msg.t, s: Date.now(), rtt: Math.round(c.rtt) });
    }
    case 'i': return onInput(c, msg);
    case 'h': return onHash(c, msg);
    case 'name': {
      // Duane, 2026-10-16: *"you will use your X name when you are playing"*. A connected account
      // plays under its handle, so a typed name is not an error here -- it is simply not used, and
      // the player is told why instead of watching it silently snap back.
      const a0 = accounts.get(c.th);
      if (a0.x) { sendTo(c, meMsg(c)); return err(c, 'You play as @' + a0.x + ' while your X account is connected.', 'name'); }
      const n = cleanName(msg.name);
      if (!n) return err(c, 'Pick another name, that one is not allowed.', 'name');
      c.name = n; accounts.get(c.th).name = n; accounts.touch();
      if (c.room && c.room.state === 'lobby') { const m = c.room.members.find(x => x.c === c); if (m) m.name = n; broadcastRoom(c.room); }
      pushFriends(c.acct);
      return sendTo(c, meMsg(c));
    }
    case 'refill': {
      const r = accounts.refill(c.th);
      if (!r.ok) return err(c, r.msg, 'refill');
      return sendTo(c, meMsg(c));
    }
    case 'stats': return sendTo(c, statsMsg());
    case 'quick': return quick(c, msg);
    case 'create': return create(c, msg);
    case 'join': return join(c, msg);
    case 'leave': return leave(c);
    case 'pick': return pick(c, msg);
    case 'ready': return ready(c, msg);
    case 'set': return setRoom(c, msg);
    case 'start': return forceStart(c);
    case 'widen': return widen(c);
    case 'wallet': return bindWallet(c, msg);
    case 'chat': return onChat(c, msg);
    case 'look': return onLook(c, msg);
    case 'xclaim': return xClaim(c, msg);
    case 'xverify': return xVerifyNow(c);
    case 'xforget': case 'x_unlink': return xForget(c);
    case 'x_start': return sendTo(c, xState(c));
    case 'x_claim': return xSignedIn(c, msg);
    case 'social': return sendTo(c, socialMsg(c));
    case 'board': return sendTo(c, Object.assign({ k: 'board' }, accounts.leaderboard(100), { mine: accounts.boardPlace(c.acct) }));
    case 'friend_add': return friendAdd(c, msg);
    case 'friend_accept': case 'friend_decline': case 'friend_remove': return friendEdit(c, msg);
    case 'challenge': return challenge(c, msg);
    case 'challenge_reply': return challengeReply(c, msg);
    case 'recovery_new': return sendTo(c, { k: 'recovery', code: accounts.newRecovery(c.th) });
    case 'recover': return recover(c, msg);
    // store + entitlements + loadout (lib/economy.js). A page can only ever read or change its OWN
    // row, and `buy` is refused unless PAYMENTS is set. With PAYMENTS=chain the three `pay*`
    // messages run the crypto checkout (lib/pay.js): a payment goes wallet -> treasury address and
    // is verified on-chain here, so no money and no key ever moves through this process.
    case 'econ': case 'econset': case 'buy':
    // the signed-in X account travels with the message: a receipt stamped with it can be found again
    // from any device, any wallet and any region (lib/pay.js receipts)
    case 'paymenu': case 'payquote': case 'payclaim': case 'payrestore': {
      const a = accounts.byId(c.acct) || {};
      return void economy.handle(c, msg, { sendTo, xid: a.xid || null, x: a.x || null });
    }
    // THE TOURNAMENT (lib/tourney.js). Four messages, and not one of them carries a result, an
    // opponent, a round or a score: the page may enter, withdraw, read the board, and say it is at
    // its match. Everything else about the bracket is decided from fights this server simulated.
    case 'tstate': return tState(c);
    case 'tjoin': return tJoin(c);
    case 'tleave': return tLeave(c);
    case 'tcheckin': return tCheckIn(c);
    // Operator messages, refused outright on any socket that did not present TOURNEY_KEY in `hello`.
    case 'tannounce': case 'tdraw': case 'tforce': return tAdmin(c, msg);
    default: return strike(c);
  }
}
function strike(c) { if (++c.strikes > 300) c.ws.close(1008, 'bad messages'); }

function statsMsg() {
  let waiting = 0; for (const r of rooms.values()) if (r.state === 'lobby' && !r.priv) waiting += r.members.length;
  return { k: 'stats', online: clients.size, matches: matches.size, rooms: rooms.size, waiting };
}

// Minting an account is free and permanent, so without a budget one machine can fill accounts.json
// (rewritten synchronously every 2 s) and the O(n) name/rank scans with millions of rows.
// Returning players are never charged against the budget -- only brand-new tokens.
const newAcctByIp = new Map();
// 30/hour still leaves room for a café, a school or a phone network behind one address, while
// turning the measured 37 new accounts per SECOND into 30 per hour.
const NEW_ACCT_PER_IP = +process.env.NEW_ACCT_PER_IP || 30;      // per window
const NEW_ACCT_WINDOW = +process.env.NEW_ACCT_WINDOW_MS || 3600e3;
const MAX_ACCOUNTS = +process.env.MAX_ACCOUNTS || 500000;
// SECOND LAYER, and the one that holds when the first does not. The per-address budget is only as
// good as the address: behind Caddy that is the real client, but a host that can reach the node
// port directly picks its own X-Forwarded-For, and a /24 of spoofed addresses is 30 x 254 = 7,620
// accounts an hour through a per-address limit alone. A whole-server ceiling does not care how
// many addresses the flood claims to come from.
//
// Sized so it cannot bite a real crowd: 600/hour is ten brand-new players a minute, sustained,
// which is far beyond anything this game has seen. RETURNING players never touch this counter --
// only tokens the server has never seen before -- so it can never lock out the existing playerbase,
// only slow down the creation of new accounts.
const NEW_ACCT_GLOBAL = +process.env.NEW_ACCT_GLOBAL || 600;
let globalMint = { n: 0, at: Date.now() };
setInterval(() => { const cut = Date.now() - NEW_ACCT_WINDOW; for (const [k, v] of newAcctByIp) if (v.at < cut) newAcctByIp.delete(k); }, 60e3).unref();
function mayMintAccount(c) {
  if (accounts.size() >= MAX_ACCOUNTS) { log('account table full at', accounts.size()); return false; }
  const now = Date.now();
  if (now - globalMint.at > NEW_ACCT_WINDOW) globalMint = { n: 0, at: now };
  if (globalMint.n >= NEW_ACCT_GLOBAL) {
    if (!globalMint.shouted) { globalMint.shouted = true; log('ALERT new-account ceiling hit:', NEW_ACCT_GLOBAL, 'in the last hour -- new sign-ups are being refused, existing players are unaffected'); }
    return false;
  }
  const ip = c.ip || '?';
  let v = newAcctByIp.get(ip);
  if (!v || now - v.at > NEW_ACCT_WINDOW) { v = { n: 0, at: now }; newAcctByIp.set(ip, v); }
  if (v.n >= NEW_ACCT_PER_IP) return false;
  v.n++; globalMint.n++;
  return true;
}

// A "test" account is hidden from the leaderboard and DELETED an hour later. Letting the client
// set that flag for itself was rated LOW in the first review, on the grounds that it is self-harm.
// It stopped being self-harm the moment lib/integrity.js started keeping a per-account reputation:
// the bot detector's slow-moving score, its flag count and its cross-match input fingerprints all
// hang off the account id, so an account that deletes itself every hour can never accumulate one.
// A scripted player could self-flag, play wagered matches all day, and arrive at every match with a
// clean history and no cross-match evidence against it. That is an anti-cheat bypass, so the flag
// now needs proof: the shared TEST_KEY, or a connection from the machine the server runs on.
//
// net/test/* set TEST_KEY (or run on loopback). To run the suite against production, set TEST_KEY
// in /opt/brawlstreet/.env and pass the same value; without it the suite's accounts are ordinary
// accounts that show up on the board, which is the safe failure.
const TEST_KEY = process.env.TEST_KEY || '';
function mayMarkTest(c, msg) {
  if (TEST_KEY) return typeof msg.testKey === 'string' && msg.testKey.length === TEST_KEY.length
    && crypto.timingSafeEqual(Buffer.from(msg.testKey), Buffer.from(TEST_KEY));
  // No key set: only a genuinely DIRECT loopback connection counts, which is `c.direct` -- the TCP
  // peer is loopback AND the request carried no X-Forwarded-For at all.
  //
  // Not c.ip: that value is derived from X-Forwarded-For, which the client writes. A client can put
  // "198.51.100.44, 127.0.0.1" in the header and c.ip becomes 127.0.0.1, so testing c.ip for
  // loopback would hand the flag to anyone who asked for it. Behind Caddy every request carries the
  // header, so c.direct is false for every real player and this branch grants nothing in production.
  return !!c.direct;
}

function hello(c, msg) {
  if (c.th) return;
  if (msg.v !== PROTO) { err(c, 'Your game is out of date. Reload the page.', 'proto'); return c.ws.close(4001, 'proto'); }
  if (typeof msg.token !== 'string' || !/^[0-9a-f]{32,128}$/.test(msg.token)) return c.ws.close(4002, 'token');
  const th = Accounts.hashToken(msg.token);
  if (!accounts.has(th) && !mayMintAccount(c)) {
    err(c, 'Too many new players from your connection just now. Try again in a little while.', 'newacct');
    return c.ws.close(4004, 'new account rate');
  }
  c.th = th;
  const old = byToken.get(c.th);
  if (old && old !== c) {
    log('second socket for one device: replacing', old.id, '->', c.id, old.seat ? '(was in a match)' : old.room ? '(was in room ' + old.room.code + ')' : '');
    sendTo(old, { k: 'kicked', msg: 'You opened Brawlstreet online in another tab.' }); detach(old); old.ws.close(4000, 'replaced');
  }
  byToken.set(c.th, c);
  // THE OPERATOR SOCKET, promised by the TOURNEY_KEY comment in CFG and never built. tools/
  // tournament.js presents the key here and gets the three admin messages; every other socket is
  // struck off for sending one. False whenever the key is unset, so a server with no key has no
  // operator and the admin messages do not exist.
  if (msg.opkey !== undefined) {
    c.op = tourneyAuth(msg.opkey);
    if (!c.op) { log('operator key refused from', c.id); return c.ws.close(4005, 'opkey'); }
    log('operator socket', c.id);
  }
  const acct = accounts.get(c.th);
  if (msg.test === true && !acct.test && mayMarkTest(c, msg)) { acct.test = true; accounts.touch(); }
  // A connected account always comes back as its handle: the page still sends whatever name it has
  // in local storage, and honouring that would quietly undo the X name on every reload.
  c.name = acct.x || cleanName(msg.name) || acct.name || 'Player ' + (1000 + rint(9000));
  acct.name = c.name;
  attachAcct(c, acct.id);
  const E = engine.get(msg.build);
  c.buildOk = !!E; c.digest = E ? E.digest : null;
  if (msg.pings && typeof msg.pings === 'object') {
    c.regionPings = {};
    for (const [k, v] of Object.entries(msg.pings)) if (/^[a-z0-9_-]{1,12}$/.test(k) && Number.isFinite(v)) c.regionPings[k] = clamp(Math.round(v), 0, 2000);
  }
  sendTo(c, { k: 'welcome', proto: PROTO, id: c.id, name: c.name, bal: acct.bal, games: acct.games, wins: acct.wins, build: { ok: c.buildOk, server: engine.digest },
    chars: (E || engine.get(engine.digest)).chars, stakes: STAKES, stages: (E || engine.get(engine.digest)).stages, url: CFG.publicUrl, now: Date.now(),
    real: escrow ? Object.assign(escrow.info(), { stakes: REAL_STAKES }) : null, stats: statsMsg(), chatFree: CFG.chatFree, quickChat: chat.QUICK,
    region: { id: CFG.region, label: CFG.regionLabel }, regions: REGIONS,
    // Enough for the title menu to paint its badge without opening the screen: is there an event,
    // what phase, how many seats are gone, and when the next thing happens.
    tn: tourney.ev ? { id: tourney.ev.id, name: tourney.ev.name, phase: tourney.phase, cap: tourney.ev.cap,
      seats: tourney.seats(), opensAt: tourney.ev.opensAt, closesAt: tourney.ev.closesAt, startsAt: tourney.ev.startsAt,
      mine: !!(tourney.entrant(acct.id) && tourney.entrant(acct.id).status !== 'out') } : null,
    profile: profileOf(acct) });
  sendTo(c, socialMsg(c));
  // back into a match that is still running?
  for (const M of matches) {
    const S = M.slots.find(s => s.human && s.th === c.th && !s.dropped);
    if (!S) continue;
    // came back on a build we cannot replay: end their part now rather than making the other player wait out the stall
    if (!c.buildOk) { log('match', M.id, 'slot', S.i, 'came back on a different build'); err(c, 'Your game updated mid-match, so the match went on without you.', 'build'); dropSeat(M, S.i, 'version'); break; }
    S.client = c; S.connected = true; S.discAt = 0; c.seat = { M, i: S.i }; c.room = M.room;
    if (S.member) S.member.c = c;
    const G = M.sim.Game;
    sendTo(c, resumeMsg(M, S.i));
    toPlayers(M, { k: 'lag', slots: [{ slot: S.i, back: true }] }, S.i);
    log('match', M.id, 'slot', S.i, 'rejoined');
    return;
  }
}

function requireBuild(c) {
  if (c.buildOk) return true;
  err(c, 'This copy of the game is a different version from the server. Open the online page and reload.', 'build');
  return false;
}
function validStake(r, v) { return r ? REAL_STAKES.includes(v) : STAKES.includes(v); }

// THE DEAD CREATE BUTTON (2026-10-18), reported as room creation not succeeding reliably.
//
// `create` and `quick` both used to open with
//     if (!requireBuild(c) || c.seat || (c.room && c.room.state !== 'lobby')) return;
// a bare return, with nothing sent back. Whenever the server still had the socket attached to a seat
// or to a room that was no longer in its lobby -- a match the page has already left behind, a `leave`
// that was refused by the rate limiter, a result screen closed early -- the press was swallowed. No
// room, no error, nothing for the page to react to or to recover from, so pressing it again did
// nothing again. A player in that state has a dead Create button for the rest of the session.
//
// A player pressing Create or Quick has said plainly that they want a new match, so clear the stale
// attachment and give them one. The exception is money: a wagered match must never be forfeited by a
// stray click, so that one is refused out loud, with a code the page can show.
function freeForLobby(c, what) {
  if (c.seat && !c.seat.M.ended) {
    const { M, i } = c.seat;
    if (M.real) { err(c, 'You are still in a wagered match. Finish it, or leave it from the match screen.', 'inmatch'); return false; }
    log('stale seat cleared by', what, 'match', M.id, 'slot', i);
    M.slots[i].left = true; dropSeat(M, i, 'left');
  }
  c.seat = null;
  const r = c.room;
  if (r && r.state !== 'lobby') {
    if (r.real) { err(c, 'You are still in a wagered room. Leave it first.', 'inmatch'); return false; }
    c.room = null;
    const k = r.members.findIndex(m => m.c === c);
    if (k >= 0) r.members.splice(k, 1);
    if (r.hostId === c.id && r.members.length) r.hostId = r.members[0].id;
    if (!r.members.length && r.state !== 'match') closeRoom(r);
  } else if (r) leaveRoom(c);
  return true;
}

function quick(c, msg) {
  if (!requireBuild(c) || !freeForLobby(c, 'quick')) return;
  const size = msg.size === 4 ? 4 : 2, stake = Number(msg.stake) || 0;
  if (!validStake(false, stake)) return err(c, 'Pick one of the listed stakes.');
  const want = cleanPool(msg.stages, c.digest, c.acct);
  c.wantStages = want;
  // A QUICK 1v1 IS RANKED, AND RANKED REFUSES TWO PLAYERS ON ONE ADDRESS. This loop skipped rooms
  // holding the same ACCOUNT but not the same IP, so the matchmaker kept choosing a room that
  // joinRoom was then obliged to refuse -- the player got "Someone on your connection is already in
  // this room" and no match, while a perfectly good opponent sat in another room.
  // Measured 10/18 with eight players in Germany and eight in Thailand all pressing Quick Match at
  // once: 2 of 16 got a match, the rest were paired with their own countrymen and bounced. That is
  // the shape of an event, where whole groups share one connection: a venue, an office, a family.
  // Skipping those rooms HERE means they are never chosen, so the two groups pair across instead.
  const ranked = size === 2;
  let best = null;
  for (const r of rooms.values()) {
    if (r.priv || !r.quick || r.real || r.state !== 'lobby' || r.size !== size || r.stake !== stake || r.members.length >= size || r === c.room || r.digest !== c.digest) continue;
    if (r.members.some(m => m.c && m.c.acct === c.acct)) continue;
    if (ranked && !SAME_IP_OK && c.ip && r.members.some(m => m.c && m.c.ip && m.c.ip === c.ip)) continue;
    if (!poolsFit(r.pool, want)) continue;   // no map both sides want
    if (!best || r.created < best.created) best = r;
  }
  if (!best) { best = makeRoom(c, { quick: true, size, stake, stage: 'random', stocks: 3, items: true, cpuFill: size === 4, ranked: size === 2, pool: want }); if (!best) return; }
  joinRoom(c, best);
}
function create(c, msg) {
  if (!requireBuild(c) || !freeForLobby(c, 'create')) return;
  const real = !!(msg.real && escrow);
  const stake = Number(msg.stake) || 0;
  if (!validStake(real, stake)) return err(c, 'Pick one of the listed stakes.');
  // Practice matches may run on any build the server still has loaded, so a page mid-rollout keeps
  // playing. Money may not: the client picks the build, and an older one can carry a fight bug that
  // has since been fixed. Real-ETH rooms run the current engine or nothing.
  if (real && c.digest !== engine.digest) return err(c, 'Real-ETH matches need the current version of the game. Reload the page.', 'build');
  const r = makeRoom(c, { priv: true, size: msg.size === 4 ? 4 : 2, stake, stage: msg.stage, stocks: msg.stocks, items: msg.items, cpuFill: msg.cpuFill, real, ranked: !!msg.ranked });
  if (r) joinRoom(c, r);
}
function join(c, msg) {
  if (!requireBuild(c)) return;
  const code = String(msg.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  const r = rooms.get(code);
  if (!r) return err(c, 'No room with code ' + (code || '?') + '. Check the code and try again.', 'noroom');
  // THE ROOM THIS SOCKET IS ALREADY IN is not a request to go somewhere else. The page re-sends
  // `join` for its last room after a reconnect (77_net.js, on welcome), and a reconnect into a live
  // match has already been restored by `hello` with a `resume` -- so treating this as "leave what
  // you are in and join" would forfeit the match the player just came back to. Answer with where
  // they are instead.
  if ((c.seat && c.seat.M.room === r) || c.room === r) {
    if (c.seat && !c.seat.M.ended) return sendTo(c, resumeMsg(c.seat.M, c.seat.i));
    return sendTo(c, roomView(r, c));
  }
  // Going somewhere else, so the same dead-button door as `create`: pasting a room code while the
  // server still held a stale seat used to do nothing at all.
  if (!freeForLobby(c, 'join')) return;
  joinRoom(c, r);
}
function leave(c) {
  const seat = c.seat;
  if (seat && !seat.M.ended) { const { M, i } = seat; M.slots[i].left = true; dropSeat(M, i, 'left'); }
  c.seat = null;
  if (c.room && c.room.state === 'match') {
    const r = c.room; c.room = null;
    const k = r.members.findIndex(m => m.c === c); if (k >= 0) r.members.splice(k, 1);
    if (r.hostId === c.id && r.members.length) r.hostId = r.members[0].id;
    sendTo(c, { k: 'left' }); return;
  }
  leaveRoom(c); sendTo(c, { k: 'left' });
}
function memberOf(c) { const r = c.room; return r && r.members.find(m => m.c === c); }
function pick(c, msg) {
  const r = c.room, m = memberOf(c); if (!m || r.state !== 'lobby') return;
  if (!engine.get(r.digest).chars.includes(msg.char)) return err(c, 'Unknown fighter.');
  // the secret fighter is on the engine's list (both sides need the same table) but not everybody's
  if (!vaultOk(c.acct, 'fighter', msg.char)) return err(c, vaultName('fighter', msg.char) + ' is a vault fighter. Unlock it in the store and it is yours on every device.', 'vault');
  m.char = msg.char; broadcastRoom(r);
}
function ready(c, msg) {
  const r = c.room, m = memberOf(c); if (!m || r.state !== 'lobby') return;
  const on = !!msg.on;
  if (on && !r.real && accounts.get(c.th).bal + 1e-9 < r.stake) return err(c, 'Not enough practice ETH for this stake. Refill it or ask the host to lower the stake.', 'funds');
  if (on && r.real && !m.addr) return err(c, 'Connect your wallet first.', 'wallet');
  m.ready = on; broadcastRoom(r); maybeStart(r);
}
function setRoom(c, msg) {
  const r = c.room; if (!r || r.state !== 'lobby' || r.hostId !== c.id || r.quick) return;
  let reset = false;
  if (msg.stage && msg.stage !== 'random' && !vaultOk(c.acct, 'stage', msg.stage)) {
    err(c, vaultName('stage', msg.stage) + ' is a vault stage. Unlock it in the store and it is yours on every device.', 'vault');
  } else if (engine.get(r.digest).stages.some(x => x.id === msg.stage) || msg.stage === 'random') r.stage = msg.stage;
  if (msg.stocks != null) r.stocks = clamp(msg.stocks | 0, 1, 5);
  if (msg.items != null) r.items = !!msg.items;
  if (msg.cpuFill != null) {
    if (r.real && msg.cpuFill) err(c, 'A wagered match is players only. Fill the seats with people, or drop the stake.', 'cpu');
    r.cpuFill = r.size === 4 && !!msg.cpuFill && !r.real;
  }
  if (msg.ranked != null) r.ranked = r.size === 2 && !!msg.ranked;
  if (msg.stake != null && validStake(r.real, Number(msg.stake)) && Number(msg.stake) !== r.stake) { r.stake = Number(msg.stake); reset = true; }
  if (msg.size === 2 || msg.size === 4) {
    if (msg.size !== r.size && r.members.length <= msg.size) { r.size = msg.size; r.cpuFill = r.size === 4 && r.cpuFill; r.ranked = r.size === 2 && r.ranked; reset = true; }
  }
  if (reset) for (const m of r.members) m.ready = false;
  broadcastRoom(r); maybeStart(r);
}
// "waiting too long with a narrow pick": drop the map filter and look for a match again
function widen(c) {
  const r = c.room;
  if (!r || !r.quick || r.state !== 'lobby') return;
  c.wantStages = [];
  const m = memberOf(c); if (m) m.pool = [];
  if (r.members.length > 1) { r.pool = r.members.reduce((acc, x) => overlap(acc, x.pool || []), []); broadcastRoom(r); return; }
  const size = r.size, stake = r.stake;
  leaveRoom(c);
  quick(c, { size, stake, stages: [] });
}

function forceStart(c) {
  const r = c.room; if (!r || r.state !== 'lobby' || r.hostId !== c.id) return;
  if (r.size !== 4) return err(c, 'A 1v1 starts when both players are ready.');
  if (r.members.length < 2 || !r.members.every(m => m.ready)) return err(c, 'Everyone in the room has to be ready.');
  startMatch(r);
}
async function bindWallet(c, msg) {
  const r = c.room, m = memberOf(c); if (!m || !r.real || !escrow || r.state !== 'lobby') return;
  const addr = String(msg.addr || '');
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) return err(c, 'Bad wallet address.');
  const text = walletMessage(r, m);
  let ok = false; try { ok = await escrow.verify(addr, text, msg.sig); } catch (e) { ok = false; }
  if (!ok) return err(c, 'Wallet signature did not check out. Try again.', 'wallet');
  if (r.members.some(x => x !== m && x.addr && x.addr.toLowerCase() === addr.toLowerCase())) return err(c, 'That wallet is already in this room.');
  m.addr = addr; m.nonce = rid(8); broadcastRoom(r);
}
function walletMessage(r, m) { return `Brawl Street online\nRoom ${r.code}\nPlayer ${m.id}\nNonce ${m.nonce}`; }

function onInput(c, msg) {
  const seat = c.seat;
  if (!seat) {
    // a few batches always arrive after a match ends; only log the case that matters
    if (c.room && c.room.state === 'match' && (!c.noSeatLog || Date.now() - c.noSeatLog > 5000)) { c.noSeatLog = Date.now(); log('input from a client with no seat', c.id, 'room', c.room.code); }
    return;
  }
  const { M, i } = seat, S = M.slots[i];
  if (M.ended || S.dropped) return;
  let t = msg.t, arr = msg.m;
  if (!Number.isInteger(t) || !Array.isArray(arr) || !arr.length || arr.length > 64) return strike(c);
  for (const m of arr) if (!Number.isInteger(m) || m < 0 || m > MASK_MAX) return strike(c);
  // a hole in the stream (a batch that never arrived): ask for it again instead of ignoring the rest for ever
  if (t > S.log.length) { sendTo(c, { k: 'need', t: S.log.length }); if (!S.needLog || Date.now() - S.needLog > 5000) { S.needLog = Date.now(); log('match', M.id, 'input gap slot', i, 'want', S.log.length, 'got', t); } return; }
  if (t < S.log.length) { const skip = S.log.length - t; if (skip >= arr.length) return; arr = arr.slice(skip); t = S.log.length; }
  if (S.log.length + arr.length > M.sim.Game.tick + 600) return strike(c);
  for (const m of arr) S.log.push(m);
  toPlayers(M, { k: 'i', p: i, t, m: arr }, i);
  advance(M);
}
function onHash(c, msg) {
  const seat = c.seat; if (!seat) return;
  const { M, i } = seat;
  if (M.ended || !Number.isInteger(msg.t) || typeof msg.h !== 'string' || msg.h.length > 16) return;
  const sh = M.srvHash.get(msg.t);
  if (sh !== undefined) { if (sh !== msg.h) desync(M, i, msg.t); return; }
  if (msg.t <= M.sim.Game.tick) return;   // older than what we keep
  let p = M.cliHash.get(msg.t); if (!p) { if (M.cliHash.size > 200) return; p = new Map(); M.cliHash.set(msg.t, p); }
  p.set(i, msg.h);
}

// ------------------------------------------------------------------ profile, looks, chat
// Only a VERIFIED handle is ever shown. `a.x` is written by xverify and by nothing else, so a name
// over a fighter's head is always an X account that player proved they control.
function handleOf(a) { return (a && a.x) || null; }
function profileOf(a) {
  const se = accounts.season(a);
  return { id: a.id, fc: a.fc, name: a.name, look: a.look || null, elo: a.elo, rated: a.rg, rw: a.rw, rl: a.rl, rank: accounts.rankOf(a),
    season: { id: se.id, elo: se.elo, g: se.g, w: se.w, l: se.l }, games: a.games, wins: a.wins, recovery: !!a.recAt,
    // the VERIFIED X handle (lib/xverify.js). Never from `look`, which anyone could type into.
    x: a.x || null, xav: a.xav || null };
}
function meMsg(c) { const a = accounts.get(c.th); return { k: 'me', name: c.name, bal: a.bal, profile: profileOf(a) }; }

// The creator (86_custom.js) owns the look's shape and keeps adding parts, so keep whatever it sends
// as long as each value is a short safe token: dropping unknown keys would strip new gear from opponents.
function cleanTitle(v) { return chat.filter(String(v == null ? '' : v).replace(/[^\w .\-]/g, '').replace(/\s+/g, ' ').trim()).slice(0, 22); }
// optional X handle: no @, a-z0-9_, 15 max, same name filter. Shown as plain text, never as a profile link.
function cleanHandle(v) {
  const h = String(v == null ? '' : v).trim().replace(/^@+/, '').toLowerCase();
  return /^[a-z0-9_]{1,15}$/.test(h) && chat.nameOk(h) ? h : '';
}
function cleanLook(lk) {
  if (!lk || typeof lk !== 'object') return null;
  const base = typeof lk.base === 'string' && /^[a-z0-9_]{1,16}$/.test(lk.base) ? lk.base : null;
  if (!base || !engine.get(engine.digest).chars.includes(base)) return null;
  const out = { v: 1, base };
  let n = 0;
  for (const [k, v] of Object.entries(lk)) {
    if (k === 'base' || k === 'v' || !/^[a-z][a-z0-9]{0,15}$/i.test(k) || ++n > 40) continue;
    if (k === 'name') out.name = cleanName(v);
    else if (k === 'title') out.title = cleanTitle(v);
    // `x` is NOT accepted here any more. The handle used to be a free-text field on the custom
    // fighter, so anybody could put @elonmusk over their head in a match people were betting on.
    // It now lives on the account and only xverify (lib/xverify.js) can set it. Silently dropped
    // rather than rejected, so an older page saving its look does not break.
    else if (k === 'x') { /* verified on the account, never self-set */ }
    else if (typeof v === 'string' && /^[#a-z0-9_.-]{1,20}$/i.test(v)) out[k] = v;
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
  }
  if (!out.name) out.name = 'Rookie';
  return out;
}
// ---- X handle: connect it, never type it (lib/xverify.js) ----
function xState(c) {
  const a = accounts.get(c.th), p = xv.pending(a.id);
  return { k: 'xstate', x: a.x || null, xav: a.xav || null, pending: p, oauth: xv.oauthReady() };
}
// Binding an account to a verified X identity, from wherever the proof arrived.
function xBind(a, r) {
  a.x = r.x; a.xid = r.xid; a.xav = r.xav; a.xat = Date.now();
  // YOUR X NAME IS YOUR NAME. Duane, 2026-10-16: *"you will use your X name when you are playing
  // for example"*. So the handle becomes the account name the moment it is proved -- name tags,
  // lobby cards, the leaderboard and the friends list all read a.name, so this one line is what
  // puts the connected handle everywhere a player is shown, with no screen having to know about X.
  a.name = r.x;
  accounts.touch();
  log('x connected', a.id, '@' + r.x);
}
// Every socket on this account now plays under the handle, including tabs opened before the connect.
function pushXName(accId) {
  const a = accounts.byId(accId); if (!a || !a.x) return;
  for (const c of connsFor(accId)) {
    if (c.name === a.x) continue;
    c.name = a.x;
    if (c.room) { const m = c.room.members.find(x => x.c === c); if (m) m.name = a.x; }
    sendTo(c, meMsg(c));
  }
  pushFriends(accId);
}
// Everyone currently connected on this account (a player may have the game open in two tabs).
function connsFor(accId) { const out = []; for (const c of clients) { if (c.th && accounts.get(c.th).id === accId) out.push(c); } return out; }
function pushXState(accId) {
  const a = accounts.byId(accId);
  pushXName(accId);
  for (const c of connsFor(accId)) {
    sendTo(c, xState(c));
    // the title-screen plate (src/78b_xlink.js) listens for this one, not for xstate
    if (a && a.x) sendTo(c, { k: 'x_linked', h: a.x });
    if (c.room) broadcastRoom(c.room);
  }
}

// ---- ONE-CLICK SIGN IN WITH X: the popup did the OAuth, this checks its signature -------------
//
// src/78b_xlink.js opens the verify origin (bs-xverify), X sends the player back there, and that
// service hands the page a short HMAC token over the handle it read from `GET /2/users/me`. The
// page is a client and cannot be trusted with "I am @someone" on its own -- a player could type
// that message by hand -- so the token IS the proof: same secret, same payload, inside its ten
// minutes, or nothing is bound. Without X_LINK_SECRET here there is no way to check it, so the
// route refuses rather than trusting the claim; the bio-code route (xclaim) still works.
const X_LINK_SECRET = process.env.X_LINK_SECRET || '';
const b64urlBuf = s => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
function xLinkCheck(tok) {
  if (!X_LINK_SECRET) return null;
  const parts = String(tok || '').split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const want = crypto.createHmac('sha256', X_LINK_SECRET).update(parts[0]).digest();
  const got = b64urlBuf(parts[1]);
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  let p; try { p = JSON.parse(b64urlBuf(parts[0]).toString('utf8')); } catch (e) { return null; }
  if (!p || !p.h || !okHandle(String(p.h))) return null;
  if (!p.exp || Date.now() > Number(p.exp)) return null;
  if (!p.id || !/^[0-9]{1,25}$/.test(String(p.id))) return null;
  return { x: String(p.h), xid: String(p.id), xav: null, xname: null, ok: true };
}
function xSignedIn(c, msg) {
  if (!X_LINK_SECRET) return err(c, 'Sign in with X is not switched on yet. Connect your handle below instead.', 'x');
  const r = xLinkCheck(msg && msg.tok);
  if (!r) return err(c, 'That X sign-in could not be checked. Press Connect X again.', 'x');
  const me = accounts.get(c.th);
  const other = accounts.byXid(r.xid);
  // same rule as the bio-code route: an X account that is already on an account is a SIGN-IN
  if (other && other.id !== me.id) return xAdopt(c, Object.assign(r, { adopt: other.id }));
  xv.cancel(me.id);                     // a half-finished bio-code claim is moot now
  xBind(me, r);
  pushXState(me.id);
  xAvatar(me.id, r.x);
}
// The OAuth scope we ask for does not include the profile image, and asking for more to get an
// avatar is not worth it. The public mirror already used by the bio-code route has it, so fill it
// in afterwards, best effort: the connection is already done and must not wait on a third party.
function xAvatar(accId, handle) {
  Promise.resolve().then(() => xv.fetchProfile(handle)).then(p => {
    const a = accounts.byId(accId);
    if (!a || !p || String(a.x || '').toLowerCase() !== String(handle).toLowerCase()) return;
    if (!p.avatar_url || a.xav === p.avatar_url) return;
    a.xav = p.avatar_url;
    if (p.screen_name) a.x = p.screen_name;       // the capitalisation the player actually uses
    accounts.touch();
    pushXState(accId);
  }).catch(e => log('x avatar', e.message));
}
function xClaim(c, msg) {
  const me = accounts.get(c.th);
  const heldBy = h => { const a = accounts.byHandle(h); return a ? a.id : null; };
  const r = xv.claim(me.id, msg && msg.handle, heldBy);
  if (r.err) return err(c, r.err, 'x');
  sendTo(c, xState(c));
  // Watch for them. They are over on X editing a bio; coming back to press a button is the step
  // people give up on, so the server checks on their behalf and the page flips by itself.
  const holder = id => { const b = accounts.byXid(id); return b ? b.id : null; };
  xv.startPolling(me.id, holder, (accId, res) => {
    const acc = accounts.byId(accId); if (!acc) return;
    // the handle turned out to be on an existing account: this is a sign-in, not a fresh connect
    if (res.adopt) {
      // snapshot FIRST -- the device token moves on the first adopt, so connsFor() would come back
      // empty for the second tab on the same device
      for (const cc of connsFor(accId)) xAdopt(cc, res);
      return;
    }
    xBind(acc, res);
    pushXState(accId);
  });
}
async function xVerifyNow(c) {
  const me = accounts.get(c.th);
  // the check is "is this X account on SOMEBODY ELSE's account", so compare account ids, not tokens
  const holder = id => { const a = accounts.byXid(id); return a ? a.id : null; };
  let r;
  try { r = await xv.verify(me.id, holder); }
  catch (e) { log('xverify', e.message); return err(c, 'Could not check that right now. Try again in a moment.', 'x'); }
  if (r.err) return err(c, r.err, 'x');
  if (r.adopt) return xAdopt(c, r);
  xBind(accounts.get(c.th), r);
  pushXState(me.id);
}
// ---- SIGNING IN: the verified X account already has an account, so this device joins it ----------
// This is the half that makes a purchase permanent. Everything bought is an entitlement on the
// ACCOUNT (lib/economy.js), and the account used to be reachable only through this browser's device
// token -- so clearing site data lost a paid stage. A verified X id is now a way back in from any
// device, and anything bought on the device before signing in comes with it.
function xAdopt(c, r) {
  if (c.room || c.seat) return err(c, 'Leave your room first, then connect.', 'x');
  const target = accounts.byId(r.adopt);
  if (!target) return err(c, 'That account could not be found. Try again in a moment.', 'x');
  const from = accounts.idFor(c.th);
  const prev = from ? accounts.byId(from) : null;
  // WHAT CARRIES OVER, AND WHAT MUST NOT. Moving the purchases off the device's old account is the
  // point -- buy something, then sign in, and it comes with you. But on a shared computer the old
  // account may belong to somebody else, and emptying it would take their things.
  // So it only happens when that account is plainly a scratch one: never signed in to an X account
  // of its own, and no rated games on it. Anything with either is left exactly as it is, and the
  // person who owns it still has their own way back to it.
  const scratch = !!prev && !prev.x && !(prev.rg > 0);
  if (from && from !== target.id && scratch) economy.mergeInto(from, target.id);
  xBind(target, r);                       // refresh the handle and the avatar while we are here
  c.name = target.name || c.name;
  // POINT THE DEVICE AT THE ACCOUNT, not just this socket. attachAcct only moves the in-memory
  // socket index; accounts.adoptX moves the device token -> account mapping that is written to
  // disk. Without it `accounts.get(c.th)` still answered with the old scratch account, so the
  // screen read "This device only" immediately after signing in and the next reload went back to
  // the empty account -- which is the one thing signing in exists to prevent.
  accounts.adoptX(c.th, target);
  attachAcct(c, target.id);
  // SIGNING IN IS ALSO A CLAIM TICKET. Merging the device's scratch account covers the purchase made
  // minutes ago on this browser; it does nothing for one made on another device, another browser or
  // another region. The receipt book knows which X account each purchase was made on and every
  // region holds every receipt, so signing in hands back anything that is missing — no wallet
  // needed, nothing moved off anybody else's account.
  try { economy.restorePaid(target.id, { xid: target.xid }); } catch (e) { log('restore on sign-in', e.message); }
  log('x signed in', target.id, '@' + r.x, from && from !== target.id ? (scratch ? '(merged ' + from + ')' : '(left ' + from + ' alone)') : '');
  sendTo(c, Object.assign(meMsg(c), { recovered: true }));
  sendTo(c, socialMsg(c));
  sendTo(c, economy.state(target.id));    // the entitlements this device is here for
  sendTo(c, xState(c));
  if (r.x) sendTo(c, { k: 'x_linked', h: r.x });
}
function xForget(c) {
  const a = accounts.get(c.th);
  xv.cancel(a.id);
  if (a.x) { a.x = null; a.xid = null; a.xav = null; a.xat = 0; accounts.touch(); }
  sendTo(c, xState(c));
  if (c.room) broadcastRoom(c.room);
}

function onLook(c, msg) {
  const lk = msg.look === null ? null : cleanLook(msg.look);
  if (msg.look !== null && !lk) return err(c, 'That custom fighter could not be saved.');
  const a = accounts.get(c.th);
  if (JSON.stringify(a.look || null) === JSON.stringify(lk)) return;
  a.look = lk; accounts.touch();
  if (c.room && c.room.state === 'lobby') broadcastRoom(c.room);
  sendTo(c, meMsg(c));
}

// room chat: quick-chat always, free text (120 chars, filtered) when CHAT_FREE is on; ~1 line a second, burst of 3
function onChat(c, msg) {
  const r = c.room; if (!r) return;
  const now = Date.now();
  c.ctok = Math.min(3, (c.ctok == null ? 3 : c.ctok) + (now - (c.ctokAt || now)) / 1000); c.ctokAt = now;
  if (c.ctok < 1) return err(c, 'Chat is limited to about one line a second.', 'chatrate');
  const line = chat.clean(msg, CFG.chatFree);
  if (!line) return;
  c.ctok -= 1;
  const out = JSON.stringify(Object.assign({ k: 'chat', from: c.id, acct: c.acct, name: c.name, at: now }, line));
  for (const m of r.members) if (m.c && m.c.room === r) sendTo(m.c, out);
}

// ------------------------------------------------------------------ friends, challenges, recovery
function attachAcct(c, id) {
  if (c.acct === id) return;
  if (c.acct) { const set = byAcct.get(c.acct); if (set) { set.delete(c); if (!set.size) byAcct.delete(c.acct); } pushFriends(c.acct); }
  c.acct = id;
  if (!byAcct.has(id)) byAcct.set(id, new Set());
  byAcct.get(id).add(c);
  pushFriends(id);
}
function status(id) {
  const set = byAcct.get(id); if (!set || !set.size) return 'offline';
  for (const c of set) if (c.seat) return 'in a match';
  for (const c of set) if (c.room) return 'in a room';
  return 'online';
}
function socialMsg(c) {
  const a = accounts.get(c.th);
  const view = id => { const b = accounts.byId(id); return b && { id, name: b.name || 'Player', x: handleOf(b), status: status(id), elo: b.rg ? b.elo : null, look: b.look ? b.look.base : null }; };
  return { k: 'social', fc: a.fc, friends: a.friends.map(view).filter(Boolean).sort((x, y) => (x.status === 'offline') - (y.status === 'offline') || x.name.localeCompare(y.name)),
    reqIn: a.reqIn.map(view).filter(Boolean), reqOut: a.reqOut.map(view).filter(Boolean) };
}
function pushSocial(id) { const set = byAcct.get(id); if (set) for (const c of set) if (c.th) sendTo(c, socialMsg(c)); }
// my presence changed: refresh every online friend's list (throttled per account)
const presenceT = new Map();
function pushFriends(id) {
  if (presenceT.has(id)) return;
  presenceT.set(id, setTimeout(() => { presenceT.delete(id); const a = accounts.byId(id); if (a) for (const f of a.friends) pushSocial(f); }, 400));
}
function presence(c) { if (c && c.acct) pushFriends(c.acct); }

function friendAdd(c, msg) {
  const me = accounts.get(c.th), q = String(msg.q || '').trim();
  if (!q) return;
  let target = null;
  const fc = q.toUpperCase().replace(/^BS-?/, '').replace(/[^A-Z0-9]/g, '');
  if (/^[A-Z0-9]{6}$/.test(fc)) target = accounts.byFriendCode(fc);
  if (!target) {
    const hits = accounts.findByName(cleanName(q)).filter(a => a.id !== me.id);
    if (hits.length > 1) return err(c, 'Several players use that name. Ask for their friend code instead.', 'friend');
    target = hits[0] || null;
  }
  if (!target) return err(c, 'No player with that name or friend code.', 'friend');
  const r = accounts.request(me, target);
  if (r !== 'sent' && r !== 'accepted') return err(c, r, 'friend');
  sendTo(c, { k: 'toast', msg: r === 'accepted' ? `You and ${target.name} are friends now.` : `Friend request sent to ${target.name}.` });
  pushSocial(me.id); pushSocial(target.id);
  if (r === 'sent') for (const x of byAcct.get(target.id) || []) sendTo(x, { k: 'toast', msg: `${me.name} sent you a friend request.` });
}
function friendEdit(c, msg) {
  const me = accounts.get(c.th), other = accounts.byId(String(msg.id || ''));
  if (!other) return;
  if (msg.k === 'friend_accept') { if (!accounts.accept(me, other)) return; for (const x of byAcct.get(other.id) || []) sendTo(x, { k: 'toast', msg: `${me.name} accepted your friend request.` }); }
  else accounts.unlink(me, other);
  pushSocial(me.id); pushSocial(other.id);
}
function challenge(c, msg) {
  const me = accounts.get(c.th), other = accounts.byId(String(msg.id || ''));
  if (!other || !me.friends.includes(other.id)) return err(c, 'You can challenge friends only.', 'challenge');
  if (!requireBuild(c) || c.seat) return;
  if (status(other.id) === 'offline') return err(c, other.name + ' is offline. Send them your room link instead.', 'challenge');
  const now = Date.now(); if (now - (c.lastChallenge || 0) < 4000) return err(c, 'Wait a moment before challenging again.', 'rate');
  c.lastChallenge = now;
  const stake = STAKES.includes(Number(msg.stake)) ? Number(msg.stake) : 0;
  const r = makeRoom(c, { priv: true, size: 2, stake, stage: 'random', stocks: 3, items: true, ranked: !!msg.ranked, challenge: { from: me.id, to: other.id } });
  if (!r || !joinRoom(c, r)) return;
  for (const x of byAcct.get(other.id) || []) sendTo(x, { k: 'challenge', from: { id: me.id, name: me.name, elo: me.rg ? me.elo : null }, code: r.code, stake, ranked: r.ranked });
}
function challengeReply(c, msg) {
  const r = rooms.get(String(msg.code || '').toUpperCase());
  if (!r || !r.challenge || r.challenge.to !== c.acct) return;
  if (msg.ok) return joinRoom(c, r);
  for (const m of r.members) sendTo(m.c, { k: 'toast', msg: `${c.name} can't play right now.` });
  r.challenge = null;
}
function recover(c, msg) {
  if (c.room || c.seat) return err(c, 'Leave your room first.', 'recover');
  c.recTries = (c.recTries || 0) + 1;
  if (c.recTries > 8) return err(c, 'Too many tries. Reload the page and try again.', 'recover');
  const a = accounts.recover(c.th, msg.code);
  if (!a) return err(c, 'That recovery code does not match any account.', 'recover');
  c.name = a.name || c.name;
  attachAcct(c, a.id);
  sendTo(c, Object.assign(meMsg(c), { recovered: true }));
  sendTo(c, socialMsg(c));
}

// ------------------------------------------------------------------ tournament
// Opening the screen subscribes this socket to the board, so a spectator who never entered still
// watches the bracket move. The set is swept on disconnect and on every push.
function tState(c) { tWatch.add(c); sendTo(c, tourney.state(c.acct)); }
function tJoin(c) {
  if (!c.acct) return err(c, 'Sign in before you enter.', 'tourney');
  const now = Date.now(); if (now - (c.lastTJoin || 0) < 2000) return err(c, 'One moment.', 'rate');
  c.lastTJoin = now;
  const r = tourney.join(c.acct);
  sendTo(c, Object.assign({ k: 'tjoined' }, r));
  sendTo(c, tourney.state(c.acct));
}
function tLeave(c) {
  if (!c.acct) return;
  const r = tourney.leave(c.acct);
  sendTo(c, Object.assign({ k: 'tleft' }, r));
  sendTo(c, tourney.state(c.acct));
}
// "I am at my match." The bracket opens the room on the first of the two to press it and hands the
// same code to the second; this walks whoever pressed it into that room, so nobody copies a code.
function tCheckIn(c) {
  if (!c.acct) return err(c, 'Sign in first.', 'tourney');
  if (!requireBuild(c)) return;
  if (c.seat) return err(c, 'Finish the match you are in first.', 'tourney');
  const r = tourney.checkIn(c.acct, c);
  sendTo(c, Object.assign({ k: 'tmatch' }, r));
  if (!r.ok || !r.code) return;
  const room = rooms.get(r.code);
  if (room && c.room !== room) joinRoom(c, room);
  sendTo(c, tourney.state(c.acct));
}
// Operator only: the socket has to have presented TOURNEY_KEY in `hello`. Announcing writes the
// event file; drawing closes entries early; forcing hands a disputed match to one side with a
// reason that lands in the bracket. Everything here is also what the clock does on its own.
function tAdmin(c, msg) {
  if (!c.op) return strike(c);
  let r;
  if (msg.k === 'tannounce') r = tourney.announce(msg.ev || {});
  else if (msg.k === 'tdraw') r = tourney.draw();
  else r = tourney.force(String(msg.pid || ''), String(msg.acct || ''), msg.why);
  log('tourney admin', msg.k, r && r.ok ? 'ok' : 'refused', r && r.msg ? r.msg : '');
  sendTo(c, Object.assign({ k: 'tadmin', of: msg.k }, r));
}

// ------------------------------------------------------------------ connections
function detach(c) {
  if (!clients.has(c)) return;
  clients.delete(c);
  tWatch.delete(c);
  if (byToken.get(c.th) === c) byToken.delete(c.th);
  if (c.acct) { const set = byAcct.get(c.acct); if (set) { set.delete(c); if (!set.size) byAcct.delete(c.acct); } pushFriends(c.acct); }
  if (c.ip) { const n = (ipCount.get(c.ip) || 1) - 1; if (n <= 0) ipCount.delete(c.ip); else ipCount.set(c.ip, n); c.ip = null; }
  const seat = c.seat;
  if (seat && !seat.M.ended) {
    const S = seat.M.slots[seat.i];
    if (S.client === c) { S.connected = false; S.discAt = Date.now(); toPlayers(seat.M, { k: 'lag', slots: [{ slot: seat.i, gone: true, secs: Math.round(CFG.graceMs / 1000) }] }); }
  }
  if (c.room && c.room.state !== 'match') leaveRoom(c);
}

// The peer is Caddy, which APPENDS the real client address to any X-Forwarded-For the client sent.
// Taking element [0] therefore takes a value the client chose, and the per-address connection cap
// is bypassed by sending one header. Count back TRUST_PROXY_HOPS entries from the END instead --
// with the default of 1 that is exactly the address Caddy observed.
const TRUST_HOPS = Math.max(1, +process.env.TRUST_PROXY_HOPS || 1);
// Two seats from one address in a money or rating room. Off means "refuse", which is the
// production setting; tests and LAN events set SAME_IP_OK=1.
const SAME_IP_OK = process.env.SAME_IP_OK === '1';
function clientIp(req) {
  const peer = (req.socket.remoteAddress || '').trim();
  const trusted = /^(::ffff:)?(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)|^::1$/.test(peer);
  if (!trusted) return peer;
  const fwd = req.headers['x-forwarded-for'];
  if (!fwd) return peer;
  const hops = String(fwd).split(',').map(s => s.trim()).filter(Boolean);
  return (hops[hops.length - TRUST_HOPS] || hops[0] || peer).trim();
}
// A connection straight to the node port from the machine the server runs on: loopback TCP peer AND
// no proxy header at all. Behind Caddy every request carries X-Forwarded-For, so this is false for
// every real player. It is the only "this is the operator" signal available that a client cannot
// simply assert, which is why the test-account flag hangs off it rather than off clientIp().
function isDirectLocal(req) {
  if (req.headers['x-forwarded-for']) return false;
  return /^(::ffff:)?127\.|^::1$/.test(String(req.socket.remoteAddress || ''));
}

// Sent on every response. The game itself is served from Vercel, but this host serves a working
// copy too, so it gets the same baseline. No CSP here: the page is one large inline bundle and a
// meaningful policy has to be written against that build, not bolted on at the edge.
const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'SAMEORIGIN',
  'Cross-Origin-Resource-Policy': 'cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=(), usb=(), interest-cohort=()',
};
const server = http.createServer((req, res) => {
  for (const [k, v] of Object.entries(SEC_HEADERS)) res.setHeader(k, v);
  // ROUTE ON THE PATH, NOT THE WHOLE URL (AAA4, 10/17).
  // `/healthz` and `/ping` were matched with `req.url === '...'`, and 77_net.js measures a region by
  // fetching `r.http + '/ping?t=' + t0` -- a cache-buster the strict compare can never match. So in
  // production every region ping fell through to the static handler and came back **404 with no CORS
  // header**, which is the browser error the page actually reports. Confirmed against the live
  // server: `/ping` -> 200 with Access-Control-Allow-Origin, `/ping?t=123` -> 404.
  // That is the whole region-latency measurement, silently dead -- including for the Singapore
  // region added on 10/16 specifically to halve round-trip time, which nothing could ever select.
  const PATH = (req.url || '').split('?')[0];
  if (PATH === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'Timing-Allow-Origin': '*' });
    // `money` is everything the pre-real-money checklist says to alert on, so a monitor can poll
    // one URL: unsettled payouts, settlements that have been failing long enough to be at risk,
    // rooms mid-funding, and the depth of the operator's transaction queue. No addresses and no
    // balances: this endpoint is public and CORS-open.
    const money = escrow ? { settleQueued: settleQueue.pending(), settleStuck: settleQueue.stuck(), funding: fundingRooms(), tx: escrow.stats() } : null;
    return res.end(JSON.stringify(Object.assign(statsMsg(), { ok: true, engine: engine.digest, engines: engine.versions(), real: !!escrow, money, region: CFG.region, label: CFG.regionLabel })));
  }
  // tiny body, CORS-open: what the page times when it measures the round trip to each region
  if (PATH === '/ping') { res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'Timing-Allow-Origin': '*' }); return res.end(CFG.region); }
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '86400' }); return res.end(); }
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed');
  // public leaderboard (Elo from ranked online 1v1s): all-time top 100 and this week's season
  if (req.url.startsWith('/api/leaderboard')) {
    const q = new URL(req.url, 'http://x').searchParams, lim = clamp(parseInt(q.get('limit'), 10) || 100, 1, 100), b = accounts.leaderboard(100);
    const body = q.get('board') === 'all' ? { updated: b.updated, season: b.season, all: b.all.slice(0, lim) } : q.get('board') === 'week' ? { updated: b.updated, season: b.season, week: b.week.slice(0, lim) }
      : { updated: b.updated, season: b.season, all: b.all.slice(0, lim), week: b.week.slice(0, lim) };
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify(body));
  }
  // THE PUBLIC BRACKET. No key: it carries exactly what the tournament screen shows any player, and
  // every name in it is an X handle its owner connected on purpose. This is what an overlay, a bot
  // or the site reads to put the bracket somewhere other than inside the game.
  if (req.url.startsWith('/api/tourney')) {
    const body = tourney.state(null);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=10', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify(body));
  }
  // THE RECEIPT BOOK, for the other regions. Same key as the bracket runner, and like it, without
  // the env it is not a route at all. Each region keeps its own accounts, so a purchase made in
  // Singapore left no trace in Germany and the player saw an empty arsenal; mirroring receipts means
  // any region can hand back anything that was ever paid for, and a transaction credited on one
  // region can no longer be claimed a second time on the other.
  if (req.url.startsWith('/api/receipts')) {
    if (!CFG.tourneyKey) return send(res, 404, 'not found');
    const q = new URL(req.url, 'http://x').searchParams;
    if (!tourneyAuth(req.headers['x-tourney-key'] || q.get('key'))) return send(res, 403, 'forbidden');
    const p = economy.pay && economy.pay();
    const sales = p ? p.receipts(+q.get('since') || 0) : [];
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ ok: true, region: CFG.region, sales }));
  }
  // Finished matches, for the tournament bracket runner. Needs TOURNEY_KEY both to exist and to be
  // presented; without the env it is not a route at all.
  if (req.url.startsWith('/api/matches')) {
    if (!CFG.tourneyKey) return send(res, 404, 'not found');
    const q = new URL(req.url, 'http://x').searchParams;
    if (!tourneyAuth(req.headers['x-tourney-key'] || q.get('key'))) return send(res, 403, 'forbidden');
    const since = +q.get('since') || 0, lim = clamp(parseInt(q.get('limit'), 10) || 200, 1, 500);
    const out = tourneyFeed.filter(m => m.at > since).slice(-lim);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ now: Date.now(), matches: out }));
  }
  // public replay files: seed, config and every input of a finished match, so anyone can re-run it
  const rm = /^\/api\/replay\/(m[0-9a-z]{6,24})$/.exec(req.url);
  if (rm) {
    // still in flight: the match ended moments ago and its write has not landed yet
    const hot = replayHot.get(rm[1]);
    if (hot) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400', 'Access-Control-Allow-Origin': '*' });
      return res.end(hot);
    }
    const f = path.join(replayDir, rm[1] + '.json');
    return fs.readFile(f, (e, buf) => {
      if (e) return send(res, 404, 'no such replay');
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400', 'Access-Control-Allow-Origin': '*' }); res.end(buf);
    });
  }
  serveStatic(req, res, CFG.publicDir);
});
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024, perMessageDeflate: false });

// Pages allowed to open a socket: the public site, this host, local test servers, claude.ai artifacts, and
// sandboxed frames (Origin "null"). Non-browser clients send no Origin. Extra origins: ALLOWED_ORIGINS=a,b
const ORIGINS = [/^https:\/\/(www\.)?brawlstreet\.(lol|xyz)$/, /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
  // THE PRIVATE LINK IS A HOST THAT SERVES THE GAME (AAA4, 10/17). `dev/ship.sh` copies the page to
  // $SITE/play and REKT-SITE/deploy-placeholder.sh pushes that to the Vercel project `bs-desk-4k9m2x`
  // (team_kwsGfFfVaOsenXfLEoRGjW5r) -- so the build that actually gets played is served from a
  // *.vercel.app origin that was not on this list, and every socket opened from it was closed with
  // 1008 'origin'. Server-side refusing silently on the one link used for testing is the failure the
  // audit named. Scoped to this project's own names (and its preview URLs, which are
  // <project>-<hash>-<team>.vercel.app) rather than all of vercel.app, which would let any page on
  // anyone's deployment open a socket here.
  /^https:\/\/(bs|brawlstreet)-desk-4k9m2x[a-z0-9-]*\.vercel\.app$/,
  /^https:\/\/([a-z0-9-]+\.)*claude\.ai$/, /^https:\/\/([a-z0-9-]+\.)*claudeusercontent\.com$/, /^https:\/\/([a-z0-9-]+\.)*anthropic\.com$/, /^null$/];
const EXTRA_ORIGINS = new Set((process.env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean).concat(CFG.publicUrl ? [new URL(CFG.publicUrl).origin] : []));
function originOk(o) { return !o || EXTRA_ORIGINS.has(o) || ORIGINS.some(re => re.test(o)) || process.env.ALLOW_ANY_ORIGIN === '1'; }

wss.on('connection', (ws, req) => {
  if (!originOk(req.headers.origin)) { ws.close(1008, 'origin'); return; }
  const ip = clientIp(req);
  const n = (ipCount.get(ip) || 0) + 1;
  if (n > CFG.maxConnPerIp) { ws.close(1013, 'too many connections'); return; }
  ipCount.set(ip, n);
  const c = { id: 'p' + (nextId++).toString(36) + rid(2), ws, ip, direct: isDirectLocal(req), th: null, name: '', rtt: 120, appRtt: 0, appJit: 0, room: null, seat: null, seenAt: Date.now(),
    tok: 400, tokAt: Date.now(), ltok: ACT_BURST, ltokAt: Date.now(), qtok: QRY_BURST, qtokAt: Date.now(), strikes: 0, pingAt: 0, buildOk: false };
  clients.add(c);
  ws.on('message', (data, isBinary) => { c.seenAt = Date.now(); if (!isBinary) onMessage(c, data.toString()); });
  ws.on('pong', () => { c.seenAt = Date.now(); if (c.pingAt) { const v = Date.now() - c.pingAt; c.rtt = c.rtt * 0.7 + v * 0.3; c.pingAt = 0; } });
  ws.on('close', () => detach(c));
  ws.on('error', () => {});
  setTimeout(() => { if (!c.th && ws.readyState === 1) ws.close(4003, 'hello timeout'); }, 10000);
});

// ------------------------------------------------------------------ timers
setInterval(() => { // keepalive + round-trip times: a socket silent for 20 s is dead (a slow phone or busy tab can miss a ping or two)
  const now = Date.now();
  for (const c of clients) {
    if (now - c.seenAt > 20000) { c.ws.terminate(); continue; }
    if (!c.pingAt || now - c.pingAt > 10000) { c.pingAt = now; try { c.ws.ping(); } catch (e) { /* closed */ } }
  }
}, 2000);

setInterval(() => { // match watchdog: stalls, disconnect grace, input delay updates
  const now = Date.now();
  for (const M of [...matches]) {
    if (M.ended || now < M.startAt) continue;
    for (const S of M.slots) if (S.human && !S.dropped && !S.connected && now - S.discAt > CFG.graceMs) dropSeat(M, S.i, 'disconnected');
    if (M.ended) continue;
    // A match must not outlive matchMaxMs, whatever its inputs do. Game time only advances when
    // every player has sent input, so without this a player who drips one input every 19 s can hold
    // a match open for days -- and on a real-ETH match outlast the escrow's 2 h REPORT_TIMEOUT, then
    // cancel() on chain for a refund rather than lose.
    const age = now - M.startAt;
    if (age > CFG.matchMaxMs) { timeoutMatch(M); continue; }
    const stall = now - M.lastAdvance;
    const sinceWatch = Math.min(2000, now - (M.watchAt || now)); M.watchAt = now;
    if (stall > 800) {
      const t = M.sim.Game.tick;
      const late = M.slots.filter(S => S.human && !S.dropped && t < S.cpuFrom && S.log.length <= t);
      if (process.env.DEBUG_STALL && stall > 2000 && !M.dbg) { M.dbg = 1; log('STALL', M.id, 'tick', t, 'logs', M.slots.map(S => S.log.length).join(','), 'late', late.map(S => S.i).join(',')); }
      // `stall` resets the instant a single tick is simulated, so a drip-feeder never reaches
      // stallDropMs. Accumulate instead: count how long each player has held the match up in
      // total. An honest client on a bad line stalls for ~100 ms at a time, under the 800 ms floor,
      // so it accrues nothing; a player sitting on the clock accrues in real time and forfeits.
      for (const S of late) if (S.connected) {
        S.blockedMs = (S.blockedMs || 0) + sinceWatch;
        if (S.blockedMs > CFG.maxLagMs) dropSeat(M, S.i, 'held the match up for ' + Math.round(S.blockedMs / 1000) + 's in total');
      }
      for (const S of late) if (S.connected && stall > CFG.stallDropMs) dropSeat(M, S.i, 'stalled');
      for (const S of late) if (S.connected && stall > 1200) sendTo(S.client, { k: 'need', t: S.log.length });
      if (!M.ended && now - M.lastLag > 1000 && late.length) {
        M.lastLag = now;
        toPlayers(M, { k: 'lag', slots: late.map(S => ({ slot: S.i, gone: !S.connected, secs: Math.max(0, Math.ceil(((S.connected ? CFG.stallDropMs - stall : CFG.graceMs - (now - S.discAt))) / 1000)) })) });
      }
    }
    if (now - (M.netAt || 0) > 2000) {
      M.netAt = now; M.delays = computeDelays(M);
      toPlayers(M, { k: 'net', delay: M.delays, ping: M.slots.map(S => (S.human && S.client ? Math.round(netRtt(S.client)) : 0)) });
    }
  }
}, 250);

setInterval(() => { // lobby timers: FFA countdowns, quick-match ready windows, idle rooms
  const now = Date.now();
  for (const r of [...rooms.values()]) {
    if (r.state === 'lobby' && r.countdownAt && now >= r.countdownAt) { r.countdownAt = 0; if (r.members.length >= 2 && r.members.every(m => m.ready)) startMatch(r); else broadcastRoom(r); }
    // real-ETH funding debounce (H5): everyone has held `ready` for FUND_DEBOUNCE_MS, so it is
    // worth spending an on-chain transaction on them
    if (r.state === 'lobby' && r.fundAt && now >= r.fundAt) {
      r.fundAt = 0;
      if (r.real && r.members.length === r.size && r.members.every(m => m.ready)) startMatch(r); else broadcastRoom(r);
    }
    // alone in a quick room with a map filter for 30 s: offer to search any map
    if (r.state === 'lobby' && r.quick && r.pool.length && r.members.length < 2 && !r.widenSent && now - r.created > 30000) {
      r.widenSent = true;
      for (const m of r.members) sendTo(m.c, { k: 'widenq', pool: r.pool });
    }
    if (r.state === 'lobby' && r.quick && r.readyBy && now >= r.readyBy) {
      r.readyBy = 0;
      if (r.members.length >= 2 && r.members.some(m => !m.ready)) for (const m of r.members.filter(x => !x.ready)) leaveRoom(m.c, 'You were moved out of the room for not readying up.');
      if (rooms.has(r.code)) { maybeStart(r); broadcastRoom(r); }
    }
    // A room somebody is actually using is kept for half an hour. A room that NOBODY ever joined
    // is reaped in minutes: that is the shape of a lobby-exhaustion flood, and it costs a real
    // player almost nothing (they get a new code) while forcing an attacker to keep re-creating.
    const idleCut = r.everFilled ? 30 * 60e3 : EMPTY_ROOM_MS;
    if (r.state === 'lobby' && now - r.touched > idleCut) { for (const m of r.members) leaveRoom(m.c, 'The room closed after sitting empty.'); closeRoom(r); }
  }
}, 500);

// ------------------------------------------------------------------ shutdown: cancel live matches, refund stakes
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  log('shutting down: cancelling', matches.size, 'matches');
  for (const M of [...matches]) {
    for (const S of M.slots) if (S.human) S.dropped = true;
    finish(M, 'cancelled');
  }
  accounts.flush();
  integrityStore.flush();
  settleQueue.save();
  // Cancelling a real match means an on-chain transaction. 300 ms was never enough for one to
  // land, so a restart could leave stakes locked until the 2 h timeout. Wait for the queue to
  // drain (it is persisted either way, so the next boot finishes whatever is left).
  const deadline = Date.now() + (CFG.realMoney ? 90e3 : 500);
  (function drain() {
    const left = settleQueue.pending();
    if (!left || Date.now() > deadline) {
      if (left) log('WARNING: exiting with', left, 'settlement(s) still queued; they are on disk and will be retried on the next start');
      return process.exit(0);
    }
    log('waiting for', left, 'settlement(s) to land...');
    settleQueue.run();
    setTimeout(drain, 2000);
  })();
}
process.on('uncaughtException', e => { log('uncaught:', (e && e.stack || String(e)).split('\n').slice(0, 3).join(' | ')); });
process.on('unhandledRejection', e => { log('unhandled rejection:', String(e && e.message || e).split('\n')[0]); });
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// What this box is doing about money, said at boot. Without it "are payments on?" can only be
// answered by connecting a game client, and a missing pay.json fails silently into "not taking
// payments yet" (lib/pay.js) — which is exactly the kind of thing that is discovered by a player.
function payLine() {
  try {
    if (economy.mode !== 'chain') return 'payments ' + economy.mode;
    const p = economy.pay();
    if (!p || !p.enabled()) return 'payments chain BUT NO CONFIG — the store will refuse every purchase (net/pay.json)';
    const curs = p.menuList();
    return 'payments chain: ' + curs.map(c => c.symbol + '@' + c.chainId).join(' ') + ' -> ' + curs[0].to;
  } catch (e) { return 'payments ?'; }
}
// ---- PULL THE OTHER REGIONS' RECEIPTS ---------------------------------------------------------
// A player is on one region at a time and their account only exists there, so the only thing that
// can carry a purchase between boxes is the receipt: a verified transaction hash, the wallet that
// sent it and the item it bought. Every region holds every receipt, so `payrestore` can hand back
// anything that was ever paid for no matter where it was bought — and a transaction already
// credited elsewhere arrives marked as spent, so it cannot buy a second copy here.
// Read-only, best effort, and it never blocks anything: a region that is down just means the next
// sweep picks its receipts up.
function syncReceipts() {
  const p = economy.pay && economy.pay();
  if (!p || !CFG.tourneyKey || !Array.isArray(REGIONS) || !REGIONS.length) return;
  const since = Date.now() - 180 * 24 * 3600e3;    // half a year of receipts is a few hundred KB
  for (const r of REGIONS) {
    if (!r || !r.http || r.id === CFG.region) continue;
    const url = r.http.replace(/\/$/, '') + '/api/receipts?since=' + since;
    Promise.resolve()
      .then(() => fetch(url, { headers: { 'x-tourney-key': CFG.tourneyKey }, signal: AbortSignal.timeout(15000) }))
      .then(x => (x.ok ? x.json() : null))
      .then(j => {
        if (!j || !j.ok || !Array.isArray(j.sales)) return;
        const n = p.mergeReceipts(j.sales);
        if (n) log('receipts: merged', n, 'from', r.id);
      })
      .catch(e => log('receipts sync', r.id, e && e.message));
  }
}
setTimeout(syncReceipts, 20000);
setInterval(syncReceipts, 10 * 60e3);

server.listen(CFG.port, CFG.host, () => log('brawlstreet online on', CFG.host + ':' + CFG.port, 'engines', engine.versions().join(' '), ENGINE.chars.length + ' fighters', 'static', CFG.publicDir, '|', payLine()));

module.exports = { server, CFG };
