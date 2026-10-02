// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {RakeSplitter} from "../src/RakeSplitter.sol";
import {BrawlStaking} from "../src/BrawlStaking.sol";
import {BrawlReferrals} from "../src/BrawlReferrals.sol";
import {BrawlEscrow} from "../src/BrawlEscrow.sol";

// ---------------------------------------------------------------------- mocks

contract MockERC20 {
    string public name = "Brawl Street";
    string public symbol = "REKT";
    uint8 public decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 a) external {
        balanceOf[to] += a;
        totalSupply += a;
    }

    function approve(address s, uint256 a) external returns (bool) {
        allowance[msg.sender][s] = a;
        return true;
    }

    function transfer(address to, uint256 a) external returns (bool) {
        balanceOf[msg.sender] -= a;
        balanceOf[to] += a;
        return true;
    }

    function transferFrom(address f, address to, uint256 a) external returns (bool) {
        uint256 al = allowance[f][msg.sender];
        if (al != type(uint256).max) allowance[f][msg.sender] = al - a;
        balanceOf[f] -= a;
        balanceOf[to] += a;
        return true;
    }
}

/// @dev Refuses every incoming transfer, to prove one bad destination cannot block a release.
contract Rejector {
    receive() external payable {
        revert("no");
    }
}

/// @dev Burns all the gas it is given, to prove a grieving destination cannot eat the release.
contract GasBurner {
    uint256 public x;

    receive() external payable {
        while (true) x += 1;
    }
}

/// @dev The weapon in finding C4: a token whose `transfer` returns false instead of reverting.
///      `transferFrom` still works, so it can be funded into a pool and then refuse to come out.
///      `hostile` starts off so it can be registered and funded like anything else, then flipped.
contract FalseToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    bool public hostile;

    function setHostile(bool v) external {
        hostile = v;
    }

    function mint(address to, uint256 a) external {
        balanceOf[to] += a;
    }

    function approve(address s, uint256 a) external returns (bool) {
        allowance[msg.sender][s] = a;
        return true;
    }

    function transfer(address to, uint256 a) external returns (bool) {
        if (hostile) return false; // no revert: the caller has to notice the return value
        balanceOf[msg.sender] -= a;
        balanceOf[to] += a;
        return true;
    }

    function transferFrom(address f, address to, uint256 a) external returns (bool) {
        uint256 al = allowance[f][msg.sender];
        if (al != type(uint256).max) allowance[f][msg.sender] = al - a;
        balanceOf[f] -= a;
        balanceOf[to] += a;
        return true;
    }
}

/// @dev Returns NOTHING from transfer/transferFrom, the way USDT does. A typed `.transfer()` call
///      reverts in ABI decoding on these even when the transfer succeeded, which would strand a
///      staker's principal and rewards; empty return data must be read as success.
contract NoBoolToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 a) external {
        balanceOf[to] += a;
    }

    function approve(address s, uint256 a) external {
        allowance[msg.sender][s] = a;
    }

    function transfer(address to, uint256 a) external {
        balanceOf[msg.sender] -= a;
        balanceOf[to] += a;
    }

    function transferFrom(address f, address to, uint256 a) external {
        uint256 al = allowance[f][msg.sender];
        if (al != type(uint256).max) allowance[f][msg.sender] = al - a;
        balanceOf[f] -= a;
        balanceOf[to] += a;
    }
}

/// @dev Calls back into the pool from inside `transfer`, which is where a reward token gets
///      control. If the accounting were done after the send, or the guard were missing, this
///      would harvest the same balance twice.
contract ReentrantToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    address public pool;
    bool public armed;
    bool public reentered;
    bool public reentryReverted;

    function setPool(address p) external {
        pool = p;
    }

    function arm(bool v) external {
        armed = v;
    }

    function mint(address to, uint256 a) external {
        balanceOf[to] += a;
    }

    function approve(address s, uint256 a) external returns (bool) {
        allowance[msg.sender][s] = a;
        return true;
    }

    function transfer(address to, uint256 a) external returns (bool) {
        if (armed) {
            armed = false;
            reentered = true;
            (bool ok,) = pool.call(abi.encodeWithSignature("harvest()"));
            reentryReverted = !ok;
        }
        balanceOf[msg.sender] -= a;
        balanceOf[to] += a;
        return true;
    }

    function transferFrom(address f, address to, uint256 a) external returns (bool) {
        uint256 al = allowance[f][msg.sender];
        if (al != type(uint256).max) allowance[f][msg.sender] = al - a;
        balanceOf[f] -= a;
        balanceOf[to] += a;
        return true;
    }
}

// ---------------------------------------------------------------------- tests

contract RakeTest is Test {
    address constant OWNER = address(0xA11CE);
    address constant OPERATOR = address(0x09E);
    address constant MARKETING = address(0x4A2E);
    address constant BUYBACK = address(0xB0B);
    address constant ALICE = address(0x1111);
    address constant BOB = address(0x2222);
    address constant CAROL = address(0x3333);
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;

    MockERC20 rekt;
    MockERC20 usdc;
    BrawlStaking staking;
    BrawlReferrals refs;
    RakeSplitter splitter;

    function setUp() public {
        rekt = new MockERC20();
        usdc = new MockERC20();
        staking = new BrawlStaking(OWNER, address(rekt));
        refs = new BrawlReferrals(OWNER, OPERATOR);
        splitter = new RakeSplitter(OWNER, _shares());

        // USDC is a reward currency only because the OWNER says so. Registration used to happen
        // implicitly on the first funding call, by anyone, which was finding C4.
        vm.prank(OWNER);
        staking.addRewardToken(address(usdc));

        rekt.mint(ALICE, 1_000_000e18);
        rekt.mint(BOB, 1_000_000e18);
        rekt.mint(CAROL, 1_000_000e18);
        vm.prank(ALICE);
        rekt.approve(address(staking), type(uint256).max);
        vm.prank(BOB);
        rekt.approve(address(staking), type(uint256).max);
        vm.prank(CAROL);
        rekt.approve(address(staking), type(uint256).max);
    }

    /// Shares are timelocked now (finding M9), so a test that just wants a different split has to
    /// walk the propose -> wait -> apply path like production would.
    function _applyShares(RakeSplitter.Share[] memory s) internal {
        vm.prank(OWNER);
        splitter.proposeShares(s);
        vm.warp(block.timestamp + splitter.SHARES_DELAY());
        splitter.applyShares();
    }

    function _shares() internal view returns (RakeSplitter.Share[] memory s) {
        s = new RakeSplitter.Share[](4);
        s[0] = RakeSplitter.Share(MARKETING, 4000, RakeSplitter.Kind.Wallet, "marketing");
        s[1] = RakeSplitter.Share(address(staking), 3000, RakeSplitter.Kind.Staking, "staking");
        s[2] = RakeSplitter.Share(address(refs), 2000, RakeSplitter.Kind.Wallet, "referrals");
        s[3] = RakeSplitter.Share(BUYBACK, 1000, RakeSplitter.Kind.Burn, "buyback");
    }

    // ------------------------------------------------------------- splitter

    function test_splitter_splitsEthByBps() public {
        vm.deal(address(splitter), 10 ether);
        splitter.release(address(0));

        assertEq(MARKETING.balance, 4 ether, "marketing 40%");
        assertEq(address(refs).balance, 2 ether, "referrals 20%");
        assertEq(BUYBACK.balance, 1 ether, "buyback 10% (ETH cannot be burned)");
        assertEq(address(staking).balance, 3 ether, "staking 30%");
        assertEq(address(splitter).balance, 0, "nothing left behind");
    }

    function test_splitter_stakingShareMovesTheIndex() public {
        vm.prank(ALICE);
        staking.stake(100e18, 0);

        vm.deal(address(splitter), 10 ether);
        splitter.release(address(0));

        // 3 ETH landed as a *reward*, not a silent donation: it is claimable
        (, uint256[] memory amounts) = staking.pending(ALICE);
        assertApproxEqAbs(amounts[0], 3 ether, 1, "the whole staking share is owed to the lone staker");
    }

    function test_splitter_erc20Burns() public {
        usdc.mint(address(splitter), 1000e18);
        splitter.release(address(usdc));

        assertEq(usdc.balanceOf(MARKETING), 400e18);
        assertEq(usdc.balanceOf(DEAD), 100e18, "the burn share of a token really goes to dead");
        assertEq(usdc.balanceOf(address(staking)), 300e18);
    }

    function test_splitter_oneBadDestinationCannotBlockTheRest() public {
        Rejector bad = new Rejector();
        RakeSplitter.Share[] memory s = new RakeSplitter.Share[](2);
        s[0] = RakeSplitter.Share(address(bad), 5000, RakeSplitter.Kind.Wallet, "bad");
        s[1] = RakeSplitter.Share(MARKETING, 5000, RakeSplitter.Kind.Wallet, "marketing");
        _applyShares(s);

        vm.deal(address(splitter), 10 ether);
        splitter.release(address(0));

        assertEq(MARKETING.balance, 5 ether, "the good destination is paid");
        assertEq(splitter.owed(address(bad), address(0)), 5 ether, "the bad one is booked, not lost");
        assertEq(splitter.distributable(address(0)), 0, "booked money is not re-split");
    }

    function test_splitter_gasGrieferCannotEatTheRelease() public {
        GasBurner hog = new GasBurner();
        RakeSplitter.Share[] memory s = new RakeSplitter.Share[](2);
        s[0] = RakeSplitter.Share(address(hog), 5000, RakeSplitter.Kind.Wallet, "hog");
        s[1] = RakeSplitter.Share(MARKETING, 5000, RakeSplitter.Kind.Wallet, "marketing");
        _applyShares(s);

        vm.deal(address(splitter), 10 ether);
        splitter.release{gas: 2_000_000}(address(0));
        assertEq(MARKETING.balance, 5 ether, "paid despite the hog");
    }

    function test_splitter_bookedMoneySurvivesAShareChange() public {
        Rejector bad = new Rejector();
        RakeSplitter.Share[] memory s = new RakeSplitter.Share[](2);
        s[0] = RakeSplitter.Share(address(bad), 5000, RakeSplitter.Kind.Wallet, "bad");
        s[1] = RakeSplitter.Share(MARKETING, 5000, RakeSplitter.Kind.Wallet, "marketing");
        _applyShares(s);
        vm.deal(address(splitter), 10 ether);
        splitter.release(address(0));

        // owner rewrites the split entirely; the 5 ETH already owed is untouched
        RakeSplitter.Share[] memory s2 = new RakeSplitter.Share[](1);
        s2[0] = RakeSplitter.Share(MARKETING, 10000, RakeSplitter.Kind.Wallet, "marketing");
        _applyShares(s2);
        assertEq(splitter.owed(address(bad), address(0)), 5 ether, "still owed after a rewrite");
    }

    function test_splitter_sharesMustTotal10000() public {
        RakeSplitter.Share[] memory s = new RakeSplitter.Share[](1);
        s[0] = RakeSplitter.Share(MARKETING, 9999, RakeSplitter.Kind.Wallet, "marketing");
        vm.prank(OWNER);
        vm.expectRevert(RakeSplitter.BadTotal.selector);
        splitter.proposeShares(s);
    }

    function test_splitter_onlyOwnerSetsShares() public {
        vm.prank(ALICE);
        vm.expectRevert(RakeSplitter.NotOwner.selector);
        splitter.proposeShares(_shares());
    }

    function testFuzz_splitter_neverLosesAWei(uint96 amount) public {
        vm.assume(amount > 0);
        vm.deal(address(splitter), amount);
        splitter.release(address(0));
        uint256 out = MARKETING.balance + address(staking).balance + address(refs).balance + BUYBACK.balance;
        assertEq(out + address(splitter).balance, amount, "every wei lands somewhere");
        assertEq(address(splitter).balance, 0, "dust sweeps to the last share");
    }

    // -------------------------------------------------------------- staking

    function test_staking_splitsProRataByWeight() public {
        vm.prank(ALICE);
        staking.stake(100e18, 0); // flexible, 1.00x -> weight 100
        vm.prank(BOB);
        staking.stake(100e18, 3); // 180 days, 2.20x -> weight 220

        vm.deal(address(this), 32 ether);
        staking.notifyReward{value: 32 ether}();

        (, uint256[] memory a) = staking.pending(ALICE);
        (, uint256[] memory b) = staking.pending(BOB);
        assertApproxEqAbs(a[0], 10 ether, 1e6, "100/320 of the pot");
        assertApproxEqAbs(b[0], 22 ether, 1e6, "220/320 of the pot: the lock is the whole edge");
    }

    function test_staking_lockHoldsPrincipalUntilItsTerm() public {
        vm.startPrank(ALICE);
        staking.stake(100e18, 1); // 30 days
        vm.expectRevert(BrawlStaking.StillLocked.selector);
        staking.unstake();
        vm.warp(block.timestamp + 30 days);
        staking.unstake();
        vm.stopPrank();
        assertEq(rekt.balanceOf(ALICE), 1_000_000e18, "principal back in full");
    }

    function test_staking_exitEarlyReturnsAllPrincipalAndForfeitsRewards() public {
        vm.prank(ALICE);
        staking.stake(100e18, 1);
        vm.prank(BOB);
        staking.stake(100e18, 1);

        vm.deal(address(this), 10 ether);
        staking.notifyReward{value: 10 ether}();

        uint256 before = rekt.balanceOf(ALICE);
        vm.prank(ALICE);
        staking.exitEarly();

        assertEq(rekt.balanceOf(ALICE), before + 100e18, "100% of principal, always");
        (, uint256[] memory a) = staking.pending(ALICE);
        assertEq(a[0], 0, "gave up the rewards");

        (, uint256[] memory b) = staking.pending(BOB);
        assertApproxEqAbs(b[0], 10 ether, 1e6, "the forfeited half went to whoever stayed");
    }

    function test_staking_harvestWorksWhileLocked() public {
        vm.prank(ALICE);
        staking.stake(100e18, 3);
        vm.deal(address(this), 5 ether);
        staking.notifyReward{value: 5 ether}();

        vm.prank(ALICE);
        staking.harvest();
        assertApproxEqAbs(ALICE.balance, 5 ether, 1e6, "paid without breaking the lock");
    }

    function test_staking_rewardsBeforeAnyoneStakesAreNotStranded() public {
        vm.deal(address(this), 4 ether);
        staking.notifyReward{value: 4 ether}();
        assertEq(staking.orphan(address(0)), 4 ether, "held, not lost");

        vm.prank(ALICE);
        staking.stake(100e18, 0);
        vm.deal(address(this), 1 ether);
        staking.notifyReward{value: 1 ether}();

        (, uint256[] memory a) = staking.pending(ALICE);
        assertApproxEqAbs(a[0], 5 ether, 1e6, "the held 4 folded into the next notify");
    }

    function test_staking_lateStakerCannotClaimEarlierRewards() public {
        vm.prank(ALICE);
        staking.stake(100e18, 0);
        vm.deal(address(this), 10 ether);
        staking.notifyReward{value: 10 ether}();

        vm.prank(BOB);
        staking.stake(100e18, 0);

        (, uint256[] memory b) = staking.pending(BOB);
        assertEq(b[0], 0, "no retroactive share of a reward paid before he staked");
        (, uint256[] memory a) = staking.pending(ALICE);
        assertApproxEqAbs(a[0], 10 ether, 1e6);
    }

    function test_staking_toppingUpCannotShortenALock() public {
        vm.startPrank(ALICE);
        staking.stake(100e18, 3); // 180 days
        vm.expectRevert(BrawlStaking.ShorterLock.selector);
        staking.stake(100e18, 0); // try to slip out to flexible
        vm.stopPrank();
    }

    function test_staking_multiCurrencyRewards() public {
        vm.prank(ALICE);
        staking.stake(100e18, 0);

        vm.deal(address(this), 2 ether);
        staking.notifyReward{value: 2 ether}();
        usdc.mint(address(this), 500e18);
        usdc.approve(address(staking), type(uint256).max);
        staking.notifyRewardToken(address(usdc), 500e18);

        vm.prank(ALICE);
        staking.harvest();
        assertApproxEqAbs(ALICE.balance, 2 ether, 1e6, "ETH from the 1v1 escrow");
        assertEq(usdc.balanceOf(ALICE), 500e18, "USDC from the arena");
    }

    function test_staking_ownerCannotTouchPrincipal() public {
        vm.prank(ALICE);
        staking.stake(100e18, 3);
        // there is no function on the contract that moves stakeToken to the owner
        assertEq(rekt.balanceOf(address(staking)), 100e18);
        vm.prank(OWNER);
        staking.setTier(3, 180, 22_000, false); // the most the owner can do is close the tier
        assertEq(rekt.balanceOf(address(staking)), 100e18, "still exactly the stakers' money");
    }

    function testFuzz_staking_payoutNeverExceedsFunded(uint96 r1, uint96 r2, uint96 a, uint96 b) public {
        a = uint96(bound(a, 1e18, 100_000e18));
        b = uint96(bound(b, 1e18, 100_000e18));
        r1 = uint96(bound(r1, 1, 1000 ether));
        r2 = uint96(bound(r2, 1, 1000 ether));

        vm.prank(ALICE);
        staking.stake(a, 0);
        vm.deal(address(this), uint256(r1) + r2);
        staking.notifyReward{value: r1}();
        vm.prank(BOB);
        staking.stake(b, 0);
        staking.notifyReward{value: r2}();

        (, uint256[] memory pa) = staking.pending(ALICE);
        (, uint256[] memory pb) = staking.pending(BOB);
        assertLe(pa[0] + pb[0], uint256(r1) + r2, "the pool can never owe more than it was given");
    }

    // ------------------------------------------------------------ referrals

    function test_referrals_codeIsCaseInsensitiveAndUnique() public {
        vm.prank(ALICE);
        refs.claimCode("duane");
        assertEq(refs.codeOwner("DUANE"), ALICE, "folded to upper");
        vm.prank(BOB);
        vm.expectRevert(BrawlReferrals.CodeTaken.selector);
        refs.claimCode("DuAnE");
    }

    function test_referrals_rejectsJunkCodes() public {
        vm.startPrank(ALICE);
        vm.expectRevert(BrawlReferrals.BadCode.selector);
        refs.claimCode("ab"); // too short
        vm.expectRevert(BrawlReferrals.BadCode.selector);
        refs.claimCode("a b"); // space
        vm.expectRevert(BrawlReferrals.BadCode.selector);
        refs.claimCode(bytes8(abi.encodePacked(bytes3("AB"), bytes1("C")))); // a gap inside
        vm.stopPrank();
    }

    function test_referrals_bindIsOnceAndNeverYourself() public {
        vm.prank(ALICE);
        refs.claimCode("ALICE");
        vm.prank(BOB);
        refs.claimCode("BOBBY");

        vm.prank(BOB);
        vm.expectRevert(BrawlReferrals.SelfReferral.selector);
        refs.bind("BOBBY");

        vm.prank(BOB);
        refs.bind("ALICE");
        assertEq(refs.accountOf(BOB).referrer, ALICE);

        // a second bind, to anyone at all, is refused: first touch is permanent
        vm.prank(CAROL);
        refs.claimCode("CAROL");
        vm.prank(BOB);
        vm.expectRevert(BrawlReferrals.AlreadyBound.selector);
        refs.bind("CAROL");
    }

    function test_referrals_serverCanBindSoThePlayerPaysNoGas() public {
        vm.prank(ALICE);
        refs.claimCode("ALICE");
        vm.prank(OPERATOR);
        refs.bindFor(CAROL, "alice");
        assertEq(refs.accountOf(CAROL).referrer, ALICE);
        assertEq(refs.accountOf(ALICE).referred, 1);
    }

    function test_referrals_tiersClimbWithReferrals() public {
        vm.prank(ALICE);
        refs.claimCode("ALICE");
        (, BrawlReferrals.Tier memory t) = refs.tierOf(ALICE);
        assertEq(t.shareBps, 1000, "bronze");

        for (uint160 i = 1; i <= 10; ++i) {
            vm.prank(OPERATOR);
            refs.bindFor(address(0x50000 + i), "ALICE");
        }
        (, t) = refs.tierOf(ALICE);
        assertEq(t.shareBps, 1500, "silver at 10");
    }

    /// A referrer with a code and a referee bound to it: the only two shapes that can legitimately
    /// be credited (finding H4).
    function _graph() internal {
        vm.prank(ALICE);
        refs.claimCode("ALICE");
        vm.prank(BOB);
        refs.bind("ALICE");
    }

    function test_referrals_cannotCreditMoreThanWasFunded() public {
        _graph();
        vm.prank(OWNER);
        refs.setEpochCapBps(10_000); // isolate the budget check from the per-epoch ceiling
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(refs).call{value: 1 ether}("");
        assertTrue(ok);

        address[] memory u = new address[](1);
        uint256[] memory a = new uint256[](1);
        u[0] = ALICE;
        a[0] = 1 ether + 1;
        vm.prank(OPERATOR);
        vm.expectRevert(BrawlReferrals.OverBudget.selector);
        refs.credit(address(0), bytes32("b1"), u, a);

        a[0] = 1 ether;
        vm.prank(OPERATOR);
        refs.credit(address(0), bytes32("b2"), u, a);
        assertEq(refs.budgetLeft(address(0)), 0);
    }

    function test_referrals_claimPaysOut() public {
        _graph();
        vm.prank(OWNER);
        refs.setEpochCapBps(10_000);
        vm.deal(address(this), 3 ether);
        (bool ok,) = address(refs).call{value: 3 ether}("");
        assertTrue(ok);

        address[] memory u = new address[](2);
        uint256[] memory a = new uint256[](2);
        (u[0], a[0]) = (ALICE, 2 ether); // referrer's share of the cut
        (u[1], a[1]) = (BOB, 1 ether); // the referee's rakeback
        vm.prank(OPERATOR);
        refs.credit(address(0), bytes32("pay1"), u, a);

        vm.prank(ALICE);
        refs.claim(address(0));
        assertEq(ALICE.balance, 2 ether);
        vm.prank(BOB);
        refs.claim(address(0));
        assertEq(BOB.balance, 1 ether);
        assertEq(address(refs).balance, 0);
    }

    function test_referrals_onlyOperatorCredits() public {
        address[] memory u = new address[](1);
        uint256[] memory a = new uint256[](1);
        (u[0], a[0]) = (ALICE, 1);
        vm.prank(ALICE);
        vm.expectRevert(BrawlReferrals.NotOperator.selector);
        refs.credit(address(0), bytes32("x"), u, a);
    }

    function test_referrals_pointsPhaseMovesNoMoney() public {
        address[] memory u = new address[](1);
        uint256[] memory a = new uint256[](1);
        (u[0], a[0]) = (ALICE, 2500);
        vm.prank(OPERATOR);
        refs.creditPoints(u, a);
        assertEq(refs.accountOf(ALICE).points, 2500);
        assertEq(refs.earned(ALICE, address(0)), 0, "points are a scoreboard, not a balance");
    }

    // -------------------------------------------------- end to end, 3% rake

    /// The whole loop: two players wager, the escrow keeps 3% of the pot, the splitter routes it,
    /// and a staker is paid out of it.
    function test_endToEnd_threePercentOfThePot() public {
        BrawlEscrow escrow = new BrawlEscrow(OWNER, OPERATOR, address(splitter), 300);

        vm.prank(ALICE);
        staking.stake(1000e18, 0);

        address[] memory players = new address[](2);
        (players[0], players[1]) = (BOB, CAROL);
        vm.prank(OPERATOR);
        escrow.open(bytes32("m1"), players, 1 ether, 300);

        vm.deal(BOB, 1 ether);
        vm.deal(CAROL, 1 ether);
        vm.prank(BOB);
        escrow.deposit{value: 1 ether}(bytes32("m1"));
        vm.prank(CAROL);
        escrow.deposit{value: 1 ether}(bytes32("m1"));

        vm.prank(OPERATOR);
        escrow.report(bytes32("m1"), BOB, bytes32("replay"));
        vm.prank(BOB);
        escrow.claim(bytes32("m1"));

        // 2 ETH wagered, 3% of it is the house's
        assertEq(BOB.balance, 1.94 ether, "winner takes the pot less 3%");
        assertEq(escrow.cutBalance(), 0.06 ether, "3% of everything wagered");

        escrow.withdrawCut();
        splitter.release(address(0));

        assertEq(MARKETING.balance, 0.024 ether, "40% of the cut");
        assertEq(address(refs).balance, 0.012 ether, "20% of the cut is the referral budget");
        (, uint256[] memory a) = staking.pending(ALICE);
        assertApproxEqAbs(a[0], 0.018 ether, 1e6, "30% of the cut reached the staker");
    }

    /// The same match with the cut off: the wager is not taxed at deposit or at withdrawal, so a
    /// player who deposits and never plays gets everything back.
    function test_endToEnd_nothingIsTakenOnDepositOrRefund() public {
        BrawlEscrow escrow = new BrawlEscrow(OWNER, OPERATOR, address(splitter), 300);

        address[] memory players = new address[](2);
        (players[0], players[1]) = (BOB, CAROL);
        vm.prank(OPERATOR);
        escrow.open(bytes32("m2"), players, 1 ether, 300);

        vm.deal(BOB, 1 ether);
        vm.prank(BOB);
        escrow.deposit{value: 1 ether}(bytes32("m2"));

        vm.warp(block.timestamp + 301);
        escrow.cancel(bytes32("m2"));
        vm.prank(BOB);
        escrow.refund(bytes32("m2"));

        assertEq(BOB.balance, 1 ether, "money that never got wagered is never touched");
        assertEq(escrow.cutBalance(), 0);
    }

    // ------------------------------------------- H4: the operator paying itself the budget

    /// The review's attack, verbatim: "the operator credits its own address the whole un-credited
    /// budget and claims it". The budget ceiling never stopped this — it bounds the size of what
    /// can be handed out, not who gets it.
    function test_referrals_operatorCannotPayItselfTheBudget() public {
        vm.deal(address(this), 10 ether);
        (bool ok,) = address(refs).call{value: 10 ether}("");
        assertTrue(ok);

        address thief = address(0xDEADBEEF);
        address[] memory u = new address[](1);
        uint256[] memory a = new uint256[](1);
        (u[0], a[0]) = (thief, 10 ether);

        vm.prank(OPERATOR);
        vm.expectRevert(BrawlReferrals.NotInGraph.selector);
        refs.credit(address(0), bytes32("steal"), u, a);

        // The operator's own address is no different.
        u[0] = OPERATOR;
        vm.prank(OPERATOR);
        vm.expectRevert(BrawlReferrals.NotInGraph.selector);
        refs.credit(address(0), bytes32("steal2"), u, a);

        assertEq(refs.budgetLeft(address(0)), 10 ether, "not a wei moved");
        assertEq(address(refs).balance, 10 ether);
    }

    /// One bad address anywhere in a batch fails the whole batch, rather than being skipped and
    /// letting the rest through — so a thief cannot hide a payment to itself among real ones.
    function test_referrals_oneUngraphedAddressFailsTheWholeBatch() public {
        _graph();
        vm.deal(address(this), 10 ether);
        (bool ok,) = address(refs).call{value: 10 ether}("");
        assertTrue(ok);

        address[] memory u = new address[](3);
        uint256[] memory a = new uint256[](3);
        (u[0], a[0]) = (ALICE, 1 ether);
        (u[1], a[1]) = (address(0xBADBAD), 3 ether); // the one being smuggled in
        (u[2], a[2]) = (BOB, 1 ether);

        vm.prank(OPERATOR);
        vm.expectRevert(BrawlReferrals.NotInGraph.selector);
        refs.credit(address(0), bytes32("mixed"), u, a);
        assertEq(refs.earned(ALICE, address(0)), 0, "nothing in the batch was applied");
    }

    /// Being in the graph is enough, and both shapes of membership count.
    function test_referrals_graphMembersCanBeCredited() public {
        _graph();
        vm.deal(address(this), 4 ether);
        (bool ok,) = address(refs).call{value: 4 ether}("");
        assertTrue(ok);

        address[] memory u = new address[](2);
        uint256[] memory a = new uint256[](2);
        (u[0], a[0]) = (ALICE, 1 ether); // owns a code
        (u[1], a[1]) = (BOB, 1 ether); // bound to one
        vm.prank(OPERATOR);
        refs.credit(address(0), bytes32("ok1"), u, a);
        assertEq(refs.earned(ALICE, address(0)), 1 ether);
        assertEq(refs.earned(BOB, address(0)), 1 ether);
    }

    // --------------------------------------------------------- M12: double payment

    function test_referrals_replayedBatchIdCannotPayTwice() public {
        _graph();
        vm.deal(address(this), 10 ether);
        (bool ok,) = address(refs).call{value: 10 ether}("");
        assertTrue(ok);

        address[] memory u = new address[](1);
        uint256[] memory a = new uint256[](1);
        (u[0], a[0]) = (ALICE, 2 ether);

        vm.prank(OPERATOR);
        refs.credit(address(0), bytes32("day-1"), u, a);
        // Exactly what a retried RPC call looks like.
        vm.prank(OPERATOR);
        vm.expectRevert(BrawlReferrals.BatchReplayed.selector);
        refs.credit(address(0), bytes32("day-1"), u, a);
        assertEq(refs.earned(ALICE, address(0)), 2 ether, "paid once");

        // A genuinely new batch still works.
        vm.prank(OPERATOR);
        refs.credit(address(0), bytes32("day-2"), u, a);
        assertEq(refs.earned(ALICE, address(0)), 4 ether);
    }

    function test_referrals_batchIdZeroRejected() public {
        _graph();
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(refs).call{value: 1 ether}("");
        assertTrue(ok);
        address[] memory u = new address[](1);
        uint256[] memory a = new uint256[](1);
        (u[0], a[0]) = (ALICE, 1);
        vm.prank(OPERATOR);
        vm.expectRevert(BrawlReferrals.BadBatch.selector);
        refs.credit(address(0), bytes32(0), u, a);
    }

    // ---------------------------------------------------------- H4: the epoch ceiling

    function test_referrals_epochCapLimitsADrainAndReleasesNextDay() public {
        _graph();
        vm.deal(address(this), 10 ether);
        (bool ok,) = address(refs).call{value: 10 ether}("");
        assertTrue(ok);

        address[] memory u = new address[](1);
        uint256[] memory a = new uint256[](1);
        u[0] = ALICE;

        // 50% of the 10 ETH budget is the day's allowance.
        a[0] = 5 ether;
        vm.prank(OPERATOR);
        refs.credit(address(0), bytes32("d1"), u, a);

        a[0] = 1;
        vm.prank(OPERATOR);
        vm.expectRevert(BrawlReferrals.EpochCapped.selector);
        refs.credit(address(0), bytes32("d1b"), u, a);

        // Tomorrow the allowance resets — the cap slows a thief down, it does not lock the budget.
        vm.warp(block.timestamp + 1 days);
        a[0] = 5 ether;
        vm.prank(OPERATOR);
        refs.credit(address(0), bytes32("d2"), u, a);
        assertEq(refs.budgetLeft(address(0)), 0);
    }

    function test_referrals_epochCapIsOwnerOnlyAndFloored() public {
        vm.prank(OPERATOR);
        vm.expectRevert(BrawlReferrals.NotOwner.selector);
        refs.setEpochCapBps(10_000);

        vm.prank(OWNER);
        vm.expectRevert(BrawlReferrals.CapTooLow.selector);
        refs.setEpochCapBps(1);

        vm.prank(OWNER);
        refs.setEpochCapBps(10_000);
        assertEq(refs.epochCapBps(), 10_000, "the owner can switch the ceiling off");
    }

    // ---------------------------------------------------- C4: hostile reward tokens
    // The 9/20 review said the only ERC20 in this suite was well-behaved, "which is exactly why C4
    // was invisible". These are the tests that would have caught it.

    /// The original attack, end to end, proving it is now stopped at the door.
    function test_staking_hostileRewardTokenCannotBeRegistered() public {
        vm.prank(ALICE);
        staking.stake(100e18, 0);
        vm.deal(address(this), 5 ether);
        staking.notifyReward{value: 5 ether}();

        FalseToken evil = new FalseToken();
        evil.mint(address(this), 1000e18);
        evil.approve(address(staking), type(uint256).max);

        // Step 2 of the attack: register it by funding a single wei. This is what used to work.
        vm.expectRevert(BrawlStaking.NotRewardToken.selector);
        staking.notifyRewardToken(address(evil), 1);

        // ...and the stakers' real rewards are untouched.
        vm.prank(ALICE);
        staking.harvest();
        assertApproxEqAbs(ALICE.balance, 5 ether, 1e6, "ETH rewards still withdrawable");
    }

    /// The worse case: a currency the owner legitimately registered LATER turns hostile. It must
    /// not be able to take the other currencies down with it.
    function test_staking_falseReturningRewardTokenIsSkippedNotFatal() public {
        FalseToken tricky = new FalseToken();
        vm.prank(OWNER);
        staking.addRewardToken(address(tricky));

        vm.prank(ALICE);
        staking.stake(100e18, 0);

        tricky.mint(address(this), 1000e18);
        tricky.approve(address(staking), type(uint256).max);
        staking.notifyRewardToken(address(tricky), 1000e18);
        vm.deal(address(this), 5 ether);
        staking.notifyReward{value: 5 ether}();

        tricky.setHostile(true); // now it refuses to leave

        vm.prank(ALICE);
        staking.harvest();
        // The ETH got out. Under the old code this whole call reverted, forever.
        assertApproxEqAbs(ALICE.balance, 5 ether, 1e6, "one bad currency cannot block the others");
        // And the bad balance is still owed, not destroyed by the skip.
        (, uint256[] memory amounts) = staking.pending(ALICE);
        uint256 stillOwed;
        for (uint256 i; i < amounts.length; ++i) {
            stillOwed += amounts[i];
        }
        assertGt(stillOwed, 0, "the skipped balance is preserved, not burned");

        // It comes out on its own once the token behaves again.
        tricky.setHostile(false);
        vm.prank(ALICE);
        staking.harvestToken(address(tricky));
        assertEq(tricky.balanceOf(ALICE), 1000e18, "recoverable through the per-currency path");
    }

    /// The owner's last resort if something hostile is ever registered by mistake.
    function test_staking_ownerCanRemoveARewardTokenWithoutConfiscating() public {
        FalseToken tricky = new FalseToken();
        vm.prank(OWNER);
        staking.addRewardToken(address(tricky));
        vm.prank(ALICE);
        staking.stake(100e18, 0);
        tricky.mint(address(this), 500e18);
        tricky.approve(address(staking), type(uint256).max);
        staking.notifyRewardToken(address(tricky), 500e18);

        vm.prank(OWNER);
        staking.removeRewardToken(address(tricky));
        assertFalse(staking.isRewardToken(address(tricky)));

        // Removal stops it accruing; it does NOT take what was already earned. Note ALICE has
        // never checkpointed, so this is exactly the case where the naive version confiscated.
        assertEq(staking.pendingToken(ALICE, address(tricky)), 500e18, "still visible after removal");
        vm.prank(ALICE);
        staking.harvestToken(address(tricky));
        assertEq(tricky.balanceOf(ALICE), 500e18, "removal never confiscates an accrued balance");

        vm.prank(OWNER);
        vm.expectRevert(BrawlStaking.ZeroAddress.selector);
        staking.removeRewardToken(address(0)); // ETH is what the escrow cut arrives in
    }

    function test_staking_rewardTokenRegistrationIsOwnerOnly() public {
        FalseToken evil = new FalseToken();
        vm.prank(ALICE);
        vm.expectRevert(BrawlStaking.NotOwner.selector);
        staking.addRewardToken(address(evil));

        vm.prank(ALICE);
        vm.expectRevert(BrawlStaking.NotOwner.selector);
        staking.removeRewardToken(address(usdc));
    }

    /// The sibling of C4: squat the 8 slots and the ERC20 reward path dies permanently.
    function test_staking_rewardSlotsCannotBeSquatted() public {
        // ETH + usdc are registered, so 6 slots remain. An outsider cannot take any of them.
        for (uint256 i; i < 6; ++i) {
            FalseToken junk = new FalseToken();
            junk.mint(address(this), 10);
            junk.approve(address(staking), type(uint256).max);
            vm.expectRevert(BrawlStaking.NotRewardToken.selector);
            staking.notifyRewardToken(address(junk), 1);
        }
        // The owner can still register a real currency, which is what squatting would have prevented.
        MockERC20 real = new MockERC20();
        vm.prank(OWNER);
        staking.addRewardToken(address(real));
        assertTrue(staking.isRewardToken(address(real)));
    }

    /// Only the owner fills the slots, but the ceiling must still hold for the owner.
    function test_staking_rewardTokenCeilingHolds() public {
        for (uint256 i; i < 6; ++i) {
            MockERC20 t = new MockERC20();
            vm.prank(OWNER);
            staking.addRewardToken(address(t));
        }
        MockERC20 overflow = new MockERC20();
        vm.prank(OWNER);
        vm.expectRevert(BrawlStaking.TooManyRewardTokens.selector);
        staking.addRewardToken(address(overflow));
    }

    // ------------------------------------------------------------ C4: reentrancy
    // A reward token gets control inside `transfer`. That is the one place an attacker can run
    // code during a payout, so it is the one place double-spending has to be impossible.

    function test_staking_reentrantRewardTokenCannotDoubleHarvest() public {
        ReentrantToken evil = new ReentrantToken();
        evil.setPool(address(staking));
        vm.prank(OWNER);
        staking.addRewardToken(address(evil));

        vm.prank(ALICE);
        staking.stake(100e18, 0);
        evil.mint(address(this), 1000e18);
        evil.approve(address(staking), type(uint256).max);
        staking.notifyRewardToken(address(evil), 1000e18);

        evil.arm(true);
        vm.prank(ALICE);
        staking.harvest();

        assertTrue(evil.reentered(), "the token really did call back in");
        assertTrue(evil.reentryReverted(), "and the reentrancy guard stopped it");
        assertEq(evil.balanceOf(ALICE), 1000e18, "paid exactly once, not twice");
        assertEq(evil.balanceOf(address(staking)), 0);
    }

    // --------------------------------------------- tokens that return nothing (USDT-shaped)

    function test_staking_noBoolTokenCanBeRewardedAndHarvested() public {
        NoBoolToken odd = new NoBoolToken();
        vm.prank(OWNER);
        staking.addRewardToken(address(odd));

        vm.prank(ALICE);
        staking.stake(100e18, 0);
        odd.mint(address(this), 700e18);
        odd.approve(address(staking), type(uint256).max);
        staking.notifyRewardToken(address(odd), 700e18);

        vm.prank(ALICE);
        staking.harvest();
        assertEq(odd.balanceOf(ALICE), 700e18, "empty return data must read as success");
    }

    function test_staking_noBoolStakeTokenCanBeUnstaked() public {
        NoBoolToken odd = new NoBoolToken();
        BrawlStaking pool = new BrawlStaking(OWNER, address(odd));
        odd.mint(ALICE, 500e18);
        vm.prank(ALICE);
        odd.approve(address(pool), type(uint256).max);
        vm.prank(ALICE);
        pool.stake(500e18, 0);
        vm.prank(ALICE);
        pool.unstake();
        assertEq(odd.balanceOf(ALICE), 500e18, "principal must come back out of a USDT-shaped token");
    }

    // ------------------------------------------------------- M11 / stranded rewards

    function test_staking_syncRewardCreditsAStrandedTransfer() public {
        vm.prank(ALICE);
        staking.stake(100e18, 0);
        // The stranding route: RakeSplitter books a failed notify to `owed`, then withdrawOwed
        // PUSHES the tokens here with a plain transfer, which credits nobody.
        usdc.mint(address(staking), 900e18);
        (, uint256[] memory before) = staking.pending(ALICE);
        assertEq(before[1], 0, "a plain transfer credits nobody on its own");

        uint256 credited = staking.syncReward(address(usdc));
        assertEq(credited, 900e18);
        vm.prank(ALICE);
        staking.harvest();
        assertEq(usdc.balanceOf(ALICE), 900e18, "stranded rewards are recoverable by anyone, to stakers");
    }

    function test_staking_syncRewardCannotTouchPrincipal() public {
        vm.prank(ALICE);
        staking.stake(1000e18, 0);
        vm.prank(OWNER);
        staking.addRewardToken(address(rekt)); // stake token doubling as a reward currency

        // Nothing has been donated, so there is nothing above principal to credit.
        vm.expectRevert(BrawlStaking.Nothing.selector);
        staking.syncReward(address(rekt));

        // A real donation on top is credited, and only that.
        rekt.mint(address(staking), 50e18);
        assertEq(staking.syncReward(address(rekt)), 50e18, "principal is excluded to the wei");

        vm.prank(ALICE);
        staking.unstake();
        assertEq(rekt.balanceOf(ALICE), 1_000_000e18, "principal still whole after a sync");
    }

    function test_staking_sweepOrphanOnlyWithNobodyStaked() public {
        // A reward that lands while nothing is staked is held as an orphan.
        vm.deal(address(this), 3 ether);
        staking.notifyReward{value: 3 ether}();
        assertEq(staking.orphan(address(0)), 3 ether);

        // While somebody is staked the next notify distributes it, so sweeping is refused.
        vm.prank(ALICE);
        staking.stake(100e18, 0);
        vm.prank(OWNER);
        vm.expectRevert(BrawlStaking.StillStaked.selector);
        staking.sweepOrphan(address(0), OWNER);

        // Confirm the orphan really does reach the staker rather than needing a sweep at all.
        vm.deal(address(this), 1 ether);
        staking.notifyReward{value: 1 ether}();
        vm.prank(ALICE);
        staking.harvest();
        assertApproxEqAbs(ALICE.balance, 4 ether, 1e6, "the orphan folded into the next reward");
    }

    function test_staking_sweepOrphanIsOwnerOnlyAndBounded() public {
        vm.deal(address(this), 2 ether);
        staking.notifyReward{value: 2 ether}();

        vm.prank(ALICE);
        vm.expectRevert(BrawlStaking.NotOwner.selector);
        staking.sweepOrphan(address(0), ALICE);

        uint256 before = MARKETING.balance;
        vm.prank(OWNER);
        staking.sweepOrphan(address(0), MARKETING);
        assertEq(MARKETING.balance - before, 2 ether);

        vm.prank(OWNER);
        vm.expectRevert(BrawlStaking.Nothing.selector);
        staking.sweepOrphan(address(0), MARKETING);
    }

    receive() external payable {}
}
