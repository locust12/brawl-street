// A simulated online player: WebSocket client + its own copy of the fight engine + the page's
// NetLockstep, with optional artificial latency. Used by sim_clients.js (one per worker thread) and
// escrow_e2e.js (in-process).
const crypto = require('crypto');
const WebSocket = require('ws');
const engine = require('../lib/engine');
const info = engine.load();
const SPEED = +(process.env.BOT_SPEED || 1);

function lcg(seed) { let s = seed >>> 0 || 1; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; }

class Bot {
  constructor(name, url, opts = {}) {
    this.name = name; this.url = url; this.lat = opts.lat ?? 0; this.jit = opts.jit ?? 0;
    this.token = opts.token || crypto.randomBytes(32).toString('hex');
    this.sim = engine.create(); this.r = lcg(crypto.randomInt(1 << 30));
    this.inbox = []; this.waiters = []; this.rtt = 0; this.jitE = 0; this.offset = null; this.room = null; this.lock = null; this.results = []; this.desyncs = [];
    this.outQ = Promise.resolve(); this.inT = 0; this.outT = 0; this.hold = 0; this.intent = {};
  }
  connect() {
    return new Promise((res, rej) => {
      // same reason as light_bot: the server times the link with protocol ping/pong, so an injected
      // delay has to apply to the pong as well or the server never sees the latency at all
      this.ws = new WebSocket(this.url, { autoPong: !(this.lat || this.jit) });
      this.ws.on('ping', d => {
        if (!this.lat && !this.jit) return;
        this.queue(this.qpong || (this.qpong = {}), d, data => { try { this.ws.pong(data); } catch (e) { /* closed */ } });
      });
      this.ws.on('open', () => {
        // `test: true` only STICKS if the server believes us. On loopback it does; through Caddy it
        // does not, unless we present the shared TEST_KEY (server.js mayMarkTest). Without it every
        // bot run against a real region leaves PERMANENT accounts on the live leaderboard -- 220 of
        // them had piled up on Singapore -- instead of being hidden and pruned within the hour.
        this.raw({ k: 'hello', v: 1, token: this.token, name: this.name, build: info.digest, test: true,
          testKey: process.env.TEST_KEY || undefined }); res();
        this.pinger = setInterval(() => this.send({ k: 'ping', t: performance.now(), rtt: this.rtt || 0, jit: this.jitE || 0 }), 1000);
      });
      this.ws.on('error', rej);
      this.ws.on('message', d => this.delayIn(JSON.parse(d.toString())));
      this.ws.on('close', () => { this.closed = true; });
    });
  }
  // artificial latency + jitter as strict FIFO queues (TCP never reorders a WebSocket stream)
  queue(q, msg, fn) {
    const at = Math.max(q.last || 0, Date.now() + this.lat + Math.random() * this.jit); q.last = at;
    (q.items = q.items || []).push({ at, msg });
    const pump = () => {
      q.timer = null;
      while (q.items.length && q.items[0].at <= Date.now()) fn(q.items.shift().msg);
      if (q.items.length) q.timer = setTimeout(pump, Math.max(0, q.items[0].at - Date.now()));
    };
    if (!q.timer) q.timer = setTimeout(pump, Math.max(0, q.items[0].at - Date.now()));
  }
  delayIn(msg) { if (!this.lat && !this.jit) return this.onMsg(msg); this.queue(this.qin || (this.qin = {}), msg, m => this.onMsg(m)); }
  raw(msg) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg)); return true; }
  send(msg) {
    // drop N input batches on the floor while pretending they went out: the exact failure that used to
    // wedge a match for ever (the server ignored everything after the hole)
    if (this.dropNext > 0 && msg && msg.k === 'i') { this.dropNext--; this.dropped = (this.dropped || 0) + 1; return true; }
    if (!this.lat && !this.jit) return this.raw(msg);
    this.queue(this.qout || (this.qout = {}), msg, m => this.raw(m));
    return true;
  }
  onMsg(m) {
    if (m.k === 'room') this.room = m;
    if (m.k === 'welcome') this.me = m;
    if (m.k === 'start' || m.k === 'resume') this.begin(m);
    if (m.k === 'i' && this.lock) this.lock.onInput(m.p, m.t, m.m);
    if (m.k === 'drop' && this.lock) { if (m.slot === this.lock.me) this.lock.dropped = true; else this.lock.onDrop(m.slot, m.t, m.level); }
    if (m.k === 'net' && this.lock) { this.lock.setBase(m.delay[this.lock.me]); this.lock.delays = m.delay; this.lock.pings = m.ping; }
    if (m.k === 'need' && this.lock) { this.needs = (this.needs || 0) + 1; this.lock.onNeed(m.t); }
    // `this.jit` is the jitter this bot INJECTS (--jit) and `this.jitE` is what it MEASURES. This
    // line used to assign the measurement to both, so one second after connecting the injected
    // jitter was overwritten by the observed one and every --jit run quietly became a --jit 0 run.
    if (m.k === 'pong') {
      const v = performance.now() - m.t;
      this.jitE = this.rtt ? this.jitE * 0.8 + Math.abs(v - this.rtt) * 0.2 : 0;
      this.rtt = this.rtt ? this.rtt * 0.7 + v * 0.3 : v;
      // server clock minus ours, corrected for the trip the pong made back (src/77_net.js does the
      // same). begin() needs it to start the fight when the SERVER meant it to start, not one
      // one-way delay later.
      if (m.s) { const off = m.s - (Date.now() - v / 2); this.offset = this.offset == null ? off : this.offset * 0.8 + off * 0.2; }
    }
    if (m.k === 'desync') this.desyncs.push(m);
    if (m.k === 'result') { this.results.push(m); if (!this.lock || this.lock.dropped || this.sim.NetSim.done) this.stop(); else this.stopAtEnd = true; }
    if (m.k !== 'i' && m.k !== 'pong' && m.k !== 'net') this.emit(m);
  }
  // in-process: keep messages for until(); a worker overrides this to forward them to the main thread
  emit(m) {
    this.inbox.push(m);
    for (const w of this.waiters.slice()) if (w.f(m)) { this.waiters.splice(this.waiters.indexOf(w), 1); w.res(m); }
  }
  state() {
    const L = this.lock;
    return { me: L ? L.me : null, dropped: L ? L.dropped : false, needs: this.needs || 0, lostBatches: this.dropped || 0, stalls: L ? L.stalls : 0, stallMs: L ? Math.round(L.stallMs) : 0, localEnd: this.localEnd || null, bal: this.me ? this.me.bal : null };
  }
  until(f, ms = 20000, what = '') {
    const hit = this.inbox.find(f); if (hit) { this.inbox.splice(this.inbox.indexOf(hit), 1); return Promise.resolve(hit); }
    return new Promise((res, rej) => {
      const w = { f, res: v => { clearTimeout(t); this.inbox.splice(this.inbox.indexOf(v), 1); res(v); } };
      const t = setTimeout(() => { this.waiters.splice(this.waiters.indexOf(w), 1); rej(new Error(this.name + ' timed out waiting for ' + what)); }, ms);
      this.waiters.push(w);
    });
  }
  begin(m) {
    this.stop();
    this.startMsg = m;
    this.lock = new this.sim.NetLockstep(m, msg => this.send(msg));
    this.localEnd = null;
    const off = this.offset != null ? this.offset : (m.now - Date.now());
    const t0 = performance.now(), wait = m.k === 'resume' ? 0 : Math.max(0, Math.min(8000, m.startAt - (Date.now() + off)));
    this.loop = setInterval(() => {
      const now = performance.now() - t0 - wait;
      if (now < 0) return;
      this.lock.run(now * SPEED, () => this.policy());
      if (this.sim.NetSim.done && !this.localEnd) { this.localEnd = { winner: this.sim.NetSim.done.idx, tick: this.sim.Game.tick, hash: this.sim.NetSim.hash(), placements: this.sim.NetSim.placements() }; this.onState(); if (this.stopAtEnd) this.stop(); }
      if (process.env.DEBUG_LOCK && now - (this.dbgT || 0) > 2000) {
        this.dbgT = now; const L = this.lock, G = this.sim.Game;
        console.log(this.name, 't', G.tick, 'delay', L.delay, 'base', L.base, 'bump', L.bump, 'lead', L.logs.map(a => a.length - G.tick).join(','), 'adv', L.advantage().toFixed(1), 'stalls', L.stalls, Math.round(L.stallMs) + 'ms', 'rtt', Math.round(this.rtt), 'jit', Math.round(this.jitE), 'pings', (L.pings || []).join(','));
      }
    }, 8);
  }
  stop() { if (this.loop) clearInterval(this.loop); this.loop = null; }
  // a scrappy player: chase the nearest fighter, swing, jump, recover toward the stage (reads state only)
  policy() {
    const G = this.sim.Game, me = this.lock.me, f = G.fighters[me], r = this.r, o = {};
    if (!f || f.state === 'dead') return 0;
    const M = G.stage.main;
    if (f.x < M.x0 - 10 || f.x > M.x1 + 10 || (f.y > M.top + 30)) {
      o[f.x < 0 ? 'right' : 'left'] = true;
      if (f.vy > 1 && r() < 0.25) o.jump = true;
      if (f.y > M.top + 60 && r() < 0.2) { o.up = true; o.special = true; }
      return this.sim.NetSim.encode(o);
    }
    let tgt = null, bd = 1e9;
    for (const g of G.fighters) if (g !== f && g.stocks > 0 && g.state !== 'dead') { const d = Math.abs(g.x - f.x) + Math.abs(g.y - f.y); if (d < bd) { bd = d; tgt = g; } }
    if (--this.hold <= 0) {
      this.hold = 4 + Math.floor(r() * 18);
      this.intent = {};
      const k = r();
      if (tgt && Math.abs(tgt.x - f.x) > 70) this.intent[tgt.x > f.x ? 'right' : 'left'] = true;
      else if (k < 0.35) { this.intent.attack = true; if (r() < 0.3) this.intent.up = true; else if (r() < 0.3) this.intent.down = true; }
      else if (k < 0.45) this.intent.smash = true;
      else if (k < 0.55) this.intent.special = true;
      else if (k < 0.62) this.intent.shield = true;
      else if (k < 0.72) this.intent.jump = true;
      if (r() < 0.2 && tgt) this.intent[tgt.x > f.x ? 'right' : 'left'] = true;
    }
    Object.assign(o, this.intent);
    // re-press buttons now and then so moves keep coming
    for (const b of ['attack', 'special', 'jump', 'smash']) if (o[b] && r() < 0.35) o[b] = false;
    return this.sim.NetSim.encode(o);
  }
  onState() {}
  close() { this.stop(); clearInterval(this.pinger); try { this.ws.close(); } catch (e) { /* gone */ } }
  kill() { this.stop(); clearInterval(this.pinger); try { this.ws.terminate(); } catch (e) { /* gone */ } }
}


module.exports = { Bot, info, engine };
