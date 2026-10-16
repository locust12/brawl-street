// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {BrawlEscrowToken} from "../src/BrawlEscrowToken.sol";

/// @notice Deploys BrawlEscrowToken (USDC / USDT 1v1 and free-for-all wagers) and allowlists the
///         stablecoins for the chain it is deployed to.
///
///   OWNER=0x… OPERATOR=0x… TREASURY=0x… CUT_BPS=300 \
///     forge script script/DeployEscrowToken.s.sol --rpc-url <rpc> --broadcast --private-key <deployer>
///
/// CUT_BPS defaults to 500 = 5%, flat, on every bet. No cap, no tiers, no exceptions.
/// The contract's ceiling is 1000 = 10%.
/// TOKENS can override the per-chain defaults with a comma-separated list.
contract DeployEscrowToken is Script {
    function run() external returns (BrawlEscrowToken esc) {
        address owner = vm.envAddress("OWNER");
        address operator = vm.envAddress("OPERATOR");
        address treasury = vm.envAddress("TREASURY");
        uint16 cutBps = uint16(vm.envOr("CUT_BPS", uint256(500)));
        address[] memory tokens = _tokens();
        require(tokens.length > 0, "no stablecoins known for this chain: pass TOKENS=0x..,0x..");

        vm.startBroadcast();
        esc = new BrawlEscrowToken(owner, operator, treasury, cutBps);
        for (uint256 i; i < tokens.length; ++i) {
            esc.setToken(tokens[i], true);
        }
        vm.stopBroadcast();

        // read it all back rather than trusting the broadcast
        require(esc.owner() == owner, "owner mismatch");
        require(esc.operator() == operator, "operator mismatch");
        require(esc.treasury() == treasury, "treasury mismatch");
        require(esc.cutBps() == cutBps, "cut mismatch");
        for (uint256 i; i < tokens.length; ++i) {
            require(esc.tokenAllowed(tokens[i]), "token not allowlisted");
        }

        console2.log("BrawlEscrowToken", address(esc));
        console2.log("chainId         ", block.chainid);
        console2.log("cutBps          ", cutBps);
        for (uint256 i; i < tokens.length; ++i) {
            console2.log("allowlisted     ", tokens[i]);
        }
    }

    function _tokens() internal view returns (address[] memory out) {
        // TOKENS=0x..,0x.. overrides the per-chain defaults
        address[] memory given = vm.envOr("TOKENS", ",", new address[](0));
        if (given.length > 0) return given;
        uint256 id = block.chainid;
        if (id == 1) {
            out = new address[](2);
            out[0] = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48; // USDC
            out[1] = 0xdAC17F958D2ee523a2206206994597C13D831ec7; // USDT
        } else if (id == 8453) {
            out = new address[](1);
            out[0] = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913; // USDC on Base
        } else if (id == 42161) {
            out = new address[](2);
            out[0] = 0xaf88d065e77c8cC2239327C5EDb3A432268e5831; // USDC on Arbitrum
            out[1] = 0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9; // USDT on Arbitrum
        } else {
            out = new address[](0);
        }
    }
}
