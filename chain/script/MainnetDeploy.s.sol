// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {RektArena} from "../src/RektArena.sol";

/// @notice Robinhood Chain MAINNET (4663). No faucet tokens: the arena is wired to the real
///         Paxos USDG, "Global Dollar", 6 decimals.
///
///         It is deployed PAUSED on purpose. docs/SECURITY-REVIEW.md has not cleared the economy
///         contracts for real money, so nothing can be staked until an owner explicitly unpauses.
///         Judges can read the verified source and every setting on-chain regardless.
contract MainnetDeploy is Script {
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;

    function run() external {
        require(block.chainid == 4663, "robinhood mainnet only");
        address operator = vm.envAddress("OPERATOR");

        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        RektArena arena = new RektArena(deployer);
        arena.setOperator(operator);
        arena.setTreasury(deployer);
        arena.setToken(USDG, true);
        arena.setCutBps(0);
        arena.setPaused(true);
        vm.stopBroadcast();

        console2.log("RektArena", address(arena));
        console2.log("USDG     ", USDG);
        console2.log("operator ", operator);
    }
}
