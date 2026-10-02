// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Min {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title BrawlStaking
/// @notice Stake the Brawl Street token, earn the arena's cut.
///
/// @dev    The point of difference: this pool pays out what the game actually earns. There is no
///         emission schedule and no minting — the only thing that ever lands here is the share of
///         the house cut that `RakeSplitter` routes in, in whatever currency it was taken
///         (native ETH from the 1v1 escrow, ERC20 from the spectator arena). If nobody plays,
///         nothing is paid, and the APR on the front end is a measurement, never a promise.
///
///         Accounting is the standard per-share index: every reward notification moves
///         `accPerWeight[token]` by `amount * ACC / totalWeight`, and a staker is owed
///         `weight * (accPerWeight - accPaid)`. That is O(1) per staker regardless of pool size.
///         A notification that arrives while nothing is staked is held in `orphan[token]` and
///         folded into the next one, so it can never be stranded.
///
///         Locking: a longer lock multiplies your *weight*, which is your share of the cut. It
///         does not mint anything and does not dilute anyone who did not lock. Principal is
///         locked for the term — that is what gives the multiplier meaning — but `exitEarly()`
///         is always open and always returns 100% of principal; what it costs is the rewards
///         accrued so far, which go back to everyone still staked. There is no path, for the
///         owner or anyone else, to a staker's principal.
contract BrawlStaking {
    // ------------------------------------------------------------------ types

    /// @param lockDays  how long principal is locked
    /// @param multBps   weight multiplier, in bps of the amount staked (10000 = 1.00x)
    /// @param enabled   new stakes allowed into this tier
    struct Tier {
        uint32 lockDays;
        uint16 multBps;
        bool enabled;
    }

    /// @param amount    tokens staked
    /// @param weight    amount * multBps / 10000, the share of every reward
    /// @param unlockAt  timestamp `unstake()` opens; 0 for the flexible tier
    /// @param multBps   snapshot of the tier multiplier when the position was opened or topped up
    /// @param tier      tier index, for the UI
    struct Position {
        uint128 amount;
        uint128 weight;
        uint64 unlockAt;
        uint16 multBps;
        uint8 tier;
    }

    // -------------------------------------------------------------- constants

    uint256 private constant ACC = 1e27;
    uint256 private constant BPS = 10_000;
    uint16 public constant MAX_MULT_BPS = 40_000; // 4.00x ceiling, so no tier can be set absurdly
    uint32 public constant MAX_LOCK_DAYS = 730;
    uint256 public constant MAX_REWARD_TOKENS = 8;

    // ------------------------------------------------------------------ state

    IERC20Min public immutable stakeToken;

    address public owner;
    address public pendingOwner;

    Tier[] internal _tiers;

    /// @notice Reward currencies, in the order they were first funded. address(0) = native ETH.
    address[] internal _rewardTokens;
    mapping(address token => bool) public isRewardToken;

    /// @notice Rewards per unit of weight, scaled by ACC.
    mapping(address token => uint256) public accPerWeight;
    /// @notice Rewards that arrived while `totalWeight` was 0, folded into the next notify.
    mapping(address token => uint256) public orphan;
    /// @notice Lifetime rewards funded, per token. For the front end's real APR.
    mapping(address token => uint256) public totalFunded;
    /// @notice Reward money this contract is holding on behalf of stakers: everything credited by
    ///         `_fund` and not yet paid out, orphans included. Principal is NOT in here — it is
    ///         `totalStaked`. The pair is what lets `syncReward()` tell a reward that arrived by
    ///         some other route apart from money that already belongs to somebody.
    mapping(address token => uint256) public reserved;

    mapping(address user => Position) internal _positions;
    /// @notice `accPerWeight` at the staker's last checkpoint.
    mapping(address user => mapping(address token => uint256)) public accPaid;
    /// @notice Settled and not yet withdrawn.
    mapping(address user => mapping(address token => uint256)) public accrued;

    uint256 public totalStaked;
    uint256 public totalWeight;
    uint256 public stakerCount;

    uint256 private _lock = 1;

    // ----------------------------------------------------------------- events

    event Staked(address indexed user, uint256 amount, uint8 tier, uint64 unlockAt, uint256 weight);
    event Unstaked(address indexed user, uint256 amount, bool early, uint256 forfeited);
    event Harvested(address indexed user, address indexed token, uint256 amount);
    event RewardAdded(address indexed token, uint256 amount, uint256 totalWeight);
    event RewardTokenAdded(address indexed token);
    event RewardTokenRemoved(address indexed token);
    event HarvestSkipped(address indexed user, address indexed token, uint256 amount);
    event OrphanSwept(address indexed token, address indexed to, uint256 amount);
    event TierSet(uint256 indexed index, uint32 lockDays, uint16 multBps, bool enabled);
    event OwnershipTransferStarted(address indexed from, address indexed to);
    event OwnershipTransferred(address indexed from, address indexed to);

    // ----------------------------------------------------------------- errors

    error NotOwner();
    error NotPendingOwner();
    error ZeroAddress();
    error ZeroAmount();
    error AmountTooLarge();
    error BadTier();
    error TierDisabled();
    error MultTooHigh();
    error LockTooLong();
    error NoPosition();
    error StillLocked();
    error StillStaked();
    error ShorterLock();
    error TooManyRewardTokens();
    error NotRewardToken();
    error Nothing();
    error Reentrancy();
    error TransferFailed();

    // -------------------------------------------------------------- modifiers

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    /// @param owner_      can add reward currencies and adjust tiers; can never touch principal
    /// @param stakeToken_ the Brawl Street token
    constructor(address owner_, address stakeToken_) {
        if (owner_ == address(0) || stakeToken_ == address(0)) revert ZeroAddress();
        owner = owner_;
        stakeToken = IERC20Min(stakeToken_);
        emit OwnershipTransferred(address(0), owner_);

        // native ETH is always a reward currency; it is what the 1v1 escrow's cut arrives in
        _rewardTokens.push(address(0));
        isRewardToken[address(0)] = true;
        emit RewardTokenAdded(address(0));

        _pushTier(0, 10_000, true); // Flexible   1.00x, unstake whenever
        _pushTier(30, 12_500, true); // 30 days    1.25x
        _pushTier(90, 16_000, true); // 90 days    1.60x
        _pushTier(180, 22_000, true); // 180 days   2.20x
    }

    // ---------------------------------------------------------------- funding

    /// @notice Fund the pool with native ETH. Called by `RakeSplitter` on every release;
    ///         anyone may also just send rewards in.
    function notifyReward() external payable {
        if (msg.value == 0) revert ZeroAmount();
        _fund(address(0), msg.value);
    }

    /// @notice Register a reward currency. OWNER ONLY, and that is the whole point.
    ///
    /// @dev    FINDING C4. This used to happen implicitly inside `notifyRewardToken`, which anyone
    ///         could call, and it was enough to freeze every staker's rewards in every currency,
    ///         permanently:
    ///
    ///           1. deploy a token whose `transfer` returns false,
    ///           2. register it by funding a single wei of it (registration cost nothing, and the
    ///              credit came from a balance delta so the token could lie about that too),
    ///           3. every staker now has a non-zero balance in a currency that cannot be sent,
    ///           4. `harvest()` was the only withdrawal path, it looped every registered currency,
    ///              and a failed send reverted the whole call. Legitimate ETH rewards became
    ///              permanently unwithdrawable, with no removal function and no owner override.
    ///
    ///         A sibling of the same hole: 7 transactions could squat the remaining
    ///         MAX_REWARD_TOKENS slots with junk and kill the ERC20 reward path for good.
    ///
    ///         Three changes close it. Registration is owner-only (here). `harvestToken()` lets one
    ///         currency be withdrawn on its own, so no single currency can hold the others hostage.
    ///         And the batch `harvest()` skips a currency that will not send instead of reverting.
    ///         `removeRewardToken()` is the last resort if something hostile is ever registered by
    ///         mistake. Defence in depth on purpose: any one of them alone would have stopped this.
    function addRewardToken(address token) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        if (isRewardToken[token]) return;
        if (_rewardTokens.length >= MAX_REWARD_TOKENS) revert TooManyRewardTokens();
        _rewardTokens.push(token);
        isRewardToken[token] = true;
        emit RewardTokenAdded(token);
    }

    /// @notice Stop a currency accruing further rewards and drop it from the harvest loop.
    ///         Balances already accrued in it stay claimable through `harvestToken()`, so removing
    ///         a currency never confiscates anything — it only stops it blocking anything else.
    ///         Native ETH cannot be removed; it is what the 1v1 escrow's cut arrives in.
    function removeRewardToken(address token) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        if (!isRewardToken[token]) revert NotRewardToken();
        isRewardToken[token] = false;
        uint256 n = _rewardTokens.length;
        for (uint256 i; i < n; ++i) {
            if (_rewardTokens[i] != token) continue;
            _rewardTokens[i] = _rewardTokens[n - 1];
            _rewardTokens.pop();
            break;
        }
        emit RewardTokenRemoved(token);
    }

    /// @notice Fund the pool with an ERC20 the owner has registered. The caller must have approved
    ///         `amount` first. Credited on the balance delta, so fee-on-transfer currencies are
    ///         handled. Funding stays permissionless — anyone may donate to stakers — but only a
    ///         currency the owner chose can be funded.
    function notifyRewardToken(address token, uint256 amount) external nonReentrant {
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (!isRewardToken[token]) revert NotRewardToken();
        uint256 before = IERC20Min(token).balanceOf(address(this));
        _pull(token, msg.sender, amount);
        _fund(token, IERC20Min(token).balanceOf(address(this)) - before);
    }

    /// @dev A plain transfer in is treated as an ETH reward, so a careless send is never lost.
    receive() external payable {
        if (msg.value != 0) _fund(address(0), msg.value);
    }

    // ---------------------------------------------------------------- staking

    /// @notice Stake `amount` into `tier`. Topping up an existing position restarts its lock and
    ///         re-snapshots the multiplier, and the new tier may not be shorter than the current
    ///         one — you can always lock for longer, never quietly shorten a lock you are in.
    function stake(uint256 amount, uint8 tier) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (tier >= _tiers.length) revert BadTier();
        Tier memory t = _tiers[tier];
        if (!t.enabled) revert TierDisabled();

        Position storage p = _positions[msg.sender];
        uint64 unlockAt = t.lockDays == 0 ? 0 : uint64(block.timestamp + uint256(t.lockDays) * 1 days);
        // compare the real unlock times, not tier indices, so a tier added out of order
        // can still never be used to shorten a lock somebody is already inside
        if (p.amount != 0 && unlockAt < p.unlockAt) revert ShorterLock();

        _checkpoint(msg.sender);

        uint256 before = stakeToken.balanceOf(address(this));
        _pull(address(stakeToken), msg.sender, amount);
        uint256 credited = stakeToken.balanceOf(address(this)) - before;
        if (credited == 0) revert ZeroAmount();

        if (p.amount == 0) stakerCount += 1;

        uint256 amount256 = uint256(p.amount) + credited;
        uint256 weight256 = amount256 * t.multBps / BPS;
        // the cast is checked rather than assumed: weight is the larger of the two, so bounding it
        // bounds both, and a token whose supply really is that large just cannot stake here
        if (weight256 > type(uint128).max) revert AmountTooLarge();
        // forge-lint: disable-next-line(unsafe-typecast)
        uint128 newAmount = uint128(amount256);
        // forge-lint: disable-next-line(unsafe-typecast)
        uint128 newWeight = uint128(weight256);

        totalStaked += credited;
        totalWeight = totalWeight - p.weight + newWeight;

        p.amount = newAmount;
        p.weight = newWeight;
        p.unlockAt = unlockAt;
        p.multBps = t.multBps;
        p.tier = tier;

        emit Staked(msg.sender, credited, tier, unlockAt, newWeight);
    }

    /// @notice Take the whole position back after its lock. Rewards are settled, not lost —
    ///         withdraw them with `harvest()` whenever.
    function unstake() external nonReentrant {
        Position storage p = _positions[msg.sender];
        if (p.amount == 0) revert NoPosition();
        if (block.timestamp < p.unlockAt) revert StillLocked();
        _close(p, false);
    }

    /// @notice Break the lock. Returns 100% of principal and gives up everything accrued so far,
    ///         which is redistributed to whoever is still staked.
    function exitEarly() external nonReentrant {
        Position storage p = _positions[msg.sender];
        if (p.amount == 0) revert NoPosition();
        _close(p, block.timestamp < p.unlockAt);
    }

    /// @notice Withdraw settled rewards in every currency. Works while locked.
    ///
    /// @dev    A currency that will not send is SKIPPED, not reverted on (finding C4). If one
    ///         reward token ever misbehaves — hostile, paused, blacklisting the caller, or simply
    ///         broken — it must not be able to take everyone's ETH rewards down with it. The
    ///         balance is left intact for a later `harvestToken()`, so nothing is destroyed by the
    ///         skip; the staker just does not get that one currency today.
    function harvest() external nonReentrant {
        _checkpoint(msg.sender);
        uint256 n = _rewardTokens.length;
        uint256 paid;
        for (uint256 i; i < n; ++i) {
            address token = _rewardTokens[i];
            uint256 amount = accrued[msg.sender][token];
            if (amount == 0) continue;
            accrued[msg.sender][token] = 0;
            if (_trySend(token, msg.sender, amount)) {
                reserved[token] -= amount;
                paid += 1;
                emit Harvested(msg.sender, token, amount);
            } else {
                accrued[msg.sender][token] = amount; // put it back; it is still owed
                emit HarvestSkipped(msg.sender, token, amount);
            }
        }
        if (paid == 0) revert Nothing();
    }

    /// @notice Withdraw settled rewards in ONE currency. The escape hatch that means no single
    ///         reward token can hold the others hostage (finding C4). Works while locked.
    function harvestToken(address token) external nonReentrant {
        // Deliberately `_settleToken`, not `_checkpoint`: this must work for a currency that has
        // been removed from the registered list, or `removeRewardToken` would confiscate.
        _settleToken(msg.sender, token);
        uint256 amount = accrued[msg.sender][token];
        if (amount == 0) revert Nothing();
        accrued[msg.sender][token] = 0;
        reserved[token] -= amount;
        emit Harvested(msg.sender, token, amount);
        _send(token, msg.sender, amount);
    }

    // ------------------------------------------------------------------ views

    function positionOf(address user) external view returns (Position memory) {
        return _positions[user];
    }

    function tiers() external view returns (Tier[] memory) {
        return _tiers;
    }

    function rewardTokens() external view returns (address[] memory) {
        return _rewardTokens;
    }

    /// @notice Everything `user` could `harvest()` right now, settled plus unsettled.
    function pending(address user) external view returns (address[] memory tokens, uint256[] memory amounts) {
        uint256 n = _rewardTokens.length;
        tokens = new address[](n);
        amounts = new uint256[](n);
        uint256 w = _positions[user].weight;
        for (uint256 i; i < n; ++i) {
            address token = _rewardTokens[i];
            tokens[i] = token;
            amounts[i] = accrued[user][token] + (w == 0 ? 0 : w * (accPerWeight[token] - accPaid[user][token]) / ACC);
        }
    }

    /// @notice What `user` could `harvestToken()` right now in ONE currency, settled plus unsettled.
    ///         Works for a currency that has been removed from the registered list, which `pending()`
    ///         cannot show — so a staker can always see a balance they are still owed.
    function pendingToken(address user, address token) external view returns (uint256) {
        uint256 w = _positions[user].weight;
        return accrued[user][token] + (w == 0 ? 0 : w * (accPerWeight[token] - accPaid[user][token]) / ACC);
    }

    /// @notice Lifetime rewards funded in each currency — the numerator the front end needs to
    ///         state a real, measured yield instead of an invented one.
    function funded() external view returns (address[] memory tokens, uint256[] memory amounts) {
        uint256 n = _rewardTokens.length;
        tokens = new address[](n);
        amounts = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            tokens[i] = _rewardTokens[i];
            amounts[i] = totalFunded[_rewardTokens[i]];
        }
    }

    // ------------------------------------------------------------------ admin

    function setTier(uint256 index, uint32 lockDays, uint16 multBps, bool enabled) external onlyOwner {
        if (index >= _tiers.length) revert BadTier();
        if (multBps > MAX_MULT_BPS || multBps < BPS) revert MultTooHigh();
        if (lockDays > MAX_LOCK_DAYS) revert LockTooLong();
        _tiers[index] = Tier(lockDays, multBps, enabled);
        emit TierSet(index, lockDays, multBps, enabled);
    }

    function addTier(uint32 lockDays, uint16 multBps) external onlyOwner {
        if (multBps > MAX_MULT_BPS || multBps < BPS) revert MultTooHigh();
        if (lockDays > MAX_LOCK_DAYS) revert LockTooLong();
        _pushTier(lockDays, multBps, true);
    }

    /// @notice Credit reward money that reached this contract without going through
    ///         `notifyReward`/`notifyRewardToken`. Permissionless: it can only ever pay stakers.
    ///
    /// @dev    There is a real route to stranded ERC20 rewards now that registration is owner-only.
    ///         `RakeSplitter._deliver` treats a failed `notifyRewardToken` as a non-fatal miss and
    ///         books the amount to `owed[stakingPool][token]` — which is the right call, since a
    ///         reverting destination must not block the whole split. But `withdrawOwed` then
    ///         *pushes* those tokens here with a plain transfer, and a plain transfer credits
    ///         nobody: the balance would sit in this contract outside the index forever. Route a
    ///         new ERC20 through the splitter before the owner has called `addRewardToken`, let
    ///         anyone call `withdrawOwed`, and that is exactly what happens.
    ///
    ///         The arithmetic is the point. `reserved[token]` is what is already owed to stakers
    ///         and `totalStaked` is principal, so anything above the two is money nobody has a
    ///         claim on yet, which is precisely what should be distributed. Principal can never be
    ///         swept into rewards, because it is subtracted when the stake token is also a reward
    ///         token. Nobody but a staker can receive anything as a result of this call, so leaving
    ///         it open costs nothing and means a mis-ordered deployment is self-healing.
    function syncReward(address token) external nonReentrant returns (uint256 credited) {
        if (!isRewardToken[token]) revert NotRewardToken();
        uint256 bal = token == address(0) ? address(this).balance : IERC20Min(token).balanceOf(address(this));
        uint256 held = reserved[token] + (token == address(stakeToken) ? totalStaked : 0);
        if (bal <= held) revert Nothing();
        credited = bal - held;
        _fund(token, credited);
    }

    /// @notice Recover rewards that arrived while nothing was staked and were never folded into a
    ///         later notification (finding M11).
    ///
    /// @dev    `_fund` holds a reward that lands while `totalWeight == 0` in `orphan[token]` and
    ///         adds it to the next notification. That is the right behaviour and it means a reward
    ///         is never lost to rounding — but if the last staker leaves and no further reward ever
    ///         arrives in that currency, the balance sits in the contract forever with no path out
    ///         for anybody.
    ///
    ///         This only ever moves `orphan`, which by definition is money no staker has a claim
    ///         on: nobody was staked when it arrived. It cannot touch `accPerWeight`, anything
    ///         `accrued`, or any principal. It also refuses to run while anything is staked, so it
    ///         can never be used to race a pending fold-in — with stakers present, the next notify
    ///         distributes the orphan to them, which is what should happen.
    function sweepOrphan(address token, address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (totalWeight != 0) revert StillStaked();
        uint256 amount = orphan[token];
        if (amount == 0) revert Nothing();
        orphan[token] = 0;
        reserved[token] -= amount;
        emit OrphanSwept(token, to, amount);
        _send(token, to, amount);
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

    function _pushTier(uint32 lockDays, uint16 multBps, bool enabled) private {
        _tiers.push(Tier(lockDays, multBps, enabled));
        emit TierSet(_tiers.length - 1, lockDays, multBps, enabled);
    }

    /// @dev Move `amount` into the per-weight index, or hold it if nothing is staked yet.
    function _fund(address token, uint256 amount) private {
        if (amount == 0) return;
        totalFunded[token] += amount;
        reserved[token] += amount;
        uint256 w = totalWeight;
        if (w == 0) {
            orphan[token] += amount;
        } else {
            uint256 total = amount + orphan[token];
            orphan[token] = 0;
            accPerWeight[token] += total * ACC / w;
        }
        emit RewardAdded(token, amount, w);
    }

    /// @dev Settle everything `user` has earned at the current index, in every currency.
    ///      Must be called before any change to their weight.
    function _checkpoint(address user) private {
        uint256 n = _rewardTokens.length;
        for (uint256 i; i < n; ++i) {
            _settleToken(user, _rewardTokens[i]);
        }
    }

    /// @dev Settle ONE currency for `user`. Split out of `_checkpoint` so it can be reached for a
    ///      currency that is no longer in `_rewardTokens`.
    ///
    ///      Without this, `removeRewardToken` confiscated: a staker's earnings only move from the
    ///      index into `accrued` when they are checkpointed, and `_checkpoint` only walks the
    ///      REGISTERED list — so removing a currency before a staker had touched the pool silently
    ///      destroyed everything they had earned in it. `harvestToken` now settles the currency it
    ///      is asked about, registered or not, which is what makes the promise in
    ///      `removeRewardToken` ("stops it blocking anything else, never confiscates") true.
    function _settleToken(address user, address token) private {
        uint256 w = _positions[user].weight;
        uint256 acc = accPerWeight[token];
        if (w != 0) {
            uint256 gain = w * (acc - accPaid[user][token]) / ACC;
            if (gain != 0) accrued[user][token] += gain;
        }
        accPaid[user][token] = acc;
    }

    /// @dev Return principal and clear the position. `early` gives up accrued rewards, which are
    ///      pushed back into the index for whoever is still staked.
    function _close(Position storage p, bool early) private {
        _checkpoint(msg.sender);

        uint256 amount = p.amount;
        uint256 weight = p.weight;

        totalStaked -= amount;
        totalWeight -= weight;
        stakerCount -= 1;

        p.amount = 0;
        p.weight = 0;
        p.unlockAt = 0;
        p.multBps = 0;
        p.tier = 0;

        uint256 forfeited;
        if (early) {
            uint256 n = _rewardTokens.length;
            for (uint256 i; i < n; ++i) {
                address token = _rewardTokens[i];
                uint256 give = accrued[msg.sender][token];
                if (give == 0) continue;
                accrued[msg.sender][token] = 0;
                forfeited += give;
                // totalFunded already counts it; redistribute without double counting
                uint256 w = totalWeight;
                if (w == 0) {
                    orphan[token] += give;
                } else {
                    uint256 total = give + orphan[token];
                    orphan[token] = 0;
                    accPerWeight[token] += total * ACC / w;
                }
            }
        }

        emit Unstaked(msg.sender, amount, early, forfeited);
        if (!_trySend(address(stakeToken), msg.sender, amount)) revert TransferFailed();
    }

    function _send(address token, address to, uint256 amount) private {
        if (!_trySend(token, to, amount)) revert TransferFailed();
    }

    /// @dev Send and report whether it worked, without reverting. Used by the batch `harvest()` so
    ///      one bad currency cannot block the rest (finding C4).
    ///
    ///      The ERC20 leg is a raw call rather than `IERC20Min(token).transfer(...)` on purpose:
    ///      tokens that return nothing at all (USDT is the famous one) make the typed call revert
    ///      in ABI decoding even when the transfer succeeded. Empty return data is treated as
    ///      success, which is what every safe-transfer library does. `token.code.length` is checked
    ///      because a call to an address with no code succeeds and returns nothing, which would
    ///      otherwise read as a successful transfer of a token that does not exist.
    function _trySend(address token, address to, uint256 amount) private returns (bool) {
        if (token == address(0)) {
            (bool ok,) = to.call{value: amount}("");
            return ok;
        }
        if (token.code.length == 0) return false;
        (bool ok2, bytes memory data) = token.call(abi.encodeCall(IERC20Min.transfer, (to, amount)));
        if (!ok2) return false;
        return data.length == 0 || abi.decode(data, (bool));
    }

    /// @dev Pull in, tolerating tokens that return nothing. Same reasoning as `_trySend`.
    function _pull(address token, address from, uint256 amount) private {
        if (token.code.length == 0) revert TransferFailed();
        (bool ok, bytes memory data) = token.call(abi.encodeCall(IERC20Min.transferFrom, (from, address(this), amount)));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }
}
