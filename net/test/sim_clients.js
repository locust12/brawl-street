// End-to-end test: simulated players connect to a real Brawlstreet server over WebSocket and play full
// matches with the same lockstep code the page uses (NetLockstep from src/63_netsim.js), each in its own
// copy of the fight engine. Checks: every match completes, no desync, every client and the server agree
// on the winner and the final state, the public replay file re-runs to the same result, and the practice
// pot moved to the right player.
//
//   node test/sim_clients.js                 # starts a local server on a free port and runs every scenario
//   node test/sim_clients.js --url wss://host/ws [--only 1v1,ffa4] [--lat 40]
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const engine = require('../lib/engine');
const { Bot } = require('./bot');

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const REMOTE = arg('url', null);
const ONLY = arg('only', null);
const LAT = +arg('lat', REMOTE ? 0 : 25);     // extra one-way latency per client (ms), each direction
const JIT = +arg('jit', REMOTE ? 0 : 15);
const SPEED = +arg('speed', 1);
const info = engine.load();


// main-thread handle for a bot that runs in its own worker thread (its own event loop, like a real browser tab)
const ALL = [];
class BotProxy {
  constructor(name, url, opts = {}) {
    ALL.push(this);
    this.name = name; this.token = opts.token || crypto.randomBytes(32).toString('hex');
    this.inbox = []; this.waiters = []; this.st = {}; this.desyncs = []; this.lock = null;
    this.w = new Worker(__filename, { workerData: { name, url, token: this.token, lat: opts.lat ?? LAT, jit: opts.jit ?? JIT }, env: Object.assign({}, process.env, { BOT_SPEED: String(SPEED) }) });
    this.w.on('message', x => {
      if (x.state) { this.st = x.state; this.localEnd = x.state.localEnd; this.lock = x.state.me != null ? { me: x.state.me, dropped: x.state.dropped, stalls: x.state.stalls, stallMs: x.state.stallMs } : this.lock; }
      if (x.type !== 'msg') return;
      const m = x.m;
      if (m.k === 'welcome') this.me = m;
      if (m.k === 'room') this.room = m;
      if (m.k === 'desync') this.desyncs.push(m);
      this.inbox.push(m);
      for (const wt of this.waiters.slice()) if (wt.f(m)) { this.waiters.splice(this.waiters.indexOf(wt), 1); wt.res(m); }
    });
    this.w.on('error', e => console.log(name, 'worker error', e.message));
  }
  connect() { return Promise.resolve(); }
  until(f, ms = 20000, what = '') { return Bot.prototype.until.call(this, f, ms, what); }
  raw(msg) { this.w.postMessage({ cmd: 'raw', msg }); }
  stop() { this.w.postMessage({ cmd: 'stop' }); }
  close() { this.w.postMessage({ cmd: 'close' }); setTimeout(() => this.w.terminate(), 300); }
  kill() { this.w.postMessage({ cmd: 'kill' }); setTimeout(() => this.w.terminate(), 300); }
}

// ---------------------------------------------------------------- server
let srv = null, baseWs = REMOTE, baseHttp = null, dataDir = null;
async function startServer() {
  if (REMOTE) { baseHttp = REMOTE.replace(/^ws/, 'http').replace(/\/ws$/, ''); return; }
  const port = 20000 + crypto.randomInt(20000);
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-net-'));
  srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: Object.assign({}, process.env, { PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, START_DELAY_MS: '600', GRACE_MS: '8000',
      STALL_DROP_MS: '8000', READY_WINDOW_MS: '600000', FFA_COUNTDOWN_MS: '1500', BOARD_SHOW_TESTS: '1', QUIET: process.env.VERBOSE ? '0' : '1', PUBLIC_DIR: path.join(__dirname, '..', '..'),
      // Every bot is 127.0.0.1, which production refuses for ranked and real-ETH rooms (one person
      // must not hold both seats) and which the new-account budget is there to throttle.
      // Both are lifted for the local test server only.
      // Every simulated player is 127.0.0.1, so the production anti-flood budgets would throttle
      // the suite itself. NEW_ACCT_GLOBAL is the whole-server ceiling added with the 9/21 fixes.
      NEW_ACCT_PER_IP: '100000', NEW_ACCT_GLOBAL: '1000000', SAME_IP_OK: '1' }),
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  baseWs = `ws://127.0.0.1:${port}/ws`; baseHttp = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 600; i++) { try { const r = await fetch(baseHttp + '/healthz'); if (r.ok) return; } catch (e) { /* not up yet */ } await new Promise(r => setTimeout(r, 200)); }
  throw new Error('server did not start');
}

// ---------------------------------------------------------------- checks
const report = [];
async function verify(name, bots, opts = {}) {
  const res = await Promise.all(bots.filter(b => !b.gone).map(b => b.until(m => m.k === 'result', opts.ms || (REMOTE ? 600000 : 300000), 'result')));
  const R = res[0];
  const problems = [];
  if (res.some(x => x.id !== R.id || x.winner !== R.winner || x.payee !== R.payee)) problems.push('clients got different results');
  if (R.reason !== (opts.reason || R.reason)) problems.push('reason ' + R.reason + ' != ' + opts.reason);
  const live = bots.filter(b => !b.gone && !(b.lock && b.lock.dropped));
  for (const b of bots) if (b.desyncs.length) problems.push(b.name + ' saw desync ' + JSON.stringify(b.desyncs[0]));
  if (R.desync && R.desync.length) problems.push('server flagged desync ' + R.desync);
  if (R.reason === 'ko' || R.reason === 'time') {
    // each still-connected client must have finished the same fight locally
    for (const b of live) {
      for (let k = 0; k < 400 && !b.localEnd; k++) await new Promise(r => setTimeout(r, 25));
      if (!b.localEnd) { problems.push(b.name + ' did not finish locally'); continue; }
      if (b.localEnd.winner !== R.winner) problems.push(b.name + ' local winner ' + b.localEnd.winner + ' != server ' + R.winner);
      if (b.localEnd.tick !== R.ticks) problems.push(b.name + ' local end tick ' + b.localEnd.tick + ' != server ' + R.ticks);
    }
    const h = live.map(b => b.localEnd && b.localEnd.hash);
    if (new Set(h).size > 1) problems.push('final state hashes differ ' + h);
  }
  // the public replay file re-runs to the same result
  const rep = await (await fetch(baseHttp + '/api/replay/' + R.id)).json();
  if (R.reason !== 'cancelled') {
    const rr = engine.replay(rep.cfg, rep.log, rep.events, undefined, engine.get(rep.engine) ? rep.engine : undefined);
    if (R.reason === 'ko' || R.reason === 'time') {
      if (rr.winner !== R.winner) problems.push('replay winner ' + rr.winner + ' != ' + R.winner);
      if (rr.ticks !== R.ticks) problems.push('replay ticks ' + rr.ticks + ' != ' + R.ticks);
      for (const [t, hv] of Object.entries(rep.hashes)) if (rr.hashes[t] !== hv) { problems.push('replay hash differs at ' + t); break; }
    }
  }
  // practice money: the payee got the pot, everyone else lost the stake
  for (let i = 0; i < res.length; i++) {
    const b = bots.filter(x => !x.gone)[i], you = res[i].you;
    const want = (you === R.payee ? R.pot : 0) - R.stake;
    if (R.reason !== 'cancelled' && Math.abs(res[i].deltas[you] - want) > 1e-9) problems.push(b.name + ' delta ' + res[i].deltas[you] + ' != ' + want);
    if (b.balBefore != null && Math.abs(res[i].bal - (b.balBefore + want)) > 1e-9) problems.push(b.name + ' balance ' + res[i].bal + ' != ' + (b.balBefore + want));
  }
  await new Promise(r => setTimeout(r, 300));
  const stalls = bots.filter(b => b.lock).map(b => b.st.stalls + '/' + b.st.stallMs + 'ms');
  const line = { scenario: name, ok: !problems.length, reason: R.reason, winner: R.winner, payee: R.payee, ticks: R.ticks, secs: +(R.ticks / 60).toFixed(1),
    pot: R.pot, players: R.stats.length, stalls: stalls.join(' '), replay: R.replay.slice(0, 18), problems };
  report.push(line);
  console.log(JSON.stringify(line));
  return R;
}

async function bots(n, prefix, opts) {
  const out = [];
  for (let i = 0; i < n; i++) { const b = new BotProxy(prefix + (i + 1), baseWs, opts); await b.connect(); await b.until(m => m.k === 'welcome', REMOTE ? 90000 : 90000, 'welcome'); b.balBefore = b.me.bal; out.push(b); }
  return out;
}
async function readyAll(bs, chars) {
  for (let i = 0; i < bs.length; i++) { bs[i].raw({ k: 'pick', char: chars[i % chars.length] }); }
  for (const b of bs) b.raw({ k: 'ready', on: true });
}
async function refillIfLow(b, stake) { if (b.me.bal < stake) { b.raw({ k: 'refill' }); const m = await b.until(x => x.k === 'me', 5000, 'refill'); b.balBefore = m.bal; } }

const SCEN = {
  // quick match 1v1 with a stake
  async '1v1'() {
    const [a, b] = await bots(2, 'Duo');
    for (const x of [a, b]) await refillIfLow(x, 0.05);
    a.raw({ k: 'quick', size: 2, stake: 0.05 }); await a.until(m => m.k === 'room', 5000, 'room');
    b.raw({ k: 'quick', size: 2, stake: 0.05 }); await b.until(m => m.k === 'room' && m.members.length === 2, 5000, 'room');
    await readyAll([a, b], ['doge', 'pepe']);
    await verify('1v1 quick match, 0.05 stake', [a, b]);
    a.close(); b.close();
  },
  // private 4-player free-for-all joined by room code
  async ffa4() {
    const bs = await bots(4, 'Four');
    for (const x of bs) await refillIfLow(x, 0.01);
    bs[0].raw({ k: 'create', size: 4, stake: 0.01, cpuFill: false, stocks: 2, stage: 'isle', items: true });
    const room = await bs[0].until(m => m.k === 'room', 5000, 'room');
    for (const b of bs.slice(1)) { b.raw({ k: 'join', code: room.code }); await b.until(m => m.k === 'room', 5000, 'join'); }
    await readyAll(bs, ['bonk', 'wif', 'pengu', 'shib']);
    await verify('4-player FFA by room code, 0.01 stake', bs);
    bs.forEach(b => b.close());
  },
  // two humans + CPU fill, host starts early
  async cpufill() {
    const bs = await bots(2, 'Fill');
    bs[0].raw({ k: 'create', size: 4, stake: 0, cpuFill: true, stocks: 1, stage: 'roof' });
    const room = await bs[0].until(m => m.k === 'room', 5000, 'room');
    bs[1].raw({ k: 'join', code: room.code }); await bs[1].until(m => m.k === 'room', 5000, 'join');
    await readyAll(bs, ['trump', 'clanker']);
    await bs[0].until(m => m.k === 'room' && m.members.every(x => x.ready), 5000, 'all ready');
    bs[0].raw({ k: 'start' });
    await verify('FFA 2 humans + 2 CPUs (host starts)', bs);
    bs.forEach(b => b.close());
  },
  // a free-for-all player vanishes: after the grace period their fighter becomes a CPU, the rest play on
  async drop() {
    const bs = await bots(3, 'Drop');
    for (const x of bs) await refillIfLow(x, 0.01);
    bs[0].raw({ k: 'create', size: 4, stake: 0.01, cpuFill: false, stocks: 2, stage: 'dojo' });
    const room = await bs[0].until(m => m.k === 'room', 5000, 'room');
    for (const b of bs.slice(1)) { b.raw({ k: 'join', code: room.code }); await b.until(m => m.k === 'room', 5000, 'join'); }
    await readyAll(bs, ['cheems', 'floki', 'lobster']);
    await bs[0].until(m => m.k === 'room' && m.members.length === 3 && m.members.every(x => x.ready), 5000, 'all ready');
    bs[0].raw({ k: 'start' });
    await bs[2].until(m => m.k === 'start', 8000, 'start');
    await new Promise(r => setTimeout(r, 6000));
    bs[2].kill(); bs[2].gone = true;
    const drop = await bs[0].until(m => m.k === 'drop', 20000, 'drop event');
    const R = await verify('FFA player disconnects -> CPU takes over', bs);
    if (R.payee === drop.slot) report[report.length - 1].problems.push('dropped player got the pot');
    bs.forEach(b => b.close());
  },
  // 1v1 connection blip: the player comes back inside the grace window and resumes from the input log
  async resume() {
    const [a, b] = await bots(2, 'Blip');
    a.raw({ k: 'create', size: 2, stake: 0, stocks: 2, stage: 'keep' });
    const room = await a.until(m => m.k === 'room', 5000, 'room');
    b.raw({ k: 'join', code: room.code }); await b.until(m => m.k === 'room', 5000, 'join');
    await readyAll([a, b], ['cashcat', 'topg']);
    await b.until(m => m.k === 'start', 8000, 'start');
    await new Promise(r => setTimeout(r, 5000));
    b.kill();
    await new Promise(r => setTimeout(r, 1000));
    const b2 = new BotProxy('Blip2b', baseWs, { token: b.token }); await b2.connect();
    const rs = await b2.until(m => m.k === 'resume', 8000, 'resume');
    if (!rs.log || !rs.log[0].length) throw new Error('empty resume log');
    await verify('1v1 disconnect + resume inside grace', [a, b2]);
    a.close(); b2.close();
  },
  // friends by code, challenge -> ranked 1v1 carrying custom looks, Elo + public leaderboard, chat, recovery code
  async social() {
    const probs = [];
    const [a, b] = await bots(2, 'Soc');
    const pa = a.me.profile, pb = b.me.profile;
    if (!pa || !/^[A-Z0-9]{6}$/.test(pa.fc)) probs.push('no friend code in profile');
    // looks: saved on the account, sanitized by the server
    a.raw({ k: 'look', look: { v: 1, base: 'pepe', tint: 'gold', finish: 'chrome', hat: 'crown', eyes: 'laser', neck: 'ice', aura: 'volt',
      skin: 'pale', hair: 'mohawk', haircol: '#ff0044', shoes: 'boots', x: '@Duane_X', name: 'Frog<b>King', title: 'Chart Wizard' } });
    const me = await a.until(m => m.k === 'me' && m.profile && m.profile.look, 5000, 'look saved');
    const lk = me.profile.look;
    if (lk.name !== 'FrogbKing') probs.push('look name not sanitized: ' + lk.name);
    // parts the creator added later must survive the server round trip
    for (const k of ['skin', 'hair', 'haircol', 'shoes']) if (!lk[k]) probs.push('look lost ' + k);
    if (lk.x !== 'duane_x') probs.push('x handle not normalised: ' + lk.x);
    a.raw({ k: 'look', look: Object.assign({}, lk, { x: 'FuckLord' }) });
    await new Promise(r => setTimeout(r, 300));
    a.raw({ k: 'look', look: Object.assign({}, lk, { x: 'way_too_long_handle_here' }) });
    const me2 = await a.until(m => m.k === 'me' && m.profile, 5000, 'handle rejected');
    if (me2.profile.look.x) probs.push('bad x handle kept: ' + me2.profile.look.x);
    a.raw({ k: 'look', look: lk });
    await a.until(m => m.k === 'me' && m.profile.look && m.profile.look.x === 'duane_x', 5000, 'handle back');
    // friends: A adds B by friend code, B accepts, both see each other online
    a.raw({ k: 'friend_add', q: 'BS-' + pb.fc });
    await b.until(m => m.k === 'social' && m.reqIn.length === 1, 5000, 'friend request');
    b.raw({ k: 'friend_accept', id: pa.id });
    const soc = await a.until(m => m.k === 'social' && m.friends.length === 1 && m.friends[0].status !== 'offline', 5000, 'friend online');
    if (soc.friends[0].id !== pb.id) probs.push('wrong friend');
    // challenge: ranked 1v1, B accepts
    a.raw({ k: 'challenge', id: pb.id, stake: 0, ranked: true });
    const ch = await b.until(m => m.k === 'challenge', 5000, 'challenge');
    if (ch.from.id !== pa.id || !ch.ranked) probs.push('challenge payload wrong');
    b.raw({ k: 'challenge_reply', code: ch.code, ok: true });
    const room = await a.until(m => m.k === 'room' && m.members.length === 2, 5000, 'challenge room');
    if (!room.ranked || !room.members.find(x => x.look && x.look.base === 'pepe')) probs.push('room lacks ranked flag or look');
    if (!room.members.find(x => x.x === 'duane_x')) probs.push('room member has no x handle');
    // chat: quick line, filtered text, rate limit
    a.raw({ k: 'chat', q: 'gg' }); a.raw({ k: 'chat', t: 'nice <script>x</script> shit' });
    const q1 = await b.until(m => m.k === 'chat' && m.q === 'gg', 5000, 'quick chat');
    const t1 = await b.until(m => m.k === 'chat' && m.t, 5000, 'text chat');
    if (q1.name !== 'Soc1') probs.push('chat sender name');
    if (/shit/.test(t1.t) || t1.t.length > 120) probs.push('profanity not filtered: ' + t1.t);
    for (let i = 0; i < 5; i++) b.raw({ k: 'chat', q: 'wow' });
    await b.until(m => m.k === 'err' && m.code === 'chatrate', 5000, 'chat rate limit');
    // ranked match with looks in the start message
    a.raw({ k: 'pick', char: 'pepe' }); b.raw({ k: 'pick', char: 'doge' });
    a.raw({ k: 'set', stocks: 1 });
    await a.until(m => m.k === 'room' && m.stocks === 1, 5000, 'stocks');
    a.raw({ k: 'ready', on: true }); b.raw({ k: 'ready', on: true });
    const st = await a.until(m => m.k === 'start', 10000, 'start');
    if (!st.ranked || !st.looks || !st.looks[st.you] || st.looks[st.you].base !== 'pepe') probs.push('start message lacks looks/ranked');
    if (!st.handles || st.handles[st.you] !== 'duane_x') probs.push('start message lacks the x handle');
    if (JSON.stringify(st.cfg).includes('FrogbKing')) probs.push('look leaked into the fight config');
    const R = await verify('friends + challenge -> ranked 1v1 with custom look', [a, b]);
    if (!R.elo || Object.keys(R.elo).length !== 2) probs.push('no Elo change on a ranked match');
    else { const w = R.elo[R.payee]; if (!(w.d > 0) || w.elo !== 1200 + w.d) probs.push('winner Elo off ' + JSON.stringify(R.elo)); }
    const lb = await (await fetch(baseHttp + '/api/leaderboard')).json();
    if (REMOTE) { if (lb.all.some(r => /^Soc\d/.test(r.name))) probs.push('test accounts leaked onto the public leaderboard'); }
    else if (!lb.all.length || !lb.week.length || lb.all[0].elo <= 1200) probs.push('leaderboard missing the winner');
    // recovery: A gets a code, a fresh device restores the account with it
    a.raw({ k: 'recovery_new' });
    const rc = await a.until(m => m.k === 'recovery', 5000, 'recovery code');
    const n = new BotProxy('SocNew', baseWs); await n.connect(); await n.until(m => m.k === 'welcome', 20000, 'welcome');
    n.raw({ k: 'recover', code: rc.code.toLowerCase() });
    const rec = await n.until(m => m.k === 'me' && m.recovered, 5000, 'recovered');
    if (rec.profile.id !== pa.id || rec.profile.fc !== pa.fc || !rec.profile.look) probs.push('recovery did not restore the account');
    // the recovered device gets the fighter back, gear and handle included
    if (!rec.profile.look || rec.profile.look.base !== 'pepe' || rec.profile.look.hair !== 'mohawk' || rec.profile.look.x !== 'duane_x') probs.push('recovery did not restore the custom fighter');
    // on the public server the test accounts are hidden from the board by design, so only check the row locally
    if (!REMOTE) {
      const mine = lb.all.find(r => r.name === a.name);
      if (!lb.all.length || !mine || mine.x !== 'duane_x') probs.push('leaderboard row has no x handle: ' + JSON.stringify(mine));
    } else if (lb.all.some(r => /^Soc\d/.test(r.name))) probs.push('test accounts leaked onto the public leaderboard');
    n.raw({ k: 'recover', code: 'AAAA-BBBB-CCCC-DDDD' });
    await n.until(m => m.k === 'err' && m.code === 'recover', 5000, 'bad code rejected');
    const line = report[report.length - 1]; line.problems.push(...probs); line.ok = !line.problems.length;
    console.log(JSON.stringify({ scenario: 'social checks', ok: !probs.length, elo: R.elo, board: { all: lb.all.length, week: lb.week.length, top: lb.all[0] }, problems: probs }));
    [a, b, n].forEach(x => x.close());
  },
  // quick match with map choice: overlapping picks pair on a shared map, non-overlapping ones don't, widening merges
  async maps() {
    const probs = [];
    const [a, b, c, d] = await bots(4, 'Map');
    // a wants moon/keep, b wants keep/dojo -> they pair on keep
    a.raw({ k: 'quick', size: 2, stake: 0, stages: ['moon', 'keep'] });
    await a.until(m => m.k === 'room', 5000, 'room a');
    b.raw({ k: 'quick', size: 2, stake: 0, stages: ['keep', 'dojo'] });
    const room = await b.until(m => m.k === 'room' && m.members.length === 2, 8000, 'paired');
    if (room.picked !== 'keep') probs.push('picked map ' + room.picked + ' is not the overlap (keep)');
    if (!room.quick || room.size !== 2) probs.push('not a quick 1v1 room');
    // the match really runs on that map
    a.raw({ k: 'pick', char: 'doge' }); b.raw({ k: 'pick', char: 'pepe' });
    a.raw({ k: 'ready', on: true }); b.raw({ k: 'ready', on: true });
    const st = await a.until(m => m.k === 'start', 15000, 'start');
    if (st.cfg.stage !== 'keep') probs.push('match stage ' + st.cfg.stage + ' != picked keep');
    a.raw({ k: 'leave' }); b.raw({ k: 'leave' });
    // c wants isle only, d wants city only: no overlap, so two separate rooms
    c.raw({ k: 'quick', size: 2, stake: 0, stages: ['isle'] });
    const rc = await c.until(m => m.k === 'room', 5000, 'room c');
    d.raw({ k: 'quick', size: 2, stake: 0, stages: ['city'] });
    const rd = await d.until(m => m.k === 'room', 5000, 'room d');
    if (rc.code === rd.code) probs.push('paired players whose map picks do not overlap');
    // d drops the filter -> matchmaking runs again and puts them together on isle
    d.raw({ k: 'widen' });
    const rd2 = await d.until(m => m.k === 'room' && m.members.length === 2, 8000, 'widened into a match');
    if (rd2.code !== rc.code) probs.push('widening did not join the waiting room');
    if (rd2.picked !== 'isle') probs.push('widened match picked ' + rd2.picked + ' instead of isle');
    console.log(JSON.stringify({ scenario: 'quick match map choice', ok: !probs.length, overlapMap: room.picked, widenedMap: rd2.picked, problems: probs }));
    report.push({ scenario: 'quick match map choice', ok: !probs.length, problems: probs });
    [a, b, c, d].forEach(x => x.close());
  },
  // a lost input batch must not wedge the match: the server asks for it again (this is the bug that killed
  // Duane's matches: one hole in the stream and both players waited until the server dropped someone)
  async gap() {
    const probs = [];
    const [a, b] = await bots(2, 'Gap');
    a.raw({ k: 'create', size: 2, stake: 0, stocks: 1, stage: 'street' });
    const room = await a.until(m => m.k === 'room', 8000, 'room');
    b.raw({ k: 'join', code: room.code }); await b.until(m => m.k === 'room', 8000, 'join');
    a.raw({ k: 'pick', char: 'doge' }); b.raw({ k: 'pick', char: 'pepe' });
    a.raw({ k: 'ready', on: true }); b.raw({ k: 'ready', on: true });
    await a.until(m => m.k === 'start', 20000, 'start');
    await new Promise(r => setTimeout(r, 4000));
    a.w.postMessage({ cmd: 'drop', n: 3 });          // three input batches vanish
    await new Promise(r => setTimeout(r, 1000));
    b.w.postMessage({ cmd: 'drop', n: 2 });
    const R = await verify('lost input batches are asked for again', [a, b]);
    await new Promise(r => setTimeout(r, 400));
    if (R.reason !== 'ko' && R.reason !== 'time') probs.push('match did not finish normally: ' + R.reason);
    if (!(a.st.needs > 0 || b.st.needs > 0)) probs.push('server never asked for the missing inputs');
    const line = report[report.length - 1]; line.problems.push(...probs); line.ok = !line.problems.length;
    console.log(JSON.stringify({ scenario: 'input gap recovery', ok: !probs.length, reason: R.reason, resendsA: a.st.needs, resendsB: b.st.needs, lostA: a.st.lostBatches, lostB: b.st.lostBatches, problems: probs }));
    a.close(); b.close();
  },
  // 1v1: one player leaves mid-match and forfeits the pot
  async forfeit() {
    const [a, b] = await bots(2, 'Quit');
    for (const x of [a, b]) await refillIfLow(x, 0.1);
    a.raw({ k: 'create', size: 2, stake: 0.1, stocks: 3, stage: 'chart' });
    const room = await a.until(m => m.k === 'room', 5000, 'room');
    b.raw({ k: 'join', code: room.code }); await b.until(m => m.k === 'room', 5000, 'join');
    await readyAll([a, b], ['wojak', 'pepe']);
    await b.until(m => m.k === 'start', 8000, 'start');
    await new Promise(r => setTimeout(r, 3000));
    b.raw({ k: 'leave' }); b.stop(); b.gone = true;
    const R = await verify('1v1 player leaves -> forfeit', [a, b], { reason: 'forfeit' });
    if (R.payee !== a.lock.me) report[report.length - 1].problems.push('forfeit pot went to the wrong player');
    a.close(); b.close();
  },
};

if (!isMainThread) {
  const d = workerData, b = new Bot(d.name, d.url, { token: d.token, lat: d.lat, jit: d.jit });
  b.emit = m => parentPort.postMessage({ type: 'msg', m, state: b.state() });
  b.onState = () => parentPort.postMessage({ type: 'state', state: b.state() });
  parentPort.on('message', x => {
    if (x.cmd === 'raw') b.raw(x.msg);
    if (x.cmd === 'stop') b.stop();
    if (x.cmd === 'close') b.close();
    if (x.cmd === 'kill') b.kill();
    if (x.cmd === 'drop') b.dropNext = x.n;
  });
  b.connect().catch(e => parentPort.postMessage({ type: 'msg', m: { k: 'err', msg: 'connect failed ' + e.message } }));
  return;
}
if (process.env.LAGMON) { let last = performance.now(), worst = 0; setInterval(() => { const n = performance.now(); worst = Math.max(worst, n - last - 10); last = n; }, 10); setInterval(() => { console.log('event-loop worst lag', worst.toFixed(1), 'ms', 'heap', (process.memoryUsage().heapUsed / 1e6).toFixed(0) + 'MB'); worst = 0; }, 2000); }
(async () => {
  await startServer();
  const names = ONLY ? ONLY.split(',') : Object.keys(SCEN);
  let fail = 0;
  for (const n of names) {
    try { await SCEN[n](); } catch (e) { fail++; console.log(JSON.stringify({ scenario: n, ok: false, error: e.message })); }
    for (const b of ALL.splice(0)) { try { b.close(); } catch (e) { /* gone */ } }
  }
  fail += report.filter(r => !r.ok).length;
  console.log(JSON.stringify({ engine: info.digest, server: baseWs, scenarios: names.length, failed: fail }));
  if (srv) srv.kill('SIGTERM');
  setTimeout(() => process.exit(fail ? 1 : 0), 400);
})();
