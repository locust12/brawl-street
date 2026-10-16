// Load test: N simulated players connect over real sockets, quick-match into 1v1s (or FFAs) and play
// full fights at once, while the server's own /healthz and CPU are sampled every second. Answers one
// question: how many people can play at the same time before the box stops keeping up.
//
// Each bot is a worker thread running the page's exact lockstep client and its own copy of the fight
// engine, so the message rate on the wire is the real one, not an approximation.
//
//   node test/load_test.js --players 50                       # local server, 25 concurrent 1v1s
//   node test/load_test.js --players 50 --url ws://host/ws    # against a running server
//   node test/load_test.js --players 64 --size 4 --waves 2    # 16 FFAs, twice in a row
//
// A bot marks its account `test: true`, so it never reaches the leaderboard and is pruned after an hour.
// The per-IP caps that production runs with will refuse more than 16 sockets from one machine: point
// this at a test instance started with MAX_CONN_PER_IP / NEW_ACCT_PER_IP / MAX_ROOMS_PER_IP raised
// and SAME_IP_OK=1, which is what tools/load-box.sh does.
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const engine = require('../lib/engine');
const info = engine.load();
// The one build the bots will play on, handed to each worker so it compiles that file alone.
const ENGINE_FILE = process.env.ENGINE_FILE || path.join(__dirname, '..', 'engine', `sim-${info.digest}.js`);
process.env.ENGINE_FILE = ENGINE_FILE;
const { Bot } = require('./bot');

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const has = k => args.includes('--' + k);

const PLAYERS = +arg('players', 50);
const SIZE = +arg('size', 2);            // 2 = 1v1, 4 = FFA
const WAVES = +arg('waves', 1);
const LAT = +arg('lat', 0);              // extra one-way latency per bot, ms
const JIT = +arg('jit', 0);
const STAKE = +arg('stake', 0);
const LIGHT = has('light');              // protocol-only clients: many more players, no desync check
const RAMP = +arg('ramp', 40);           // ms between connections, so 50 bots don't arrive in one tick
const MATCH_MS = +arg('timeout', 480000);
const REMOTE = arg('url', null);
const SSH = arg('ssh', null);            // host to sample `docker stats` on, e.g. --ssh lw
const CONTAINER = arg('container', 'brawlstreet-load');
const OUT = arg('out', null);

if (PLAYERS % SIZE) { console.error(`--players ${PLAYERS} is not a multiple of --size ${SIZE}`); process.exit(2); }

// ---------------------------------------------------------------- worker side
if (!isMainThread && workerData.shard) {
  // A shard owns a slice of the light players and drives them on one timer. Splitting the players
  // across cores is what stops the generator's own event loop from becoming the measurement.
  const { LightBot, driveAll } = require('./light_bot');
  const d = workerData, bots = [];
  for (let i = 0; i < d.count; i++)
    bots.push(new LightBot('L' + String(d.from + i).padStart(3, '0') + '-' + crypto.randomBytes(2).toString('hex'),
                           d.url, { token: crypto.randomBytes(32).toString('hex'), build: d.build, seed: (d.from + i) * 2654435761 }));
  let lag = 0, lastT = performance.now();
  setInterval(() => { const n = performance.now(); lag = Math.max(lag, n - lastT - 20); lastT = n; }, 20).unref();

  const all = (f, what, ms) => Promise.all(bots.map(b => b.until(f, ms, what)));
  parentPort.on('message', async x => {
    try {
      if (x.cmd === 'connect') {
        for (const b of bots) { b.connect().catch(e => { b.err = e.message; }); if (d.ramp) await new Promise(r => setTimeout(r, d.ramp)); }
        await all(m => m.k === 'welcome', 'welcome', 180000);
        driveAll(bots);
        parentPort.postMessage({ type: 'connected' });
      }
      if (x.cmd === 'quick') {
        for (const b of bots) b.raw({ k: 'quick', size: d.size, stake: d.stake });
        await all(m => m.k === 'room' && m.members.length === d.size, 'paired', 120000);
        parentPort.postMessage({ type: 'paired' });
      }
      if (x.cmd === 'ready') {
        bots.forEach((b, i) => { b.raw({ k: 'pick', char: d.chars[(d.from + i) % d.chars.length] }); b.raw({ k: 'ready', on: true }); });
        await all(m => m.k === 'start', 'start', 180000);
        parentPort.postMessage({ type: 'started' });
      }
      if (x.cmd === 'await') {
        const rs = await Promise.allSettled(bots.map(b => b.until(m => m.k === 'result', x.ms, 'result')));
        parentPort.postMessage({ type: 'results',
          finished: rs.filter(r => r.status === 'fulfilled').length,
          states: bots.map(b => b.state()),
          delays: bots.map(b => b.delay),
          results: bots.map(b => (b.done ? { id: b.done.id, winner: b.done.winner } : null)),
          lagMs: Math.round(lag) });
      }
      if (x.cmd === 'close') { for (const b of bots) b.close(); parentPort.postMessage({ type: 'closed' }); }
    } catch (e) { parentPort.postMessage({ type: 'err', msg: e.message }); }
  });
  return;
}

if (!isMainThread) {
  const d = workerData;
  const b = new Bot(d.name, d.url, { token: d.token, lat: d.lat, jit: d.jit });
  b.emit = m => {
    // Only the handful of messages the runner reasons about cross the thread boundary. Forwarding
    // every relayed input would make the main thread, not the server, the thing under test.
    if (m.k === 'welcome' || m.k === 'room' || m.k === 'start' || m.k === 'result' || m.k === 'desync' || m.k === 'err' || m.k === 'full')
      parentPort.postMessage({ type: 'msg', m, state: b.state(), rtt: Math.round(b.rtt || 0), delay: b.lock ? b.lock.delay : null });
  };
  b.onState = () => parentPort.postMessage({ type: 'state', state: b.state(), rtt: Math.round(b.rtt || 0), delay: b.lock ? b.lock.delay : null });
  parentPort.on('message', x => {
    if (x.cmd === 'raw') b.raw(x.msg);
    if (x.cmd === 'close') b.close();
    if (x.cmd === 'report') parentPort.postMessage({ type: 'final', state: b.state(), rtt: Math.round(b.rtt || 0), delay: b.lock ? b.lock.delay : null, tick: b.sim.Game.tick });
  });
  b.connect().catch(e => parentPort.postMessage({ type: 'msg', m: { k: 'err', msg: 'connect failed: ' + e.message }, state: {} }));
  return;
}

// ---------------------------------------------------------------- main: the runner
let srv = null, baseWs = REMOTE, baseHttp = null, dataDir = null;

async function startLocal() {
  if (REMOTE) { baseHttp = REMOTE.replace(/^ws/, 'http').replace(/\/ws$/, ''); return; }
  const port = 20000 + crypto.randomInt(20000);
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-load-'));
  srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: Object.assign({}, process.env, {
      PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, QUIET: '1',
      READY_WINDOW_MS: '600000', FFA_COUNTDOWN_MS: '2000',
      MAX_CONN_PER_IP: '100000', NEW_ACCT_PER_IP: '100000', NEW_ACCT_GLOBAL: '1000000',
      MAX_ROOMS_PER_IP: '100000', SAME_IP_OK: '1', BOARD_SHOW_TESTS: '1',
    }),
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  baseWs = `ws://127.0.0.1:${port}/ws`; baseHttp = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 600; i++) {
    try { const r = await fetch(baseHttp + '/healthz'); if (r.ok) return; } catch (e) { /* not up yet */ }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('local server did not start');
}

class Player {
  constructor(i) {
    this.name = 'L' + String(i).padStart(3, '0') + '-' + crypto.randomBytes(2).toString('hex');
    this.token = crypto.randomBytes(32).toString('hex');
    this.inbox = []; this.waiters = []; this.st = {}; this.desyncs = []; this.rtt = 0; this.delay = null;
    this.w = new Worker(__filename, {
      workerData: { name: this.name, url: baseWs, token: this.token, lat: LAT, jit: JIT },
      argv: args,
      // Every worker otherwise compiles all twelve engine builds in engine/ (8 MB) before it can say
      // hello, which is 6 s per bot and makes the load generator, not the server, the slow part.
      // Pin each one to the single build the fight actually runs on.
      env: Object.assign({}, process.env, { ENGINE_FILE: ENGINE_FILE }),
    });
    this.w.on('message', x => {
      if (x.state) this.st = x.state;
      if (x.rtt) this.rtt = x.rtt;
      if (x.delay != null) this.delay = x.delay;
      if (x.type === 'final') { this.final = x; return; }
      if (x.type !== 'msg') return;
      const m = x.m;
      if (m.k === 'welcome') this.me = m;
      if (m.k === 'room') this.room = m;
      if (m.k === 'desync') this.desyncs.push(m);
      if (m.k === 'result') this.result = m;
      this.inbox.push(m);
      for (const w of this.waiters.slice()) if (w.f(m)) { this.waiters.splice(this.waiters.indexOf(w), 1); w.res(m); }
    });
    this.w.on('error', e => { this.err = e.message; });
  }
  raw(msg) { this.w.postMessage({ cmd: 'raw', msg }); }
  close() { this.w.postMessage({ cmd: 'close' }); setTimeout(() => this.w.terminate(), 300); }
  until(f, ms, what) {
    const hit = this.inbox.find(f);
    if (hit) { this.inbox.splice(this.inbox.indexOf(hit), 1); return Promise.resolve(hit); }
    return new Promise((res, rej) => {
      const w = { f, res: v => { clearTimeout(t); this.inbox.splice(this.inbox.indexOf(v), 1); res(v); } };
      const t = setTimeout(() => { this.waiters.splice(this.waiters.indexOf(w), 1); rej(new Error(this.name + ' timed out waiting for ' + what)); }, ms);
      this.waiters.push(w);
    });
  }
}

// ---------------------------------------------------------------- sampling the server under load
const samples = [];
let sampling = null;

// The load generator can be the slow one. 50 bots, each a worker thread running its own fight at
// 60 Hz, cost far more than the server does, and when this machine falls behind the bots report
// huge round trips that have nothing to do with the server. Sampling this box too is what lets the
// result say which side ran out of road.
let loopLag = 0, lastTick = performance.now();
setInterval(() => { const n = performance.now(); loopLag = Math.max(loopLag, n - lastTick - 20); lastTick = n; }, 20).unref();
const localLoad = () => ({ load1: os.loadavg()[0], cores: os.cpus().length, lagMs: Math.round(loopLag), rssMB: Math.round(process.memoryUsage().rss / 1048576) });

function startSampling() {
  const pull = async () => {
    const at = Date.now();
    const client = localLoad(); loopLag = 0;
    let health = null;
    try {
      const t0 = performance.now();
      const r = await fetch(baseHttp + '/healthz', { signal: AbortSignal.timeout(4000) });
      health = await r.json();
      health.httpMs = Math.round(performance.now() - t0);
    } catch (e) { health = { err: e.message }; }
    samples.push({ at, health, client });
  };
  sampling = setInterval(pull, 1000);
  pull();
}

// `docker stats` is a second, independent witness: /healthz can look fine while the event loop is
// three seconds behind, and only the CPU number shows that.
function startDockerStats() {
  if (!SSH) return null;
  const p = spawn('ssh', ['-o', 'ConnectTimeout=10', SSH,
    `docker stats --format '{{.CPUPerc}} {{.MemUsage}}' ${CONTAINER}`], { stdio: ['ignore', 'pipe', 'ignore'] });
  const seen = [];
  let buf = '';
  p.stdout.on('data', d => {
    buf += d.toString();
    // docker stats redraws with ANSI escapes; take whatever looks like "12.34% 100MiB / 1GiB"
    for (const line of buf.split(/[\r\n\x1b]+/)) {
      const m = line.match(/([\d.]+)%\s+([\d.]+)([KMG]i?B)/);
      if (m) seen.push({ at: Date.now(), cpu: +m[1], mem: +m[2] * ({ KiB: 1 / 1024, MiB: 1, GiB: 1024 }[m[3]] || 1) });
    }
    buf = '';
  });
  return { proc: p, seen };
}

const pct = (a, p) => (a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : null);

// ---------------------------------------------------------------- one wave, light players sharded
const SHARDS = +arg('shards', Math.min(os.cpus().length, Math.max(1, Math.ceil(PLAYERS / 16))));

async function lightWave(n) {
  // Keep both seats of a match inside one shard where possible, so pairing does not depend on
  // shards reaching the matchmaker in step.
  const per = Math.ceil(PLAYERS / SHARDS / SIZE) * SIZE;
  const shards = [];
  for (let from = 0; from < PLAYERS; from += per) {
    const count = Math.min(per, PLAYERS - from);
    shards.push(new Worker(__filename, {
      workerData: { shard: true, from: n * PLAYERS + from, count, url: baseWs, build: info.digest,
                    size: SIZE, stake: STAKE, ramp: RAMP, chars: info.chars },
      argv: args, env: Object.assign({}, process.env, { ENGINE_FILE }),
    }));
  }
  const once = (w, type, ms) => new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('shard timed out waiting for ' + type)), ms);
    const h = m => { if (m.type === 'err') { clearTimeout(t); w.off('message', h); rej(new Error(m.msg)); }
                     if (m.type === type) { clearTimeout(t); w.off('message', h); res(m); } };
    w.on('message', h);
  });
  const all = (cmd, type, ms) => { for (const w of shards) w.postMessage(typeof cmd === 'string' ? { cmd } : cmd); return Promise.all(shards.map(w => once(w, type, ms))); };

  const t0 = Date.now();
  await all('connect', 'connected', 240000);
  const connectedMs = Date.now() - t0;
  const t1 = Date.now();
  await all('quick', 'paired', 180000);
  const pairedMs = Date.now() - t1;
  await all('ready', 'started', 240000);
  const startedMs = Date.now() - t1;

  const t2 = Date.now();
  const packs = await all({ cmd: 'await', ms: MATCH_MS }, 'results', MATCH_MS + 60000);
  const fightMs = Date.now() - t2;
  for (const w of shards) w.postMessage({ cmd: 'close' });
  await new Promise(r => setTimeout(r, 600));
  for (const w of shards) w.terminate();

  const states = packs.flatMap(p => p.states);
  const delays = packs.flatMap(p => p.delays).filter(x => x != null);
  const finished = packs.reduce((a, p) => a + p.finished, 0);
  const stalls = states.map(s => s.stalls), stallMs = states.map(s => s.stallMs), rtts = states.map(s => s.rtt).filter(Boolean);

  const byMatch = new Map();
  for (const r of packs.flatMap(p => p.results)) if (r) { if (!byMatch.has(r.id)) byMatch.set(r.id, []); byMatch.get(r.id).push(r); }
  let disagreements = 0;
  for (const [, rs] of byMatch) if (rs.some(r => r.winner !== rs[0].winner)) disagreements++;

  return {
    wave: n + 1, players: PLAYERS, matches: PLAYERS / SIZE, size: SIZE, shards: shards.length,
    connectedMs, pairedMs, startedMs, fightMs,
    finished, unfinished: PLAYERS - finished, desyncs: 0, disagreements,
    shardLagMs: Math.max(...packs.map(p => p.lagMs)),
    stalls: { total: stalls.reduce((a, b) => a + b, 0), p50: pct(stalls, 0.5), p95: pct(stalls, 0.95), worst: Math.max(0, ...stalls) },
    stallMs: { total: stallMs.reduce((a, b) => a + b, 0), p95: pct(stallMs, 0.95), worst: Math.max(0, ...stallMs) },
    rtt: { p50: pct(rtts, 0.5), p95: pct(rtts, 0.95), worst: Math.max(0, ...rtts) },
    inputDelayFrames: { p50: pct(delays, 0.5), p95: pct(delays, 0.95), worst: Math.max(0, ...delays) },
    errors: [],
  };
}

async function wave(n) {
  if (LIGHT) return lightWave(n);
  const ps = [];
  for (let i = 0; i < PLAYERS; i++) {
    ps.push(new Player(n * PLAYERS + i));
    if (RAMP) await new Promise(r => setTimeout(r, RAMP));
  }
  const t0 = Date.now();
  // Booting 50 worker threads, each with its own fight engine, takes the load generator longer than
  // it takes the server to answer; this window is the generator's, not the server's.
  await Promise.all(ps.map(p => p.until(m => m.k === 'welcome', 180000, 'welcome')));
  const connectedMs = Date.now() - t0;

  // everyone queues for a quick match at the same time: the matchmaker has to pair all of them
  const t1 = Date.now();
  for (const p of ps) p.raw({ k: 'quick', size: SIZE, stake: STAKE });
  await Promise.all(ps.map(p => p.until(m => m.k === 'room' && m.members.length === SIZE, 60000, 'paired')));
  const pairedMs = Date.now() - t1;

  // pick a character and ready up
  const chars = info.chars;
  ps.forEach((p, i) => { p.raw({ k: 'pick', char: chars[i % chars.length] }); p.raw({ k: 'ready', on: true }); });
  await Promise.all(ps.map(p => p.until(m => m.k === 'start', 90000, 'start')));
  const startedMs = Date.now() - t1;

  // ---- every fight is now running at 60 Hz at the same time ----
  const t2 = Date.now();
  const results = await Promise.allSettled(ps.map(p => p.until(m => m.k === 'result', MATCH_MS, 'result')));
  const fightMs = Date.now() - t2;

  for (const p of ps) p.w.postMessage({ cmd: 'report' });
  await new Promise(r => setTimeout(r, 600));

  const finished = results.filter(r => r.status === 'fulfilled').length;
  const stalls = ps.map(p => p.st.stalls || 0);
  const stallMs = ps.map(p => p.st.stallMs || 0);
  const rtts = ps.map(p => Math.round(p.rtt)).filter(Boolean);
  const delays = ps.map(p => p.delay).filter(x => x != null);
  const desyncs = ps.reduce((a, p) => a + p.desyncs.length, 0);

  // every pair must agree on who won
  let disagreements = 0;
  const byMatch = new Map();
  for (const p of ps) if (p.result) { const k = p.result.id; (byMatch.get(k) || byMatch.set(k, []).get(k)).push(p.result); }
  for (const [, rs] of byMatch) if (rs.some(r => r.winner !== rs[0].winner)) disagreements++;

  for (const p of ps) p.close();
  await new Promise(r => setTimeout(r, 800));

  return {
    wave: n + 1, players: PLAYERS, matches: PLAYERS / SIZE, size: SIZE,
    connectedMs, pairedMs, startedMs, fightMs,
    finished, unfinished: PLAYERS - finished, desyncs, disagreements,
    stalls: { total: stalls.reduce((a, b) => a + b, 0), p50: pct(stalls, 0.5), p95: pct(stalls, 0.95), worst: Math.max(0, ...stalls) },
    stallMs: { total: stallMs.reduce((a, b) => a + b, 0), p95: pct(stallMs, 0.95), worst: Math.max(0, ...stallMs) },
    rtt: { p50: pct(rtts, 0.5), p95: pct(rtts, 0.95), worst: Math.max(0, ...rtts) },
    inputDelayFrames: { p50: pct(delays, 0.5), p95: pct(delays, 0.95), worst: Math.max(0, ...delays) },
    errors: ps.filter(p => p.err).map(p => p.name + ': ' + p.err),
  };
}

(async () => {
  await startLocal();
  const ds = startDockerStats();
  startSampling();
  console.log(`load test: ${PLAYERS} players, ${PLAYERS / SIZE} concurrent ${SIZE === 2 ? '1v1' : SIZE + 'p FFA'} matches, ${WAVES} wave(s) -> ${baseWs}`);

  const waves = [];
  for (let i = 0; i < WAVES; i++) {
    const r = await wave(i);
    waves.push(r);
    console.log(JSON.stringify(r));
  }

  clearInterval(sampling);
  if (ds) ds.proc.kill();
  await new Promise(r => setTimeout(r, 300));

  const peak = samples.reduce((a, s) => (s.health && s.health.matches > (a.health ? a.health.matches : -1) ? s : a), {});
  const httpMs = samples.map(s => s.health && s.health.httpMs).filter(x => x != null);
  const cpus = ds ? ds.seen.map(s => s.cpu) : [];
  const mems = ds ? ds.seen.map(s => s.mem) : [];

  const summary = {
    engine: info.digest, server: baseWs,
    mode: LIGHT ? 'light (protocol only: capacity yes, desync detection no)' : 'full (local fight per player: capacity + desync)',
    peakConcurrent: { online: Math.max(0, ...samples.map(s => (s.health && s.health.online) || 0)),
                      matches: Math.max(0, ...samples.map(s => (s.health && s.health.matches) || 0)) },
    healthzMs: { p50: pct(httpMs, 0.5), p95: pct(httpMs, 0.95), worst: Math.max(0, ...httpMs) },
    serverCpuPct: cpus.length ? { p50: pct(cpus, 0.5), p95: pct(cpus, 0.95), peak: Math.max(...cpus) } : 'no --ssh, not sampled',
    serverMemMB: mems.length ? { p95: Math.round(pct(mems, 0.95)), peak: Math.round(Math.max(...mems)) } : 'no --ssh, not sampled',
    // If these are hot while serverCpuPct is cold, the test measured this machine, not the server.
    generator: (() => {
      const cs = samples.map(s => s.client).filter(Boolean);
      const lo = cs.map(c => c.load1), lg = cs.map(c => c.lagMs);
      return { cores: cs.length ? cs[0].cores : os.cpus().length,
               load1: { p50: pct(lo, 0.5), peak: Math.max(0, ...lo) },
               loadPerCore: { peak: +(Math.max(0, ...lo) / (cs.length ? cs[0].cores : 1)).toFixed(2) },
               eventLoopLagMs: { p50: pct(lg, 0.5), p95: pct(lg, 0.95), peak: Math.max(0, ...lg) },
               rssMB: { peak: Math.max(0, ...cs.map(c => c.rssMB)) } };
    })(),
    waves,
    verdict: waves.every(w => w.unfinished === 0 && w.desyncs === 0 && w.disagreements === 0) ? 'PASS' : 'FAIL',
  };
  console.log('\n' + JSON.stringify(summary, null, 2));
  if (OUT) { fs.writeFileSync(OUT, JSON.stringify({ summary, samples }, null, 2)); console.log('\nwrote ' + OUT); }

  if (srv) srv.kill('SIGTERM');
  setTimeout(() => process.exit(summary.verdict === 'PASS' ? 0 : 1), 500);
})().catch(e => { console.error('load test failed:', e.message); if (srv) srv.kill('SIGTERM'); process.exit(1); });
