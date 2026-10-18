// A load-test client that speaks the wire protocol exactly but does not run the fight.
//
// The full bot (test/bot.js) is the right tool for correctness: it simulates the match locally and so
// catches desyncs. It also costs a worker thread and a 60 Hz fight engine per player, which makes the
// machine running the test run out of cores long before the server does. Past about 50 players the
// numbers then describe the test rig, not the game server.
//
// This client keeps everything the server has to do -- a socket per player, one input message per
// player per tick, the resend path, the ping/pong round trips -- and drops only the local simulation,
// which the server never sees. Hundreds of them fit in one process on one shared 60 Hz timer.
//
// It still paces itself like real lockstep: a player only advances a tick once every other player's
// input for that tick has arrived. Without that it would outrun the match and send unbounded input.
// What it cannot do is check for desync, so it answers "does the box keep up", never "is the fight
// correct". Run sim_clients.js (or load_test.js without --light) for the second question.
const WebSocket = require('ws');

const MAX_DELAY = 15;

class LightBot {
  constructor(name, url, opts = {}) {
    this.name = name; this.url = url; this.token = opts.token;
    this.build = opts.build;
    // A LINK, not just a socket. `lat` is one-way delay in ms and `jit` the spread added on top of
    // it, so the round trip a bot sees is about 2*lat + 2*U(0,jit); `loss` is the fraction of frames
    // the link eats, which lockstep has to recover from with a `need`. Without these every bot on
    // the box is a 0 ms LAN player, and 0 ms is the one network no real player ever has.
    this.lat = opts.lat || 0; this.jit = opts.jit || 0; this.loss = opts.loss || 0;
    // TCP, NOT UDP. A WebSocket never hands the server a message with a hole in it: a lost packet is
    // retransmitted, which costs about one round trip and holds up everything queued behind it
    // (head-of-line blocking). So real-world loss shows up as a latency SPIKE, and that is what
    // `spike` models. `loss` is a different and rarer failure -- the client never sent at all, from a
    // script error or a throttled tab -- which exercises the server's `need` resend path instead.
    this.spike = opts.spike || 0;
    this.spikes = 0;
    this.offset = null;        // server clock minus ours, from the pongs
    this.lost = 0;
    this.rtt = 0; this.jitE = 0;
    this.tick = 0; this.delay = 3; this.sentUpTo = -1;
    this.logs = [];            // per slot: how far that player's input has arrived
    this.mine = [];            // my own masks, kept so a `need` can be answered
    this.cpuFrom = [];
    this.me = null; this.n = 0;
    this.running = false; this.done = null;
    this.room = null; this.welcome = null;
    this.stalls = 0; this.stallMs = 0; this.stalledSince = 0;
    this.sent = 0; this.recv = 0; this.needs = 0;
    this.waiters = []; this.inbox = [];
    this.r = (opts.seed || 1) >>> 0 || 1;
  }

  rand() { this.r = (Math.imul(this.r, 1664525) + 1013904223) >>> 0; return this.r / 4294967296; }

  connect() {
    return new Promise((res, rej) => {
      // THE SERVER TIMES THE LINK WITH PROTOCOL-LEVEL PING/PONG, not with our JSON pings, because a
      // browser answers those in its network stack without waiting for page JavaScript (server.js
      // tripMs). `ws` auto-answers them instantly, so an injected delay was invisible to the server:
      // it saw a 1 ms link, handed out 4 frames of lead where 9 were needed, and the fight stalled
      // 94% of the time. Answer the ping ourselves, on the same delayed queue as everything else.
      this.ws = new WebSocket(this.url, { perMessageDeflate: false, autoPong: !(this.lat || this.jit || this.spike) });
      // The ping ARRIVES instantly here, because an inbound protocol frame does not come through
      // `on('message')` and so is not on the delayed queue. Only the pong leaving is. So the pong has
      // to carry the WHOLE round trip, not half of it -- delaying it by one leg made the server
      // measure 118 ms on a 237 ms link and hand out 6 frames of lead where 9 were needed.
      this.ws.on('ping', d => {
        if (!this.lat && !this.jit && !this.spike) return;          // autoPong is handling it
        const q = this.qpong || (this.qpong = {});
        const at = Math.max(q.last || 0, Date.now() + 2 * this.lat + this.rand() * 2 * this.jit); q.last = at;
        (q.items = q.items || []).push({ at, msg: d });
        const pump = () => {
          q.timer = null;
          while (q.items.length && q.items[0].at <= Date.now()) { const it = q.items.shift(); try { this.ws.pong(it.msg); } catch (e) { /* closed */ } }
          if (q.items.length) q.timer = setTimeout(pump, Math.max(0, q.items[0].at - Date.now()));
        };
        if (!q.timer) q.timer = setTimeout(pump, Math.max(0, q.items[0].at - Date.now()));
      });
      this.ws.on('open', () => {
        // `test: true` only STICKS if the server believes us. On loopback it does; through Caddy it
        // does not, unless we present the shared TEST_KEY (server.js mayMarkTest). Without it every
        // bot run against a real region leaves PERMANENT accounts on the live leaderboard -- 220 of
        // them had piled up on Singapore -- instead of being hidden and pruned within the hour.
        this.raw({ k: 'hello', v: 1, token: this.token, name: this.name, build: this.build, test: true,
          testKey: process.env.TEST_KEY || undefined });
        this.pinger = setInterval(() => this.raw({ k: 'ping', t: Date.now(), rtt: this.rtt || 0, jit: this.jitE || 0 }), 1000);
        res();
      });
      this.ws.on('error', e => { this.err = e.message; rej(e); });
      this.ws.on('message', d => { this.recv++; this.link(this.qin || (this.qin = {}), JSON.parse(d), m => this.onMsg(m)); });
      this.ws.on('close', () => { this.closed = true; this.running = false; });
    });
  }

  // Strict FIFO, because TCP does not reorder a WebSocket stream however bad the line is: a delayed
  // frame holds up the ones behind it instead of overtaking them.
  link(q, msg, fn) {
    if (!this.lat && !this.jit && !this.spike) return fn(msg);
    // a retransmission: this frame and everything behind it wait out one more round trip
    const hit = this.spike && this.rand() < this.spike;
    if (hit) this.spikes++;
    const at = Math.max(q.last || 0, Date.now() + this.lat + this.rand() * this.jit + (hit ? 2 * this.lat : 0)); q.last = at;
    (q.items = q.items || []).push({ at, msg });
    const pump = () => {
      q.timer = null;
      while (q.items.length && q.items[0].at <= Date.now()) fn(q.items.shift().msg);
      if (q.items.length) q.timer = setTimeout(pump, Math.max(0, q.items[0].at - Date.now()));
    };
    if (!q.timer) q.timer = setTimeout(pump, Math.max(0, q.items[0].at - Date.now()));
  }

  raw(m) {
    if (!this.ws || this.ws.readyState !== 1) return false;
    // A lost input frame is the interesting case: the server notices the hole and asks for it again
    // (`need`), and onNeed has to answer or the match wedges. Pings are never dropped, so the
    // measured round trip stays a measurement of the link rather than of the loss.
    if (this.loss && m && m.k === 'i' && this.rand() < this.loss) { this.lost++; this.sent++; return true; }
    if (!this.lat && !this.jit && !this.spike) { this.ws.send(JSON.stringify(m)); this.sent++; return true; }
    this.sent++;
    this.link(this.qout || (this.qout = {}), m, x => { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(x)); });
    return true;
  }

  onMsg(m) {
    switch (m.k) {
      case 'welcome': this.welcome = m; break;
      case 'room': this.room = m; break;
      case 'start': case 'resume': this.begin(m); break;
      case 'i': {                                  // another player's inputs, starting at tick m.t
        const have = this.logs[m.p] || 0;
        if (m.t <= have) this.logs[m.p] = Math.max(have, m.t + m.m.length);
        break;
      }
      case 'drop': this.cpuFrom[m.slot] = Math.min(this.cpuFrom[m.slot] ?? Infinity, m.t); break;
      case 'net': if (Array.isArray(m.delay) && m.delay[this.me] != null) this.delay = Math.max(2, Math.min(MAX_DELAY, m.delay[this.me])); break;
      case 'need': this.needs++; this.onNeed(m.t); break;
      case 'pong': {
        const v = Date.now() - m.t;
        this.jitE = this.rtt ? this.jitE * 0.8 + Math.abs(v - this.rtt) * 0.2 : 0;
        this.rtt = this.rtt ? this.rtt * 0.7 + v * 0.3 : v;
        // CLOCK OFFSET, the way the page does it (src/77_net.js). The server stamps the pong with
        // its own clock, so server time is that stamp plus the time the pong spent coming back.
        // Without this a client converts the server's `startAt` using its own unadjusted clock and
        // begins the fight one one-way trip late -- which on a 250 ms link means it needs 1.5x the
        // round trip of lead instead of 0.5x, and stalls constantly. The page gets this right; the
        // test clients did not, so they reported stalls the real game does not have.
        if (m.s) { const off = m.s - (Date.now() - v / 2); this.offset = this.offset == null ? off : this.offset * 0.8 + off * 0.2; }
        break;
      }
      case 'result': this.done = m; this.running = false; break;
    }
    if (m.k !== 'i' && m.k !== 'pong' && m.k !== 'net') {
      this.inbox.push(m);
      for (const w of this.waiters.slice()) if (w.f(m)) { this.waiters.splice(this.waiters.indexOf(w), 1); w.res(m); }
    }
  }

  begin(m) {
    this.me = m.you; this.n = m.cfg.players.length;
    this.delay = Math.max(2, Math.min(MAX_DELAY, m.delay || 3));
    this.tick = 0; this.sentUpTo = -1; this.mine = [];
    this.logs = m.cfg.players.map(() => 0);
    this.cpuFrom = m.cfg.players.map(p => (p.cpu ? 0 : Infinity));
    const off = this.offset != null ? this.offset : ((m.now || 0) - Date.now());
    this.startAt = Date.now() + Math.max(0, Math.min(8000, (m.startAt || 0) - (Date.now() + off)));
    this.running = true; this.done = null;
    this.hold = 0; this.intent = 0;
  }

  // every other human's input for this tick is in, so the fight can advance
  canStep() {
    for (let i = 0; i < this.n; i++) {
      if (i === this.me) continue;
      if (this.tick >= (this.cpuFrom[i] ?? Infinity)) continue;
      if ((this.logs[i] || 0) <= this.tick) return false;
    }
    return true;
  }

  // Buttons held for a short run at a time, which is what a person's hand does and what keeps the
  // fight moving toward a knockout instead of two fighters standing still until the time cap.
  mask() {
    if (--this.hold <= 0) { this.hold = 4 + Math.floor(this.rand() * 18); this.intent = (Math.floor(this.rand() * 512)) & 0x1ff; }
    return this.intent;
  }

  // called from the shared timer, which wakes faster than 60 Hz so the pacing below is what sets
  // the fight's speed
  pump(now) {
    if (!this.running || now < this.startAt) return;
    let steps = 0;
    while (steps < 4) {                      // catch up at most 4 ticks per wake, like the page does
      // IS THE NEXT TICK DUE YET. This test used to advance a tick on every wake and only afterwards
      // ask whether the clock had reached it, so on an 8 ms timer it ran the fight at 125 ticks a
      // second instead of 60. The server's input delay is a number of FRAMES, so running at double
      // speed halved the real lead it buys, and every bot on a long link then reported constant
      // stalling -- 24% of a fight on a 250 ms link -- that a real page at 60 Hz does not have.
      // Checking first is also what makes `stalls` mean something: a tick that is DUE and cannot run.
      if (now - this.startAt < (this.tick + 1) * (1000 / 60)) break;
      if (!this.canStep()) {
        if (!this.stalledSince) { this.stalledSince = now; this.stalls++; }
        break;
      }
      if (this.stalledSince) { this.stallMs += now - this.stalledSince; this.stalledSince = 0; }
      this.tick++; steps++;
    }
    const want = this.tick + this.delay;
    if (this.sentUpTo >= want) return;
    const t0 = this.sentUpTo + 1, out = [];
    while (this.sentUpTo < want) { this.sentUpTo++; out.push(this.mask()); }
    for (const m of out) this.mine.push(m);
    if (this.raw({ k: 'i', t: t0, m: out }) === false) this.sentUpTo = t0 - 1;
  }

  onNeed(t) {
    if (!Number.isInteger(t) || t < 0) return;
    this.sentUpTo = Math.min(this.sentUpTo, Math.max(-1, t - 1));
    while (this.sentUpTo < this.mine.length - 1) {
      const t0 = this.sentUpTo + 1, out = this.mine.slice(t0, Math.min(this.mine.length, t0 + 48));
      if (this.raw({ k: 'i', t: t0, m: out }) === false) return;
      this.sentUpTo = t0 + out.length - 1;
    }
  }

  until(f, ms = 20000, what = '') {
    const hit = this.inbox.find(f);
    if (hit) { this.inbox.splice(this.inbox.indexOf(hit), 1); return Promise.resolve(hit); }
    return new Promise((res, rej) => {
      const w = { f, res: v => { clearTimeout(t); this.inbox.splice(this.inbox.indexOf(v), 1); res(v); } };
      const t = setTimeout(() => { this.waiters.splice(this.waiters.indexOf(w), 1); rej(new Error(this.name + ' timed out waiting for ' + what)); }, ms);
      this.waiters.push(w);
    });
  }

  state() { return { stalls: this.stalls, stallMs: Math.round(this.stallMs), tick: this.tick, sent: this.sent, recv: this.recv, needs: this.needs, lost: this.lost, spikes: this.spikes, rtt: Math.round(this.rtt), jit: Math.round(this.jitE) }; }
  close() { clearInterval(this.pinger); this.running = false; try { this.ws.close(); } catch (e) { /* gone */ } }
}

// One timer for every client in the process: 300 bots is 300 pumps per wake, not 300 timers.
function driveAll(bots) {
  return setInterval(() => { const now = Date.now(); for (const b of bots) b.pump(now); }, 8);
}

module.exports = { LightBot, driveAll };
