/* SPDX-License-Identifier: MIT */
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title SubScript
 * @author SubScript Protocol
 * @notice Decentralized subscription management protocol for the Arc Network.
 *         Enables non-custodial, recurring ERC-20 payments via keeper-triggered
 *         executions. Subscribers approve a token allowance and define payment
 *         terms; keepers call executePayment when a subscription is due.
 *
 * @dev The contract stores subscriptions in a mapping keyed by sequential IDs.
 *      Bitmap-based idempotency is used to track recurring billing sequences.
 */
contract SubScript is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /* ──────────────────────────── Types ──────────────────────────── */

    struct Subscription {
        address subscriber;   /* The payer */
        address merchant;     /* The payment recipient */
        uint256 amount;       /* Token amount per period (smallest unit) */
        uint256 period;       /* Interval in seconds between payments */
        uint256 nextPayment;  /* Unix timestamp of the next due payment */
        bool    isActive;     /* Whether the subscription is live */
    }

    /* ──────────────────────────── State ──────────────────────────── */

    /* The ERC-20 token used for all subscriptions (e.g. USDC) */
    IERC20 public immutable paymentToken;

    /* Auto-incrementing subscription ID counter; starts at 1 */
    uint256 public nextSubscriptionId = 1;

    /* Mapping from subscription ID → Subscription data */
    mapping(uint256 => Subscription) public subscriptions;

    /* Densely packed execution bitmaps: subId => (wordIndex => word) */
    mapping(uint256 => mapping(uint256 => uint256)) public executionBitmaps;

    /* ──────────────────────────── Events ─────────────────────────── */

    event SubscriptionCreated(
        uint256 indexed subId,
        address indexed subscriber,
        address indexed merchant,
        uint256 amount,
        uint256 period
    );

    event PaymentExecuted(
        uint256 indexed subId,
        address indexed subscriber,
        address indexed merchant,
        uint256 amount,
        uint256 sequenceId,
        uint256 timestamp
    );

    event SubscriptionCancelled(uint256 indexed subId, address cancelledBy);

    event SubscriptionModified(
        uint256 indexed subId,
        uint256 newAmount,
        uint256 newPeriod
    );

    /* ──────────────────────────── Errors ─────────────────────────── */

    error InvalidAddress();
    error InvalidAmount();
    error InvalidPeriod();
    error SubscriptionNotActive(uint256 subId);
    error PaymentNotDue(uint256 subId, uint256 expectedPayment, uint256 currentTime);
    error PaymentAlreadyExecuted(uint256 subId, uint256 sequenceId);
    error NotAuthorized(uint256 subId);

    /* ─────────────────────── Constructor ─────────────────────────── */

    /**
     * @param _paymentToken Address of the ERC-20 token used for payments.
     */
    constructor(address _paymentToken) {
        if (_paymentToken == address(0)) revert InvalidAddress();
        paymentToken = IERC20(_paymentToken);
    }

    /* ──────────────────── External Functions ─────────────────────── */

    /**
     * @notice Create a new recurring subscription.
     * @param _merchant Recipient of recurring payments.
     * @param _amount   Amount of `paymentToken` per period (smallest unit).
     * @param _period   Interval in seconds between payments.
     * @return subId    The newly created subscription's ID.
     */
    function createSubscription(
        address _merchant,
        uint256 _amount,
        uint256 _period
    ) external nonReentrant returns (uint256 subId) {
        if (_merchant == address(0)) revert InvalidAddress();
        if (_amount == 0) revert InvalidAmount();
        if (_period == 0) revert InvalidPeriod();

        subId = nextSubscriptionId++;

        subscriptions[subId] = Subscription({
            subscriber:  msg.sender,
            merchant:    _merchant,
            amount:      _amount,
            period:      _period,
            nextPayment: block.timestamp + _period,
            isActive:    true
        });

        /* Mark sequence 0 as executed for the immediate payment */
        uint256 wordIndex = 0;
        uint256 bitPosition = 0;
        executionBitmaps[subId][wordIndex] = 1 << bitPosition;

        /* Take the first payment immediately */
        paymentToken.safeTransferFrom(msg.sender, _merchant, _amount);

        emit SubscriptionCreated(subId, msg.sender, _merchant, _amount, _period);
        emit PaymentExecuted(subId, msg.sender, _merchant, _amount, 0, block.timestamp);
    }

    /**
     * @notice Execute a due payment for a subscription using bitmap idempotency.
     * @param _subId      The subscription ID to process.
     * @param _sequenceId The billing sequence number (billing cycle index).
     */
    function executePayment(uint256 _subId, uint256 _sequenceId) external nonReentrant {
        Subscription storage sub = subscriptions[_subId];

        if (!sub.isActive) revert SubscriptionNotActive(_subId);
        
        /* Check if sequence already executed */
        if (isSequenceExecuted(_subId, _sequenceId)) {
            revert PaymentAlreadyExecuted(_subId, _sequenceId);
        }

        /* Verify payment is due */
        uint256 expectedPaymentTime = sub.nextPayment + ((_sequenceId - 1) * sub.period);
        if (block.timestamp < expectedPaymentTime) {
            revert PaymentNotDue(_subId, expectedPaymentTime, block.timestamp);
        }

        /* Mark sequence as executed before transfer (Checks-Effects-Interactions) */
        _setSequenceExecuted(_subId, _sequenceId);

        paymentToken.safeTransferFrom(sub.subscriber, sub.merchant, sub.amount);

        emit PaymentExecuted(
            _subId,
            sub.subscriber,
            sub.merchant,
            sub.amount,
            _sequenceId,
            block.timestamp
        );
    }

    /**
     * @notice Cancel an active subscription.
     * @param _subId The subscription ID to cancel.
     */
    function cancelSubscription(uint256 _subId) external nonReentrant {
        Subscription storage sub = subscriptions[_subId];

        if (!sub.isActive) revert SubscriptionNotActive(_subId);
        if (msg.sender != sub.subscriber && msg.sender != sub.merchant) {
            revert NotAuthorized(_subId);
        }

        sub.isActive = false;

        emit SubscriptionCancelled(_subId, msg.sender);
    }

    /**
     * @notice Modify the amount and/or period of an active subscription.
     * @param _subId     The subscription ID to modify.
     * @param _newAmount New payment amount (must be > 0).
     * @param _newPeriod New interval in seconds (must be > 0).
     */
    function modifySubscription(
        uint256 _subId,
        uint256 _newAmount,
        uint256 _newPeriod
    ) external nonReentrant {
        Subscription storage sub = subscriptions[_subId];

        if (!sub.isActive) revert SubscriptionNotActive(_subId);
        if (msg.sender != sub.subscriber) revert NotAuthorized(_subId);
        if (_newAmount == 0) revert InvalidAmount();
        if (_newPeriod == 0) revert InvalidPeriod();

        sub.amount = _newAmount;
        sub.period = _newPeriod;

        emit SubscriptionModified(_subId, _newAmount, _newPeriod);
    }

    /* ──────────────────── View Helpers ───────────────────────────── */

    /**
     * @notice Check whether a subscription sequence has been executed.
     */
    function isSequenceExecuted(uint256 _subId, uint256 _sequenceId) public view returns (bool) {
        uint256 wordIndex = _sequenceId / 256;
        uint256 bitPosition = _sequenceId % 256;
        uint256 word = executionBitmaps[_subId][wordIndex];
        return (word & (1 << bitPosition)) != 0;
    }

    /**
     * @notice Check whether a subscription's payment is currently due.
     */
    function isPaymentDue(uint256 _subId, uint256 _sequenceId) external view returns (bool) {
        Subscription storage sub = subscriptions[_subId];
        if (!sub.isActive) return false;
        if (isSequenceExecuted(_subId, _sequenceId)) return false;

        uint256 expectedPaymentTime = sub.nextPayment + ((_sequenceId - 1) * sub.period);
        return block.timestamp >= expectedPaymentTime;
    }

    /* ────────────────── Keeper Compatibility ─────────────────────── */

    /**
     * @notice Chainlink Automation compatible checkUpkeep helper.
     */
    function checkUpkeep(bytes calldata checkData) external view returns (bool upkeepNeeded, bytes memory performData) {
        (uint256 subId, uint256 sequenceId) = abi.decode(checkData, (uint256, uint256));
        Subscription storage sub = subscriptions[subId];
        
        if (!sub.isActive || isSequenceExecuted(subId, sequenceId)) {
            return (false, checkData);
        }

        uint256 expectedPaymentTime = sub.nextPayment + ((sequenceId - 1) * sub.period);
        upkeepNeeded = block.timestamp >= expectedPaymentTime;
        performData = checkData;
    }

    /**
     * @notice Chainlink Automation compatible performUpkeep execution.
     */
    function performUpkeep(bytes calldata performData) external {
        (uint256 subId, uint256 sequenceId) = abi.decode(performData, (uint256, uint256));
        this.executePayment(subId, sequenceId);
    }

    /* ────────────────── Internal Helpers ─────────────────────────── */

    function _setSequenceExecuted(uint256 _subId, uint256 _sequenceId) internal {
        uint256 wordIndex = _sequenceId / 256;
        uint256 bitPosition = _sequenceId % 256;
        uint256 word = executionBitmaps[_subId][wordIndex];
        executionBitmaps[_subId][wordIndex] = word | (1 << bitPosition);
    }
}
