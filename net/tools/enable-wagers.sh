#!/usr/bin/env bash
# Turn on real-money 1v1 wagers. Two on-chain transactions and one env flip.
#
# WHY THIS IS NOT AUTOMATIC. It spends from a funded wallet and it is irreversible, so it is written
# out rather than run: every step is checked first, nothing is sent until you pass `--send`, and the
# whole sequence was proved on a fork of Arbitrum against the real escrow before this was written.
#
#   bash net/tools/enable-wagers.sh                 # check only, sends nothing
#   bash net/tools/enable-wagers.sh --send          # setOperator + fund the operator
#   bash net/tools/enable-wagers.sh --live lw       # then flip REAL_MONEY on ONE region
#
# WHAT IS WRONG TODAY, and why a wager cannot work until it is fixed:
#   escrow.operator() is still the RAKE desk wallet, but the game server signs with a DEDICATED key.
#   open() and report() are both onlyOperator (BrawlEscrowToken.sol), so every wager fails at
#   "Could not open the match on chain". It fails SAFELY -- nobody is charged -- but nothing works.
#
# ONE REGION ONLY. The contract has exactly one operator slot, so two servers cannot both open
# matches, and sharing one key across regions collides on the nonce. Pick the region wagering players
# will be sent to and flip only that one.
set -u
CAST="${CAST:-$HOME/.foundry/bin/cast}"
RPC="${RPC:-https://arb1.arbitrum.io/rpc}"
ESCROW=0x4f69E9698537Faf2DD0cd9365a5f5443D03Bd427
OWNER=0x60A060b3d6FB11facB173B1899F1C995d3FeE305      # the escrow's owner = the RAKE desk wallet
OPERATOR=0x424B00632af89E34D5A8139CF2BD4ED2357A1ed7   # what the game server already signs with
KEYFILE="${KEYFILE:-$HOME/Downloads/RAKE/wallet/desk-wallet.json}"
FUND_ETH="${FUND_ETH:-0.0005}"                         # ~0.02 gwei now: roughly 100 wagered matches

eth() { $CAST balance "$1" --rpc-url "$RPC" 2>/dev/null | awk '{printf "%.6f", $1/1e18}'; }

echo "== where things stand"
printf '  escrow            %s\n' "$ESCROW"
printf '  escrow.owner()    %s\n' "$($CAST call $ESCROW 'owner()(address)' --rpc-url $RPC 2>/dev/null)"
printf '  escrow.operator() %s\n' "$($CAST call $ESCROW 'operator()(address)' --rpc-url $RPC 2>/dev/null)"
printf '  server signs with %s\n' "$OPERATOR"
printf '  cutBps            %s (5%% = 500)\n' "$($CAST call $ESCROW 'cutBps()(uint16)' --rpc-url $RPC 2>/dev/null)"
printf '  owner balance     %s ETH\n' "$(eth $OWNER)"
printf '  operator balance  %s ETH\n' "$(eth $OPERATOR)"
printf '  gas price         %s gwei\n' "$($CAST gas-price --rpc-url $RPC 2>/dev/null | awk '{printf "%.4f", $1/1e9}')"

# CAN THE OWNER ACTUALLY PAY. A run that changes the operator and then cannot fund it leaves wagers
# just as broken as before, except now the escrow points at an empty key.
OWN_WEI=$($CAST balance $OWNER --rpc-url $RPC 2>/dev/null | tr -dc '0-9')
FUND_WEI=$(python3 -c "print(int(float('$FUND_ETH')*10**18))" 2>/dev/null || echo 0)
if [ -z "$OWN_WEI" ]; then
  # A public RPC that is rate-limiting must not be reported as an empty wallet: those call for
  # opposite actions, and guessing wrong here either blocks a launch or strands the operator.
  echo "  -> could NOT read the owner balance (the RPC did not answer; public Arbitrum endpoints"
  echo "     rate-limit). Re-run, or set RPC=<your endpoint>. Not treating this as insufficient funds."
  SHORT=unknown
elif [ "$OWN_WEI" -lt "$FUND_WEI" ]; then
  AFF=$(python3 -c "print('%.6f' % (max(0, $OWN_WEI - 2*10**14)/1e18))" 2>/dev/null)
  echo "  -> the owner cannot send $FUND_ETH ETH; it holds $(eth $OWNER) ETH"
  echo "     either top the owner up, or run with a smaller amount, e.g.  FUND_ETH=$AFF"
  echo "     (each wagered match costs about 2 cents of operator gas at this price)"
  SHORT=1
else
  SHORT=0
fi

CUR=$($CAST call $ESCROW 'operator()(address)' --rpc-url $RPC 2>/dev/null | tr 'A-Z' 'a-z')
WANT=$(echo $OPERATOR | tr 'A-Z' 'a-z')
if [ "$CUR" = "$WANT" ]; then echo "  -> operator is ALREADY the server's key"; NEED_OP=0; else echo "  -> operator must be changed, or every wager reverts"; NEED_OP=1; fi

# ---------------------------------------------------------------- the env flip
if [ "${1:-}" = "--live" ]; then
  H="${2:?which region: lw or sg}"
  echo
  echo "== $H: switching REAL_MONEY on"
  ssh -o ConnectTimeout=15 "$H" "cd /opt/brawlstreet && \
    grep -q '^ESCROW_ADDRESS=' .env || { echo 'this box has no escrow config in .env -- copy the block from lw first'; exit 1; }; \
    cp .env .env.bak-realmoney && \
    grep -q '^REAL_MONEY=' .env && sed -i 's/^REAL_MONEY=.*/REAL_MONEY=1/' .env || printf 'REAL_MONEY=1\n' >> .env; \
    docker compose up -d brawlstreet >/dev/null 2>&1 && echo '  recreated'"
  sleep 6
  U=$([ "$H" = sg ] && echo https://brawlstreet.5-223-91-79.sslip.io || echo https://brawlstreet.167-233-230-149.sslip.io)
  curl -fsS -m 10 "$U/healthz" | python3 -c "import json,sys; d=json.load(sys.stdin); r=d.get('real'); print('  real-money mode:', bool(r)); print('  token:', (d.get('money') or {}) if r else 'n/a')" 2>/dev/null
  echo "  NOTE: leave the other region on practice stakes -- one operator slot means one region."
  exit 0
fi

# ---------------------------------------------------------------- the transactions
if [ "${1:-}" != "--send" ]; then
  echo
  echo "Nothing was sent. To do it:"
  [ "$NEED_OP" = 1 ] && echo "  1. point the escrow at the server's key (about \$0.002 at this gas price)"
  echo "  2. put $FUND_ETH ETH into the operator for its open/report transactions (~2 cents a match)"
  echo
  echo "  bash net/tools/enable-wagers.sh --send"
  echo "  bash net/tools/enable-wagers.sh --live lw     # afterwards, one region only"
  exit 0
fi

[ -f "$KEYFILE" ] || { echo "no key file at $KEYFILE (it is also in the keychain as rake-desk-wallet)"; exit 1; }
echo
echo "== sending, from the owner wallet"
read -r -p "   type YES to spend from $OWNER: " OK
[ "$OK" = YES ] || { echo "   aborted, nothing sent"; exit 1; }

if [ "$NEED_OP" = 1 ]; then
  echo "   setOperator($OPERATOR)"
  $CAST send $ESCROW "setOperator(address)" $OPERATOR --keystore "$KEYFILE" --rpc-url "$RPC" || { echo "   setOperator FAILED, nothing else attempted"; exit 1; }
  printf '   operator is now %s\n' "$($CAST call $ESCROW 'operator()(address)' --rpc-url $RPC 2>/dev/null)"
fi

if [ "${SHORT:-0}" = unknown ]; then
  echo "   REFUSING to send: the owner balance could not be read, so this cannot be done safely."
  exit 1
fi
if [ "${SHORT:-0}" = 1 ]; then
  echo "   SKIPPING the funding step: the owner cannot afford $FUND_ETH ETH."
  echo "   The operator is set but has no gas, so wagers still will not open until it is funded."
  exit 1
fi
echo "   funding the operator with $FUND_ETH ETH"
$CAST send "$OPERATOR" --value "${FUND_ETH}ether" --keystore "$KEYFILE" --rpc-url "$RPC" || echo "   funding FAILED -- the operator cannot send anything without gas"
printf '   operator balance now %s ETH\n' "$(eth $OPERATOR)"
echo
echo "Now flip ONE region:  bash net/tools/enable-wagers.sh --live lw"
