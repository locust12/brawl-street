# Brawlstreet online

Real-time online play for Brawlstreet: 1v1 and 4-player free-for-all, quick match and private room codes,
practice-ETH wagers settled by the server, an Elo ladder, friends and challenges, room chat, and a
switched-off real-ETH escrow mode.

- **Play:** https://brawlstreet.lol/play/ (the public site, deployed by the site owner). The lobby opens from
  "Play online" on the title, or with `#online` in the URL. `#room:CODE` joins a room directly.
- **Game server:** `wss://brawlstreet.167-233-230-149.sslip.io/ws`, on the `lw` box. The same host also serves a
  copy of the game at https://brawlstreet.167-233-230-149.sslip.io/ (the backup link the lobby shows when a
  page can't open a socket, e.g. the claude.ai artifact preview).
- **Public data:** `GET /api/leaderboard` (Elo boards, CORS-open), `GET /api/replay/<matchId>` (any finished
  match: seed, config and every input), `GET /healthz`.

## How it works

**Delay-based lockstep.** The fight engine is deterministic (seeded sfc32 RNG, trig built from + - * /), so
every page runs the same simulation and only inputs travel. That's one 9-bit mask per player per 1/60 s
tick. A page sends its input for tick T tagged T + delay, and simulates a tick only once every player's
input for it is in. Delay is set by the server from measured round trips: the player's own one-way time,
plus the slowest other player's, plus jitter and one frame. The range is 2 to 15 frames. Pages add up to 4
frames when they stall 3 times in 3 s, and drop them again after 15 s without stalls. A page that runs ahead
of the others slows by 3% until they catch up. A stalled page shows who it is waiting for.

**The server plays every match too.** `server.js` runs each match in its own sandboxed copy of the page's
fight code (`engine/sim-<fingerprint>.js`, built from `src/` by `tools/build-engine.js`). It steps that copy
as inputs arrive, so it knows the winner the moment the fight ends, without trusting any page. Every 60
ticks, each page sends a hash of the fight state. A page whose hash differs from the server's is flagged
(banner: "fell out of sync"), and the server's result stands. Replays are saved (`/data/replays`, newest
400) and served publicly. `sha256(replay file)` is what the escrow contract records.

**Engine fingerprint.** The server seats only pages running an engine build it has loaded. The
fingerprint covers move data, the source of every fight function, and two scripted probe fights. It
reloads new `engine/sim-*.js` files every 30 s and keeps the last 12 builds, so pages still on the previous
build keep working until they reload. A room is tied to the build of the player who opened it.

**The account is the safety net for the custom fighter.** Whenever the creator's blob changes, the page sends it
to the server, which sanitises and stores it on the account. On sign-in (and after a recovery code) the page takes
it back if this device has none, so cleared storage or a new device doesn't lose the fighter. The sanitiser keeps
any short safe field the creator sends rather than a fixed list, so gear added later survives the round trip. The
optional X handle (`look.x`, no @, a-z0-9_, 15 max, run through the name filter) rides along and is shown as plain
text under the player's name in the room, in the match name tag, in the results table and on the leaderboard. It is
never turned into a link: nobody has proved they own that handle.

**Custom fighters are cosmetic.** A player's saved look (`CustomLook.get()` from `86_custom.js`) is stored on
their account, shown in rooms, and sent to every player in the match start as `looks[slot]`.
`NetSim.start` puts it in `slot.customLook` for `CustomLook.apply`. It is not part of the fight config, the
replay, or the fingerprint, and the server's engine never sees it.

## Rules online

| | |
|---|---|
| Stocks / items / stage | Host picks: 1–5 lives, items on/off, any stage or random. Quick matches: 3 lives, items on, and the map comes from the players' map picks |
| Time cap | 7 minutes of fight clock, then most lives, then least damage (like Smash online) |
| Pause | Off. Escape (or the Leave button, tapped twice) leaves the match |
| Combos / grapples | On (rules v2, `Game.combos = true`), the same on every page and on the server |
| Start | 1v1 starts when both are ready. FFA starts when the room is full and everyone is ready, or when the host presses Start (2+ humans ready). Quick FFA also auto-starts 12 s after 2+ humans are ready |
| CPU fill | FFA option: empty seats become level-7 CPUs. CPUs never stake and never collect: the pot goes to the best-placed human |
| Quick-match ready window | 45 s. Players who don't ready up are moved out of the room |

**Quick-match maps.** In the lobby a player picks "Any map" (the default, fastest pairing) or any subset of the 17
stages. Quick match only pairs players whose picks overlap, and the match is played on a random map from that
overlap, shown in the "match found" line and in the room. Someone waiting alone for 30 s with a narrow pick is
offered "Search any map", which drops their filter and re-runs matchmaking (it also joins them to whoever was
already waiting). Private rooms keep the host's single stage pick.

**Disconnects (Smash-style).** A player whose connection drops has 10 s to come back. Everyone else waits and
sees a countdown. On reconnect the page downloads the match's full input log, fast-forwards silently, and
carries on. If they don't come back, or a connected player sends nothing for 20 s (a frozen tab):
- **1v1:** they forfeit. The other player wins and takes the pot.
- **FFA:** their fighter becomes a CPU from that tick on, identical on every page and on the server. They lose
  their stake and can't take the pot. When only one human is left, that human wins by forfeit.
- If every human is gone, the match is cancelled and every stake is refunded.

A hidden tab keeps ticking through a Web Worker timer, so switching tabs doesn't freeze the others.

## Wagers

**Practice ETH (live).** Each device gets a random 32-byte token in localStorage. The server knows only its
sha256. New accounts start with 1.0 practice ETH and can refill to 1.0 once they're below 0.01 (30 s
cooldown). The room stake (0, 0.01, 0.05, 0.1 or 0.25) is taken from every human at kickoff. The pot goes
to the best-placed human still in the match, as decided by the server's own copy of the fight.

**Real ETH (built, OFF).** Contract `chain/src/BrawlEscrow.sol` (29 forge tests, including 1000-run fuzzes and
reentrancy). Flow: the operator key `open`s a match with the players' wallets and the stake. Each player
`deposit`s exactly the stake. The fight starts once the match is Funded. The server `report`s the
replay-verified winner together with the replay hash, and the winner `claim`s. Refunds: anyone can
`cancel` an Open match after its deposit window, or a Funded match that goes unreported for 2 hours. The
operator can cancel any unsettled match, after which each depositor calls `refund`. The operator can't
touch stakes except by naming a winner among that match's own players. A cut (`cutBps`, max 10%, 0 by
default, snapshotted per match) is held in the contract for `withdrawCut()`, so it can never block a
claim. Wallets are bound to a room by signing a one-time message (`personal_sign`), which the server
verifies.

### Turning real money on (runbook)

Nothing here has been deployed or funded. Decisions needed first:
1. **Operator key:** a fresh hot wallet with a little gas and nothing else. It can only open, report and
   cancel.
2. **Owner** (a cold wallet or multisig), **treasury**, and **cut** (0 is fine).
3. **Stakes offered:** the `REAL_STAKES` env, default `0.001,0.005,0.01,0.05` ETH.
4. **Legal:** real-money wagering on skill games is regulated in many places. Check this before launch.

Then:
```
cd chain
OWNER=0x… OPERATOR=0x… TREASURY=0x… CUT_BPS=0 \
  forge script script/DeployEscrow.s.sol --rpc-url https://rpc.mainnet.chain.robinhood.com --broadcast --private-key <deployer>
```
On lw, create `/opt/brawlstreet/.env` (chmod 600) with:
```
REAL_MONEY=1
CHAIN_RPC=https://rpc.mainnet.chain.robinhood.com
CHAIN_ID=4663
CHAIN_NAME=Robinhood Chain
EXPLORER=https://robinhoodchain.blockscout.com
ESCROW_ADDRESS=0x…
OPERATOR_KEY=0x…
FUND_WINDOW_S=120
```
Then `ssh lw 'cd /opt/brawlstreet && docker compose up -d'`. The lobby then shows a "Real ETH room" plate:
players connect a wallet in the room, sign once, ready up and deposit, and the winner gets a Claim button.
Turning it off again means removing `REAL_MONEY=1` and running `docker compose up -d`. Already-funded
matches stay claimable or refundable on chain.

The whole loop was tested on a private local anvil chain only: `node test/escrow_e2e.js`. It deploys, runs
the server with `REAL_MONEY=1`, has two players bind wallets, deposit and play a full match, checks that
the server reports the winner and the on-chain `replayHash` equals the sha256 of the public replay file,
has the winner claim, and checks balances to the wei. It then runs a missing-deposit match through cancel
and refund. The accounts are anvil's public dev mnemonic on a throwaway chain.

## Social

- **Profile:** name, Elo, weekly season rating, W–L record, friend code, custom fighter, recovery code.
- **Elo:** chess-style, starting at 1200, K=32 for the first 30 ranked games and 16 after; a forfeit counts as a
  loss. Ranked matches: every quick-match 1v1, plus private 1v1 rooms where the host sets Ranked on. The
  weekly season (ISO week, resets Monday 00:00 UTC) runs alongside, with everyone starting each week at
  1200. `GET /api/leaderboard?board=all|week&limit=N` returns
  `{updated, season:{id,ends}, all:[…], week:[…]}` with rows
  `{rank, name, elo, games, wins, losses, main, look}` (top 100, cached 30 s, `Access-Control-Allow-Origin: *`).
- **Friends:** add by name (when the name is unique) or by the 6-character friend code. The other player
  accepts, and both then see each other's status (online / in a room / in a match / offline). Challenge sends
  an in-game invite that opens a private 1v1 room. People who don't play yet get the room link.
- **Recovery code:** "Get a recovery code" shows a 16-character code once and stores only its hash. Entering it
  on another device links that device to the account (rating, friends, balance, fighter). A new code
  cancels the old one.
- **Room chat:** a collapsible panel (right side, below the 1v1 HUD bars) in rooms and matches. Room-only
  relay, 120 characters, about 1 line/s with a burst of 3, a basic profanity filter on the server,
  textContent rendering, per-player mute, a "Hide chat" switch, and quick-chat buttons (GG, Nice!, Rematch?,
  Wow, …) that always work. Free text is off in a page that sets `window.BS_CHAT_FREE = false` (portal
  builds), and off everywhere with the server env `CHAT_FREE=0`.

## Privacy and limits

No IP addresses are logged or stored. The per-address connection cap (16) lives in memory only, and Caddy
keeps no access log for this host. Accounts store the token hash, name, balance, ratings, friend links,
the saved look, and the hash of the recovery code. Messages are rate-limited, capped at 16 KB, and
validated. Pages are accepted from brawlstreet.lol, www.brawlstreet.lol, this host, localhost/127.0.0.1,
claude.ai artifact origins, and sandboxed frames; `ALLOWED_ORIGINS` adds more. Caps: 120 live matches and
600 rooms (`MAX_MATCHES`, `MAX_ROOMS`).

Known limits: there are no spectators. Lockstep can't stop a player from delaying their own inputs to react
to yours; the input delay bounds it. The server is in Germany, so far-away pairs play with more input delay.

## Files

| file | what |
|---|---|
| `../src/63_netsim.js` | `NetSim` (start, step, hash, placements, fingerprint) + `NetLockstep` (client lockstep), shared by page, server, tests |
| `../src/77_net.js` | lobby, room, match HUD, results, reconnect, wallet flow |
| `../src/78_net_social.js` | profile, friends, challenges, leaderboard, recovery, chat |
| `../src/10_core.js` | `NetInput` + the `'net0'..'net3'` branch of `readInput` (the only fight-side hook) |
| `server.js` | rooms, matchmaking, relay, server-side match copies, wagers, Elo, friends, chat, escrow operator |
| `lib/engine.js` | loads `engine/sim-*.js` builds into vm sandboxes; `replay()` |
| `lib/accounts.js` | accounts, balances, Elo, seasons, friends, recovery |
| `lib/chat.js`, `lib/escrow.js`, `lib/static.js` | chat filter; BrawlEscrow operator (viem); static files |
| `tools/build-engine.js` | builds `engine/sim.js` + `engine/sim-<fingerprint>.js` from build.py's `SIM_FILES` (+ any `src/2x_*.js`) |
| `test/sim_clients.js` | simulated players over real sockets: 1v1, FFA, CPU fill, drop→CPU, resume, forfeit, social, quick-match maps |
| `test/browser_duo.mjs` | two headless Chromes: lobby → room link → ready → fight → results, with screenshots |
| `test/escrow_e2e.js` | real-ETH mode on a local anvil chain |
| `../chain/src/BrawlEscrow.sol`, `../chain/test/BrawlEscrow.t.sol`, `../chain/script/DeployEscrow.s.sol` | escrow |

## Deploy

On lw: `/opt/brawlstreet` holds `compose.yml`, `Dockerfile`, `server.js` and `lib/`, which are baked into
the image, plus `engine/` and `public/` (index.html + assets), which are bind-mounted read-only. Data lives
in the named volume `brawlstreet_brawlstreet-data`. The container `brawlstreet` is on the `sinbook`
network. Caddy (container `caddy`, `/opt/caddy/Caddyfile`) has one site block for
`brawlstreet.167-233-230-149.sslip.io` → `brawlstreet:8080`. The certificate comes from Let's Encrypt; the
backup of the Caddyfile from before that block was added is `Caddyfile.bak-brawlstreet-20260919`.

**After rebuilding the game** (`python3 build.py`):
```
bash net/deploy.sh          # rebuilds page + engine, uploads engine + index.html + assets; no restart
bash net/deploy.sh --code   # also uploads server.js/lib and rebuilds + restarts the container
```
`--code` builds the image and **boots it in a throwaway container first** (`brawlstreet-preflight`,
`--network none`): a module that throws while loading would otherwise crash-loop the real container and take
the site down, which is exactly what a `lib/` file reading outside `net/` did on 21 Sep. The live container is
only replaced once the new image has answered `/healthz`; if it does not, the deploy stops and prints the new
image's logs. **Anything under `net/lib/` must only read files inside `net/`** — the image carries `net/`
alone, so `../../src/...` exists in the repo and not in the container. Vendor it in `deploy.sh` instead
(that is what `econ-src/89_econ.js` is).

`SKIP_BUILD=1 bash net/deploy.sh` ships the page that is already built. The engine step refuses to run
when `src/` has changed since that build, because a page and an engine from different sources can't play
together. Upload the engine whenever `brawlstreet.lol/play` gets a new build: build once, deploy /play from
that build, then `SKIP_BUILD=1 bash net/deploy.sh`. Otherwise pages from the new build are
told "different game version" until the server has the matching engine. The script waits until `/healthz`
lists the new engine. A container restart cancels live matches and refunds their stakes.

Logs: `ssh lw 'docker logs --tail 100 brawlstreet'`. Rollback: previous engine builds stay loaded; for server
code, redeploy the previous `server.js`/`lib` with `--code`.

## Server regions (latency)

Lockstep waits for the slower of the two connections, so the server's distance to the players is the
single biggest thing the netcode cannot fix. Measured 21 Sep from Thailand: **214 ms** to the Falkenstein
box, **47-65 ms** to Singapore — about 8 frames of input delay each way instead of 2-3.

The page handles this by itself: every server advertises the region list in `welcome`, the page times
`GET /ping` on each one (3 samples, cached 10 min), and plays on the closest. "Auto (closest)" or a manual
pick sit in the lobby header; the room screen shows the delay the pair actually gets. A player only ever
moves region in the lobby, never mid-match or mid-room, and a region that stops answering is dropped back
to the default server.

One box today, so there is nothing to choose. The second one is one command, on a box that already
exists and takes the local SSH key as root:

```
bash net/region-up.sh <ip> sg Singapore                  # stand it up
APPLY_REGIONS=1 bash net/region-up.sh <ip> sg Singapore  # ... and join both boxes into one region list
```

`region-up.sh` installs Docker, writes the same Caddy site block lw uses (free sslip.io hostname, no access
log), ships the SAME engine build that is live on lw (it refuses to run if the digests differ, because a
version skew between regions is worse than one region), boots the container and waits for `/healthz`. With
`APPLY_REGIONS=1` it writes `net/regions.json` into `net/compose.yml` and redeploys lw, so both boxes
advertise both regions. Accounts, Elo and friends are per box, so keep a player's region stable.

`/healthz` reports `region` and `label`; `/ping` answers the region id with `Access-Control-Allow-Origin: *`
so the timing works from `brawlstreet.lol`.

## Tests

Test clients mark their accounts as tests (`hello.test`; in the page, add `?nettest=1` to the URL). Those accounts
never appear on the leaderboard and are deleted after an hour, so running the suite against production leaves no
trace. A local test server shows them on the board (`BOARD_SHOW_TESTS=1`, set by sim_clients.js).

```
node test/sim_clients.js                                   # local server, all scenarios
node test/sim_clients.js --url wss://brawlstreet.167-233-230-149.sslip.io/ws
node test/escrow_e2e.js                                    # local anvil only
NO3D=1 node test/browser_duo.mjs http://127.0.0.1:8799/ ws://127.0.0.1:8799/ws /tmp/shots
cd ../chain && forge test --match-contract BrawlEscrowTest
cd ../arena/test && node det_node.js 24 && jsc det_jsc.js  # the bet arena's fights are unchanged
```
