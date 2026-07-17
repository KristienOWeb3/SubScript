/* SPDX-License-Identifier: MIT */
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title SubScriptVault
 * @author SubScript Protocol
 * @notice Escrowed prepaid "commit" vaults for metered services.
 *
 * STATUS: an earlier revision of this contract is DEPLOYED on Arc testnet behind a UUPS
 * proxy (see NEXT_PUBLIC_SUBSCRIPT_VAULT_ADDRESS / docs/redeploy-runbook.md). This source
 * is the V3 implementation candidate. Do NOT upgrade the live proxy until the storage
 * layout check, the Foundry + Hardhat vault suites, and the implementation review pass —
 * see docs/vault-economics.md for the upgrade gate.
 *
 * Economic model (platform-fixed 2 USDC policy):
 *  - The standard commitment AND the maximum merchant-drawable exposure for every
 *    (user → merchant) relationship is STANDARD_COMMIT = 2 USDC per cycle. It is a
 *    platform constant: merchants cannot configure it, and a user depositing surplus
 *    never expands what the merchant can draw.
 *  - A user commits (escrows) USDC. Once the escrow reaches 2 USDC the service
 *    activates for the cycle (~30 days).
 *  - Only the authorized SubScript settlement keeper finalizes usage at cycle end.
 *    The draw is bounded by the exposure cap, the current escrow, and the accepted
 *    usage-ledger amount the keeper submits. Merchants have NO direct draw authority:
 *    their usage reports are evidence for the off-chain ledger, not contract authority.
 *  - Every unused unit returns to the user during settlement. The vault then goes
 *    inactive and needs a fresh commitment before service resumes.
 *  - An open user dispute blocks settlement (and reclaim) until the owner resolves it.
 *  - Merchant claims are charged the protocol's flat 1% treasury fee.
 *
 * Trust boundary:
 *  - On-chain escrow guarantees the merchant is paid up to min(escrow, 2 USDC).
 *    The protocol never creates debt or pulls from the user's main wallet.
 *  - The keeper's `amount` is the accepted off-chain usage ledger total. The contract
 *    cannot read PostgreSQL; it bounds the keeper instead of trusting it: at most
 *    2 USDC per cycle, at most the escrow, only in the settle window, never disputed.
 */
contract SubScriptVault is Initializable, UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuard, PausableUpgradeable {
    using SafeERC20 for IERC20;

    /* ──────────────────────────── State ──────────────────────────── */

    IERC20 public paymentToken; // USDC

    struct Vault {
        uint256 balance;     // escrowed USDC currently held
        uint256 owed;        // legacy/unused: no debt is ever created in this model
        uint64 cycleStart;   // unix seconds; start of the current paid cycle
        bool active;         // service usable: balance >= STANDARD_COMMIT
        uint64 lockedUntil;  // escrow is withdrawable only at/after this time (commit + cycle)
    }

    /* user => merchant => vault */
    mapping(address => mapping(address => Vault)) public vaults;

    /*
     * LEGACY SLOT — merchant-configured commitment, retired by the platform-fixed
     * 2 USDC policy. The mapping stays declared to preserve the UUPS storage layout;
     * nothing reads or writes it anymore.
     */
    /// @custom:oz-renamed-from requiredCommit
    mapping(address => uint256) private legacyRequiredCommit;

    /* merchant => claimable settlement (pull-payment ledger, like SubScriptRouter) */
    mapping(address => uint256) public merchantClaimable;

    /* addresses allowed to settle usage (SubScript settlement keeper) */
    mapping(address => bool) public authorizedDrawers;

    /* cycle length in seconds (default 30 days) */
    uint64 public cycleLength;

    /*
     * Treasury receiving the flat merchant fee.
     * APPEND-ONLY: SubScriptVault is UUPS upgradeable; never reorder prior fields.
     */
    address public treasury;

    /*
     * V3 (append-only): open user disputes. While true, neither settlement nor reclaim
     * can move the escrow; only the owner resolves.
     */
    mapping(address => mapping(address => bool)) public disputeHold;

    uint256 public constant PROTOCOL_FEE_BPS = 100; // 1%
    uint256 public constant BPS_DENOMINATOR = 10_000;

    /*
     * Platform-fixed standard commitment and per-cycle merchant exposure cap:
     * 2 USDC (2,000,000 micro-USDC at 6 decimals). Not merchant-configurable.
     */
    uint256 public constant STANDARD_COMMIT = 2_000_000;

    /*
     * Liveness grace after a cycle matures. If the keeper never settles a matured cycle
     * within lockedUntil + RECLAIM_GRACE, the user may reclaim their full escrow. The
     * keeper still had the entire cycle plus this grace to settle usage, so pay-after-
     * service is preserved; this only removes the permanent-lock risk if it goes dark.
     */
    uint64 public constant RECLAIM_GRACE = 7 days;

    /* ──────────────────────────── Events ─────────────────────────── */

    event Committed(address indexed user, address indexed merchant, uint256 amount, uint256 balance, uint256 owedCleared, bool active);
    event UsageDrawn(address indexed user, address indexed merchant, uint256 requested, uint256 drawn, uint256 owed, bool active);
    event SurplusWithdrawn(address indexed user, address indexed merchant, uint256 amount, bool active);
    event EscrowReclaimed(address indexed user, address indexed merchant, uint256 amount);
    event MerchantClaimed(address indexed merchant, uint256 amount);
    event ProtocolFeePaid(address indexed merchant, address indexed treasury, uint256 amount);
    event AuthorizedDrawerSet(address indexed drawer, bool allowed);
    event CycleLengthSet(uint64 seconds_);
    event TreasurySet(address indexed treasury);
    event CycleSettled(
        address indexed user,
        address indexed merchant,
        uint256 requested,
        uint256 drawn,
        uint256 refunded
    );
    event DisputeRaised(address indexed user, address indexed merchant);
    event DisputeResolved(address indexed user, address indexed merchant, bool settlementReopened);

    /* ──────────────────────────── Init ───────────────────────────── */

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _paymentToken, address _owner) public initializer {
        __Ownable_init(_owner);
        __Pausable_init();
        require(_paymentToken != address(0), "token=0");
        paymentToken = IERC20(_paymentToken);
        cycleLength = 30 days;
        treasury = _owner;
    }

    /**
     * @notice Initializes treasury storage when upgrading an existing V1 proxy.
     * @dev Execute atomically through upgradeToAndCall to avoid a fee-free claim window.
     */
    function initializeV2(address _treasury) external reinitializer(2) onlyOwner {
        _setTreasury(_treasury);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    /* ──────────────────────────── User actions ───────────────────── */

    /**
     * @notice Deposit `amount` USDC into the (msg.sender, merchant) vault. The service
     *         activates for the cycle once escrow >= STANDARD_COMMIT (2 USDC). The escrow
     *         is locked from withdrawal for one cycle (~30 days) from a fresh activation.
     *         Caller must approve `amount` to this contract first. No debt is ever
     *         created, and surplus above 2 USDC never raises the merchant's exposure.
     */
    function commit(address merchant, uint256 amount) external nonReentrant whenNotPaused {
        require(merchant != address(0), "merchant=0");
        require(amount > 0, "amount=0");

        paymentToken.safeTransferFrom(msg.sender, address(this), amount);

        Vault storage v = vaults[msg.sender][merchant];

        // Legacy safety: clear any pre-existing owed (none is created in this model).
        uint256 owedCleared = 0;
        if (v.owed > 0) {
            owedCleared = amount >= v.owed ? v.owed : amount;
            v.owed -= owedCleared;
            merchantClaimable[merchant] += owedCleared;
            amount -= owedCleared;
        }

        bool wasActive = v.active;
        v.balance += amount;

        if (v.owed == 0 && v.balance >= STANDARD_COMMIT) {
            v.active = true;
            // Start the cycle + lock only on a fresh activation, not on a top-up.
            if (!wasActive) {
                v.cycleStart = uint64(block.timestamp);
                v.lockedUntil = uint64(block.timestamp + cycleLength);
            }
        }

        emit Committed(msg.sender, merchant, amount, v.balance, owedCleared, v.active);
    }

    /**
     * @notice Withdraw unused escrow back to the user's wallet. Only possible while the
     *         vault is inactive — i.e. before a commit ever activated it, or after the
     *         cycle was settled/closed — and once the lock has elapsed. Re-committing at
     *         least the standard amount is what reactivates the service.
     */
    function withdrawSurplus(address merchant, uint256 amount) external nonReentrant {
        Vault storage v = vaults[msg.sender][merchant];
        require(v.owed == 0, "settle owed first");
        require(block.timestamp >= v.lockedUntil, "locked");
        require(!v.active, "active cycle");
        require(amount > 0 && amount <= v.balance, "bad amount");

        v.balance -= amount;

        paymentToken.safeTransfer(msg.sender, amount);
        emit SurplusWithdrawn(msg.sender, merchant, amount, v.active);
    }

    /**
     * @notice Reclaim the full escrow when a matured cycle was never settled by the
     *         authorized keeper within the liveness grace. Unlike withdrawSurplus (which
     *         requires the vault to already be inactive), this is the user's escape hatch
     *         for an *active* vault whose keeper has gone dark, so escrow can never be
     *         permanently locked. Blocked while the user's own dispute is open — a dispute
     *         freezes the escrow for BOTH parties until the owner resolves it.
     */
    function reclaimAbandonedEscrow(address merchant) external nonReentrant {
        Vault storage v = vaults[msg.sender][merchant];
        require(v.active, "inactive");
        require(!disputeHold[msg.sender][merchant], "disputed");
        require(v.lockedUntil != 0 && block.timestamp >= uint256(v.lockedUntil) + RECLAIM_GRACE, "not abandoned");

        uint256 amount = v.balance;
        require(amount > 0, "nothing to reclaim");

        // Close the cycle before transferring. A fresh commit is required to use the service again.
        v.balance = 0;
        v.active = false;
        v.cycleStart = 0;
        v.lockedUntil = 0;

        paymentToken.safeTransfer(msg.sender, amount);
        emit EscrowReclaimed(msg.sender, merchant, amount);
    }

    /* ──────────────────────────── Disputes ───────────────────────── */

    /**
     * @notice The user contests this cycle's reported usage. While the dispute is open,
     *         neither keeper settlement nor user reclaim can move the escrow.
     */
    function raiseDispute(address merchant) external {
        Vault storage v = vaults[msg.sender][merchant];
        require(v.active, "inactive");
        require(!disputeHold[msg.sender][merchant], "already disputed");
        disputeHold[msg.sender][merchant] = true;
        emit DisputeRaised(msg.sender, merchant);
    }

    /**
     * @notice Owner resolves an open dispute. When `reopenSettlement` is true and the
     *         original settle window has already passed, a fresh window opens from now so
     *         the resolution outcome (a keeper draw bounded as always, or an eventual user
     *         reclaim) is actually reachable.
     */
    function resolveDispute(address user, address merchant, bool reopenSettlement) external onlyOwner {
        require(disputeHold[user][merchant], "no dispute");
        disputeHold[user][merchant] = false;
        Vault storage v = vaults[user][merchant];
        if (reopenSettlement && v.active && v.lockedUntil != 0
            && block.timestamp >= uint256(v.lockedUntil) + RECLAIM_GRACE) {
            v.lockedUntil = uint64(block.timestamp);
        }
        emit DisputeResolved(user, merchant, reopenSettlement);
    }

    /* ──────────────────────────── Settlement (keeper only) ───────── */

    /**
     * @notice The authorized SubScript settlement keeper finalizes a matured cycle.
     *         `amount` is the accepted off-chain usage-ledger total; the actual draw is
     *         bounded by the per-cycle exposure cap (2 USDC) and the current escrow.
     *         Merchants cannot call this — reports are evidence, not authority.
     */
    function drawUsageFor(address merchant, address user, uint256 amount) external nonReentrant whenNotPaused {
        require(authorizedDrawers[msg.sender], "not drawer");
        _draw(merchant, user, amount);
    }

    function _draw(address merchant, address user, uint256 amount) internal {
        Vault storage v = vaults[user][merchant];
        require(v.active, "inactive");
        require(!disputeHold[user][merchant], "disputed");
        require(v.lockedUntil != 0 && block.timestamp >= v.lockedUntil, "cycle not mature");
        require(block.timestamp < uint256(v.lockedUntil) + RECLAIM_GRACE, "reclaim window opened");

        // Never create debt, and never let a cycle draw exceed the platform exposure cap:
        // drawn = min(accepted ledger amount, escrow, 2 USDC). Surplus the user deposited
        // above the cap is theirs and is refunded, not drawable.
        uint256 exposureCap = STANDARD_COMMIT;
        uint256 drawable = v.balance < exposureCap ? v.balance : exposureCap;
        uint256 drawn = amount <= drawable ? amount : drawable;
        uint256 refunded = v.balance - drawn;

        // Close the cycle before either party receives funds. A fresh commit is required.
        v.balance = 0;
        v.active = false;
        v.cycleStart = 0;
        v.lockedUntil = 0;
        merchantClaimable[merchant] += drawn;

        if (refunded > 0) {
            paymentToken.safeTransfer(user, refunded);
        }

        emit UsageDrawn(user, merchant, amount, drawn, 0, false);
        emit CycleSettled(user, merchant, amount, drawn, refunded);
    }

    /* ──────────────────────────── Merchant settlement ────────────── */

    function merchantClaim() external nonReentrant whenNotPaused {
        uint256 grossAmount = merchantClaimable[msg.sender];
        require(grossAmount > 0, "nothing to claim");
        require(treasury != address(0), "treasury=0");

        uint256 fee = Math.mulDiv(grossAmount, PROTOCOL_FEE_BPS, BPS_DENOMINATOR);
        uint256 netAmount = grossAmount - fee;
        merchantClaimable[msg.sender] = 0;

        if (fee > 0) {
            paymentToken.safeTransfer(treasury, fee);
            emit ProtocolFeePaid(msg.sender, treasury, fee);
        }
        paymentToken.safeTransfer(msg.sender, netAmount);
        emit MerchantClaimed(msg.sender, netAmount);
    }

    /* ──────────────────────────── Views ──────────────────────────── */

    function getVault(address user, address merchant)
        external
        view
        returns (uint256 balance, uint256 owed, uint64 cycleStart, bool active, uint256 commitNeeded, uint64 lockedUntil)
    {
        Vault storage v = vaults[user][merchant];
        return (v.balance, v.owed, v.cycleStart, v.active, STANDARD_COMMIT, v.lockedUntil);
    }

    function isActive(address user, address merchant) external view returns (bool) {
        return vaults[user][merchant].active;
    }

    /* ──────────────────────────── Admin ──────────────────────────── */

    function setAuthorizedDrawer(address drawer, bool allowed) external onlyOwner {
        authorizedDrawers[drawer] = allowed;
        emit AuthorizedDrawerSet(drawer, allowed);
    }

    function setCycleLength(uint64 seconds_) external onlyOwner {
        require(seconds_ >= 1 days, "too short");
        cycleLength = seconds_;
        emit CycleLengthSet(seconds_);
    }

    function setTreasury(address _treasury) external onlyOwner {
        _setTreasury(_treasury);
    }

    function _setTreasury(address _treasury) internal {
        require(_treasury != address(0), "treasury=0");
        treasury = _treasury;
        emit TreasurySet(_treasury);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }
}
