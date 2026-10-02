// Does the PAGE compute the same engine fingerprint as the server's copy? If these ever differ, every
// player is told "your game is out of date" and online play stops, so this check is worth keeping.
//   node test/digest_check.mjs [PAGE_URL]
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require_ = createRequire(import.meta.url);
const engine = require_('../lib/engine.js');
const [URL_ = 'http://127.0.0.1:8799/'] = process.argv.slice(2);
const OUT = tmpdir();
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
setTimeout(() => { console.log('TIMEOUT'); cleanup(); process.exit(2); }, 420000);
(async () => {
  const local = engine.load();
  const A = await launch('D', 900, 600);
  await A.go(URL_);
  await A.until(`typeof NetSim !== 'undefined' && typeof CHARS !== 'undefined' && CHARS.length > 0`, 300000, 'game loaded');
  await sleep(1500);
  const page = await A.ev('(()=>{ try { const d = NetSim.digest(); if (typeof UI !== "undefined" && UI.startDemo) UI.startDemo(); return d; } catch (e) { return "ERR " + e.message; } })()');
  const chars = await A.ev('CHARS.length');
  const ok = page === local.digest;
  console.log(JSON.stringify({ ok, page, engine: local.digest, pageChars: chars, engineChars: local.chars.length }));
  cleanup(); process.exit(ok ? 0 : 1);
})().catch(e => { console.log('FAIL', e.message); cleanup(); process.exit(1); });
