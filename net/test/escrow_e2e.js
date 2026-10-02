// Real-ETH mode, end to end, on a PRIVATE local anvil chain only (never a real network):
// deploys BrawlEscrow, starts the game server with REAL_MONEY=1 pointed at anvil, then two simulated
// players bind wallets (signed message), deposit, play a full match, and the winner claims.
// Also checks the refund path when one player never deposits.
//   node test/escrow_e2e.js
// Accounts come from anvil's public test mnemonic; they hold play money on the throwaway chain only.
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { createPublicClient, createWalletClient, http, defineChain, parseEther, formatEther } = require('viem');
const { mnemonicToAccount } = require('viem/accounts');
const { Bot } = require('./bot');

const ANVIL = process.env.ANVIL || path.join(os.homedir(), '.foundry/bin/anvil');
const MNEMONIC = 'test test test test test test test test test test test junk';   // anvil's built-in dev mnemonic
const acct = i => mnemonicToAccount(MNEMONIC, { addressIndex: i });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const procs = [];
const art = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'chain', 'out', 'BrawlEscrow.sol', 'BrawlEscrow.json'), 'utf8'));
const ABI = art.abi;

(async () => {
  const chainPort = 18545 + crypto.randomInt(2000), rpc = `http://127.0.0.1:${chainPort}`;
  const anvil = spawn(ANVIL, ['--port', String(chainPort), '--chain-id', '4663', '--silent'], { stdio: 'ignore' }); procs.push(anvil);
  const chain = defineChain({ id: 4663, name: 'local anvil', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
  const pub = createPublicClient({ chain, transport: http(rpc) });
  for (let i = 0; i < 50; i++) { try { await pub.getBlockNumber(); break; } catch (e) { await sleep(200); } }
  const [owner, operator, treasury, alice, bob] = [0, 1, 2, 3, 4].map(acct);
  const wc = a => createWalletClient({ chain, transport: http(rpc), account: a });
  const hash = await wc(owner).deployContract({ abi: ABI, bytecode: art.bytecode.object, args: [owner.address, operator.address, treasury.address, 0] });
  const escrow = (await pub.waitForTransactionReceipt({ hash })).contractAddress;
  console.log('escrow deployed on local anvil', escrow);

  const port = 21000 + crypto.randomInt(20000);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-esc-'));
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: Object.assign({}, process.env, { PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, START_DELAY_MS: '600', QUIET: process.env.VERBOSE ? '0' : '1',
      REAL_MONEY: '1', CHAIN_RPC: rpc, CHAIN_ID: '4663', ESCROW_ADDRESS: escrow, OPERATOR_KEY: '0x' + Buffer.from(operator.getHdKey().privateKey).toString('hex'),
      CHAIN_NAME: 'Local anvil', FUND_WINDOW_S: '30', REAL_STAKES: '0.01,0.05',
      // Both simulated players come from 127.0.0.1, which a real-ETH room refuses in production
      // (one person must not be able to hold both seats). Allowed here only.
      // Both simulated players are 127.0.0.1, so the production anti-flood budgets would throttle
      // the test itself. FUND_DEBOUNCE_MS is dropped to keep the run quick; MAX_FUNDING and
      // FUND_PER_ACCT are the H5 funding-flood limits added on 9/21 and would bite a repeat run.
      SAME_IP_OK: '1', NEW_ACCT_PER_IP: '100000', NEW_ACCT_GLOBAL: '1000000',
      FUND_DEBOUNCE_MS: '200', FUND_PER_ACCT: '1000', MAX_FUNDING: '50' }),
    stdio: ['ignore', 'inherit', 'inherit'] });
  procs.push(srv);
  const base = `http://127.0.0.1:${port}`, url = `ws://127.0.0.1:${port}/ws`;
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/healthz')).ok) break; } catch (e) { /* starting */ } await sleep(150); }

  const problems = [];
  const bal = a => pub.getBalance({ address: a.address });
  const tx = async (a, fn, args, value) => {
    const h = await wc(a).writeContract({ address: escrow, abi: ABI, functionName: fn, args, value });
    const rc = await pub.waitForTransactionReceipt({ hash: h });
    return rc.gasUsed * rc.effectiveGasPrice;
  };
  async function seat(name, a, room) {
    const b = new Bot(name, url); await b.connect(); await b.until(m => m.k === 'welcome', 10000, 'welcome');
    if (!b.me.real) throw new Error('server did not announce real-money mode');
    if (room) { b.raw({ k: 'join', code: room }); }
    const r = await b.until(m => m.k === 'room', 10000, 'room');
    const msg = `Brawlstreet online\nRoom ${r.code}\nPlayer ${r.you}\nNonce ${r.nonce}`;
    b.raw({ k: 'wallet', addr: a.address, sig: await a.signMessage({ message: msg }) });
    await b.until(m => m.k === 'room' && m.members.find(x => x.id === r.you && x.wallet), 10000, 'wallet bound');
    b.acct = a;
    return b;
  }

  // ---- 1) full match: deposit, fight, server reports the replay-verified winner, winner claims
  {
    const A0 = new Bot('Alice', url); await A0.connect(); await A0.until(m => m.k === 'welcome', 10000, 'welcome');
    A0.raw({ k: 'create', size: 2, stake: 0.01, real: true, stocks: 1, stage: 'moon' });
    const room = await A0.until(m => m.k === 'room', 10000, 'room');
    const msg = `Brawlstreet online\nRoom ${room.code}\nPlayer ${room.you}\nNonce ${room.nonce}`;
    A0.raw({ k: 'wallet', addr: alice.address, sig: await alice.signMessage({ message: msg }) });
    await A0.until(m => m.k === 'room' && m.members.find(x => x.id === room.you && x.wallet), 10000, 'alice wallet');
    const B0 = await seat('Bob', bob, room.code);
    const before = { a: await bal(alice), b: await bal(bob) };
    A0.raw({ k: 'pick', char: 'pepe' }); B0.raw({ k: 'pick', char: 'doge' });
    A0.raw({ k: 'ready', on: true }); B0.raw({ k: 'ready', on: true });
    const fa = await A0.until(m => m.k === 'fund', 30000, 'fund'), fb = await B0.until(m => m.k === 'fund', 30000, 'fund');
    if (fa.id !== fb.id || fa.escrow.toLowerCase() !== escrow.toLowerCase()) problems.push('fund messages disagree');
    const gas = { a: await tx(alice, 'deposit', [fa.id], BigInt(fa.stakeWei)), b: await tx(bob, 'deposit', [fb.id], BigInt(fb.stakeWei)) };
    await A0.until(m => m.k === 'start', 30000, 'start after funding');
    const ra = await A0.until(m => m.k === 'result', 240000, 'result'); const rb = await B0.until(m => m.k === 'result', 240000, 'result');
    if (ra.winner !== rb.winner) problems.push('players got different results');
    const winnerBot = ra.payee === A0.lock.me ? A0 : B0, loserBot = winnerBot === A0 ? B0 : A0;
    const winAcct = winnerBot === A0 ? alice : bob;
    if (!ra.real || ra.real.claim.toLowerCase() !== winAcct.address.toLowerCase()) problems.push('result does not name the winner wallet');
    // the server reports asynchronously: wait until the chain says Settled
    let m = null;
    for (let i = 0; i < 60; i++) { m = await pub.readContract({ address: escrow, abi: ABI, functionName: 'getMatch', args: [fa.id] }); if (Number(m.status) === 3) break; await sleep(500); }
    if (Number(m.status) !== 3) problems.push('match not settled on chain, status ' + m.status);
    if (m.winner.toLowerCase() !== winAcct.address.toLowerCase()) problems.push('chain winner differs from replay winner');
    if (m.replayHash !== ra.replay) problems.push('replay hash on chain differs from the server result');
    const replayFile = await (await fetch(base + '/api/replay/' + ra.id)).text();
    if ('0x' + crypto.createHash('sha256').update(replayFile).digest('hex') !== m.replayHash) problems.push('replay file does not hash to the on-chain replayHash');
    const claimGas = await tx(winAcct, 'claim', [fa.id]);
    const after = { a: await bal(alice), b: await bal(bob) };
    const stake = parseEther('0.01');
    const wantA = before.a - gas.a - stake + (winAcct === alice ? 2n * stake - claimGas : 0n);
    const wantB = before.b - gas.b - stake + (winAcct === bob ? 2n * stake - claimGas : 0n);
    if (after.a !== wantA || after.b !== wantB) problems.push('balances off: alice ' + formatEther(after.a - wantA) + ' bob ' + formatEther(after.b - wantB));
    if (await pub.getBalance({ address: escrow }) !== 0n) problems.push('escrow still holds ETH');
    console.log(JSON.stringify({ scenario: 'real ETH 1v1: deposit, fight, report, claim', ok: !problems.length, winner: winnerBot.name, reason: ra.reason, ticks: ra.ticks,
      pot: formatEther(2n * stake), settledReplay: m.replayHash.slice(0, 18), problems }));
    A0.close(); B0.close(); loserBot.close();
  }

  // ---- 2) one player never deposits: the server cancels after the window, the depositor is refunded
  {
    const p2 = [];
    const A1 = new Bot('Alice2', url); await A1.connect(); await A1.until(m => m.k === 'welcome', 10000, 'welcome');
    A1.raw({ k: 'create', size: 2, stake: 0.05, real: true, stocks: 1 });
    const room = await A1.until(m => m.k === 'room', 10000, 'room');
    A1.raw({ k: 'wallet', addr: alice.address, sig: await alice.signMessage({ message: `Brawlstreet online\nRoom ${room.code}\nPlayer ${room.you}\nNonce ${room.nonce}` }) });
    await A1.until(m => m.k === 'room' && m.members.find(x => x.id === room.you && x.wallet), 10000, 'wallet');
    const B1 = await seat('Bob2', bob, room.code);
    A1.raw({ k: 'ready', on: true }); B1.raw({ k: 'ready', on: true });
    const f = await A1.until(m => m.k === 'fund', 30000, 'fund');
    const before = await bal(alice);
    const g1 = await tx(alice, 'deposit', [f.id], BigInt(f.stakeWei));
    const fail = await A1.until(m => m.k === 'fundfail', 60000, 'fundfail');
    let st = 0; for (let i = 0; i < 40; i++) { st = Number((await pub.readContract({ address: escrow, abi: ABI, functionName: 'getMatch', args: [f.id] })).status); if (st === 4) break; await sleep(500); }
    if (st !== 4) p2.push('match not cancelled on chain, status ' + st);
    const g2 = await tx(alice, 'refund', [f.id]);
    if (await bal(alice) !== before - g1 - g2) p2.push('refund did not return the stake');
    if (await pub.getBalance({ address: escrow }) !== 0n) p2.push('escrow still holds ETH');
    console.log(JSON.stringify({ scenario: 'real ETH: missing deposit -> cancel -> refund', ok: !p2.length, msg: fail.msg, problems: p2 }));
    problems.push(...p2);
    A1.close(); B1.close();
  }
  for (const p of procs) p.kill('SIGTERM');
  setTimeout(() => process.exit(problems.length ? 1 : 0), 400);
})().catch(e => { console.log('FAIL', e.stack || e.message); for (const p of procs) p.kill('SIGTERM'); setTimeout(() => process.exit(1), 300); });
