// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {BrawlEscrow} from "../src/BrawlEscrow.sol";

/// @notice Deploys BrawlEscrow for Brawlstreet online real-ETH matches. NOT run by anyone yet: see net/README.md.
///   OWNER=0x… OPERATOR=0x… TREASURY=0x… CUT_BPS=0 forge script script/DeployEscrow.s.sol --rpc-url <rpc> --broadcast --private-key <deployer>
contract DeployEscrow is Script {
    function run() external returns (BrawlEscrow esc) {
        address owner = vm.envAddress("OWNER");
        address operator = vm.envAddress("OPERATOR");
        address treasury = vm.envAddress("TREASURY");
        uint16 cutBps = uint16(vm.envOr("CUT_BPS", uint256(500)));
        vm.startBroadcast();
        esc = new BrawlEscrow(owner, operator, treasury, cutBps);
        vm.stopBroadcast();
        console2.log("BrawlEscrow", address(esc));
    }
}
