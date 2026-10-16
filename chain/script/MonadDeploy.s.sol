// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {RektArena} from "../src/RektArena.sol";
import {BrawlEscrow} from "../src/BrawlEscrow.sol";
import {FaucetToken} from "./TestnetDeploy.s.sol";

/// @notice Monad TESTNET (10143). Deploys the pool asset faucets, the parimutuel arena and the 1v1
///         escrow, so a judge can drip tokens and play a settled match without asking us for anything.
///         The broadcasting key stays owner, operator and treasury.
///   forge script script/MonadDeploy.s.sol --rpc-url https://testnet-rpc.monad.xyz --broadcast --private-key <key>
contract MonadDeploy is Script {
    function run() external {
        require(block.chainid == 10143, "monad testnet only");

        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();

        FaucetToken usdg = new FaucetToken("USDG (Monad testnet)", "USDG", 6, 1_000e6);
        FaucetToken rekt = new FaucetToken("Rekt (Monad testnet)", "REKT", 18, 100_000e18);

        RektArena arena = new RektArena(deployer);
        arena.setOperator(deployer);
        arena.setTreasury(deployer);
        arena.setToken(address(usdg), true);
        arena.setRekt(address(rekt));
        arena.setCutBps(0);

        BrawlEscrow esc = new BrawlEscrow(deployer, deployer, deployer, 0);

        vm.stopBroadcast();

        console2.log("chainid    ", block.chainid);
        console2.log("RektArena  ", address(arena));
        console2.log("BrawlEscrow", address(esc));
        console2.log("USDG       ", address(usdg));
        console2.log("REKT       ", address(rekt));
        console2.log("operator   ", deployer);
    }
}
