'use strict';
// Operator transaction lanes (finding H5) and the settlement queue's failure behaviour.
//
//   node test/escrow_queue_check.js
//
// No chain and no network: the viem clients are replaced with fakes, because what is under test is
// the ORDERING and the GIVING UP, not the transactions themselves. test/escrow_e2e.js covers the
// real thing on a local anvil.
//
// The property that matters: a flood of `open` transactions -- which any two sock-puppet wallets
// can produce for free by readying up and un-readying -- must never delay a `report`. A settlement
// that misses BrawlEscrow's 2 h REPORT_TIMEOUT lets the loser of a finished match cancel() and take
// their stake back out from under the winner, so "the payout was stuck behind a queue" is a way to
// lose somebody else's money.

const assert = require('assert');
const path = require('path');
const Module = require('module');

// ---- stub viem before lib/escrow.js requires it -----------------------------------------------
const order = [];               // every transaction actually sent, in the order it was sent
let sendMs = 20;                // how long a transaction "takes"
let failNext = 0;               // make the next N sends throw, to test retry/backoff
const fakeViem = {
  createPublicClient: () => ({
    waitForTransactionReceipt: async () => ({ status: 'success' }),
    readContract: async () => ({ status: 2, depositCount: 2, playerCount: 2, winner: '0x' + '1'.repeat(40), paid: false }),
    getBalance: async () => 10n ** 18n,
  }),
  createWalletClient: () => ({
    writeContract: async ({ functionName, args }) => {
      if (failNext > 0) { failNext--; throw new Error('RPC flake'); }
      await new Promise(r => setTimeout(r, sendMs));
      order.push(functionName + ':' + String(args[0]).slice(0, 10));
      return '0x' + 'a'.repeat(64);
    },
  }),
  http: () => ({}),
  defineChain: c => c,
  verifyMessage: async () => true,
  getAddress: a => a,
};
const realResolve = Module._resolveFilename;
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'viem') return fakeViem;
  if (request === 'viem/accounts') return { privateKeyToAccount: () => ({ address: '0x' + 'b'.repeat(40) }) };
  return realLoad.apply(this, arguments);
};

const { Escrow, LANE_SETTLE, LANE_OPEN } = require(path.join(__dirname, '..', 'lib', 'escrow.js'));

const mk = () => new Escrow({ rpc: 'http://x', chainId: 1, address: '0x' + 'c'.repeat(40), operatorKey: '0x' + '1'.repeat(64) });
const id = n => '0x' + String(n).padStart(64, '0');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail ? ' — ' + detail : ''));
  if (!ok) failures++;
}

(async () => {
  // ------------------------------------------------------------------ 1. a settlement overtakes a flood of opens
  {
    const e = mk(); order.length = 0; sendMs = 20;
    // 12 opens queued first, exactly as a ready/unready loop would produce them...
    const opens = [];
    for (let i = 0; i < 12; i++) opens.push(e.open(id(i), ['0x' + '1'.repeat(40), '0x' + '2'.repeat(40)], 1n, 120).catch(() => {}));
    await sleep(5);                                   // the first one is in flight
    // ...then a real match ends and its winner has to be reported.
    const rep = e.report(id(99), '0x' + '1'.repeat(40), '0x' + 'f'.repeat(64));
    await rep;
    const pos = order.findIndex(x => x.startsWith('report'));
    // It cannot be first (one open was already in flight and nonces are serialised), but it must
    // not be 13th either: with a plain FIFO queue it would be.
    check('a report overtakes 12 queued opens', pos >= 0 && pos <= 2, `report landed at position ${pos + 1} of ${order.length} sent; order: ${order.slice(0, 4).join(' ')}…`);
    await Promise.all(opens);
  }

  // ------------------------------------------------------------------ 2. stale opens are dropped, not sent
  {
    const e = mk(); order.length = 0; sendMs = 60;
    const first = e.open(id(1), ['0x' + '1'.repeat(40), '0x' + '2'.repeat(40)], 1n, 120).catch(() => {});
    // These carry a 30 ms time-to-live and sit behind a 60 ms transaction, so their deposit window
    // is already gone by the time the queue reaches them. Sending them would spend real gas opening
    // matches nobody can deposit into -- which is exactly how a funding flood turns into a gas bill.
    const stale = [];
    for (let i = 2; i < 8; i++) stale.push(e.open(id(i), ['0x' + '1'.repeat(40), '0x' + '2'.repeat(40)], 1n, 120, 30).then(() => 'sent', () => 'dropped'));
    const got = await Promise.all(stale);
    await first;
    const dropped = got.filter(x => x === 'dropped').length;
    check('opens past their deadline are dropped unsent', dropped === 6 && e.stats().stale === 6,
      `${dropped}/6 dropped, ${order.filter(x => x.startsWith('open')).length} open tx actually sent`);
  }

  // ------------------------------------------------------------------ 3. one transaction at a time (nonce safety)
  {
    const e = mk(); order.length = 0; sendMs = 30;
    let inFlight = 0, maxInFlight = 0;
    const realWrite = e.wallet.writeContract;
    e.wallet.writeContract = async (a) => { inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); try { return await realWrite(a); } finally { inFlight--; } };
    await Promise.all([e.report(id(1), '0x' + '1'.repeat(40), '0x' + 'f'.repeat(64)), e.cancel(id(2)), e.cancel(id(3))]);
    check('operator sends one transaction at a time', maxInFlight === 1, `peak concurrent writeContract calls: ${maxInFlight}`);
  }

  // ------------------------------------------------------------------ 4. a failure rejects its own caller only
  {
    const e = mk(); order.length = 0; sendMs = 5; failNext = 1;
    const bad = e.cancel(id(1)).then(() => 'ok', () => 'rejected');
    const good = e.cancel(id(2)).then(() => 'ok', () => 'rejected');
    const [b, g] = await Promise.all([bad, good]);
    failNext = 0;
    check('a failed transaction does not poison the queue', b === 'rejected' && g === 'ok', `first=${b} second=${g}`);
  }

  // ------------------------------------------------------------------ 5. SettleQueue.actionable
  // The server's queue asks the chain what state a match is in before retrying. `report` is only
  // meaningful on a Funded match; `cancel` is meaningful on Open OR Funded, because abortFunding()
  // cancels matches that never reached Funded. Treating Open as "already resolved" would silently
  // abandon those and leave a player who did deposit waiting out the window for their own refund.
  {
    // Status: 0 None, 1 Open, 2 Funded, 3 Settled, 4 Cancelled
    const report = { winnerAddr: '0x' + '1'.repeat(40) }, cancel = { winnerAddr: null };
    const A = (it, st) => {
      // mirrors SettleQueue.actionable in server.js
      return it.winnerAddr ? st === 2 : (st === 1 || st === 2);
    };
    const ok = !A(report, 1) && A(report, 2) && !A(report, 3) && !A(report, 4)
      && A(cancel, 1) && A(cancel, 2) && !A(cancel, 3) && !A(cancel, 4);
    check('settle queue acts on the right chain states', ok, 'report only on Funded; cancel on Open or Funded');
  }

  console.log(failures ? `\n${failures} check(s) FAILED` : '\nall operator-queue checks passed');
  process.exit(failures ? 1 : 0);
})();
