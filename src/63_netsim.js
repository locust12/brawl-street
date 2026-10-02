// ===== online play: the lockstep fight driver shared by the page and the game server =====
// Online matches are delay-based lockstep. Every player's page and the server run this same seeded
// simulation, and only inputs travel over the network (one 9-bit mask per player per tick). The
// server (net/) loads this file next to the fight files and steps every match itself, so it knows
// the winner without trusting any client. Pure simulation: no DOM, and no rand() outside Game.step().
const NetSim = {
  VERSION: 1,
  LIMIT: 60 * 60 * 7,   // fight clock cap (7 minutes, like Smash online); then most stocks / least damage wins
  CHECK: 60,            // players and server compare a state hash every 60 ticks
  done: null, elim: [], onEnd: null,

  encode(o) { let m = 0; for (let i = 0; i < ACTIONS.length; i++) if (o[ACTIONS[i]]) m |= 1 << i; return m; },

  // The rule flags Game.start gates on `seed` (item set, signature moves, reach, duck, combos, feel, and
  // whatever gets added next). Online has to play the same game as local practice, and every peer has to
  // agree, so the server captures these once per build and ships them inside the match config. Nothing is
  // re-derived per device: `feel` alone is read from localStorage in Game.start, which would desync a match.
  localRules() {
    const slots = [{ ctrl: 'cpu', char: CHARS[0].id, level: 1 }, { ctrl: 'cpu', char: CHARS[0].id, level: 1 }];
    const stage = (typeof ARENA !== 'undefined' ? ARENA.stages[0] : 'moon');
    const snap = () => { const o = {}; for (const k of Object.keys(Game)) { const v = Game[k]; if (typeof v === 'number' || typeof v === 'boolean') o[k] = v; } return o; };
    Game.start(slots, stage, 2, true, true);                                      // unseeded: what local play uses
    const local = snap();
    Game.start(slots, stage, 2, true, true, '0x' + '11'.repeat(32));              // seeded: the old online/arena defaults
    const seeded = snap();
    const rules = {};
    for (const k of Object.keys(local)) if (local[k] !== seeded[k]) rules[k] = local[k];
    Game.arena = null; Game.state = 'title';
    return rules;
  },

  // cfg: { seed, stage, stocks, items, limit?, pot?, rules?, players: [{ char, cpu?, level? }] } (2 to 4 players).
  // looks: optional per-slot custom-fighter blobs (86_custom.js reads slot.customLook). Cosmetic only:
  // not part of cfg, the replay or the fingerprint; the server never passes them.
  start(cfg, looks) {
    const slots = cfg.players.map((p, i) => p.cpu ? { ctrl: 'cpu', char: p.char, level: p.level || 7 } : { ctrl: 'net' + i, char: p.char });
    if (looks) slots.forEach((s, i) => { if (looks[i] && typeof looks[i] === 'object') s.customLook = looks[i]; });
    NetInput.cur = [0, 0, 0, 0];
    Game.state = 'match'; Game.pot = cfg.pot || 0; Game.demoNoItems = false;
    Game.start(slots, cfg.stage, cfg.stocks, false, cfg.items, cfg.seed);
    // one ruleset for everyone in the match, straight from the config (see localRules)
    const rules = cfg.rules && typeof cfg.rules === 'object' ? cfg.rules : { combos: cfg.combos !== false };
    for (const k of Object.keys(rules)) { const v = rules[k]; if (typeof v === 'number' || typeof v === 'boolean') Game[k] = v; }
    Game.feel = !!rules.feel;   // never from this device's localStorage: that would desync the match
    Game.feel = cfg.feel === true;        // off by default (9/20 playtest); every peer and the server agree either way       // v2 feel rules (25_feel.js): buffer, parry, tech, DI, burst — same on every peer and the server
    Game.itemSet = cfg.itemSet || 2;
    Game.sigs = cfg.sigs !== false;       // signature specials + taunts online too (same on every peer and the server)      // the new weapons and items online too (seeded, so every peer spawns the same ones)
    Game.timeLimit = cfg.limit || this.LIMIT;
    // Bought weapons online. `cfg.arsenal` and `cfg.loadouts` come from the SERVER (net/lib/economy.js
    // arsenalFor), never from this page, and are false/null for every wagered or ranked match — that
    // is the fairness rule, and it is why this reads cfg and nothing else. Because they ride in cfg,
    // every peer and the server build the identical fight and the loadouts are in the replay.
    // Online has no live "deploy" button (the 9-bit input mask has no room for one), so each player's
    // equipped weapons drop beside them on a fixed clock: deterministic, and visible to both.
    Game.arsenalOn = !!cfg.arsenal;
    Game.loadouts = cfg.arsenal && Array.isArray(cfg.loadouts) ? cfg.loadouts : null;
    this.done = null; this.elim = slots.map(() => 0);
    Game.arena = { onEnd: w => { this.done = w; if (this.onEnd) this.onEnd(w); } };
  },

  // one tick with every player's input mask (CPU and dropped slots ignore theirs)
  step(masks) {
    for (let i = 0; i < 4; i++) NetInput.cur[i] = masks[i] | 0;
    Game.step();
    const F = Game.fighters;
    for (let i = 0; i < F.length; i++) if (!this.elim[i] && F[i].stocks <= 0) this.elim[i] = Game.tick;
  },

  // a player who dropped out of a free-for-all hands their fighter to the CPU (same tick everywhere)
  toCpu(i, level) {
    const f = Game.fighters[i]; if (!f) return;
    f.cpu = true; f.ctrl = 'cpu'; f.level = level || 7; f.ai = {};
  },

  // finishing order, best first: the winner, then whoever was knocked out last
  placements() {
    const F = Game.fighters, w = Game.winner, e = this.elim;
    return F.map(f => f.idx).sort((a, b) => {
      const fa = F[a], fb = F[b];
      if (w && fa === w) return -1;
      if (w && fb === w) return 1;
      return ((e[b] || Infinity) - (e[a] || Infinity)) || (fb.stocks - fa.stocks) || (fa.dmg - fb.dmg) || (fb.stats.dealt - fa.stats.dealt) || (a - b);
    });
  },

  // hash of everything that decides the fight (for desync checks)
  hash() {
    let h = 2166136261;
    const mix = s => { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } };
    mix(Game.tick + '|' + Game.frame + '|' + Rng.s.join(',') + '|');
    for (const f of Game.fighters) mix(f.x + ',' + f.y + ',' + f.vx + ',' + f.vy + ',' + f.dmg + ',' + f.stocks + ',' + f.state + ',' + f.st + ',' + f.face + ',' + f.hitlag + ',' + (f.item ? f.item.kind : '') + ';');
    for (const p of Game.projs) mix(p.kind + ',' + p.x + ',' + p.y + ';');
    for (const it of Game.items) mix(it.kind + ',' + it.x + ',' + it.y + ';');
    return (h >>> 0).toString(16);
  },

  // every stage an online room can pick: the arena's six plus the extra stages (64_stages2.js)
  stages() {
    const base = typeof ARENA !== 'undefined' ? ARENA.stages.slice() : ['isle', 'moon', 'chart', 'keep', 'roof', 'dojo'];
    const extra = typeof STAGES_MENU_EXTRA !== 'undefined' ? STAGES_MENU_EXTRA.map(x => x[0]) : [];
    return base.concat(extra.filter(x => !base.includes(x))).map(id => ({ id, name: makeStage(id).name }));
  },

  // two short scripted fights; their end states go into the fingerprint, so behaviour hidden in
  // closures (wrapped functions, captured move data) is covered too. Leaves Game in a dead state:
  // the page restarts its title demo afterwards.
  probe() {
    const ids = CHARS.map(c => c.id), st = this.stages().map(x => x.id);
    const cases = [[ids[0], ids[ids.length - 1], st[1] || st[0]], [ids[ids.length >> 1], ids[1], st[st.length - 1]]];
    let out = '';
    for (const [a, b, stage] of cases) {
      this.start({ seed: '0x5eed' + '0'.repeat(60), stage, stocks: 2, items: true, players: [{ char: a }, { char: b }, { char: a, cpu: true, level: 9 }] });
      const m = [0, 0, 0, 0]; let s = 12345;
      for (let t = 0; t < 700 && !this.done; t++) {
        for (let p = 0; p < 2; p++) { s = (Math.imul(s, 1103515245) + 12345) >>> 0; if ((s >>> 8) % 6 === 0) m[p] = (s >>> 13) & ((1 << ACTIONS.length) - 1); }   // every button, incl. grab/grapple/drop
        this.step(m);
      }
      out += this.hash() + '.';
    }
    Game.arena = null; Game.state = 'title'; this.done = null;
    return out;
  },

  // fingerprint of the fight engine (move data, the source of every fight function, two probe fights).
  // The server only seats players whose page runs the same engine it replays with.
  digest() {
    const seen = new Set();
    // Display text only: never changes a fight, so it must never be part of the version fingerprint.
    // 9/22: the roster swap (2f_origins.js, page-only) rewrites a renamed fighter's taunt and its
    // moves' shout / sigText. Those were hashed, so every swapped fighter moved the PAGE's digest
    // while the server (which never loads the swap) kept the old one — "Your game is out of date"
    // for everybody, on a build that was otherwise identical.
    const TEXT = /^(shout|sigText)$/;
    const ser = (v, d) => {
      if (typeof v === 'function') return 'F' + v.toString();
      if (v === null || typeof v !== 'object') return typeof v === 'string' ? JSON.stringify(v) : String(v);
      if (seen.has(v) || d > 14) return '~';
      seen.add(v);
      const out = Array.isArray(v) ? '[' + v.map(x => ser(x, d + 1)).join(',') + ']'
        : '{' + Object.keys(v).filter(k => !TEXT.test(k)).sort().map(k => k + ':' + ser(v[k], d + 1)).join(',') + '}';
      seen.delete(v);
      return out;
    };
    const parts = [];
    for (const c of CHARS) {
      const o = {};
      for (const k of Object.keys(c)) if (!/^(name|title|blurb|look|taunt)$/.test(k) && !(c[k] && (c[k].isObject3D || c[k].nodeType))) o[k] = c[k];
      parts.push(ser(o, 0));
    }
    const src = o => Object.keys(o).sort().map(k => k + '=' + o[k].toString()).join('\n');
    const F = NETSIM_FNS;
    parts.push(F.fighter.toString(), src(F.fp), src(F.game), src(F.ai), src(F.items), src(F.rng), src(F.self));
    parts.push(ser([ITEM_DEFS, HAMMER_DEF, NORMALS, KB_SCALE, GROUNDISH, ACTIONS], 0));
    for (const f of F.free) parts.push(f.toString());
    parts.push(this.probe());
    const s = parts.join('\n#\n');
    let a = 2166136261, b = 0x811c9dc5 ^ 0x5bd1e995;
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 16777619) >>> 0; b = Math.imul(b ^ c, 0x01000193) ^ (b >>> 13); }
    return 'v' + this.VERSION + '-' + a.toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
  },
};

// The fight functions as they are once the fight files have loaded, before any page-side listener
// (12_audio.js wraps Game/Fighter methods to trigger sounds) replaces them with wrappers. The
// fingerprint hashes these, so the page and the server (same file order) hash the same source.
const NETSIM_FNS = (() => {
  const grab = obj => { const o = {}; for (const k of Object.getOwnPropertyNames(obj)) { const d = Object.getOwnPropertyDescriptor(obj, k); if (d && typeof d.value === 'function' && k !== 'onEnd') o[k] = d.value; } return o; };
  return { fighter: Fighter, fp: grab(Fighter.prototype), game: grab(Game), ai: grab(AI), items: grab(Items), rng: grab(Rng), self: grab(NetSim),
    free: [makeStage, circleRect, swordify, readInput, dsin, dcos, dhypot, rand, irand, clamp, lerp, approach, baseMoves, mkProj, mkDash, mkRise, mkSlam] };
})();

// Input delay range, in frames. Far-away players (say both in Asia on a European server, ~200 ms
// between them through the relay) need ~14 frames to run at full speed; less than that plays in slow motion.
// Client side of the lockstep: the page (77_net.js) and the node test clients (net/test) drive one of
// these with the server's start/resume message. Local input for tick T is sent tagged T + delay; a tick
// is simulated only once every player's input for it is here, so every copy of the fight stays identical.
class NetLockstep {
  constructor(msg, send) {
    this.send = send; this.me = msg.you; this.cfg = msg.cfg; this.n = msg.cfg.players.length;
    this.base = msg.delay || 3; this.bump = 0; this.delay = this.base; this.delays = []; this.pings = [];
    this.stallLog = []; this.calmSince = 0;
    this.check = msg.check || NetSim.CHECK;
    this.logs = this.cfg.players.map(() => []);
    this.cpuFrom = this.cfg.players.map(p => (p.cpu ? 0 : Infinity));
    this.events = []; this.evIdx = 0;
    this.sentUpTo = -1; this.carry = 0; this.masks = [0, 0, 0, 0];
    this.acc = 0; this.last = 0; this.stallMs = 0; this.stalls = 0; this.stalledFor = 0; this.steps = 0;
    this.out = null; this.dropped = false;
    NetSim.start(this.cfg, msg.looks);
    if (msg.log) this.resume(msg);
  }
  // a relayed batch of another player's inputs, starting at tick t
  onInput(p, t, arr) {
    const L = this.logs[p]; if (!L || t > L.length) return;
    for (let k = L.length - t; k < arr.length; k++) L.push(arr[k]);
  }
  // a player dropped out of a free-for-all: their fighter is CPU-driven from tick t
  onDrop(slot, t, level) {
    this.cpuFrom[slot] = Math.min(this.cpuFrom[slot], t);
    let k = this.events.length; while (k > this.evIdx && this.events[k - 1].t > t) k--;
    this.events.splice(k, 0, { t, type: 'cpu', slot, level });
  }
  isNet(i, t) { return t < this.cpuFrom[i]; }
  // the server suggests a delay from measured round trips; repeated stalls add up to 4 frames on top
  setBase(d) { this.base = d || this.base; this.delay = Math.max(2, Math.min(NetLockstep.MAX_DELAY, this.base + this.bump)); }
  canStep() {
    const t = Game.tick;
    for (let i = 0; i < this.n; i++) if (this.isNet(i, t) && this.logs[i].length <= t) return false;
    return true;
  }
  missing() { const t = Game.tick, out = []; for (let i = 0; i < this.n; i++) if (this.isNet(i, t) && this.logs[i].length <= t) out.push(i); return out; }
  // send my input up to tick + delay (the first tick of a batch also carries anything skipped while the delay shrank).
  // The log is the truth: if the socket was not open, sentUpTo rolls back so the same ticks go again later.
  // A lost batch used to leave a hole the server ignored for ever, and both players then waited until the
  // match was dropped: now nothing is ever considered sent unless the transport took it.
  pump(mask) {
    const want = Game.tick + this.delay; if (this.sentUpTo >= want) return false;
    const t0 = this.sentUpTo + 1, out = [];
    while (this.sentUpTo < want) { this.sentUpTo++; out.push(out.length ? mask : mask | this.carry); }
    this.carry = 0;
    const L = this.logs[this.me]; for (const m of out) L.push(m);
    if (this.send({ k: 'i', t: t0, m: out }) === false) this.sentUpTo = t0 - 1;
    return true;
  }
  // the server is missing my input from tick t on (a dropped batch, a socket blip): send it again
  onNeed(t) {
    if (!Number.isInteger(t) || t < 0) return;
    this.sentUpTo = Math.min(this.sentUpTo, Math.max(-1, t - 1));
    this.resend();
  }
  resend() {
    const L = this.logs[this.me];
    while (this.sentUpTo < L.length - 1) {
      const t0 = this.sentUpTo + 1, out = L.slice(t0, Math.min(L.length, t0 + 48));
      if (this.send({ k: 'i', t: t0, m: out }) === false) return false;
      this.sentUpTo = t0 + out.length - 1;
    }
    return true;
  }
  stepOnce(quiet) {
    const t = Game.tick;
    while (this.evIdx < this.events.length && this.events[this.evIdx].t <= t) {
      const e = this.events[this.evIdx++];
      if (e.type === 'cpu') NetSim.toCpu(e.slot, e.level);
    }
    for (let i = 0; i < this.n; i++) this.masks[i] = this.isNet(i, t) ? this.logs[i][t] : 0;
    NetSim.step(this.masks); this.steps++;
    if (!quiet && Game.tick % this.check === 0) this.send({ k: 'h', t: Game.tick, h: NetSim.hash() });
  }
  // how many frames I am ahead of the furthest-behind remote player (estimate from their input stream)
  advantage() {
    let adv = -99; const F = 1000 / 60;
    for (let j = 0; j < this.n; j++) {
      if (j === this.me || !this.isNet(j, Game.tick)) continue;
      const sent = this.logs[j].length - 1 - (this.delays[j] || this.delay);
      const lat = ((this.pings[this.me] || 0) + (this.pings[j] || 0)) / 2 / F;
      adv = Math.max(adv, Game.tick - (sent + lat));
    }
    return adv;
  }
  // advance by wall-clock time; sample() returns my input mask for this tick
  run(now, sample) {
    if (!this.last) this.last = now;
    const dt = Math.min(250, Math.max(0, now - this.last)); this.last = now;
    if (NetSim.done || this.dropped) return 0;
    const adv = this.advantage(), F = (1000 / 60) * (adv > 2.5 ? 1.03 : adv < -2.5 ? 0.97 : 1);
    this.acc += dt;
    let steps = 0, stalled = false;
    while (this.acc >= F && steps < 12) {
      const m = sample();
      const sent = this.pump(m);
      if (!this.canStep()) { stalled = true; break; }
      if (!sent && this.sentUpTo >= Game.tick + this.delay) this.carry |= m;
      this.stepOnce(false); this.acc -= F; steps++;
      if (NetSim.done) break;
    }
    if (stalled) {
      if (steps) this.stalledFor = 0;   // progress in this call: a fresh wait starts now
      const before = this.stalledFor;
      this.stalledFor += dt; this.stallMs += dt; this.acc = Math.min(this.acc, F);
      // a wait longer than a frame is a stall; three in three seconds add a frame of delay
      if (before < F && this.stalledFor >= F) {
        this.stalls++; this.stallLog.push(now); this.calmSince = now;
        while (this.stallLog.length && now - this.stallLog[0] > 3000) this.stallLog.shift();
        if (this.stallLog.length >= 3 && this.bump < 4) { this.bump++; this.stallLog = []; this.setBase(); }
      }
    } else if (steps) {
      this.stalledFor = 0;
      if (!this.calmSince) this.calmSince = now;
      if (this.bump > 0 && now - this.calmSince > 15000) { this.bump--; this.calmSince = now; this.setBase(); }
    }
    return steps;
  }
  // rejoin a running match: rebuild from the server's full input log, then fast-forward
  resume(msg) {
    this.logs = msg.log.map(a => a.slice());
    for (const e of msg.events || []) this.onDrop(e.slot, e.t, e.level);
    this.sentUpTo = this.logs[this.me].length - 1;
    while (this.canStep() && !NetSim.done) this.stepOnce(true);
  }
}
NetLockstep.MAX_DELAY = 15;
