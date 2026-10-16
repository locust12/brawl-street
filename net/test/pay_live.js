'use strict';
// THE CHECKOUT, AGAINST THE REAL CHAINS. net/test/pay_test.js drives every branch with a fake RPC;
// this one proves the two things a fake cannot:
//   1. the live price path — Coinbase/Kraken for ETH, and WOLVERINU's own Uniswap v4 pool read
//      through the real PoolManager on Robinhood Chain — actually answers, and quotes a sane amount
//   2. the verifier reads a REAL transaction correctly: a real receipt, real Transfer logs, real
//      confirmations. It does that by finding a transfer that already happened on each chain and
//      checking it against a quote shaped to match, so nothing is sent and nothing is spent.
//
// Read-only. No key, no wallet, no transaction. Skips itself (exit 0) when the network is not there.
//   node net/test/pay_live.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { Pay } = require('../lib/pay');

const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paylive-'));
let fails = 0, ran = 0, skipped = 0;
const t = async (name, fn) => {
  ran++;
  try { await fn(); console.log('  ok  ' + name); }
  catch (e) {
    if (/SKIP:/.test(String(e.message))) { skipped++; ran--; console.log('  --  ' + name + ' (' + e.message.replace('SKIP:', '').trim() + ')'); return; }
    fails++; console.log('  FAIL ' + name + '\n       ' + (e && e.message));
  }
};

const rpc = async (url, method, params) => {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(12000) });
  const j = await r.json();
  if (j.error) throw new Error(method + ': ' + j.error.message);
  return j.result;
};

(async () => {
  const pay = new Pay({ dataDir: dir, log: () => {} });
  if (!pay.enabled()) { console.log('no net/pay.json — nothing to check'); process.exit(0); }
  const menuRows = pay.menuList();
  console.log('checkout offers: ' + menuRows.map(r => r.chainId + ':' + r.symbol).join(', '));

  await t('every configured currency quotes a live amount for a $1.99 item', async () => {
    let m;
    try { m = await pay.menu(199); } catch (e) { throw new Error('SKIP: offline (' + e.message + ')'); }
    const dead = m.filter(r => !r.amount);
    if (dead.length === m.length) throw new Error('SKIP: no network');
    assert.strictEqual(dead.length, 0, 'not quotable: ' + dead.map(r => r.key + ' (' + (r.why || '?') + ')').join(', '));
    for (const r of m) console.log('      ' + (r.chainId + ':' + r.symbol).padEnd(20) + '$1.99 = ' + r.amount + '  (1 ' + r.symbol + ' = $' + r.usd + ')');
    // sanity bands, so a decimals or inversion mistake cannot pass as a price: ETH in the hundreds
    // to tens of thousands, a stable at a dollar, and WOLVERINU as a sub-cent meme token.
    const eth = m.find(r => r.cur === 'ETH');
    assert.ok(eth.usd > 200 && eth.usd < 50000, 'ETH at $' + eth.usd);
    for (const s of m.filter(r => r.cur === 'USDC' || r.cur === 'USDT')) assert.strictEqual(s.amount, '1.99', s.cur);
    const wolv = m.find(r => r.cur === 'WOLV');
    if (wolv) {
      assert.ok(wolv.usd > 1e-9 && wolv.usd < 0.01, 'WOLVERINU at $' + wolv.usd + ' — check the sqrtPrice inversion');
      // and the same read on a 1e9 supply has to land somewhere a meme coin can actually be
      const mcap = wolv.usd * 1e9;
      assert.ok(mcap > 1000 && mcap < 1e9, 'implied mcap $' + Math.round(mcap));
      console.log('      WOLVERINU implied mcap on 1e9 supply: $' + Math.round(mcap).toLocaleString());
    }
  });

  // ---- the verifier against a transfer that really happened, on each chain ----
  for (const [cid, ch] of Object.entries(pay.cfg.chains)) {
    const tokens = Object.entries(ch.tokens).filter(([, tk]) => tk.addr);
    for (const [cur, tk] of tokens) {
      await t('verify() reads a real ' + cur + ' transfer on ' + ch.name, async () => {
        let head, logs = [];
        try { head = parseInt(await rpc(ch.rpc, 'eth_blockNumber', []), 16); }
        catch (e) { throw new Error('SKIP: ' + ch.name + ' unreachable'); }
        // walk back in chunks until a Transfer turns up; a quiet token needs a wider window
        for (let back = 2000; back <= 400000 && !logs.length; back *= 4) {
          try {
            logs = await rpc(ch.rpc, 'eth_getLogs', [{ address: tk.addr, topics: [TRANSFER],
              fromBlock: '0x' + Math.max(0, head - back).toString(16), toBlock: 'latest' }]) || [];
          } catch (e) { /* range too wide for this RPC, try the next shape */ }
        }
        const lg = logs.filter(l => BigInt(l.data || '0x0') > 0n).pop();
        if (!lg) throw new Error('SKIP: no ' + cur + ' transfer found to check against');
        const txo = await rpc(ch.rpc, 'eth_getTransactionByHash', [lg.transactionHash]);
        const from = '0x' + String(lg.topics[1]).slice(26);
        const to = '0x' + String(lg.topics[2]).slice(26);
        const amount = BigInt(lg.data);
        // A quote shaped to match that transfer: same chain, same token, same payer, same
        // destination, same amount. Everything the verifier then does is real work on real data.
        const p2 = new Pay({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'paylive2-')), log: () => {},
          cfg: JSON.parse(JSON.stringify(Object.assign({}, pay.cfg, { chains: Object.assign({}, pay.cfg.chains, { [cid]: Object.assign({}, ch, { treasury: to }) }) }))) });
        const ref = '0xlive';
        p2.quotes.set(ref, { ref, acct: 'live', item: 'pipebomb', name: 'Pipe Bomb', cents: 199, cur, key: cid + ':' + cur,
          symbol: tk.symbol || cur, chainId: Number(cid), chainName: ch.name, token: tk.addr, dec: tk.dec,
          to: to.toLowerCase(), payer: String(txo.from).toLowerCase(), amount: amount.toString(), rate: 1, at: Date.now(), exp: Date.now() + 6e5, done: false });
        const r = await p2.verify('live', { ref, tx: lg.transactionHash });
        // A WALLET-TO-WALLET transfer has to credit. A ROUTED one (a swap leg, where the Transfer
        // is emitted out of a router and the tx was sent by someone else) has to be refused — the
        // quote is bound to the payer, and `from` on that leg is not the payer, so the wallet check
        // rejects the leg and no payment to the treasury is left to count. Both are proof that the
        // real receipt and the real logs were read; the one thing that must never happen is a
        // credit the transaction had not earned.
        const sender = String(txo.from).toLowerCase() === from.toLowerCase();
        if (sender) assert.ok(r.ok, 'a wallet-to-wallet transfer should credit: ' + r.msg);
        else assert.ok(!r.ok && /different wallet|No .* payment to the store address/.test(r.msg),
          'a routed leg should be refused, got: ' + r.msg);
        console.log('      ' + lg.transactionHash.slice(0, 18) + '… ' + (sender ? 'wallet-to-wallet, ' : 'routed leg, ') + (r.ok ? 'credited' : 'refused: ' + r.msg));
        // and the same hash must never be creditable twice
        if (r.ok) {
          const row = p2.quotes.get(ref);
          row.done = false; row.checkAt = 0;          // the per-ref cooldown is not what is under test here
          const again = await p2.verify('live', { ref, tx: lg.transactionHash });
          assert.ok(!again.ok && /already been used/.test(again.msg), 'a spent hash must stay spent: ' + again.msg);
        }
      });
    }
    await t('verify() refuses a hash that does not exist on ' + ch.name, async () => {
      const p2 = new Pay({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'paylive3-')), log: () => {}, cfg: pay.cfg });
      const q = await p2.quote('live', { id: 'pipebomb', cents: 199, cur: cid + ':' + Object.keys(ch.tokens)[0], payer: '0x1111111111111111111111111111111111111111' });
      if (!q.ok) throw new Error('SKIP: ' + q.msg);
      const r = await p2.verify('live', { ref: q.ref, tx: '0x' + 'ab'.repeat(32) });
      assert.ok(!r.ok && r.retry, 'an unknown hash is a retry, not a credit: ' + JSON.stringify(r));
    });
  }

  console.log(`\n${ran - fails}/${ran} passed` + (skipped ? ', ' + skipped + ' skipped' : ''));
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* tmp */ }
  process.exit(fails ? 1 : 0);
})();
