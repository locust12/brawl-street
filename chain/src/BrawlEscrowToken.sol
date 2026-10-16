// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title BrawlEscrowToken
/// @notice The same stake escrow as BrawlEscrow, for matches wagered in an ERC20 (USDC, USDT) instead
///         of native ETH. Written 2026-10-13 because BrawlEscrow is ETH-only: its `deposit()` is
///         `payable` and checks `msg.value`, so there was no path at all for a stablecoin wager.
///
///         The flow is identical, deliberately, so the server, the replay proof and the refund rules
///         are unchanged:
///         1. The game server's operator key opens a match: the player wallets, the stake, a deposit
///            window, and which token this match is played for.
///         2. Every player deposits exactly the stake. The last deposit marks the match Funded.
///         3. The server replays the recorded inputs and reports the winner (one of the players) with
///            a hash of the replay file, so anyone can re-run the fight and check it.
///         4. The winner claims the pot, less the cut snapshotted at open, which is held per token for
///            withdrawCut() so it can never block a claim.
///         Refunds: anyone can cancel an Open match after its deposit window, or a Funded match never
///         reported within REPORT_TIMEOUT. The operator can cancel anything not settled. After a
///         cancel every depositor takes their stake back. The owner and operator have no path to
///         anyone's stake other than reporting a winner among that match's own players.
///
///         Three things this adds over the ETH version, all of them about real tokens on mainnet:
///         - **USDT does not return a bool.** Mainnet USDT's transfer/transferFrom return nothing at
///           all, so a plain IERC20 interface reverts on decode and the contract would be unusable
///           with the most-held stablecoin on Ethereum. `_callToken` accepts true-or-nothing and
///           rejects false, a revert, or a non-contract, which is the same helper RektArena uses.
///         - **The credited amount is a balance delta, and it must equal the stake.** A
///           fee-on-transfer token would credit less than it was sent, and the pot is computed as
///           `stake * playerCount`, so an unequal credit would let the winner claim more than the
///           contract holds. Rather than carry per-player credited amounts, such a token is simply
///           refused at deposit.
///         - **Only allowlisted tokens.** Matches are opened by the operator, but the allowlist is the
///           owner's, so a compromised operator key still cannot open a match against a token it
///           controls.
contract BrawlEscrowToken {
    // ------------------------------------------------------------------ types

    enum Status {
        None,
        Open,
        Funded,
        Settled,
        Cancelled
    }

    struct Match {
        uint128 stake; // token units per player, in that token's own decimals
        uint64 depositDeadline; // Open matches can be cancelled by anyone after this
        uint64 fundedAt; // timestamp of the last deposit
        Status status;
        uint8 playerCount;
        uint8 depositCount;
        bool paid; // winner has claimed
        uint16 cutBps; // snapshot of cutBps when the match was opened
        address winner;
        address token; // the ERC20 this match is played for, snapshotted at open
        bytes32 replayHash; // sha256 of the server's replay file (seed, config, every input)
    }

    // depositState values
    uint8 internal constant INVITED = 1;
    uint8 internal constant DEPOSITED = 2;
    uint8 internal constant REFUNDED = 3;

    uint256 public constant MAX_PLAYERS = 4;
    uint256 public constant MAX_CUT_BPS = 1000;
    uint64 public constant MIN_WINDOW = 30;
    uint64 public constant MAX_WINDOW = 1 hours;
    uint64 public constant REPORT_TIMEOUT = 2 hours;

    // ------------------------------------------------------------------ state

    address public owner;
    address public pendingOwner;
    address public operator;
    address public treasury;
    uint16 public cutBps;
    mapping(address token => uint256) public cutBalance; // per token, pulled with withdrawCut()
    mapping(address token => bool) public tokenAllowed;
    uint256 private _lock = 1;

    mapping(bytes32 => Match) internal _matches;
    mapping(bytes32 => address[]) internal _players;
    mapping(bytes32 => mapping(address => uint8)) public depositState;

    // ------------------------------------------------------------------ events

    event Opened(bytes32 indexed id, address[] players, address indexed token, uint256 stake, uint64 depositDeadline);
    event Deposited(bytes32 indexed id, address indexed player, uint256 amount);
    event Funded(bytes32 indexed id, uint256 pot);
    event Settled(bytes32 indexed id, address indexed winner, uint256 pot, bytes32 replayHash);
    event Claimed(bytes32 indexed id, address indexed winner, uint256 amount, uint256 cut);
    event Cancelled(bytes32 indexed id, address indexed by);
    event Refunded(bytes32 indexed id, address indexed player, uint256 amount);
    event OperatorSet(address operator);
    event TreasurySet(address treasury);
    event CutSet(uint16 cutBps);
    event TokenSet(address indexed token, bool allowed);
    event CutWithdrawn(address indexed token, address indexed to, uint256 amount);
    event OwnershipTransferStarted(address indexed from, address indexed to);
    event OwnershipTransferred(address indexed from, address indexed to);

    // ------------------------------------------------------------------ errors

    error NotOwner();
    error NotOperator();
    error NotPendingOwner();
    error ZeroAddress();
    error CutTooHigh();
    error Reentrancy();
    error BadStatus();
    error BadPlayers();
    error BadStake();
    error BadWindow();
    error NotInvited();
    error WrongAmount();
    error DepositClosed();
    error NotAPlayer();
    error NotWinner();
    error AlreadyPaid();
    error TooEarly();
    error NothingToRefund();
    error TransferFailed();
    error TokenNotAllowed();

    // ------------------------------------------------------------------ modifiers

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

    constructor(address owner_, address operator_, address treasury_, uint16 cutBps_) {
        if (owner_ == address(0) || operator_ == address(0) || treasury_ == address(0)) revert ZeroAddress();
        if (cutBps_ > MAX_CUT_BPS) revert CutTooHigh();
        owner = owner_;
        operator = operator_;
        treasury = treasury_;
        cutBps = cutBps_;
        emit OwnershipTransferred(address(0), owner_);
        emit OperatorSet(operator_);
        emit TreasurySet(treasury_);
        emit CutSet(cutBps_);
    }

    // ------------------------------------------------------------------ match flow

    /// @notice Operator opens a match for 2 to 4 distinct player wallets, wagered in `token`.
    function open(bytes32 id, address[] calldata players, address token, uint128 stake, uint64 window)
        external
        onlyOperator
    {
        Match storage m = _matches[id];
        if (m.status != Status.None) revert BadStatus();
        if (!tokenAllowed[token]) revert TokenNotAllowed();
        uint256 n = players.length;
        if (n < 2 || n > MAX_PLAYERS) revert BadPlayers();
        if (stake == 0) revert BadStake();
        if (window < MIN_WINDOW || window > MAX_WINDOW) revert BadWindow();
        for (uint256 i; i < n; ++i) {
            address p = players[i];
            if (p == address(0) || depositState[id][p] != 0) revert BadPlayers();
            depositState[id][p] = INVITED;
        }
        _players[id] = players;
        uint64 deadline = uint64(block.timestamp) + window;
        m.stake = stake;
        m.depositDeadline = deadline;
        m.status = Status.Open;
        m.playerCount = uint8(n);
        m.cutBps = cutBps;
        m.token = token;
        emit Opened(id, players, token, stake, deadline);
    }

    /// @notice A player puts in exactly the stake. The last deposit funds the match.
    /// @dev    Needs an ERC20 approve for `stake` to this contract first. The credited amount is the
    ///         contract's balance delta and must equal the stake exactly, so a fee-on-transfer token
    ///         cannot leave the pot short of what the winner is owed.
    function deposit(bytes32 id) external nonReentrant {
        Match storage m = _matches[id];
        if (m.status != Status.Open) revert BadStatus();
        if (block.timestamp > m.depositDeadline) revert DepositClosed();
        if (depositState[id][msg.sender] != INVITED) revert NotInvited();

        address token = m.token;
        uint256 before = _balanceOf(token);
        _callToken(token, abi.encodeWithSelector(0x23b872dd, msg.sender, address(this), uint256(m.stake))); // transferFrom
        if (_balanceOf(token) - before != uint256(m.stake)) revert WrongAmount();

        depositState[id][msg.sender] = DEPOSITED;
        emit Deposited(id, msg.sender, m.stake);
        if (++m.depositCount == m.playerCount) {
            m.status = Status.Funded;
            m.fundedAt = uint64(block.timestamp);
            emit Funded(id, uint256(m.stake) * m.playerCount);
        }
    }

    /// @notice Operator reports the replay-verified winner of a funded match.
    function report(bytes32 id, address winner, bytes32 replayHash) external onlyOperator {
        Match storage m = _matches[id];
        if (m.status != Status.Funded) revert BadStatus();
        if (depositState[id][winner] != DEPOSITED) revert NotAPlayer();
        m.status = Status.Settled;
        m.winner = winner;
        m.replayHash = replayHash;
        emit Settled(id, winner, uint256(m.stake) * m.playerCount, replayHash);
    }

    /// @notice The winner takes the pot (less the cut snapshotted at open, which goes to the treasury).
    function claim(bytes32 id) external nonReentrant {
        Match storage m = _matches[id];
        if (m.status != Status.Settled) revert BadStatus();
        if (msg.sender != m.winner) revert NotWinner();
        if (m.paid) revert AlreadyPaid();
        m.paid = true;
        uint256 pot = uint256(m.stake) * m.playerCount;
        uint256 cut = pot * m.cutBps / 10000;
        uint256 amount = pot - cut;
        cutBalance[m.token] += cut;
        _send(m.token, msg.sender, amount);
        emit Claimed(id, msg.sender, amount, cut);
    }

    /// @notice Cancel a match that is not settled. Operator: any time. Anyone: after the deposit window
    ///         of an Open match, or REPORT_TIMEOUT after a match was funded and never reported.
    function cancel(bytes32 id) external {
        Match storage m = _matches[id];
        if (m.status == Status.Open) {
            if (msg.sender != operator && block.timestamp <= m.depositDeadline) revert TooEarly();
        } else if (m.status == Status.Funded) {
            if (msg.sender != operator && block.timestamp <= uint256(m.fundedAt) + REPORT_TIMEOUT) revert TooEarly();
        } else {
            revert BadStatus();
        }
        m.status = Status.Cancelled;
        emit Cancelled(id, msg.sender);
    }

    /// @notice After a cancel, each depositor takes their stake back.
    function refund(bytes32 id) external nonReentrant {
        Match storage m = _matches[id];
        if (m.status != Status.Cancelled) revert BadStatus();
        if (depositState[id][msg.sender] != DEPOSITED) revert NothingToRefund();
        depositState[id][msg.sender] = REFUNDED;
        _send(m.token, msg.sender, m.stake);
        emit Refunded(id, msg.sender, m.stake);
    }

    // ------------------------------------------------------------------ views

    function getMatch(bytes32 id) external view returns (Match memory) {
        return _matches[id];
    }

    function playersOf(bytes32 id) external view returns (address[] memory) {
        return _players[id];
    }

    /// @notice What `who` can take out of match `id` right now (pot for the winner, stake after a cancel).
    function claimable(bytes32 id, address who) external view returns (uint256) {
        Match storage m = _matches[id];
        if (m.status == Status.Settled && who == m.winner && !m.paid) {
            uint256 pot = uint256(m.stake) * m.playerCount;
            return pot - pot * m.cutBps / 10000;
        }
        if (m.status == Status.Cancelled && depositState[id][who] == DEPOSITED) return m.stake;
        return 0;
    }

    // ------------------------------------------------------------------ admin

    /// @notice Allow or disallow an ERC20 for NEW matches. Matches already open keep their token, so
    ///         turning one off can never strand a pot that is mid-flight.
    function setToken(address token, bool allowed) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        tokenAllowed[token] = allowed;
        emit TokenSet(token, allowed);
    }

    function setOperator(address a) external onlyOwner {
        if (a == address(0)) revert ZeroAddress();
        operator = a;
        emit OperatorSet(a);
    }

    function setTreasury(address a) external onlyOwner {
        if (a == address(0)) revert ZeroAddress();
        treasury = a;
        emit TreasurySet(a);
    }

    /// @dev Applies to matches opened after the change only.
    function setCut(uint16 bps) external onlyOwner {
        if (bps > MAX_CUT_BPS) revert CutTooHigh();
        cutBps = bps;
        emit CutSet(bps);
    }

    /// @notice Sends the accumulated cut for one token to the treasury. Anyone can trigger it.
    function withdrawCut(address token) external nonReentrant {
        uint256 amount = cutBalance[token];
        if (amount == 0) return;
        cutBalance[token] = 0;
        _send(token, treasury, amount);
        emit CutWithdrawn(token, treasury, amount);
    }

    function transferOwnership(address a) external onlyOwner {
        pendingOwner = a;
        emit OwnershipTransferStarted(owner, a);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }

    // ------------------------------------------------------------------ internal

    function _send(address token, address to, uint256 amount) internal {
        _callToken(token, abi.encodeWithSelector(0xa9059cbb, to, amount)); // transfer
    }

    function _balanceOf(address token) internal view returns (uint256) {
        (bool ok, bytes memory ret) = token.staticcall(abi.encodeWithSelector(0x70a08231, address(this))); // balanceOf
        if (!ok || ret.length < 32) revert TransferFailed();
        return abi.decode(ret, (uint256));
    }

    /// @dev Accepts tokens that return true or nothing; rejects false, reverts, and non-contracts.
    ///      Mainnet USDT returns nothing, which is the whole reason this helper exists.
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
