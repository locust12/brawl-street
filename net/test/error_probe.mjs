// One muted headless browser watches a fight and reports every page error, frozen frame and slow sim step.
//   node test/error_probe.mjs URL SECONDS      (URL should start a fight, e.g. .../#demo:street)
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
const [URL_, SECS = '40'] = process.argv.slice(2);
const SCRATCH = process.env.SCRATCH || tmpdir();
const prof = mkdtempSync(SCRATCH + '/probe_');
const port = 9300 + Math.floor(Math.random() * 600);
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--mute-audio', `--user-data-dir=${prof}`,
  '--disable-extensions', '--no-first-run', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars',
  '--autoplay-policy=document-user-activation-required', '--window-size=1280,720', `--remote-debugging-port=${port}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const done = c => { try { chrome.kill('SIGKILL'); } catch (e) {} try { spawnSync('pkill', ['-9', '-f', prof]); } catch (e) {} try { rmSync(prof, { recursive: true, force: true }); } catch (e) {} process.exit(c); };
setTimeout(() => { console.log('TIMEOUT'); done(2); }, 400000);
let ws;
for (let i = 0; i < 100 && !ws; i++) { try { const j = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const pg = j.find(t => t.type === 'page'); if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); break; } } catch (e) {} await sleep(250); }
await new Promise(r => { if (ws.readyState === 1) r(); else ws.onopen = r; });
let id = 0; const pend = new Map(); const seen = [];
ws.onmessage = m => { const d = JSON.parse(m.data);
  if (d.id && pend.has(d.id)) { pend.get(d.id)(d.result); pend.delete(d.id); }
  else if (d.method === 'Runtime.exceptionThrown') { const x = d.params.exceptionDetails; seen.push((x.exception && x.exception.description || x.text || '').split('\n').slice(0, 3).join(' | ')); }
  else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') seen.push('console.error ' + d.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 200));
};
const send = (m, p = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r && r.result ? r.result.value : undefined; };
await send('Runtime.enable'); await send('Page.enable');
await send('Page.navigate', { url: URL_ });
for (let i = 0; i < 120; i++) { if (await ev(`typeof Game !== 'undefined' && Game.tick > 30`)) break; await sleep(1000); }
await ev(`(()=>{ if (window.__P) return; const P = window.__P = { errs: [], hitch: [], slow: [] };
  addEventListener('error', e => P.errs.push(String(e.message) + ' @' + (e.filename||'').split('/').pop() + ':' + e.lineno + ' ' + String((e.error&&e.error.stack)||'').split('\\n')[1]));
  addEventListener('unhandledrejection', e => P.errs.push('rejection ' + String(e.reason && e.reason.message || e.reason)));
  let last = performance.now(); const beat = () => { const n = performance.now(); if (n - last > 250) P.hitch.push({ gap: Math.round(n - last), tick: Game.tick }); last = n; requestAnimationFrame(beat); }; requestAnimationFrame(beat);
  const s0 = Game.step.bind(Game); Game.step = function () { const t = performance.now(); const r = s0(); const ms = performance.now() - t; if (ms > 25) P.slow.push({ tick: Game.tick, ms: Math.round(ms), f: Game.fighters.map(x => x.state + (x.move && x.move.def && x.move.def.shout ? ':' + x.move.def.shout : '')) }); return r; };
})()`);
await sleep(+SECS * 1000);
const out = await ev(`JSON.stringify({tick: Game.tick, fps: Math.round(__P ? 0 : 0), errs: __P.errs.slice(0,12), nerr: __P.errs.length, hitch: __P.hitch.slice(-8), nhitch: __P.hitch.length, slow: __P.slow.slice(-8), nslow: __P.slow.length})`);
console.log('devtools exceptions:', seen.slice(0, 8).join(' || ') || 'none');
console.log(out);
done(0);
