// The fight engine on the server: one sandboxed context per match, running the page's exact fight
// code. engine/ can hold several builds (sim-<digest>.js, written by tools/build-engine.js); each is
// keyed by its fingerprint, so pages from an older and a newer build can both play while a new
// version rolls out. New files are picked up without a restart (rescan()).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = process.env.ENGINE_DIR || path.join(__dirname, '..', 'engine');
const EXPORT = '\n;globalThis.__sim = { NetSim, NetLockstep, Game, NetInput, CHARS, Rng, makeStage, ACTIONS };';
const engines = new Map();   // digest -> entry
const seen = new Map();      // file -> mtime already loaded
let latest = null;

function loadFile(file) {
  const code = fs.readFileSync(file, 'utf8');
  const script = new vm.Script(code + EXPORT, { filename: path.basename(file) });
  const create = () => { const ctx = vm.createContext({ console: { log() {}, warn() {}, error() {} } }); script.runInContext(ctx); return ctx.__sim; };
  const s = create();
  const rules = typeof s.NetSim.localRules === 'function' ? s.NetSim.localRules() : { combos: true };
  return { file, script, create, digest: s.NetSim.digest(), chars: s.CHARS.map(c => c.id), stages: s.NetSim.stages(), rules, mtime: fs.statSync(file).mtimeMs };
}

function rescan() {
  let files = [];
  try { files = fs.readdirSync(DIR).filter(f => /^sim(-v\d+-[0-9a-f]+)?\.js$/.test(f)); } catch (e) { return latest; }
  for (const f of files) {
    const full = path.join(DIR, f), mt = fs.statSync(full).mtimeMs;
    if (seen.get(full) === mt) continue;
    seen.set(full, mt);
    try {
      const e = loadFile(full);
      if (!engines.has(e.digest) || engines.get(e.digest).mtime < e.mtime) engines.set(e.digest, e);
      if (!latest || e.mtime >= latest.mtime) latest = e;
    } catch (err) { console.error('engine load failed', f, err.message); }
  }
  return latest;
}

function load() {
  if (process.env.ENGINE_FILE) { const e = loadFile(process.env.ENGINE_FILE); engines.set(e.digest, e); latest = e; }
  else rescan();
  if (!latest) throw new Error('no engine in ' + DIR + ' (run tools/build-engine.js)');
  return { digest: latest.digest, chars: latest.chars, stages: latest.stages };
}

const get = digest => engines.get(digest) || null;
const create = digest => (digest ? get(digest) : latest).create();

// Replays a whole recorded match headless. log[slot][tick] = mask, events = [{ t, type: 'cpu', slot }].
// Returns the finishing order, the winner slot and the checkpoint hashes.
function replay(cfg, log, events, maxTicks, digest) {
  const s = create(digest);
  s.NetSim.start(cfg);
  const hashes = {}, masks = [0, 0, 0, 0], cpuFrom = cfg.players.map(p => (p.cpu ? 0 : Infinity));
  const evAt = new Map(); for (const e of events || []) { if (!evAt.has(e.t)) evAt.set(e.t, []); evAt.get(e.t).push(e); }
  const cap = maxTicks || 60 * 60 * 12;
  while (!s.NetSim.done && s.Game.tick < cap) {
    const t = s.Game.tick;
    for (const e of evAt.get(t) || []) if (e.type === 'cpu') { s.NetSim.toCpu(e.slot, e.level); cpuFrom[e.slot] = t; }
    for (let i = 0; i < cfg.players.length; i++) {
      if (t >= cpuFrom[i]) { masks[i] = 0; continue; }
      const m = log[i] && log[i][t];
      if (m === undefined) return { incomplete: true, tick: t, hashes };
      masks[i] = m;
    }
    s.NetSim.step(masks);
    if (s.Game.tick % s.NetSim.CHECK === 0) hashes[s.Game.tick] = s.NetSim.hash();
  }
  const w = s.NetSim.done;
  return { winner: w ? w.idx : -1, placements: s.NetSim.placements(), ticks: s.Game.tick, frames: s.Game.frame, timeUp: !!s.Game.timeUpT, hashes,
    stats: s.Game.fighters.map(f => ({ stocks: f.stocks, dmg: Math.round(f.dmg), kos: f.stats.kos, falls: f.stats.falls, dealt: Math.round(f.stats.dealt) })) };
}

module.exports = { load, rescan, get, create, replay, versions: () => [...engines.keys()],
  get digest() { return latest && latest.digest; }, get chars() { return latest ? latest.chars : []; }, get stages() { return latest ? latest.stages : []; } };
