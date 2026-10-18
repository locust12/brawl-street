// A stablecoin wager between two players on opposite sides of the world, end to end, headless.
//
// Duane, 2026-10-18: *"test the betting system. accept fight and bet from a different location"*.
// The money path had only ever been proven with both players on the same machine at 0 ms
// (test/escrow_e2e.js) or through two browsers on this desk (test/wager_browser_duo.mjs). Neither
// answers the question that matters on launch night: when the two wallets are 250 ms apart and one
// of them is on a line that jitters, does the pot still open, fund, fight, settle and pay out?
//
// Everything that can go wrong with distance is in here on purpose:
//   - the signature is produced on the laggy side, so a slow `wallet` round trip cannot break it;
//   - the deposits land in the opposite order to the seats;
//   - the fight itself runs over both links, with the full fight engine on each side, so a desync
//     caused by lag would be caught rather than averaged away;
//   - the claim is made from the laggy side too.
//
// It runs on a PRIVATE anvil chain against the same contract that is deployed on Arbitrum
// (BrawlEscrowToken) and a 6-decimal mock stablecoin, so it is deterministic and needs no network.
//
//   node test/wager_crosslocation.js
//   node test/wager_crosslocation.js --a 238 --b 90        # Thailand vs US East, round trips in ms
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { createPublicClient, createWalletClient, http, defineChain } = require('viem');
const { mnemonicToAccount } = require('viem/accounts');
const { Bot } = require('./bot');

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };

const RTT_A = +arg('a', 238);            // Thailand -> Germany, measured from this desk
const RTT_B = +arg('b', 90);             // US East -> Germany
const JIT_A = +arg('jita', 14);
const JIT_B = +arg('jitb', 8);
const STAKE = +arg('stake', 5);          // whole USDC a side
const CUT_BPS = 500n;                    // 5%, as deployed

const ANVIL = process.env.ANVIL || path.join(os.homedir(), '.foundry/bin/anvil');
const MNEMONIC = 'test test test test test test test test test test test junk';
const acct = i => mnemonicToAccount(MNEMONIC, { addressIndex: i });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const procs = [];
const outDir = path.join(__dirname, '..', '..', 'chain', 'out');
const ESC = JSON.parse(fs.readFileSync(path.join(outDir, 'BrawlEscrowToken.sol', 'BrawlEscrowToken.json'), 'utf8'));
const TOK = JSON.parse(fs.readFileSync(path.join(outDir, 'BrawlEscrowToken.t.sol', 'MockERC20.json'), 'utf8'));
const u6 = n => BigInt(Math.round(n * 1e6));
const fmt = v => (Number(v) / 1e6).toFixed(6);

const problems = [];
const note = (cond, msg) => { if (!cond) problems.push(msg); return cond; };

(async () => {
  const port = 18545 + crypto.randomInt(2000), rpc = `http://127.0.0.1:${port}`;
  procs.push(spawn(ANVIL, ['--port', String(port), '--chain-id', '4663', '--silent'], { stdio: 'ignore' }));
  const chain = defineChain({ id: 4663, name: 'local anvil', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
  const pub = createPublicClient({ chain, transport: http(rpc) });
  for (let i = 0; i < 60; i++) { try { await pub.getBlockNumber(); break; } catch (e) { await sleep(200); } }
  const [owner, operator, treasury, alice, bob] = [0, 1, 2, 3, 4].map(acct);
  const wc = a => createWalletClient({ chain, transport: http(rpc), account: a });
  const rcpt = hash => pub.waitForTransactionReceipt({ hash });

  // a 6-decimal stablecoin, the shape of real USDC on Arbitrum
  const tok = (await rcpt(await wc(owner).deployContract({ abi: TOK.abi, bytecode: TOK.bytecode.object, args: [6] }))).contractAddress;
  const escrow = (await rcpt(await wc(owner).deployContract({ abi: ESC.abi, bytecode: ESC.bytecode.object, args: [owner.address, operator.address, treasury.address, Number(CUT_BPS)] }))).contractAddress;
  await rcpt(await wc(owner).writeContract({ address: escrow, abi: ESC.abi, functionName: 'setToken', args: [tok, true] }));
  for (const who of [alice, bob]) await rcpt(await wc(owner).writeContract({ address: tok, abi: TOK.abi, functionName: 'mint', args: [who.address, u6(1000)] }));
  console.log(`chain 4663 on ${rpc}\n  escrow ${escrow}  token ${tok} (6dp)  cut ${Number(CUT_BPS) / 100}%`);

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-xloc-'));
  const sport = 21000 + crypto.randomInt(20000);
  procs.push(spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: Object.assign({}, process.env, {
      PORT: String(sport), HOST: '127.0.0.1', DATA_DIR: dataDir, START_DELAY_MS: '800', QUIET: process.env.VERBOSE ? '0' : '1',
      REAL_MONEY: '1', CHAIN_RPC: rpc, CHAIN_ID: '4663', ESCROW_ADDRESS: escrow, CHAIN_NAME: 'Local anvil',
      ESCROW_TOKEN: tok, ESCROW_TOKEN_SYMBOL: 'USDC', ESCROW_TOKEN_DECIMALS: '6',
      OPERATOR_KEY: '0x' + Buffer.from(operator.getHdKey().privateKey).toString('hex'),
      REAL_STAKES: '1,5,10,25', FUND_WINDOW_S: '90',
      // both seats are 127.0.0.1 here, which production refuses for a money room on purpose
      SAME_IP_OK: '1', NEW_ACCT_PER_IP: '100000', NEW_ACCT_GLOBAL: '1000000',
      FUND_DEBOUNCE_MS: '200', FUND_PER_ACCT: '1000', MAX_FUNDING: '50',
    }),
    stdio: ['ignore', 'inherit', 'inherit'],
  }));
  const base = `http://127.0.0.1:${sport}`, url = `ws://127.0.0.1:${sport}/ws`;
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/healthz')).ok) break; } catch (e) { /* starting */ } await sleep(150); }

  // one-way delay is half the round trip, applied to both legs of each socket
  const link = (rtt, jit) => ({ lat: Math.round(rtt / 2), jit: Math.round(jit / 2) });
  const A = new Bot('Thailand-' + RTT_A + 'ms', url, link(RTT_A, JIT_A));
  const B = new Bot('Remote-' + RTT_B + 'ms', url, link(RTT_B, JIT_B));
  for (const b of [A, B]) { await b.connect(); await b.until(m => m.k === 'welcome', 30000, 'welcome'); }
  note(A.me.real && A.me.real.token, 'server did not announce a token escrow');
  note(A.me.real && A.me.real.cutBps === Number(CUT_BPS), 'server reports cutBps ' + (A.me.real || {}).cutBps + ', chain says ' + CUT_BPS);
  console.log(`  server real-money: token ${(A.me.real || {}).tokenSymbol} cutBps ${(A.me.real || {}).cutBps} stakes ${JSON.stringify((A.me.real || {}).stakes)}`);

  // ---- the laggy side opens the room and the other side accepts from its own location
  A.raw({ k: 'create', size: 2, stake: STAKE, real: true, stocks: 1, stage: 'moon' });
  const roomA = await A.until(m => m.k === 'room', 30000, 'room');
  note(roomA.real === true, 'room did not open in real-money mode');
  console.log(`  room ${roomA.code} opened from ${A.name}, stake ${STAKE} USDC a side`);

  const sign = async (who, r) => {
    const text = `Brawl Street online\nRoom ${r.code}\nPlayer ${r.you}\nNonce ${r.nonce}`;
    return who.signMessage({ message: text });
  };
  A.raw({ k: 'wallet', addr: alice.address, sig: await sign(alice, roomA) });
  const aBound = await A.until(m => m.k === 'room' && m.members.some(x => x.id === roomA.you && x.wallet), 30000, 'A wallet bound').catch(() => null);
  note(!!aBound, 'the far player could not bind a wallet');

  B.raw({ k: 'join', code: roomA.code });
  const roomB = await B.until(m => m.k === 'room' && m.members.length === 2, 30000, 'B joined');
  B.raw({ k: 'wallet', addr: bob.address, sig: await sign(bob, roomB) });
  note(!!(await B.until(m => m.k === 'room' && m.members.some(x => x.id === roomB.you && x.wallet), 30000, 'B wallet bound').catch(() => null)),
    'the accepting player could not bind a wallet');
  console.log(`  ${B.name} accepted the fight and bound its wallet`);

  const bal = a => pub.readContract({ address: tok, abi: TOK.abi, functionName: 'balanceOf', args: [a.address] });
  const before = { a: await bal(alice), b: await bal(bob) };

  A.raw({ k: 'pick', char: 'pepe' }); B.raw({ k: 'pick', char: 'doge' });
  A.raw({ k: 'ready', on: true }); B.raw({ k: 'ready', on: true });
  const fa = await A.until(m => m.k === 'fund', 60000, 'fund A'), fb = await B.until(m => m.k === 'fund', 60000, 'fund B');
  note(fa.id === fb.id, 'the two sides were given different match ids');
  note(fa.token && fa.token.toLowerCase() === tok.toLowerCase(), 'fund message names the wrong token');
  note(BigInt(fa.stakeWei) === u6(STAKE), `fund message asks for ${fa.stakeWei}, expected ${u6(STAKE)}`);
  console.log(`  match ${fa.id.slice(0, 10)} opened on chain, both asked for ${fmt(BigInt(fa.stakeWei))} ${fa.tokenSymbol}`);

  // approve then deposit, the accepting side first: the order deposits arrive in must not matter
  const erc = async (who, fn, as) => rcpt(await wc(who).writeContract({ address: tok, abi: TOK.abi, functionName: fn, args: as }));
  const esc = async (who, fn, as) => rcpt(await wc(who).writeContract({ address: escrow, abi: ESC.abi, functionName: fn, args: as }));
  await erc(bob, 'approve', [escrow, u6(STAKE)]);
  await esc(bob, 'deposit', [fb.id]);
  await erc(alice, 'approve', [escrow, u6(STAKE)]);
  await esc(alice, 'deposit', [fa.id]);

  const startA = await A.until(m => m.k === 'start', 60000, 'start after funding');
  const startB = await B.until(m => m.k === 'start', 60000, 'start after funding B');
  note(startA.id === startB.id, 'the two sides started different matches');
  console.log(`  both deposits in; fight started with input delay ${startA.delay}f / ${startB.delay}f`);

  const ra = await A.until(m => m.k === 'result', 300000, 'result A');
  const rb = await B.until(m => m.k === 'result', 300000, 'result B');
  note(ra.winner === rb.winner, 'the two sides disagree about who won');
  note(!A.desyncs.length && !B.desyncs.length, `desync over the laggy links: A ${A.desyncs.length} B ${B.desyncs.length}`);
  const winner = ra.payee === A.lock.me ? { bot: A, w: alice, l: bob } : { bot: B, w: bob, l: alice };
  note(!!(ra.real && ra.real.claim && ra.real.claim.toLowerCase() === winner.w.address.toLowerCase()), 'the result names the wrong wallet to claim');
  console.log(`  ${winner.bot.name} won by ${ra.reason} after ${ra.ticks} ticks; stalls A ${Math.round(A.lock.stallMs || 0)}ms B ${Math.round(B.lock.stallMs || 0)}ms`);

  let m = null;
  for (let i = 0; i < 90; i++) { m = await pub.readContract({ address: escrow, abi: ESC.abi, functionName: 'getMatch', args: [fa.id] }); if (Number(m.status) === 3) break; await sleep(500); }
  note(Number(m.status) === 3, 'the match never reached Settled on chain, status ' + (m && m.status));
  note(m.winner.toLowerCase() === winner.w.address.toLowerCase(), 'the chain names a different winner than the fight did');
  note(m.replayHash === ra.replay, 'the replay hash on chain is not the one the server reported');
  const replayFile = await (await fetch(base + '/api/replay/' + ra.id)).text();
  note('0x' + crypto.createHash('sha256').update(replayFile).digest('hex') === m.replayHash, 'the replay file does not hash to the on-chain replayHash');

  await esc(winner.w, 'claim', [fa.id]);
  const after = { a: await bal(alice), b: await bal(bob) };
  const pot = u6(STAKE) * 2n, cut = (pot * CUT_BPS) / 10000n, paid = pot - cut;
  const wantW = u6(1000) - u6(STAKE) + paid, wantL = u6(1000) - u6(STAKE);
  const gotW = winner.w === alice ? after.a : after.b, gotL = winner.w === alice ? after.b : after.a;
  note(gotW === wantW, `winner holds ${fmt(gotW)}, expected ${fmt(wantW)}`);
  note(gotL === wantL, `loser holds ${fmt(gotL)}, expected ${fmt(wantL)}`);
  const held = await pub.readContract({ address: escrow, abi: ESC.abi, functionName: 'cutBalance', args: [tok] });
  note(held === cut, `escrow holds ${fmt(held)} as the cut, expected ${fmt(cut)}`);
  const stuck = await pub.readContract({ address: tok, abi: TOK.abi, functionName: 'balanceOf', args: [escrow] });
  note(stuck === cut, `escrow still holds ${fmt(stuck)}, only the ${fmt(cut)} cut should remain`);

  console.log('\n' + JSON.stringify({
    scenario: `USDC wager across locations (${RTT_A}ms vs ${RTT_B}ms)`,
    ok: !problems.length,
    stake: STAKE, pot: fmt(pot), cut: fmt(cut), winnerPaid: fmt(paid),
    winner: winner.bot.name, reason: ra.reason, ticks: ra.ticks,
    inputDelayFrames: [startA.delay, startB.delay],
    rttMeasured: [Math.round(A.rtt), Math.round(B.rtt)],
    desyncs: A.desyncs.length + B.desyncs.length,
    problems,
  }, null, 1));

  A.close(); B.close();
  for (const p of procs) { try { p.kill(); } catch (e) { /* gone */ } }
  await sleep(300);
  process.exit(problems.length ? 1 : 0);
})().catch(e => {
  console.error('cross-location wager test died:', e && e.message);
  for (const p of procs) { try { p.kill(); } catch (x) { /* gone */ } }
  process.exit(3);
});
