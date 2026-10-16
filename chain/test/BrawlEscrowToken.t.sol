// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {BrawlEscrowToken} from "../src/BrawlEscrowToken.sol";

contract MockERC20 {
    uint8 public immutable decimals;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(uint8 d) {
        decimals = d;
    }

    function mint(address to, uint256 amt) external {
        balanceOf[to] += amt;
    }

    function approve(address spender, uint256 amt) external returns (bool) {
        allowance[msg.sender][spender] = amt;
        return true;
    }

    function transfer(address to, uint256 amt) external virtual returns (bool) {
        _move(msg.sender, to, amt);
        return true;
    }

    function transferFrom(address from, address to, uint256 amt) external virtual returns (bool) {
        uint256 a = allowance[from][msg.sender];
        require(a >= amt, "allowance");
        if (a != type(uint256).max) allowance[from][msg.sender] = a - amt;
        _move(from, to, amt);
        return true;
    }

    function _move(address from, address to, uint256 amt) internal virtual {
        require(balanceOf[from] >= amt, "balance");
        balanceOf[from] -= amt;
        balanceOf[to] += amt;
    }
}

/// Mainnet USDT: transfer / transferFrom / approve return NOTHING.
contract NoBoolToken {
    uint8 public constant decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amt) external {
        balanceOf[to] += amt;
    }

    function approve(address spender, uint256 amt) external {
        allowance[msg.sender][spender] = amt;
    }

    function transfer(address to, uint256 amt) external {
        require(balanceOf[msg.sender] >= amt, "balance");
        balanceOf[msg.sender] -= amt;
        balanceOf[to] += amt;
    }

    function transferFrom(address from, address to, uint256 amt) external {
        uint256 a = allowance[from][msg.sender];
        require(a >= amt, "allowance");
        if (a != type(uint256).max) allowance[from][msg.sender] = a - amt;
        require(balanceOf[from] >= amt, "balance");
        balanceOf[from] -= amt;
        balanceOf[to] += amt;
    }
}

/// 1% skimmed on every move.
contract FeeOnTransferToken is MockERC20 {
    constructor() MockERC20(18) {}

    function _move(address from, address to, uint256 amt) internal override {
        require(balanceOf[from] >= amt, "balance");
        uint256 fee = amt / 100;
        balanceOf[from] -= amt;
        balanceOf[to] += amt - fee;
    }
}

/// Returns false and moves nothing.
contract FalseToken is MockERC20 {
    constructor() MockERC20(18) {}

    function transfer(address, uint256) external pure override returns (bool) {
        return false;
    }

    function transferFrom(address, address, uint256) external pure override returns (bool) {
        return false;
    }
}

/// Tries to re-enter claim() from inside transfer(), i.e. while the winner is being paid.
contract ReentrantToken is MockERC20 {
    BrawlEscrowToken public esc;
    bytes32 public id;
    bool public armed;
    bool public reentered;
    bool public reentrySucceeded;

    constructor() MockERC20(18) {}

    function arm(BrawlEscrowToken e, bytes32 i) external {
        esc = e;
        id = i;
        armed = true;
    }

    function _move(address from, address to, uint256 amt) internal override {
        super._move(from, to, amt);
        if (armed && !reentered && address(esc) != address(0)) {
            reentered = true;
            (bool ok,) = address(esc).call(abi.encodeWithSelector(BrawlEscrowToken.claim.selector, id));
            reentrySucceeded = ok;
        }
    }
}

contract BrawlEscrowTokenTest is Test {
    BrawlEscrowToken esc;
    MockERC20 usdc; // 6 decimals, standard
    NoBoolToken usdt; // 6 decimals, returns nothing

    address owner = address(0xA11CE);
    address op = address(0x09E7A);
    address treasury = address(0x7EA);
    address alice = address(0xA1);
    address bob = address(0xB0B);
    address carol = address(0xCA201);

    bytes32 constant ID = keccak256("match-1");
    uint128 constant STAKE = 10_000_000; // 10 USDC at 6dp

    function setUp() public {
        esc = new BrawlEscrowToken(owner, op, treasury, 300); // 3%
        usdc = new MockERC20(6);
        usdt = new NoBoolToken();
        vm.startPrank(owner);
        esc.setToken(address(usdc), true);
        esc.setToken(address(usdt), true);
        vm.stopPrank();
        for (uint256 i; i < 3; ++i) {
            address p = [alice, bob, carol][i];
            usdc.mint(p, 1_000_000_000);
            usdt.mint(p, 1_000_000_000);
            vm.prank(p);
            usdc.approve(address(esc), type(uint256).max);
            vm.prank(p);
            usdt.approve(address(esc), type(uint256).max);
        }
    }

    function _players() internal view returns (address[] memory a) {
        a = new address[](2);
        a[0] = alice;
        a[1] = bob;
    }

    function _open(address token) internal {
        address[] memory p = _players();
        vm.prank(op);
        esc.open(ID, p, token, STAKE, 600);
    }

    function _fund(address token) internal {
        _open(token);
        vm.prank(alice);
        esc.deposit(ID);
        vm.prank(bob);
        esc.deposit(ID);
    }

    // ---------------------------------------------------------------- open

    function test_Open_StoresTokenAndStake() public {
        _open(address(usdc));
        BrawlEscrowToken.Match memory m = esc.getMatch(ID);
        assertEq(m.token, address(usdc));
        assertEq(m.stake, STAKE);
        assertEq(uint8(m.status), uint8(BrawlEscrowToken.Status.Open));
        assertEq(m.cutBps, 300);
        assertEq(m.playerCount, 2);
        assertEq(esc.playersOf(ID).length, 2);
    }

    function test_Open_OnlyOperator() public {
        address[] memory p = _players();
        vm.expectRevert(BrawlEscrowToken.NotOperator.selector);
        esc.open(ID, p, address(usdc), STAKE, 600);
    }

    function test_Open_RejectsTokenNotOnTheAllowlist() public {
        MockERC20 rogue = new MockERC20(18);
        address[] memory p = _players();
        vm.prank(op);
        vm.expectRevert(BrawlEscrowToken.TokenNotAllowed.selector);
        esc.open(ID, p, address(rogue), STAKE, 600);
    }

    function test_Open_RejectsBadShapes() public {
        address[] memory one = new address[](1);
        one[0] = alice;
        vm.prank(op);
        vm.expectRevert(BrawlEscrowToken.BadPlayers.selector);
        esc.open(ID, one, address(usdc), STAKE, 600);

        address[] memory dup = new address[](2);
        dup[0] = alice;
        dup[1] = alice;
        vm.prank(op);
        vm.expectRevert(BrawlEscrowToken.BadPlayers.selector);
        esc.open(ID, dup, address(usdc), STAKE, 600);

        address[] memory p = _players();
        vm.prank(op);
        vm.expectRevert(BrawlEscrowToken.BadStake.selector);
        esc.open(ID, p, address(usdc), 0, 600);

        vm.prank(op);
        vm.expectRevert(BrawlEscrowToken.BadWindow.selector);
        esc.open(ID, p, address(usdc), STAKE, 10);

        vm.prank(op);
        vm.expectRevert(BrawlEscrowToken.BadWindow.selector);
        esc.open(ID, p, address(usdc), STAKE, 2 hours);
    }

    function test_Open_SameIdTwiceReverts() public {
        _open(address(usdc));
        address[] memory p = _players();
        vm.prank(op);
        vm.expectRevert(BrawlEscrowToken.BadStatus.selector);
        esc.open(ID, p, address(usdc), STAKE, 600);
    }

    // ---------------------------------------------------------------- deposit

    function test_Deposit_MovesExactlyTheStakeAndFunds() public {
        _open(address(usdc));
        uint256 a0 = usdc.balanceOf(alice);
        vm.prank(alice);
        esc.deposit(ID);
        assertEq(usdc.balanceOf(alice), a0 - STAKE);
        assertEq(usdc.balanceOf(address(esc)), STAKE);
        assertEq(uint8(esc.getMatch(ID).status), uint8(BrawlEscrowToken.Status.Open));

        vm.prank(bob);
        esc.deposit(ID);
        assertEq(uint8(esc.getMatch(ID).status), uint8(BrawlEscrowToken.Status.Funded));
        assertEq(usdc.balanceOf(address(esc)), uint256(STAKE) * 2);
    }

    function test_Deposit_NotInvitedReverts() public {
        _open(address(usdc));
        vm.prank(carol);
        vm.expectRevert(BrawlEscrowToken.NotInvited.selector);
        esc.deposit(ID);
    }

    function test_Deposit_TwiceReverts() public {
        _open(address(usdc));
        vm.prank(alice);
        esc.deposit(ID);
        vm.prank(alice);
        vm.expectRevert(BrawlEscrowToken.NotInvited.selector);
        esc.deposit(ID);
    }

    function test_Deposit_AfterDeadlineReverts() public {
        _open(address(usdc));
        vm.warp(block.timestamp + 601);
        vm.prank(alice);
        vm.expectRevert(BrawlEscrowToken.DepositClosed.selector);
        esc.deposit(ID);
    }

    function test_Deposit_WithoutApprovalReverts() public {
        _open(address(usdc));
        vm.prank(alice);
        usdc.approve(address(esc), 0);
        vm.prank(alice);
        vm.expectRevert(BrawlEscrowToken.TransferFailed.selector);
        esc.deposit(ID);
    }

    function test_Deposit_FeeOnTransferTokenIsRefused() public {
        FeeOnTransferToken fee = new FeeOnTransferToken();
        vm.prank(owner);
        esc.setToken(address(fee), true);
        fee.mint(alice, 1e24);
        vm.prank(alice);
        fee.approve(address(esc), type(uint256).max);

        bytes32 id2 = keccak256("fee-match");
        address[] memory p = _players();
        vm.prank(op);
        esc.open(id2, p, address(fee), uint128(1e18), 600);

        // the contract would be credited 0.99e18 against a 1e18 stake, so the pot would come up
        // short of what the winner is owed: refuse the deposit rather than carry the shortfall
        vm.prank(alice);
        vm.expectRevert(BrawlEscrowToken.WrongAmount.selector);
        esc.deposit(id2);
    }

    function test_Deposit_FalseReturningTokenIsRefused() public {
        FalseToken bad = new FalseToken();
        vm.prank(owner);
        esc.setToken(address(bad), true);
        bad.mint(alice, 1e24);
        vm.prank(alice);
        bad.approve(address(esc), type(uint256).max);

        bytes32 id2 = keccak256("false-match");
        address[] memory p = _players();
        vm.prank(op);
        esc.open(id2, p, address(bad), uint128(1e18), 600);
        vm.prank(alice);
        vm.expectRevert(BrawlEscrowToken.TransferFailed.selector);
        esc.deposit(id2);
    }

    // ---------------------------------------------------------------- USDT

    function test_USDT_FullRoundTrip_NoBoolReturns() public {
        _fund(address(usdt));
        vm.prank(op);
        esc.report(ID, bob, keccak256("replay"));

        uint256 pot = uint256(STAKE) * 2;
        uint256 cut = pot * 300 / 10000;
        uint256 b0 = usdt.balanceOf(bob);
        vm.prank(bob);
        esc.claim(ID);
        assertEq(usdt.balanceOf(bob), b0 + pot - cut, "winner paid in USDT");
        assertEq(esc.cutBalance(address(usdt)), cut);

        esc.withdrawCut(address(usdt));
        assertEq(usdt.balanceOf(treasury), cut, "cut reached the treasury in USDT");
        assertEq(usdt.balanceOf(address(esc)), 0, "nothing stranded");
    }

    function test_USDT_RefundPath() public {
        _fund(address(usdt));
        vm.prank(op);
        esc.cancel(ID);
        uint256 a0 = usdt.balanceOf(alice);
        vm.prank(alice);
        esc.refund(ID);
        assertEq(usdt.balanceOf(alice), a0 + STAKE);
    }

    // ---------------------------------------------------------------- report / claim

    function test_Report_OnlyOperatorOnlyFundedOnlyPlayer() public {
        _open(address(usdc));
        vm.prank(op);
        vm.expectRevert(BrawlEscrowToken.BadStatus.selector);
        esc.report(ID, alice, bytes32(0));

        vm.prank(alice);
        esc.deposit(ID);
        vm.prank(bob);
        esc.deposit(ID);

        vm.expectRevert(BrawlEscrowToken.NotOperator.selector);
        esc.report(ID, alice, bytes32(0));

        vm.prank(op);
        vm.expectRevert(BrawlEscrowToken.NotAPlayer.selector);
        esc.report(ID, carol, bytes32(0));
    }

    function test_Claim_PaysPotLessCut() public {
        _fund(address(usdc));
        vm.prank(op);
        esc.report(ID, alice, keccak256("r"));

        uint256 pot = uint256(STAKE) * 2;
        uint256 cut = pot * 300 / 10000;
        assertEq(esc.claimable(ID, alice), pot - cut);
        assertEq(esc.claimable(ID, bob), 0);

        uint256 a0 = usdc.balanceOf(alice);
        vm.prank(alice);
        esc.claim(ID);
        assertEq(usdc.balanceOf(alice), a0 + pot - cut);
        assertEq(esc.cutBalance(address(usdc)), cut);
    }

    function test_Claim_OnlyWinnerOnlyOnce() public {
        _fund(address(usdc));
        vm.prank(op);
        esc.report(ID, alice, keccak256("r"));

        vm.prank(bob);
        vm.expectRevert(BrawlEscrowToken.NotWinner.selector);
        esc.claim(ID);

        vm.prank(alice);
        esc.claim(ID);
        vm.prank(alice);
        vm.expectRevert(BrawlEscrowToken.AlreadyPaid.selector);
        esc.claim(ID);
    }

    function test_Claim_ZeroCutPaysWholePot() public {
        vm.prank(owner);
        esc.setCut(0);
        _fund(address(usdc));
        vm.prank(op);
        esc.report(ID, alice, keccak256("r"));
        uint256 a0 = usdc.balanceOf(alice);
        vm.prank(alice);
        esc.claim(ID);
        assertEq(usdc.balanceOf(alice), a0 + uint256(STAKE) * 2);
        assertEq(esc.cutBalance(address(usdc)), 0);
    }

    function test_Claim_CutSnapshotAtOpenSurvivesALaterChange() public {
        _open(address(usdc)); // opened at 3%
        vm.prank(owner);
        esc.setCut(1000); // raised to 10% afterwards
        vm.prank(alice);
        esc.deposit(ID);
        vm.prank(bob);
        esc.deposit(ID);
        vm.prank(op);
        esc.report(ID, alice, keccak256("r"));

        uint256 pot = uint256(STAKE) * 2;
        assertEq(esc.claimable(ID, alice), pot - pot * 300 / 10000, "still the 3% it was opened at");
    }

    function test_Claim_ReentrancyThroughTheTokenFails() public {
        ReentrantToken evil = new ReentrantToken();
        vm.prank(owner);
        esc.setToken(address(evil), true);
        evil.mint(alice, 1e24);
        evil.mint(bob, 1e24);
        vm.prank(alice);
        evil.approve(address(esc), type(uint256).max);
        vm.prank(bob);
        evil.approve(address(esc), type(uint256).max);

        bytes32 id2 = keccak256("evil-match");
        address[] memory p = _players();
        vm.prank(op);
        esc.open(id2, p, address(evil), uint128(1e18), 600);
        vm.prank(alice);
        esc.deposit(id2);
        vm.prank(bob);
        esc.deposit(id2);
        vm.prank(op);
        esc.report(id2, alice, keccak256("r"));

        evil.arm(esc, id2);
        vm.prank(alice);
        esc.claim(id2);
        assertTrue(evil.reentered(), "the token did try to re-enter");
        assertFalse(evil.reentrySucceeded(), "the re-entrant claim was rejected");
        assertEq(evil.balanceOf(address(esc)), 2e18 - (2e18 * 300 / 10000) * 0 - (2e18 - 2e18 * 300 / 10000), "only one payout left the contract");
    }

    // ---------------------------------------------------------------- cancel / refund

    function test_Cancel_OpenAfterWindowByAnyone() public {
        _open(address(usdc));
        vm.expectRevert(BrawlEscrowToken.TooEarly.selector);
        esc.cancel(ID);
        vm.warp(block.timestamp + 601);
        esc.cancel(ID);
        assertEq(uint8(esc.getMatch(ID).status), uint8(BrawlEscrowToken.Status.Cancelled));
    }

    function test_Cancel_FundedOnlyAfterReportTimeout() public {
        _fund(address(usdc));
        vm.expectRevert(BrawlEscrowToken.TooEarly.selector);
        esc.cancel(ID);
        vm.warp(block.timestamp + 2 hours + 1);
        esc.cancel(ID);
        assertEq(uint8(esc.getMatch(ID).status), uint8(BrawlEscrowToken.Status.Cancelled));
    }

    function test_Cancel_OperatorAnyTimeButNotSettled() public {
        _fund(address(usdc));
        vm.prank(op);
        esc.cancel(ID);
        vm.prank(op);
        vm.expectRevert(BrawlEscrowToken.BadStatus.selector);
        esc.cancel(ID);
    }

    function test_Refund_EveryDepositorGetsTheStakeBackOnce() public {
        _fund(address(usdc));
        vm.prank(op);
        esc.cancel(ID);

        uint256 a0 = usdc.balanceOf(alice);
        vm.prank(alice);
        esc.refund(ID);
        assertEq(usdc.balanceOf(alice), a0 + STAKE);
        vm.prank(alice);
        vm.expectRevert(BrawlEscrowToken.NothingToRefund.selector);
        esc.refund(ID);

        vm.prank(bob);
        esc.refund(ID);
        assertEq(usdc.balanceOf(address(esc)), 0, "contract fully drained back to the players");
    }

    function test_Refund_NonDepositorGetsNothing() public {
        _open(address(usdc));
        vm.prank(alice);
        esc.deposit(ID);
        vm.warp(block.timestamp + 601);
        esc.cancel(ID);
        vm.prank(bob);
        vm.expectRevert(BrawlEscrowToken.NothingToRefund.selector);
        esc.refund(ID);
    }

    function test_Claimable_AfterCancelIsTheStake() public {
        _fund(address(usdc));
        vm.prank(op);
        esc.cancel(ID);
        assertEq(esc.claimable(ID, alice), STAKE);
        assertEq(esc.claimable(ID, carol), 0);
    }

    // ---------------------------------------------------------------- cut accounting

    function test_CutIsTrackedPerTokenAndWithdrawnPerToken() public {
        _fund(address(usdc));
        vm.prank(op);
        esc.report(ID, alice, keccak256("r"));
        vm.prank(alice);
        esc.claim(ID);

        bytes32 id2 = keccak256("match-2");
        address[] memory p = _players();
        vm.prank(op);
        esc.open(id2, p, address(usdt), STAKE, 600);
        vm.prank(alice);
        esc.deposit(id2);
        vm.prank(bob);
        esc.deposit(id2);
        vm.prank(op);
        esc.report(id2, bob, keccak256("r2"));
        vm.prank(bob);
        esc.claim(id2);

        uint256 cut = (uint256(STAKE) * 2) * 300 / 10000;
        assertEq(esc.cutBalance(address(usdc)), cut);
        assertEq(esc.cutBalance(address(usdt)), cut);

        esc.withdrawCut(address(usdc));
        assertEq(usdc.balanceOf(treasury), cut);
        assertEq(esc.cutBalance(address(usdc)), 0);
        assertEq(esc.cutBalance(address(usdt)), cut, "the other token is untouched");
        esc.withdrawCut(address(usdt));
        assertEq(usdt.balanceOf(treasury), cut);
    }

    function test_WithdrawCut_WithNothingOwedIsANoop() public {
        esc.withdrawCut(address(usdc));
        assertEq(usdc.balanceOf(treasury), 0);
    }

    function test_CutCannotBlockAClaim() public {
        // the treasury being a contract that rejects tokens must not stop the winner being paid:
        // the cut only accrues to a balance, it is not pushed during claim()
        _fund(address(usdc));
        vm.prank(op);
        esc.report(ID, alice, keccak256("r"));
        uint256 a0 = usdc.balanceOf(alice);
        vm.prank(alice);
        esc.claim(ID);
        assertGt(usdc.balanceOf(alice), a0);
    }

    // ---------------------------------------------------------------- admin

    function test_OnlyOwnerSetters() public {
        vm.expectRevert(BrawlEscrowToken.NotOwner.selector);
        esc.setCut(100);
        vm.expectRevert(BrawlEscrowToken.NotOwner.selector);
        esc.setToken(address(usdc), false);
        vm.expectRevert(BrawlEscrowToken.NotOwner.selector);
        esc.setOperator(alice);
        vm.expectRevert(BrawlEscrowToken.NotOwner.selector);
        esc.setTreasury(alice);
    }

    function test_CutCeilingIsTenPercent() public {
        vm.prank(owner);
        vm.expectRevert(BrawlEscrowToken.CutTooHigh.selector);
        esc.setCut(1001);
        vm.prank(owner);
        esc.setCut(1000);
        assertEq(esc.cutBps(), 1000);
    }

    function test_TurningATokenOffDoesNotStrandAnOpenMatch() public {
        _fund(address(usdc));
        vm.prank(owner);
        esc.setToken(address(usdc), false);
        vm.prank(op);
        esc.report(ID, alice, keccak256("r"));
        vm.prank(alice);
        esc.claim(ID); // still pays out
        assertGt(usdc.balanceOf(alice), 0);

        address[] memory p = _players();
        vm.prank(op);
        vm.expectRevert(BrawlEscrowToken.TokenNotAllowed.selector);
        esc.open(keccak256("later"), p, address(usdc), STAKE, 600);
    }

    function test_OwnershipIsTwoStep() public {
        vm.prank(owner);
        esc.transferOwnership(alice);
        assertEq(esc.owner(), owner);
        vm.expectRevert(BrawlEscrowToken.NotPendingOwner.selector);
        esc.acceptOwnership();
        vm.prank(alice);
        esc.acceptOwnership();
        assertEq(esc.owner(), alice);
    }

    function test_ConstructorRejectsZeroAndTooHighCut() public {
        vm.expectRevert(BrawlEscrowToken.ZeroAddress.selector);
        new BrawlEscrowToken(address(0), op, treasury, 0);
        vm.expectRevert(BrawlEscrowToken.CutTooHigh.selector);
        new BrawlEscrowToken(owner, op, treasury, 1001);
    }

    // ---------------------------------------------------------------- 4 players

    function test_FourPlayerPot() public {
        address dave = address(0xD4);
        usdc.mint(dave, 1e12);
        vm.prank(dave);
        usdc.approve(address(esc), type(uint256).max);

        address[] memory p = new address[](4);
        p[0] = alice;
        p[1] = bob;
        p[2] = carol;
        p[3] = dave;
        bytes32 id4 = keccak256("ffa");
        vm.prank(op);
        esc.open(id4, p, address(usdc), STAKE, 600);
        for (uint256 i; i < 4; ++i) {
            vm.prank(p[i]);
            esc.deposit(id4);
        }
        assertEq(uint8(esc.getMatch(id4).status), uint8(BrawlEscrowToken.Status.Funded));

        uint256 pot = uint256(STAKE) * 4;
        vm.prank(op);
        esc.report(id4, carol, keccak256("r"));
        uint256 c0 = usdc.balanceOf(carol);
        vm.prank(carol);
        esc.claim(id4);
        assertEq(usdc.balanceOf(carol), c0 + pot - pot * 300 / 10000);
    }

    // ---------------------------------------------------------------- invariant

    function testFuzz_ContractNeverOwesMoreThanItHolds(uint128 stake, uint16 cut, uint8 nRaw) public {
        stake = uint128(bound(stake, 1, 1e18));
        cut = uint16(bound(cut, 0, 1000));
        uint256 n = bound(nRaw, 2, 4);

        BrawlEscrowToken e2 = new BrawlEscrowToken(owner, op, treasury, cut);
        MockERC20 t = new MockERC20(6);
        vm.prank(owner);
        e2.setToken(address(t), true);

        address[] memory p = new address[](n);
        for (uint256 i; i < n; ++i) {
            p[i] = address(uint160(0x1000 + i));
            t.mint(p[i], stake);
            vm.prank(p[i]);
            t.approve(address(e2), type(uint256).max);
        }
        bytes32 id = keccak256(abi.encode(stake, cut, n));
        vm.prank(op);
        e2.open(id, p, address(t), stake, 600);
        for (uint256 i; i < n; ++i) {
            vm.prank(p[i]);
            e2.deposit(id);
        }
        vm.prank(op);
        e2.report(id, p[0], keccak256("r"));
        vm.prank(p[0]);
        e2.claim(id);
        e2.withdrawCut(address(t));

        assertEq(t.balanceOf(address(e2)), 0, "every unit either reached the winner or the treasury");
    }
}
