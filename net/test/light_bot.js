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
      this.ws = new WebSocket(this.url, { perMessageDeflate: false });
      this.ws.on('open', () => {
        this.raw({ k: 'hello', v: 1, token: this.token, name: this.name, build: this.build, test: true });
        this.pinger = setInterval(() => this.raw({ k: 'ping', t: Date.now(), rtt: this.rtt || 0, jit: this.jitE || 0 }), 1000);
        res();
      });
      this.ws.on('error', e => { this.err = e.message; rej(e); });
      this.ws.on('message', d => { this.recv++; this.onMsg(JSON.parse(d)); });
      this.ws.on('close', () => { this.closed = true; this.running = false; });
    });
  }

  raw(m) { if (this.ws && this.ws.readyState === 1) { this.ws.send(JSON.stringify(m)); this.sent++; return true; } return false; }

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
    this.startAt = Date.now() + Math.max(0, (m.startAt || 0) - (m.now || 0));
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

  // called from the shared 60 Hz timer
  pump(now) {
    if (!this.running || now < this.startAt) return;
    let steps = 0;
    while (steps < 4) {                      // catch up at most 4 ticks per wake, like the page does
      if (!this.canStep()) {
        if (!this.stalledSince) { this.stalledSince = now; this.stalls++; }
        break;
      }
      if (this.stalledSince) { this.stallMs += now - this.stalledSince; this.stalledSince = 0; }
      this.tick++; steps++;
      if (now - this.startAt < this.tick * (1000 / 60)) break;
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

  state() { return { stalls: this.stalls, stallMs: Math.round(this.stallMs), tick: this.tick, sent: this.sent, recv: this.recv, needs: this.needs, rtt: Math.round(this.rtt) }; }
  close() { clearInterval(this.pinger); this.running = false; try { this.ws.close(); } catch (e) { /* gone */ } }
}

// One timer for every client in the process: 300 bots is 300 pumps per wake, not 300 timers.
function driveAll(bots) {
  return setInterval(() => { const now = Date.now(); for (const b of bots) b.pump(now); }, 8);
}

module.exports = { LightBot, driveAll };
