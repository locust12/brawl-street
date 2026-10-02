// Check any settled round from scratch: the seed matches its commitment, the fight seed is built
// from every bet placed, and replaying the fight gives the winner the operator settled.
// usage: node verify.js <rpc> <arena> <roundId>
const { createPublicClient, http, keccak256, encodeAbiParameters } = require('viem');
const FightSim = require('./fightsim.js');
const ABI = require('../chain/abi/RektArena.json');

async function verify(rpc, arena, id) {
  const pub = createPublicClient({ transport: http(rpc) });
  const r = await pub.readContract({ address: arena, abi: ABI, functionName: 'getRound', args: [BigInt(id)] });
  const out = { round: id, status: ['None', 'Open', 'Started', 'Settled', 'Cancelled'][r.status], checks: {} };
  if (r.status < 2) return { ...out, note: 'fight not started yet' };
  out.checks.seedMatchesCommit = keccak256(r.serverSeed) === r.seedHash;

  const logs = await pub.getContractEvents({ address: arena, abi: ABI, eventName: 'BetPlaced', args: { id: BigInt(id) }, fromBlock: 0n });
  let h = '0x' + '0'.repeat(64);
  logs.forEach((l, n) => {
    h = keccak256(encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'address' }, { type: 'uint8' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint32' }],
      [h, l.args.user, l.args.side, l.args.token, l.args.amount, n]));
  });
  out.checks.betsHashMatchesBets = h === r.betsHash;
  // Must match RektArena.sol:341 exactly: keccak256(abi.encode(serverSeed, id, address(this))).
  // 9/27: this recomputed the ORIGINAL formula, keccak256(serverSeed, betsHash, id). The contract
  // dropped betsHash from the seed (M-fix, header line 69) so the operator could not grind it, and
  // added address(this) for cross-deployment separation -- but the verifier was never updated, so
  // fightSeedMatches read false on every round against the current contract. The public "anyone can
  // check this" promise was broken for as long as that was true.
  out.checks.fightSeedMatches = keccak256(encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }], [r.serverSeed, BigInt(id), arena])) === r.fightSeed;

  if (r.simVersion !== FightSim.version) return { ...out, note: `round used sim v${r.simVersion}; this build is v${FightSim.version}` };
  const res = FightSim.runFight(r.fightSeed, r.fighterA, r.fighterB, r.stage);
  out.replay = { winner: res.winnerId, side: res.winner, seconds: Math.round(res.ticks / 60), hash: res.hash };
  if (r.status === 3) out.checks.winnerMatchesSettle = res.winner === r.winnerSide;
  out.ok = Object.values(out.checks).every(Boolean);
  return out;
}
module.exports = { verify };
if (require.main === module) {
  const [rpc, arena, id] = process.argv.slice(2);
  if (!id) { console.error('usage: node verify.js <rpc> <arena> <roundId>'); process.exit(1); }
  verify(rpc, arena, id).then(o => { console.log(JSON.stringify(o, null, 2)); process.exit(o.ok === false ? 1 : 0); });
}
