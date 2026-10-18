// Event-loop lag sampler, loaded into the server with --require. Nothing else in the process is
// touched: it just measures how late its own 10 ms timer is, which is exactly how long the loop was
// blocked by whatever ran before it -- a sync disk write, a big JSON.stringify, a tick of 100 fights.
//
// A player feels loop lag directly. Lockstep only advances when every input for a tick has arrived,
// so 200 ms of blocked loop is 200 ms added to everyone's input delay at once, in every match on the
// box, not just the one that caused it.
//
//   LOOPMON=/path/out.json node --require ./test/loopmon.js server.js
//
// Writes a histogram every 5 s (append-mode JSON lines) with the worst single stall in the window and
// the stack of whatever was running when it happened, when one is available.
const fs = require('fs');
const OUT = process.env.LOOPMON || '/tmp/loopmon.jsonl';
const EVERY = +process.env.LOOPMON_EVERY || 5000;
const TICK = 10;

let last = process.hrtime.bigint();
let win = [];
let worst = 0;
const started = Date.now();

const timer = setInterval(() => {
  const now = process.hrtime.bigint();
  const late = Number(now - last) / 1e6 - TICK;
  last = now;
  if (late > 0) { win.push(late); if (late > worst) worst = late; }
}, TICK);
timer.unref();

function pct(a, p) { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))] * 100) / 100; }

const flush = setInterval(() => {
  const a = win; win = [];
  const mem = process.memoryUsage();
  const row = {
    t: Date.now(), up: Math.round((Date.now() - started) / 1000),
    n: a.length, p50: pct(a, 0.5), p95: pct(a, 0.95), p99: pct(a, 0.99),
    max: Math.round(Math.max(0, ...a) * 100) / 100,
    over50: a.filter(x => x > 50).length, over150: a.filter(x => x > 150).length,
    rss: Math.round(mem.rss / 1048576), heap: Math.round(mem.heapUsed / 1048576),
    cpu: process.cpuUsage().user + process.cpuUsage().system,
  };
  try { fs.appendFileSync(OUT, JSON.stringify(row) + '\n'); } catch (e) { /* out of space, keep playing */ }
}, EVERY);
flush.unref();

// Time individual sync filesystem calls, which is where a game server's hidden stalls live.
if (process.env.LOOPMON_FS === '1') {
  const tally = new Map();
  for (const fn of ['writeFileSync', 'readdirSync', 'statSync', 'renameSync', 'unlinkSync', 'readFileSync']) {
    const orig = fs[fn];
    if (typeof orig !== 'function') continue;
    fs[fn] = function (...a) {
      const t0 = process.hrtime.bigint();
      try { return orig.apply(fs, a); }
      finally {
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        let e = tally.get(fn); if (!e) tally.set(fn, e = { n: 0, ms: 0, max: 0 });
        e.n++; e.ms += ms; if (ms > e.max) e.max = ms;
      }
    };
  }
  const fsFlush = setInterval(() => {
    if (!tally.size) return;
    const row = { t: Date.now(), fs: Object.fromEntries([...tally].map(([k, v]) => [k, { n: v.n, ms: Math.round(v.ms), max: Math.round(v.max * 100) / 100 }])) };
    tally.clear();
    try { fs.appendFileSync(OUT, JSON.stringify(row) + '\n'); } catch (e) { /* ignore */ }
  }, EVERY);
  fsFlush.unref();
}
