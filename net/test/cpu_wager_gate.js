// THE CPU RULE: a wagered match is players only.
//
// Duane, 2026-10-14: *"ohhh if cpu is playing dont make wagering work"* ... *"but u should be able
// to do 4 players fighting eachother"*. So the rule has two halves and this test checks both:
//   1. a real-money 4-player room must REFUSE to start while any seat is empty, because the empty
//      seats were previously handed to bots -- a pot partly fought by the server is not a wager;
//   2. the same room with four real people in it must fund and launch normally.
// Both halves run against a real BrawlEscrow on a private anvil chain, through the real server.
//   node test/cpu_wager_gate.js
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { createPublicClient, createWalletClient, http, defineChain } = require('viem');
const { mnemonicToAccount } = require('viem/accounts');
const { Bot } = require('./bot');

const ANVIL = process.env.ANVIL || path.join(os.homedir(), '.foundry/bin/anvil');
const MNEMONIC = 'test test test test test test test test test test test junk';
const acct = i => mnemonicToAccount(MNEMONIC, { addressIndex: i });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const procs = [];
const art = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'chain', 'out', 'BrawlEscrow.sol', 'BrawlEscrow.json'), 'utf8'));

const problems = [];
const ok = (cond, what) => { console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${what}`); if (!cond) problems.push(what); };

(async () => {
  const chainPort = 18545 + crypto.randomInt(2000), rpc = `http://127.0.0.1:${chainPort}`;
  procs.push(spawn(ANVIL, ['--port', String(chainPort), '--chain-id', '4663', '--silent'], { stdio: 'ignore' }));
  const chain = defineChain({ id: 4663, name: 'local anvil', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
  const pub = createPublicClient({ chain, transport: http(rpc) });
  for (let i = 0; i < 60; i++) { try { await pub.getBlockNumber(); break; } catch (e) { await sleep(200); } }

  const [owner, operator, treasury] = [0, 1, 2].map(acct);
  const players = [3, 4, 5, 6].map(acct);
  const wc = a => createWalletClient({ chain, transport: http(rpc), account: a });
  const hash = await wc(owner).deployContract({ abi: art.abi, bytecode: art.bytecode.object, args: [owner.address, operator.address, treasury.address, 0] });
  const escrow = (await pub.waitForTransactionReceipt({ hash })).contractAddress;

  const port = 21000 + crypto.randomInt(20000);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-cpu-'));
  procs.push(spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: Object.assign({}, process.env, { PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, START_DELAY_MS: '600',
      QUIET: process.env.VERBOSE ? '0' : '1', REAL_MONEY: '1', CHAIN_RPC: rpc, CHAIN_ID: '4663', ESCROW_ADDRESS: escrow,
      OPERATOR_KEY: '0x' + Buffer.from(operator.getHdKey().privateKey).toString('hex'), CHAIN_NAME: 'Local anvil',
      FUND_WINDOW_S: '60', REAL_STAKES: '0.01,0.05', SAME_IP_OK: '1', NEW_ACCT_PER_IP: '100000', NEW_ACCT_GLOBAL: '1000000',
      FUND_DEBOUNCE_MS: '200', FUND_PER_ACCT: '1000', MAX_FUNDING: '50' }),
    stdio: ['ignore', 'inherit', 'inherit'] }));
  const base = `http://127.0.0.1:${port}`, url = `ws://127.0.0.1:${port}/ws`;
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/healthz')).ok) break; } catch (e) {} await sleep(150); }

  // every message each bot ever sees, so "nothing arrived" is a claim I can actually check
  const seen = new Map();
  async function seat(name, a, code) {
    const b = new Bot(name, url); await b.connect(); await b.until(m => m.k === 'welcome', 10000, 'welcome');
    const log = []; seen.set(b, log);
    b.ws.on('message', d => { try { log.push(JSON.parse(d.toString())); } catch (e) {} });
    if (code) b.raw({ k: 'join', code });
    else b.raw({ k: 'create', size: 4, stake: 0.01, real: true, stocks: 3, items: true, stage: 'random' });
    const r = await b.until(m => m.k === 'room', 10000, 'room');
    const msg = `Brawl Street online\nRoom ${r.code}\nPlayer ${r.you}\nNonce ${r.nonce}`;
    b.raw({ k: 'wallet', addr: a.address, sig: await a.signMessage({ message: msg }) });
    await b.until(m => m.k === 'room' && m.members.find(x => x.id === r.you && x.wallet), 10000, 'wallet bound');
    b.room = r; b.acct = a;
    return b;
  }
  const had = (b, f) => (seen.get(b) || []).some(f);

  console.log('\nA wagered 4-player room must never be filled with CPUs');
  const A = await seat('Alice', players[0], null);
  const code = A.room.code;
  ok(A.room.real === true, 'the room is a real-money room');
  ok(A.room.size === 4, 'the room seats 4');
  ok(A.room.cpuFill === false, 'cpuFill is OFF on a wagered room, without anyone asking');

  // the host tries to turn it on anyway, the way a tampered client would
  A.raw({ k: 'set', cpuFill: true });
  await sleep(400);
  const after = (seen.get(A) || []).filter(m => m.k === 'room').pop();
  ok(after && after.cpuFill === false, 'the server refuses to turn cpuFill on for a wagered room');
  ok(had(A, m => m.k === 'err' && m.code === 'cpu'), 'and says why');

  console.log('\nTwo players in a four-seat money room cannot start it');
  const B = await seat('Bob', players[1], code);
  A.raw({ k: 'ready', on: true }); B.raw({ k: 'ready', on: true });
  await sleep(600);
  A.raw({ k: 'start' });                      // host force-start, the path that used to seat bots
  await sleep(2500);
  ok(had(A, m => m.k === 'err' && m.code === 'seats'), 'the start is refused: seats still open');
  ok(!had(A, m => m.k === 'fund'), 'no funding was requested from Alice');
  ok(!had(B, m => m.k === 'fund'), 'no funding was requested from Bob');
  ok(!had(A, m => m.k === 'start'), 'and no match launched');

  console.log('\nFour real players in the same room DO get to wager');
  const C = await seat('Carol', players[2], code);
  const D = await seat('Dave', players[3], code);
  for (const b of [A, B, C, D]) b.raw({ k: 'ready', on: true });
  const funds = await Promise.all([A, B, C, D].map(b => b.until(m => m.k === 'fund', 25000, 'fund ' + b.name).catch(() => null)));
  ok(funds.every(Boolean), 'all four players are asked to deposit');
  const stakes = funds.filter(Boolean).map(f => f.stakeWei || f.stake);
  ok(new Set(stakes.map(String)).size === 1, 'all four are asked for the same stake');

  for (const b of [A, B, C, D]) {
    const f = funds[[A, B, C, D].indexOf(b)]; if (!f) continue;
    const h = await wc(b.acct).writeContract({ address: escrow, abi: art.abi, functionName: 'deposit', args: [f.id], value: BigInt(f.stakeWei) });
    await pub.waitForTransactionReceipt({ hash: h });
  }
  const started = await A.until(m => m.k === 'start', 40000, 'start').catch(() => null);
  ok(!!started, 'the match launches once all four have deposited');
  if (started) {
    const cpus = started.cfg.players.filter(p => p.cpu).length;
    ok(started.cfg.players.length === 4, 'four fighters are in the match');
    ok(cpus === 0, 'NONE of them is a CPU');
    ok(started.names.length === 4 && !started.names.includes('CPU'), 'no seat is named CPU');
  }

  console.log(problems.length ? `\n${problems.length} FAILED:\n  ` + problems.join('\n  ') : '\nall checks passed');
  for (const p of procs) { try { p.kill(); } catch (e) {} }
  process.exit(problems.length ? 1 : 0);
})().catch(e => { console.error(e); for (const p of procs) { try { p.kill(); } catch (e2) {} } process.exit(1); });
