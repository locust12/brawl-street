// One seat of a two-country fight, so the other seat can be a different machine on a different
// continent with a genuinely different IP. Everything else here models a link; this does not.
//
//   on this Mac:   node test/crossip_seat.js --host --url wss://<region>/ws --stake 0.01
//                  prints  ROOM <code>  and then waits for someone to take the other seat
//   on the box:    node test/crossip_seat.js --join <code> --url wss://<region>/ws
//
// Both sides print the same shape of JSON when the fight ends, so the two can be compared: same
// match id, same winner, and the round trip each side actually had.
const crypto = require('crypto');
const engine = require('../lib/engine');
const { LightBot, driveAll } = require('./light_bot');

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const has = k => args.includes('--' + k);

const URL = arg('url', 'wss://brawlstreet.5-223-91-79.sslip.io/ws');
const HOST = has('host');
const CODE = arg('join', null);
const STAKE = +arg('stake', 0);
const SIZE = +arg('size', 2);
const SECS = +arg('secs', 60);
const WAIT = +arg('wait', 120);          // how long the host waits for the other seat
const TAG = arg('tag', HOST ? 'host' : 'guest');

const info = engine.load();
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const b = new LightBot('X-' + TAG + '-' + crypto.randomBytes(2).toString('hex'), URL,
    { token: crypto.randomBytes(32).toString('hex'), build: info.digest, seed: Date.now() & 0xffff });
  await b.connect();
  const w = await b.until(m => m.k === 'welcome', 40000, 'welcome');
  if (!w.build || !w.build.ok) { console.log(JSON.stringify({ tag: TAG, ok: false, why: 'server refused this build', build: info.digest })); process.exit(2); }
  const region = (w.region || {}).label || '?';

  let room;
  if (HOST) {
    b.raw({ k: 'create', size: SIZE, stake: STAKE, stage: 'isle', stocks: 3, items: true, cpuFill: false });
    room = await b.until(m => m.k === 'room', 40000, 'room');
    console.log('ROOM ' + room.code);
    console.log(JSON.stringify({ tag: TAG, stage: 'opened', code: room.code, region, rtt: Math.round(b.rtt) }));
    room = await b.until(m => m.k === 'room' && m.members.length >= SIZE, WAIT * 1000, 'the other seat');
  } else {
    if (!CODE) { console.log(JSON.stringify({ tag: TAG, ok: false, why: 'no --join code' })); process.exit(2); }
    b.raw({ k: 'join', code: CODE });
    room = await b.until(m => m.k === 'room' && m.code === CODE.toUpperCase(), 40000, 'join ' + CODE);
    console.log(JSON.stringify({ tag: TAG, stage: 'joined', code: room.code, region, rtt: Math.round(b.rtt) }));
  }

  // the other side's ping, as the server measured it: proof the two seats really are far apart
  const pings = room.members.map(m => m.name + '=' + m.ping + 'ms');
  await sleep(2500);
  b.raw({ k: 'pick', char: HOST ? 'pepe' : 'doge' });
  b.raw({ k: 'ready', on: true });
  const start = await b.until(m => m.k === 'start', 90000, 'start');
  const drive = driveAll([b]);
  const res = await Promise.race([b.until(m => m.k === 'result', SECS * 1000, 'result').catch(() => null), sleep(SECS * 1000).then(() => null)]);
  clearInterval(drive);
  const st = b.state();
  console.log(JSON.stringify({
    tag: TAG, ok: true, region, code: room.code, match: start.id,
    roomPings: pings, delayFrames: start.delay, delayNow: b.delay,
    rtt: st.rtt, jit: st.jit, ticks: st.tick,
    stalls: st.stalls, stallMs: st.stallMs, stallPct: Math.round((st.stallMs / (SECS * 1000)) * 100),
    needs: st.needs, result: res ? { winner: res.winner, reason: res.reason, ticks: res.ticks } : 'still fighting at cutoff',
  }));
  b.close();
  process.exit(0);
})().catch(e => { console.log(JSON.stringify({ tag: TAG, ok: false, why: String(e.message || e) })); process.exit(3); });
