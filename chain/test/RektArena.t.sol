// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {RektArena, FullMath} from "../src/RektArena.sol";

// =====================================================================================
//                                     MOCK TOKENS
// =====================================================================================

contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public immutable decimals;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory n, string memory s, uint8 d) {
        name = n;
        symbol = s;
        decimals = d;
    }

    function mint(address to, uint256 amt) external {
        balanceOf[to] += amt;
        totalSupply += amt;
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
        _spend(from, amt);
        _move(from, to, amt);
        return true;
    }

    function _spend(address from, uint256 amt) internal {
        uint256 a = allowance[from][msg.sender];
        if (a != type(uint256).max) {
            require(a >= amt, "allowance");
            allowance[from][msg.sender] = a - amt;
        }
    }

    function _move(address from, address to, uint256 amt) internal virtual {
        require(balanceOf[from] >= amt, "balance");
        balanceOf[from] -= amt;
        balanceOf[to] += amt;
    }
}

/// 1% of every transfer is skimmed (burned) on the way.
contract FeeOnTransferToken is MockERC20 {
    constructor() MockERC20("Fee Token", "FEE", 18) {}

    function _move(address from, address to, uint256 amt) internal override {
        require(balanceOf[from] >= amt, "balance");
        uint256 fee = amt / 100;
        balanceOf[from] -= amt;
        balanceOf[to] += amt - fee;
        totalSupply -= fee;
    }
}

/// USDT-style: transfer / transferFrom / approve return nothing.
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

/// Returns false instead of reverting and moves nothing.
contract FalseToken is MockERC20 {
    constructor() MockERC20("False", "NOPE", 18) {}

    function transfer(address, uint256) external pure override returns (bool) {
        return false;
    }

    function transferFrom(address, address, uint256) external pure override returns (bool) {
        return false;
    }
}

/// Re-enters betToken from inside transferFrom (tries to get a transfer double-counted).
contract ReentrantToken is MockERC20 {
    RektArena public arena;
    uint256 public roundId;
    bool public armed;
    bytes public reentryError;

    constructor() MockERC20("Evil", "EVIL", 18) {}

    function arm(RektArena a, uint256 id) external {
        arena = a;
        roundId = id;
        armed = true;
        balanceOf[address(this)] += 1e18;
        allowance[address(this)][address(a)] = type(uint256).max;
    }

    function transferFrom(address from, address to, uint256 amt) external override returns (bool) {
        if (armed) {
            armed = false;
            try arena.betToken(roundId, 1, address(this), 1e18) {}
            catch (bytes memory err) {
                reentryError = err;
            }
        }
        _spend(from, amt);
        _move(from, to, amt);
        return true;
    }
}

/// Bets ETH, then on payout tries to claim again from receive().
contract ReentrantClaimer {
    RektArena public immutable arena;
    uint256 public roundId;
    bool public swallow;
    uint256 public reentries;
    bytes public reentryError;

    constructor(RektArena a) {
        arena = a;
    }

    function placeBet(uint256 id, uint8 side) external payable {
        roundId = id;
        arena.bet{value: msg.value}(id, side);
    }

    function setSwallow(bool s) external {
        swallow = s;
    }

    function attack() external returns (uint256) {
        return arena.claim(roundId, address(0));
    }

    receive() external payable {
        if (reentries > 0) return;
        reentries++;
        if (swallow) {
            try arena.claim(roundId, address(0)) {}
            catch (bytes memory err) {
                reentryError = err;
            }
        } else {
            arena.claim(roundId, address(0)); // bubbles the revert
        }
    }
}

contract MulDivHarness {
    function mulDiv(uint256 x, uint256 y, uint256 d) external pure returns (uint256) {
        return FullMath.mulDiv(x, y, d);
    }
}

// =====================================================================================
//                                        TESTS
// =====================================================================================

contract RektArenaTest is Test {
    RektArena internal arena;
    MockERC20 internal stable;
    MockERC20 internal rektTok;
    FeeOnTransferToken internal feeTok;
    NoBoolToken internal noBool;

    address internal owner = makeAddr("owner");
    address internal operator = makeAddr("operator");
    address internal treasury = makeAddr("treasury");
    address internal stranger = makeAddr("stranger");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal dave = makeAddr("dave");
    address internal eve = makeAddr("eve");
    address internal frank = makeAddr("frank");
    address[6] internal users;

    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;
    address internal constant ETH = address(0);
    bytes32 internal constant SERVER_SEED = keccak256("rekt-brawl server seed #1");
    bytes32 internal SEED_HASH = keccak256(abi.encode(SERVER_SEED));
    uint64 internal constant BET_WINDOW = 300;

    function setUp() public {
        vm.warp(1_760_000_000);

        stable = new MockERC20("USD Stable", "USDS", 6);
        rektTok = new MockERC20("Rekt", "REKT", 18);
        feeTok = new FeeOnTransferToken();
        noBool = new NoBoolToken();

        arena = new RektArena(owner);
        vm.startPrank(owner);
        arena.setOperator(operator);
        arena.setTreasury(treasury);
        arena.setToken(address(stable), true);
        arena.setToken(address(feeTok), true);
        arena.setToken(address(noBool), true);
        arena.setRekt(address(rektTok));
        arena.setCutBps(500);
        vm.stopPrank();

        users = [alice, bob, carol, dave, eve, frank];
        for (uint256 i; i < users.length; i++) {
            address u = users[i];
            vm.deal(u, 1_000 ether);
            stable.mint(u, 1e18);
            rektTok.mint(u, 1e45);
            feeTok.mint(u, 1e30);
            noBool.mint(u, 1e18);
            vm.startPrank(u);
            stable.approve(address(arena), type(uint256).max);
            rektTok.approve(address(arena), type(uint256).max);
            feeTok.approve(address(arena), type(uint256).max);
            noBool.approve(address(arena), type(uint256).max);
            vm.stopPrank();
        }
    }

    // ------------------------------------------------------------------ helpers

    function _open() internal returns (uint256 id) {
        vm.prank(operator);
        id = arena.openRound(SEED_HASH, 1, 2, 3, 1, uint64(block.timestamp + BET_WINDOW));
    }

    function _bet(address u, uint256 id, uint8 side, uint256 amt) internal {
        vm.prank(u);
        arena.bet{value: amt}(id, side);
    }

    function _betT(address u, uint256 id, uint8 side, address token, uint256 amt) internal {
        vm.prank(u);
        arena.betToken(id, side, token, amt);
    }

    function _start(uint256 id) internal {
        RektArena.Round memory r = arena.getRound(id);
        if (block.timestamp < r.lockTime) vm.warp(r.lockTime);
        vm.prank(operator);
        arena.startFight(id, SERVER_SEED);
    }

    function _settle(uint256 id, uint8 side) internal {
        _start(id);
        vm.warp(block.timestamp + arena.START_DELAY() + arena.MIN_FIGHT());
        vm.prank(operator);
        arena.settle(id, side);
    }

    function _bal(address token, address who) internal view returns (uint256) {
        return token == ETH ? who.balance : MockERC20(token).balanceOf(who);
    }

    /// claims for `u` and returns what actually arrived in u's wallet
    function _claim(address u, uint256 id, address token) internal returns (uint256 received) {
        uint256 before = _bal(token, u);
        vm.prank(u);
        arena.claim(id, token);
        received = _bal(token, u) - before;
    }

    // ------------------------------------------------------------- basic state

    function test_ConstructorAndConfig() public {
        assertEq(arena.owner(), owner);
        assertEq(arena.operator(), operator);
        assertEq(arena.treasury(), treasury);
        assertEq(arena.rekt(), address(rektTok));
        assertTrue(arena.tokenAllowed(address(rektTok)));
        assertTrue(arena.tokenAllowed(address(stable)));
        assertFalse(arena.tokenAllowed(ETH));
        assertEq(arena.cutBps(), 500);
        assertEq(arena.nextRoundId(), 1);
        assertEq(arena.MAX_CUT_BPS(), 1000);
        assertEq(arena.START_DELAY(), 5);
        assertEq(arena.MIN_FIGHT(), 20);
        assertEq(arena.SETTLE_TIMEOUT(), 3600);
        assertEq(arena.DEAD(), DEAD);

        RektArena fresh = new RektArena(owner);
        assertEq(fresh.treasury(), owner, "treasury defaults to owner");
        assertEq(fresh.operator(), address(0));
        assertEq(fresh.cutBps(), 0);

        vm.expectRevert(RektArena.ZeroAddress.selector);
        new RektArena(address(0));
    }

    function test_OpenRound_StoresAndEmits() public {
        uint64 lock = uint64(block.timestamp + 90);
        vm.expectEmit(true, true, true, true, address(arena));
        emit RektArena.RoundOpened(1, SEED_HASH, 7, 4, 2, 3, lock, 500);
        vm.prank(operator);
        uint256 id = arena.openRound(SEED_HASH, 7, 4, 2, 3, lock);
        assertEq(id, 1);
        assertEq(arena.nextRoundId(), 2);

        RektArena.Round memory r = arena.getRound(id);
        assertEq(r.seedHash, SEED_HASH);
        assertEq(r.betsHash, bytes32(0));
        assertEq(r.serverSeed, bytes32(0));
        assertEq(r.fightSeed, bytes32(0));
        assertEq(r.lockTime, lock);
        assertEq(r.fightStart, 0);
        assertEq(r.betCount, 0);
        assertEq(r.cutBps, 500);
        assertEq(r.simVersion, 3);
        assertEq(r.fighterA, 7);
        assertEq(r.fighterB, 4);
        assertEq(r.stage, 2);
        assertEq(r.winnerSide, 0);
        assertEq(uint8(r.status), uint8(RektArena.Status.Open));

        assertEq(_open(), 2);
        assertEq(arena.nextRoundId(), 3);
    }

    function test_OpenRound_Reverts() public {
        vm.startPrank(operator);
        vm.expectRevert(RektArena.BadLockTime.selector);
        arena.openRound(SEED_HASH, 1, 2, 0, 1, uint64(block.timestamp));
        vm.expectRevert(RektArena.BadLockTime.selector);
        arena.openRound(SEED_HASH, 1, 2, 0, 1, uint64(block.timestamp - 1));
        vm.expectRevert(RektArena.SameFighter.selector);
        arena.openRound(SEED_HASH, 5, 5, 0, 1, uint64(block.timestamp + 60));
        vm.stopPrank();
    }

    // --------------------------------------------------------- full ETH round

    function test_EthRound_FullPayoutMath() public {
        uint256 id = _open();
        _bet(alice, id, 1, 1 ether);
        _bet(bob, id, 1, 3 ether);
        _bet(carol, id, 2, 2 ether);
        _bet(dave, id, 2, 2 ether);
        _bet(eve, id, 1, 0.5 ether); // eve hedges both sides
        _bet(eve, id, 2, 0.5 ether);

        (uint256 pa, uint256 pb) = arena.pools(id, ETH);
        assertEq(pa, 4.5 ether);
        assertEq(pb, 4.5 ether);
        (uint256 ea, uint256 eb) = arena.stakeOf(id, eve, ETH);
        assertEq(ea, 0.5 ether);
        assertEq(eb, 0.5 ether);
        assertEq(address(arena).balance, 9 ether);
        assertEq(arena.getRound(id).betCount, 6);

        _settle(id, 1);
        assertEq(uint8(arena.getRound(id).status), uint8(RektArena.Status.Settled));
        assertEq(arena.getRound(id).winnerSide, 1);

        // L = 4.5, cut 5% of L = 0.225, winners split 4.275 pro rata to stakes on A (W = 4.5)
        assertEq(arena.previewClaim(id, alice, ETH), 1.95 ether);
        assertEq(arena.previewClaim(id, bob, ETH), 5.85 ether);
        assertEq(arena.previewClaim(id, eve, ETH), 0.975 ether);
        assertEq(arena.previewClaim(id, carol, ETH), 0);
        assertEq(arena.previewCut(id, ETH), 0.225 ether);

        vm.expectEmit(true, true, true, true, address(arena));
        emit RektArena.Claimed(id, alice, ETH, 1.95 ether);
        assertEq(_claim(alice, id, ETH), 1.95 ether);
        assertEq(_claim(bob, id, ETH), 5.85 ether);
        assertEq(_claim(eve, id, ETH), 0.975 ether);
        assertEq(arena.previewClaim(id, alice, ETH), 0, "preview is 0 once claimed");

        vm.prank(carol);
        vm.expectRevert(RektArena.NothingToClaim.selector);
        arena.claim(id, ETH);

        vm.expectEmit(true, true, true, true, address(arena));
        emit RektArena.CutCollected(id, ETH, treasury, 0.225 ether);
        vm.prank(stranger);
        arena.collectCut(id, ETH);
        assertEq(treasury.balance, 0.225 ether);
        assertEq(address(arena).balance, 0, "fully distributed, no dust in this case");
    }

    function test_BetsHashChainAndFightSeed() public {
        uint256 id = _open();
        vm.expectEmit(true, true, true, true, address(arena));
        bytes32 h1 = keccak256(abi.encode(bytes32(0), alice, uint8(1), ETH, uint256(1 ether), uint32(0)));
        emit RektArena.BetPlaced(id, alice, 1, ETH, 1 ether, h1);
        _bet(alice, id, 1, 1 ether);

        bytes32 h2 = keccak256(abi.encode(h1, bob, uint8(2), address(stable), uint256(5e6), uint32(1)));
        _betT(bob, id, 2, address(stable), 5e6);
        // clients can hash with plain uint256 fields: abi.encode pads identically
        assertEq(h2, keccak256(abi.encode(h1, bob, uint256(2), address(stable), uint256(5e6), uint256(1))));

        RektArena.Round memory r = arena.getRound(id);
        assertEq(r.betsHash, h2);
        assertEq(r.betCount, 2);

        vm.warp(r.lockTime);
        // FINDING C1: the seed used to mix in `betsHash`, which absorbs every bet's AMOUNT. The
        // operator knew `serverSeed` from the moment the round opened, so it could iterate its own
        // bet by 1 wei until the seed produced a fight its side wins, and the published replay
        // would agree with it. The seed now commits only to values fixed before any bet existed.
        bytes32 fightSeed = keccak256(abi.encode(SERVER_SEED, id, address(arena)));
        vm.expectEmit(true, true, true, true, address(arena));
        emit RektArena.FightStarted(id, SERVER_SEED, fightSeed, uint64(block.timestamp + 5));
        vm.prank(operator);
        arena.startFight(id, SERVER_SEED);

        r = arena.getRound(id);
        assertEq(r.serverSeed, SERVER_SEED);
        assertEq(r.fightSeed, fightSeed);
        assertEq(r.fightStart, block.timestamp + 5);
        assertEq(uint8(r.status), uint8(RektArena.Status.Started));
    }

    // ---------------------------------------------------------- ERC20 rounds

    function test_StableRound_CutToTreasury_WithDust() public {
        uint256 id = _open();
        _betT(alice, id, 1, address(stable), 100e6);
        _betT(bob, id, 1, address(stable), 33e6);
        _betT(carol, id, 2, address(stable), 50e6);
        _settle(id, 1);

        // alice: 100e6 + 100e6*50e6*9500/10000/133e6 = 100e6 + 35_714_285
        // bob:    33e6 +  33e6*50e6*9500/10000/133e6 =  33e6 + 11_785_714
        assertEq(_claim(alice, id, address(stable)), 135_714_285);
        assertEq(_claim(bob, id, address(stable)), 44_785_714);
        vm.prank(stranger);
        arena.collectCut(id, address(stable));
        assertEq(stable.balanceOf(treasury), 2_500_000);
        assertEq(stable.balanceOf(DEAD), 0);
        assertEq(stable.balanceOf(address(arena)), 1, "1 unit of rounding dust stays");
    }

    function test_RektRound_CutBurnedToDead() public {
        uint256 id = _open();
        _betT(alice, id, 2, address(rektTok), 1_000e18);
        _betT(bob, id, 1, address(rektTok), 3_000e18);
        _settle(id, 2);

        // alice wins everything minus 5% of the 3,000 losing pool
        assertEq(_claim(alice, id, address(rektTok)), 1_000e18 + 2_850e18);
        vm.expectEmit(true, true, true, true, address(arena));
        emit RektArena.CutCollected(id, address(rektTok), DEAD, 150e18);
        vm.prank(stranger);
        arena.collectCut(id, address(rektTok));
        assertEq(rektTok.balanceOf(DEAD), 150e18, "REKT cut burned");
        assertEq(rektTok.balanceOf(treasury), 0, "treasury gets no REKT");
        assertEq(rektTok.balanceOf(address(arena)), 0);
    }

    function test_NoBoolToken_RoundWorks() public {
        uint256 id = _open();
        _betT(alice, id, 1, address(noBool), 10e6);
        _betT(bob, id, 2, address(noBool), 10e6);
        _settle(id, 1);
        uint256 before = noBool.balanceOf(alice);
        vm.prank(alice);
        arena.claim(id, address(noBool));
        assertEq(noBool.balanceOf(alice) - before, 19.5e6);
        arena.collectCut(id, address(noBool));
        assertEq(noBool.balanceOf(treasury), 0.5e6);
        assertEq(noBool.balanceOf(address(arena)), 0);
    }

    function test_FalseReturningToken_Reverts() public {
        FalseToken f = new FalseToken();
        vm.prank(owner);
        arena.setToken(address(f), true);
        uint256 id = _open();
        vm.prank(alice);
        vm.expectRevert(RektArena.TransferFailed.selector);
        arena.betToken(id, 1, address(f), 1e18);
    }

    function test_FeeOnTransfer_CreditedCorrectly() public {
        uint256 id = _open();
        vm.expectEmit(true, true, true, true, address(arena));
        bytes32 h1 = keccak256(abi.encode(bytes32(0), alice, uint8(1), address(feeTok), uint256(99e18), uint32(0)));
        emit RektArena.BetPlaced(id, alice, 1, address(feeTok), 99e18, h1);
        _betT(alice, id, 1, address(feeTok), 100e18);
        _betT(bob, id, 2, address(feeTok), 200e18);

        (uint256 pa, uint256 pb) = arena.pools(id, address(feeTok));
        assertEq(pa, 99e18);
        assertEq(pb, 198e18);
        (uint256 sa,) = arena.stakeOf(id, alice, address(feeTok));
        assertEq(sa, 99e18);
        assertEq(feeTok.balanceOf(address(arena)), pa + pb, "accounting == real balance");

        _settle(id, 1);
        uint256 payout = 99e18 + uint256(198e18) * 9500 / 10000; // 99 + 188.1
        assertEq(arena.previewClaim(id, alice, address(feeTok)), payout);
        uint256 arenaBefore = feeTok.balanceOf(address(arena));
        uint256 got = _claim(alice, id, address(feeTok));
        assertEq(arenaBefore - feeTok.balanceOf(address(arena)), payout, "arena sent exactly the payout");
        assertEq(got, payout - payout / 100, "token skims 1% on the way out");
        arena.collectCut(id, address(feeTok));
        assertEq(feeTok.balanceOf(address(arena)), 0, "never short");
    }

    function test_BigAmounts_NoOverflow() public {
        // stake * L * 10000 would overflow 256 bits; mulDiv keeps the exact spec result
        uint256 id = _open();
        _betT(alice, id, 1, address(rektTok), 3e40);
        _betT(bob, id, 1, address(rektTok), 1e40);
        _betT(carol, id, 2, address(rektTok), 5e40);
        _settle(id, 1);
        // alice: 3e40 + 3e40 * 5e40 * 0.95 / 4e40 = 3e40 + 3.5625e40
        assertEq(_claim(alice, id, address(rektTok)), 6.5625e40);
        assertEq(_claim(bob, id, address(rektTok)), 1e40 + 1.1875e40);
        arena.collectCut(id, address(rektTok));
        assertEq(rektTok.balanceOf(DEAD), 0.25e40);
        assertEq(rektTok.balanceOf(address(arena)), 0);
    }

    // ------------------------------------------------------- multi-currency

    function test_MultiCurrency_OneCurrencyHasNoWinners() public {
        uint256 id = _open();
        _bet(alice, id, 1, 2 ether);
        _bet(bob, id, 2, 1 ether);
        _betT(carol, id, 2, address(stable), 70e6); // stable only on B (the loser)
        _betT(dave, id, 2, address(stable), 30e6);
        _betT(eve, id, 1, address(rektTok), 500e18); // REKT only on A (the winner): no losers
        _settle(id, 1);

        // ETH: normal parimutuel
        assertEq(_claim(alice, id, ETH), 2 ether + 0.95 ether);
        vm.prank(bob);
        vm.expectRevert(RektArena.NothingToClaim.selector);
        arena.claim(id, ETH);
        arena.collectCut(id, ETH);
        assertEq(treasury.balance, 0.05 ether);

        // stable: nobody backed the winner in stable, so the losers get a full refund
        assertEq(arena.previewCut(id, address(stable)), 0);
        assertEq(_claim(carol, id, address(stable)), 70e6);
        assertEq(_claim(dave, id, address(stable)), 30e6);
        vm.expectRevert(RektArena.NoCut.selector);
        arena.collectCut(id, address(stable));
        assertEq(stable.balanceOf(treasury), 0);

        // REKT: winners but no losing pool, winners just get their stake back, no cut
        assertEq(_claim(eve, id, address(rektTok)), 500e18);
        vm.expectRevert(RektArena.NoCut.selector);
        arena.collectCut(id, address(rektTok));

        assertEq(address(arena).balance, 0);
        assertEq(stable.balanceOf(address(arena)), 0);
        assertEq(rektTok.balanceOf(address(arena)), 0);
    }

    // ---------------------------------------------------- cancel / expire

    function test_Cancel_RefundsEveryoneFromOpen() public {
        uint256 id = _open();
        _bet(alice, id, 1, 1 ether);
        _bet(alice, id, 2, 2 ether);
        _betT(bob, id, 2, address(stable), 40e6);
        _betT(carol, id, 1, address(feeTok), 100e18);

        vm.expectEmit(true, true, true, true, address(arena));
        emit RektArena.Cancelled(id);
        vm.prank(operator);
        arena.cancel(id);
        assertEq(uint8(arena.getRound(id).status), uint8(RektArena.Status.Cancelled));

        assertEq(_claim(alice, id, ETH), 3 ether, "both sides refunded");
        assertEq(_claim(bob, id, address(stable)), 40e6);
        vm.prank(carol);
        arena.claim(id, address(feeTok));
        assertEq(feeTok.balanceOf(address(arena)), 0, "refund of credited amount (99e18)");

        vm.expectRevert(RektArena.BadStatus.selector);
        arena.collectCut(id, ETH);
        assertEq(address(arena).balance, 0);
    }

    /// FINDING C1: the operator used to be able to cancel AFTER `startFight` revealed the seed,
    /// which is a free option -- bet, see the result, cancel if you lost. Only Open now.
    function test_Cancel_FromStartedIsRefused() public {
        uint256 id = _open();
        _bet(alice, id, 1, 1 ether);
        _start(id);
        vm.prank(operator);
        vm.expectRevert(RektArena.BadStatus.selector);
        arena.cancel(id);
    }

    function test_Cancel_FromOpenStillRefunds() public {
        uint256 id = _open();
        _bet(alice, id, 1, 1 ether);
        vm.prank(operator);
        arena.cancel(id);
        assertEq(_claim(alice, id, ETH), 1 ether, "cancelled before anybody could know the outcome");
    }

    /// An abandoned round is still recoverable by ANYONE after the timeout -- that path is
    /// unchanged, and it is what makes restricting the operator's cancel safe.
    function test_Cancel_AbandonedStartedRoundStillExpires() public {
        uint256 id = _open();
        _bet(alice, id, 1, 1 ether);
        _start(id);
        RektArena.Round memory r = arena.getRound(id);
        vm.warp(uint256(r.lockTime) + arena.SETTLE_TIMEOUT() + 1);
        vm.prank(stranger);
        arena.expire(id);
        assertEq(_claim(alice, id, ETH), 1 ether);
    }

    /// FINDING C1: the house is the referee, so it must not also be a player.
    function test_HouseCannotBet() public {
        uint256 id = _open();
        for (uint256 i; i < 3; ++i) {
            address who = i == 0 ? operator : i == 1 ? owner : arena.treasury();
            vm.deal(who, 1 ether);
            vm.prank(who);
            vm.expectRevert(RektArena.HouseCannotBet.selector);
            arena.bet{value: 1 ether}(id, 1);
        }
    }

    function test_Cancel_RevertsWhenFinal() public {
        uint256 id = _open();
        _bet(alice, id, 1, 1 ether);
        _settle(id, 1);
        vm.prank(operator);
        vm.expectRevert(RektArena.BadStatus.selector);
        arena.cancel(id);

        vm.prank(operator);
        vm.expectRevert(RektArena.BadStatus.selector);
        arena.cancel(999); // never opened
    }

    function test_Expire_ByAnyoneAfterTimeout() public {
        uint256 id = _open();
        _bet(alice, id, 1, 1 ether);
        _betT(bob, id, 2, address(stable), 10e6);
        uint256 lock = arena.getRound(id).lockTime;

        vm.warp(lock + 1 hours + 1);
        vm.expectEmit(true, true, true, true, address(arena));
        emit RektArena.Cancelled(id);
        vm.prank(stranger);
        arena.expire(id);

        assertEq(_claim(alice, id, ETH), 1 ether);
        assertEq(_claim(bob, id, address(stable)), 10e6);
    }

    function test_Expire_FromStartedAfterTimeout() public {
        uint256 id = _open();
        _bet(alice, id, 1, 1 ether);
        _start(id); // operator reveals, then disappears
        vm.warp(arena.getRound(id).lockTime + 1 hours + 1);
        vm.prank(stranger);
        arena.expire(id);
        assertEq(_claim(alice, id, ETH), 1 ether);
    }

    function test_Expire_RevertsBeforeTimeout() public {
        uint256 id = _open();
        _bet(alice, id, 1, 1 ether);
        uint256 lock = arena.getRound(id).lockTime;

        vm.prank(stranger);
        vm.expectRevert(RektArena.TooEarly.selector);
        arena.expire(id);

        vm.warp(lock + 1 hours); // boundary: still too early
        vm.prank(stranger);
        vm.expectRevert(RektArena.TooEarly.selector);
        arena.expire(id);

        vm.warp(lock + 1 hours + 1);
        vm.prank(stranger);
        arena.expire(id);
    }

    function test_Expire_RevertsOnFinalRounds() public {
        uint256 id = _open();
        _bet(alice, id, 1, 1 ether);
        _settle(id, 1);
        vm.warp(block.timestamp + 2 hours);
        vm.expectRevert(RektArena.BadStatus.selector);
        arena.expire(id);
        vm.expectRevert(RektArena.BadStatus.selector);
        arena.expire(12345);
    }

    // ------------------------------------------------------ timing guards

    function test_LateBet_Reverts() public {
        uint256 id = _open();
        vm.warp(arena.getRound(id).lockTime); // at lockTime betting is closed
        vm.prank(alice);
        vm.expectRevert(RektArena.BettingClosed.selector);
        arena.bet{value: 1 ether}(id, 1);
        vm.prank(alice);
        vm.expectRevert(RektArena.BettingClosed.selector);
        arena.betToken(id, 1, address(stable), 1e6);

        vm.warp(arena.getRound(id).lockTime - 1); // one second before is fine
        _bet(alice, id, 1, 1 ether);
    }

    function test_BetOnStartedOrSettledRound_Reverts() public {
        uint256 id = _open();
        _bet(alice, id, 1, 1 ether);
        _start(id);
        vm.prank(bob);
        vm.expectRevert(RektArena.BettingClosed.selector);
        arena.bet{value: 1 ether}(id, 2);
        vm.prank(bob);
        vm.expectRevert(RektArena.BettingClosed.selector);
        arena.bet{value: 1 ether}(777, 2); // unknown round
    }

    function test_BetValidation() public {
        uint256 id = _open();
        vm.startPrank(alice);
        vm.expectRevert(RektArena.BadSide.selector);
        arena.bet{value: 1 ether}(id, 0);
        vm.expectRevert(RektArena.BadSide.selector);
        arena.bet{value: 1 ether}(id, 3);
        vm.expectRevert(RektArena.ZeroAmount.selector);
        arena.bet{value: 0}(id, 1);
        vm.expectRevert(RektArena.ZeroAmount.selector);
        arena.betToken(id, 1, address(stable), 0);
        vm.expectRevert(RektArena.TokenNotAllowed.selector);
        arena.betToken(id, 1, ETH, 1 ether);
        vm.expectRevert(RektArena.TokenNotAllowed.selector);
        arena.betToken(id, 1, address(0xBEEF), 1);
        vm.expectRevert(RektArena.BadSide.selector);
        arena.betToken(id, 9, address(stable), 1e6);
        vm.stopPrank();
    }

    function test_StartFight_WrongSeedOrEarly_Reverts() public {
        uint256 id = _open();
        _bet(alice, id, 1, 1 ether);

        vm.prank(operator);
        vm.expectRevert(RektArena.TooEarly.selector);
        arena.startFight(id, SERVER_SEED);

        vm.warp(arena.getRound(id).lockTime);
        vm.prank(operator);
        vm.expectRevert(RektArena.BadSeed.selector);
        arena.startFight(id, keccak256("not the seed"));

        vm.prank(operator);
        vm.expectRevert(RektArena.BadSeed.selector);
        arena.startFight(id, SEED_HASH); // the hash itself is not the preimage

        vm.prank(operator);
        arena.startFight(id, SERVER_SEED);

        vm.prank(operator);
        vm.expectRevert(RektArena.BadStatus.selector);
        arena.startFight(id, SERVER_SEED); // cannot start twice
    }

    function test_Settle_TooEarlyReverts() public {
        uint256 id = _open();
        _bet(alice, id, 1, 1 ether);

        vm.prank(operator);
        vm.expectRevert(RektArena.BadStatus.selector);
        arena.settle(id, 1); // not started

        _start(id);
        uint256 fightStart = arena.getRound(id).fightStart;
        assertEq(fightStart, block.timestamp + 5);

        vm.warp(fightStart + 19);
        vm.prank(operator);
        vm.expectRevert(RektArena.TooEarly.selector);
        arena.settle(id, 1);

        vm.warp(fightStart + 20);
        vm.prank(operator);
        vm.expectRevert(RektArena.BadSide.selector);
        arena.settle(id, 0);
        vm.prank(operator);
        vm.expectRevert(RektArena.BadSide.selector);
        arena.settle(id, 3);

        vm.expectEmit(true, true, true, true, address(arena));
        emit RektArena.Settled(id, 2);
        vm.prank(operator);
        arena.settle(id, 2);

        vm.prank(operator);
        vm.expectRevert(RektArena.BadStatus.selector);
        arena.settle(id, 1); // cannot re-settle
    }

    // ------------------------------------------------------------ access

    function test_OnlyOperator() public {
        address[2] memory notOps = [stranger, owner];
        for (uint256 i; i < 2; i++) {
            vm.startPrank(notOps[i]);
            vm.expectRevert(RektArena.NotOperator.selector);
            arena.openRound(SEED_HASH, 1, 2, 0, 1, uint64(block.timestamp + 60));
            vm.expectRevert(RektArena.NotOperator.selector);
            arena.startFight(1, SERVER_SEED);
            vm.expectRevert(RektArena.NotOperator.selector);
            arena.settle(1, 1);
            vm.expectRevert(RektArena.NotOperator.selector);
            arena.cancel(1);
            vm.stopPrank();
        }
    }

    function test_OnlyOwner() public {
        address[2] memory notOwners = [stranger, operator];
        for (uint256 i; i < 2; i++) {
            vm.startPrank(notOwners[i]);
            vm.expectRevert(RektArena.NotOwner.selector);
            arena.transferOwnership(stranger);
            vm.expectRevert(RektArena.NotOwner.selector);
            arena.setOperator(stranger);
            vm.expectRevert(RektArena.NotOwner.selector);
            arena.setTreasury(stranger);
            vm.expectRevert(RektArena.NotOwner.selector);
            arena.setToken(address(0xBEEF), true);
            vm.expectRevert(RektArena.NotOwner.selector);
            arena.setRekt(address(0xBEEF));
            vm.expectRevert(RektArena.NotOwner.selector);
            arena.setCutBps(100);
            vm.expectRevert(RektArena.NotOwner.selector);
            arena.setPaused(true);
            vm.stopPrank();
        }
    }

    function test_OwnerSetters() public {
        vm.startPrank(owner);
        vm.expectRevert(RektArena.ZeroAddress.selector);
        arena.setOperator(address(0));
        vm.expectRevert(RektArena.ZeroAddress.selector);
        arena.setTreasury(address(0));
        vm.expectRevert(RektArena.ZeroAddress.selector);
        arena.setToken(address(0), true);
        vm.expectRevert(RektArena.ZeroAddress.selector);
        arena.setRekt(address(0));

        arena.setRekt(address(0xBEEF));
        assertEq(arena.rekt(), address(0xBEEF));
        assertTrue(arena.tokenAllowed(address(0xBEEF)), "setRekt allowlists");

        arena.setToken(address(0xBEEF), false);
        assertFalse(arena.tokenAllowed(address(0xBEEF)));

        // FINDING M8: ownership is two-step now, like the three newer contracts. A typo used to
        // burn the role permanently -- and with it `setOperator`, the only way to rotate a
        // compromised operator key.
        vm.expectEmit(true, true, true, true, address(arena));
        emit RektArena.OwnershipTransferStarted(owner, stranger);
        arena.transferOwnership(stranger);
        vm.stopPrank();
        assertEq(arena.owner(), owner, "nothing moves until it is accepted");
        assertEq(arena.pendingOwner(), stranger);

        vm.prank(alice);
        vm.expectRevert(RektArena.NotPendingOwner.selector);
        arena.acceptOwnership();

        vm.prank(stranger);
        arena.acceptOwnership();
        assertEq(arena.owner(), stranger);
        assertEq(arena.pendingOwner(), address(0));

        vm.prank(owner);
        vm.expectRevert(RektArena.NotOwner.selector);
        arena.setPaused(true);
    }

    /// FINDING M8, the accident it prevents: a transfer to a typo is recoverable, because the
    /// owner still holds the role until somebody accepts.
    function test_OwnershipTypoIsRecoverable() public {
        vm.prank(owner);
        arena.transferOwnership(address(0xDEAD0000));
        assertEq(arena.owner(), owner);
        vm.prank(owner);
        arena.transferOwnership(stranger); // just overwrite the mistake
        vm.prank(stranger);
        arena.acceptOwnership();
        assertEq(arena.owner(), stranger);
    }

    /// FINDING M10: lockTime was unbounded, so a round could take bets and then freeze them.
    function test_LockTimeIsBounded() public {
        // NB: read the constant BEFORE expectRevert. Arguments are evaluated first, so an external
        // call inside the argument list is the "next call" and eats the expectation.
        uint64 maxAhead = uint64(arena.MAX_LOCK_AHEAD());
        uint64 tooFar = uint64(block.timestamp) + maxAhead + 1;
        uint64 justOk = uint64(block.timestamp) + maxAhead;

        vm.prank(operator);
        vm.expectRevert(RektArena.BadLockTime.selector);
        arena.openRound(SEED_HASH, 1, 2, 0, 1, tooFar);

        vm.prank(operator);
        arena.openRound(SEED_HASH, 1, 2, 0, 1, justOk);
    }

    function test_Paused_OnlyBlocksOpenRound() public {
        uint256 id = _open();
        vm.prank(owner);
        arena.setPaused(true);

        vm.prank(operator);
        vm.expectRevert(RektArena.IsPaused.selector);
        arena.openRound(SEED_HASH, 1, 2, 0, 1, uint64(block.timestamp + 60));

        _bet(alice, id, 1, 1 ether);
        _bet(bob, id, 2, 1 ether);
        _settle(id, 1);
        assertEq(_claim(alice, id, ETH), 1.95 ether);
        arena.collectCut(id, ETH);

        vm.prank(owner);
        arena.setPaused(false);
        assertEq(_open(), 2);
    }

    function test_DelistedTokenStillClaimable() public {
        uint256 id = _open();
        _betT(alice, id, 1, address(stable), 10e6);
        _betT(bob, id, 2, address(stable), 10e6);
        vm.prank(owner);
        arena.setToken(address(stable), false);
        vm.prank(carol);
        vm.expectRevert(RektArena.TokenNotAllowed.selector);
        arena.betToken(id, 1, address(stable), 1e6);
        _settle(id, 1);
        assertEq(_claim(alice, id, address(stable)), 19.5e6);
        arena.collectCut(id, address(stable));
        assertEq(stable.balanceOf(treasury), 0.5e6);
    }

    function test_NoDirectEthDeposits() public {
        vm.prank(alice);
        (bool ok,) = address(arena).call{value: 1 ether}("");
        assertFalse(ok);
    }

    // ------------------------------------------------------------- cut rules

    function test_CutSnapshot_MidRoundChangeIgnored() public {
        uint256 id = _open(); // opened at 500 bps
        _bet(alice, id, 1, 1 ether);
        _bet(bob, id, 2, 1 ether);

        vm.prank(owner);
        arena.setCutBps(1000);
        assertEq(arena.getRound(id).cutBps, 500);

        _settle(id, 1);
        assertEq(_claim(alice, id, ETH), 1.95 ether, "old 5% cut applies");
        arena.collectCut(id, ETH);
        assertEq(treasury.balance, 0.05 ether);

        uint256 id2 = _open();
        assertEq(arena.getRound(id2).cutBps, 1000);
        _bet(alice, id2, 1, 1 ether);
        _bet(bob, id2, 2, 1 ether);
        _settle(id2, 1);
        assertEq(_claim(alice, id2, ETH), 1.9 ether, "new 10% cut on the next round");
    }

    function test_CutCap() public {
        vm.startPrank(owner);
        vm.expectRevert(RektArena.CutTooHigh.selector);
        arena.setCutBps(1001);
        vm.expectRevert(RektArena.CutTooHigh.selector);
        arena.setCutBps(type(uint16).max);
        arena.setCutBps(1000);
        assertEq(arena.cutBps(), 1000);
        arena.setCutBps(0);
        vm.stopPrank();

        uint256 id = _open(); // 0% cut round
        _bet(alice, id, 1, 1 ether);
        _bet(bob, id, 2, 1 ether);
        _settle(id, 1);
        assertEq(_claim(alice, id, ETH), 2 ether);
        vm.expectRevert(RektArena.NoCut.selector);
        arena.collectCut(id, ETH);
    }

    // --------------------------------------------------------- double spends

    function test_DoubleClaim_Reverts() public {
        uint256 id = _open();
        _bet(alice, id, 1, 1 ether);
        _bet(bob, id, 2, 1 ether);
        _settle(id, 1);
        _claim(alice, id, ETH);
        vm.prank(alice);
        vm.expectRevert(RektArena.AlreadyClaimed.selector);
        arena.claim(id, ETH);
        assertTrue(arena.claimed(id, alice, ETH));

        // cancelled rounds too
        uint256 id2 = _open();
        _bet(alice, id2, 1, 1 ether);
        vm.prank(operator);
        arena.cancel(id2);
        _claim(alice, id2, ETH);
        vm.prank(alice);
        vm.expectRevert(RektArena.AlreadyClaimed.selector);
        arena.claim(id2, ETH);
    }

    function test_ClaimBeforeFinal_Reverts() public {
        uint256 id = _open();
        _bet(alice, id, 1, 1 ether);
        vm.prank(alice);
        vm.expectRevert(RektArena.BadStatus.selector);
        arena.claim(id, ETH);
        _start(id);
        vm.prank(alice);
        vm.expectRevert(RektArena.BadStatus.selector);
        arena.claim(id, ETH);
        assertEq(arena.previewClaim(id, alice, ETH), 0);
    }

    function test_DoubleCollectCut_Reverts() public {
        uint256 id = _open();
        _bet(alice, id, 1, 1 ether);
        _bet(bob, id, 2, 1 ether);

        vm.expectRevert(RektArena.BadStatus.selector);
        arena.collectCut(id, ETH); // not settled
        _settle(id, 1);

        arena.collectCut(id, ETH);
        assertTrue(arena.cutCollected(id, ETH));
        assertEq(arena.previewCut(id, ETH), 0);
        vm.prank(stranger);
        vm.expectRevert(RektArena.CutAlreadyCollected.selector);
        arena.collectCut(id, ETH);
        assertEq(treasury.balance, 0.05 ether);

        // winners still get paid in full after the cut left
        assertEq(_claim(alice, id, ETH), 1.95 ether);
    }

    // ------------------------------------------------------------ reentrancy

    function test_Reentrancy_ClaimEthPayout() public {
        ReentrantClaimer attacker = new ReentrantClaimer(arena);
        uint256 id = _open();
        attacker.placeBet{value: 1 ether}(id, 1);
        _bet(bob, id, 2, 1 ether);
        _settle(id, 1);

        // re-entry reverts -> whole ETH send fails -> claim reverts, nothing paid
        vm.expectRevert(RektArena.TransferFailed.selector);
        attacker.attack();
        assertEq(address(attacker).balance, 0);
        assertFalse(arena.claimed(id, address(attacker), ETH));

        // swallowing the failed re-entry: exactly one payout, second entry hit the guard
        attacker.setSwallow(true);
        assertEq(attacker.attack(), 1.95 ether);
        assertEq(address(attacker).balance, 1.95 ether);
        assertEq(attacker.reentries(), 1);
        assertEq(attacker.reentryError(), abi.encodeWithSelector(RektArena.Reentrancy.selector));
        assertEq(address(arena).balance, 0.05 ether, "only the cut is left");

        vm.expectRevert(RektArena.AlreadyClaimed.selector);
        attacker.attack();
    }

    function test_Reentrancy_BetTokenCannotDoubleCredit() public {
        ReentrantToken evil = new ReentrantToken();
        vm.prank(owner);
        arena.setToken(address(evil), true);
        evil.mint(alice, 10e18);
        vm.prank(alice);
        evil.approve(address(arena), type(uint256).max);

        uint256 id = _open();
        evil.arm(arena, id);
        _betT(alice, id, 1, address(evil), 10e18);

        assertEq(evil.reentryError(), abi.encodeWithSelector(RektArena.Reentrancy.selector));
        (uint256 pa,) = arena.pools(id, address(evil));
        assertEq(pa, 10e18, "credited once, not double counted");
        assertEq(evil.balanceOf(address(arena)), 10e18);
    }

    // ---------------------------------------------------------------- mulDiv

    function test_MulDiv_KnownVectors() public {
        MulDivHarness h = new MulDivHarness();
        uint256 max = type(uint256).max;
        assertEq(h.mulDiv(max, max, max), max);
        assertEq(h.mulDiv(max, 3, 5), 69475253542389717254142591005212744711961990799384338423674550404747877783961);
        assertEq(
            h.mulDiv(
                0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef,
                0x123456789abcdef0123456789abcdef0123456789abcdef,
                0xfedcba9876543210fedcba9876543210fedcba9876543210fedcba98
            ),
            104691087707319763279303967294863976969246123347044836557387261713
        );
        assertEq(h.mulDiv(1 << 255, 2, 4), 1 << 254);
        vm.expectRevert(FullMath.MulDivOverflow.selector);
        h.mulDiv(1, 1, 0);
        vm.expectRevert(FullMath.MulDivOverflow.selector);
        h.mulDiv(max, max, 1);
        vm.expectRevert(FullMath.MulDivOverflow.selector);
        h.mulDiv(1 << 255, 2, 0);
    }

    function testFuzz_MulDiv_MatchesNaive(uint128 x, uint128 y, uint256 d) public {
        MulDivHarness h = new MulDivHarness();
        d = bound(d, 1, type(uint256).max);
        assertEq(h.mulDiv(x, y, d), uint256(x) * uint256(y) / d);
    }

    function testFuzz_MulDiv_Identity(uint256 x, uint256 y) public {
        MulDivHarness h = new MulDivHarness();
        vm.assume(y != 0);
        assertEq(h.mulDiv(x, y, y), x);
    }

    // ------------------------------------------------------------ solvency fuzz

    function testFuzz_Solvency(uint256 seed, uint8 nBets, uint16 cut, uint8 outcome) public {
        nBets = uint8(bound(nBets, 1, 30));
        cut = uint16(bound(cut, 0, 1000));
        vm.prank(owner);
        arena.setCutBps(cut);
        uint256 id = _open();

        address[3] memory toks = [ETH, address(stable), address(feeTok)];
        for (uint256 i; i < nBets; i++) {
            _fuzzBet(id, uint256(keccak256(abi.encode(seed, i))), toks);
        }

        uint256[3] memory total;
        for (uint256 t; t < 3; t++) {
            (uint256 a, uint256 b) = arena.pools(id, toks[t]);
            total[t] = a + b;
            assertEq(_bal(toks[t], address(arena)), total[t], "pools == real balance");
        }

        uint8 o = outcome % 4;
        if (o < 2) {
            _settle(id, o + 1);
        } else if (o == 2) {
            // The operator's cancel is Open-only now (finding C1), so a round that has started has
            // to come back through the permissionless timeout path instead.
            if (seed % 2 == 0) {
                _start(id);
                vm.warp(uint256(arena.getRound(id).lockTime) + 1 hours + 1);
                vm.prank(stranger);
                arena.expire(id);
            } else {
                vm.prank(operator);
                arena.cancel(id);
            }
        } else {
            if (seed % 2 == 0) _start(id);
            vm.warp(uint256(arena.getRound(id).lockTime) + 1 hours + 1);
            vm.prank(stranger);
            arena.expire(id);
        }

        for (uint256 t; t < 3; t++) {
            _claimAllAndCheck(id, toks[t], total[t]);
        }
    }

    function _fuzzBet(uint256 id, uint256 r, address[3] memory toks) internal {
        address u = users[r % 6];
        uint8 side = uint8(1 + (r >> 8) % 2);
        uint256 t = (r >> 16) % 3;
        uint256 amt = bound(r >> 32, 1, t == 1 ? 1e13 : 1e24);
        if (t == 0) {
            vm.deal(u, amt);
            _bet(u, id, side, amt);
        } else {
            _betT(u, id, side, toks[t], amt);
        }
    }

    struct Ctx {
        uint256 id;
        address token;
        bool settled;
        bool cancelled;
        uint8 winnerSide;
        uint16 cutBps;
        uint256 winPool;
        uint256 losePool;
        uint256 paid;
        uint256 winners;
    }

    function _claimAllAndCheck(uint256 id, address token, uint256 total) internal {
        Ctx memory c = _ctx(id, token);
        for (uint256 i; i < 6; i++) {
            _claimOne(c, users[i]);
        }
        uint256 cutAmt = _collectAndCheckCut(c);

        assertLe(c.paid + cutAmt, total, "never pays out more than the pool");
        uint256 dust = total - c.paid - cutAmt;
        assertEq(_bal(token, address(arena)), dust, "contract holds exactly the dust");
        if (c.settled && c.winPool > 0) {
            assertLe(dust, c.winners, "dust < 1 unit per winner");
        } else {
            assertEq(dust, 0, "refunds are exact");
        }
    }

    function _ctx(uint256 id, address token) internal view returns (Ctx memory c) {
        RektArena.Round memory r = arena.getRound(id);
        c.id = id;
        c.token = token;
        c.settled = r.status == RektArena.Status.Settled;
        c.cancelled = r.status == RektArena.Status.Cancelled;
        assertTrue(c.settled || c.cancelled);
        c.winnerSide = r.winnerSide;
        c.cutBps = r.cutBps;
        (uint256 pa, uint256 pb) = arena.pools(id, token);
        if (c.settled) {
            c.winPool = r.winnerSide == 1 ? pa : pb;
            c.losePool = r.winnerSide == 1 ? pb : pa;
        }
    }

    function _claimOne(Ctx memory c, address u) internal {
        (uint256 p, bool isWinner) = _expectedPayout(c, u);
        assertEq(arena.previewClaim(c.id, u, c.token), p, "preview == spec formula");
        if (p == 0) {
            vm.prank(u);
            vm.expectRevert(RektArena.NothingToClaim.selector);
            arena.claim(c.id, c.token);
            return;
        }
        if (isWinner) c.winners++;
        uint256 before = _bal(c.token, address(arena));
        vm.prank(u);
        assertEq(arena.claim(c.id, c.token), p);
        assertEq(before - _bal(c.token, address(arena)), p, "arena sent exactly p");
        c.paid += p;
        vm.prank(u);
        vm.expectRevert(RektArena.AlreadyClaimed.selector);
        arena.claim(c.id, c.token);
    }

    function _collectAndCheckCut(Ctx memory c) internal returns (uint256 cutAmt) {
        cutAmt = arena.previewCut(c.id, c.token);
        if (c.settled && c.winPool > 0 && c.losePool > 0) {
            assertEq(cutAmt, c.losePool * c.cutBps / 10_000, "cut == L * cutBps / 10000");
        } else {
            assertEq(cutAmt, 0, "no cut without both a winning and a losing pool");
        }
        if (cutAmt > 0) {
            vm.prank(stranger);
            assertEq(arena.collectCut(c.id, c.token), cutAmt);
            vm.expectRevert(RektArena.CutAlreadyCollected.selector);
            arena.collectCut(c.id, c.token);
        } else {
            vm.expectRevert();
            arena.collectCut(c.id, c.token);
        }
    }

    function _expectedPayout(Ctx memory c, address u) internal view returns (uint256 p, bool isWinner) {
        (uint256 sa, uint256 sb) = arena.stakeOf(c.id, u, c.token);
        if (c.cancelled) return (sa + sb, false);
        uint256 sWin = c.winnerSide == 1 ? sa : sb;
        uint256 sLose = c.winnerSide == 1 ? sb : sa;
        if (c.winPool == 0) return (sLose, false);
        if (sWin == 0) return (0, false);
        // the literal spec formula (fuzzed amounts are small enough not to overflow)
        p = sWin + sWin * c.losePool * (10_000 - c.cutBps) / 10_000 / c.winPool;
        assertGe(p, sWin, "a winner never gets back less than staked");
        isWinner = true;
    }
}
