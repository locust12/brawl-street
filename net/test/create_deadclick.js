// Why "Create room" sometimes does nothing at all.
//
// `create` and `quick` both start with
//     if (!requireBuild(c) || c.seat || (c.room && c.room.state !== 'lobby')) return;
// -- a bare `return`, with no message to the client. So whenever the server still has the socket
// attached to a seat or to a non-lobby room, the press is swallowed: no room, no error, no toast,
// nothing for the page to react to or recover from. The player presses it again and it does nothing
// again, because nothing about the state ever changes.
//
// This proves each way in, and the compound one that matters: `leave` shares the lobby rate bucket,
// so when the bucket is empty the leave is REFUSED, the page believes it left, and from then on every
// Create is silently dropped. That is a dead button for the rest of the session.
//
//   node test/create_deadclick.js [--url ws://127.0.0.1:8790/ws]
const crypto = require('crypto');
const engine = require('../lib/engine');
const { LightBot, driveAll } = require('./light_bot');

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const URL = arg('url', 'ws://127.0.0.1:8790/ws');
const info = engine.load();
const BUILD = info.digest;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (c, m) => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${m}`); c ? pass++ : fail++; };

async function bot(name) {
  const b = new LightBot(name, URL, { token: crypto.randomBytes(32).toString('hex'), build: BUILD, seed: Date.now() });
  await b.connect();
  await b.until(m => m.k === 'welcome', 10000, 'welcome');
  return b;
}

// Send `create` and report what came back within `ms`: a room, an error, or silence.
async function tryCreate(b, ms = 3000) {
  b.inbox.length = 0;
  b.raw({ k: 'create', size: 2, stake: 0, stage: 'random', stocks: 3, items: true });
  try { const m = await b.until(x => x.k === 'room' || x.k === 'err', ms, 'create reply'); return m.k === 'room' ? { room: m } : { err: m }; }
  catch (e) { return { silence: true }; }
}

(async () => {
  console.log('create dead-click probe  ' + URL + '\n');

  // ---------------------------------------------------------------- 1. mid-match
  console.log('1. socket is in a running match, player presses Create');
  {
    const a = await bot('DC-a1'), c = await bot('DC-b1');
    const r = await (async () => { a.raw({ k: 'create', size: 2, stake: 0 }); return a.until(m => m.k === 'room', 8000, 'room'); })();
    c.raw({ k: 'join', code: r.code }); await c.until(m => m.k === 'room' && m.members.length === 2, 8000, 'joined');
    for (const x of [a, c]) { x.raw({ k: 'pick', char: 'doge' }); x.raw({ k: 'ready', on: true }); }
    await Promise.all([a, c].map(x => x.until(m => m.k === 'start', 15000, 'start')));
    const drive = driveAll([a, c]);
    await sleep(600);
    const got = await tryCreate(a);
    clearInterval(drive);
    ok(!got.silence, 'Create mid-match answers something' + (got.silence ? ' -- SILENT, dead button' : got.err ? ' (err: ' + got.err.msg + ')' : ' (made room ' + got.room.code + ')'));
    a.close(); c.close();
  }

  // ---------------------------------------------------------------- 2. leave refused by the rate limit
  console.log('\n2. lobby bucket is empty, so `leave` is refused, then player presses Create');
  {
    const a = await bot('DC-a2'), c = await bot('DC-b2');
    a.raw({ k: 'create', size: 2, stake: 0 });
    const r = await a.until(m => m.k === 'room', 8000, 'room');
    c.raw({ k: 'join', code: r.code }); await c.until(m => m.k === 'room' && m.members.length === 2, 8000, 'joined');
    for (const x of [a, c]) { x.raw({ k: 'pick', char: 'doge' }); x.raw({ k: 'ready', on: true }); }
    await Promise.all([a, c].map(x => x.until(m => m.k === 'start', 15000, 'start')));
    const drive = driveAll([a, c]);
    // burn the bucket the way a busy page does: board, social, stats, settings
    a.inbox.length = 0;
    for (let i = 0; i < 40; i++) a.raw({ k: 'stats' });
    await sleep(300);
    // Before the two buckets were split this refused 19 of 40, and every refusal came out of the
    // same allowance Create and Ready draw from.
    const refused = a.inbox.filter(m => m.k === 'err' && m.code === 'rate').length;
    ok(refused === 0, `40 read-only queries in a row cost the player nothing (${refused} refused)`);
    a.inbox.length = 0;
    a.raw({ k: 'leave' });
    const leaveReply = await a.until(m => m.k === 'left' || (m.k === 'err' && m.code === 'rate'), 3000, 'leave reply').catch(() => ({ k: 'silence' }));
    const leaveRefused = leaveReply.k === 'err';
    ok(!leaveRefused, 'leave is honoured with an empty bucket' + (leaveRefused ? ' -- REFUSED, so the player is stuck in the room' : ''));
    const got = await tryCreate(a);
    clearInterval(drive);
    ok(!got.silence, 'Create after a refused leave answers something' + (got.silence ? ' -- SILENT, dead button for the rest of the session' : got.err ? ' (err: ' + got.err.msg + ')' : ' (made room ' + got.room.code + ')'));
    a.close(); c.close();
  }

  // ---------------------------------------------------------------- 3. quick, same door
  console.log('\n3. same socket state, player presses Quick match instead');
  {
    const a = await bot('DC-a3'), c = await bot('DC-b3');
    a.raw({ k: 'create', size: 2, stake: 0 });
    const r = await a.until(m => m.k === 'room', 8000, 'room');
    c.raw({ k: 'join', code: r.code }); await c.until(m => m.k === 'room' && m.members.length === 2, 8000, 'joined');
    for (const x of [a, c]) { x.raw({ k: 'pick', char: 'doge' }); x.raw({ k: 'ready', on: true }); }
    await Promise.all([a, c].map(x => x.until(m => m.k === 'start', 15000, 'start')));
    const drive = driveAll([a, c]);
    await sleep(400);
    a.inbox.length = 0;
    a.raw({ k: 'quick', size: 2, stake: 0 });
    const got = await a.until(m => m.k === 'room' || m.k === 'err', 3000, 'quick reply').catch(() => null);
    clearInterval(drive);
    ok(!!got, 'Quick mid-match answers something' + (got ? '' : ' -- SILENT, dead button'));
    a.close(); c.close();
  }

  // ---------------------------------------------------------------- 4. the honest baseline
  console.log('\n4. clean socket, nothing held');
  {
    const a = await bot('DC-a4');
    const got = await tryCreate(a);
    ok(!!got.room, 'Create on a clean socket makes a room');
    a.close();
  }

  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('probe died:', e); process.exit(3); });
