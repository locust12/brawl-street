// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {RakeSplitter} from "../src/RakeSplitter.sol";
import {BrawlStaking} from "../src/BrawlStaking.sol";
import {BrawlReferrals} from "../src/BrawlReferrals.sol";

/// @notice Brings up the rake stack: splitter, staking pool, referral registry.
///
/// @dev    NOT RUN. Nothing here is deployed. The escrow and the arena are also still
///         undeployed, and the game's real-money flag is off.
///
///         Deploy order, when the day comes:
///           1. the token
///           2. this script (staking needs the token; the splitter needs staking and referrals)
///           3. BrawlEscrow / RektArena with `treasury` = the splitter
///           4. `setCut(300)` on the escrow, `setCutBps(300)` on the arena
///
///         Env:
///           OWNER        multisig. Owns all three. Never the operator key.
///           OPERATOR     the game server's hot key. Binds referral codes, posts credit batches.
///           MARKETING    the marketing wallet.
///           BUYBACK      wallet that turns the burn share into the token and burns it.
///           TOKEN        the Brawl Street token.
///           MARKETING_BPS / STAKING_BPS / REFERRAL_BPS / BUYBACK_BPS
///                        the split, must total 10000. Defaults below are the phase-two split.
contract DeployRake is Script {
    function run() external {
        address owner = vm.envAddress("OWNER");
        address operator = vm.envAddress("OPERATOR");
        address marketing = vm.envAddress("MARKETING");
        address buyback = vm.envAddress("BUYBACK");
        address token = vm.envAddress("TOKEN");

        uint16 mBps = uint16(vm.envOr("MARKETING_BPS", uint256(4000)));
        uint16 sBps = uint16(vm.envOr("STAKING_BPS", uint256(3000)));
        uint16 rBps = uint16(vm.envOr("REFERRAL_BPS", uint256(2000)));
        uint16 bBps = uint16(vm.envOr("BUYBACK_BPS", uint256(1000)));
        require(uint256(mBps) + sBps + rBps + bBps == 10_000, "split must total 10000");

        vm.startBroadcast();

        BrawlStaking staking = new BrawlStaking(owner, token);
        BrawlReferrals referrals = new BrawlReferrals(owner, operator);

        RakeSplitter.Share[] memory shares = new RakeSplitter.Share[](4);
        shares[0] = RakeSplitter.Share(marketing, mBps, RakeSplitter.Kind.Wallet, "marketing");
        shares[1] = RakeSplitter.Share(address(staking), sBps, RakeSplitter.Kind.Staking, "staking");
        shares[2] = RakeSplitter.Share(address(referrals), rBps, RakeSplitter.Kind.Wallet, "referrals");
        shares[3] = RakeSplitter.Share(buyback, bBps, RakeSplitter.Kind.Burn, "buyback");
        RakeSplitter splitter = new RakeSplitter(owner, shares);

        vm.stopBroadcast();

        console.log("BrawlStaking  ", address(staking));
        console.log("BrawlReferrals", address(referrals));
        console.log("RakeSplitter  ", address(splitter));
        console.log("");
        console.log("Next: deploy BrawlEscrow / RektArena with treasury =", address(splitter));
        console.log("Then: escrow.setCut(300) and arena.setCutBps(300)");
    }
}
