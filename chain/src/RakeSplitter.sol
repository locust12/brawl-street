// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title RakeSplitter
/// @notice One address that every Brawl Street contract pays its cut to, which then routes that
///         money to the real destinations: the marketing wallet, the staking pool, the referral
///         pool and buyback-and-burn.
///
/// @dev    Why this exists instead of pointing BrawlEscrow.treasury straight at the marketing
///         wallet: the split is the thing that changes. Marketing is 100% on day one, then 40%
///         once staking opens, then some of it moves to buyback. Every one of those is a
///         `setShares()` call here — no redeploy of the escrow, no migration, and holders can
///         read the current split on chain instead of taking anyone's word for it.
///
///         Money comes in two ways:
///           - native ETH, from `BrawlEscrow.withdrawCut()` (a plain transfer into `receive()`)
///           - ERC20, from `RektArena.collectCut()` (a plain `transfer()` in)
///         Nothing is computed on the way in: `receive()` is deliberately dumb so a payer can
///         never be reverted or gas-griefed by a bad destination. `release()` does the work and
///         anyone may call it.
///
///         A destination that reverts or runs out of gas cannot block the others — its share is
///         booked to `owed` and it pulls with `withdrawOwed()`.
///
///         The owner can change where money goes. The owner cannot take money that is already
///         booked to someone in `owed`, and has no path at all to funds inside the escrow, the
///         arena or the staking pool.
contract RakeSplitter {
    // ------------------------------------------------------------------ types

    /// @param to    where this share is sent
    /// @param bps   share of every release, in basis points; all shares must total 10000
    /// @param kind  how to deliver it (see Kind)
    /// @param label short human tag for the UI and for events ("marketing", "staking", ...)
    struct Share {
        address to;
        uint16 bps;
        Kind kind;
        bytes12 label;
    }

    enum Kind {
        /// plain transfer to `to`
        Wallet,
        /// calls `to.notifyReward{value: amount}()` for ETH, or
        /// `to.notifyRewardToken(token, amount)` after an approve, so the pool's
        /// per-share index actually moves instead of the money landing as a silent donation
        Staking,
        /// ERC20 goes to the dead address. ETH cannot be burned, so ETH goes to `to`,
        /// which is the buyback executor that turns it into REKT and burns that.
        Burn
    }

    // -------------------------------------------------------------- constants

    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint256 private constant BPS = 10_000;
    /// @dev How long a proposed split is visible before it can be applied (finding M9).
    uint256 public constant SHARES_DELAY = 2 days;
    /// @dev A destination that fails gets its share booked instead of reverting the release.
    ///      These are the gas budgets each delivery attempt is given, so one grieving or broken
    ///      destination cannot burn the whole transaction.
    /// @dev Enough for a token transfer or a wallet's receive hook, not enough to grief.
    uint256 private constant DELIVER_GAS = 120_000;
    /// @dev A Staking destination has real work to do — pull the token in, register a new reward
    ///      currency the first time, move the per-share index — so it gets a wider budget.
    uint256 private constant STAKING_GAS = 400_000;

    // ------------------------------------------------------------------ state

    address public owner;
    address public pendingOwner;

    Share[] internal _shares;
    /// @notice A split proposed but not yet applied (finding M9), and when it ripens.
    Share[] internal _pendingShares;
    uint64 public sharesReadyAt;

    /// @notice Share booked to a destination whose delivery failed. Pull with `withdrawOwed()`.
    mapping(address to => mapping(address token => uint256 amount)) public owed;
    /// @notice Total booked but not yet pulled, per token. `release()` never touches this.
    mapping(address token => uint256 amount) public totalOwed;

    uint256 private _lock = 1;

    // ----------------------------------------------------------------- events

    event Received(address indexed from, uint256 amount);
    event SharesSet(Share[] shares);
    event SharesProposed(Share[] shares, uint64 readyAt);
    event SharesProposalCancelled();
    event Released(address indexed token, uint256 amount, address indexed caller);
    event Paid(address indexed to, address indexed token, uint256 amount, bytes12 label);
    event Booked(address indexed to, address indexed token, uint256 amount, bytes12 label);
    event OwedWithdrawn(address indexed to, address indexed token, uint256 amount);
    event OwnershipTransferStarted(address indexed from, address indexed to);
    event OwnershipTransferred(address indexed from, address indexed to);

    // ----------------------------------------------------------------- errors

    error NotOwner();
    error NotPendingOwner();
    error ZeroAddress();
    error NoShares();
    error NoProposal();
    error TooEarly();
    error BadTotal();
    error BadShare();
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

    constructor(address owner_, Share[] memory shares_) {
        if (owner_ == address(0)) revert ZeroAddress();
        owner = owner_;
        emit OwnershipTransferred(address(0), owner_);
        _setShares(shares_);
    }

    // --------------------------------------------------------------- funding

    /// @dev Deliberately does no work. `BrawlEscrow.withdrawCut()` reverts the whole withdrawal
    ///      if this call fails, so it must never be able to fail.
    receive() external payable {
        emit Received(msg.sender, msg.value);
    }

    // --------------------------------------------------------------- release

    /// @notice Split everything this contract holds in `token` (address(0) = native ETH)
    ///         across the current shares. Anyone may call it; the caller gets nothing for it,
    ///         it exists so nobody has to wait on an admin.
    function release(address token) public nonReentrant returns (uint256 amount) {
        amount = distributable(token);
        if (amount == 0) revert Nothing();
        emit Released(token, amount, msg.sender);

        uint256 n = _shares.length;
        uint256 sent;
        for (uint256 i; i < n; ++i) {
            Share memory s = _shares[i];
            // the last share sweeps the rounding dust, so the pot always lands exactly
            uint256 cut = (i == n - 1) ? amount - sent : amount * s.bps / BPS;
            sent += cut;
            if (cut == 0) continue;
            _deliver(s, token, cut);
        }
    }

    /// @notice `release()` for several tokens at once, skipping the empty ones.
    function releaseMany(address[] calldata tokens) external {
        uint256 n = tokens.length;
        for (uint256 i; i < n; ++i) {
            if (distributable(tokens[i]) != 0) release(tokens[i]);
        }
    }

    /// @notice A destination that failed delivery pulls its booked share here.
    ///         Anyone may call it on someone's behalf; the money only ever goes to `to`.
    function withdrawOwed(address to, address token) external nonReentrant returns (uint256 amount) {
        amount = owed[to][token];
        if (amount == 0) revert Nothing();
        owed[to][token] = 0;
        totalOwed[token] -= amount;
        emit OwedWithdrawn(to, token, amount);
        _send(token, to, amount);
    }

    // ------------------------------------------------------------------ views

    /// @notice What `release(token)` would split right now: the balance, less anything already
    ///         booked to a failed destination.
    function distributable(address token) public view returns (uint256) {
        uint256 bal = token == address(0) ? address(this).balance : _balanceOf(token);
        uint256 held = totalOwed[token];
        return bal > held ? bal - held : 0;
    }

    function shares() external view returns (Share[] memory) {
        return _shares;
    }

    function shareCount() external view returns (uint256) {
        return _shares.length;
    }

    /// @notice What each destination would receive from `release(token)` right now.
    function previewRelease(address token) external view returns (address[] memory to, uint256[] memory amounts) {
        uint256 amount = distributable(token);
        uint256 n = _shares.length;
        to = new address[](n);
        amounts = new uint256[](n);
        uint256 sent;
        for (uint256 i; i < n; ++i) {
            to[i] = _shares[i].to;
            amounts[i] = (i == n - 1) ? amount - sent : amount * _shares[i].bps / BPS;
            sent += amounts[i];
        }
    }

    // ------------------------------------------------------------------ admin

    /// @notice Propose a new split. It does NOT take effect until `applyShares()` is called, and
    ///         that cannot happen for `SHARES_DELAY` (finding M9).
    ///
    /// @dev    The whole argument for this contract is that "holders can read the current split on
    ///         chain instead of taking anyone's word for it". A split the owner can change in one
    ///         transaction, with no notice and no ceiling, is not something anyone can rely on: the
    ///         owner could point 100% of the rake at itself in a single block. That is revenue
    ///         capture rather than a path to user funds — nothing here can touch the escrow, the
    ///         arena, the staking pool or a balance already booked in `owed` — but a published
    ///         tokenomics split that can be rewritten without warning is worth nothing as a promise.
    ///
    ///         So a change is now visible for two days before it can be applied, which is the
    ///         window in which anybody watching can react. Money already booked in `owed` is
    ///         untouched by a split change either way.
    function proposeShares(Share[] calldata shares_) external onlyOwner {
        _validate(shares_);
        delete _pendingShares;
        for (uint256 i; i < shares_.length; ++i) {
            _pendingShares.push(shares_[i]);
        }
        // forge-lint: disable-next-line(unsafe-typecast)
        sharesReadyAt = uint64(block.timestamp + SHARES_DELAY);
        emit SharesProposed(shares_, sharesReadyAt);
    }

    /// @notice Apply a split proposed at least `SHARES_DELAY` ago. Anyone may call it once it is
    ///         ripe: the delay is the protection, not the owner's second signature.
    function applyShares() external {
        uint64 ready = sharesReadyAt;
        if (ready == 0) revert NoProposal();
        if (block.timestamp < ready) revert TooEarly();
        Share[] memory next = _pendingShares;
        delete _pendingShares;
        sharesReadyAt = 0;
        _setShares(next);
    }

    /// @notice Drop a pending proposal.
    function cancelShares() external onlyOwner {
        if (sharesReadyAt == 0) revert NoProposal();
        delete _pendingShares;
        sharesReadyAt = 0;
        emit SharesProposalCancelled();
    }

    /// @notice The split waiting to be applied, and when it ripens.
    function pendingShares() external view returns (Share[] memory shares_, uint64 readyAt) {
        return (_pendingShares, sharesReadyAt);
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

    function _validate(Share[] memory shares_) private pure {
        uint256 n = shares_.length;
        if (n == 0) revert NoShares();
        uint256 total;
        for (uint256 i; i < n; ++i) {
            if (shares_[i].to == address(0)) revert ZeroAddress();
            if (shares_[i].bps == 0) revert BadShare();
            total += shares_[i].bps;
        }
        if (total != BPS) revert BadTotal();
    }

    function _setShares(Share[] memory shares_) private {
        _validate(shares_);
        delete _shares;
        for (uint256 i; i < shares_.length; ++i) {
            _shares.push(shares_[i]);
        }
        emit SharesSet(shares_);
    }

    function _deliver(Share memory s, address token, uint256 amount) private {
        bool ok;

        if (s.kind == Kind.Burn && token != address(0)) {
            ok = _tryToken(token, abi.encodeWithSelector(0xa9059cbb, DEAD, amount)); // transfer
        } else if (s.kind == Kind.Staking) {
            if (token == address(0)) {
                // notifyReward()
                (ok,) = s.to.call{value: amount, gas: STAKING_GAS}(abi.encodeWithSignature("notifyReward()"));
            } else {
                // approve then notifyRewardToken(token, amount); the pool pulls it
                _tryToken(token, abi.encodeWithSelector(0x095ea7b3, s.to, 0)); // approve(to, 0)
                if (_tryToken(token, abi.encodeWithSelector(0x095ea7b3, s.to, amount))) {
                    (ok,) = s.to.call{gas: STAKING_GAS}(
                        abi.encodeWithSignature("notifyRewardToken(address,uint256)", token, amount)
                    );
                }
                if (!ok) _tryToken(token, abi.encodeWithSelector(0x095ea7b3, s.to, 0)); // pull the approval back
            }
        } else if (token == address(0)) {
            (ok,) = s.to.call{value: amount, gas: DELIVER_GAS}("");
        } else {
            ok = _tryToken(token, abi.encodeWithSelector(0xa9059cbb, s.to, amount)); // transfer
        }

        if (ok) {
            emit Paid(s.to, token, amount, s.label);
        } else {
            owed[s.to][token] += amount;
            totalOwed[token] += amount;
            emit Booked(s.to, token, amount, s.label);
        }
    }

    function _balanceOf(address token) private view returns (uint256) {
        (bool ok, bytes memory ret) = token.staticcall(abi.encodeWithSelector(0x70a08231, address(this)));
        if (!ok || ret.length < 32) return 0;
        return abi.decode(ret, (uint256));
    }

    /// @dev Token call that reports failure instead of reverting. Accepts tokens that return
    ///      true or nothing, the same rule the arena uses.
    function _tryToken(address token, bytes memory data) private returns (bool) {
        (bool ok, bytes memory ret) = token.call{gas: DELIVER_GAS}(data);
        if (!ok) return false;
        if (ret.length == 0) return token.code.length != 0;
        return abi.decode(ret, (bool));
    }

    /// @dev Used only by withdrawOwed, where reverting is correct: the puller wants to know.
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
