// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Balance {
    function balanceOf(address account) external view returns (uint256);
}

/// @notice 512-bit multiply-then-divide, floor(x * y / d) without intermediate overflow.
/// Same algorithm as Remco Bloemen's FullMath (MIT), written inline to avoid dependencies.
library FullMath {
    error MulDivOverflow();

    function mulDiv(uint256 x, uint256 y, uint256 d) internal pure returns (uint256 result) {
        unchecked {
            uint256 prod0; // low 256 bits of x * y
            uint256 prod1; // high 256 bits of x * y
            assembly {
                let mm := mulmod(x, y, not(0))
                prod0 := mul(x, y)
                prod1 := sub(sub(mm, prod0), lt(mm, prod0))
            }
            if (prod1 == 0) {
                if (d == 0) revert MulDivOverflow();
                return prod0 / d;
            }
            if (d <= prod1) revert MulDivOverflow();

            uint256 remainder;
            assembly {
                remainder := mulmod(x, y, d)
                prod1 := sub(prod1, gt(remainder, prod0))
                prod0 := sub(prod0, remainder)
            }
            uint256 twos = d & (~d + 1);
            assembly {
                d := div(d, twos)
                prod0 := div(prod0, twos)
                twos := add(div(sub(0, twos), twos), 1)
            }
            prod0 |= prod1 * twos;
            uint256 inverse = (3 * d) ^ 2;
            inverse *= 2 - d * inverse; // mod 2^8
            inverse *= 2 - d * inverse; // mod 2^16
            inverse *= 2 - d * inverse; // mod 2^32
            inverse *= 2 - d * inverse; // mod 2^64
            inverse *= 2 - d * inverse; // mod 2^128
            inverse *= 2 - d * inverse; // mod 2^256
            result = prod0 * inverse;
        }
    }
}

/// @title RektArena
/// @notice Parimutuel betting on Rekt Brawl bot fights. Two fighters per round, people back
///         side 1 (fighter A) or side 2 (fighter B) in native ETH, an allowlisted ERC20, or REKT.
///         Every currency is its own pool: winners in a currency split that currency's losing pool.
/// @dev    The fight is simulated off-chain from `fightSeed`, derived from a server seed committed
///         (as `seedHash`) before any bet was placed.
///         The owner has no path to bettors' funds; rounding dust stays in the contract.
///
/// @dev    !!! NOT SAFE TO DEPLOY. READ THIS BEFORE CREATING `arena/live.json`. !!!
///
///         The 2026-09-20 security review found three compounding holes here (finding C1) that
///         together let the operator win every round it played. Three of them are fixed in this
///         file, and the fourth — the one that matters most — is NOT, because it cannot be fixed
///         by patching:
///
///           FIXED  the operator, owner and treasury can no longer bet (`_notHouse`).
///           FIXED  `fightSeed` no longer mixes in `betsHash`, so the operator can no longer grind
///                  its own bet by 1 wei until the seed produces a fight its side wins.
///           FIXED  `cancel` is restricted to Open, so it is no longer a free option taken after
///                  `startFight` has revealed the seed and the outcome is knowable.
///           OPEN   **`settle(id, winnerSide)` still accepts whatever side the operator names and
///                  checks it against nothing.** There is no on-chain link between the settled side
///                  and the seed the fight was simulated from, and no dispute window. An operator
///                  that cannot bet from its own address can bet from any other address it
///                  controls, and nothing here can tell the difference.
///
///         So the fixes below raise the cost of the laziest version of the attack and no more.
///         What this contract needs before it holds anyone's money is a settlement design, not
///         another patch: `settle` proposing rather than deciding, `claim` unlocking only after a
///         dispute window in which anyone who re-runs the published replay can challenge. That is
///         the same decision `BrawlEscrow` needs for its operator key (finding C3) and it should be
///         made once, for both.
///
///         Until then: do not create `arena/live.json`. Without it `ARENA_LIVE` is undefined and
///         the arena runs in practice mode, which is the correct state.
contract RektArena {
    using FullMath for uint256;

    // ------------------------------------------------------------------ types

    enum Status {
        None,
        Open,
        Started,
        Settled,
        Cancelled
    }

    struct Round {
        bytes32 seedHash; // keccak256(abi.encode(serverSeed)), committed at open
        bytes32 betsHash; // rolling hash of every bet, in order
        bytes32 serverSeed; // revealed at startFight
        bytes32 fightSeed; // keccak256(abi.encode(serverSeed, id, address(this)))
        uint64 lockTime; // betting closes at this timestamp
        uint64 fightStart; // startFight timestamp + START_DELAY
        uint32 betCount;
        uint16 cutBps; // snapshot of cutBps at open
        uint16 simVersion;
        uint8 fighterA;
        uint8 fighterB;
        uint8 stage;
        uint8 winnerSide; // 0 until settled, then 1 or 2
        Status status;
    }

    // -------------------------------------------------------------- constants

    uint16 public constant MAX_CUT_BPS = 1000;
    uint256 public constant START_DELAY = 5 seconds;
    uint256 public constant MIN_FIGHT = 20 seconds;
    uint256 public constant SETTLE_TIMEOUT = 1 hours;
    /// @dev Ceiling on how far ahead a round may lock (finding M10). A round is a single fight
    ///      minutes away, so a day is already far more room than the product needs.
    uint256 public constant MAX_LOCK_AHEAD = 1 days;
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint256 private constant BPS = 10_000;

    // ------------------------------------------------------------------ state

    address public owner;
    address public pendingOwner;
    uint16 public cutBps;
    bool public paused;
    address public operator;
    address public treasury;
    address public rekt;
    uint256 public nextRoundId = 1;

    mapping(address token => bool) public tokenAllowed;
    mapping(uint256 id => Round) internal _rounds;
    mapping(uint256 id => mapping(address token => uint256[2])) internal _pools;
    mapping(uint256 id => mapping(address user => mapping(address token => uint256[2]))) internal _stakes;
    mapping(uint256 id => mapping(address user => mapping(address token => bool))) public claimed;
    mapping(uint256 id => mapping(address token => bool)) public cutCollected;

    uint256 private _lock = 1;

    // ----------------------------------------------------------------- events

    event RoundOpened(
        uint256 indexed id,
        bytes32 seedHash,
        uint8 fighterA,
        uint8 fighterB,
        uint8 stage,
        uint16 simVersion,
        uint64 lockTime,
        uint16 cutBps
    );
    event BetPlaced(
        uint256 indexed id, address indexed user, uint8 side, address indexed token, uint256 amount, bytes32 betsHash
    );
    event FightStarted(uint256 indexed id, bytes32 serverSeed, bytes32 fightSeed, uint64 fightStart);
    event Settled(uint256 indexed id, uint8 winnerSide);
    event Cancelled(uint256 indexed id);
    event Claimed(uint256 indexed id, address indexed user, address indexed token, uint256 amount);
    event CutCollected(uint256 indexed id, address indexed token, address indexed to, uint256 amount);

    event OwnershipTransferStarted(address indexed from, address indexed to);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event OperatorSet(address indexed operator);
    event TreasurySet(address indexed treasury);
    event TokenSet(address indexed token, bool allowed);
    event RektSet(address indexed rekt);
    event CutBpsSet(uint16 cutBps);
    event PausedSet(bool paused);

    // ----------------------------------------------------------------- errors

    error NotOwner();
    error NotOperator();
    error ZeroAddress();
    error NotPendingOwner();
    error HouseCannotBet();
    error CutTooHigh();
    error IsPaused();
    error BadLockTime();
    error SameFighter();
    error BadSide();
    error BadStatus();
    error BettingClosed();
    error ZeroAmount();
    error TokenNotAllowed();
    error TooEarly();
    error BadSeed();
    error AlreadyClaimed();
    error NothingToClaim();
    error CutAlreadyCollected();
    error NoCut();
    error TransferFailed();
    error Reentrancy();

    // -------------------------------------------------------------- modifiers

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(address owner_) {
        if (owner_ == address(0)) revert ZeroAddress();
        owner = owner_;
        treasury = owner_;
        emit OwnershipTransferred(address(0), owner_);
        emit TreasurySet(owner_);
    }

    // ------------------------------------------------------------------ owner

    /// @notice Hand over ownership. TWO STEP: the new owner must accept (finding M8).
    /// @dev    Was single-step, while all three newer contracts were two-step. A typo in this
    ///         argument burned the owner role permanently — and with it `setOperator`, which is
    ///         the only way to rotate a compromised operator key.
    function transferOwnership(address newOwner) external onlyOwner {
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }

    function setOperator(address newOperator) external onlyOwner {
        if (newOperator == address(0)) revert ZeroAddress();
        operator = newOperator;
        emit OperatorSet(newOperator);
    }

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        treasury = newTreasury;
        emit TreasurySet(newTreasury);
    }

    /// @notice Allow or disallow an ERC20 for new bets. Existing stakes stay claimable either way.
    function setToken(address token, bool allowed) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        tokenAllowed[token] = allowed;
        emit TokenSet(token, allowed);
    }

    /// @notice Set the REKT token (its cut is burned). Also allowlists it.
    function setRekt(address token) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        rekt = token;
        tokenAllowed[token] = true;
        emit RektSet(token);
        emit TokenSet(token, true);
    }

    /// @notice Cut for rounds opened from now on. Open rounds keep their snapshot.
    function setCutBps(uint16 newCutBps) external onlyOwner {
        if (newCutBps > MAX_CUT_BPS) revert CutTooHigh();
        cutBps = newCutBps;
        emit CutBpsSet(newCutBps);
    }

    /// @notice Pausing only stops new rounds. Bets, fights, settles and claims keep working.
    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit PausedSet(paused_);
    }

    // --------------------------------------------------------------- operator

    function openRound(bytes32 seedHash, uint8 fighterA, uint8 fighterB, uint8 stage, uint16 simVersion, uint64 lockTime)
        external
        onlyOperator
        returns (uint256 id)
    {
        if (paused) revert IsPaused();
        // FINDING M10: `lockTime` was unbounded above, so the operator could open a round that
        // takes bets and then locks bettors' money away for as long as it liked. Betting closes at
        // lockTime and `expire()` only opens SETTLE_TIMEOUT after that, so an absurd lockTime is an
        // absurd freeze on everyone who bet.
        if (lockTime <= block.timestamp || lockTime > block.timestamp + MAX_LOCK_AHEAD) revert BadLockTime();
        if (fighterA == fighterB) revert SameFighter();

        id = nextRoundId++;
        uint16 cut = cutBps;
        Round storage r = _rounds[id];
        r.seedHash = seedHash;
        r.lockTime = lockTime;
        r.cutBps = cut;
        r.simVersion = simVersion;
        r.fighterA = fighterA;
        r.fighterB = fighterB;
        r.stage = stage;
        r.status = Status.Open;

        emit RoundOpened(id, seedHash, fighterA, fighterB, stage, simVersion, lockTime, cut);
    }

    function startFight(uint256 id, bytes32 serverSeed) external onlyOperator {
        Round storage r = _rounds[id];
        if (r.status != Status.Open) revert BadStatus();
        if (block.timestamp < r.lockTime) revert TooEarly();
        if (keccak256(abi.encode(serverSeed)) != r.seedHash) revert BadSeed();

        // FINDING C1, part two. This used to mix `r.betsHash` in, and `betsHash` absorbs every
        // bet's AMOUNT. Ordinary bettors cannot grind that because `serverSeed` is secret — but the
        // operator CHOSE `serverSeed` and has known it since the round opened, so it could iterate
        // its own bet by 1 wei until the resulting seed produced a fight its side wins. The
        // published replay would then be perfectly self-consistent and off-chain verification would
        // catch nothing.
        //
        // The seed now commits only to values fixed before any bet was placed: the pre-committed
        // `serverSeed` (hashed into `seedHash` at open), the round id, and this contract. No input
        // any bettor or the operator can move after the commitment goes in.
        //
        // Note what this does NOT fix: the operator still names the winner in `settle()` with
        // nothing checking it against the seed. Removing grindable entropy means the operator can
        // no longer rig the fight; it does not stop it simply lying about who won. See the header.
        bytes32 fightSeed = keccak256(abi.encode(serverSeed, id, address(this)));
        // casting to 'uint64' is safe because block timestamps stay far below 2^64 seconds
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 fightStart = uint64(block.timestamp + START_DELAY);
        r.serverSeed = serverSeed;
        r.fightSeed = fightSeed;
        r.fightStart = fightStart;
        r.status = Status.Started;

        emit FightStarted(id, serverSeed, fightSeed, fightStart);
    }

    function settle(uint256 id, uint8 winnerSide) external onlyOperator {
        Round storage r = _rounds[id];
        if (r.status != Status.Started) revert BadStatus();
        if (block.timestamp < uint256(r.fightStart) + MIN_FIGHT) revert TooEarly();
        if (winnerSide != 1 && winnerSide != 2) revert BadSide();

        r.winnerSide = winnerSide;
        r.status = Status.Settled;
        emit Settled(id, winnerSide);
    }

    /// @notice Call off a round before the fight starts. Everyone is refunded.
    ///
    /// @dev    FINDING C1, part three. This used to be allowed on a Started round too — that is,
    ///         AFTER `startFight` revealed the seed. Combined with the operator being free to bet,
    ///         that was a free option on every round: bet, watch the fight resolve, cancel and take
    ///         your stake back if you lost. Now it is only reachable while the round is Open, so
    ///         the decision to cancel is always made before anybody can know the outcome.
    ///
    ///         A round the operator abandons after the fight has started is still recoverable:
    ///         `expire()` lets ANYONE cancel it once SETTLE_TIMEOUT has passed, which is the
    ///         permissionless path and is unchanged.
    function cancel(uint256 id) external onlyOperator {
        Round storage r = _rounds[id];
        if (r.status != Status.Open) revert BadStatus();
        _cancel(id, r);
    }

    /// @notice Anyone can cancel a round the operator abandoned, once SETTLE_TIMEOUT has passed after lock.
    function expire(uint256 id) external {
        Round storage r = _rounds[id];
        if (r.status != Status.Open && r.status != Status.Started) revert BadStatus();
        if (block.timestamp <= uint256(r.lockTime) + SETTLE_TIMEOUT) revert TooEarly();
        _cancel(id, r);
    }

    // ---------------------------------------------------------------- betting

    function bet(uint256 id, uint8 side) external payable nonReentrant {
        Round storage r = _bettable(id, side);
        _record(id, r, side, address(0), msg.value);
    }

    /// @notice Bet with an allowlisted ERC20. The credited stake is what the contract actually
    ///         received (balance delta), so fee-on-transfer tokens are accounted correctly.
    function betToken(uint256 id, uint8 side, address token, uint256 amount) external nonReentrant {
        if (!tokenAllowed[token]) revert TokenNotAllowed();
        if (amount == 0) revert ZeroAmount();
        Round storage r = _bettable(id, side);

        uint256 before = IERC20Balance(token).balanceOf(address(this));
        _callToken(token, abi.encodeWithSelector(0x23b872dd, msg.sender, address(this), amount)); // transferFrom
        uint256 credited = IERC20Balance(token).balanceOf(address(this)) - before;

        _record(id, r, side, token, credited);
    }

    // ------------------------------------------------------------ settlement

    /// @notice Pay out msg.sender's winnings (Settled) or refund (Cancelled, or no winners in this currency).
    function claim(uint256 id, address token) external nonReentrant returns (uint256 amount) {
        Status s = _rounds[id].status;
        if (s != Status.Settled && s != Status.Cancelled) revert BadStatus();
        if (claimed[id][msg.sender][token]) revert AlreadyClaimed();
        amount = _payout(id, msg.sender, token);
        if (amount == 0) revert NothingToClaim();

        claimed[id][msg.sender][token] = true;
        emit Claimed(id, msg.sender, token, amount);
        _send(token, msg.sender, amount);
    }

    /// @notice Send the cut of a settled round's losing pool: REKT to the dead address, everything else to treasury.
    function collectCut(uint256 id, address token) external nonReentrant returns (uint256 amount) {
        if (_rounds[id].status != Status.Settled) revert BadStatus();
        if (cutCollected[id][token]) revert CutAlreadyCollected();
        amount = _cutOf(id, token);
        if (amount == 0) revert NoCut();

        cutCollected[id][token] = true;
        address to = (token != address(0) && token == rekt) ? DEAD : treasury;
        emit CutCollected(id, token, to, amount);
        _send(token, to, amount);
    }

    // ------------------------------------------------------------------ views

    function getRound(uint256 id) external view returns (Round memory) {
        return _rounds[id];
    }

    function pools(uint256 id, address token) external view returns (uint256 a, uint256 b) {
        uint256[2] storage p = _pools[id][token];
        return (p[0], p[1]);
    }

    function stakeOf(uint256 id, address user, address token) external view returns (uint256 a, uint256 b) {
        uint256[2] storage s = _stakes[id][user][token];
        return (s[0], s[1]);
    }

    /// @notice What claim(id, token) would pay `user` right now (0 if not final, nothing owed, or already claimed).
    function previewClaim(uint256 id, address user, address token) external view returns (uint256) {
        if (claimed[id][user][token]) return 0;
        return _payout(id, user, token);
    }

    /// @notice What collectCut(id, token) would send right now (0 if not collectable).
    function previewCut(uint256 id, address token) external view returns (uint256) {
        if (_rounds[id].status != Status.Settled || cutCollected[id][token]) return 0;
        return _cutOf(id, token);
    }

    // --------------------------------------------------------------- internal

    /// @dev FINDING C1, part one. Nothing excluded the house from betting on its own rounds, and
    ///      the house is also the referee: `settle()` takes whichever side the operator names and
    ///      checks it against nothing. Operator bets, operator settles its own side as the winner.
    ///      The review called this "one line, do it regardless" — this is that line.
    ///
    ///      It does not make the arena safe. An operator that cannot bet from its OWN address can
    ///      still bet from any other address it controls, and nothing on chain can tell the
    ///      difference. This raises the cost of the laziest version of the attack and no more; the
    ///      real fix is that `settle` must not be an unchecked assertion. See the header.
    function _notHouse() private view {
        if (msg.sender == operator || msg.sender == owner || msg.sender == treasury) revert HouseCannotBet();
    }

    function _bettable(uint256 id, uint8 side) private view returns (Round storage r) {
        _notHouse();
        r = _rounds[id];
        if (r.status != Status.Open || block.timestamp >= r.lockTime) revert BettingClosed();
        if (side != 1 && side != 2) revert BadSide();
    }

    function _record(uint256 id, Round storage r, uint8 side, address token, uint256 credited) private {
        if (credited == 0) revert ZeroAmount();
        uint256 i = side - 1;
        _pools[id][token][i] += credited;
        _stakes[id][msg.sender][token][i] += credited;

        uint32 n = r.betCount;
        bytes32 h = keccak256(abi.encode(r.betsHash, msg.sender, side, token, credited, n));
        r.betsHash = h;
        r.betCount = n + 1;

        emit BetPlaced(id, msg.sender, side, token, credited, h);
    }

    function _cancel(uint256 id, Round storage r) private {
        if (r.status != Status.Open && r.status != Status.Started) revert BadStatus();
        r.status = Status.Cancelled;
        emit Cancelled(id);
    }

    function _payout(uint256 id, address user, address token) private view returns (uint256) {
        Round storage r = _rounds[id];
        Status s = r.status;
        uint256[2] storage st = _stakes[id][user][token];
        if (s == Status.Cancelled) return st[0] + st[1];
        if (s != Status.Settled) return 0;

        uint256 w = r.winnerSide - 1;
        uint256 l = 1 - w;
        uint256[2] storage p = _pools[id][token];
        uint256 winPool = p[w];
        if (winPool == 0) return st[l]; // nobody won in this currency: refund, no cut

        uint256 stakeWin = st[w];
        if (stakeWin == 0) return 0;
        // stakeWin + stakeWin * L * (10000 - cut) / 10000 / W, computed without overflow
        return stakeWin + stakeWin.mulDiv(p[l] * (BPS - r.cutBps), winPool * BPS);
    }

    function _cutOf(uint256 id, address token) private view returns (uint256) {
        Round storage r = _rounds[id];
        uint256 w = r.winnerSide - 1;
        uint256[2] storage p = _pools[id][token];
        uint256 losePool = p[1 - w];
        if (p[w] == 0 || losePool == 0) return 0;
        return losePool * r.cutBps / BPS;
    }

    function _send(address token, address to, uint256 amount) private {
        if (token == address(0)) {
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            _callToken(token, abi.encodeWithSelector(0xa9059cbb, to, amount)); // transfer
        }
    }

    /// @dev Accepts tokens that return true or nothing; rejects false, reverts, and non-contracts.
    function _callToken(address token, bytes memory data) private {
        (bool ok, bytes memory ret) = token.call(data);
        if (!ok) revert TransferFailed();
        if (ret.length == 0) {
            if (token.code.length == 0) revert TransferFailed();
        } else if (!abi.decode(ret, (bool))) {
            revert TransferFailed();
        }
    }
}
