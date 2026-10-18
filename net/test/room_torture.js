// Room torture: run the private-room lifecycle thousands of times and report every failure.
//
// "Does creating a room succeed every time?" is a reliability question, and a reliability question is
// answered with a distribution, not one happy path. So this drives the exact message sequence the
// page drives -- hello, create, join by code, pick, ready, start, leave -- and records the latency of
// every step and the reason for every miss. Anything that is not a clean start is a failure with a
// name, and the names are what point at the bug.
//
//   node test/room_torture.js --n 5000 --conc 30                  # private 1v1 rooms, full lifecycle
//   node test/room_torture.js --n 5000 --mode create              # create only (fastest signal)
//   node test/room_torture.js --n 1000 --size 4                   # 4-player rooms
//   node test/room_torture.js --n 500 --mode quick                # matchmaking instead of codes
//   node test/room_torture.js --n 200 --fresh                     # a new socket per cycle (reload path)
//   node test/room_torture.js --n 500 --url wss://host/ws         # against a real region
//
// Modes:
//   create  host creates, reads the code back, leaves. Does the room table hold up.
//   join    create + every guest joins by code. Does a code always resolve.
//   full    join + pick + ready + the match actually starts, then everyone leaves.
//   quick   matchmaking: `size` clients send `quick` and have to be paired with each other.
const crypto = require('crypto');
const path = require('path');
const engine = require('../lib/engine');
const { LightBot } = require('./light_bot');

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const has = k => args.includes('--' + k);

const N = +arg('n', 1000);
const CONC = +arg('conc', 20);
const SIZE = +arg('size', 2);
const MODE = arg('mode', 'full');
const URL = arg('url', 'ws://127.0.0.1:8790/ws');
const FRESH = has('fresh');              // new sockets every cycle instead of a reused pool
const STEP_MS = +arg('steptimeout', 15000);
const POOL = +arg('pool', 0);          // keep at least this many sockets before reusing one
const QUIET = has('quiet');
const OUT = arg('out', null);
const NOPACE = has('nopace');          // ignore the lobby budget: measures the limiter, not the rooms

const info = engine.load();
const BUILD = process.env.BUILD_DIGEST || info.digest;
// omen is a vault fighter: picking it without owning it is a correct refusal, not a finding.
const VAULT_CHARS = new Set((require('../lib/catalog').CAT.vault || []).filter(v => v.kind === 'fighter').map(v => v.unlocks));
const CHARS = (info.chars || ['wolverinu']).filter(c => !VAULT_CHARS.has(c));

// The server's action bucket is 30 deep and refills 8/s, shared by every lobby ACTION. A bot reused
// immediately runs at 40/s and would measure that limiter instead of the room code. So each bot
// carries a copy of the server's bucket and waits when it is low -- which is also the honest
// question: with a human's message rate, does creating a room ever fail?
const LTOK_CAP = +(process.env.ACT_BURST || 30), LTOK_PER_MS = +(process.env.ACT_PER_SEC || 8) / 1000;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function budget(b, n) {
  if (b.ltok === undefined) { b.ltok = LTOK_CAP; b.ltokAt = Date.now(); }
  for (;;) {
    const now = Date.now();
    b.ltok = Math.min(LTOK_CAP, b.ltok + (now - b.ltokAt) * LTOK_PER_MS); b.ltokAt = now;
    if (b.ltok >= n) { b.ltok -= n; return; }
    await sleep(Math.ceil((n - b.ltok) / LTOK_PER_MS));
  }
}

const t0 = Date.now();
const lat = { create: [], join: [], start: [], connect: [] };
const fails = new Map();           // reason -> { n, examples: [] }
let ok = 0, done = 0;
const codes = new Set();           // every code we were handed, to catch a duplicate

function fail(reason, detail) {
  let e = fails.get(reason);
  if (!e) fails.set(reason, e = { n: 0, examples: [] });
  e.n++;
  if (e.examples.length < 3 && detail) e.examples.push(String(detail).slice(0, 180));
}

function pct(a, p) {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))] * 10) / 10;
}

// A bot that is connected and sitting in no room, ready for another cycle.
class Pool {
  constructor() { this.free = []; this.made = 0; }
  async take() {
    if (!FRESH && this.free.length > 0 && this.free.length >= POOL) return this.free.shift();
    const b = new LightBot('T' + String(++this.made).padStart(5, '0') + '-' + crypto.randomBytes(2).toString('hex'), URL,
      { token: crypto.randomBytes(32).toString('hex'), build: BUILD, seed: this.made * 2654435761 });
    const c0 = Date.now();
    await b.connect();
    const w = await b.until(m => m.k === 'welcome', STEP_MS, 'welcome');
    lat.connect.push(Date.now() - c0);
    if (!w.build || !w.build.ok) throw new Error('build rejected by server: local ' + BUILD.slice(0, 16));
    return b;
  }
  give(b) {
    if (FRESH || b.closed) { try { b.close(); } catch (e) { /* gone */ } return; }
    this.free.push(b);
  }
}
const pool = new Pool();

// Drain anything left over from the previous cycle so `until` never resolves on a stale message.
function clear(b) { b.inbox.length = 0; b.room = null; }
// A room broadcast for the room we just left can land after clear() -- the other member leaving
// triggers one. Matching it would read back the OLD code, so every predicate names the code it wants.
const notOld = b => m => m.k === 'room' && m.code !== b.lastCode;

async function cycle(i) {
  const bots = [];
  try {
    for (let k = 0; k < SIZE; k++) bots.push(await pool.take());
    for (const b of bots) clear(b);
    // reserve this cycle's whole lobby cost up front, so no step inside it can be rate-refused
    const COST = (MODE === 'full' || MODE === 'quick') ? 4 : 2;
    if (!NOPACE) for (const b of bots) await budget(b, COST);
    const host = bots[0];

    let room;
    if (MODE === 'quick') {
      const c0 = Date.now();
      for (const b of bots) b.raw({ k: 'quick', size: SIZE, stake: 0 });
      const views = await Promise.all(bots.map(b => b.until(m => notOld(b)(m) && m.members.length === SIZE, STEP_MS, 'paired')));
      lat.create.push(Date.now() - c0);
      room = views[0];
      // MATCHMAKING IS GLOBAL, so this cycle's bots pairing with each other is not the invariant --
      // with lanes running at once they are far more likely to be matched with strangers, which is
      // exactly what quick match is for. Demanding they meet each other scored 32 of 40 correct
      // pairings as failures. What must be true is that every bot ends up in a full room, and (checked
      // below) that two bots who DID land in one room agree about the match.
      for (const v of views) if (v.members.length !== SIZE) { fail('quick-short-room', v.code + ' has ' + v.members.length); return; }
    } else {
      const c0 = Date.now();
      host.raw({ k: 'create', size: SIZE, stake: 0, stage: 'random', stocks: 3, items: true, cpuFill: false });
      room = await host.until(m => notOld(host)(m) || (m.k === 'err' && m.code !== 'chat'), STEP_MS, 'room after create');
      if (room.k === 'err') { fail('create-err:' + (room.code || '?'), room.msg); return; }
      lat.create.push(Date.now() - c0);
      if (!/^[A-Z0-9]{5}$/.test(room.code || '')) { fail('bad-code', room.code); return; }
      if (codes.has(room.code)) fail('duplicate-code', room.code);
      codes.add(room.code);

      if (MODE !== 'create') {
        const j0 = Date.now();
        for (let k = 1; k < SIZE; k++) bots[k].raw({ k: 'join', code: room.code });
        const got = await Promise.all(bots.slice(1).map(b =>
          b.until(m => (m.k === 'room' && m.code === room.code && m.members.length >= 2) || (m.k === 'err' && m.code !== 'chat'), STEP_MS, 'join')));
        const bad = got.find(m => m.k === 'err');
        if (bad) { fail('join-err:' + (bad.code || '?'), bad.msg); return; }
        lat.join.push(Date.now() - j0);
        const wrong = got.find(m => m.code !== room.code);
        if (wrong) { fail('join-wrong-room', wrong.code + ' != ' + room.code); return; }
      }
    }

    if (MODE === 'full' || MODE === 'quick') {
      const s0 = Date.now();
      bots.forEach((b, k) => { b.raw({ k: 'pick', char: CHARS[(i + k) % CHARS.length] }); b.raw({ k: 'ready', on: true }); });
      const starts = await Promise.all(bots.map(b => b.until(m => m.k === 'start' || (m.k === 'err' && m.code !== 'chat'), STEP_MS, 'start')));
      const bad = starts.find(m => m.k === 'err');
      if (bad) { fail('start-err:' + (bad.code || '?'), bad.msg); return; }
      lat.start.push(Date.now() - s0);
      // Two bots in ONE room must get one match id and two different seats. In quick mode this
      // cycle's bots are usually in different rooms, so group by room first rather than assuming.
      const byRoom = new Map();
      bots.forEach((b, k) => {
        const code = (b.room && b.room.code) || (room && room.code);
        if (!byRoom.has(code)) byRoom.set(code, []);
        byRoom.get(code).push(starts[k]);
      });
      for (const [code, group] of byRoom) {
        if (new Set(group.map(m => m.id)).size !== 1) { fail('match-split', code + ': ' + group.map(m => m.id).join(',')); return; }
        if (new Set(group.map(m => m.you)).size !== group.length) { fail('duplicate-seat', code + ': ' + group.map(m => m.you).join(',')); return; }
      }
      for (const b of bots) { b.running = false; b.raw({ k: 'leave' }); }
      await Promise.all(bots.map(b => b.until(m => m.k === 'left', STEP_MS, 'left').catch(() => null)));
    } else {
      for (const b of bots) b.raw({ k: 'leave' });
      await Promise.all(bots.map(b => b.until(m => m.k === 'left', STEP_MS, 'left').catch(() => null)));
    }
    for (const b of bots) b.lastCode = (b.room && b.room.code) || (room && room.code);
    ok++;
  } catch (e) {
    const m = String(e.message || e);
    fail(/timed out waiting for (.+)$/.test(m) ? 'timeout:' + m.match(/timed out waiting for (.+)$/)[1] : 'throw', m);
  } finally {
    for (const b of bots) pool.give(b);
    done++;
    if (!QUIET && done % Math.max(1, Math.floor(N / 20)) === 0)
      process.stdout.write(`  ${done}/${N}  ok ${ok}  fail ${done - ok}  create p50 ${pct(lat.create, 0.5)}ms p99 ${pct(lat.create, 0.99)}ms\n`);
  }
}

(async () => {
  console.log(`room torture: ${N} cycles, mode ${MODE}, size ${SIZE}, concurrency ${CONC}, ${FRESH ? 'fresh sockets' : 'pooled sockets'}`);
  console.log(`  url ${URL}`);
  console.log(`  build ${BUILD}`);
  let next = 0;
  const lanes = Array.from({ length: Math.min(CONC, N) }, async () => {
    for (;;) { const i = next++; if (i >= N) return; await cycle(i); }
  });
  await Promise.all(lanes);

  const secs = (Date.now() - t0) / 1000;
  const report = {
    mode: MODE, size: SIZE, n: N, conc: CONC, fresh: FRESH, url: URL, build: BUILD,
    ok, fail: done - ok, rate: Math.round((ok / Math.max(1, done)) * 1e4) / 100,
    secs: Math.round(secs * 10) / 10, perSec: Math.round((done / secs) * 10) / 10,
    uniqueCodes: codes.size,
    lat: Object.fromEntries(Object.entries(lat).map(([k, v]) => [k, v.length ? { n: v.length, p50: pct(v, 0.5), p95: pct(v, 0.95), p99: pct(v, 0.99), max: Math.max(...v) } : null])),
    fails: Object.fromEntries([...fails].sort((a, b) => b[1].n - a[1].n).map(([k, v]) => [k, v])),
  };
  console.log('\n' + '-'.repeat(70));
  console.log(`RESULT  ${ok}/${done} clean  (${report.rate}%)  in ${report.secs}s  ${report.perSec}/s`);
  for (const [k, v] of Object.entries(report.lat)) if (v) console.log(`  ${k.padEnd(8)} p50 ${String(v.p50).padStart(6)}  p95 ${String(v.p95).padStart(6)}  p99 ${String(v.p99).padStart(6)}  max ${String(v.max).padStart(6)} ms  (n=${v.n})`);
  if (report.fail) {
    console.log('  FAILURES:');
    for (const [k, v] of Object.entries(report.fails)) console.log(`    ${String(v.n).padStart(5)}  ${k}${v.examples.length ? '   e.g. ' + v.examples[0] : ''}`);
  } else console.log('  no failures');
  if (OUT) { require('fs').writeFileSync(OUT, JSON.stringify(report, null, 2)); console.log('  wrote ' + OUT); }
  process.exit(report.fail ? 1 : 0);
})().catch(e => { console.error('harness died:', e); process.exit(3); });
