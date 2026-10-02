// End-to-end on a private anvil chain (no fork, nothing public): deploy arena + demo tokens,
// run the real operator, bet from 5 wallets in ETH / USDC / REKT, then check every claim against
// an independent payout calc, the cut routing, and the replay checker.
// usage: node test/e2e_local.js [rounds=2]   (leaves anvil running if KEEP=1, for the browser test)
const { spawn, execFileSync } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const { createPublicClient, createWalletClient, http, parseEther, parseUnits, formatUnits, erc20Abi, defineChain } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const ABI = require('../../chain/abi/RektArena.json');
const { verify } = require('../verify.js');

const RPC = 'http://127.0.0.1:8545', ROUNDS = +(process.argv[2] || 2);
// anvil's well-known public dev keys (test only, hold nothing real)
const KEYS = ['0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a', '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
  '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a', '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba',
  '0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e'];
const acct = KEYS.map(k => privateKeyToAccount(k));
const chain = defineChain({ id: 31337, name: 'anvil', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const pub = createPublicClient({ chain, transport: http(RPC), pollingInterval: 250 });
const wallet = i => createWalletClient({ chain, account: acct[i], transport: http(RPC) });
const sleep = s => new Promise(r => setTimeout(r, s * 1000));
const ZERO = '0x0000000000000000000000000000000000000000', DEAD = '0x000000000000000000000000000000000000dEaD';
const fails = []; const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails.push(msg); };

(async () => {
  const anvil = spawn(path.join(os.homedir(), '.foundry/bin/anvil'), ['--port', '8545', '--block-time', '1', '--silent'], { stdio: 'ignore' });
  let op;
  const stop = () => { try { op && op.kill(); } catch { } if (!process.env.KEEP) try { anvil.kill(); } catch { } };
  try {
    for (let i = 0; i < 50; i++) { try { await pub.getBlockNumber(); break; } catch { await sleep(0.2); } }
    const out = execFileSync(path.join(os.homedir(), '.foundry/bin/forge'), ['script', 'script/LocalDemo.s.sol:LocalDemo', '--rpc-url', RPC, '--broadcast', '--private-key', KEYS[0]], {
      cwd: path.join(__dirname, '../../chain'), encoding: 'utf8',
      env: { ...process.env, OPERATOR: acct[1].address, CUT_BPS: '500', BETTORS: acct.slice(2).map(a => a.address).join(',') } });
    const addr = k => out.match(new RegExp(k + '\\s+(0x[0-9a-fA-F]{40})'))[1];
    const ARENA = addr('ARENA'), USDC = addr('USDC'), REKT = addr('REKT');
    fs.writeFileSync(path.join(__dirname, 'local_deploy.json'), JSON.stringify({ rpc: RPC, chainId: 31337, arena: ARENA, tokens: { ETH: ZERO, USDC, REKT }, decimals: { ETH: 18, USDC: 6, REKT: 18 } }, null, 1));
    console.log('deployed arena', ARENA, 'USDC', USDC, 'REKT', REKT);

    const read = (fn, args = []) => pub.readContract({ address: ARENA, abi: ABI, functionName: fn, args });
    const tok = { ETH: ZERO, USDC, REKT }, dec = { ETH: 18, USDC: 6, REKT: 18 };
    const bal = async (c, who) => c === 'ETH' ? pub.getBalance({ address: who }) : pub.readContract({ address: tok[c], abi: erc20Abi, functionName: 'balanceOf', args: [who] });
    for (let i = 2; i < 7; i++) for (const c of ['USDC', 'REKT']) await pub.waitForTransactionReceipt({ hash: await wallet(i).writeContract({ address: tok[c], abi: erc20Abi, functionName: 'approve', args: [ARENA, 2n ** 255n] }) });

    op = spawn(process.execPath, [path.join(__dirname, '../operator.js')], { stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, RPC_URL: RPC, ARENA, OPERATOR_KEY: KEYS[1], CHAIN_ID: '31337', BET_SECS: process.env.BET_SECS || '25', GAP_SECS: '2', TOKENS: USDC + ',' + REKT, SEED_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'seeds-')) } });
    op.stdout.on('data', d => process.stdout.write('  [operator] ' + d)); op.stderr.on('data', d => process.stdout.write('  [operator!] ' + d));
    if (process.env.KEEP) { console.log('KEEP=1: anvil + operator running for the browser test'); await sleep(+process.env.KEEP); return; }


    let last = 0;
    for (let n = 1; n <= ROUNDS; n++) {
      let r, round; for (;;) { round = Number(await read('nextRoundId')) - 1; if (round > last) { r = await read('getRound', [BigInt(round)]); if (r.status === 1 && Number(r.lockTime) - Date.now() / 1000 > 15) break; } await sleep(0.5); }
      last = round;
      console.log(`round ${round} open: fighters ${r.fighterA} vs ${r.fighterB}`);
      const bets = [];
      for (let i = 2; i < 7; i++) for (let k = 0; k < 2; k++) {
        const c = ['ETH', 'USDC', 'REKT'][(i + k + round) % 3], side = 1 + ((i * 7 + k * 3 + round) % 2);
        const amt = c === 'ETH' ? parseEther((0.01 * (i + k)).toFixed(3)) : c === 'USDC' ? parseUnits(String(5 * (i + 2 * k)), 6) : parseUnits(String(1000 * (i + k) ** 2), 18);
        const w = wallet(i), args = c === 'ETH' ? { functionName: 'bet', args: [BigInt(round), side], value: amt } : { functionName: 'betToken', args: [BigInt(round), side, tok[c], amt] };
        const h = await w.writeContract({ address: ARENA, abi: ABI, ...args });
        await pub.waitForTransactionReceipt({ hash: h });
        bets.push({ i, c, side, amt });
      }
      console.log(`round ${round}: ${bets.length} bets placed`);
      for (;;) { r = await read('getRound', [BigInt(round)]); if (r.status >= 3) break; await sleep(1); }
      check(r.status === 3, `round ${round} settled (winner side ${r.winnerSide})`);

      // independent payout calc from our own bet list
      for (const c of ['ETH', 'USDC', 'REKT']) {
        const P = [0n, 0n]; bets.filter(b => b.c === c).forEach(b => P[b.side - 1] += b.amt);
        const w = r.winnerSide - 1, cut = r.cutBps;
        const [pa, pb] = await read('pools', [BigInt(round), tok[c]]);
        check(pa === P[0] && pb === P[1], `round ${round} ${c} pools match bets (${formatUnits(pa, dec[c])} / ${formatUnits(pb, dec[c])})`);
        for (let i = 2; i < 7; i++) {
          const mine = [0n, 0n]; bets.filter(b => b.c === c && b.i === i).forEach(b => mine[b.side - 1] += b.amt);
          if (!mine[0] && !mine[1]) continue;
          const expect = P[w] === 0n ? mine[1 - w] : mine[w] + mine[w] * P[1 - w] * BigInt(10000 - cut) / (P[w] * 10000n);
          const before = await bal(c, acct[i].address);
          if (expect === 0n) { check((await read('previewClaim', [BigInt(round), acct[i].address, tok[c]])) === 0n, `round ${round} ${c} wallet ${i} lost, nothing to claim`); continue; }
          const rc = await pub.waitForTransactionReceipt({ hash: await wallet(i).writeContract({ address: ARENA, abi: ABI, functionName: 'claim', args: [BigInt(round), tok[c]] }) });
          const gas = c === 'ETH' ? rc.gasUsed * rc.effectiveGasPrice : 0n;
          const got = (await bal(c, acct[i].address)) - before + gas;
          check(got === expect, `round ${round} ${c} wallet ${i} claimed ${formatUnits(got, dec[c])} (expected ${formatUnits(expect, dec[c])})`);
        }
      }
      await sleep(3);
      for (const c of ['ETH', 'USDC', 'REKT']) {
        const [pa, pb] = await read('pools', [BigInt(round), tok[c]]), L = r.winnerSide === 1 ? pb : pa, W = r.winnerSide === 1 ? pa : pb;
        const due = W > 0n && L > 0n ? L * BigInt(r.cutBps) / 10000n : 0n;
        check((await read('cutCollected', [BigInt(round), tok[c]])) === (due > 0n), `round ${round} ${c} cut ${formatUnits(due, dec[c])} ${due > 0n ? 'collected to ' + (c === 'REKT' ? 'dEaD' : 'treasury') : 'none due'}`);
      }
      const v = await verify(RPC, ARENA, round);
      check(v.ok, `round ${round} replay check: ${JSON.stringify(v.checks)} replay ${v.replay && v.replay.winner}`);
    }
    for (const c of ['ETH', 'USDC', 'REKT']) {
      const left = await bal(c, ARENA);
      check(left >= 0n && left < (c === 'ETH' ? 1000n : 1000n), `arena ${c} balance after all claims + cuts is dust: ${left}`);
    }
    check((await bal('REKT', DEAD)) > 0n, 'REKT cut was burned to dEaD');
  } catch (e) { fails.push(e.message); console.log('ERROR', (e.message || '').slice(0, 900)); }
  finally { stop(); console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED'); process.exit(fails.length ? 1 : 0); }
})();
