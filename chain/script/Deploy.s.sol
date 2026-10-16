// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {RektArena} from "../src/RektArena.sol";

/// @notice Deploys and configures RektArena. NOT RUN. Written for later, reviewed use only.
///
/// Env (all required):
///   OWNER     final owner of the arena (ownership is handed over at the end)
///   OPERATOR  hot key that opens / starts / settles / cancels rounds
///   TREASURY  receives the cut of every currency except REKT
///   STABLE    stablecoin to allowlist (address(0) to skip)
///   REKT      REKT token; its cut is burned to 0x...dEaD (address(0) to skip)
///   CUT_BPS   cut on the losing pool, max 1000 (10%)
///
/// The broadcasting key deploys with itself as temporary owner so it can configure,
/// then transfers ownership to OWNER.
contract Deploy is Script {
    function run() external returns (RektArena arena) {
        address owner = vm.envAddress("OWNER");
        address operator = vm.envAddress("OPERATOR");
        address treasury = vm.envAddress("TREASURY");
        address stable = vm.envAddress("STABLE");
        address rekt = vm.envAddress("REKT");
        uint256 cutBps = vm.envOr("CUT_BPS", uint256(500));

        require(owner != address(0), "OWNER unset");
        require(operator != address(0), "OPERATOR unset");
        require(treasury != address(0), "TREASURY unset");
        require(cutBps <= 1000, "CUT_BPS > 1000");
        require(stable == address(0) || stable.code.length > 0, "STABLE has no code");
        require(rekt == address(0) || rekt.code.length > 0, "REKT has no code");

        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();

        arena = new RektArena(deployer);
        arena.setOperator(operator);
        arena.setTreasury(treasury);
        if (stable != address(0)) arena.setToken(stable, true);
        if (rekt != address(0)) arena.setRekt(rekt);
        // forge-lint: disable-next-line(unsafe-typecast)
        arena.setCutBps(uint16(cutBps));
        if (owner != deployer) arena.transferOwnership(owner);

        vm.stopBroadcast();

        require(arena.owner() == owner, "owner mismatch");
        require(arena.operator() == operator, "operator mismatch");
        require(arena.treasury() == treasury, "treasury mismatch");
        require(arena.cutBps() == cutBps, "cut mismatch");

        console2.log("RektArena", address(arena));
        console2.log("owner    ", owner);
        console2.log("operator ", operator);
        console2.log("treasury ", treasury);
        console2.log("stable   ", stable);
        console2.log("rekt     ", rekt);
        console2.log("cutBps   ", cutBps);
    }
}
