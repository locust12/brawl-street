'use strict';
// CRYPTO CHECKOUT — the store takes ETH, USDC, USDT and WOLVERINU, and the server verifies every
// payment on-chain before anything is granted. Design notes: ../../docs/PAYMENTS.md.
//
// WHERE THE SHAPE OF THIS CAME FROM (the rule: copy the proven leader, then change it to fit):
//   1. GODS UNCHAINED / IMMUTABLE store. The catalogue is priced in DOLLARS and the checkout
//      accepts USDC, ETH, IMX or GODS, converting behind the scenes so nobody has to swap first.
//      Two wallet prompts on a token (approve, then pay), one on the native coin. Their stated
//      guarantee is the one worth copying: payment guarantees delivery, and a failure grants
//      nothing and charges nothing.
//   2. MAVIS STORE (Axie Infinity). Pays in RON, AXS, SLP, WETH or USDC — i.e. the native coin,
//      the stables AND the ecosystem's own tokens, in one list. That is the precedent for
//      WOLVERINU sitting next to ETH here rather than being a separate "token store".
//   3. OPEN LOOT (Big Time). The native token is a first-class checkout currency, not an
//      afterthought, and the price is locked for a short window at quote time.
//
// WHAT IS DIFFERENT HERE, and why: the leaders all run a primary-sales CONTRACT. We take payment
// straight to a treasury address instead, because that needs no deploy, no operator key on the
// game server and no gas from us — it works the day it ships. The cost is that a plain transfer
// carries no memo, so the binding that a contract would get from an on-chain `ref` has to be
// rebuilt here:
//
//   ref         a 32-byte id the server issues with the quote. It is never sent on-chain; it is
//               the key the page quotes back when it claims the payment.
//   payer       the wallet the quote was issued to. A tx from any other address is refused, so a
//               tx hash copied out of the explorer cannot be used to claim somebody else's item.
//   tx hash     single use, PERSISTED. One payment can never grant two items, across restarts.
//   amount      the exact units the quote asked for, locked at quote-time rates.
//
// THE ONE RULE: this file never grants anything. It answers "has this been paid for" and the
// economy does the granting, exactly like the stub path (lib/economy.js `buy`).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Transfer(address,address,uint256) — the only event a plain ERC20 payment produces.
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
// PoolManager.extsload(bytes32), Uniswap v4: one storage word, which is how a graduated Pons pool
// is priced without an RPC that indexes anything. See `v4Rate` below.
const SEL_EXTSLOAD = '0x1e2eaeaf';
const RATE_TTL = 60e3;           // a quoted rate is at most this old
const RATE_STALE = 600e3;        // past this a cached rate is not good enough to take money on
const QUOTE_TTL = 600e3;         // 10 minutes to pay, the window Immutable's checkout gives
// How long an UNCLAIMED quote is kept, which is a different question from how long it is quotable
// for. A player whose wallet took twenty minutes, or who paid and closed the tab, has still paid:
// the quote has to outlive its own price so the payment can still be claimed. Kept on disk too, or
// a deploy in the wrong five seconds would take somebody's money and grant nothing.
const QUOTE_KEEP = 48 * 3600e3;
const MAX_OPEN = 40;             // open quotes kept per account; older ones are pruned first
const HTTP_MS = 8000;            // every outbound call is bounded; a hung feed must not hang a buy

const lc = s => String(s || '').toLowerCase();
const isAddr = s => /^0x[0-9a-fA-F]{40}$/.test(String(s || ''));
const hex = n => '0x' + BigInt(n).toString(16);

// raw units -> a human string with at most `places` decimals and no trailing zeroes. The page shows
// what the wallet will show, so a 10283.126 WOLVERINU quote must not read "10283.13" here and
// "10283.126033807323" in MetaMask.
function fmtUnits(raw, dec, places) {
  const s = BigInt(raw).toString().padStart(dec + 1, '0');
  const i = s.slice(0, s.length - dec), f = s.slice(s.length - dec).replace(/0+$/, '');
  const p = places == null ? (dec > 8 ? 6 : dec) : places;
  const out = f.slice(0, p).replace(/0+$/, '');
  return out ? i + '.' + out : i;
}
// usd -> raw units, ROUNDED UP. Rounding down would quote an amount a cent short of the price and
// the claim would then refuse a payment the player watched succeed.
function unitsFor(usd, rate, dec) {
  if (!(rate > 0)) throw new Error('no rate');
  const scaled = BigInt(Math.ceil((usd / rate) * 1e6));          // 6 dp of the token amount
  return (scaled * 10n ** BigInt(dec) + 999999n) / 1000000n;
}
// An amount has to be a number a human can read back off their wallet screen. `36164.75876
// WOLVERINU` is five digits of noise on a token worth a fiftieth of a cent, so the amount is
// rounded to a sensible number of places for its size — and ALWAYS UP, so tidying it can never
// leave the shop a fraction short of the price.
function tidy(raw, dec) {
  const amt = Number(raw) / 10 ** dec;
  const places = amt >= 1000 ? 2 : amt >= 1 ? 4 : dec;
  if (places >= dec) return BigInt(raw);
  const step = 10n ** BigInt(dec - places);
  return ((BigInt(raw) + step - 1n) / step) * step;
}

class Pay {
  // `fetchImpl` and `rpcImpl` exist so the tests can drive every branch of this file without a
  // network: a payment verifier that has only ever been run against a live chain is a verifier
  // whose refusal paths have never been run at all.
  constructor(opts = {}) {
    this.dir = opts.dataDir || '';
    this.log = opts.log || (() => {});
    this.fetch = opts.fetchImpl || ((...a) => fetch(...a));
    this.rpcImpl = opts.rpcImpl || null;
    this.cfg = opts.cfg || this.loadCfg(opts.cfgPath);
    this.quotes = new Map();        // ref -> quote
    this.rate = new Map();          // cur -> { usd, at }
    this.spent = new Set();         // chainId:txHash, every payment ever credited
    this.sales = [];                // the receipt book, trimmed on disk
    this.file = this.dir ? path.join(this.dir, 'pay.json') : '';
    this.dirty = false;
    this.restore();
  }

  loadCfg(p) {
    const f = p || process.env.PAY_CONFIG || path.join(__dirname, '..', 'pay.json');
    let cfg = null;
    try { cfg = JSON.parse(fs.readFileSync(f, 'utf8')); }
    catch (e) { return null; }
    // One env var repoints where every penny lands, so moving the takings to a dedicated wallet is a
    // restart and not a file edit. It is refused unless it is a real address: a typo here would send
    // every payment somewhere nobody can open.
    const t = process.env.PAY_TREASURY;
    if (t) {
      if (!isAddr(t)) throw new Error('PAY_TREASURY is not an address: ' + t);
      for (const ch of Object.values(cfg.chains || {})) ch.treasury = t;
    }
    return cfg;
  }

  // A payment already credited must stay credited across a restart, or the same tx hash buys the
  // shop out one item per deploy.
  restore() {
    if (!this.file) return;
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const h of raw.spent || []) this.spent.add(h);
      this.sales = Array.isArray(raw.sales) ? raw.sales.slice(-5000) : [];
      const now = Date.now();
      for (const q of raw.quotes || []) if (q && q.ref && q.at > now - QUOTE_KEEP) this.quotes.set(q.ref, q);
    } catch (e) { /* first run */ }
  }
  flush() {
    if (!this.dirty || !this.file) return;
    this.dirty = false;
    try {
      const now = Date.now();
      // `busy` and `checkAt` are about THIS process and must never survive it: a crash in the
      // middle of a verification would otherwise write `busy: true` to disk and the restarted
      // server would refuse that reference forever, which is somebody's paid item lost to a flag.
      const open = [...this.quotes.values()].filter(q => q.at > now - QUOTE_KEEP)
        .map(q => Object.assign({}, q, { busy: false, checkAt: 0 }));
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ v: 1, spent: [...this.spent].slice(-20000), sales: this.sales.slice(-5000), quotes: open }));
      fs.renameSync(tmp, this.file);
    } catch (e) { this.log('pay flush failed', e.message); }
  }

  enabled() { return !!(this.cfg && this.cfg.chains && Object.keys(this.cfg.chains).length); }
  chain(id) { return (this.cfg && this.cfg.chains && this.cfg.chains[String(id)]) || null; }
  // every currency the shop offers, flattened across chains, in the order the config lists them
  menuList() {
    const out = [];
    if (!this.enabled()) return out;
    for (const [cid, ch] of Object.entries(this.cfg.chains)) {
      if (ch.off) continue;
      for (const [cur, t] of Object.entries(ch.tokens || {})) {
        if (t.off) continue;
        out.push({ cur, key: cid + ':' + cur, symbol: t.symbol || cur, name: t.name || cur, chainId: Number(cid),
          chainName: ch.name || ('chain ' + cid), token: t.addr || null, dec: t.dec == null ? 18 : t.dec,
          explorer: ch.explorer || '', rpc: ch.rpc, to: ch.treasury });
      }
    }
    return out;
  }
  find(key) {
    // `key` is "<chainId>:<CUR>"; a bare "CUR" takes the first chain that offers it, so the page can
    // ask for ETH without knowing which chain it is cheapest on.
    const m = this.menuList();
    return m.find(x => x.key === key) || m.find(x => x.cur === String(key || '').toUpperCase()) || null;
  }

  async rpc(ch, method, params) {
    if (this.rpcImpl) return this.rpcImpl(ch, method, params);
    const res = await this.fetch(ch.rpc, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(HTTP_MS) });
    const j = await res.json();
    if (j.error) throw new Error(method + ': ' + j.error.message);
    return j.result;
  }

  // ---------- rates ----------
  // A stable is quoted at 1.00 by fiat convention, the way every store on this list does it: the
  // sticker is dollars, USDC is dollars, and a 0.3% depeg is not worth refusing a sale over.
  // ETH comes off a spot feed. A Pons token comes off its own v4 pool, priced in ETH, times ETH/USD
  // — so WOLVERINU needs no listing anywhere and no API key.
  async usdOf(cur, ch, t) {
    const now = Date.now();
    const c = this.rate.get(cur);
    if (c && now - c.at < RATE_TTL) return c.usd;
    let usd = null;
    try {
      if (t && t.peg) usd = Number(t.peg);
      else if (t && t.price && t.price.kind === 'v4') usd = await this.v4Rate(ch, t) ;
      else usd = await this.spotUsd(t && t.feed ? t.feed : cur);
    } catch (e) {
      this.log('rate ' + cur + ' failed', e.message);
    }
    if (usd > 0) { this.rate.set(cur, { usd, at: now }); return usd; }
    // A stale rate is better than refusing every sale the moment a feed blips, but only just: past
    // RATE_STALE the shop stops quoting in that currency rather than guessing at the price.
    if (c && now - c.at < RATE_STALE) return c.usd;
    return null;
  }
  async spotUsd(sym) {
    const s = String(sym || 'ETH').toUpperCase();
    try {
      const r = await this.fetch('https://api.coinbase.com/v2/prices/' + s + '-USD/spot', { signal: AbortSignal.timeout(HTTP_MS) });
      const j = await r.json();
      const v = Number(j && j.data && j.data.amount);
      if (v > 0) return v;
    } catch (e) { /* fall through to the second feed */ }
    const r = await this.fetch('https://api.kraken.com/0/public/Ticker?pair=' + s + 'USD', { signal: AbortSignal.timeout(HTTP_MS) });
    const j = await r.json();
    const k = j && j.result && Object.keys(j.result)[0];
    const v = Number(k && j.result[k] && j.result[k].c && j.result[k].c[0]);
    if (v > 0) return v;
    throw new Error('no spot price for ' + s);
  }
  // Uniswap v4 stores slot0 inside the PoolManager singleton, keyed by the pool id, so there is no
  // pair contract to call: one `extsload` of the pool's slot0 is the whole price read.
  //   sqrtPriceX96 = slot0 & (2^160-1); currency0 is native ETH (the lower address, always), so
  //   sqrtPrice^2 is TOKENS PER ETH and the token's ETH price is 1/sqrtPrice^2.
  // Getting that inversion backwards is what once had me telling Duane the price was going up while
  // it halved — see memory `robinhood-chain-v4-swap-decode`.
  // The slot is precomputed into the config because it needs keccak twice and never changes:
  //   poolId = keccak(abi.encode(0x0, token, fee=0, tickSpacing=200, hook))
  //   slot0  = keccak(abi.encode(poolId, uint256(6)))
  async v4Rate(ch, t) {
    const word = await this.rpc(ch, 'eth_call', [{ to: t.price.pm, data: SEL_EXTSLOAD + String(t.price.slot0).slice(2) }, 'latest']);
    const sq = Number(BigInt(word) & ((1n << 160n) - 1n)) / 2 ** 96;
    if (!(sq > 0)) throw new Error('pool has no price');
    const ethPer = 1 / (sq * sq);
    const eth = await this.usdOf('ETH', ch, { feed: 'ETH' });
    if (!(eth > 0)) throw new Error('no ETH price to convert against');
    return ethPer * eth;
  }

  // What every currency costs for one item, which is what the checkout sheet shows before anything
  // is locked in. A currency whose rate is unavailable is returned with `amount: null` and a reason
  // rather than dropped, so the page can say why instead of silently offering fewer ways to pay.
  async menu(cents) {
    const out = [];
    for (const m of this.menuList()) {
      const ch = this.chain(m.chainId), t = ch.tokens[m.cur];
      const usd = await this.usdOf(m.cur, ch, t);
      const row = Object.assign({}, m, { usd: usd || null });
      if (usd > 0 && cents != null) {
        const pad = this.padFor(m.cur, t);
        const raw = tidy(unitsFor((cents / 100) * (1 + pad), usd, m.dec), m.dec);
        row.amount = fmtUnits(raw, m.dec, m.dec > 8 ? 6 : m.dec);
        row.pad = pad;
      } else if (cents != null) { row.amount = null; row.why = 'price feed is down'; }
      out.push(row);
    }
    return out;
  }
  // THE QUOTE CARRIES NO MARKUP. A $1.99 item is quoted at exactly $1.99 of whatever you are
  // paying in, and the move between the quote and the transaction landing is absorbed by the
  // SHORTFALL RULE in `verify` instead of by a cushion the player pays every time. That is the
  // honest version: a buffer is money taken on every sale to cover a risk that shows up on a few.
  // `pad` stays as a per-token knob for one case only — a token that taxes its own transfers, where
  // the amount asked for has to exceed what we need to receive. WOLVERINU is not known to.
  padFor(cur, t) {
    if (t && t.pad != null) return Number(t.pad);
    const d = (this.cfg && this.cfg.pad) || {};
    return d[cur] != null ? Number(d[cur]) : 0;
  }

  // ---------- quotes ----------
  async quote(acctId, { id, name, cents, cur, payer }) {
    if (!this.enabled()) return { ok: false, msg: 'The store is not taking payments yet.' };
    if (!acctId) return { ok: false, msg: 'Sign in to online play first.' };
    if (!isAddr(payer)) return { ok: false, msg: 'Connect a wallet first.' };
    if (!(cents > 0)) return { ok: false, msg: 'That is not for sale.' };
    const m = this.find(cur);
    if (!m) return { ok: false, msg: 'That currency is not one the store takes.' };
    const ch = this.chain(m.chainId), t = ch.tokens[m.cur];
    if (!isAddr(ch.treasury)) return { ok: false, msg: 'The store has no payment address set.' };
    const usd = await this.usdOf(m.cur, ch, t);
    if (!(usd > 0)) return { ok: false, msg: 'The ' + m.symbol + ' price feed is down. Pick another currency.' };
    const pad = this.padFor(m.cur, t);
    const raw = tidy(unitsFor((cents / 100) * (1 + pad), usd, m.dec), m.dec);
    const ref = '0x' + crypto.randomBytes(16).toString('hex');
    const q = { ref, acct: acctId, item: id, name: name || id, cents, cur: m.cur, key: m.key, symbol: m.symbol,
      chainId: m.chainId, chainName: m.chainName, token: m.token, dec: m.dec, to: lc(ch.treasury),
      payer: lc(payer), amount: raw.toString(), rate: usd, pad, at: Date.now(), exp: Date.now() + QUOTE_TTL, done: false };
    this.prune(acctId);
    this.quotes.set(ref, q);
    this.dirty = true; this.flush();
    return Object.assign({ ok: true }, this.pub(q), {
      rpc: ch.rpc, explorer: ch.explorer || '',
      // The page sends exactly this. `amountRaw` is what goes in the tx; `amount` is what the sheet
      // prints. They are computed once, here, so the two can never disagree.
      amountRaw: hex(raw),
    });
  }
  pub(q) {
    return { ref: q.ref, item: q.item, name: q.name, cents: q.cents, cur: q.cur, key: q.key, symbol: q.symbol,
      chainId: q.chainId, chainName: q.chainName, token: q.token, dec: q.dec, to: q.to, payer: q.payer,
      amount: fmtUnits(q.amount, q.dec, q.dec > 8 ? 6 : q.dec), amountRaw: hex(q.amount), rate: q.rate, expires: q.exp };
  }
  // Kept deliberately shy of deleting anything that could still be owed an item. A quote is dropped
  // only when it is 48 h old, or when the account has piled up more than MAX_OPEN quotes that
  // EXPIRED WITHOUT ANYONE EVER TRYING TO CLAIM THEM — a browsed-and-closed sheet, never a payment
  // in flight. A paid-but-unclaimed quote that got pruned is money taken for nothing, so the test
  // suite covers this directly.
  prune(acctId) {
    const now = Date.now();
    for (const [r, q] of this.quotes) if (q.at < now - QUOTE_KEEP) this.quotes.delete(r);
    const cold = [...this.quotes.values()].filter(q => q.acct === acctId && !q.done && !q.checkAt && q.exp < now).sort((a, b) => a.at - b.at);
    for (const q of cold.slice(0, Math.max(0, cold.length - MAX_OPEN))) this.quotes.delete(q.ref);
  }

  // ---------- verification: the only thing standing between the catalogue and a free item ----------
  // Returns { ok, msg, paid } and NOTHING ELSE. The caller grants.
  // ONE CLAIM AT A TIME PER REFERENCE. The 1.5s cooldown below is about traffic; this is about
  // correctness. A claim sits on three RPC reads, and if those take longer than the cooldown a
  // second claim can start, pass every check and reach the grant while the first is still in
  // flight. For an entitlement that is harmless (the second delivery reports "already on your
  // account"), but a piece of GEAR mints an instance, so two claims on one payment would mint two.
  async verify(acctId, m) {
    const held = this.quotes.get(String((m && m.ref) || ''));
    if (held) {
      if (held.busy) return { ok: false, retry: true, msg: 'Checking that payment…' };
      held.busy = true;
    }
    try { return await this._verify(acctId, m || {}); }
    finally { if (held) held.busy = false; }
  }
  async _verify(acctId, { ref, tx }) {
    if (!this.enabled()) return { ok: false, msg: 'The store is not taking payments yet.' };
    const q = this.quotes.get(String(ref || ''));
    if (!q) return { ok: false, msg: 'That checkout has expired. Start it again — nothing was charged.' };
    if (q.acct !== acctId) return { ok: false, msg: 'That checkout belongs to another account.' };
    if (q.done) return { ok: false, msg: 'That payment has already been credited.' };
    if (!/^0x[0-9a-fA-F]{64}$/.test(String(tx || ''))) return { ok: false, msg: 'That is not a transaction hash.' };
    // The page polls this while a transaction confirms. One check per ref per 1.5s is plenty for
    // that and stops a tight retry loop turning one checkout into a few hundred RPC reads.
    if (Date.now() - (q.checkAt || 0) < 1500) return { ok: false, retry: true, msg: 'Checking that payment…' };
    q.checkAt = Date.now();
    const hash = lc(tx);
    const spentKey = q.chainId + ':' + hash;
    if (this.spent.has(spentKey)) return { ok: false, msg: 'That transaction has already been used.' };
    const ch = this.chain(q.chainId);
    if (!ch) return { ok: false, msg: 'That chain is no longer supported.' };

    let rc, txo, head;
    try {
      [rc, txo, head] = await Promise.all([
        this.rpc(ch, 'eth_getTransactionReceipt', [hash]),
        this.rpc(ch, 'eth_getTransactionByHash', [hash]),
        this.rpc(ch, 'eth_blockNumber', []),
      ]);
    } catch (e) {
      // Never credit on a read failure, and never refuse permanently either: the money may well be
      // there and the page is told to try again.
      this.log('pay verify rpc failed', e.message);
      return { ok: false, retry: true, msg: 'Could not reach the chain to check that payment. Try again in a moment.' };
    }
    if (!rc || !txo) return { ok: false, retry: true, msg: 'That transaction has not been mined yet. Try again in a moment.' };
    if (rc.status !== '0x1') return { ok: false, msg: 'That transaction failed on-chain, so nothing was charged.' };
    const conf = Number(BigInt(head) - BigInt(rc.blockNumber)) + 1;
    const need = ch.minConf == null ? 1 : Number(ch.minConf);
    if (conf < need) return { ok: false, retry: true, msg: 'Waiting for confirmations (' + conf + '/' + need + ').' };
    if (lc(txo.from) !== q.payer) return { ok: false, msg: 'That payment came from a different wallet than this checkout.' };

    const want = BigInt(q.amount);
    let got = 0n, sent = 0n;
    if (!q.token) {
      // native coin: the value of the transaction itself, and it has to be going to the treasury.
      if (lc(txo.to) !== q.to) return { ok: false, msg: 'That payment was not sent to the store address.' };
      got = sent = BigInt(txo.value || '0x0');
    } else {
      // a token: every Transfer in the receipt from this payer to the treasury, summed. Summed and
      // not "the first one" because a token with a hook or a router in the path can emit more than
      // one leg, and the only number that matters is what LANDED.
      const tok = lc(q.token);
      for (const l of rc.logs || []) {
        if (lc(l.address) !== tok || !l.topics || lc(l.topics[0]) !== TRANSFER) continue;
        if (lc('0x' + String(l.topics[1]).slice(26)) !== q.payer) continue;
        const v = BigInt(l.data || '0x0');
        // what LEFT the payer, whoever it went to, and what LANDED on the treasury. They differ on
        // a token that taxes its own transfers: the tax leg is a second Transfer out of the same
        // wallet. Nothing on record says WOLVERINU does that (its 4% is a v4 pool hook, not a
        // transfer tax, and there is not one plain `transfer()` call in its last 900k blocks to
        // measure), so the rule below covers it rather than this file assuming either way.
        sent += v;
        if (lc('0x' + String(l.topics[2]).slice(26)) === q.to) got += v;
      }
      if (got === 0n) return { ok: false, msg: 'No ' + q.symbol + ' payment to the store address is in that transaction.' };
    }

    // THE SHORTFALL RULE, and it is the rule that decides whether this shop is honest. The quote is
    // the contract, so `got >= want` is the normal path. Two things can make a payment arrive light,
    // and NEITHER of them is the player's fault:
    //   1. the token taxed its own transfer, so the player sent what was asked and less landed
    //      (`sent >= want`), and
    //   2. the price moved between the quote and the block, so what landed is worth slightly less
    //      than the sticker.
    // Refusing either keeps the money AND the item, which is the one outcome a shop must never
    // produce. So (1) is accepted outright and (2) is accepted while what arrived still covers the
    // sticker in dollars at the rate right now, down to `cfg.accept` (97% by default).
    let okAmt = got >= want || sent >= want, short = null;
    if (!okAmt) {
      const live = await this.usdOf(q.cur, ch, ch.tokens[q.cur]).catch(() => null);
      const rate = live > 0 ? live : q.rate;
      const gotUsd = (Number(got) / 10 ** q.dec) * rate;
      const floor = (q.cents / 100) * (this.cfg.accept == null ? 0.97 : Number(this.cfg.accept));
      if (gotUsd >= floor) okAmt = true;
      else short = { gotUsd, need: q.cents / 100, amount: fmtUnits(want - got, q.dec, q.dec > 8 ? 6 : q.dec) };
    }
    if (!okAmt) {
      return { ok: false, short: true,
        msg: 'That payment was ' + short.amount + ' ' + q.symbol + ' short of ' + q.name + '. Send the rest and claim again, or contact support with the transaction.' };
    }

    // Credited. Both locks are set BEFORE the caller grants, so a double-send of the claim cannot
    // race its way to two items.
    q.done = true;
    this.spent.add(spentKey);
    const sale = { at: Date.now(), acct: acctId, item: q.item, name: q.name, cents: q.cents, cur: q.cur,
      chainId: q.chainId, amount: got.toString(), dec: q.dec, usd: (Number(got) / 10 ** q.dec) * q.rate, rate: q.rate, tx: hash, payer: q.payer };
    this.sales.push(sale);
    this.dirty = true;
    this.flush();
    this.log('PAID', q.name, q.cents, 'cents in', fmtUnits(got, q.dec, 6), q.symbol, 'tx', hash);
    return { ok: true, paid: sale, item: q.item,
      msg: q.name + ' paid with ' + fmtUnits(got, q.dec, q.dec > 8 ? 4 : q.dec) + ' ' + q.symbol + '.' };
  }

  // what the operator wants to see: takings per currency, and the last few sales
  takings() {
    const by = {};
    for (const s of this.sales) {
      const b = by[s.cur] || (by[s.cur] = { cur: s.cur, items: 0, usd: 0, raw: 0n });
      b.items++; b.usd += s.usd || 0; b.raw += BigInt(s.amount || '0');
    }
    return { sales: this.sales.length, by: Object.values(by).map(b => ({ cur: b.cur, items: b.items, usd: Math.round(b.usd * 100) / 100, amount: fmtUnits(b.raw, (this.sales.find(s => s.cur === b.cur) || {}).dec || 18, 4) })) };
  }
}

module.exports = { Pay, fmtUnits, unitsFor, tidy, TRANSFER, QUOTE_TTL };
