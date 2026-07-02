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
 * DRAFT — for review. Not deployed, not audited. See docs/vault-economics.md.
 *
 * Model:
 *  - A merchant sets the commit amount required to use their metered service.
 *  - A user commits (escrows) USDC. While the vault is active, the merchant renders
 *    the service for the cycle (~30 days).
 *  - Only at cycle end, the merchant (or an authorized SubScript drawer) settles the
 *    period's usage cost from escrow. Usage is capped at the committed balance.
 *  - Every unused unit is returned to the user during settlement. The vault is then
 *    inactive and must receive a fresh minimum commitment before service resumes.
 *  - Merchant claims are charged the protocol's flat 1% treasury fee.
 *
 * Trust notes:
 *  - On-chain escrow guarantees the merchant is paid up to the committed balance.
 *    The protocol never creates debt or pulls from the user's main wallet.
 *  - `drawUsage` trusts the merchant's reported amount. SubScript reports usage off
 *    chain; this contract only enforces the escrow accounting and gating.
 */
contract SubScriptVault is Initializable, UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuard, PausableUpgradeable {
    using SafeERC20 for IERC20;

    /* ──────────────────────────── State ──────────────────────────── */

    IERC20 public paymentToken; // USDC

    struct Vault {
        uint256 balance;     // escrowed USDC currently held
        uint256 owed;        // legacy/unused: no debt is ever created in this model
        uint64 cycleStart;   // unix seconds; start of the current paid cycle
        bool active;         // service usable: balance >= requiredCommit
        uint64 lockedUntil;  // escrow is withdrawable only at/after this time (commit + cycle)
    }

    /* user => merchant => vault */
    mapping(address => mapping(address => Vault)) public vaults;

    /* merchant => USDC required to commit before their service activates */
    mapping(address => uint256) public requiredCommit;

    /* merchant => claimable settlement (pull-payment ledger, like SubScriptRouter) */
    mapping(address => uint256) public merchantClaimable;

    /* addresses allowed to draw on a merchant's behalf (SubScript keeper) */
    mapping(address => bool) public authorizedDrawers;

    /* cycle length in seconds (default 30 days) */
    uint64 public cycleLength;

    /*
     * Treasury receiving the flat merchant fee.
     * APPEND-ONLY: SubScriptVault is UUPS upgradeable; never reorder prior fields.
     */
    address public treasury;

    uint256 public constant PROTOCOL_FEE_BPS = 100; // 1%
    uint256 public constant BPS_DENOMINATOR = 10_000;

    /*
     * Liveness grace after a cycle matures. If the merchant/keeper never settles a matured
     * cycle within lockedUntil + RECLAIM_GRACE, the user may reclaim their full escrow. The
     * merchant still had the entire cycle plus this grace to draw usage, so pay-after-service
     * is preserved; this only removes the permanent-lock risk if a drawer goes dark.
     */
    uint64 public constant RECLAIM_GRACE = 7 days;

    /* ──────────────────────────── Events ─────────────────────────── */

    event RequiredCommitSet(address indexed merchant, uint256 amount);
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

    /* ──────────────────────────── Merchant config ────────────────── */

    /// @notice Merchant sets the commit required to use their metered service.
    function setRequiredCommit(uint256 amount) external {
        requiredCommit[msg.sender] = amount;
        emit RequiredCommitSet(msg.sender, amount);
    }

    /* ──────────────────────────── User actions ───────────────────── */

    /**
     * @notice Deposit `amount` USDC into the (msg.sender, merchant) vault and activate the
     *         service for the cycle once escrow >= requiredCommit. The escrow is locked from
     *         withdrawal for one cycle (~30 days) from a fresh commit. Caller must approve
     *         `amount` to this contract first. No debt is ever created — usage is capped at
     *         the committed escrow off-chain.
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

        if (v.owed == 0 && v.balance >= requiredCommit[merchant]) {
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
     * @notice Withdraw unused escrow back to the user's wallet once the lock has elapsed
     *         (one cycle / ~30 days after the commit). Dropping below the required commit
     *         deactivates the vault — the user must re-commit to use the service again.
     */
    function withdrawSurplus(address merchant, uint256 amount) external nonReentrant {
        Vault storage v = vaults[msg.sender][merchant];
        require(v.owed == 0, "settle owed first");
        require(block.timestamp >= v.lockedUntil, "locked");
        require(!v.active, "active cycle");
        require(amount > 0 && amount <= v.balance, "bad amount");

        v.balance -= amount;
        if (v.balance < requiredCommit[merchant]) {
            v.active = false;
        }

        paymentToken.safeTransfer(msg.sender, amount);
        emit SurplusWithdrawn(msg.sender, merchant, amount, v.active);
    }

    /**
     * @notice Reclaim the full escrow when a matured cycle was never settled by the merchant
     *         or an authorized drawer within the liveness grace. Unlike withdrawSurplus (which
     *         requires the vault to already be inactive), this is the user's escape hatch for an
     *         *active* vault whose drawer has gone dark, so escrow can never be permanently locked.
     */
    function reclaimAbandonedEscrow(address merchant) external nonReentrant {
        Vault storage v = vaults[msg.sender][merchant];
        require(v.active, "inactive");
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

    /* ──────────────────────────── Draw (cycle settlement) ────────── */

    /// @notice Merchant draws this cycle's usage cost from a user's vault.
    function drawUsage(address user, uint256 amount) external nonReentrant {
        _draw(msg.sender, user, amount);
    }

    /// @notice SubScript keeper draws on a merchant's behalf at cycle end.
    function drawUsageFor(address merchant, address user, uint256 amount) external nonReentrant {
        require(authorizedDrawers[msg.sender], "not drawer");
        _draw(merchant, user, amount);
    }

    function _draw(address merchant, address user, uint256 amount) internal {
        Vault storage v = vaults[user][merchant];
        require(v.active, "inactive");
        require(v.lockedUntil != 0 && block.timestamp >= v.lockedUntil, "cycle not mature");

        // Never create debt: the merchant can only draw up to the escrowed balance.
        // Usage is gated off-chain so it should not exceed the commit in the first place.
        uint256 drawn = amount <= v.balance ? amount : v.balance;
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

    function merchantClaim() external nonReentrant {
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
        return (v.balance, v.owed, v.cycleStart, v.active, requiredCommit[merchant], v.lockedUntil);
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
