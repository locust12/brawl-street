// Two real browsers play an online match and spam every attack, with the page instrumented so a freeze,
// an exception or a desync cannot hide. Keep this around: it is the tool for "online broke" reports.
//
//   node test/attack_stress.mjs PAGE_URL WS_URL OUT_DIR [SECONDS] [STOCKS]
//   e.g. node test/attack_stress.mjs https://brawlstreet.167-233-230-149.sslip.io/ wss://brawlstreet.167-233-230-149.sslip.io/ws dev/stress 120 3
//
// What it records on each page (window.__BS):
//   errs   - window.onerror + unhandledrejection, with stacks
//   hitch  - animation-frame gaps over 250 ms (a frozen main thread), with the fight tick
//   slow   - single lockstep steps over 50 ms, with the tick and the move each fighter was in
//   trace  - per-tick state hash ring buffer, so the first divergent tick between the two pages is findable
// It then reports the first tick where the two pages disagree, and what each fighter was doing there.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [PAGE, WSURL, OUT = 'dev/stress', SECS = '120', STOCKS = '3'] = process.argv.slice(2);
const SCRATCH = process.env.SCRATCH || tmpdir();
mkdirSync(OUT, { recursive: true });
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const procs = [];

// the page-side recorder: installed before the match starts
const PROBE = `(() => {
  if (window.__BS) return 'already';
  const B = window.__BS = { errs: [], hitch: [], slow: [], trace: [], started: performance.now(), steps: 0 };
  addEventListener('error', e => B.errs.push({ t: Math.round(performance.now()), msg: String(e.message), src: (e.filename || '') + ':' + e.lineno, stack: (e.error && e.error.stack || '').slice(0, 600) }));
  addEventListener('unhandledrejection', e => B.errs.push({ t: Math.round(performance.now()), msg: 'rejection ' + String(e.reason && e.reason.message || e.reason), stack: (e.reason && e.reason.stack || '').slice(0, 600) }));
  // frozen main thread: animation frames stop arriving
  let last = performance.now();
  const beat = () => { const n = performance.now(); if (n - last > 250) B.hitch.push({ t: Math.round(n), gap: Math.round(n - last), tick: (typeof Game !== 'undefined' ? Game.tick : -1) }); last = n; requestAnimationFrame(beat); };
  requestAnimationFrame(beat);
  // one slow simulation step, and the per-tick hash trace
  const L = () => (window.Net && Net.state && Net.state.lock) || null;
  const lock = L();
  if (lock && !lock.__wrapped) {
    lock.__wrapped = true;
    const step0 = lock.stepOnce.bind(lock);
    lock.stepOnce = function (quiet) {
      const t0 = performance.now();
      const r = step0(quiet);
      const ms = performance.now() - t0;
      B.steps++;
      if (ms > 50) B.slow.push({ tick: Game.tick, ms: Math.round(ms), moves: Game.fighters.map(f => (f.move && f.move.def && (f.move.def.shout || f.move.def.clip) || f.state)) });
      if (Game.tick % 1 === 0) { B.trace.push(Game.tick + ':' + NetSim.hash()); if (B.trace.length > 4000) B.trace.shift(); }
      return r;
    };
  }
  return 'ok';
})()`;

async function launch(name, W, H) {
  const prof = mkdtempSync(path.join(SCRATCH, 'stress_' + name + '_'));
  const port = 9300 + Math.floor(Math.random() * 600);
  const p = spawn(CHROME, ['--headless=new', '--mute-audio', `--user-data-dir=${prof}`, '--disable-extensions', '--no-first-run', '--no-default-browser-check',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--hide-scrollbars', '--autoplay-policy=document-user-activation-required',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    `--window-size=${W},${H}`, `--remote-debugging-port=${port}`, 'about:blank'], { stdio: 'ignore' });
  procs.push({ p, prof });
  let ws;
  for (let i = 0; i < 100 && !ws; i++) {
    try { const j = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const pg = j.find(t => t.type === 'page'); if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); break; } } catch (e) { /* starting */ }
    await sleep(250);
  }
  if (!ws) throw new Error(name + ': no devtools');
  await new Promise(r => { if (ws.readyState === 1) r(); else ws.onopen = r; });
  let id = 0; const pending = new Map();
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result); pending.delete(d.id); }
    else if (d.method === 'Runtime.exceptionThrown') console.log(name, 'EXCEPTION', JSON.stringify(d.params.exceptionDetails.exception && d.params.exceptionDetails.exception.description || d.params.exceptionDetails.text).slice(0, 500));
    else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') console.log(name, 'console.error', d.params.args.map(x => x.value ?? x.description).join(' ').slice(0, 400));
  };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  // NO3D=1: block three.js and the models so a busy machine can still run two clients (input path only)
  if (process.env.NO3D) { await send('Network.enable'); await send('Network.setBlockedURLs', { urls: ['*three*', '*_glb.wasm*', '*.glb*', '*hero.mp4*', '*.mp3*', '*.m4a*'] }); }
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r && r.exceptionDetails) return { __err: String(r.exceptionDetails.text) }; return r && r.result ? r.result.value : undefined; };
  const until = async (expr, ms, what) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(`(()=>{try{return !!(${expr})}catch(e){return false}})()`)) return true; await sleep(300); } throw new Error(name + ' timed out: ' + what); };
  const shot = async f => { const s = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path.join(OUT, f), Buffer.from(s.data, 'base64')); };
  // kb1 from src/10_core.js: attack F, special G, shield H, smash T, grab E, grapple R, drop Q
  const KEYS = { KeyA: ['a', 65], KeyD: ['d', 68], KeyW: ['w', 87], KeyS: ['s', 83], KeyF: ['f', 70], KeyG: ['g', 71], KeyH: ['h', 72],
    KeyT: ['t', 84], KeyE: ['e', 69], KeyR: ['r', 82], KeyQ: ['q', 81], Space: [' ', 32] };
  const key = async (code, down) => { const k = KEYS[code]; await send('Input.dispatchKeyEvent', { type: down ? 'keyDown' : 'keyUp', code, key: k[0], windowsVirtualKeyCode: k[1], nativeVirtualKeyCode: k[1] }); };
  const tap = async (code, ms = 40) => { await key(code, true); await sleep(ms); await key(code, false); };
  return { name, ev, until, shot, key, tap, go: url => send('Page.navigate', { url }) };
}
function cleanup() { for (const { p, prof } of procs) { try { p.kill('SIGKILL'); } catch (e) { /* gone */ } try { spawnSync('pkill', ['-9', '-f', prof]); } catch (e) { /* gone */ } try { rmSync(prof, { recursive: true, force: true }); } catch (e) { /* gone */ } } }
process.on('exit', cleanup);
setTimeout(() => { console.log('TIMEOUT'); cleanup(); process.exit(2); }, 900000);

// every attack the game has: jab, tilts, smashes, specials in all four directions, grab, aerials, item use/throw
async function attackBurst(P, r) {
  const roll = r();
  if (roll < 0.18) await P.tap('KeyF');                                                                  // jab / item use
  else if (roll < 0.28) { await P.key('KeyD', true); await P.tap('KeyF'); await P.key('KeyD', false); }   // forward tilt
  else if (roll < 0.36) { await P.key('KeyW', true); await P.tap('KeyF'); await P.key('KeyW', false); }   // up tilt
  else if (roll < 0.44) { await P.key('KeyS', true); await P.tap('KeyF'); await P.key('KeyS', false); }   // down tilt / pick up
  else if (roll < 0.52) await P.tap('KeyT', 120);                                                        // smash, charged
  else if (roll < 0.58) { await P.key('KeyW', true); await P.tap('KeyT'); await P.key('KeyW', false); }   // up smash
  else if (roll < 0.66) await P.tap('KeyG');                                                             // neutral special
  else if (roll < 0.72) { await P.key('KeyS', true); await P.tap('KeyG'); await P.key('KeyS', false); }   // down special
  else if (roll < 0.77) { await P.key('KeyW', true); await P.tap('KeyG'); await P.key('KeyW', false); }   // up special
  else if (roll < 0.85) await P.tap('KeyE');                                                             // grab        (bit 9)
  else if (roll < 0.93) await P.tap('KeyR');                                                             // grapple     (bit 10)
  else if (roll < 0.97) await P.tap('KeyQ');                                                             // drop item   (bit 11)
  else { await P.key('KeyH', true); await P.tap('KeyF'); await P.key('KeyH', false); }                    // shield grab / throw
}
const lcg = seed => { let s = seed >>> 0 || 1; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; };

(async () => {
  const q = (PAGE.includes('?') ? '&' : '?') + 'nettest=1&server=' + encodeURIComponent(WSURL);
  const A = await launch('A', 1280, 720);
  await A.go(PAGE + q + '#online');
  await A.until(`Net.state.conn === 'open' && Net.state.me`, 240000, 'A online');
  const build = await A.ev('JSON.stringify(Net.state.me.build)');
  console.log('build', build);
  await A.ev(`(()=>{const n=document.getElementById('nbName');n.value='StressA';n.onchange();})()`);
  await A.ev(`document.getElementById('nbCreate').click()`);
  await A.until(`Net.state.room && Net.state.room.code`, 120000, 'room');
  const code = await A.ev('Net.state.room.code');
  await A.ev(`Net.send({k:'set',stocks:${+STOCKS},items:true,stage:'street'})`);
  const B = await launch('B', 1280, 720);
  await B.go(PAGE + q + '#room:' + code);
  await B.until(`Net.state.room && Net.state.room.members.length === 2`, 240000, 'B joined');
  await B.ev(`(()=>{const n=document.getElementById('nbName');if(n){n.value='StressB';n.onchange();}})()`);
  await A.ev(`Net.send({k:'pick',char:'doge'})`); await B.ev(`Net.send({k:'pick',char:'pepe'})`);
  await sleep(600);
  await A.ev(`document.getElementById('nrReady').click()`);
  await sleep(300);
  await B.ev(`document.getElementById('nrReady').click()`);
  await A.until('Net.active', 180000, 'A match'); await B.until('Net.active', 180000, 'B match');
  console.log('match', await A.ev('Net.state.M.id'));
  await A.until('Net.state.lock', 10000, 'lock'); await B.until('Net.state.lock', 10000, 'lock');
  console.log('probe A', await A.ev(PROBE), 'probe B', await B.ev(PROBE));
  const lockState = P => P.ev(`JSON.stringify({tick: typeof Game!=='undefined'?Game.tick:-1, active: !!Net.active,
    startIn: Net.state.M ? Math.round(Net.state.M.startLocal - performance.now()) : null,
    me: Net.state.lock ? Net.state.lock.me : null, delay: Net.state.lock ? Net.state.lock.delay : null,
    sentUpTo: Net.state.lock ? Net.state.lock.sentUpTo : null, logs: Net.state.lock ? Net.state.lock.logs.map(a => a.length) : null,
    missing: Net.state.lock ? Net.state.lock.missing() : null, stalledFor: Net.state.lock ? Math.round(Net.state.lock.stalledFor) : null,
    steps: Net.state.lock ? Net.state.lock.steps : null, conn: Net.state.conn, errs: (window.__BS ? __BS.errs.slice(0, 5) : [])})`);
  try { await A.until('Game.tick > 200', 60000, 'countdown over'); }
  catch (e) {
    console.log('STUCK. A:', await lockState(A));
    console.log('STUCK. B:', await lockState(B));
    throw e;
  }

  // walk into each other and attack, non-stop
  const rA = lcg(11), rB = lcg(22), t0 = Date.now();
  let shots = 0;
  while (Date.now() - t0 < +SECS * 1000) {
    const over = await A.ev(`!Net.active || !!(Net.state.M && Net.state.M.result)`);
    if (over === true) { console.log('match ended after', Math.round((Date.now() - t0) / 1000), 's'); break; }
    await Promise.all([
      (async () => { await A.key('KeyD', true); await sleep(90); await A.key('KeyD', false); await attackBurst(A, rA); })(),
      (async () => { await B.key('KeyA', true); await sleep(90); await B.key('KeyA', false); await attackBurst(B, rB); })(),
    ]);
    if (Date.now() - t0 > 8000 && shots === 0) { shots = 1; await A.shot('stress_a.png'); await B.shot('stress_b.png'); }
  }
  for (const P of [A, B]) for (const k of ['KeyA', 'KeyD', 'KeyW', 'KeyS', 'KeyF', 'KeyG', 'KeyH', 'KeyR']) await P.key(k, false);

  const dump = async P => P.ev(`JSON.stringify({errs:__BS.errs.slice(0,25), hitch:__BS.hitch.slice(-25), slow:__BS.slow.slice(-25), steps:__BS.steps,
    tick: typeof Game!=='undefined'?Game.tick:-1, active: !!Net.active, stalls: Net.state.lock?Net.state.lock.stalls:-1, stallMs: Net.state.lock?Math.round(Net.state.lock.stallMs):-1,
    desync: Net.state.M?Net.state.M.desync:null, result: Net.state.M&&Net.state.M.result?{reason:Net.state.M.result.reason,winner:Net.state.M.result.winner}:null,
    trace: __BS.trace.slice(-1500)})`);
  const a = JSON.parse(await dump(A)), b = JSON.parse(await dump(B));
  // first tick where the two pages disagree
  const mapB = new Map(b.trace.map(x => x.split(':')).map(([t, h]) => [t, h]));
  let firstBad = null;
  for (const line of a.trace) { const [t, h] = line.split(':'); const o = mapB.get(t); if (o && o !== h) { firstBad = { tick: +t, a: h, b: o }; break; } }
  const summary = {
    build: JSON.parse(build), match: await A.ev('Net.state.M && Net.state.M.id'),
    A: { tick: a.tick, steps: a.steps, errs: a.errs.length, hitches: a.hitch.length, worstHitch: Math.max(0, ...a.hitch.map(h => h.gap)), slowSteps: a.slow.length, worstStep: Math.max(0, ...a.slow.map(s => s.ms)), stalls: a.stalls, stallMs: a.stallMs, desync: a.desync, result: a.result },
    B: { tick: b.tick, steps: b.steps, errs: b.errs.length, hitches: b.hitch.length, worstHitch: Math.max(0, ...b.hitch.map(h => h.gap)), slowSteps: b.slow.length, worstStep: Math.max(0, ...b.slow.map(s => s.ms)), stalls: b.stalls, stallMs: b.stallMs, desync: b.desync, result: b.result },
    firstDivergentTick: firstBad,
  };
  writeFileSync(path.join(OUT, 'attack_stress.json'), JSON.stringify({ summary, A: a, B: b }, null, 1));
  console.log(JSON.stringify(summary));
  if (a.errs.length) console.log('A errors:', JSON.stringify(a.errs.slice(0, 5), null, 1));
  if (b.errs.length) console.log('B errors:', JSON.stringify(b.errs.slice(0, 5), null, 1));
  if (a.slow.length) console.log('A slowest steps:', JSON.stringify(a.slow.slice(-5)));
  cleanup();
  process.exit(summary.firstDivergentTick || a.errs.length || b.errs.length ? 1 : 0);
})().catch(e => { console.log('FAIL', e.message); cleanup(); process.exit(1); });
