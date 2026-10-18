'use strict';
// THE CHECKOUT, tested without a chain and without a price feed — which is the point. A payment
// verifier whose refusal paths have only ever been exercised against a live RPC is a verifier whose
// refusal paths have never been exercised at all, and every one of them is the difference between
// a shop and a free shop.
//   node net/test/pay_test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { Pay, fmtUnits, unitsFor } = require('../lib/pay');
const { Accounts } = require('../lib/accounts');
const { Economy } = require('../lib/economy');
const C = require('../lib/catalog');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paytest-'));
let fails = 0, ran = 0;
const queue = [];
const t = (name, fn) => queue.push({ name, fn });
const log = () => {};

// ---------- the fixtures ----------
const TREASURY = '0x02b321e3b31e4ca53cee164beedc314f7345f6d4';
const WOLV = '0x945626601703d126877c33a3d0def244c833550d';
const USDC = '0xaf88d065e77c8cc2239327c5edb3a432268e5831';
const PM = '0x8366a39cc670b4001a1121b8f6a443a643e40951';
const WALLET = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const w = a => '0x' + a.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const n256 = v => '0x' + BigInt(v).toString(16).padStart(64, '0');
const hash = s => '0x' + s.replace(/^0x/, '').padEnd(64, '0').slice(0, 64);

// ETH at $2000, and a v4 pool whose token prices at 1e-7 ETH = $0.0002.
const ETH_USD = 2000;
const SQ = 1 / Math.sqrt(1e-7);
const SLOT0 = n256(BigInt(Math.round(SQ * 2 ** 96)));

const CFG = () => ({
  accept: 0.97,
  chains: {
    4663: { name: 'Robinhood Chain', rpc: 'http://rh.test', explorer: 'http://ex.test', treasury: TREASURY, minConf: 1,
      tokens: {
        ETH: { dec: 18, symbol: 'ETH', feed: 'ETH' },
        WOLV: { addr: WOLV, dec: 18, symbol: 'WOLVERINU', price: { kind: 'v4', pm: PM, slot0: '0xdeadbeef' } },
      } },
    42161: { name: 'Arbitrum One', rpc: 'http://arb.test', explorer: 'http://arbex.test', treasury: TREASURY, minConf: 2,
      tokens: { USDC: { addr: USDC, dec: 6, symbol: 'USDC', peg: 1 } } },
  },
});

// A fake chain: transactions live in `TX`, the head block moves with `HEAD`.
const TX = new Map();
let HEAD = 100;
const rpcImpl = async (ch, method, params) => {
  if (method === 'eth_blockNumber') return '0x' + HEAD.toString(16);
  if (method === 'eth_call') return SLOT0;                      // the only eth_call here is extsload
  const h = String(params[0] || '').toLowerCase();
  const e = TX.get(h);
  if (!e) return null;
  if (method === 'eth_getTransactionByHash') return e.tx;
  if (method === 'eth_getTransactionReceipt') return e.rc;
  throw new Error('unexpected ' + method);
};
let feedCalls = 0, feedDown = false;
const fetchImpl = async (url) => {
  feedCalls++;
  if (feedDown) throw new Error('feed down');
  if (/coinbase/.test(url)) return { json: async () => ({ data: { amount: String(ETH_USD) } }) };
  return { json: async () => ({ result: { XETHZUSD: { c: [String(ETH_USD)] } } }) };
};
const mk = (over = {}) => new Pay(Object.assign({ dataDir: dir, log, cfg: CFG(), rpcImpl, fetchImpl }, over));

// a native-ETH payment of `value` wei to `to`, from `from`, mined at `block`
function nativeTx(h, { from = WALLET, to = TREASURY, value, block = HEAD, status = '0x1' }) {
  TX.set(h, { tx: { from, to, value: n256(value), input: '0x' }, rc: { status, blockNumber: '0x' + block.toString(16), logs: [] } });
  return h;
}
// an ERC20 payment: one Transfer log per leg, so a taxed token can be modelled honestly
function tokenTx(h, { token = WOLV, from = WALLET, legs, block = HEAD, status = '0x1' }) {
  const logs = legs.map(([to, v]) => ({ address: token, topics: [TRANSFER, w(from), w(to)], data: n256(v) }));
  TX.set(h, { tx: { from, to: token, value: '0x0', input: '0x' }, rc: { status, blockNumber: '0x' + block.toString(16), logs } });
  return h;
}

// ---------- units ----------
t('fmtUnits prints what a wallet prints', () => {
  assert.strictEqual(fmtUnits(10n ** 18n, 18, 6), '1');
  assert.strictEqual(fmtUnits(1990000n, 6, 6), '1.99');
  assert.strictEqual(fmtUnits(0n, 18, 6), '0');
  assert.strictEqual(fmtUnits(813000000000000n, 18, 6), '0.000813');
});
t('unitsFor rounds UP, so a quote is never a cent short of the price', () => {
  // $1.99 of a $3 asset is 0.663333…, and a quote that rounds down is a payment that gets refused
  const raw = unitsFor(1.99, 3, 6);
  assert.ok(raw >= 663333n, 'got ' + raw);
  assert.strictEqual(unitsFor(1.99, 1, 6).toString(), '1990000');
  assert.throws(() => unitsFor(1, 0, 18), /no rate/);
});

// ---------- the menu ----------
t('the menu prices every configured currency, each off its own source', async () => {
  const p = mk();
  const m = await p.menu(199);
  const by = {};
  for (const r of m) by[r.key] = r;
  assert.strictEqual(Object.keys(by).length, 3, 'three currencies configured');
  assert.strictEqual(by['42161:USDC'].amount, '1.99', 'a stable is quoted at the sticker');
  assert.strictEqual(by['4663:ETH'].amount, '0.000995', '$1.99 at $2000/ETH');
  // the v4 pool read, inverted the right way round: sqrtPrice^2 is tokens per ETH
  assert.ok(Math.abs(by['4663:WOLV'].usd - 0.0002) < 1e-9, 'WOLV at $0.0002, got ' + by['4663:WOLV'].usd);
  assert.strictEqual(by['4663:WOLV'].amount, '9950', '$1.99 of a $0.0002 token');
  assert.strictEqual(by['4663:WOLV'].symbol, 'WOLVERINU');
});
t('a stable needs no price feed at all', async () => {
  feedDown = true;
  const p = mk();
  const m = await p.menu(199);
  const usdc = m.find(r => r.cur === 'USDC'), eth = m.find(r => r.cur === 'ETH');
  assert.strictEqual(usdc.amount, '1.99', 'USDC still quotable with every feed down');
  assert.strictEqual(eth.amount, null, 'ETH is not quoted on a guess');
  assert.ok(/feed/.test(eth.why || ''), 'and it says why');
  feedDown = false;
});
t('rates are cached, so a shelf of 277 items is not 277 feed calls', async () => {
  const p = mk();
  feedCalls = 0;
  await p.menu(199); await p.menu(399); await p.menu(1499);
  assert.ok(feedCalls <= 2, 'got ' + feedCalls + ' feed calls for three menus');
});

// ---------- quotes ----------
t('a quote needs an account, a wallet and a real price', async () => {
  const p = mk();
  assert.ok(!(await p.quote('', { id: 'pipebomb', cents: 399, cur: 'USDC', payer: WALLET })).ok, 'no account');
  assert.ok(!(await p.quote('a1', { id: 'pipebomb', cents: 399, cur: 'USDC', payer: 'nope' })).ok, 'no wallet');
  assert.ok(!(await p.quote('a1', { id: 'pipebomb', cents: 0, cur: 'USDC', payer: WALLET })).ok, 'no price');
  assert.ok(!(await p.quote('a1', { id: 'pipebomb', cents: 399, cur: 'DOGE', payer: WALLET })).ok, 'currency we do not take');
  const q = await p.quote('a1', { id: 'pipebomb', cents: 399, cur: '4663:WOLV', payer: WALLET });
  assert.ok(q.ok, q.msg);
  assert.strictEqual(q.amount, '19950', '$3.99 of a $0.0002 token');
  assert.strictEqual(BigInt(q.amountRaw).toString(), (19950n * 10n ** 18n).toString(), 'the raw amount is what the wallet gets');
  assert.strictEqual(q.to, TREASURY);
  assert.strictEqual(q.chainId, 4663);
  assert.ok(q.expires > Date.now(), 'the price is held for a window');
});
t('the quote carries no markup', async () => {
  const p = mk();
  const q = await p.quote('a1', { id: 'pipebomb', cents: 199, cur: '42161:USDC', payer: WALLET });
  assert.strictEqual(q.amount, '1.99', 'a $1.99 item is quoted at $1.99, not $1.99 plus a cushion');
});

// ---------- verification: the happy paths ----------
t('a native ETH payment is credited', async () => {
  const p = mk();
  const q = await p.quote('a1', { id: 'pipebomb', name: 'Pipe Bomb', cents: 399, cur: '4663:ETH', payer: WALLET });
  nativeTx(hash('0xaa'), { value: BigInt(q.amountRaw) });
  const r = await p.verify('a1', { ref: q.ref, tx: hash('0xaa') });
  assert.ok(r.ok, r.msg);
  assert.strictEqual(r.item, 'pipebomb', 'the item comes out of the quote');
  assert.ok(Math.abs(r.paid.usd - 3.99) < 0.01, 'the receipt books $3.99, got ' + r.paid.usd);
});
t('a WOLVERINU payment is credited', async () => {
  const p = mk();
  const q = await p.quote('a1', { id: 'omen', name: 'OMEN', cents: 999, cur: '4663:WOLV', payer: WALLET });
  assert.strictEqual(q.amount, '49950', '$9.99 of WOLV');
  tokenTx(hash('0xbb'), { legs: [[TREASURY, BigInt(q.amountRaw)]] });
  const r = await p.verify('a1', { ref: q.ref, tx: hash('0xbb') });
  assert.ok(r.ok, r.msg);
  assert.strictEqual(r.paid.cur, 'WOLV');
  assert.strictEqual(r.item, 'omen');
});
t('a USDC payment on the second chain waits for ITS confirmations', async () => {
  const p = mk();
  const q = await p.quote('a1', { id: 'pipebomb', cents: 199, cur: '42161:USDC', payer: WALLET });
  tokenTx(hash('0xcc'), { token: USDC, legs: [[TREASURY, 1990000n]], block: HEAD });
  const slow = await p.verify('a1', { ref: q.ref, tx: hash('0xcc') });
  assert.ok(!slow.ok && slow.retry, 'minConf 2 is not met by the head block');
  assert.ok(/confirmation/i.test(slow.msg), slow.msg);
  HEAD++;
  p.quotes.get(q.ref).checkAt = 0;
  const r = await p.verify('a1', { ref: q.ref, tx: hash('0xcc') });
  assert.ok(r.ok, r.msg);
});

// ---------- verification: every way it must say no ----------
t('a payment from a different wallet is refused', async () => {
  const p = mk();
  const q = await p.quote('a1', { id: 'pipebomb', cents: 199, cur: '4663:ETH', payer: WALLET });
  nativeTx(hash('0xdd'), { from: OTHER, value: BigInt(q.amountRaw) });
  const r = await p.verify('a1', { ref: q.ref, tx: hash('0xdd') });
  assert.ok(!r.ok && /different wallet/.test(r.msg), r.msg);
});
t('a payment to anywhere but the treasury is refused', async () => {
  const p = mk();
  const q = await p.quote('a1', { id: 'pipebomb', cents: 199, cur: '4663:ETH', payer: WALLET });
  nativeTx(hash('0xee'), { to: OTHER, value: BigInt(q.amountRaw) });
  const r = await p.verify('a1', { ref: q.ref, tx: hash('0xee') });
  assert.ok(!r.ok && /store address/.test(r.msg), r.msg);
});
t('a token transfer to anywhere but the treasury is refused', async () => {
  const p = mk();
  const q = await p.quote('a1', { id: 'omen', cents: 999, cur: '4663:WOLV', payer: WALLET });
  tokenTx(hash('0xef'), { legs: [[OTHER, BigInt(q.amountRaw)]] });
  const r = await p.verify('a1', { ref: q.ref, tx: hash('0xef') });
  assert.ok(!r.ok && /No WOLVERINU payment/.test(r.msg), r.msg);
});
t('a reverted transaction is refused and says nothing was charged', async () => {
  const p = mk();
  const q = await p.quote('a1', { id: 'pipebomb', cents: 199, cur: '4663:ETH', payer: WALLET });
  nativeTx(hash('0xf1'), { value: BigInt(q.amountRaw), status: '0x0' });
  const r = await p.verify('a1', { ref: q.ref, tx: hash('0xf1') });
  assert.ok(!r.ok && /failed on-chain/.test(r.msg), r.msg);
});
t('an unmined transaction is a RETRY, never a refusal', async () => {
  const p = mk();
  const q = await p.quote('a1', { id: 'pipebomb', cents: 199, cur: '4663:ETH', payer: WALLET });
  const r = await p.verify('a1', { ref: q.ref, tx: hash('0xf2') });
  assert.ok(!r.ok && r.retry, 'the page has to keep asking, not give up on a paid player');
});
t('an RPC outage is a RETRY, never a credit and never a refusal', async () => {
  const p = mk({ rpcImpl: async () => { throw new Error('530'); } });
  const q = await p.quote('a1', { id: 'pipebomb', cents: 199, cur: '42161:USDC', payer: WALLET });
  const r = await p.verify('a1', { ref: q.ref, tx: hash('0xf3') });
  assert.ok(!r.ok && r.retry, 'an unreachable chain must not grant and must not refuse');
});
t('one transaction can only ever buy one item', async () => {
  const p = mk();
  const q1 = await p.quote('a1', { id: 'pipebomb', cents: 199, cur: '4663:ETH', payer: WALLET });
  nativeTx(hash('0xf4'), { value: BigInt(q1.amountRaw) * 10n });
  assert.ok((await p.verify('a1', { ref: q1.ref, tx: hash('0xf4') })).ok, 'first claim lands');
  const q2 = await p.quote('a1', { id: 'omen', cents: 999, cur: '4663:ETH', payer: WALLET });
  const r = await p.verify('a1', { ref: q2.ref, tx: hash('0xf4') });
  assert.ok(!r.ok && /already been used/.test(r.msg), r.msg);
});
t('a reference can only be claimed once', async () => {
  const p = mk();
  const q = await p.quote('a1', { id: 'pipebomb', cents: 199, cur: '4663:ETH', payer: WALLET });
  nativeTx(hash('0xf5'), { value: BigInt(q.amountRaw) });
  assert.ok((await p.verify('a1', { ref: q.ref, tx: hash('0xf5') })).ok);
  nativeTx(hash('0xf6'), { value: BigInt(q.amountRaw) });
  const r = await p.verify('a1', { ref: q.ref, tx: hash('0xf6') });
  assert.ok(!r.ok && /already been credited/.test(r.msg), r.msg);
});
t('two claims on one payment at the same time grant once', async () => {
  // the gear case is the one that bites: an entitlement granted twice is still one entitlement, but
  // minting is not idempotent. Both claims are fired before either finishes its RPC reads.
  let slow = 0;
  const p = mk({ rpcImpl: async (ch, method, params) => { slow++; await new Promise(r => setTimeout(r, 40)); return rpcImpl(ch, method, params); } });
  const q = await p.quote('a1', { id: 'g_visor', name: 'Visor', cents: 499, cur: '4663:ETH', payer: WALLET });
  nativeTx(hash('0x31'), { value: BigInt(q.amountRaw), block: HEAD - 2 });
  const [r1, r2] = await Promise.all([
    p.verify('a1', { ref: q.ref, tx: hash('0x31') }),
    p.verify('a1', { ref: q.ref, tx: hash('0x31') }),
  ]);
  const won = [r1, r2].filter(r => r.ok);
  assert.strictEqual(won.length, 1, 'exactly one claim may credit, got ' + JSON.stringify([r1.ok, r2.ok]));
  assert.ok((r1.ok ? r2 : r1).retry, 'the loser is told to try again, not told it failed');
});
t('another account cannot claim my checkout', async () => {
  const p = mk();
  const q = await p.quote('a1', { id: 'pipebomb', cents: 199, cur: '4663:ETH', payer: WALLET });
  nativeTx(hash('0xf7'), { value: BigInt(q.amountRaw) });
  const r = await p.verify('a2', { ref: q.ref, tx: hash('0xf7') });
  assert.ok(!r.ok && /another account/.test(r.msg), r.msg);
});
t('a made-up reference or hash is refused', async () => {
  const p = mk();
  assert.ok(!(await p.verify('a1', { ref: '0xdead', tx: hash('0xf8') })).ok, 'unknown ref');
  const q = await p.quote('a1', { id: 'pipebomb', cents: 199, cur: '4663:ETH', payer: WALLET });
  const r = await p.verify('a1', { ref: q.ref, tx: 'not-a-hash' });
  assert.ok(!r.ok && /transaction hash/.test(r.msg), r.msg);
});
t('a credited payment survives a restart', async () => {
  const p = mk();
  const q = await p.quote('a1', { id: 'pipebomb', cents: 199, cur: '4663:ETH', payer: WALLET });
  nativeTx(hash('0xf9'), { value: BigInt(q.amountRaw) });
  assert.ok((await p.verify('a1', { ref: q.ref, tx: hash('0xf9') })).ok);
  // the same disk, a new process: the hash must still be spent and the ref must still be done
  const p2 = mk();
  const q2 = await p2.quote('a1', { id: 'omen', cents: 999, cur: '4663:ETH', payer: WALLET });
  assert.ok(!(await p2.verify('a1', { ref: q2.ref, tx: hash('0xf9') })).ok, 'a restart must not reopen a spent tx');
  const again = await p2.verify('a1', { ref: q.ref, tx: hash('0xf9') });
  assert.ok(!again.ok && /already been credited/.test(again.msg), again.msg);
});
t('a quote outlives its own price window, so a late payment is still honoured', async () => {
  const p = mk();
  const q = await p.quote('a1', { id: 'pipebomb', cents: 199, cur: '4663:ETH', payer: WALLET });
  const row = p.quotes.get(q.ref);
  row.exp = Date.now() - 60e3;                   // the price window closed a minute ago
  for (let i = 0; i < 60; i++) await p.quote('a1', { id: 'omen', cents: 999, cur: '4663:ETH', payer: WALLET });
  assert.ok(p.quotes.get(q.ref), 'an expired quote is not thrown away while it could still be paid');
  nativeTx(hash('0xfa'), { value: BigInt(q.amountRaw) });
  row.checkAt = 0;
  assert.ok((await p.verify('a1', { ref: q.ref, tx: hash('0xfa') })).ok, 'and it still credits');
});

// ---------- the shortfall rule ----------
t('a token that taxes its own transfer still delivers the item', async () => {
  const p = mk();
  const q = await p.quote('a1', { id: 'omen', cents: 999, cur: '4663:WOLV', payer: WALLET });
  const want = BigInt(q.amountRaw);
  // the player sent exactly what was asked; the token took 4% of it on the way
  tokenTx(hash('0x01'), { legs: [[TREASURY, want * 96n / 100n], [OTHER, want * 4n / 100n]] });
  const r = await p.verify('a1', { ref: q.ref, tx: hash('0x01') });
  assert.ok(r.ok, 'the player paid in full: ' + r.msg);
});
t('a small adverse price move still delivers the item', async () => {
  const p = mk();
  const q = await p.quote('a1', { id: 'omen', cents: 999, cur: '4663:WOLV', payer: WALLET });
  const want = BigInt(q.amountRaw);
  tokenTx(hash('0x02'), { legs: [[TREASURY, want * 98n / 100n]] });      // 2% light, inside the 97% floor
  const r = await p.verify('a1', { ref: q.ref, tx: hash('0x02') });
  assert.ok(r.ok, r.msg);
});
t('a payment that is genuinely short is refused, and names the shortfall', async () => {
  const p = mk();
  const q = await p.quote('a1', { id: 'omen', name: 'OMEN', cents: 999, cur: '4663:WOLV', payer: WALLET });
  const want = BigInt(q.amountRaw);
  tokenTx(hash('0x03'), { legs: [[TREASURY, want / 2n]] });
  const r = await p.verify('a1', { ref: q.ref, tx: hash('0x03') });
  assert.ok(!r.ok && r.short, 'half price is not a sale');
  assert.ok(/24975 WOLVERINU short/.test(r.msg), r.msg);
});
t('overpaying is fine and is booked at what arrived', async () => {
  const p = mk();
  const q = await p.quote('a1', { id: 'pipebomb', cents: 199, cur: '4663:ETH', payer: WALLET });
  nativeTx(hash('0x04'), { value: BigInt(q.amountRaw) * 2n });
  const r = await p.verify('a1', { ref: q.ref, tx: hash('0x04') });
  assert.ok(r.ok && r.paid.usd > 3.9, 'got ' + (r.paid && r.paid.usd));
});
t('the takings add up per currency', async () => {
  // its own data dir: `mk()` shares one, and the receipt book is deliberately read back off disk
  const p = mk({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'paybook-')) });
  for (const [i, cur] of ['4663:ETH', '4663:WOLV', '42161:USDC'].entries()) {
    const q = await p.quote('a1', { id: 'pipebomb', cents: 199, cur, payer: WALLET });
    if (q.token) tokenTx(hash('0x1' + i), { token: q.token, legs: [[TREASURY, BigInt(q.amountRaw)]], block: HEAD - 5 });
    else nativeTx(hash('0x1' + i), { value: BigInt(q.amountRaw), block: HEAD - 5 });
    const r = await p.verify('a1', { ref: q.ref, tx: hash('0x1' + i) });
    assert.ok(r.ok, cur + ': ' + r.msg);
  }
  const tk = p.takings();
  assert.ok(tk.sales >= 3);
  const by = {}; for (const b of tk.by) by[b.cur] = b;
  assert.ok(by.ETH && by.WOLV && by.USDC, 'all three currencies in the book');
  assert.ok(Math.abs(by.USDC.usd - 1.99) < 0.01, 'USDC booked at the sticker, got ' + by.USDC.usd);
});

// ---------- the economy, end to end ----------
t('PAYMENTS=chain: a click grants nothing and opens a checkout', async () => {
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'paytest2-'));
  const accounts = new Accounts(d2); accounts.showTests = true;
  const was = process.env.PAYMENTS; process.env.PAYMENTS = 'chain';
  const econ = new Economy({ dataDir: d2, accounts, log });
  econ._pay = mk({ dataDir: d2 });
  const a = accounts.get(Accounts.hashToken('payer1'));
  const item = C.CAT.weapons.find(x => x.price > 0);
  const r = econ.buy(a.id, { id: item.id });
  assert.ok(!r.ok, 'a click does not grant');
  assert.ok(r.checkout && r.checkout.id === item.id && r.checkout.cents === item.price, 'it answers with the item and its price');
  assert.ok(!econ.owns(a.id, item.id), 'and nothing is owned yet');
  assert.strictEqual(econ.state(a.id).payments, 'chain', 'the page is told which mode it is in');

  // the full path: quote -> pay -> claim -> owned
  const q = await econ._pay.quote(a.id, { id: item.id, name: item.name, cents: item.price, cur: '4663:WOLV', payer: WALLET });
  assert.ok(q.ok, q.msg);
  tokenTx(hash('0x21'), { legs: [[TREASURY, BigInt(q.amountRaw)]], block: HEAD - 3 });
  const v = await econ._pay.verify(a.id, { ref: q.ref, tx: hash('0x21') });
  assert.ok(v.ok, v.msg);
  const out = econ.deliver(a.id, v.item, 'paid:WOLV:' + hash('0x21'));
  assert.ok(out.ok && econ.owns(a.id, item.id), 'the item is on the account once the payment verified');
  // and the entitlement records WHY, which is the audit trail for a paid item
  assert.ok(JSON.stringify(econ.row(a.id)).length > 0);
  if (was == null) delete process.env.PAYMENTS; else process.env.PAYMENTS = was;
  fs.rmSync(d2, { recursive: true, force: true });
});
t('a paid item the account already holds is reported as held, not refused', () => {
  const d3 = fs.mkdtempSync(path.join(os.tmpdir(), 'paytest3-'));
  const accounts = new Accounts(d3); accounts.showTests = true;
  const econ = new Economy({ dataDir: d3, accounts, log });
  const a = accounts.get(Accounts.hashToken('payer2'));
  const item = C.CAT.weapons.find(x => x.price > 0);
  econ.grant(a.id, [item.id], 'test');
  const r = econ.deliver(a.id, item.id, 'paid');
  assert.ok(r.ok && /already on your account/.test(r.msg), r.msg);
  fs.rmSync(d3, { recursive: true, force: true });
});
// ---------- nobody loses a paid item (10/17) ----------
// The purchase lands on whatever account the device was on when it paid. Pay on one device, come
// back on another -- or on the other region, where the account does not even exist -- and the
// arsenal looked empty. The receipt is the thing that survives all of that.
t('a paid item comes back to the wallet that paid for it, on a fresh account', () => {
  const d5 = fs.mkdtempSync(path.join(os.tmpdir(), 'paytest5-'));
  const accounts = new Accounts(d5); accounts.showTests = true;
  const was = process.env.PAYMENTS; process.env.PAYMENTS = 'chain';
  const econ = new Economy({ dataDir: d5, accounts, log });
  econ._pay = mk({ dataDir: d5 });
  const item = C.CAT.weapons.find(x => x.price > 0);
  const bought = accounts.get(Accounts.hashToken('deviceA'));
  const fresh = accounts.get(Accounts.hashToken('deviceB'));
  econ._pay.sales.push({ at: Date.now(), acct: bought.id, item: item.id, name: item.name, cents: item.price, cur: 'USDC', chainId: 1, tx: hash('0x31'), payer: WALLET });
  assert.ok(!econ.owns(fresh.id, item.id), 'the new account starts with nothing');
  const added = econ.restorePaid(fresh.id, { addr: WALLET.toUpperCase() });   // case must not matter
  assert.deepStrictEqual(added, [item.name], JSON.stringify(added));
  assert.ok(econ.owns(fresh.id, item.id), 'and it is on the account afterwards');
  assert.deepStrictEqual(econ.restorePaid(fresh.id, { addr: WALLET }), [], 'asking twice does not duplicate it');
  assert.deepStrictEqual(econ.restorePaid(fresh.id, { addr: OTHER }), [], 'another wallet gets nothing');
  if (was == null) delete process.env.PAYMENTS; else process.env.PAYMENTS = was;
  fs.rmSync(d5, { recursive: true, force: true });
});
t('signing in to the X account the item was bought on brings it back without a wallet', () => {
  const d6 = fs.mkdtempSync(path.join(os.tmpdir(), 'paytest6-'));
  const accounts = new Accounts(d6); accounts.showTests = true;
  const was = process.env.PAYMENTS; process.env.PAYMENTS = 'chain';
  const econ = new Economy({ dataDir: d6, accounts, log });
  econ._pay = mk({ dataDir: d6 });
  const item = C.CAT.weapons.find(x => x.price > 0);
  const a = accounts.get(Accounts.hashToken('deviceC'));
  econ._pay.sales.push({ at: Date.now(), acct: 'gone', item: item.id, name: item.name, cents: item.price, cur: 'USDC', chainId: 1, tx: hash('0x32'), payer: OTHER, xid: '99887766' });
  assert.deepStrictEqual(econ.restorePaid(a.id, { xid: '12345' }), [], 'a different X account gets nothing');
  assert.deepStrictEqual(econ.restorePaid(a.id, { xid: '99887766' }), [item.name], 'the buyer gets it back');
  assert.ok(econ.owns(a.id, item.id));
  if (was == null) delete process.env.PAYMENTS; else process.env.PAYMENTS = was;
  fs.rmSync(d6, { recursive: true, force: true });
});
t('a receipt from another region is merged once, and its tx cannot be spent twice', () => {
  const d7 = fs.mkdtempSync(path.join(os.tmpdir(), 'paytest7-'));
  const p = mk({ dataDir: d7 });
  const far = { at: Date.now(), acct: 'sgacct', item: 'pipebomb', name: 'Pipe Bomb', cents: 199, cur: 'USDC', chainId: 1, tx: hash('0x33'), payer: WALLET };
  assert.strictEqual(p.mergeReceipts([far]), 1, 'the first merge takes it');
  assert.strictEqual(p.mergeReceipts([far]), 0, 'the second merge is a no-op');
  assert.ok(p.spent.has('1:' + hash('0x33')), 'and the transaction is marked spent here too');
  assert.strictEqual(p.receipts(0).filter(s => s.tx === far.tx).length, 1, 'one receipt, not two');
  assert.strictEqual(p.mergeReceipts([{ at: Date.now(), item: 'pipebomb' }]), 0, 'a receipt with no tx is ignored');
  fs.rmSync(d7, { recursive: true, force: true });
});
t('PAYMENTS unset: the checkout messages are refused outright', () => {
  const d4 = fs.mkdtempSync(path.join(os.tmpdir(), 'paytest4-'));
  const accounts = new Accounts(d4); accounts.showTests = true;
  const was = process.env.PAYMENTS; delete process.env.PAYMENTS;
  const econ = new Economy({ dataDir: d4, accounts, log });
  const a = accounts.get(Accounts.hashToken('payer3'));
  assert.strictEqual(econ.pay(), null, 'no checkout exists when payments are off');
  const sent = [];
  const handled = econ.handle({ acct: a.id }, { k: 'payquote', id: 'pipebomb', cur: 'ETH', payer: WALLET }, { sendTo: (c, m) => sent.push(m) });
  assert.ok(handled && sent.length === 1 && sent[0].ok === false && sent[0].off, JSON.stringify(sent));
  if (was != null) process.env.PAYMENTS = was;
  fs.rmSync(d4, { recursive: true, force: true });
});

// ---------- run ----------
(async () => {
  for (const q of queue) {
    ran++;
    try { await q.fn(); console.log('  ok  ' + q.name); }
    catch (e) { fails++; console.log('  FAIL ' + q.name + '\n       ' + (e && e.message)); }
  }
  console.log(`\n${ran - fails}/${ran} passed`);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* tmp */ }
  process.exit(fails ? 1 : 0);
})();
