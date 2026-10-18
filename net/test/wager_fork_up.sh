#!/bin/bash
# Fresh fork of Arbitrum on 18777 with the two test players funded and a test operator set.
set -e
C=$HOME/.foundry/bin/cast
R=http://127.0.0.1:18777
U=0xaf88d065e77c8cC2239327C5EDb3A432268e5831
E=0x4f69E9698537Faf2DD0cd9365a5f5443D03Bd427
W=0x724dc807b04555b71ed48a6896b6F41593b8C637      # Aave aArbUSDCn, where the test USDC comes from
OWN=0x60A060b3d6FB11facB173B1899F1C995d3FeE305    # the escrow's real owner
OP=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC     # throwaway operator for the test
A=0x90F79bf6EB2c4f870365E785982E1f101E93b906
B=0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65
HERE=$(cd "$(dirname "$0")" && pwd)

pkill -f "anvil --fork-url" 2>/dev/null || true
sleep 1
nohup $HOME/.foundry/bin/anvil --fork-url https://arb1.arbitrum.io/rpc --port 18777 --chain-id 42161 --silent > "$HERE/anvil.log" 2>&1 &
for i in $(seq 1 40); do $C block-number --rpc-url $R >/dev/null 2>&1 && break; sleep 0.5; done
echo "forked at block $($C block-number --rpc-url $R)"

for X in $OWN $OP $A $B $W; do $C rpc anvil_setBalance $X 0xDE0B6B3A7640000 --rpc-url $R >/dev/null; done
$C rpc anvil_impersonateAccount $W --rpc-url $R >/dev/null
$C send $U "transfer(address,uint256)" $A 10000000 --from $W --unlocked --rpc-url $R >/dev/null
$C send $U "transfer(address,uint256)" $B 10000000 --from $W --unlocked --rpc-url $R >/dev/null
$C rpc anvil_stopImpersonatingAccount $W --rpc-url $R >/dev/null
$C rpc anvil_impersonateAccount $OWN --rpc-url $R >/dev/null
$C send $E "setOperator(address)" $OP --from $OWN --unlocked --rpc-url $R >/dev/null
$C rpc anvil_stopImpersonatingAccount $OWN --rpc-url $R >/dev/null

echo "A $($C call $U 'balanceOf(address)(uint256)' $A --rpc-url $R)  B $($C call $U 'balanceOf(address)(uint256)' $B --rpc-url $R)  escrow $($C call $U 'balanceOf(address)(uint256)' $E --rpc-url $R)"
echo "operator $($C call $E 'operator()(address)' --rpc-url $R)  cutBps $($C call $E 'cutBps()(uint16)' --rpc-url $R)"
