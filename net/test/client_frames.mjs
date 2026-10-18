// How smooth is the PAGE during an online fight?
//
// Everything else here measures the server and the wire. A player cannot tell those apart from their
// own browser dropping frames, and the page is where the rest of the lag budget goes: the fight runs
// at 60 Hz inside requestAnimationFrame, and a frame that takes 50 ms is 50 ms the fight did not
// advance -- which in lockstep also makes the OTHER player wait.
//
// Two headless Chromes load the real page, fight each other online, and each one reports the
// distribution of its own frame times, the long frames, and what the lockstep client thought of the
// link at the same moment.
//
// READ THE NUMBERS AS A FLOOR, NOT AS A PLAYER'S EXPERIENCE: headless Chrome here renders through
// swiftshader, a software rasteriser, so it is slower than any real machine with a GPU. A long frame
// found this way is worth chasing; a merely mediocre average is the rasteriser.
//
//   node test/client_frames.mjs PAGE_URL WS_URL [SECS]
//   node test/client_frames.mjs https://brawlstreet.xyz wss://brawlstreet.5-223-91-79.sslip.io/ws 40
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [PAGE, WSURL, SECS = '35'] = process.argv.slice(2);
if (!PAGE) { console.error('usage: node test/client_frames.mjs PAGE_URL [WS_URL] [SECS]'); process.exit(2); }
const SCRATCH = process.env.SCRATCH || tmpdir();
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const procs = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function launch(name) {
  const prof = mkdtempSync(path.join(SCRATCH, 'cf_' + name + '_'));
  const port = 9500 + Math.floor(Math.random() * 400);
  const p = spawn(CHROME, ['--headless=new', '--mute-audio', `--user-data-dir=${prof}`, '--disable-extensions',
    '--no-first-run', '--no-default-browser-check', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist', '--hide-scrollbars', '--autoplay-policy=document-user-activation-required',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--window-size=1280,720', `--remote-debugging-port=${port}`, 'about:blank'], { stdio: 'ignore' });
  procs.push(p);
  let ws;
  for (let i = 0; i < 100 && !ws; i++) {
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
    else if (d.method === 'Runtime.exceptionThrown') errs.push(JSON.stringify(d.params.exceptionDetails).slice(0, 200));
    else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errs.push(d.params.args.map(x => x.value ?? x.description).join(' ').slice(0, 200));
  };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  const ev = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return undefined;
    return r && r.result ? r.result.value : undefined;
  };
  const until = async (expr, ms = 90000, what = expr) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await ev(`(()=>{try{return !!(${expr})}catch(e){return false}})()`)) return true; await sleep(300); }
    throw new Error(name + ': timed out waiting for ' + what);
  };
  return { name, send, ev, until, errs };
}

// A sampler that lives in the page and records the gap between animation frames.
const SAMPLER = `(()=>{
  if (window.__fr) return 'already';
  window.__fr = { gaps: [], last: 0, started: performance.now() };
  const tick = t => {
    if (window.__fr.last) window.__fr.gaps.push(t - window.__fr.last);
    window.__fr.last = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return 'on';
})()`;

const REPORT = `(()=>{
  const g = (window.__fr && window.__fr.gaps) || [];
  const s = g.slice().sort((a,b)=>a-b);
  const q = p => s.length ? Math.round(s[Math.min(s.length-1, Math.floor(s.length*p))]*100)/100 : null;
  const L = (window.Net && Net.state && Net.state.lock) || null;
  return {
    frames: g.length,
    fps: g.length ? Math.round(1000/(g.reduce((a,b)=>a+b,0)/g.length)*10)/10 : null,
    p50: q(0.5), p95: q(0.95), p99: q(0.99), worst: s.length ? Math.round(s[s.length-1]*100)/100 : null,
    over33: g.filter(x=>x>33).length, over100: g.filter(x=>x>100).length, over250: g.filter(x=>x>250).length,
    tick: (window.Game && Game.tick) || 0,
    rtt: window.Net && Net.state ? Math.round(Net.state.rtt) : null,
    jit: window.Net && Net.state ? Math.round(Net.state.jit) : null,
    delay: L ? L.delay : null, stalls: L ? L.stalls : null, stallMs: L ? Math.round(L.stallMs||0) : null,
    desync: !!(window.Net && Net.state && Net.state.M && Net.state.M.desync),
  };
})()`;

(async () => {
  // `server` is the page's own override (77_net.js), and `nettest=1` marks the accounts so they stay
  // off the leaderboard and get pruned.
  // `#online` is what opens the online screen and starts the connection -- without it the page sits
  // on the title menu and never reaches the server (browser_duo.mjs does the same).
  const q = (WSURL ? 'server=' + encodeURIComponent(WSURL) + '&' : '') + 'nettest=1';
  const url = PAGE + (PAGE.includes('?') ? '&' : '?') + q + '#online';
  console.log('client frame probe');
  console.log('  page ' + url);
  const A = await launch('A'), B = await launch('B');
  for (const X of [A, B]) { await X.send('Page.navigate', { url }); }
  for (const X of [A, B]) await X.until("window.Net && Net.state && Net.state.conn === 'open' && Net.state.me && Net.state.me.build", 180000, 'the page to reach the server');
  const build = await A.ev('Net.state.me.build');
  console.log('  build accepted by the server: ' + JSON.stringify(build));
  if (!build || !build.ok) { console.log('  the server refuses this page build, so there is no online fight to measure'); process.exit(1); }

  await A.ev(`document.getElementById('nbCreate').click()`);
  await A.until('Net.state.room && Net.state.room.code', 60000, 'a room');
  const code = await A.ev('Net.state.room.code');
  console.log('  room ' + code);
  await B.ev(`(()=>{Net.state.ws.send(JSON.stringify({k:'join',code:'${code}'}))})()`);
  await B.until(`Net.state.room && Net.state.room.members.length===2`, 60000, 'the second seat');
  await A.ev(`(()=>{Net.state.ws.send(JSON.stringify({k:'set',stocks:3,stage:'isle'}))})()`);
  await sleep(1200);
  await A.ev(`(()=>{const b=document.querySelector('#nrRoster .pick[data-id="pepe"]'); if(b) b.click();})()`);
  await B.ev(`(()=>{const b=document.querySelector('#nrRoster .pick[data-id="doge"]'); if(b) b.click();})()`);
  await sleep(600);
  for (const X of [A, B]) await X.ev(`document.getElementById('nrReady').click()`);
  for (const X of [A, B]) await X.until('Net.state.M && Net.state.M.id', 90000, 'the match to start');
  console.log('  match ' + await A.ev('Net.state.M.id'));

  // Sample only once the fight is actually running AND warmed up. The first seconds of a match
  // compile shaders and upload textures, and counting that as stutter would describe loading, not
  // playing -- the headless capture notes call for a 22 s warm-up for the same reason.
  await sleep(+(process.env.WARMUP_MS || 22000));
  for (const X of [A, B]) await X.ev(SAMPLER);
  // keep both fighters doing something, so the fight is not two idle statues
  for (const X of [A, B]) await X.ev(`(()=>{
    window.__poke = setInterval(()=>{
      const k = ['ArrowLeft','ArrowRight','KeyZ','KeyX','ArrowUp'][Math.floor(Math.random()*5)];
      window.dispatchEvent(new KeyboardEvent('keydown',{code:k}));
      setTimeout(()=>window.dispatchEvent(new KeyboardEvent('keyup',{code:k})), 120);
    }, 220);
  })()`);
  await sleep(+SECS * 1000);
  for (const X of [A, B]) await X.ev('clearInterval(window.__poke)');

  const rows = [];
  for (const X of [A, B]) {
    const r = await X.ev(REPORT);
    rows.push(Object.assign({ seat: X.name, errors: X.errs.length, firstError: X.errs[0] || null }, r));
  }
  console.log('\n  seat  frames   fps   p50    p95    p99   worst  >33ms >100ms >250ms  tick  rtt  delay stalls  desync  errs');
  for (const r of rows) {
    console.log('  ' + r.seat.padEnd(5) + String(r.frames).padStart(7) + String(r.fps).padStart(6) +
      String(r.p50).padStart(6) + String(r.p95).padStart(7) + String(r.p99).padStart(7) + String(r.worst).padStart(8) +
      String(r.over33).padStart(6) + String(r.over100).padStart(7) + String(r.over250).padStart(7) +
      String(r.tick).padStart(6) + String(r.rtt).padStart(5) + String(r.delay).padStart(6) + String(r.stalls).padStart(7) +
      String(r.desync).padStart(8) + String(r.errors).padStart(6));
  }
  for (const r of rows) if (r.firstError) console.log('  ' + r.seat + ' first error: ' + r.firstError);
  const bad = rows.filter(r => r.desync || r.errors || (r.over250 || 0) > 2);
  console.log('\n  ' + (bad.length ? 'LOOK AT THIS: ' + bad.map(r => r.seat).join(',') + ' had a desync, a script error, or frames over 250 ms' : 'no desync, no script errors, no frame over 250 ms twice'));
  if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify({ page: url, secs: +SECS, rows }, null, 2));
  for (const p of procs) { try { p.kill(); } catch (e) { /* gone */ } }
  process.exit(bad.length ? 1 : 0);
})().catch(e => {
  console.error('client frame probe died:', e && e.message);
  for (const p of procs) { try { p.kill(); } catch (x) { /* gone */ } }
  process.exit(3);
});
