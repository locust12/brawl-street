# Brawl Street — the rake, staking, referrals

Internal spec. Numbers here are stated in full on purpose; none of them go on the public site.
Nothing in here is deployed.

---

## 1. Where the 3% is taken

**Decision: on the pot, at settlement. Not on deposit. Not on withdrawal.**

This is the one that matters, so here is the reasoning rather than just the answer.

### The three places you could take it

| Where | What it actually taxes | Who does it |
|---|---|---|
| **On deposit** | money that has not been played yet | payment processors, some casinos |
| **On withdrawal** | money on the way out, including money that was never at risk | almost nobody reputable |
| **On the pot, at settlement** | exactly what was wagered | poker rooms, sportsbooks, every skill-wager platform |

Deposit and withdrawal are the wrong places for three reasons:

1. **They tax the wrong thing.** A player who deposits 1 ETH, plays nothing and leaves should get
   1 ETH back. Take on deposit and withdrawal and he leaves with 0.94 — you charged him for
   nothing. That is the single most common reason a game gets called a scam on day two.
2. **Charging both is double-dipping** and players notice immediately. Every serious operator
   charges in one place.
3. **It does not scale with play.** You want revenue to track how much the game is *used*, not how
   much money walks through the door. Someone who deposits once and plays 500 matches is your best
   player and pays almost nothing under a deposit model.

### What "3% of every wagered amount" works out to

1v1, both players stake **S**:

```
pot            = 2S          <- the wagered amount
cut  = 3% of pot = 0.06S
winner takes   = 1.94S       <- profit 0.94S instead of 1.00S
```

So 3% of the handle is **6% of a winner's profit**. That is the number a player feels, and it is
worth knowing before you set it, because it is the number that gets compared.

### Where 3% sits against the field

| | Effective take on handle |
|---|---|
| Crypto casino house edge (Stake, Rollbit) | 1–2% |
| Sportsbook vig | ~4.5% |
| Online poker rake | ~5%, capped |
| Skill-wager platforms (Skillz and similar) | 10–15% |
| Parimutuel horse racing takeout | 15–20% |

**3% is defensible and on the low side for a skill-wager game.** It is not the cheapest number on
the board, but it is nowhere near the aggressive end. You have room to go up later; going *down*
later is much better received than going up, so 3% is a sensible place to start.

### Already built

`BrawlEscrow.sol` (written, tested, not deployed) already does exactly this:

```solidity
uint256 pot    = stake * playerCount;
uint256 cut    = pot * m.cutBps / 10000;   // m.cutBps snapshotted when the match opened
uint256 amount = pot - cut;
```

Three properties worth keeping:

- `MAX_CUT_BPS = 1000` — a hard 10% ceiling in the bytecode. Nobody, including us, can ever set
  the rake to 40%.
- `cutBps` is **snapshotted at `open()`**. Raising the rake can never change the terms of a match
  that is already running.
- The cut is held in `cutBalance` and pulled with `withdrawCut()`, so a treasury problem can never
  block a winner's claim.

To switch it on: `setCut(300)`.

### The spectator arena is different on purpose

`RektArena.sol` is parimutuel — people back fighter A or B and the winning side splits the losing
side's pool. There, the cut comes off the **losing pool only**, not the total. That means a winner
can never get back less than they put in. Textbook parimutuel takes it off the total pool, which
can hand a winner back less than their own stake when they backed a heavy favourite — correct at a
racetrack, poison in crypto. `setCutBps(300)` there is 3% of the losing pool, which is ~1.5% of
total handle at balanced pools.

---

## 2. The split — `RakeSplitter.sol`

Every contract pays its cut to **one address**, the splitter, which routes onward.

The reason not to point `treasury` straight at the marketing wallet: the split is the thing that
changes. Marketing is 100% on day one, then drops when staking opens, then some moves to buyback.
Each of those is a `setShares()` call — no redeploy, no migration, and holders can read the current
split on chain instead of taking our word for it.

**Phase one, before staking:**

| | bps |
|---|---|
| Marketing | 10000 |

**Phase two, once the token and staking are live** (the script default):

| | bps | |
|---|---|---|
| Marketing | 4000 | 40% |
| Staking | 3000 | 30% |
| Referrals | 2000 | 20% |
| Buyback and burn | 1000 | 10% |

Properties:
- Shares must total exactly 10000 or `setShares()` reverts.
- `receive()` does no work at all, so a broken destination can never revert `withdrawCut()`.
- A destination that reverts or burns gas gets its share **booked** to `owed[to][token]` and pulls
  it later. One bad address cannot block the others.
- The last share sweeps rounding dust, so every wei lands somewhere (fuzzed, 1000 runs).
- Changing the split never touches money already booked in `owed`.
- `Kind.Staking` calls `notifyReward()` rather than transferring, so the money lands as a *reward*
  and moves the per-share index, instead of sitting in the pool as a silent donation nobody can
  claim.
- ETH cannot be burned, so the burn share's ETH goes to the buyback wallet, which buys the token
  and burns that. ERC20 in the burn share goes straight to `0x…dEaD`.

---

## 3. Staking — `BrawlStaking.sol`

Stake the token, earn the arena's cut, in whatever currency it was taken (ETH from the 1v1 escrow,
ERC20 from the arena).

**There is no emission schedule and nothing is minted.** The only thing that ever enters the pool
is the splitter's staking share. If nobody plays, nothing is paid. The APR on the front end is a
measurement, not a promise — which is why `totalFunded` and `funded()` are exposed.

### Tiers

| Tier | Lock | Weight |
|---|---|---|
| 0 | none | 1.00x |
| 1 | 30 days | 1.25x |
| 2 | 90 days | 1.60x |
| 3 | 180 days | 2.20x |

Weight is your share of every reward. A longer lock multiplies your share of a fixed pot — it does
not print supply and does not dilute anyone who did not lock. `MAX_MULT_BPS = 40000` caps any
future tier at 4x.

### The safety properties, and why each one is there

- **No admin path to principal.** There is no function that moves the staked token to the owner.
  The most the owner can do is disable a tier for *new* stakes.
- **`exitEarly()` always returns 100% of principal.** Breaking a lock costs you the rewards you had
  accrued, which are pushed back to whoever stayed. Locking principal with no exit at all is how
  you end up with a drama thread; taking a cut of principal is worse. This is the version that
  keeps the lock meaningful without ever holding someone's tokens hostage.
- **`harvest()` works while locked.** The lock is on principal, not on earnings.
- **Rewards that arrive before anyone stakes are held in `orphan[token]`** and folded into the next
  notification, so an early payment is never stranded.
- **A late staker earns nothing retroactively** — the index is checkpointed on every weight change.
- **Topping up cannot shorten a lock** you are already inside; the check compares real unlock
  timestamps, not tier indices.
- O(1) per staker regardless of pool size — standard `accPerWeight` index, scaled 1e27.

---

## 4. Referrals — `BrawlReferrals.sol`

### The design rule that matters

**A referral is paid out of the house's cut, never on top of it.** Referring people can never make
the game more expensive for the people playing it, and the referral programme can never cost more
than the referral budget. That is enforced on chain:

```solidity
if (totalCredited[token] + total > totalFunded[token]) revert OverBudget();
```

The operator key decides how the referral budget is *split*. It cannot decide how *big* it is, and
it has no path to the escrow, the arena, the staking pool, or anyone's balance.

### Tiers

| Rank | At | Referrer's share of the cut their referees generate | Referee's rakeback |
|---|---|---|---|
| Bronze | any code | 10% | 5% |
| Silver | 10 referees | 15% | 5% |
| Gold | 50 referees | 20% | 5% |

Capped in the bytecode at `MAX_SHARE_BPS = 3000` and `MAX_BACK_BPS = 1000`. At Gold the house
keeps 75% of the cut on referred play — still profitable, which is the point of a cap.

The referee rakeback is the part most programmes skip and it is the part that makes codes actually
get used: arriving on a link has to be worth more than arriving cold, or nobody passes the link on.

### Two phases, one contract

**Now (no token, no wagering).** Codes are claimed and bound, and the operator credits *points*
with `creditPoints()`. Points cost nothing and pay nothing — they are a scoreboard.

The reason to run this now is that **the referral graph is the asset.** It takes months to build
and minutes to deploy. On the day the token exists, the tree of who brought whom already exists
with it, built by people who were playing for a leaderboard. This is the Blur / Hyperliquid points
pattern, and it is the single cheapest thing on this list to start early.

**Later.** The splitter routes the referral slice in; the operator credits it out with `credit()`;
referrers pull with `claim()`.

### Anti-abuse

- Codes are normalised on chain: 3–8 chars, A–Z and 0–9 only, case folded, gaps rejected. `duane`,
  `Duane` and `DUANE` are one code, and lookalikes cannot be minted from whitespace or control
  bytes.
- One code per address, one referrer per player, **bound once and permanent**. First touch wins.
- Self-referral reverts.
- `bindFor()` lets the game server bind on a player's behalf, so following a link and connecting a
  wallet costs the player no gas and no extra click. It can only bind a player who is not bound
  yet; it cannot rebind or unbind.
- Self-dealing (farming your own code with throwaway wallets) is **not** solvable on chain — it is
  an off-chain job. Credit on *settled wagered volume from distinct funded wallets*, not on
  sign-ups, and the economics stop working for the farmer.

---

## 5. Deploy order

Nothing below has been run.

1. The token.
2. `script/DeployRake.s.sol` — staking, referrals, splitter. (Staking needs the token; the splitter
   needs the other two.)
3. `BrawlEscrow` / `RektArena` with `treasury` = the splitter.
4. `escrow.setCut(300)`, `arena.setCutBps(300)`.

`OWNER` should be a multisig on all four. `OPERATOR` is the game server's hot key and should never
be the owner.

Before any of it goes near real money: an audit. There are roughly 1,100 lines of new Solidity
here holding player funds, and 100 passing tests is a floor, not a substitute.

## 6. Tests

`forge test` — 100 passing, 0 failing.

- `test/Rake.t.sol` — 30 tests over the splitter, staking and referrals, including two end-to-end
  tests that run a real 1v1 wager through the escrow, take 3% of the pot, route it through the
  splitter and pay a staker out of it, plus fuzz tests that the splitter never loses a wei and the
  staking pool can never owe more than it was funded.
- `test/BrawlEscrow.t.sol` (29) and `test/RektArena.t.sol` (41) were already there and still pass.
