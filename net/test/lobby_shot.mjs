// One muted headless Chrome: open a page, wait for the online lobby to connect, screenshot it.
//   node test/lobby_shot.mjs URL OUT.png [W H]     e.g. https://brawlstreet.167-233-230-149.sslip.io/#online lobby.png 390 844
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const [URL_, OUTF, WS = '390', HS = '844', PRE = ''] = process.argv.slice(2);
const OUT = path.dirname(path.resolve(OUTF));
const SCRATCH = process.env.SCRATCH || tmpdir();
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
  // SEED_LS={"tb_netRegionUrl":"\"ws://127.0.0.1:9/ws\""} seeds localStorage BEFORE the page's own
  // scripts run: that is how the "my region died" path gets tested (a stored region that never answers).
  if (process.env.SEED_LS) {
    const seed = JSON.parse(process.env.SEED_LS);
    const src = Object.entries(seed).map(([k, v]) => `try{localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)})}catch(e){}`).join(';');
    await send('Page.addScriptToEvaluateOnNewDocument', { source: src });
  }
  // NO3D=1: block three.js and the models so the page runs its light 2D renderer (busy test machines)
  if (process.env.NO3D) { await send('Network.enable'); await send('Network.setBlockedURLs', { urls: ['*three*', '*_glb.wasm*', '*.glb*', '*hero.mp4*'] }); }
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: W < 700 });
  if (W < 700) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
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

function cleanup() { for (const { p, prof } of procs) { try { p.kill('SIGKILL'); } catch (e) {} try { spawnSync('pkill', ['-9', '-f', prof]); } catch (e) {} try { rmSync(prof, { recursive: true, force: true }); } catch (e) {} } }
process.on('exit', cleanup);
setTimeout(() => { console.log('TIMEOUT'); cleanup(); process.exit(2); }, 400000);
(async () => {
  const A = await launch('M', +WS, +HS);
  await A.go(URL_.includes('?') ? URL_.replace('?', '?nettest=1&') : URL_.replace(/(#|$)/, '?nettest=1$1'));
  await A.until(`Net.state.conn === 'open' && Net.state.me && document.querySelector('.ns3')`, 300000, 'lobby online');
  console.log('state', await A.ev('JSON.stringify({conn:Net.state.conn, build:Net.state.me.build, bal:Net.state.me.bal, url:Net.state.ws&&Net.state.ws.url})'));
  if (PRE) { await A.ev(PRE); await sleep(1200); }
  await sleep(2500);
  await A.shot(path.basename(OUTF));
  cleanup(); process.exit(0);
})().catch(e => { console.log('FAIL', e.message); cleanup(); process.exit(1); });
