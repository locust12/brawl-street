// Operator side of BrawlEscrow (chain/src/BrawlEscrow.sol). Loaded only when REAL_MONEY=1.
// The operator key opens matches, reports the replay-verified winner and cancels; it never holds stakes.
const { createPublicClient, createWalletClient, http, defineChain, verifyMessage, getAddress } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');

const ABI = [
  { type: 'function', name: 'open', stateMutability: 'nonpayable', inputs: [{ name: 'id', type: 'bytes32' }, { name: 'players', type: 'address[]' }, { name: 'stake', type: 'uint128' }, { name: 'window', type: 'uint64' }], outputs: [] },
  { type: 'function', name: 'report', stateMutability: 'nonpayable', inputs: [{ name: 'id', type: 'bytes32' }, { name: 'winner', type: 'address' }, { name: 'replayHash', type: 'bytes32' }], outputs: [] },
  { type: 'function', name: 'cancel', stateMutability: 'nonpayable', inputs: [{ name: 'id', type: 'bytes32' }], outputs: [] },
  { type: 'function', name: 'getMatch', stateMutability: 'view', inputs: [{ name: 'id', type: 'bytes32' }], outputs: [{ name: '', type: 'tuple', components: [
    { name: 'stake', type: 'uint128' }, { name: 'depositDeadline', type: 'uint64' }, { name: 'fundedAt', type: 'uint64' }, { name: 'status', type: 'uint8' },
    { name: 'playerCount', type: 'uint8' }, { name: 'depositCount', type: 'uint8' }, { name: 'paid', type: 'bool' }, { name: 'cutBps', type: 'uint16' },
    { name: 'winner', type: 'address' }, { name: 'replayHash', type: 'bytes32' }] }] },
  { type: 'function', name: 'operator', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
];

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

class Escrow {
  constructor({ rpc, chainId, address, operatorKey, chainName, explorer }) {
    if (!rpc || !chainId || !address || !operatorKey) throw new Error('REAL_MONEY=1 needs CHAIN_RPC, CHAIN_ID, ESCROW_ADDRESS and OPERATOR_KEY');
    this.rpc = rpc; this.chainId = chainId; this.address = getAddress(address); this.chainName = chainName || 'Robinhood Chain'; this.explorer = explorer || '';
    const chain = defineChain({ id: chainId, name: this.chainName, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
    this.account = privateKeyToAccount(operatorKey);
    this.pub = createPublicClient({ chain, transport: http(rpc) });
    this.wallet = createWalletClient({ chain, transport: http(rpc), account: this.account });
    this.pending = [];       // {lane, seq, fn, args, deadline, res, rej}
    this.busy = false;
    this.seq = 0;
    this.sent = { open: 0, report: 0, cancel: 0, stale: 0, failed: 0 };
  }
  info() { return { chainId: this.chainId, chainName: this.chainName, rpc: this.rpc, escrow: this.address, explorer: this.explorer }; }
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
          const hash = await this.wallet.writeContract({ address: this.address, abi: ABI, functionName: it.fn, args: it.args });
          const rc = await this.pub.waitForTransactionReceipt({ hash, timeout: 120000 });
          if (rc.status !== 'success') throw new Error(it.fn + ' reverted ' + hash);
          this.sent[it.fn] = (this.sent[it.fn] || 0) + 1;
          it.res(hash);
        } catch (e) { this.sent.failed++; it.rej(e); }
      }
    } finally { this.busy = false; }
  }
  // ttlMs: give up rather than send a stale open. Defaults to the deposit window.
  open(id, players, stakeWei, windowSecs, ttlMs) { return this.send('open', [id, players.map(a => getAddress(a)), BigInt(stakeWei), BigInt(windowSecs)], LANE_OPEN, ttlMs || windowSecs * 1000); }
  report(id, winner, replayHash) { return this.send('report', [id, getAddress(winner), replayHash], LANE_SETTLE); }
  cancel(id) { return this.send('cancel', [id], LANE_SETTLE); }
  async getMatch(id) { const m = await this.pub.readContract({ address: this.address, abi: ABI, functionName: 'getMatch', args: [id] }); return { status: Number(m.status), depositCount: Number(m.depositCount), playerCount: Number(m.playerCount), winner: m.winner, paid: m.paid }; }
  verify(address, message, signature) { return verifyMessage({ address: getAddress(address), message, signature }); }
}

module.exports = { Escrow, ABI, LANE_SETTLE, LANE_OPEN };
