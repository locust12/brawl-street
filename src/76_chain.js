// ===== live house: rounds, pools and bets from the RektArena contract =====
// Reads go straight to the chain's public RPC; bets and claims go through the player's wallet.
// Turned on by ARENA_LIVE (embedded at build time from arena/live.json once the contract is
// deployed). Without it the arena stays in practice mode.
const SEL = { nextRoundId: '4002eda6', getRound: '8f1327c0', pools: '02dce0e6', stakeOf: '7123281e', previewClaim: '5459ee92',
  bet: 'c437a0cd', betToken: '015e1718', claim: 'ddd5e1b2', balanceOf: '70a08231', allowance: 'dd62ed3e', approve: '095ea7b3' };
const ZERO_ADDR = '0x0000000000000000000000000000000000000000';
const w256 = v => BigInt(v).toString(16).padStart(64, '0');
const wAddr = a => a.toLowerCase().replace(/^0x/, '').padStart(64, '0');
const calldata = (sel, ...words) => '0x' + sel + words.join('');
const words = hex => (hex || '0x').slice(2).match(/.{64}/g) || [];
function toUnits(v, dec) {
  const [i, f = ''] = String(v).split('.');
  return BigInt(i || '0') * 10n ** BigInt(dec) + BigInt((f + '0'.repeat(dec)).slice(0, dec) || '0');
}
const fromUnits = (x, dec) => Number(x) / 10 ** dec;

const ChainHouse = {
  mode: 'live', label: 'Live', cfg: null, cur: null, rounds: new Map(), acct: null, bal: { REKT: 0, ETH: 0, USDC: 0 },
  offset: 0, pollT: 0, inflight: false, claimables: [],

  enabled() { return !!this.cfg; },
  init() {
    this.label = 'Live · ' + (this.cfg.chainName || 'Robinhood Chain');
    if (this.cfg.stableSymbol) CUR_NAME.USDC = this.cfg.stableSymbol;
    this.mine = store.get('arenaMine_' + this.cfg.arena, []);   // round ids this browser bet on
  },
  current() { return this.cur; },
  balances() { return this.bal; },

  async rpc(method, params) {
    const res = await fetch(this.cfg.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    const j = await res.json(); if (j.error) throw new Error(j.error.message);
    return j.result;
  },
  call(to, data) { return this.rpc('eth_call', [{ to, data }, 'latest']); },
  tok(cur) { return this.cfg.tokens[cur]; },
  dec(cur) { return this.cfg.decimals[cur]; },

  poll(now) {
    if (this.inflight || now - this.pollT < 1500) return;
    this.pollT = now; this.inflight = true;
    this.refresh().catch(e => console.warn('arena poll', e.message)).finally(() => { this.inflight = false; });
  },
  async refresh() {
    const A = this.cfg.arena;
    const [nx, blk] = await Promise.all([this.call(A, calldata(SEL.nextRoundId)), this.rpc('eth_getBlockByNumber', ['latest', false])]);
    // chain clock vs this device: only correct clocks that are clearly off, so viewers stay in step
    const off = parseInt(blk.timestamp, 16) * 1000 - Date.now(); this.offset = Math.abs(off) > 2500 ? off : 0;
    const id = Number(BigInt(nx)) - 1;
    if (id < 1) { this.cur = null; return; }
    const w = words(await this.call(A, calldata(SEL.getRound, w256(id))));
    const n = i => Number(BigInt('0x' + w[i]));
    let r = this.rounds.get(id);
    if (!r) { r = { id, pools: blankPools(), mine: blankPools() }; this.rounds.set(id, r); }
    Object.assign(r, {
      seedHash: '0x' + w[0], a: n(9), b: n(10), stage: n(11), version: n(8), cutBps: n(7), betCount: n(6),
      lockAt: n(4) * 1000 - this.offset, fightAt: n(5) * 1000 - this.offset, winnerSide: n(12),
      status: ['none', 'open', 'started', 'settled', 'cancelled'][n(13)],
    });
    r.seed = n(13) >= 2 && n(13) !== 4 ? '0x' + w[3] : null;
    await Promise.all(CURS.map(async cur => {
      const p = words(await this.call(A, calldata(SEL.pools, w256(id), wAddr(this.tok(cur)))));
      r.pools[cur] = [fromUnits(BigInt('0x' + p[0]), this.dec(cur)), fromUnits(BigInt('0x' + p[1]), this.dec(cur))];
      if (this.acct) {
        const s = words(await this.call(A, calldata(SEL.stakeOf, w256(id), wAddr(this.acct), wAddr(this.tok(cur)))));
        r.mine[cur] = [fromUnits(BigInt('0x' + s[0]), this.dec(cur)), fromUnits(BigInt('0x' + s[1]), this.dec(cur))];
      }
    }));
    if (this.acct) await this.refreshWallet();
    this.cur = r;
  },
  async refreshWallet() {
    const a = this.acct;
    await Promise.all(CURS.map(async cur => {
      const t = this.tok(cur);
      const raw = t === ZERO_ADDR ? await this.rpc('eth_getBalance', [a, 'latest']) : await this.call(t, calldata(SEL.balanceOf, wAddr(a)));
      this.bal[cur] = fromUnits(BigInt(raw), this.dec(cur));
    }));
    // winnings and refunds waiting in rounds this browser bet on
    const cl = [];
    for (const id of this.mine.slice(-12)) for (const cur of CURS) {
      const v = BigInt(await this.call(this.cfg.arena, calldata(SEL.previewClaim, w256(id), wAddr(a), wAddr(this.tok(cur)))));
      if (v > 0n) cl.push({ id, cur, amt: fromUnits(v, this.dec(cur)) });
    }
    this.claimables = cl;
  },

  async connect() {
    const eth = window.ethereum;
    if (!eth) throw new Error('No wallet found. Open this page in a browser with MetaMask or another wallet.');
    const [a] = await eth.request({ method: 'eth_requestAccounts' });
    const want = '0x' + Number(this.cfg.chainId).toString(16);
    if ((await eth.request({ method: 'eth_chainId' })) !== want) {
      try { await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: want }] }); }
      catch (e) {
        if (e.code !== 4902) throw e;
        await eth.request({ method: 'wallet_addEthereumChain', params: [{ chainId: want, chainName: this.cfg.chainName || 'Robinhood Chain',
          nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: [this.cfg.rpc], blockExplorerUrls: this.cfg.explorer ? [this.cfg.explorer] : [] }] });
      }
    }
    this.acct = a.toLowerCase();
    await this.refreshWallet();
    this.pollT = 0;
  },
  async send(to, data, value) {
    const tx = { from: this.acct, to, data }; if (value) tx.value = '0x' + value.toString(16);
    const hash = await window.ethereum.request({ method: 'eth_sendTransaction', params: [tx] });
    for (let i = 0; i < 120; i++) {
      const rc = await this.rpc('eth_getTransactionReceipt', [hash]);
      if (rc) { if (rc.status !== '0x1') throw new Error('Transaction failed'); return rc; }
      await new Promise(r => setTimeout(r, 1000));
    }
    throw new Error('Transaction not confirmed yet: ' + hash);
  },
  async bet(r, side, cur, amt) {
    if (!this.acct) await this.connect();
    if (r.status !== 'open' || Date.now() >= r.lockAt) throw new Error('Bets are closed');
    const A = this.cfg.arena, t = this.tok(cur), v = toUnits(amt, this.dec(cur));
    if (t === ZERO_ADDR) await this.send(A, calldata(SEL.bet, w256(r.id), w256(side)), v);
    else {
      const al = BigInt(await this.call(t, calldata(SEL.allowance, wAddr(this.acct), wAddr(A))));
      if (al < v) await this.send(t, calldata(SEL.approve, wAddr(A), 'f'.repeat(64)));
      await this.send(A, calldata(SEL.betToken, w256(r.id), w256(side), wAddr(t), w256(v)));
    }
    if (!this.mine.includes(r.id)) { this.mine.push(r.id); store.set('arenaMine_' + this.cfg.arena, this.mine.slice(-50)); }
    this.pollT = 0; await this.refresh();
  },
  async claimAll() {
    for (const c of this.claimables) await this.send(this.cfg.arena, calldata(SEL.claim, w256(c.id), wAddr(this.tok(c.cur))));
    await this.refreshWallet();
  },
  // the screen knows the winner as soon as the replay ends; the chain pays once the operator settles
  fightEnded(r, side) {
    r.result = {};
    for (const cur of CURS) {
      const staked = r.mine[cur][0] + r.mine[cur][1]; if (!staked) continue;
      r.result[cur] = claimAmount(r.pools[cur], r.mine[cur], side, r.cutBps) - staked;
    }
  },
  abandon() { },
};

// live config: embedded at build time, or on localhost `#arena:local` loads the anvil test deploy
if (typeof ARENA_LIVE !== 'undefined') ChainHouse.cfg = ARENA_LIVE;
else if (/^(127\.0\.0\.1|localhost)$/.test(location.hostname) && /local/.test(location.hash))
  ChainHouse.ready = fetch('arena/test/local_deploy.json').then(r => r.json()).then(c => { c.chainName = 'Local test chain'; ChainHouse.cfg = c; }).catch(() => {});
