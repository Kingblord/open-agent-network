// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * BANVault — Remix-ready MVP
 *
 * AI, strategy, policy and execution orchestration remain off-chain.
 * This contract is the final on-chain security boundary.
 *
 * SECURITY (unchanged — the hard boundary):
 * - owner controls configuration and withdrawals
 * - executor cannot withdraw or change permissions
 * - protocol target allowlist
 * - function selector allowlist per target
 * - per-transaction and daily accounting limits
 * - emergency pause
 * - reentrancy protection
 * - execute() cannot receive native BNB
 *
 * JOB ESCROW LAYER ("the bank" mental model, additive on top):
 * - jobs[jobId] is a per-task escrow envelope anchored to a creator + token
 * - the platform (owner) creates the job slot; the USER funds it
 * - the executor can only pull protocol funds up to the job's balance,
 *   still gated by every existing guard (allowlist, maxTxValue, dailyLimit)
 * - the creator can always withdraw their unused deposit (even while paused)
 *
 * accountingValue is a normalized value produced by BAN's trusted execution
 * layer (for example, fixed-precision USD). The vault does not price assets.
 * This is an MVP and must be tested/audited before mainnet custody.
 */

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract BANVault {
    uint256 public constant DAY = 1 days;

    address public owner;
    address public executor;

    uint256 public maxTxValue;
    uint256 public dailyLimit;
    uint256 public spentToday;
    uint256 public dayStart;
    bool public paused;

    mapping(address => bool) public allowedToken;
    mapping(address => bool) public allowedTarget;
    mapping(address => mapping(bytes4 => bool)) public allowedSelector;

    // --- Job escrow ("bank") state ---
    struct Job {
        address creator;    // the user who hired the agent & funds the job
        address token;      // address(0) == native BNB
        uint256 balance;    // remaining spendable deposit for this job
        bool active;        // false once withdrawn
        uint256 createdAt;
    }

    mapping(bytes32 => Job) public jobs;
    mapping(address => bytes32[]) public userJobs;

    bool private locked;

    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    event ExecutorUpdated(address indexed oldExecutor, address indexed newExecutor);
    event LimitsUpdated(uint256 maxTxValue, uint256 dailyLimit);
    event TokenPermissionUpdated(address indexed token, bool allowed);
    event TargetPermissionUpdated(address indexed target, bool allowed);
    event SelectorPermissionUpdated(address indexed target, bytes4 indexed selector, bool allowed);
    event Deposit(address indexed token, uint256 amount);
    event Withdrawal(address indexed token, address indexed to, uint256 amount);
    event NativeWithdrawal(address indexed to, uint256 amount);
    event ProtocolCall(address indexed target, bytes4 indexed selector, uint256 accountingValue, bytes32 dataHash);
    event Paused(address indexed account);
    event Unpaused(address indexed account);

    event JobCreated(bytes32 indexed jobId, address indexed creator, address indexed token);
    event JobFunded(bytes32 indexed jobId, address indexed funder, address indexed token, uint256 amount);
    event JobWithdrawn(bytes32 indexed jobId, address indexed creator, address indexed token, uint256 amount);

    error NotOwner();
    error NotExecutor();
    error ZeroAddress();
    error InvalidLimit();
    error TokenNotAllowed();
    error TargetNotAllowed();
    error SelectorNotAllowed();
    error TransactionLimitExceeded();
    error DailyLimitExceeded();
    error UnsupportedCalldata();
    error CallFailed(bytes returndata);
    error InsufficientBalance();
    error Reentrancy();
    error JobInactive();
    error JobExists();
    error JobTokenMismatch();
    error JobBalanceExceeded();
    error NotJobCreator();
    error ZeroAmount();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyExecutor() {
        if (msg.sender != executor) revert NotExecutor();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert("BANVault: paused");
        _;
    }

    modifier nonReentrant() {
        if (locked) revert Reentrancy();
        locked = true;
        _;
        locked = false;
    }

    constructor(address initialOwner, address initialExecutor) {
        if (initialOwner == address(0) || initialExecutor == address(0)) revert ZeroAddress();
        owner = initialOwner;
        executor = initialExecutor;
        dayStart = block.timestamp;
        emit OwnershipTransferred(address(0), initialOwner);
        emit ExecutorUpdated(address(0), initialExecutor);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        address old = owner;
        owner = newOwner;
        emit OwnershipTransferred(old, newOwner);
    }

    function setExecutor(address newExecutor) external onlyOwner {
        if (newExecutor == address(0)) revert ZeroAddress();
        address old = executor;
        executor = newExecutor;
        emit ExecutorUpdated(old, newExecutor);
    }

    function setLimits(uint256 newMaxTxValue, uint256 newDailyLimit) external onlyOwner {
        if (newMaxTxValue == 0 || newDailyLimit == 0 || newMaxTxValue > newDailyLimit) {
            revert InvalidLimit();
        }
        maxTxValue = newMaxTxValue;
        dailyLimit = newDailyLimit;
        emit LimitsUpdated(newMaxTxValue, newDailyLimit);
    }

    function setTokenAllowed(address token, bool allowed) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        allowedToken[token] = allowed;
        emit TokenPermissionUpdated(token, allowed);
    }

    function setTargetAllowed(address target, bool allowed) external onlyOwner {
        if (target == address(0)) revert ZeroAddress();
        allowedTarget[target] = allowed;
        emit TargetPermissionUpdated(target, allowed);
    }

    function setSelectorAllowed(address target, bytes4 selector, bool allowed) external onlyOwner {
        if (target == address(0)) revert ZeroAddress();
        if (allowed && !allowedTarget[target]) revert TargetNotAllowed();
        allowedSelector[target][selector] = allowed;
        emit SelectorPermissionUpdated(target, selector, allowed);
    }

    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function depositToken(address token, uint256 amount)
        external
        nonReentrant
        whenNotPaused
    {
        if (!allowedToken[token]) revert TokenNotAllowed();
        _safeTransferFrom(token, msg.sender, address(this), amount);
        emit Deposit(token, amount);
    }

    function withdrawToken(address token, address to, uint256 amount)
        external
        onlyOwner
        nonReentrant
    {
        if (to == address(0)) revert ZeroAddress();
        if (amount > IERC20(token).balanceOf(address(this))) revert InsufficientBalance();
        _safeTransfer(token, to, amount);
        emit Withdrawal(token, to, amount);
    }

    function withdrawNative(address payable to, uint256 amount)
        external
        onlyOwner
        nonReentrant
    {
        if (to == address(0)) revert ZeroAddress();
        if (amount > address(this).balance) revert InsufficientBalance();
        (bool ok, bytes memory data) = to.call{value: amount}("");
        if (!ok) revert CallFailed(data);
        emit NativeWithdrawal(to, amount);
    }

    // --- Job escrow ("bank") functions ---

    /**
     * Platform (owner) anchors a job slot to a creator + token.
     * jobId is BAN's taskId. No funds move here.
     * If the job was previously withdrawn, this reopens it (new balance starts at 0).
     */
    function createJob(bytes32 jobId, address creator, address token) external onlyOwner {
        if (creator == address(0)) revert ZeroAddress();
        if (jobs[jobId].active) revert JobExists();
        jobs[jobId] = Job({
            creator: creator,
            token: token,
            balance: 0,
            active: true,
            createdAt: block.timestamp
        });
        userJobs[creator].push(jobId);
        emit JobCreated(jobId, creator, token);
    }

    /**
     * User funds their own job with native BNB.
     * Funds are recorded against the job's escrow balance.
     */
    function fundJob(bytes32 jobId)
        external
        payable
        whenNotPaused
        nonReentrant
    {
        Job storage job = jobs[jobId];
        if (!job.active) revert JobInactive();
        if (job.token != address(0)) revert JobTokenMismatch();
        if (msg.value == 0) revert ZeroAmount();
        job.balance += msg.value;
        emit JobFunded(jobId, msg.sender, address(0), msg.value);
    }

    /**
     * User funds their own job with an allowed ERC20.
     * Same token allowlist gate as depositToken.
     */
    function fundJobToken(bytes32 jobId, uint256 amount)
        external
        whenNotPaused
        nonReentrant
    {
        Job storage job = jobs[jobId];
        if (!job.active) revert JobInactive();
        if (job.token == address(0)) revert JobTokenMismatch();
        if (!allowedToken[job.token]) revert TokenNotAllowed();
        if (amount == 0) revert ZeroAmount();
        _safeTransferFrom(job.token, msg.sender, address(this), amount);
        job.balance += amount;
        emit JobFunded(jobId, msg.sender, job.token, amount);
    }

    /**
     * Creator reclaims the unused remainder of their own job.
     * Deliberately NOT pause-gated: users can always recover their own
     * escrow (the executor cannot spend while paused, so the balance is
     * stable during a pause). Mirrors the owner rescue-withdraw principle.
     */
    function withdrawJob(bytes32 jobId)
        external
        nonReentrant
    {
        Job storage job = jobs[jobId];
        if (!job.active) revert JobInactive();
        if (msg.sender != job.creator) revert NotJobCreator();
        uint256 remaining = job.balance;
        if (remaining == 0) revert InsufficientBalance();
        job.balance = 0;
        job.active = false;
        if (job.token == address(0)) {
            (bool ok, bytes memory data) = payable(msg.sender).call{value: remaining}("");
            if (!ok) revert CallFailed(data);
        } else {
            _safeTransfer(job.token, msg.sender, remaining);
        }
        emit JobWithdrawn(jobId, msg.sender, job.token, remaining);
    }

    /**
     * Execute one approved protocol call, pulling from a job's escrow.
     * accountingValue is BAN's normalized policy value, not msg.value.
     * The function is intentionally non-payable, so executor cannot attach BNB.
     *
     * Every pre-existing guard remains: executor-only, pause, reentrancy,
     * target allowlist, selector allowlist, maxTxValue, dailyLimit.
     * The job balance is an ADDITIONAL, stricter bound on top of those.
     */
    function execute(
        bytes32 jobId,
        address target,
        uint256 accountingValue,
        bytes calldata data
    )
        external
        onlyExecutor
        whenNotPaused
        nonReentrant
        returns (bytes memory)
    {
        if (target == address(0)) revert ZeroAddress();
        if (!allowedTarget[target]) revert TargetNotAllowed();
        if (data.length < 4) revert UnsupportedCalldata();
        if (accountingValue == 0 || accountingValue > maxTxValue) {
            revert TransactionLimitExceeded();
        }

        _rollDayIfNeeded();

        if (spentToday + accountingValue > dailyLimit) {
            revert DailyLimitExceeded();
        }

        Job storage job = jobs[jobId];
        if (!job.active) revert JobInactive();
        if (accountingValue > job.balance) revert JobBalanceExceeded();

        bytes4 selector;
        assembly {
            selector := calldataload(data.offset)
        }

        if (!allowedSelector[target][selector]) {
            revert SelectorNotAllowed();
        }

        spentToday += accountingValue;
        job.balance -= accountingValue;

        (bool ok, bytes memory result) = target.call(data);
        if (!ok) revert CallFailed(result);

        emit ProtocolCall(target, selector, accountingValue, keccak256(data));
        return result;
    }

    function _rollDayIfNeeded() internal {
        if (block.timestamp >= dayStart + DAY) {
            dayStart = block.timestamp - (block.timestamp % DAY);
            spentToday = 0;
        }
    }

    function _safeTransfer(address token, address to, uint256 amount) internal {
        (bool ok, bytes memory data) =
            token.call(abi.encodeWithSelector(IERC20.transfer.selector, to, amount));
        if (!ok) revert CallFailed(data);
        if (data.length > 0 && !abi.decode(data, (bool))) revert CallFailed(data);
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        (bool ok, bytes memory data) =
            token.call(abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, amount));
        if (!ok) revert CallFailed(data);
        if (data.length > 0 && !abi.decode(data, (bool))) revert CallFailed(data);
    }

    receive() external payable {}
}