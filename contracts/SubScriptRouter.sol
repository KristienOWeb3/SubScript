/* SPDX-License-Identifier: MIT */
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title SubScriptRouter
 * @author SubScript Protocol
 * @notice Payment router for merchant claimable settlement and batch distribution.
 *         Uses an internal pull-payment ledger with tier-gated payout rerouting.
 */
contract SubScriptRouter is Initializable, UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuard, PausableUpgradeable {
    using SafeERC20 for IERC20;

    /* ──────────────────────────── State ──────────────────────────── */

    /* The native stablecoin used (e.g. USDC) */
    IERC20 public paymentToken;

    /* Treasury wallet address receiving the 1% protocol fees */
    address public treasury;

    /* Secure internal pull-payment ledger mapping merchant => claimable USDC settlement */
    mapping(address => uint256) public merchantBalances;

    /* Subscription tier for merchants (0 = Standard, 1 = Premium) */
    mapping(address => uint8) public merchantTiers;

    /* Redirected fund payout address for premium merchants */
    mapping(address => address) public merchantPayoutDestination;

    /*
     * Sum of all outstanding merchantBalances. Backs the rescueERC20 surplus check so the
     * owner can never sweep paymentToken that merchants are owed.
     * APPEND-ONLY: this contract is UUPS upgradeable; never reorder or remove prior fields.
     * Deposits made before the upgrade that introduced this counter are not included, so it
     * may under-count legacy liabilities — the surplus check is therefore conservative only
     * for post-upgrade funds.
     */
    uint256 public totalMerchantLiabilities;

    /* ──────────────────────────── Events ─────────────────────────── */

    event Withdraw(address indexed merchant, uint256 amount);

    /* Emitted alongside Withdraw so rerouted premium payouts keep the merchant identity
       (Withdraw indexes the merchant; this event additionally records the destination). */
    event PayoutDelivered(
        address indexed merchant,
        address indexed destination,
        uint256 netAmount,
        uint256 fee
    );

    event DepositWithMemo(
        address indexed payer,
        address indexed merchant,
        uint256 amount,
        string memo
    );

    event MerchantPayoutRerouted(
        address indexed merchant,
        address indexed oldDestination,
        address indexed newDestination
    );

    event ERC20Rescued(
        address indexed token,
        address indexed recipient,
        uint256 amount
    );

    event BatchPayoutExecuted(
        address indexed merchant,
        uint256 totalAmount,
        uint256 recipientCount
    );

    /* ─────────────────────────── Constructor / Initializer ─────────── */

    /** @custom:oz-upgrades-unsafe-allow constructor */
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initialize function for the upgradeable proxy.
     */
    function initialize(
        address _paymentToken,
        address _treasury,
        address _initialOwner
    ) external initializer {
        require(_paymentToken != address(0), "Invalid token address");
        require(_treasury != address(0), "Invalid treasury address");
        require(_initialOwner != address(0), "Invalid owner address");

        __Ownable_init(_initialOwner);
        __Pausable_init();

        paymentToken = IERC20(_paymentToken);
        treasury = _treasury;
    }

    /* ─────────────────────────── Admin Functions ─────────────────── */

    /**
     * @notice UUPS upgrade authorization check.
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    /**
     * @notice Update treasury address.
     */
    function setTreasury(address _newTreasury) external onlyOwner {
        require(_newTreasury != address(0), "Invalid new treasury");
        treasury = _newTreasury;
    }

    /**
     * @notice Provision merchant tiers (0 = Standard, 1 = Premium).
     */
    function setMerchantTier(address _merchant, uint8 _tier) external onlyOwner {
        require(_merchant != address(0), "Invalid merchant address");
        merchantTiers[_merchant] = _tier;
    }

    /**
     * @notice Toggle emergency pause
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Toggle emergency unpause
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Recover unrelated ERC20 tokens accidentally sent to the contract.
     * @dev The payment token is intentionally never rescuable. The liability counter was added
     *      after the first deployment and cannot prove that legacy merchant balances are covered;
     *      treating an apparent surplus as owner funds could therefore steal merchant settlement.
     */
    function rescueERC20(address token, address to, uint256 amount) external onlyOwner {
        require(token != address(0), "Invalid token address");
        require(to != address(0), "Invalid receiver address");
        require(amount > 0, "Amount must be greater than zero");

        require(token != address(paymentToken), "Payment token rescue disabled");
        uint256 balance = IERC20(token).balanceOf(address(this));
        require(amount <= balance, "Insufficient balance");

        IERC20(token).safeTransfer(to, amount);
        emit ERC20Rescued(token, to, amount);
    }

    /* ─────────────────────────── Core Functions ───────────────────── */

    /**
     * @notice Configure a new payout destination address for premium merchants.
     */
    function configurePayoutDestination(address _newDestination) external nonReentrant whenNotPaused {
        require(merchantTiers[msg.sender] >= 1, "Only Premium tier can reroute");
        require(_newDestination != address(0), "Invalid destination address");

        address oldDestination = merchantPayoutDestination[msg.sender];
        merchantPayoutDestination[msg.sender] = _newDestination;

        emit MerchantPayoutRerouted(msg.sender, oldDestination, _newDestination);
    }

    /**
     * @notice Route funds for a merchant and credit their claimable settlement balance.
     */
    function depositForMerchant(
        address _merchant,
        uint256 _amount,
        string calldata _memo
    ) external nonReentrant whenNotPaused {
        require(_merchant != address(0), "Invalid merchant address");
        require(_amount > 0, "Amount must be positive");

        paymentToken.safeTransferFrom(msg.sender, address(this), _amount);
        merchantBalances[_merchant] += _amount;
        totalMerchantLiabilities += _amount;

        emit DepositWithMemo(msg.sender, _merchant, _amount, _memo);
    }

    /**
     * @notice Safe, non-gated withdrawal function.
     *         Withdraws caller's claimable settlement, deducting 1% protocol fee to Treasury.
     */
    function withdraw() external nonReentrant whenNotPaused {
        uint256 balance = merchantBalances[msg.sender];
        require(balance > 0, "No balance to withdraw");
        require(balance >= 1000000, "Minimum withdrawal is 1 USDC");

        merchantBalances[msg.sender] = 0;
        _reduceLiabilities(balance);

        uint256 fee = balance / 100; // 1% fee
        uint256 netAmount = balance - fee;

        address targetPayout = msg.sender;
        if (merchantTiers[msg.sender] >= 1 && merchantPayoutDestination[msg.sender] != address(0)) {
            targetPayout = merchantPayoutDestination[msg.sender];
        }

        if (fee > 0) {
            paymentToken.safeTransfer(treasury, fee);
        }
        paymentToken.safeTransfer(targetPayout, netAmount);

        emit Withdraw(msg.sender, netAmount);
        emit PayoutDelivered(msg.sender, targetPayout, netAmount, fee);
    }

    /**
     * @notice Safe withdrawal function to a specified target recipient.
     *         Withdraws caller's claimable settlement, deducting 1% protocol fee to Treasury.
     */
    function withdrawTo(address _recipient) external nonReentrant whenNotPaused {
        /* Rerouting settlement to a different address is a Premium-tier feature, consistent with
           configurePayoutDestination. Standard-tier merchants withdraw to themselves via withdraw(). */
        require(merchantTiers[msg.sender] >= 1, "Only Premium tier can withdraw to a custom address");
        uint256 balance = merchantBalances[msg.sender];
        require(balance > 0, "No balance to withdraw");
        require(balance >= 1000000, "Minimum withdrawal is 1 USDC");
        require(_recipient != address(0), "Invalid recipient address");

        merchantBalances[msg.sender] = 0;
        _reduceLiabilities(balance);

        uint256 fee = balance / 100; // 1% fee
        uint256 netAmount = balance - fee;

        if (fee > 0) {
            paymentToken.safeTransfer(treasury, fee);
        }
        paymentToken.safeTransfer(_recipient, netAmount);

        emit Withdraw(msg.sender, netAmount);
        emit PayoutDelivered(msg.sender, _recipient, netAmount, fee);
    }

    /* Clamped decrement: balances deposited before the liability counter existed are not
       counted in totalMerchantLiabilities, so their withdrawal must not underflow it. */
    function _reduceLiabilities(uint256 amount) internal {
        uint256 liabilities = totalMerchantLiabilities;
        totalMerchantLiabilities = liabilities >= amount ? liabilities - amount : 0;
    }


    /**
     * @notice Admin-gated transient batch payout execution.
     *         Pulls total amount from caller and distributes to recipients in a single transaction.
     */
    function executeBatchPayout(
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external onlyOwner nonReentrant whenNotPaused {
        require(recipients.length == amounts.length, "Array length mismatch");
        require(recipients.length > 0, "Empty arrays");
        require(recipients.length < 255, "Array size exceeds limit");

        uint256 totalAmount = 0;
        for (uint256 i = 0; i < amounts.length; i++) {
            require(recipients[i] != address(0), "Invalid recipient address");
            require(amounts[i] > 0, "Amount must be positive");
            totalAmount += amounts[i];
        }

        /* Pull total amount from owner (admin wallet) directly into the router */
        paymentToken.safeTransferFrom(msg.sender, address(this), totalAmount);

        /* Route directly to recipients instantly (stateless router) */
        for (uint256 i = 0; i < recipients.length; i++) {
            paymentToken.safeTransfer(recipients[i], amounts[i]);
        }

        emit BatchPayoutExecuted(msg.sender, totalAmount, recipients.length);
    }
}
