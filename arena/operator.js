// Rekt Brawl arena operator. Opens a round with a committed seed, reveals the seed when betting
// locks, replays the fight with the exact engine the page runs (fightsim.js) and settles the
// winner once the fight has finished on screen. The operator key never bets.
//
// env: RPC_URL, ARENA (contract), OPERATOR_KEY (0x…), CHAIN_ID (4663), BET_SECS (45),
//      GAP_SECS (10, pause between a result and the next round), SEED_DIR (./seeds)
// Seeds are written to disk BEFORE the round opens, so a restart can still reveal them.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { createPublicClient, createWalletClient, http, keccak256, defineChain } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const FightSim = require('./fightsim.js');
const ABI = require('../chain/abi/RektArena.json');

const env = k => { const v = process.env[k]; if (!v) { console.error('missing env ' + k); process.exit(1); } return v; };
const RPC = env('RPC_URL'), ARENA = env('ARENA'), KEY = env('OPERATOR_KEY');
const CHAIN_ID = +(process.env.CHAIN_ID || 4663), BET_SECS = +(process.env.BET_SECS || 45), GAP_SECS = +(process.env.GAP_SECS || 10);
const SEED_DIR = path.resolve(process.env.SEED_DIR || path.join(__dirname, 'seeds'));
fs.mkdirSync(SEED_DIR, { recursive: true });

const chain = defineChain({ id: CHAIN_ID, name: 'arena-chain', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const account = privateKeyToAccount(KEY);
const pub = createPublicClient({ chain, transport: http(RPC), pollingInterval: 500 });
const wal = createWalletClient({ chain, account, transport: http(RPC) });
const read = (functionName, args = []) => pub.readContract({ address: ARENA, abi: ABI, functionName, args });
async function send(functionName, args) {
  const hash = await wal.writeContract({ address: ARENA, abi: ABI, functionName, args });
  const rc = await pub.waitForTransactionReceipt({ hash });
  if (rc.status !== 'success') throw new Error(functionName + ' reverted ' + hash);
  return rc;
}
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const STATUS = ['None', 'Open', 'Started', 'Settled', 'Cancelled'];
const seedFile = h => path.join(SEED_DIR, h.toLowerCase() + '.hex');

let finalSeenAt = new Map(), results = new Map(), cutsDone = new Set(), busy = false;

async function openRound(now) {
  if (await read('paused')) return;
  const seed = '0x' + crypto.randomBytes(32).toString('hex'), seedHash = keccak256(seed);
  fs.writeFileSync(seedFile(seedHash), seed);                        // commit to disk first
  const n = FightSim.ARENA.roster.length, a = crypto.randomInt(n);
  let b = crypto.randomInt(n - 1); if (b >= a) b++;
  const stage = crypto.randomInt(FightSim.ARENA.stages.length);
  await send('openRound', [seedHash, a, b, stage, FightSim.version, BigInt(now + BET_SECS)]);
  log(`open  ${FightSim.ARENA.roster[a]} vs ${FightSim.ARENA.roster[b]} on ${FightSim.ARENA.stages[stage]}, bets ${BET_SECS}s`);
}

async function tick() {
  const now = Number((await pub.getBlock({ blockTag: 'latest' })).timestamp);
  const id = (await read('nextRoundId')) - 1n;
  if (id === 0n) return openRound(now);
  const r = await read('getRound', [id]), st = STATUS[r.status];

  if (st === 'Open' && now >= Number(r.lockTime)) {
    const f = seedFile(r.seedHash);
    if (!fs.existsSync(f)) { log(`round ${id}: seed lost, cancelling so bets refund`); return send('cancel', [id]); }
    await send('startFight', [id, fs.readFileSync(f, 'utf8').trim()]);
    return log(`round ${id}: bets locked (${r.betCount} bets), seed revealed`);
  }
  if (st === 'Started') {
    if (r.simVersion !== FightSim.version) { log(`round ${id}: sim v${r.simVersion} != v${FightSim.version}, cancelling`); return send('cancel', [id]); }
    let res = results.get(id);
    if (!res) { res = FightSim.runFight(r.fightSeed, r.fighterA, r.fighterB, r.stage); results.set(id, res); log(`round ${id}: ${res.winnerId} wins in ${(res.ticks / 60).toFixed(0)}s (hash ${res.hash})`); }
    const endAt = Math.max(Number(r.fightStart) + Math.ceil(res.ticks / 60) + 1, Number(r.fightStart) + 20);
    if (now >= endAt) { await send('settle', [id, res.winner]); log(`round ${id}: settled, side ${res.winner}`); }
    return;
  }
  if (st === 'Settled' && !cutsDone.has(id)) {
    cutsDone.add(id);
    for (const t of await tokens()) if (await read('previewCut', [id, t]) > 0n) await send('collectCut', [id, t]).catch(e => log('collectCut', t, e.shortMessage || e.message));
  }
  if (st === 'Settled' || st === 'Cancelled') {
    if (!finalSeenAt.has(id)) finalSeenAt.set(id, Date.now());
    if (Date.now() - finalSeenAt.get(id) >= GAP_SECS * 1000) return openRound(now);
  }
}
let tokenList = null;
async function tokens() {
  if (!tokenList) tokenList = ['0x0000000000000000000000000000000000000000', ...(process.env.TOKENS || '').split(',').filter(Boolean)];
  return tokenList;
}

async function main() {
  if ((await read('operator')).toLowerCase() !== account.address.toLowerCase()) { console.error('this key is not the arena operator'); process.exit(1); }
  log(`operator ${account.address} on ${ARENA} (chain ${CHAIN_ID}), sim v${FightSim.version}`);
  for (;;) {
    if (!busy) { busy = true; try { await tick(); } catch (e) { log('error', e.shortMessage || e.message); } busy = false; }
    await new Promise(r => setTimeout(r, 1000));
  }
}
if (require.main === module) main();
