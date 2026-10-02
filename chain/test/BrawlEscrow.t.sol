// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {BrawlEscrow} from "../src/BrawlEscrow.sol";

/// Winner contract that tries to re-enter claim/refund while being paid.
contract Reenterer {
    BrawlEscrow public esc;
    bytes32 public id;
    uint8 public mode; // 1 = re-enter claim, 2 = re-enter refund
    bool public reentered;
    bool public reenterOk;

    constructor(BrawlEscrow e) {
        esc = e;
    }

    function arm(bytes32 i, uint8 m) external {
        id = i;
        mode = m;
    }

    function doDeposit(bytes32 i) external payable {
        esc.deposit{value: msg.value}(i);
    }

    function doClaim() external {
        esc.claim(id);
    }

    function doRefund() external {
        esc.refund(id);
    }

    receive() external payable {
        if (mode == 0 || reentered) return;
        reentered = true;
        if (mode == 1) {
            (reenterOk,) = address(esc).call(abi.encodeCall(BrawlEscrow.claim, (id)));
        } else {
            (reenterOk,) = address(esc).call(abi.encodeCall(BrawlEscrow.refund, (id)));
        }
    }
}

/// A wallet that refuses ETH.
contract Refuser {
    function doDeposit(BrawlEscrow e, bytes32 i) external payable {
        e.deposit{value: msg.value}(i);
    }

    function doRefund(BrawlEscrow e, bytes32 i) external {
        e.refund(i);
    }
}

contract BrawlEscrowTest is Test {
    BrawlEscrow esc;
    address owner = makeAddr("owner");
    address operator = makeAddr("operator");
    address treasury = makeAddr("treasury");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    address dave = makeAddr("dave");
    address eve = makeAddr("eve");
    bytes32 constant ID = keccak256("match-1");
    bytes32 constant REPLAY = keccak256("replay-file");
    uint128 constant STAKE = 0.05 ether;

    function setUp() public {
        esc = new BrawlEscrow(owner, operator, treasury, 0);
        for (uint256 i; i < 5; ++i) vm.deal([alice, bob, carol, dave, eve][i], 100 ether);
    }

    function _two() internal pure returns (address[] memory p) {
        p = new address[](2);
    }

    function _players2() internal view returns (address[] memory p) {
        p = new address[](2);
        p[0] = alice;
        p[1] = bob;
    }

    function _players4() internal view returns (address[] memory p) {
        p = new address[](4);
        p[0] = alice;
        p[1] = bob;
        p[2] = carol;
        p[3] = dave;
    }

    function _open2() internal {
        vm.prank(operator);
        esc.open(ID, _players2(), STAKE, 120);
    }

    function _fund2() internal {
        _open2();
        vm.prank(alice);
        esc.deposit{value: STAKE}(ID);
        vm.prank(bob);
        esc.deposit{value: STAKE}(ID);
    }

    // ------------------------------------------------------------------ config

    function test_Constructor() public view {
        assertEq(esc.owner(), owner);
        assertEq(esc.operator(), operator);
        assertEq(esc.treasury(), treasury);
        assertEq(esc.cutBps(), 0);
    }

    function test_Constructor_Reverts() public {
        vm.expectRevert(BrawlEscrow.ZeroAddress.selector);
        new BrawlEscrow(address(0), operator, treasury, 0);
        vm.expectRevert(BrawlEscrow.ZeroAddress.selector);
        new BrawlEscrow(owner, address(0), treasury, 0);
        vm.expectRevert(BrawlEscrow.ZeroAddress.selector);
        new BrawlEscrow(owner, operator, address(0), 0);
        vm.expectRevert(BrawlEscrow.CutTooHigh.selector);
        new BrawlEscrow(owner, operator, treasury, 1001);
    }

    // ------------------------------------------------------------------ happy paths

    function test_OneVsOne_FullFlow() public {
        vm.expectEmit(true, false, false, true);
        emit BrawlEscrow.Opened(ID, _players2(), STAKE, uint64(block.timestamp + 120));
        _open2();
        BrawlEscrow.Match memory m = esc.getMatch(ID);
        assertEq(uint8(m.status), uint8(BrawlEscrow.Status.Open));
        assertEq(m.playerCount, 2);

        vm.prank(alice);
        esc.deposit{value: STAKE}(ID);
        assertEq(uint8(esc.getMatch(ID).status), uint8(BrawlEscrow.Status.Open));
        vm.expectEmit(true, false, false, true);
        emit BrawlEscrow.Funded(ID, 2 * uint256(STAKE));
        vm.prank(bob);
        esc.deposit{value: STAKE}(ID);
        m = esc.getMatch(ID);
        assertEq(uint8(m.status), uint8(BrawlEscrow.Status.Funded));
        assertEq(m.fundedAt, block.timestamp);
        assertEq(address(esc).balance, 2 * uint256(STAKE));

        vm.prank(operator);
        esc.report(ID, bob, REPLAY);
        m = esc.getMatch(ID);
        assertEq(uint8(m.status), uint8(BrawlEscrow.Status.Settled));
        assertEq(m.winner, bob);
        assertEq(m.replayHash, REPLAY);
        assertEq(esc.claimable(ID, bob), 2 * uint256(STAKE));
        assertEq(esc.claimable(ID, alice), 0);

        uint256 before = bob.balance;
        vm.prank(bob);
        esc.claim(ID);
        assertEq(bob.balance - before, 2 * uint256(STAKE));
        assertEq(address(esc).balance, 0);
        assertEq(esc.claimable(ID, bob), 0);
    }

    function test_FourPlayerFFA_FullFlow() public {
        vm.prank(operator);
        esc.open(ID, _players4(), STAKE, 300);
        address[] memory p = _players4();
        for (uint256 i; i < 4; ++i) {
            vm.prank(p[i]);
            esc.deposit{value: STAKE}(ID);
        }
        assertEq(uint8(esc.getMatch(ID).status), uint8(BrawlEscrow.Status.Funded));
        assertEq(esc.playersOf(ID).length, 4);
        vm.prank(operator);
        esc.report(ID, carol, REPLAY);
        uint256 before = carol.balance;
        vm.prank(carol);
        esc.claim(ID);
        assertEq(carol.balance - before, 4 * uint256(STAKE));
    }

    function test_Cut_HeldForTreasury_NeverBlocksClaim() public {
        vm.prank(owner);
        esc.setCut(500); // 5%
        _fund2();
        vm.prank(operator);
        esc.report(ID, alice, REPLAY);
        uint256 pot = 2 * uint256(STAKE);
        assertEq(esc.claimable(ID, alice), pot - pot * 500 / 10000);
        uint256 before = alice.balance;
        vm.prank(alice);
        esc.claim(ID);
        assertEq(alice.balance - before, pot - pot * 500 / 10000);
        assertEq(esc.cutBalance(), pot * 500 / 10000);
        vm.prank(eve);
        esc.withdrawCut();
        assertEq(treasury.balance, pot * 500 / 10000);
        assertEq(esc.cutBalance(), 0);
        assertEq(address(esc).balance, 0);
    }

    function test_CutSnapshot_ChangeAfterOpenIgnored() public {
        _open2();
        vm.prank(owner);
        esc.setCut(1000);
        vm.prank(alice);
        esc.deposit{value: STAKE}(ID);
        vm.prank(bob);
        esc.deposit{value: STAKE}(ID);
        vm.prank(operator);
        esc.report(ID, alice, REPLAY);
        assertEq(esc.claimable(ID, alice), 2 * uint256(STAKE));
    }

    // ------------------------------------------------------------------ open validation

    function test_Open_OnlyOperator() public {
        address[] memory p = _players2();
        vm.expectRevert(BrawlEscrow.NotOperator.selector);
        vm.prank(owner);
        esc.open(ID, p, STAKE, 120);
    }

    function test_Open_Validation() public {
        address[] memory one = new address[](1);
        one[0] = alice;
        vm.startPrank(operator);
        vm.expectRevert(BrawlEscrow.BadPlayers.selector);
        esc.open(ID, one, STAKE, 120);
        address[] memory five = new address[](5);
        for (uint256 i; i < 5; ++i) five[i] = [alice, bob, carol, dave, eve][i];
        vm.expectRevert(BrawlEscrow.BadPlayers.selector);
        esc.open(ID, five, STAKE, 120);
        address[] memory dup = new address[](2);
        dup[0] = alice;
        dup[1] = alice;
        vm.expectRevert(BrawlEscrow.BadPlayers.selector);
        esc.open(ID, dup, STAKE, 120);
        address[] memory zero = _two();
        zero[0] = alice;
        vm.expectRevert(BrawlEscrow.BadPlayers.selector);
        esc.open(ID, zero, STAKE, 120);
        vm.expectRevert(BrawlEscrow.BadStake.selector);
        esc.open(ID, _players2(), 0, 120);
        vm.expectRevert(BrawlEscrow.BadWindow.selector);
        esc.open(ID, _players2(), STAKE, 29);
        vm.expectRevert(BrawlEscrow.BadWindow.selector);
        esc.open(ID, _players2(), STAKE, 3601);
        esc.open(ID, _players2(), STAKE, 120);
        vm.expectRevert(BrawlEscrow.BadStatus.selector);
        esc.open(ID, _players2(), STAKE, 120);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ deposits

    function test_Deposit_Validation() public {
        _open2();
        vm.expectRevert(BrawlEscrow.NotInvited.selector);
        vm.prank(eve);
        esc.deposit{value: STAKE}(ID);
        vm.expectRevert(BrawlEscrow.WrongAmount.selector);
        vm.prank(alice);
        esc.deposit{value: STAKE - 1}(ID);
        vm.expectRevert(BrawlEscrow.WrongAmount.selector);
        vm.prank(alice);
        esc.deposit{value: STAKE + 1}(ID);
        vm.prank(alice);
        esc.deposit{value: STAKE}(ID);
        vm.expectRevert(BrawlEscrow.NotInvited.selector);
        vm.prank(alice);
        esc.deposit{value: STAKE}(ID);
        vm.expectRevert(BrawlEscrow.BadStatus.selector);
        vm.prank(alice);
        esc.deposit{value: STAKE}(keccak256("nope"));
    }

    function test_Deposit_AfterWindow_Reverts() public {
        _open2();
        vm.warp(block.timestamp + 121);
        vm.expectRevert(BrawlEscrow.DepositClosed.selector);
        vm.prank(alice);
        esc.deposit{value: STAKE}(ID);
    }

    function test_Deposit_OnFundedMatch_Reverts() public {
        _fund2();
        vm.expectRevert(BrawlEscrow.BadStatus.selector);
        vm.prank(alice);
        esc.deposit{value: STAKE}(ID);
    }

    function test_NoDirectEth() public {
        vm.prank(alice);
        (bool ok,) = address(esc).call{value: 1 ether}("");
        assertFalse(ok);
    }

    // ------------------------------------------------------------------ report

    function test_Report_Validation() public {
        _open2();
        vm.expectRevert(BrawlEscrow.BadStatus.selector);
        vm.prank(operator);
        esc.report(ID, alice, REPLAY); // not funded yet
        vm.prank(alice);
        esc.deposit{value: STAKE}(ID);
        vm.prank(bob);
        esc.deposit{value: STAKE}(ID);
        vm.expectRevert(BrawlEscrow.NotOperator.selector);
        vm.prank(alice);
        esc.report(ID, alice, REPLAY);
        vm.expectRevert(BrawlEscrow.NotAPlayer.selector);
        vm.prank(operator);
        esc.report(ID, eve, REPLAY);
        vm.prank(operator);
        esc.report(ID, alice, REPLAY);
        vm.expectRevert(BrawlEscrow.BadStatus.selector);
        vm.prank(operator);
        esc.report(ID, bob, REPLAY);
    }

    // ------------------------------------------------------------------ claim

    function test_Claim_Validation() public {
        _fund2();
        vm.expectRevert(BrawlEscrow.BadStatus.selector);
        vm.prank(alice);
        esc.claim(ID);
        vm.prank(operator);
        esc.report(ID, alice, REPLAY);
        vm.expectRevert(BrawlEscrow.NotWinner.selector);
        vm.prank(bob);
        esc.claim(ID);
        vm.prank(alice);
        esc.claim(ID);
        vm.expectRevert(BrawlEscrow.AlreadyPaid.selector);
        vm.prank(alice);
        esc.claim(ID);
    }

    // ------------------------------------------------------------------ cancel + refund

    function test_Cancel_OpenByOperatorAnytime_RefundsDepositors() public {
        _open2();
        vm.prank(alice);
        esc.deposit{value: STAKE}(ID);
        vm.prank(operator);
        esc.cancel(ID);
        assertEq(uint8(esc.getMatch(ID).status), uint8(BrawlEscrow.Status.Cancelled));
        assertEq(esc.claimable(ID, alice), STAKE);
        assertEq(esc.claimable(ID, bob), 0);
        uint256 before = alice.balance;
        vm.prank(alice);
        esc.refund(ID);
        assertEq(alice.balance - before, STAKE);
        vm.expectRevert(BrawlEscrow.NothingToRefund.selector);
        vm.prank(alice);
        esc.refund(ID);
        vm.expectRevert(BrawlEscrow.NothingToRefund.selector);
        vm.prank(bob);
        esc.refund(ID); // never deposited
        assertEq(address(esc).balance, 0);
    }

    function test_Cancel_OpenByAnyoneOnlyAfterWindow() public {
        _open2();
        vm.expectRevert(BrawlEscrow.TooEarly.selector);
        vm.prank(eve);
        esc.cancel(ID);
        vm.warp(block.timestamp + 121);
        vm.prank(eve);
        esc.cancel(ID);
        assertEq(uint8(esc.getMatch(ID).status), uint8(BrawlEscrow.Status.Cancelled));
    }

    function test_Cancel_FundedByAnyoneOnlyAfterReportTimeout() public {
        _fund2();
        vm.warp(block.timestamp + 2 hours);
        vm.expectRevert(BrawlEscrow.TooEarly.selector);
        vm.prank(eve);
        esc.cancel(ID);
        vm.warp(block.timestamp + 1);
        vm.prank(eve);
        esc.cancel(ID);
        uint256 a = alice.balance;
        uint256 b = bob.balance;
        vm.prank(alice);
        esc.refund(ID);
        vm.prank(bob);
        esc.refund(ID);
        assertEq(alice.balance - a, STAKE);
        assertEq(bob.balance - b, STAKE);
        assertEq(address(esc).balance, 0);
    }

    function test_Cancel_FundedByOperator() public {
        _fund2();
        vm.prank(operator);
        esc.cancel(ID);
        assertEq(uint8(esc.getMatch(ID).status), uint8(BrawlEscrow.Status.Cancelled));
    }

    function test_Cancel_RevertsWhenSettledOrCancelledOrNone() public {
        vm.expectRevert(BrawlEscrow.BadStatus.selector);
        vm.prank(operator);
        esc.cancel(ID);
        _fund2();
        vm.prank(operator);
        esc.report(ID, bob, REPLAY);
        vm.expectRevert(BrawlEscrow.BadStatus.selector);
        vm.prank(operator);
        esc.cancel(ID);
        bytes32 id2 = keccak256("m2");
        vm.prank(operator);
        esc.open(id2, _players2(), STAKE, 60);
        vm.prank(operator);
        esc.cancel(id2);
        vm.expectRevert(BrawlEscrow.BadStatus.selector);
        vm.prank(operator);
        esc.cancel(id2);
    }

    function test_Refund_BeforeCancel_Reverts() public {
        _fund2();
        vm.expectRevert(BrawlEscrow.BadStatus.selector);
        vm.prank(alice);
        esc.refund(ID);
    }

    function test_ReportAfterCancel_Reverts() public {
        _fund2();
        vm.prank(operator);
        esc.cancel(ID);
        vm.expectRevert(BrawlEscrow.BadStatus.selector);
        vm.prank(operator);
        esc.report(ID, alice, REPLAY);
    }

    // ------------------------------------------------------------------ reentrancy + odd receivers

    function test_Reentrancy_Claim() public {
        Reenterer r = new Reenterer(esc);
        vm.deal(address(r), 1 ether);
        address[] memory p = new address[](2);
        p[0] = address(r);
        p[1] = bob;
        vm.prank(operator);
        esc.open(ID, p, STAKE, 120);
        r.doDeposit{value: STAKE}(ID);
        vm.prank(bob);
        esc.deposit{value: STAKE}(ID);
        vm.prank(operator);
        esc.report(ID, address(r), REPLAY);
        r.arm(ID, 1);
        uint256 before = address(r).balance;
        r.doClaim();
        assertTrue(r.reentered());
        assertFalse(r.reenterOk());
        assertEq(address(r).balance - before, 2 * uint256(STAKE));
        assertEq(address(esc).balance, 0);
    }

    function test_Reentrancy_Refund() public {
        Reenterer r = new Reenterer(esc);
        vm.deal(address(r), 1 ether);
        address[] memory p = new address[](2);
        p[0] = address(r);
        p[1] = bob;
        vm.prank(operator);
        esc.open(ID, p, STAKE, 120);
        r.doDeposit{value: STAKE}(ID);
        vm.prank(bob);
        esc.deposit{value: STAKE}(ID);
        vm.prank(operator);
        esc.cancel(ID);
        r.arm(ID, 2);
        uint256 before = address(r).balance;
        r.doRefund();
        assertTrue(r.reentered());
        assertFalse(r.reenterOk());
        assertEq(address(r).balance - before, STAKE);
        assertEq(address(esc).balance, STAKE); // bob's stake is still there for bob
    }

    function test_RefuserCannotBlockOthers() public {
        Refuser z = new Refuser();
        vm.deal(address(z), 1 ether);
        address[] memory p = new address[](2);
        p[0] = address(z);
        p[1] = bob;
        vm.prank(operator);
        esc.open(ID, p, STAKE, 120);
        z.doDeposit{value: STAKE}(esc, ID);
        vm.prank(bob);
        esc.deposit{value: STAKE}(ID);
        vm.prank(operator);
        esc.cancel(ID);
        vm.expectRevert(BrawlEscrow.TransferFailed.selector);
        z.doRefund(esc, ID);
        uint256 before = bob.balance;
        vm.prank(bob);
        esc.refund(ID);
        assertEq(bob.balance - before, STAKE);
    }

    // ------------------------------------------------------------------ admin

    function test_OnlyOwner() public {
        vm.startPrank(eve);
        vm.expectRevert(BrawlEscrow.NotOwner.selector);
        esc.setOperator(eve);
        vm.expectRevert(BrawlEscrow.NotOwner.selector);
        esc.setTreasury(eve);
        vm.expectRevert(BrawlEscrow.NotOwner.selector);
        esc.setCut(1);
        vm.expectRevert(BrawlEscrow.NotOwner.selector);
        esc.transferOwnership(eve);
        vm.stopPrank();
    }

    function test_OwnerSetters() public {
        vm.startPrank(owner);
        esc.setOperator(carol);
        assertEq(esc.operator(), carol);
        esc.setTreasury(dave);
        assertEq(esc.treasury(), dave);
        esc.setCut(1000);
        assertEq(esc.cutBps(), 1000);
        vm.expectRevert(BrawlEscrow.CutTooHigh.selector);
        esc.setCut(1001);
        vm.expectRevert(BrawlEscrow.ZeroAddress.selector);
        esc.setOperator(address(0));
        vm.expectRevert(BrawlEscrow.ZeroAddress.selector);
        esc.setTreasury(address(0));
        esc.transferOwnership(eve);
        vm.stopPrank();
        assertEq(esc.owner(), owner);
        vm.expectRevert(BrawlEscrow.NotPendingOwner.selector);
        vm.prank(dave);
        esc.acceptOwnership();
        vm.prank(eve);
        esc.acceptOwnership();
        assertEq(esc.owner(), eve);
        assertEq(esc.pendingOwner(), address(0));
    }

    function test_OldOperatorLosesPower() public {
        _fund2();
        vm.prank(owner);
        esc.setOperator(carol);
        vm.expectRevert(BrawlEscrow.NotOperator.selector);
        vm.prank(operator);
        esc.report(ID, alice, REPLAY);
        vm.prank(carol);
        esc.report(ID, alice, REPLAY);
    }

    // ------------------------------------------------------------------ fuzz

    /// Any number of players, stake, cut, winner and path: the contract ends up holding exactly the
    /// unwithdrawn cut, and every wei paid out went to the winner, the treasury, or back to depositors.
    function testFuzz_Solvency(uint8 nRaw, uint96 stakeRaw, uint16 cutRaw, uint8 winRaw, uint8 path) public {
        uint256 n = 2 + (nRaw % 3);
        uint128 stake = uint128(bound(stakeRaw, 1, 1000 ether));
        uint16 cut = uint16(bound(cutRaw, 0, 1000));
        vm.prank(owner);
        esc.setCut(cut);
        address[] memory p = new address[](n);
        for (uint256 i; i < n; ++i) {
            p[i] = address(uint160(0x1000 + i));
            vm.deal(p[i], uint256(stake));
        }
        vm.prank(operator);
        esc.open(ID, p, stake, 600);
        uint256 deposits = path % 3 == 0 ? n - 1 : n; // path 0: someone never deposits
        for (uint256 i; i < deposits; ++i) {
            vm.prank(p[i]);
            esc.deposit{value: stake}(ID);
        }
        if (path % 3 == 0) {
            vm.warp(block.timestamp + 601);
            esc.cancel(ID);
            for (uint256 i; i < deposits; ++i) {
                vm.prank(p[i]);
                esc.refund(ID);
                assertEq(p[i].balance, stake);
            }
            assertEq(address(esc).balance, 0);
        } else if (path % 3 == 1) {
            address w = p[winRaw % n];
            vm.prank(operator);
            esc.report(ID, w, REPLAY);
            vm.prank(w);
            esc.claim(ID);
            uint256 pot = uint256(stake) * n;
            assertEq(w.balance, pot - pot * cut / 10000);
            assertEq(address(esc).balance, pot * cut / 10000);
            esc.withdrawCut();
            assertEq(treasury.balance, pot * cut / 10000);
            assertEq(address(esc).balance, 0);
        } else {
            vm.prank(operator);
            esc.cancel(ID);
            for (uint256 i; i < n; ++i) {
                vm.prank(p[i]);
                esc.refund(ID);
                assertEq(p[i].balance, stake);
            }
            assertEq(address(esc).balance, 0);
        }
    }

    /// Nobody outside the match can move its money, whatever they call.
    function testFuzz_OutsiderCannotTouchStakes(address who) public {
        vm.assume(who != alice && who != bob && who != operator && who != owner && who != address(0));
        _fund2();
        vm.startPrank(who);
        vm.expectRevert();
        esc.claim(ID);
        vm.expectRevert();
        esc.refund(ID);
        vm.expectRevert();
        esc.report(ID, who, REPLAY);
        vm.expectRevert();
        esc.cancel(ID);
        vm.stopPrank();
        assertEq(address(esc).balance, 2 * uint256(STAKE));
    }
}
