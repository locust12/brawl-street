// A REAL-money 1v1, played by two real browsers, against the REAL deployed BrawlEscrowToken on a
// fork of Arbitrum: both pages connect a wallet, approve and deposit USDC, fight, and the winner
// claims. Every figure is read off the chain, never off the page, and the loser is made to try the
// winner's claim() so a pot that pays the wrong person fails the test.
//
// This exists because test/escrow_e2e.js and test/cpu_wager_gate.js both SIGN THE SERVER'S OWN
// MESSAGE STRING, so they passed for weeks while no real browser could bind a wallet at all (the
// page signed `Brawl Street online…` and the server verified `Brawlstreet online…`). A money test
// that does not go through the page cannot catch that class of bug.
//
//   bash test/wager_fork_up.sh                              # fork Arbitrum on :18777, fund 2 players
//   node test/wager_signer.cjs 19100 http://127.0.0.1:18777 # stands in for a wallet extension
//   PORT=18800 PUBLIC_DIR=<dir with the built page as index.html> REAL_MONEY=1 \
//     CHAIN_RPC=http://127.0.0.1:18777 CHAIN_ID=42161 \
//     ESCROW_ADDRESS=0x4f69E9698537Faf2DD0cd9365a5f5443D03Bd427 \
//     ESCROW_TOKEN=0xaf88d065e77c8cC2239327C5EDb3A432268e5831 ESCROW_TOKEN_DECIMALS=6 \
//     OPERATOR_KEY=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a \
//     REAL_STAKES=1 SAME_IP_OK=1 FUND_PER_ACCT=1000 node server.js
//   node test/wager_browser_duo.mjs http://127.0.0.1:18800/ ws://127.0.0.1:18800/ws /tmp/shots b 1
//
// NODEPOSIT=a|b runs the other half: that player's wallet refuses, and the test then proves the
// player who DID pay gets their stake back and the escrow keeps nothing. Give that server a short
// FUND_WINDOW_S (70 is plenty) or the wait is the full deposit window.
//
//   node wager_browser_duo.mjs PAGE_URL WS_URL OUT_DIR LOSER(a|b) STAKE
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [PAGE, WSURL, OUT = tmpdir(), LOSER = 'b', STAKE = '1'] = process.argv.slice(2);
const SIGNER = process.env.SIGNER || 'http://127.0.0.1:19100';
const RPC = process.env.RPC || 'http://127.0.0.1:18777';
const ESCROW = '0x4f69E9698537Faf2DD0cd9365a5f5443D03Bd427';
const USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
const TREASURY = '0x60A060b3d6FB11facB173B1899F1C995d3FeE305';
const ADDR = { a: '0x90F79bf6EB2c4f870365E785982E1f101E93b906', b: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65' };
const SCRATCH = process.env.SCRATCH || tmpdir();
mkdirSync(OUT, { recursive: true });
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const procs = [];

// ---- on-chain reads, straight off the fork, never through the page
const call = async (to, data) => {
  for (let i = 0; i < 6; i++) {
    try {
      const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }) });
      const j = await r.json();
      if (j.result) return j.result;
      if (i === 5) throw new Error('eth_call: ' + JSON.stringify(j.error || j));
    } catch (e) { if (i === 5) throw e; }
    await sleep(700);
  }
};
const pad = a => a.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const usdc = async a => Number(BigInt(await call(USDC, '0x70a08231' + pad(a)))) / 1e6;
async function snap(label) {
  const [a, b, t, e] = await Promise.all([usdc(ADDR.a), usdc(ADDR.b), usdc(TREASURY), usdc(ESCROW)]);
  console.log(`USDC ${label.padEnd(16)} A=${a.toFixed(6)}  B=${b.toFixed(6)}  treasury=${t.toFixed(6)}  escrow=${e.toFixed(6)}`);
  return { a, b, t, e };
}

// The page expects a browser wallet. This shim is one: it announces over EIP-6963 like a real
// extension and forwards every call to the local signer, which holds a throwaway anvil key.
const NODEPOSIT = process.env.NODEPOSIT || '';   // this player's wallet refuses to send, like someone who closes the popup
const shim = slot => `(() => {
  const URL = ${JSON.stringify(SIGNER)} + '/${slot}';
  const DEAD = ${JSON.stringify(NODEPOSIT === slot)};
  const prov = {
    isMetaMask: true,
    async request(o) {
      if (DEAD && o && o.method === 'eth_sendTransaction') throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
      const r = await fetch(URL, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method: o && o.method, params: (o && o.params) || [] }) });
      const j = await r.json();
      if (j.error) throw Object.assign(new Error(j.error), { code: -32000 });
      return j.result;
    },
    on() { return prov; }, removeListener() { return prov; },
    enable() { return prov.request({ method: 'eth_requestAccounts' }); },
  };
  const info = { uuid: '0000000f-0000-4000-8000-00000000000${slot === 'a' ? '1' : '2'}', name: 'Test Wallet',
    icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=', rdns: 'test.brawl.wallet' };
  const detail = Object.freeze({ info, provider: prov });
  const ann = () => dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail }));
  addEventListener('eip6963:requestProvider', ann);
  try { window.ethereum = prov; } catch (e) {}
  ann(); setTimeout(ann, 300); setTimeout(ann, 1500);
})();`;

async function launch(name, slot, W, H) {
  const prof = mkdtempSync(path.join(SCRATCH, 'wag_' + name + '_'));
  const port = 9400 + Math.floor(Math.random() * 500);
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
    else if (d.method === 'Runtime.exceptionThrown') console.log(name, 'EXCEPTION', JSON.stringify(d.params.exceptionDetails).slice(0, 300));
  };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: shim(slot) });
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r && r.exceptionDetails) console.log(name, 'eval threw', JSON.stringify(r.exceptionDetails).slice(0, 200)); return r && r.result ? r.result.value : undefined; };
  const until = async (expr, ms = 60000, what = expr) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await ev(`(()=>{try{return !!(${expr})}catch(e){return false}})()`)) return true; await sleep(300); }
    throw new Error(name + ' timed out: ' + what);
  };
  const shot = async file => { const s = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path.join(OUT, file), Buffer.from(s.data, 'base64')); };
  const key = async (code, down) => {
    const k = { KeyA: ['a', 65], KeyD: ['d', 68], KeyW: ['w', 87], KeyS: ['s', 83], KeyF: ['f', 70], KeyG: ['g', 71], KeyR: ['r', 82] }[code];
    await send('Input.dispatchKeyEvent', { type: down ? 'keyDown' : 'keyUp', code, key: k[0], windowsVirtualKeyCode: k[1], nativeVirtualKeyCode: k[1] });
  };
  // the page's own toasts, so a refused deposit shows up in the log instead of a silent stall
  const toasts = async () => ev(`(window.__toasts||[]).slice(-6)`);
  return { name, slot, ev, until, shot, key, toasts, go: url => send('Page.navigate', { url }) };
}

function cleanup() {
  for (const { p, prof } of procs) { try { p.kill('SIGKILL'); } catch (e) {} try { spawnSync('pkill', ['-9', '-f', prof]); } catch (e) {} try { rmSync(prof, { recursive: true, force: true }); } catch (e) {} }
}
process.on('exit', cleanup);
setTimeout(() => { console.log('TIMEOUT'); cleanup(); process.exit(2); }, 600000);

const WINNER = LOSER === 'a' ? 'b' : 'a';

(async () => {
  const before = await snap('before');
  const q = '?nettest=1&server=' + encodeURIComponent(WSURL);
  const A = await launch('A', 'a', 1100, 620);
  await A.go(PAGE + q + '#online');
  await A.until(`Net.state.conn === 'open' && Net.state.me && Net.state.me.build`, 180000, 'A online');
  // catch every toast from here on, so a refusal is visible
  const hook = `(()=>{window.__toasts=window.__toasts||[];const o=window.toast;if(o&&!o.__hooked){const f=function(m,bad){window.__toasts.push((bad?'!! ':'')+m);return o.apply(this,arguments)};f.__hooked=1;window.toast=f;}return 1})()`;
  console.log('A build', JSON.stringify(await A.ev('Net.state.me.build')));
  console.log('A real-money config from the server:', JSON.stringify(await A.ev('Net.state.me.real')));
  await A.ev(`(()=>{const n=document.getElementById('nbName');n.value='Alice';n.onchange();})()`);
  await sleep(600);
  // a REAL-stakes 1v1 room, one stock so the fight is short
  await A.ev(`Net.state.ws.send(JSON.stringify({k:'create',size:2,stake:${STAKE},real:true,stocks:1,items:false,stage:'street'}))`);
  await A.until(`Net.state.room && Net.state.room.code`, 15000, 'A real room');
  const code = await A.ev('Net.state.room.code');
  console.log('room', code, 'real?', await A.ev('Net.state.room.real'), 'stake', await A.ev('Net.state.room.stake'));

  const B = await launch('B', 'b', 1100, 620);
  await B.go(PAGE + q + '#room:' + code);
  await B.until(`Net.state.room && Net.state.room.members.length === 2`, 180000, 'B joined');
  await B.ev(`(()=>{const n=document.getElementById('nbName');if(n){n.value='Bob';n.onchange();}})()`);
  await A.ev(hook); await B.ev(hook);
  await A.ev(`document.querySelector('#nrRoster .pick[data-id="pepe"]').click()`);
  await B.ev(`document.querySelector('#nrRoster .pick[data-id="doge"]').click()`);
  await sleep(800);

  // connect + bind each wallet (personal_sign, verified by the server)
  await A.ev(`document.getElementById('nrWallet').click()`);
  await B.ev(`document.getElementById('nrWallet').click()`);
  await A.until(`Net.state.room.members.length===2 && Net.state.room.members.every(m=>m.wallet)`, 60000, 'both wallets bound');
  console.log('wallets bound', JSON.stringify(await A.ev(`Net.state.room.members.map(m=>({n:m.name,wallet:m.wallet}))`)));
  await A.shot('01_room_a.png'); await B.shot('01_room_b.png');

  // ready up: this is what makes the server open the match on chain and both pages deposit
  await A.ev(`document.getElementById('nrReady').click()`);
  await sleep(500);
  await B.ev(`document.getElementById('nrReady').click()`);
  await A.until(`Net.state.room && Net.state.room.state === 'funding'`, 30000, 'funding started');
  console.log('funding started; waiting for both deposits and the match to launch');

  // THE UNPAID CASE: one player's wallet refuses. The other has already deposited, so the only
  // acceptable outcome is that they get their stake back.
  if (NODEPOSIT) {
    const paid = NODEPOSIT === 'a' ? B : A, who = NODEPOSIT === 'a' ? 'b' : 'a';
    // the honest player's stake has to be IN the escrow before this means anything
    let got = null;
    for (let i = 0; i < 25; i++) { got = await snap('waiting on deposit'); if (got.e - before.e >= Number(STAKE) - 1e-9) break; await sleep(2000); }
    if (got.e - before.e < Number(STAKE) - 1e-9) { console.log('FAIL: the paying player never got their deposit in, so there is nothing to refund'); cleanup(); process.exit(1); }
    console.log(`player ${who.toUpperCase()} has ${(got.e - before.e).toFixed(6)} USDC in the escrow; player ${NODEPOSIT.toUpperCase()} refused the deposit, waiting for the window to close`);
    await paid.until(`Net.state.room && Net.state.room.state !== 'funding'`, 240000, 'funding aborted');
    await sleep(2000);
    console.log('refund offered on the page?', await paid.ev(`(()=>{const b=document.getElementById('nrRefund');return b?{hidden:b.hidden,txt:b.textContent}:null})()`));
    await paid.shot('05_refund_offered.png');
    // the cancel is an operator transaction; it has to land before a refund can be taken
    for (let i = 0; i < 20; i++) { if (await paid.ev(`!!(Net.state.refund)`)) break; await sleep(3000); }
    await paid.ev(`document.getElementById('nrRefund').click()`);
    let back = null;
    for (let i = 0; i < 20; i++) { await sleep(3000); back = await snap('after refund'); if (Math.abs(back[who] - before[who]) < 1e-6) break; }
    const okr = Math.abs(back[who] - before[who]) < 1e-6 && Math.abs(back.e - before.e) < 1e-6;
    console.log(`\nplayer ${who.toUpperCase()} staked and the fight never happened: balance back to ${back[who].toFixed(6)} (started ${before[who].toFixed(6)})`);
    console.log(okr ? 'PASS: the stake came back and the escrow kept nothing' : 'FAIL: money is stuck in the escrow');
    cleanup(); process.exit(okr ? 0 : 1);
  }
  let launched = false;
  for (let i = 0; i < 90 && !launched; i++) {
    launched = await A.ev('!!Net.active');
    if (!launched) { if (i % 10 === 9) console.log('  ...', JSON.stringify(await A.ev(`({st:Net.state.room&&Net.state.room.state, toasts:(window.__toasts||[]).slice(-3)})`)), JSON.stringify(await B.ev(`((window.__toasts||[]).slice(-3))`))); await sleep(2000); }
  }
  const mid = await snap('both funded');
  if (!launched) { console.log('MATCH NEVER LAUNCHED'); console.log('A toasts', await A.toasts(), 'B toasts', await B.toasts()); cleanup(); process.exit(1); }
  console.log('match started', await A.ev('Net.state.M.id'));
  await A.until('Net.active', 20000); await B.until('Net.active', 20000);
  await sleep(6000);
  await A.shot('02_match_a.png'); await B.shot('02_match_b.png');

  // decide the fight: the loser walks off their own edge (one stock), the winner stands still
  const L = LOSER === 'a' ? A : B, dir = LOSER === 'a' ? 'KeyA' : 'KeyD';
  console.log('player', LOSER.toUpperCase(), 'is walking off the stage, so', WINNER.toUpperCase(), 'should win');
  await L.key(dir, true);
  await A.until(`Net.state.view === 'res'`, 120000, 'A results');
  await B.until(`Net.state.view === 'res'`, 120000, 'B results');
  await L.key(dir, false);
  const res = await A.ev('({id:Net.state.M.result.id, winner:Net.state.M.result.winner, reason:Net.state.M.result.reason, slots:Net.state.M.result.slots})');
  console.log('result', JSON.stringify(res));
  await sleep(2000);
  await A.shot('03_result_a.png'); await B.shot('03_result_b.png');

  // the operator reports the winner on chain; the winner then takes the pot with Claim
  const W = WINNER === 'a' ? A : B, L2 = LOSER === 'a' ? A : B;
  const stake = Number(STAKE), pot = stake * 2, cut = pot * 0.05, due = pot - cut;
  const escId = await W.ev(`(Net.state.M.real&&Net.state.M.real.id)||null`);
  console.log('escrow match id', escId, '| server reported winner, waiting for the Claim button');
  await W.until(`(()=>{const b=document.getElementById('nsClaim');return b&&!b.hidden})()`, 120000, 'claim button on the winner screen');
  console.log('claim button says:', JSON.stringify(await W.ev(`document.getElementById('nsClaim').textContent`)));
  console.log('loser screen claim button hidden?', await L2.ev(`(()=>{const b=document.getElementById('nsClaim');return !b||b.hidden})()`));
  await W.shot('04_claim_ready.png');
  await W.ev(`document.getElementById('nsClaim').click()`);
  let after = mid;
  for (let i = 0; i < 25; i++) { await sleep(2500); after = await snap('after claim'); if (Math.abs(after[WINNER] - (before[WINNER] - stake + due)) < 1e-6) break; }
  console.log('winner toasts', await W.toasts());

  // the loser must not be able to take the pot: same call, from their own wallet
  const lose = await fetch(`${SIGNER}/${LOSER}`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'eth_sendTransaction', params: [{ to: ESCROW, data: '0xbd66528a' + escId.replace(/^0x/, '') }] }) }).then(r => r.json());
  console.log('loser tries to claim the same pot ->', lose.error ? 'REFUSED (' + lose.error.split('\n')[0].slice(0, 80) + ')' : 'WENT THROUGH: ' + lose.result);

  const got = after[WINNER] - before[WINNER], lost = before[LOSER] - after[LOSER], cutLeft = after.e - before.e;
  console.log('\n--- what moved ---');
  console.log(`winner ${WINNER.toUpperCase()}: ${got >= 0 ? '+' : ''}${got.toFixed(6)} USDC   (expected +${(due - stake).toFixed(6)}: staked ${stake}, claimed ${due.toFixed(2)})`);
  console.log(`loser  ${LOSER.toUpperCase()}: -${lost.toFixed(6)} USDC   (expected -${stake.toFixed(6)})`);
  console.log(`house cut held in the escrow for the treasury: +${cutLeft.toFixed(6)} USDC   (expected +${cut.toFixed(6)} = 5%)`);
  const ok = Math.abs(got - (due - stake)) < 1e-6 && Math.abs(lost - stake) < 1e-6 && Math.abs(cutLeft - cut) < 1e-6 && res.winner != null && !!lose.error;
  console.log(ok ? 'PASS: the winner was paid, the loser paid, the cut is 5%, and the loser could not claim' : 'FAIL: the money did not move as expected');
  cleanup();
  process.exit(ok ? 0 : 1);
})().catch(async e => { console.log('FAIL', e.message); cleanup(); process.exit(1); });
