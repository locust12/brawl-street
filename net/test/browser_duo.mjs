// Two real (headless, throwaway-profile) Chrome players against a Brawlstreet server:
// A opens the lobby and creates a 1v1 room, B joins through the invite link (#room:CODE), both pick,
// ready up and fight with real key events. Screenshots: lobby, room, live match (both screens), results.
//   node test/browser_duo.mjs PAGE_URL WS_URL OUT_DIR
// e.g. node test/browser_duo.mjs http://127.0.0.1:8799/ ws://127.0.0.1:8799/ws /tmp/shots
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [PAGE, WSURL, OUT = tmpdir()] = process.argv.slice(2);
const SCRATCH = process.env.SCRATCH || tmpdir();
mkdirSync(OUT, { recursive: true });
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const procs = [];

async function launch(name, W, H) {
  const prof = mkdtempSync(path.join(SCRATCH, 'duo_' + name + '_'));
  const port = 9300 + Math.floor(Math.random() * 600);
  const p = spawn(CHROME, ['--headless=new', '--mute-audio', `--user-data-dir=${prof}`, '--disable-extensions', '--no-first-run', '--no-default-browser-check',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--hide-scrollbars', '--autoplay-policy=document-user-activation-required',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    `--window-size=${W},${H}`, `--remote-debugging-port=${port}`, 'about:blank'], { stdio: 'ignore' });
  procs.push({ p, prof });
  let ws;
  for (let i = 0; i < 80 && !ws; i++) {
    try { const j = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const pg = j.find(t => t.type === 'page'); if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); break; } } catch (e) { /* starting */ }
    await sleep(250);
  }
  if (!ws) throw new Error(name + ': no devtools');
  await new Promise(r => { if (ws.readyState === 1) r(); else ws.onopen = r; });
  let id = 0; const pending = new Map();
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result); pending.delete(d.id); }
    else if (d.method === 'Runtime.exceptionThrown') console.log(name, 'EXCEPTION', JSON.stringify(d.params.exceptionDetails).slice(0, 400));
    else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') console.log(name, 'console.error', d.params.args.map(x => x.value ?? x.description).join(' ').slice(0, 300));
  };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  // NO3D=1: block three.js and the models so the page runs its light 2D renderer (busy test machines)
  if (process.env.NO3D) { await send('Network.enable'); await send('Network.setBlockedURLs', { urls: ['*three*', '*_glb.wasm*', '*.glb*', '*hero.mp4*'] }); }
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r && r.result ? r.result.value : undefined; };
  const until = async (expr, ms = 60000, what = expr) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await ev(`(()=>{try{return !!(${expr})}catch(e){return false}})()`)) return true; await sleep(300); }
    throw new Error(name + ' timed out: ' + what);
  };
  const shot = async file => { const s = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path.join(OUT, file), Buffer.from(s.data, 'base64')); console.log(name, 'shot', file); };
  const key = async (code, down) => {
    const k = { KeyA: ['a', 65], KeyD: ['d', 68], KeyW: ['w', 87], KeyS: ['s', 83], KeyF: ['f', 70], KeyG: ['g', 71], KeyH: ['h', 72], KeyR: ['r', 82], Space: [' ', 32] }[code];
    await send('Input.dispatchKeyEvent', { type: down ? 'keyDown' : 'keyUp', code, key: k[0], windowsVirtualKeyCode: k[1], nativeVirtualKeyCode: k[1] });
  };
  return { name, send, ev, until, shot, key, go: url => send('Page.navigate', { url }) };
}

function cleanup() {
  for (const { p, prof } of procs) { try { p.kill('SIGKILL'); } catch (e) { /* gone */ } try { spawnSync('pkill', ['-9', '-f', prof]); } catch (e) { /* gone */ } try { rmSync(prof, { recursive: true, force: true }); } catch (e) { /* gone */ } }
}
process.on('exit', cleanup);
setTimeout(() => { console.log('TIMEOUT'); cleanup(); process.exit(2); }, 900000);

(async () => {
  const q = '?nettest=1&server=' + encodeURIComponent(WSURL);
  const A = await launch('A', 1280, 720);
  await A.go(PAGE + q + '#online');
  await A.until(`Net.state.conn === 'open' && Net.state.me && Net.state.me.build`, 180000, 'A online');
  const build = await A.ev('Net.state.me.build');
  console.log('A welcome build', JSON.stringify(build));
  await A.ev(`(()=>{const n=document.getElementById('nbName');n.value='Alice';n.onchange();})()`);
  await sleep(800);
  await A.shot('lobby.png');
  // create a 1v1 room, 1 life so the match ends quickly, fixed stage
  await A.ev(`document.getElementById('nbCreate').click()`);
  await A.until(`Net.state.room && Net.state.room.code`, 10000, 'room');
  const code = await A.ev('Net.state.room.code');
  await A.ev(`(()=>{const s=Net.state; s.ws.send(JSON.stringify({k:'set',stocks:1,stage:'street'}));})()`);
  console.log('room code', code);
  const B = await launch('B', 1280, 720);
  await B.go(PAGE + q + '#room:' + code);
  await B.until(`Net.state.room && Net.state.room.members.length === 2`, 180000, 'B joined');
  await B.ev(`(()=>{const n=document.getElementById('nbName');if(n){n.value='Bob';n.onchange();}})()`);
  await A.ev(`document.querySelector('#nrRoster .pick[data-id="pepe"]').click()`);
  await B.ev(`document.querySelector('#nrRoster .pick[data-id="doge"]').click()`);
  await sleep(1200);
  await A.shot('room.png');
  await B.shot('room_b.png');
  await A.ev(`document.getElementById('nrReady').click()`);
  await sleep(400);
  await B.ev(`document.getElementById('nrReady').click()`);
  await A.until('Net.active', 20000, 'A match'); await B.until('Net.active', 20000, 'B match');
  console.log('match started', await A.ev('Net.state.M.id'));
  // fight: walk at each other and swing for a while
  const probe = X => X.ev('({t:Game.tick, st:Game.state, act:Net.active, now:Math.round(performance.now()), start:Math.round(Net.state.M&&Net.state.M.startLocal), stalls:Net.state.lock&&Net.state.lock.stalls, sf:Net.state.lock&&Math.round(Net.state.lock.stalledFor), logs:Net.state.lock&&Net.state.lock.logs.map(a=>a.length), delay:Net.state.lock&&Net.state.lock.delay, sent:Net.state.lock&&Net.state.lock.sentUpTo})');
  for (let i = 0; i < 40; i++) {
    const [a, b] = [await probe(A), await probe(B)];
    console.log('A', JSON.stringify(a), 'B', JSON.stringify(b));
    if (a.t > 200 && b.t > 200) break;
    await sleep(3000);
  }
  const t0 = Date.now();
  let k = 0, shotTaken = false;
  while (Date.now() - t0 < 20000) {
    if (!shotTaken && Date.now() - t0 > 7000) { shotTaken = true; await A.shot('match_a.png'); await B.shot('match_b.png'); }
    await A.key('KeyD', true); await B.key('KeyA', true);
    await sleep(140);
    await A.key('KeyD', false); await B.key('KeyA', false);
    await A.key(k % 3 ? 'KeyF' : 'KeyR', true); await B.key(k % 2 ? 'KeyF' : 'KeyG', true);
    await sleep(60);
    await A.key(k % 3 ? 'KeyF' : 'KeyR', false); await B.key(k % 2 ? 'KeyF' : 'KeyG', false);
    if (k % 5 === 0) { await A.key('KeyW', true); await sleep(40); await A.key('KeyW', false); }
    k++;
  }
  const mid = await Promise.all([A.ev('({t:Game.tick,h:NetSim.hash(),d:Net.state.M.desync,st:Net.state.lock.stalls,delay:Net.state.lock.delay,dmg:Game.fighters.map(f=>Math.round(f.dmg))})'), B.ev('({t:Game.tick,h:NetSim.hash(),d:Net.state.M.desync,st:Net.state.lock.stalls,delay:Net.state.lock.delay,dmg:Game.fighters.map(f=>Math.round(f.dmg))})')]);
  console.log('mid-match A', JSON.stringify(mid[0]), 'B', JSON.stringify(mid[1]));
  // finish: both walk off their side (1 life each)
  await A.key('KeyA', true); await B.key('KeyD', true);
  await A.until(`Net.state.view === 'res'`, 90000, 'A results'); await B.until(`Net.state.view === 'res'`, 90000, 'B results');
  await A.key('KeyA', false); await B.key('KeyD', false);
  const ra = await A.ev('({r:Net.state.M.result, local:Net.state.M.localEnd, desync:Net.state.M.desync, stalls:Net.state.lock.stalls, stallMs:Math.round(Net.state.lock.stallMs)})');
  const rb = await B.ev('({r:Net.state.M.result, local:Net.state.M.localEnd, desync:Net.state.M.desync, stalls:Net.state.lock.stalls, stallMs:Math.round(Net.state.lock.stallMs)})');
  await sleep(1500);
  await A.shot('results.png'); await B.shot('results_b.png');
  const ok = ra.r.id === rb.r.id && ra.r.winner === rb.r.winner && (!ra.local || ra.local.winner === ra.r.winner) && (!rb.local || rb.local.winner === rb.r.winner) && !ra.desync && !rb.desync && !(ra.r.desync || []).length;
  console.log(JSON.stringify({ ok, match: ra.r.id, reason: ra.r.reason, serverWinner: ra.r.winner, localA: ra.local, localB: rb.local, ticks: ra.r.ticks, desync: ra.r.desync, stallsA: ra.stalls + '/' + ra.stallMs + 'ms', stallsB: rb.stalls + '/' + rb.stallMs + 'ms', replay: ra.r.replay }));
  cleanup();
  process.exit(ok ? 0 : 1);
})().catch(e => { console.log('FAIL', e.message); cleanup(); process.exit(1); });
