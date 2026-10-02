// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title BrawlReferrals
/// @notice Referral codes for Brawl Street: who brought whom, what that is worth, and paying it.
///
/// @dev    Two phases, one contract, so nothing has to be migrated later.
///
///         **Now (no token, no wagering).** Codes are claimed and bound, and the operator credits
///         *points* with `creditPoints()`. Points cost nothing, pay nothing and promise nothing —
///         they are a scoreboard. The reason to run this from day one is that the referral graph
///         is the asset: on the day the token exists, the tree of who brought whom already exists
///         with it, built by people who were playing for a leaderboard.
///
///         **Later (rake is live).** `RakeSplitter` routes the referral slice of the house cut
///         into this contract, and the operator credits it out with `credit()`. A referrer earns
///         a share of the cut *their referees generate* — it is paid out of the house's own cut,
///         never out of anybody's pot and never on top of the rake. Referring more people cannot
///         make the game more expensive for the people playing it.
///
///         The hard limit, enforced on chain: `totalCredited[token]` can never exceed
///         `totalFunded[token]`. Whatever the operator key does, it cannot promise a cent more
///         than the referral budget that has actually been paid in, and it has no path to the
///         escrow, the arena, the staking pool or anybody's balance here.
contract BrawlReferrals {
    // ------------------------------------------------------------------ types

    /// @param code        the referrer's claimed code
    /// @param referrer    who brought this address in; set once, never changed
    /// @param boundAt     when the bind happened
    /// @param referred    how many addresses this address has brought in
    /// @param points      pre-token scoreboard
    /// @param volume      wagered volume attributed to this address's referees
    struct Account {
        bytes8 code;
        address referrer;
        uint64 boundAt;
        uint32 referred;
        uint128 points;
        uint128 volume;
    }

    /// @param minReferred referees needed to reach this tier
    /// @param shareBps    the referrer's share of the cut their referees generate
    /// @param backBps     rakeback to the referee themselves, also out of the cut
    struct Tier {
        uint32 minReferred;
        uint16 shareBps;
        uint16 backBps;
    }

    // -------------------------------------------------------------- constants

    /// @dev Ceiling on what any tier can pay. The referral budget is a slice of the house cut,
    ///      so paying out more of it than this would mean the game earns nothing on referred play.
    uint16 public constant MAX_SHARE_BPS = 3_000; // 30% of the cut
    uint16 public constant MAX_BACK_BPS = 1_000; // 10% of the cut
    uint256 public constant MAX_TIERS = 8;
    uint256 public constant MAX_BATCH = 256;
    uint256 private constant BPS = 10_000;
    /// @dev Window for the per-epoch credit ceiling (finding H4).
    uint256 public constant EPOCH = 1 days;
    /// @dev Floor on the epoch cap, so the owner cannot set it so low that honest payouts stall.
    uint16 public constant MIN_EPOCH_CAP_BPS = 500; // 5% of the budget per day

    // ------------------------------------------------------------------ state

    address public owner;
    address public pendingOwner;
    /// @notice The game server's key. Binds codes for players and posts credit batches.
    address public operator;
    /// @notice Codes can still be claimed and bound; only pauses new binds.
    bool public bindingOpen = true;

    Tier[] internal _tiers;

    mapping(address user => Account) internal _accounts;
    mapping(bytes8 code => address owner) public codeOwner;

    /// @notice Claimable balance, per user per currency. address(0) = native ETH.
    mapping(address user => mapping(address token => uint256)) public earned;
    mapping(address user => mapping(address token => uint256)) public claimedTotal;

    /// @notice Paid into the referral budget, per currency.
    mapping(address token => uint256) public totalFunded;
    /// @notice Credited out to referrers, per currency. Can never exceed totalFunded.
    mapping(address token => uint256) public totalCredited;
    mapping(address token => uint256) public totalClaimed;

    /// @notice Share of the funded budget that may be credited in one EPOCH (finding H4).
    ///         10000 = no limit. The owner sets it; the operator cannot.
    /// @dev 50% by default: it halves what a stolen operator key gets in a day without binding on
    ///      the early batches, when lifetime `totalFunded` is small and a single payout run can be
    ///      most of it. 10000 turns it off; MIN_EPOCH_CAP_BPS stops it being set uselessly low.
    uint16 public epochCapBps = 5_000;
    mapping(address token => uint256) internal _epochOf;
    /// @notice Credited so far in the current epoch, per currency.
    mapping(address token => uint256) public epochCredited;
    /// @notice Spent batch ids, so a retried credit cannot pay twice (finding M12).
    mapping(bytes32 batchId => bool) public batchDone;

    uint256 public accountCount;
    uint256 public bindCount;

    uint256 private _lock = 1;

    // ----------------------------------------------------------------- events

    event CodeClaimed(address indexed user, bytes8 code);
    event Bound(address indexed user, address indexed referrer, bytes8 code);
    event PointsCredited(address indexed user, uint256 points, uint256 total);
    event VolumeCredited(address indexed referrer, uint256 volume, uint256 total);
    event Funded(address indexed token, uint256 amount, address indexed from);
    event Credited(address indexed user, address indexed token, uint256 amount);
    event BatchCredited(bytes32 indexed batchId, address indexed token, uint256 total, uint256 count);
    event EpochCapSet(uint16 bps);
    event Claimed(address indexed user, address indexed token, uint256 amount);
    event TierSet(uint256 indexed index, uint32 minReferred, uint16 shareBps, uint16 backBps);
    event OperatorSet(address indexed operator);
    event BindingOpenSet(bool open);
    event OwnershipTransferStarted(address indexed from, address indexed to);
    event OwnershipTransferred(address indexed from, address indexed to);

    // ----------------------------------------------------------------- errors

    error NotOwner();
    error NotOperator();
    error NotPendingOwner();
    error ZeroAddress();
    error ZeroAmount();
    error BadCode();
    error CodeTaken();
    error AlreadyHaveCode();
    error NoSuchCode();
    error AlreadyBound();
    error SelfReferral();
    error BindingClosed();
    error BadTier();
    error ShareTooHigh();
    error TooManyTiers();
    error BadBatch();
    error OverBudget();
    error NotInGraph();
    error BatchReplayed();
    error EpochCapped();
    error CapTooLow();
    error Nothing();
    error Reentrancy();
    error TransferFailed();

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

    constructor(address owner_, address operator_) {
        if (owner_ == address(0) || operator_ == address(0)) revert ZeroAddress();
        owner = owner_;
        operator = operator_;
        emit OwnershipTransferred(address(0), owner_);
        emit OperatorSet(operator_);

        // Bronze / Silver / Gold. Tiers are checked from the top down, so they must stay ordered
        // by minReferred ascending.
        _pushTier(0, 1_000, 500); // any code:        10% of the cut, 5% back to the player
        _pushTier(10, 1_500, 500); // 10 referees:     15%
        _pushTier(50, 2_000, 500); // 50 referees:     20%
    }

    // ------------------------------------------------------------------ codes

    /// @notice Claim a code. One per address, first come first served, permanent.
    /// @param code 3 to 8 bytes, ASCII letters and digits only; case is folded to upper.
    function claimCode(bytes8 code) external returns (bytes8 normalised) {
        normalised = _normalise(code);
        if (codeOwner[normalised] != address(0)) revert CodeTaken();
        Account storage a = _accounts[msg.sender];
        if (a.code != bytes8(0)) revert AlreadyHaveCode();
        if (a.referrer == address(0) && a.boundAt == 0) accountCount += 1;
        a.code = normalised;
        codeOwner[normalised] = msg.sender;
        emit CodeClaimed(msg.sender, normalised);
    }

    /// @notice Bind yourself to a code. Once only, and never to your own.
    function bind(bytes8 code) external {
        _bind(msg.sender, code);
    }

    /// @notice The game server binds on a player's behalf, so following a referral link and
    ///         connecting a wallet costs the player no gas and no extra click.
    /// @dev    The operator chooses only *which code* a player is bound to, once, and only for a
    ///         player who is not bound yet. It cannot rebind, unbind, or point a bind at itself
    ///         for value — earnings still have to be funded and credited within the budget.
    function bindFor(address user, bytes8 code) external onlyOperator {
        _bind(user, code);
    }

    // ---------------------------------------------------------------- scoring

    /// @notice Pre-token scoreboard. Costs nothing and pays nothing.
    function creditPoints(address[] calldata users, uint256[] calldata amounts) external onlyOperator {
        uint256 n = users.length;
        if (n == 0 || n > MAX_BATCH || n != amounts.length) revert BadBatch();
        for (uint256 i; i < n; ++i) {
            if (amounts[i] > type(uint128).max) revert BadBatch();
            Account storage a = _accounts[users[i]];
            // forge-lint: disable-next-line(unsafe-typecast)
            a.points += uint128(amounts[i]);
            emit PointsCredited(users[i], amounts[i], a.points);
        }
    }

    /// @notice Record wagered volume attributed to a referrer's referees. Drives tiering and
    ///         the public leaderboard; does not itself move money.
    function creditVolume(address[] calldata referrers, uint256[] calldata amounts) external onlyOperator {
        uint256 n = referrers.length;
        if (n == 0 || n > MAX_BATCH || n != amounts.length) revert BadBatch();
        for (uint256 i; i < n; ++i) {
            if (amounts[i] > type(uint128).max) revert BadBatch();
            Account storage a = _accounts[referrers[i]];
            // forge-lint: disable-next-line(unsafe-typecast)
            a.volume += uint128(amounts[i]);
            emit VolumeCredited(referrers[i], amounts[i], a.volume);
        }
    }

    // ---------------------------------------------------------------- payouts

    /// @notice Pay native ETH into the referral budget. This is where `RakeSplitter`'s referral
    ///         share lands.
    receive() external payable {
        if (msg.value != 0) {
            totalFunded[address(0)] += msg.value;
            emit Funded(address(0), msg.value, msg.sender);
        }
    }

    /// @notice Register an ERC20 that was transferred in as referral budget.
    /// @dev    Credits the unaccounted balance, so a plain `transfer()` in works the same as a
    ///         deliberate call. Anyone may call it; it only ever increases the budget.
    function syncToken(address token) external returns (uint256 amount) {
        if (token == address(0)) revert ZeroAddress();
        uint256 bal = _balanceOf(token);
        uint256 booked = totalFunded[token] - totalClaimed[token];
        if (bal <= booked) revert Nothing();
        amount = bal - booked;
        totalFunded[token] += amount;
        emit Funded(token, amount, msg.sender);
    }

    /// @notice Credit earnings out of the funded budget.
    ///
    /// @param batchId  a unique id for this batch, chosen by the caller. Replaying a batchId
    ///                 reverts, so a retried transaction cannot pay twice (finding M12).
    ///
    /// @dev    The sum credited in a currency can never exceed the sum funded in it. That check
    ///         was described as "the whole trust model", and it is necessary but it was not
    ///         sufficient (finding H4): it bounds the SIZE of what the operator can hand out, not
    ///         WHO gets it. Nothing stopped the operator — the game server's hot key, on a shared
    ///         box — from crediting its own fresh address the entire un-credited budget and
    ///         claiming it. Three things now stand in the way:
    ///
    ///         1. **A recipient must be in the referral graph.** Either they own a code (a
    ///            referrer, who can earn a share) or they are bound to one (a referee, who can
    ///            earn rakeback). An address that is neither has no way to have earned anything,
    ///            so crediting it is always wrong. A thief now has to build a referral graph
    ///            first, in public, which is slow, visible and not free.
    ///         2. **A per-epoch ceiling.** Even inside the graph, no more than `epochCapBps` of
    ///            the budget can be credited per `EPOCH`, so a compromised key drains a slice and
    ///            then has to wait — which is the window in which somebody notices and rotates it.
    ///            The owner sets the cap and can set it to 10000 to switch it off.
    ///         3. **Idempotency**, so the honest failure mode (a retried RPC call) cannot double-pay.
    ///
    ///         What this deliberately does NOT do is make the credit trustless. The operator still
    ///         decides how the referral budget is split among real participants, and a compromised
    ///         key can still steer it to referrers it controls. The fix for that is the Merkle root
    ///         the review recommends, posted from cold storage with the hot key only computing it.
    ///         That is a design change and it is listed in the checklist, not done here.
    function credit(address token, bytes32 batchId, address[] calldata users, uint256[] calldata amounts)
        external
        onlyOperator
        returns (uint256 total)
    {
        uint256 n = users.length;
        if (n == 0 || n > MAX_BATCH || n != amounts.length) revert BadBatch();
        if (batchId == bytes32(0)) revert BadBatch();
        if (batchDone[batchId]) revert BatchReplayed();
        batchDone[batchId] = true;

        for (uint256 i; i < n; ++i) {
            uint256 amount = amounts[i];
            if (amount == 0) continue;
            address user = users[i];
            if (user == address(0)) revert ZeroAddress();
            // In the graph, or it cannot have earned anything.
            Account storage a = _accounts[user];
            if (a.code == bytes8(0) && a.referrer == address(0)) revert NotInGraph();
            total += amount;
            earned[user][token] += amount;
            emit Credited(user, token, amount);
        }
        if (total == 0) revert ZeroAmount();

        uint256 credited = totalCredited[token] + total;
        if (credited > totalFunded[token]) revert OverBudget();

        // Per-epoch ceiling, measured against the budget funded so far in this currency.
        uint256 epoch = block.timestamp / EPOCH;
        if (epoch != _epochOf[token]) {
            _epochOf[token] = epoch;
            epochCredited[token] = 0;
        }
        uint256 inEpoch = epochCredited[token] + total;
        if (inEpoch > totalFunded[token] * epochCapBps / BPS) revert EpochCapped();
        epochCredited[token] = inEpoch;

        totalCredited[token] = credited;
        emit BatchCredited(batchId, token, total, n);
    }

    /// @notice Withdraw what you have earned in one currency.
    function claim(address token) external nonReentrant returns (uint256 amount) {
        amount = earned[msg.sender][token];
        if (amount == 0) revert Nothing();
        earned[msg.sender][token] = 0;
        claimedTotal[msg.sender][token] += amount;
        totalClaimed[token] += amount;
        emit Claimed(msg.sender, token, amount);
        _send(token, msg.sender, amount);
    }

    // ------------------------------------------------------------------ views

    function accountOf(address user) external view returns (Account memory) {
        return _accounts[user];
    }

    function tiers() external view returns (Tier[] memory) {
        return _tiers;
    }

    /// @notice The tier `user` is on right now.
    function tierOf(address user) public view returns (uint256 index, Tier memory tier) {
        uint32 referred = _accounts[user].referred;
        for (uint256 i = _tiers.length; i != 0; --i) {
            if (referred >= _tiers[i - 1].minReferred) return (i - 1, _tiers[i - 1]);
        }
        return (0, _tiers[0]);
    }

    /// @notice Referrals left before the next tier, and what that tier pays. Zeroes at the top.
    function nextTier(address user) external view returns (uint32 toGo, uint16 shareBps) {
        (uint256 i,) = tierOf(user);
        if (i + 1 >= _tiers.length) return (0, 0);
        Tier memory next = _tiers[i + 1];
        uint32 referred = _accounts[user].referred;
        return (next.minReferred > referred ? next.minReferred - referred : 0, next.shareBps);
    }

    /// @notice What is still available to credit in a currency.
    function budgetLeft(address token) external view returns (uint256) {
        return totalFunded[token] - totalCredited[token];
    }

    function isCodeFree(bytes8 code) external view returns (bool) {
        bytes8 n = _normalise(code);
        return codeOwner[n] == address(0);
    }

    // ------------------------------------------------------------------ admin

    function setTier(uint256 index, uint32 minReferred, uint16 shareBps, uint16 backBps) external onlyOwner {
        if (index >= _tiers.length) revert BadTier();
        if (shareBps > MAX_SHARE_BPS || backBps > MAX_BACK_BPS) revert ShareTooHigh();
        _tiers[index] = Tier(minReferred, shareBps, backBps);
        emit TierSet(index, minReferred, shareBps, backBps);
    }

    function addTier(uint32 minReferred, uint16 shareBps, uint16 backBps) external onlyOwner {
        if (_tiers.length >= MAX_TIERS) revert TooManyTiers();
        if (shareBps > MAX_SHARE_BPS || backBps > MAX_BACK_BPS) revert ShareTooHigh();
        _pushTier(minReferred, shareBps, backBps);
    }

    function setOperator(address a) external onlyOwner {
        if (a == address(0)) revert ZeroAddress();
        operator = a;
        emit OperatorSet(a);
    }

    function setBindingOpen(bool open) external onlyOwner {
        bindingOpen = open;
        emit BindingOpenSet(open);
    }

    /// @notice Set the share of the referral budget the operator may credit per day (finding H4).
    ///         Owner only, so a compromised operator key cannot raise its own ceiling.
    function setEpochCapBps(uint16 bps) external onlyOwner {
        if (bps < MIN_EPOCH_CAP_BPS) revert CapTooLow();
        if (bps > BPS) revert ShareTooHigh();
        epochCapBps = bps;
        emit EpochCapSet(bps);
    }

    function transferOwnership(address to) external onlyOwner {
        pendingOwner = to;
        emit OwnershipTransferStarted(owner, to);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }

    // --------------------------------------------------------------- internal

    function _pushTier(uint32 minReferred, uint16 shareBps, uint16 backBps) private {
        _tiers.push(Tier(minReferred, shareBps, backBps));
        emit TierSet(_tiers.length - 1, minReferred, shareBps, backBps);
    }

    function _bind(address user, bytes8 code) private {
        if (!bindingOpen) revert BindingClosed();
        if (user == address(0)) revert ZeroAddress();
        bytes8 n = _normalise(code);
        address referrer = codeOwner[n];
        if (referrer == address(0)) revert NoSuchCode();
        if (referrer == user) revert SelfReferral();

        Account storage a = _accounts[user];
        if (a.referrer != address(0)) revert AlreadyBound();
        if (a.code == bytes8(0)) accountCount += 1;
        a.referrer = referrer;
        // casting to uint64 is safe: block timestamps stay far below 2^64 seconds
        // forge-lint: disable-next-line(unsafe-typecast)
        a.boundAt = uint64(block.timestamp);
        _accounts[referrer].referred += 1;
        bindCount += 1;
        emit Bound(user, referrer, n);
    }

    /// @dev Upper-cases ASCII letters and rejects anything that is not a letter or digit, so
    ///      "duane", "Duane" and "DUANE" are one code and lookalike codes cannot be minted from
    ///      whitespace or control bytes. Length 3 to 8, left aligned, zero padded.
    function _normalise(bytes8 code) private pure returns (bytes8) {
        uint64 raw = uint64(code);
        uint64 out;
        uint256 len;
        bool ended;
        for (uint256 i; i < 8; ++i) {
            uint8 c = uint8(raw >> (56 - i * 8));
            if (c == 0) {
                ended = true;
                continue;
            }
            if (ended) revert BadCode(); // a gap inside the code
            if (c >= 0x61 && c <= 0x7A) c -= 32; // a-z -> A-Z
            bool alnum = (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5A);
            if (!alnum) revert BadCode();
            out |= uint64(c) << (56 - i * 8);
            len += 1;
        }
        if (len < 3) revert BadCode();
        return bytes8(out);
    }

    function _balanceOf(address token) private view returns (uint256) {
        (bool ok, bytes memory ret) = token.staticcall(abi.encodeWithSelector(0x70a08231, address(this)));
        if (!ok || ret.length < 32) return 0;
        return abi.decode(ret, (uint256));
    }

    function _send(address token, address to, uint256 amount) private {
        if (token == address(0)) {
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            (bool ok, bytes memory ret) = token.call(abi.encodeWithSelector(0xa9059cbb, to, amount));
            if (!ok) revert TransferFailed();
            if (ret.length == 0) {
                if (token.code.length == 0) revert TransferFailed();
            } else if (!abi.decode(ret, (bool))) {
                revert TransferFailed();
            }
        }
    }
}
