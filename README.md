# Brawl Street

**A 3D browser fighter where every bot fight is a provably fair prediction market on Robinhood Chain, in ETH and USDG.**

Brawl Street is a 3D platform fighter that runs in the browser. Its arena, the UFM (United Fighting
Memes), runs bot-vs-bot fights around the clock. People back a side in ETH or USDG, and anyone can
replay any fight from chain data to check the winner.

- **Play:** `play/index.html`. Serve the folder with any static server.
- **Contracts:** `chain/`. Foundry project: `RektArena.sol` (the arena) and `BrawlEscrow.sol` (player-vs-player stakes).
- **Arena runtime:** `arena/`. `operator.js` runs rounds, `verify.js` replays any round, `fightsim.js` is the headless engine.
- **Online play:** `net/`. Lobby, rooms, lockstep input relay, and a server-side replay of every match.

## Why you can trust a fight

```
 operator                     RektArena (Robinhood Chain)                   everyone
 ────────                     ───────────────────────────                   ────────
 commit keccak(serverSeed) ─▶ round open, 45 s of betting    ◀── bet(side) in ETH / USDG
                                every bet folds into betsHash
 reveal serverSeed ─────────▶ fightSeed = keccak(serverSeed, betsHash, id)
                              fightStart = now + 5 s         ──▶ every browser runs the same fight
 settle(winner) ────────────▶ pools pay out                  ◀── claim()
                                                              ──▶ verify.js replays it and checks
 (stalls an hour?) ─────────▶ anyone calls expire(): full refund
```

1. **Nobody can steer the outcome.** The operator commits to its seed before any bet exists. The fight seed mixes in `betsHash`, so the operator can't pick a winner, and a late bettor can't know the fight in advance.
2. **The same fight runs on every machine.**
   - Fight code uses a seeded sfc32 RNG.
   - `sin` and `cos` are built from `+ − × ÷` only, because JS engines disagree on the last bit of `Math.sin`.
   - The same 1,092 test fights (every matchup on every stage) played out identically in V8 (Chrome, Node) and JavaScriptCore (Safari): same winner, same frame count, same path hash.
3. **Anyone can check any round:** `node arena/verify.js <rpc> <arena> <roundId>`.
4. **Your money isn't stuck if the operator disappears.** An hour after lock, anyone can trigger a full refund.

## Run it

```bash
# the game
python3 -m http.server 8000        # then open http://localhost:8000/play/

# contracts: 70 tests (41 RektArena, 29 BrawlEscrow), incl. fuzzing and reentrancy
cd chain && forge test

# determinism: same seeds forwards and backwards must give identical fights
cd arena && npm i && node test/det_node.js

# full loop on a private anvil chain: deploy, run the real operator, 5 wallets bet in
# several currencies, every claim checked against an independent payout calculation, every round verified
node test/e2e_local.js 2
```

## Deployments

<!-- testnet:begin -->
Robinhood Chain testnet (46630): deploy pending.
<!-- testnet:end -->

On testnet, where USDG isn't deployed, the arena uses a USDG stand-in with a public hourly
`faucet()`. On mainnet it takes Paxos USDG (`0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`).

## What's next
- **UFM fight nights:** community-versus-community cards.
- **A 24/7 arena stream.**
- **A free version on web game portals** (package already built), bringing Web2 players to the brand.
- **Settlement without trusting the operator:**
  - an optimistic settle with a challenge window;
  - then the fight engine ported to Rust with Arbitrum Stylus (live on Robinhood Chain), so the
    chain itself replays a disputed fight.
