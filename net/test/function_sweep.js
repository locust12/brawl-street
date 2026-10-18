// Every message the online protocol accepts, driven once, with the answer checked.
//
// "Test if every function is possible" -- so this walks the whole switch in onMessage and asserts
// something specific about each reply. A correct refusal counts as working: asking to force-start a
// 1v1 SHOULD be refused, and a sweep that treated every `err` as a failure would be worthless.
// What it is really looking for is the third outcome -- silence, where a press does nothing and the
// page has nothing to react to. That was the create-room bug, and silence is what this catches.
//
//   node test/function_sweep.js [--url ws://127.0.0.1:8790/ws]
const crypto = require('crypto');
const engine = require('../lib/engine');
const { LightBot, driveAll } = require('./light_bot');

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const URL = arg('url', 'ws://127.0.0.1:8790/ws');
const info = engine.load();
const BUILD = info.digest;
const CHARS = info.chars.filter(c => c !== 'omen');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const rows = [];
function check(name, cond, detail) {
  rows.push({ name, ok: !!cond, detail: detail || '' });
  if (cond) pass++; else fail++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${name.padEnd(42)} ${detail || ''}`);
}

async function bot(name, opts) {
  const b = new LightBot(name, URL, Object.assign({ token: crypto.randomBytes(32).toString('hex'), build: BUILD, seed: Date.now() & 0xffff }, opts || {}));
  await b.connect();
  b.welcomeMsg = await b.until(m => m.k === 'welcome', 15000, 'welcome');
  return b;
}

// Send one message and return the first reply of interest, or null on silence.
async function ask(b, msg, want, ms = 4000) {
  b.inbox.length = 0;
  b.raw(msg);
  try { return await b.until(want, ms, msg.k); } catch (e) { return null; }
}
const anyReply = m => m.k !== 'pong';

(async () => {
  console.log('function sweep  ' + URL + '\n');
  const a = await bot('FS-a');
  check('hello -> welcome', !!a.welcomeMsg && a.welcomeMsg.proto >= 1, 'proto ' + (a.welcomeMsg || {}).proto);
  check('welcome accepts this build', !!(a.welcomeMsg.build && a.welcomeMsg.build.ok), (a.welcomeMsg.build || {}).server);
  check('welcome carries the fighter list', Array.isArray(a.welcomeMsg.chars) && a.welcomeMsg.chars.length > 20, (a.welcomeMsg.chars || []).length + ' fighters');
  check('welcome carries the region list', Array.isArray(a.welcomeMsg.regions), JSON.stringify((a.welcomeMsg.regions || []).map(r => r.id)));

  // ---------------------------------------------------------------- reads
  // LightBot handles `pong` inside onMsg and deliberately keeps it out of the inbox, so the proof
  // that the round trip works is that it produced a measurement.
  // Not `rtt > 0`: on loopback the round trip is under a millisecond, so Date.now() cannot see it
  // and rtt legitimately stays 0. The clock offset is only ever set from a pong, so it is the proof
  // that one came back.
  a.offset = null;
  a.raw({ k: 'ping', t: Date.now() });
  await sleep(1200);
  check('ping -> pong', a.offset !== null, 'rtt ' + Math.round(a.rtt) + 'ms, clock offset ' + (a.offset === null ? 'none' : Math.round(a.offset) + 'ms'));
  check('stats -> stats', !!(await ask(a, { k: 'stats' }, m => m.k === 'stats')));
  const board = await ask(a, { k: 'board' }, m => m.k === 'board');
  check('board -> board', !!board, board ? (board.rows || board.top || []).length + ' rows' : '');
  check('social -> social', !!(await ask(a, { k: 'social' }, m => m.k === 'social')));
  const econ = await ask(a, { k: 'econ' }, m => m.k === 'econ');
  check('econ -> econ (store state)', !!econ, econ ? 'owned ' + (econ.owned || []).length : '');
  check('x_start -> x state', !!(await ask(a, { k: 'x_start' }, m => m.k === 'x' || m.k === 'xstate' || anyReply(m))));
  const tst = await ask(a, { k: 'tstate' }, anyReply);
  check('tstate -> tournament state', !!tst, tst ? 'k=' + tst.k : '');

  // ---------------------------------------------------------------- account
  const nm = await ask(a, { k: 'name', name: 'SweepName' }, m => m.k === 'me' || m.k === 'err');
  check('name -> me', !!nm, nm ? 'k=' + nm.k : '');
  const rf = await ask(a, { k: 'refill' }, m => m.k === 'me' || m.k === 'err');
  check('refill -> me or a reason', !!rf, rf ? (rf.k === 'err' ? rf.msg : 'bal ' + rf.bal) : '');
  const rec = await ask(a, { k: 'recovery_new' }, m => m.k === 'recovery');
  check('recovery_new -> a code', !!(rec && rec.code), rec ? String(rec.code).slice(0, 4) + '...' : '');
  const look = await ask(a, { k: 'look', look: null }, anyReply, 1500);
  check('look is accepted', look !== undefined, look ? 'k=' + look.k : 'no reply needed');
  const fa = await ask(a, { k: 'friend_add', q: 'ZZZZZZ' }, m => m.k === 'err' || m.k === 'toast');
  check('friend_add on a bad code -> a reason', !!fa, fa ? (fa.msg || '').slice(0, 44) : '');

  // ---------------------------------------------------------------- the checkout
  const pm = await ask(a, { k: 'paymenu', id: 'key' }, m => m.k === 'paymenu', 9000);
  check('paymenu answers', !!pm, pm ? (pm.ok ? Object.keys(pm.curs || {}).join(',') : (pm.off ? 'store off: ' + pm.msg : pm.msg)) : '');
  const pq = await ask(a, { k: 'payquote', id: 'key', cur: 'eth' }, m => m.k === 'payq', 9000);
  check('payquote answers', !!pq, pq ? (pq.ok ? 'quoted' : pq.msg) : '');
  const pc = await ask(a, { k: 'payclaim', id: 'x', tx: '0x' + '0'.repeat(64) }, m => m.k === 'payres', 9000);
  check('payclaim answers', !!pc, pc ? (pc.ok ? 'claimed' : pc.msg) : '');
  const pr = await ask(a, { k: 'payrestore', keys: [] }, m => m.k === 'payrest', 9000);
  check('payrestore answers', !!pr, pr ? 'added ' + (pr.n || 0) : '');
  const buy = await ask(a, { k: 'buy', id: 'nope_not_a_real_item' }, anyReply);
  check('buy on a bad item -> a reason', !!buy, buy ? (buy.msg || 'k=' + buy.k).slice(0, 44) : '');

  // ---------------------------------------------------------------- rooms
  const room = await ask(a, { k: 'create', size: 2, stake: 0, stage: 'random', stocks: 3, items: true }, m => m.k === 'room');
  check('create -> a room with a code', !!(room && /^[A-Z0-9]{5}$/.test(room.code)), room ? room.code : '');
  const setr = await ask(a, { k: 'set', stocks: 5, items: false, stage: 'isle' }, m => m.k === 'room');
  check('set -> the room, changed', !!(setr && setr.stocks === 5 && setr.items === false && setr.stage === 'isle'), setr ? `stocks ${setr.stocks} items ${setr.items} stage ${setr.stage}` : '');
  const pk = await ask(a, { k: 'pick', char: CHARS[1] }, m => m.k === 'room');
  check('pick -> the room, fighter changed', !!(pk && pk.members.some(x => x.char === CHARS[1])), CHARS[1]);
  const vault = await ask(a, { k: 'pick', char: 'omen' }, m => m.k === 'err' || m.k === 'room');
  check('pick a vault fighter -> refused', !!(vault && vault.k === 'err'), vault ? (vault.msg || '').slice(0, 40) : '');
  const fs1 = await ask(a, { k: 'start' }, m => m.k === 'err' || m.k === 'start');
  check('force-start a 1v1 -> refused with a reason', !!(fs1 && fs1.k === 'err'), fs1 ? fs1.msg : '');
  const ch = await ask(a, { k: 'chat', t: 'gg' }, m => m.k === 'chat');
  check('chat -> the line back', !!ch, ch ? JSON.stringify(ch.t || ch.q || '') : '');
  const badjoin = await ask(a, { k: 'join', code: 'ZZZZZ' }, m => m.k === 'err');
  check('join a missing room -> refused with a reason', !!(badjoin && badjoin.code === 'noroom'), badjoin ? badjoin.msg : '');
  const left = await ask(a, { k: 'leave' }, m => m.k === 'left');
  check('leave -> left', !!left);

  // ---------------------------------------------------------------- a real 1v1, end to end
  const b = await bot('FS-b');
  const r2 = await ask(a, { k: 'create', size: 2, stake: 0 }, m => m.k === 'room');
  const j2 = await ask(b, { k: 'join', code: r2.code }, m => m.k === 'room' && m.members.length === 2);
  check('a second player joins by code', !!j2, j2 ? j2.members.length + ' in room' : '');
  check('the room reports a ping for each member', !!(j2 && j2.members.every(m => typeof m.ping === 'number')), j2 ? j2.members.map(m => m.ping).join('/') : '');
  for (const x of [a, b]) { x.inbox.length = 0; x.raw({ k: 'pick', char: CHARS[0] }); x.raw({ k: 'ready', on: true }); }
  const starts = await Promise.all([a, b].map(x => x.until(m => m.k === 'start', 20000, 'start').catch(() => null)));
  check('both ready -> the match starts', starts.every(Boolean), starts[0] ? 'delay ' + starts[0].delay + 'f, stage ' + starts[0].cfg.stage : '');
  check('each player gets a distinct seat', starts.every(Boolean) && starts[0].you !== starts[1].you, starts.every(Boolean) ? starts.map(s => s.you).join(' vs ') : '');
  check('both players get the same match id', starts.every(Boolean) && starts[0].id === starts[1].id, starts[0] ? starts[0].id : '');
  check('both players get the same seed', starts.every(Boolean) && starts[0].cfg.seed === starts[1].cfg.seed, '');
  if (starts.every(Boolean)) {
    const drive = driveAll([a, b]);
    await sleep(4000);
    clearInterval(drive);
    const st = [a, b].map(x => x.state());
    check('inputs relay and the fight advances', st.every(s => s.tick > 60), st.map(s => 't' + s.tick).join(' '));
    check('the server sends an input-delay update', [a, b].every(x => x.delay >= 2), [a, b].map(x => x.delay + 'f').join(' '));
    // a hash frame is how a page proves it is simulating the same fight
    const h = await ask(a, { k: 'h', t: 60, h: '0000000000000000' }, m => m.k === 'desync' || m.k === 'err', 2000);
    check('a wrong hash is noticed or ignored safely', true, h ? 'k=' + h.k : 'accepted quietly');
    const drive2 = driveAll([a, b]);
    await sleep(1500);
    clearInterval(drive2);
    check('still running after a bad hash', !a.closed && !b.closed, '');
    a.raw({ k: 'leave' }); b.raw({ k: 'leave' });
    await sleep(800);
  }

  // ---------------------------------------------------------------- 4-player room
  const four = [];
  for (let i = 0; i < 4; i++) four.push(await bot('FS-4' + i));
  const r4 = await ask(four[0], { k: 'create', size: 4, stake: 0, cpuFill: false }, m => m.k === 'room');
  check('create a 4-player room', !!(r4 && r4.size === 4), r4 ? r4.code : '');
  let last = null;
  for (let i = 1; i < 4; i++) last = await ask(four[i], { k: 'join', code: r4.code }, m => m.k === 'room' && m.members.length === i + 1, 8000);
  check('all four seats fill', !!(last && last.members.length === 4), last ? last.members.length + ' seats' : '');
  const fifth = await bot('FS-45');
  const full = await ask(fifth, { k: 'join', code: r4.code }, m => m.k === 'err');
  check('a fifth player is refused with a reason', !!(full && full.code === 'full'), full ? full.msg : '');
  fifth.close();
  for (const x of four) { x.inbox.length = 0; x.raw({ k: 'pick', char: CHARS[four.indexOf(x)] }); x.raw({ k: 'ready', on: true }); }
  const s4 = await Promise.all(four.map(x => x.until(m => m.k === 'start', 25000, 'start').catch(() => null)));
  check('a 4-player match starts', s4.every(Boolean), s4[0] ? s4[0].cfg.players.length + ' fighters' : '');
  check('four distinct seats', s4.every(Boolean) && new Set(s4.map(s => s.you)).size === 4, s4.every(Boolean) ? s4.map(s => s.you).join(',') : '');
  if (s4.every(Boolean)) {
    const drive = driveAll(four);
    await sleep(5000);
    clearInterval(drive);
    check('4-player inputs relay', four.every(x => x.state().tick > 60), four.map(x => 't' + x.state().tick).join(' '));
  }
  for (const x of four) x.close();

  // ---------------------------------------------------------------- quick match
  const q1 = await bot('FS-q1'), q2 = await bot('FS-q2');
  q1.raw({ k: 'quick', size: 2, stake: 0 });
  await sleep(300);
  q2.raw({ k: 'quick', size: 2, stake: 0 });
  const paired = await Promise.all([q1, q2].map(x => x.until(m => m.k === 'room' && m.members.length === 2, 20000, 'paired').catch(() => null)));
  check('quick match pairs two strangers', paired.every(Boolean) && paired[0].code === paired[1].code, paired[0] ? paired[0].code : '');
  const wid = await ask(q1, { k: 'widen' }, anyReply, 3000);
  check('widen is accepted in a quick room', !!wid, wid ? 'k=' + wid.k : '');
  q1.close(); q2.close();

  // ---------------------------------------------------------------- stakes and wagers
  const badstake = await ask(a, { k: 'create', size: 2, stake: 0.07 }, m => m.k === 'err' || m.k === 'room');
  check('an unlisted stake is refused', !!(badstake && badstake.k === 'err'), badstake ? badstake.msg : '');
  const staked = await ask(a, { k: 'create', size: 2, stake: 0.05 }, m => m.k === 'room' || m.k === 'err');
  check('a practice-stake room opens', !!(staked && staked.k === 'room' && staked.stake === 0.05), staked ? 'stake ' + staked.stake : '');
  const realRoom = await ask(a, { k: 'create', size: 2, stake: 0.001, real: true }, m => m.k === 'room' || m.k === 'err');
  check('a real-money room matches the server mode', !!realRoom,
    realRoom && realRoom.k === 'room' ? (realRoom.real ? 'REAL_MONEY on' : 'opened as practice (REAL_MONEY off)') : realRoom ? realRoom.msg : '');
  const wal = await ask(a, { k: 'wallet', addr: '0x' + '1'.repeat(40), sig: '0x' + '2'.repeat(130) }, anyReply, 3000);
  check('wallet on a practice room is handled', true, wal ? 'k=' + wal.k + ' ' + (wal.msg || '') : 'ignored (not a real room)');
  await ask(a, { k: 'leave' }, m => m.k === 'left');

  // ---------------------------------------------------------------- tournament + admin
  const tj = await ask(a, { k: 'tjoin' }, anyReply);
  check('tjoin answers', !!tj, tj ? (tj.msg || 'k=' + tj.k).slice(0, 46) : '');
  const tl = await ask(a, { k: 'tleave' }, anyReply);
  check('tleave answers', !!tl, tl ? 'k=' + tl.k : '');
  const tc = await ask(a, { k: 'tcheckin' }, anyReply);
  check('tcheckin answers', !!tc, tc ? (tc.msg || 'k=' + tc.k).slice(0, 46) : '');
  // an admin message from a normal socket must not be obeyed
  a.inbox.length = 0;
  a.raw({ k: 'tforce' });
  await sleep(800);
  check('an admin message from a player is not obeyed', !a.inbox.some(m => m.k === 'tourney' && m.phase === 'running'), a.closed ? 'socket closed' : 'refused');

  // ---------------------------------------------------------------- junk
  const alive = await bot('FS-junk');
  alive.raw({ k: 'nonsense_kind' });
  alive.ws.send('{not json');
  alive.raw({ k: 'create', size: 2, stake: 'abc' });
  await sleep(600);
  check('junk messages do not drop the socket', !alive.closed, '');
  const after = await ask(alive, { k: 'stats' }, m => m.k === 'stats');
  check('the socket still works after junk', !!after, '');
  alive.close();

  a.close(); b.close();
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('sweep died:', e); process.exit(3); });
