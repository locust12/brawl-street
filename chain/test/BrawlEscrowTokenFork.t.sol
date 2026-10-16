// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {BrawlEscrowToken} from "../src/BrawlEscrowToken.sol";

/// Runs the whole wager against the REAL USDC and USDT contracts on a fork of Ethereum mainnet.
/// Mocks cannot prove this: mainnet USDT returns no bool from transfer/transferFrom, is behind its
/// own quirky implementation, and USDC is an upgradeable proxy. Either one would break a naive
/// IERC20 integration, and this is where that shows up.
///
///   forge test --match-contract BrawlEscrowTokenFork --fork-url <mainnet rpc>
///
/// Skips itself (passes trivially) when no fork is available, so the offline suite stays green.
contract BrawlEscrowTokenForkTest is Test {
    address constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address constant USDT = 0xdAC17F958D2ee523a2206206994597C13D831ec7;

    BrawlEscrowToken esc;
    address owner = address(0xA11CE);
    address op = address(0x09E7A);
    address treasury = address(0x7EA);
    address alice = address(0xA1);
    address bob = address(0xB0B);

    bool forked;

    function setUp() public {
        forked = USDC.code.length > 0 && USDT.code.length > 0;
        if (!forked) return;
        esc = new BrawlEscrowToken(owner, op, treasury, 300); // 3%
        vm.startPrank(owner);
        esc.setToken(USDC, true);
        esc.setToken(USDT, true);
        vm.stopPrank();
    }

    function _run(address token, uint128 stake) internal {
        deal(token, alice, uint256(stake) * 2);
        deal(token, bob, uint256(stake) * 2);

        // USDT's approve refuses a non-zero -> non-zero change, which is exactly the kind of thing
        // a mock never shows you. Approving from zero each time is what a client must do.
        vm.prank(alice);
        _approve(token, address(esc), stake);
        vm.prank(bob);
        _approve(token, address(esc), stake);

        address[] memory p = new address[](2);
        p[0] = alice;
        p[1] = bob;
        bytes32 id = keccak256(abi.encode(token, stake));
        vm.prank(op);
        esc.open(id, p, token, stake, 600);

        vm.prank(alice);
        esc.deposit(id);
        vm.prank(bob);
        esc.deposit(id);
        assertEq(uint8(esc.getMatch(id).status), uint8(BrawlEscrowToken.Status.Funded), "funded");
        assertEq(_bal(token, address(esc)), uint256(stake) * 2, "pot is held");

        vm.prank(op);
        esc.report(id, bob, keccak256("replay"));

        uint256 pot = uint256(stake) * 2;
        uint256 cut = pot * 300 / 10000;
        uint256 b0 = _bal(token, bob);
        vm.prank(bob);
        esc.claim(id);
        assertEq(_bal(token, bob), b0 + pot - cut, "winner paid the pot less 3%");

        esc.withdrawCut(token);
        assertEq(_bal(token, treasury), cut, "cut reached the treasury");
        assertEq(_bal(token, address(esc)), 0, "nothing stranded in the escrow");
    }

    function _approve(address token, address spender, uint256 amt) internal {
        (bool ok,) = token.call(abi.encodeWithSelector(0x095ea7b3, spender, amt));
        require(ok, "approve failed");
    }

    function _bal(address token, address who) internal view returns (uint256) {
        (bool ok, bytes memory ret) = token.staticcall(abi.encodeWithSelector(0x70a08231, who));
        require(ok, "balanceOf failed");
        return abi.decode(ret, (uint256));
    }

    function test_Fork_RealUSDC() public {
        if (!forked) return;
        _run(USDC, 10_000_000); // 10 USDC
    }

    function test_Fork_RealUSDT() public {
        if (!forked) return;
        _run(USDT, 10_000_000); // 10 USDT
    }

    function test_Fork_RealUSDT_RefundPath() public {
        if (!forked) return;
        uint128 stake = 5_000_000;
        deal(USDT, alice, stake);
        vm.prank(alice);
        _approve(USDT, address(esc), stake);

        address[] memory p = new address[](2);
        p[0] = alice;
        p[1] = bob;
        bytes32 id = keccak256("usdt-refund");
        vm.prank(op);
        esc.open(id, p, USDT, stake, 600);
        vm.prank(alice);
        esc.deposit(id);

        // bob never deposits: after the window anyone can cancel and alice takes her stake back
        vm.warp(block.timestamp + 601);
        esc.cancel(id);
        uint256 a0 = _bal(USDT, alice);
        vm.prank(alice);
        esc.refund(id);
        assertEq(_bal(USDT, alice), a0 + stake, "stake returned in real USDT");
        assertEq(_bal(USDT, address(esc)), 0);
    }
}
