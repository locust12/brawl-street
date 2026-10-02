// Determinism + crash test for the rulesets the GAME plays, not just the bet arena:
// online (the server's captured local ruleset), local v2, and arena v1. Two fresh engine contexts get the
// same attack-heavy inputs; every tick's state hash must match, no step may throw, and none may hang.
//   node net/test/det_rules.js [matches] [ticks]
// Fails loudly with the first divergent tick, the inputs around it and what each fighter was doing.
const engine = require('../lib/engine');
const N = +process.argv[2] || 12, TICKS = +process.argv[3] || 2600;
const info = engine.load();
const E = engine.get(info.digest);
// the engine's own action list, so new buttons (grab, grapple, drop...) are actually pressed
const ACT = E.create().ACTIONS;
const BIT = a => (ACT.indexOf(a) < 0 ? 0 : 1 << ACT.indexOf(a));

const lcg = seed => { let s = seed >>> 0 || 1; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; };
// inputs that hammer every attack: jab, tilts, smashes, specials in all directions, grab, grapple (attack+special)
function script(seed, ticks, players) {
  const r = lcg(seed), out = [];
  const hold = Array.from({ length: players }, () => ({ m: 0, left: 0 }));
  for (let t = 0; t < ticks; t++) {
    const row = [];
    for (let p = 0; p < players; p++) {
      const h = hold[p];
      if (--h.left <= 0) {
        h.left = 2 + Math.floor(r() * 10);
        let m = 0;
        const dir = r();
        if (dir < 0.3) m |= BIT('left');
        else if (dir < 0.6) m |= BIT('right');
        if (r() < 0.25) m |= BIT(r() < 0.5 ? 'up' : 'down');
        const a = r();
        if (a < 0.24) m |= BIT('attack');
        else if (a < 0.36) m |= BIT('smash');
        else if (a < 0.48) m |= BIT('special');
        else if (a < 0.56) m |= BIT('attack') | BIT('special');   // attack+special
        else if (a < 0.64) m |= BIT('shield') | BIT('attack');    // shield grab / item throw
        else if (a < 0.72) m |= BIT('grab');                      // the buttons added on 9/20
        else if (a < 0.80) m |= BIT('grapple');
        else if (a < 0.85) m |= BIT('drop');
        else if (a < 0.92) m |= BIT('jump');
        else if (a < 0.96) m |= BIT('shield');
        h.m = m;
      }
      row.push(h.m);
    }
    out.push(row);
  }
  return out;
}

function run(cfg, inputs, label) {
  const s = E.create();
  const hashes = [], masks = [0, 0, 0, 0], slow = [], times = [];
  let worst = 0, worstTick = -1;
  s.NetSim.start(cfg);
  for (let t = 0; t < inputs.length && !s.NetSim.done; t++) {
    for (let i = 0; i < cfg.players.length; i++) masks[i] = inputs[t][i] || 0;
    const t0 = process.hrtime.bigint();
    try { s.NetSim.step(masks); }
    catch (e) {
      return { crash: { tick: t, label, error: String(e && e.message), stack: String(e && e.stack || '').split('\n').slice(0, 4).join(' | '), inputs: inputs.slice(Math.max(0, t - 2), t + 1),
        fighters: safeStates(s) }, hashes };
    }
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    times.push(ms);
    if (ms > worst) { worst = ms; worstTick = t; }
    if (ms > 5) slow.push({ tick: t, ms: +ms.toFixed(1), label, moves: safeStates(s), items: s.Game.items.map(i => i.kind), projs: s.Game.projs.length, parts: s.Game.parts.length });
    hashes.push(s.NetSim.hash());
  }
  return { hashes, worst: +worst.toFixed(2), worstTick, slow, times, ticks: s.Game.tick, done: !!s.NetSim.done, states: safeStates(s) };
}
function safeStates(s) {
  try { return s.Game.fighters.map(f => ({ char: f.c.id, state: f.state, move: f.move && f.move.def && (f.move.def.shout || f.move.def.clip || 'move') || null, dmg: Math.round(f.dmg), stocks: f.stocks })); }
  catch (e) { return null; }
}

const RULESETS = {
  online: E.rules,                                     // exactly what the server puts in a match config
  localV2: Object.assign({}, E.rules, { feel: false }),
  arenaV1: { itemSet: 1, sigs: false, duck: false, reach: 1, combos: false, feel: false },
};
const stages = E.stages.map(s => s.id);
const chars = E.chars;
let fails = 0, worstStep = 0, crashes = [], slowAll = [], allTimes = [];
const t0 = Date.now();
for (const [name, rules] of Object.entries(RULESETS)) {
  for (let i = 0; i < N; i++) {
    const nP = i % 3 === 0 ? 4 : 2;
    const cfg = {
      seed: '0x' + (i * 2654435761 >>> 0).toString(16).padStart(8, '0').repeat(8),
      stage: stages[(i * 7) % stages.length], stocks: 2, items: true, limit: 60 * 60 * 3, rules,
      players: Array.from({ length: nP }, (_, k) => ({ char: chars[(i * 5 + k * 11) % chars.length] })),
    };
    const inputs = script(i + 1, TICKS, nP);
    const a = run(cfg, inputs, name), b = run(cfg, inputs, name);
    if (a.crash || b.crash) { crashes.push(a.crash || b.crash); fails++; continue; }
    worstStep = Math.max(worstStep, a.worst, b.worst);
    for (const x of a.slow) slowAll.push(x);
    for (const t of a.times) allTimes.push(t);
    let bad = -1;
    for (let t = 0; t < Math.min(a.hashes.length, b.hashes.length); t++) if (a.hashes[t] !== b.hashes[t]) { bad = t; break; }
    if (bad < 0 && a.hashes.length !== b.hashes.length) bad = Math.min(a.hashes.length, b.hashes.length);
    if (bad >= 0) {
      fails++;
      console.log(JSON.stringify({ ruleset: name, match: i, firstDivergentTick: bad, stage: cfg.stage,
        chars: cfg.players.map(p => p.char), inputs: inputs.slice(Math.max(0, bad - 2), bad + 1), a: a.states, b: b.states }, null, 1));
    }
  }
}
for (const c of crashes) console.log('CRASH', JSON.stringify(c, null, 1).slice(0, 1200));
slowAll.sort((x, y) => y.ms - x.ms);
if (slowAll.length) console.log('slowest steps:', slowAll.slice(0, 10).map(x => `${x.label} t${x.tick} ${x.ms}ms items=${x.items.length} projs=${x.projs} parts=${x.parts} [${(x.moves || []).map(m => m.char + ':' + m.state).join(' ')}]`).join('\n'));
allTimes.sort((a, b) => a - b);
const pct = q => +(allTimes[Math.min(allTimes.length - 1, Math.floor(allTimes.length * q))] || 0).toFixed(3);
console.log('step time ms: p50', pct(0.5), 'p99', pct(0.99), 'p99.9', pct(0.999), 'max', +(allTimes[allTimes.length - 1] || 0).toFixed(1), 'steps', allTimes.length);
console.log(JSON.stringify({ rulesets: Object.keys(RULESETS), matchesEach: N, ticks: TICKS, failures: fails,
  worstStepMs: +worstStep.toFixed(2), seconds: Math.round((Date.now() - t0) / 1000), engine: info.digest }));
process.exit(fails ? 1 : 0);
