// Operator side of BrawlEscrow (chain/src/BrawlEscrow.sol). Loaded only when REAL_MONEY=1.
// The operator key opens matches, reports the replay-verified winner and cancels; it never holds stakes.
const { createPublicClient, createWalletClient, http, defineChain, verifyMessage, getAddress } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');

// Two escrows exist and they differ only in how a stake arrives: BrawlEscrow takes native ETH via a
// payable deposit(), BrawlEscrowToken takes an ERC20 the match was opened for. Set ESCROW_TOKEN to
// run the token one. `open` is the only operator call whose signature differs.
const ABI = [
  { type: 'function', name: 'open', stateMutability: 'nonpayable', inputs: [{ name: 'id', type: 'bytes32' }, { name: 'players', type: 'address[]' }, { name: 'stake', type: 'uint128' }, { name: 'window', type: 'uint64' }], outputs: [] },
  { type: 'function', name: 'report', stateMutability: 'nonpayable', inputs: [{ name: 'id', type: 'bytes32' }, { name: 'winner', type: 'address' }, { name: 'replayHash', type: 'bytes32' }], outputs: [] },
  { type: 'function', name: 'cancel', stateMutability: 'nonpayable', inputs: [{ name: 'id', type: 'bytes32' }], outputs: [] },
  { type: 'function', name: 'getMatch', stateMutability: 'view', inputs: [{ name: 'id', type: 'bytes32' }], outputs: [{ name: '', type: 'tuple', components: [
    { name: 'stake', type: 'uint128' }, { name: 'depositDeadline', type: 'uint64' }, { name: 'fundedAt', type: 'uint64' }, { name: 'status', type: 'uint8' },
    { name: 'playerCount', type: 'uint8' }, { name: 'depositCount', type: 'uint8' }, { name: 'paid', type: 'bool' }, { name: 'cutBps', type: 'uint16' },
    { name: 'winner', type: 'address' }, { name: 'replayHash', type: 'bytes32' }] }] },
  { type: 'function', name: 'operator', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'cutBps', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint16' }] },
];
// BrawlEscrowToken.open takes the token the match is played for, between the players and the stake.
const MATCH_TOKEN = { type: 'function', name: 'getMatch', stateMutability: 'view', inputs: [{ name: 'id', type: 'bytes32' }], outputs: [{ name: '', type: 'tuple', components: [
  { name: 'stake', type: 'uint128' }, { name: 'depositDeadline', type: 'uint64' }, { name: 'fundedAt', type: 'uint64' }, { name: 'status', type: 'uint8' },
  { name: 'playerCount', type: 'uint8' }, { name: 'depositCount', type: 'uint8' }, { name: 'paid', type: 'bool' }, { name: 'cutBps', type: 'uint16' },
  { name: 'winner', type: 'address' }, { name: 'token', type: 'address' }, { name: 'replayHash', type: 'bytes32' }] }] };
const ABI_TOKEN = ABI.filter(e => e.name !== 'getMatch').concat([MATCH_TOKEN,
  { type: 'function', name: 'openToken', stateMutability: 'nonpayable', inputs: [{ name: 'id', type: 'bytes32' }, { name: 'players', type: 'address[]' }, { name: 'token', type: 'address' }, { name: 'stake', type: 'uint128' }, { name: 'window', type: 'uint64' }], outputs: [] },
  { type: 'function', name: 'tokenAllowed', stateMutability: 'view', inputs: [{ name: '', type: 'address' }], outputs: [{ name: '', type: 'bool' }] },
]).map(e => (e.name === 'openToken' ? Object.assign({}, e, { name: 'open' }) : e)).filter((e, i, a) =>
  // keep the token `open`, drop the native one
  !(e.name === 'open' && e.inputs.length === 4));

// Transaction lanes. Every operator transaction is serialised (one nonce at a time), but they are
// NOT first-come-first-served: a SETTLE always overtakes any queued OPEN.
//
// Why (finding H5): `open` is sent the moment two players ready up in a real-ETH room, and it is
// paid for by the operator. Two sock-puppet wallets looping ready/unready generate opens as fast as
// the chain will take them. With a single FIFO queue that flood also pushes legitimate `report`
// calls down the line, and a settlement that misses BrawlEscrow's 2 h REPORT_TIMEOUT lets the loser
// cancel() out from under the winner. Priority ordering means the flood can waste the operator's
// gas (bounded separately, in server.js) but can never delay a payout.
const LANE_SETTLE = 0;   // report / cancel — money already in escrow, always goes first
const LANE_OPEN = 1;     // open — speculative, triggered by a player action, expendable
// How many times a transaction that failed for a reason the chain did not give is sent again, and the
// step between attempts. A revert is never retried (see _pump).
const OP_TRIES = +process.env.OPERATOR_TRIES || 4;
const OP_BACKOFF_MS = +process.env.OPERATOR_BACKOFF_MS || 1500;

class Escrow {
  constructor({ rpc, chainId, address, operatorKey, chainName, explorer, token, tokenSymbol, tokenDecimals }) {
    if (!rpc || !chainId || !address || !operatorKey) throw new Error('REAL_MONEY=1 needs CHAIN_RPC, CHAIN_ID, ESCROW_ADDRESS and OPERATOR_KEY');
    this.rpc = rpc; this.chainId = chainId; this.address = getAddress(address); this.chainName = chainName || 'Robinhood Chain'; this.explorer = explorer || '';
    // a token escrow: every match is opened for this ERC20 and players deposit it, never ETH
    this.token = token ? getAddress(token) : null;
    this.tokenSymbol = tokenSymbol || 'USDC';
    this.tokenDecimals = tokenDecimals == null ? 6 : Number(tokenDecimals);
    this.abi = this.token ? ABI_TOKEN : ABI;
    const chain = defineChain({ id: chainId, name: this.chainName, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
    this.account = privateKeyToAccount(operatorKey);
    this.pub = createPublicClient({ chain, transport: http(rpc) });
    this.wallet = createWalletClient({ chain, transport: http(rpc), account: this.account });
    this.pending = [];       // {lane, seq, fn, args, deadline, res, rej}
    this.busy = false;
    this.seq = 0;
    this.sent = { open: 0, report: 0, cancel: 0, stale: 0, failed: 0, retried: 0 };
    this.log = (...a) => { if (process.env.QUIET !== '1') console.log('[escrow]', ...a); };
    // The cut, read off the contract rather than configured here, so the page can tell a winner what
    // they will actually receive instead of the gross pot. Null until the first read answers; a
    // page that connects before then simply gets no figure rather than a wrong one.
    this.cutBps = null;
    this.readCut();
  }
  // Keeps trying: an RPC that is flaky for the first minute must not leave every page for the rest of
  // the process's life showing a payout figure that is 5% too high.
  async readCut() {
    for (let i = 0; ; i++) {
      try { this.cutBps = Number(await this.pub.readContract({ address: this.address, abi: this.abi, functionName: 'cutBps' })); return; }
      catch (e) { await new Promise(r => setTimeout(r, Math.min(60e3, 2000 * Math.pow(2, Math.min(i, 5))))); }
    }
  }
  info() {
    return { chainId: this.chainId, chainName: this.chainName, rpc: this.rpc, escrow: this.address, explorer: this.explorer,
      token: this.token, tokenSymbol: this.tokenSymbol, tokenDecimals: this.tokenDecimals, cutBps: this.cutBps };
  }
  // How much work is waiting, per lane. server.js refuses to open new funding when the open lane is
  // already backed up, so a flood cannot keep growing.
  depth(lane) { return lane === undefined ? this.pending.length : this.pending.filter(p => p.lane === lane).length; }
  stats() { return Object.assign({ queued: this.pending.length, queuedOpen: this.depth(LANE_OPEN), queuedSettle: this.depth(LANE_SETTLE) }, this.sent); }
  // Operator gas. Watched by server.js so a drained operator is noticed before it stops settling.
  async balance() { return this.pub.getBalance({ address: this.account.address }); }
  get operatorAddress() { return this.account.address; }

  send(fn, args, lane = LANE_SETTLE, ttlMs = 0) {
    return new Promise((res, rej) => {
      this.pending.push({ lane, seq: this.seq++, fn, args, deadline: ttlMs ? Date.now() + ttlMs : 0, res, rej });
      this._pump();
    });
  }
  _next() {
    // Re-sorted on every dequeue, not once on insert: a settlement that arrives while an earlier
    // transaction is still in flight must overtake the opens already sitting in the queue.
    this.pending.sort((a, b) => a.lane - b.lane || a.seq - b.seq);
    return this.pending.shift();
  }
  async _pump() {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.pending.length) {
        const it = this._next();
        // An `open` whose funding window has already closed is pointless: sending it would spend gas
        // on a match nobody can deposit into. Drop it instead. This is what makes a funding flood
        // self-limiting rather than an unbounded gas bill.
        if (it.deadline && Date.now() > it.deadline) { this.sent.stale++; it.rej(new Error(it.fn + ' dropped: queued past its deadline')); continue; }
        try {
          const hash = await this.wallet.writeContract({ address: this.address, abi: this.abi, functionName: it.fn, args: it.args });
          const rc = await this.pub.waitForTransactionReceipt({ hash, timeout: 120000 });
          if (rc.status !== 'success') { const err = new Error(it.fn + ' reverted ' + hash); err.reverted = true; throw err; }
          this.sent[it.fn] = (this.sent[it.fn] || 0) + 1;
          it.res(hash);
        } catch (e) {
          // ONE FLAKY RPC CALL USED TO COST SOMEBODY THEIR WINNINGS. A `report` that threw was
          // rejected and never sent again, so the pot sat in the escrow until REPORT_TIMEOUT and
          // every player was refunded -- which for the winner is losing a fight they won. Arbitrum's
          // public endpoints time out and prune, and two servers sharing one operator key collide on
          // the nonce, so a transient failure is expected rather than exceptional.
          //
          // A REVERT is different and is never retried: the chain considered the call and refused it
          // (already settled, not open, not the operator), and sending it again would only burn gas.
          const transient = !e.reverted && (it.tries || 0) < OP_TRIES;
          if (transient) {
            it.tries = (it.tries || 0) + 1;
            this.sent.retried = (this.sent.retried || 0) + 1;
            this.log(it.fn + ' failed (' + String(e && e.message).split('\n')[0] + '), retry ' + it.tries + '/' + OP_TRIES);
            await new Promise(r => setTimeout(r, OP_BACKOFF_MS * it.tries));
            this.pending.push(it);
            continue;
          }
          this.sent.failed++; it.rej(e);
        }
      }
    } finally { this.busy = false; }
  }
  // ttlMs: give up rather than send a stale open. Defaults to the deposit window.
  open(id, players, stake, windowSecs, ttlMs) {
    const who = players.map(a => getAddress(a));
    const args = this.token ? [id, who, this.token, BigInt(stake), BigInt(windowSecs)] : [id, who, BigInt(stake), BigInt(windowSecs)];
    return this.send('open', args, LANE_OPEN, ttlMs || windowSecs * 1000);
  }
  report(id, winner, replayHash) { return this.send('report', [id, getAddress(winner), replayHash], LANE_SETTLE); }
  cancel(id) { return this.send('cancel', [id], LANE_SETTLE); }
  async getMatch(id) { const m = await this.pub.readContract({ address: this.address, abi: this.abi, functionName: 'getMatch', args: [id] }); return { status: Number(m.status), depositCount: Number(m.depositCount), playerCount: Number(m.playerCount), winner: m.winner, paid: m.paid }; }
  verify(address, message, signature) { return verifyMessage({ address: getAddress(address), message, signature }); }
}

module.exports = { Escrow, ABI, LANE_SETTLE, LANE_OPEN };
