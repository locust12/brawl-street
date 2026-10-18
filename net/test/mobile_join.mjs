// Does an invite link work ON A PHONE?
//
// Duane, 17 Oct: *"mobile clicked the link and the game doesnt show UP. mobile to create a room for
// it to work."* Creating a room on a phone works; OPENING a #room:CODE link on a phone does not, and
// browser_duo.mjs never caught it because both of its clients are desktop-shaped.
//
// A is a desktop client that creates the room. B is an emulated phone that opens the invite link and
// is asked, step by step, what it can actually see. Everything B reports is printed, so the failure
// is named rather than guessed at.
//
//   node test/mobile_join.mjs PAGE_URL WS_URL OUT_DIR
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [PAGE, WSURL, OUT = tmpdir()] = process.argv.slice(2);
const SCRATCH = process.env.SCRATCH || tmpdir();
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const procs = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

async function launch(name, W, H, phone) {
  const prof = mkdtempSync(path.join(SCRATCH, 'mj_' + name + '_'));
  const port = 9300 + Math.floor(Math.random() * 600);
  const p = spawn(CHROME, ['--headless=new', '--mute-audio', `--user-data-dir=${prof}`, '--disable-extensions',
    '--no-first-run', '--no-default-browser-check', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist', '--hide-scrollbars', '--autoplay-policy=document-user-activation-required',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    `--window-size=${W},${H}`, `--remote-debugging-port=${port}`, 'about:blank'], { stdio: 'ignore' });
  procs.push({ p, prof });
  let ws;
  for (let i = 0; i < 80 && !ws; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const pg = j.find(t => t.type === 'page');
      if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); break; }
    } catch (e) { /* starting */ }
    await sleep(250);
  }
  if (!ws) throw new Error(name + ': no devtools');
  await new Promise(r => { if (ws.readyState === 1) r(); else ws.onopen = r; });
  let id = 0; const pending = new Map(); const errs = [];
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result); pending.delete(d.id); }
    else if (d.method === 'Runtime.exceptionThrown') {
      const t = JSON.stringify(d.params.exceptionDetails).slice(0, 300);
      errs.push(t); console.log(name, 'EXCEPTION', t);
    } else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') {
      const t = d.params.args.map(x => x.value ?? x.description).join(' ').slice(0, 250);
      errs.push(t); console.log(name, 'console.error', t);
    }
  };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: phone ? 3 : 1, mobile: !!phone });
  if (phone) {
    await send('Emulation.setUserAgentOverride', { userAgent: IPHONE_UA, platform: 'iPhone' });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await send('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' });
  }
  const ev = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r && r.result ? r.result.value : undefined;
  };
  const until = async (expr, ms = 45000, what = expr) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await ev(`(()=>{try{return !!(${expr})}catch(e){return false}})()`)) return true;
      await sleep(300);
    }
    return false;
  };
  const shot = async file => {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path.join(OUT, file), Buffer.from(s.data, 'base64'));
    console.log(name, 'shot', file);
  };
  const tap = async (x, y) => {
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await sleep(60);
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  return { name, send, ev, until, shot, tap, errs, go: url => send('Page.navigate', { url }) };
}

const cleanup = () => {
  for (const { p, prof } of procs) {
    try { p.kill('SIGKILL'); } catch (e) { /* gone */ }
    try { spawnSync('pkill', ['-9', '-f', prof]); } catch (e) { /* gone */ }
    try { rmSync(prof, { recursive: true, force: true }); } catch (e) { /* gone */ }
  }
};

(async () => {
  const out = { ok: false, step: 'start', mobile: {} };
  try {
    const A = await launch('A-desktop', 1280, 800, false);
    const B = await launch('B-phone', 390, 844, true);

    // ---- A makes a room
    const Q = '?nettest=1&server=' + encodeURIComponent(WSURL);
    await A.go(PAGE + Q + '#online');
    if (!await A.until("Net.state.conn === 'open' && Net.state.me && Net.state.me.build", 180000)) throw new Error('A never connected');
    await A.ev("(()=>{const n=document.getElementById('nbName');n.value='Alice';n.onchange();})()");
    await sleep(800);
    await A.ev("document.getElementById('nbCreate').click()");
    if (!await A.until('Net.state.room && Net.state.room.code', 20000)) throw new Error('A never got a room');
    const code = await A.ev('Net.state.room.code');
    console.log('room code', code);
    out.code = code;

    // ---- B is a phone opening the invite link, exactly as a player would
    out.step = 'phone opens the link';
    const link = PAGE + Q + '#room:' + code;
    console.log('phone opens', link);
    await B.go(link);
    await sleep(9000);
    await B.shot('phone_after_link.png');

    // what can the phone actually see?
    out.mobile.isMobileUA = await B.ev('/Mobi|iPhone/i.test(navigator.userAgent)');
    out.mobile.hash = await B.ev('location.hash');
    out.mobile.netExists = await B.ev('typeof Net !== "undefined"');
    out.mobile.conn = await B.ev('window.Net && Net.state ? Net.state.conn : "no Net"');
    out.mobile.inRoom = await B.ev('!!(window.Net && Net.state && Net.state.room)');
    out.mobile.netActive = await B.ev('!!(window.Net && Net.active)');
    out.mobile.visibleScreen = await B.ev(`(()=>{const s=[...document.querySelectorAll('section,div.screen,#screens>*')]
      .filter(e=>e.id&&e.offsetParent!==null&&e.getBoundingClientRect().height>80).map(e=>e.id); return s.slice(0,6).join(',')})()`);
    out.mobile.canvasSize = await B.ev(`(()=>{const c=document.querySelector('canvas'); return c?c.width+'x'+c.height+' shown='+(c.offsetParent!==null):'NO CANVAS'})()`);
    out.mobile.bodyText = (await B.ev('document.body.innerText.replace(/\\s+/g," ").slice(0,220)')) || '';
    out.mobile.errors = B.errs.slice(0, 4);

    // does the room actually have two members from A's side?
    out.aSeesMembers = await A.ev('Net.state.room ? Net.state.room.members.length : 0');
    out.ok = !!out.mobile.inRoom && out.aSeesMembers >= 2;
    out.step = 'done';
  } catch (e) {
    out.error = String(e && e.message || e);
  }
  console.log(JSON.stringify(out, null, 1));
  cleanup();
  process.exit(out.ok ? 0 : 1);
})();
