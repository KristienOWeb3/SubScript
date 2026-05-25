// SPDX-License-Identifier: MIT
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
 * @dev The contract stores subscriptions in a mapping keyed by sequential IDs
 *      starting at 1.  The return order of the `subscriptions` mapping matches
 *      the ABI already consumed by the keeper bot:
 *        (subscriber, merchant, amount, period, nextPayment, isActive)
 */
contract SubScript is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ──────────────────────────── Types ────────────────────────────

    struct Subscription {
        address subscriber;   // The payer
        address merchant;     // The payment recipient
        uint256 amount;       // Token amount per period (smallest unit)
        uint256 period;       // Interval in seconds between payments
        uint256 nextPayment;  // Unix timestamp of the next due payment
        bool    isActive;     // Whether the subscription is live
    }

    // ──────────────────────────── State ────────────────────────────

    /// @notice The ERC-20 token used for all subscriptions (e.g. USDC).
    IERC20 public immutable paymentToken;

    /// @notice Auto-incrementing subscription ID counter; starts at 1.
    uint256 public nextSubscriptionId = 1;

    /// @notice Mapping from subscription ID → Subscription data.
    mapping(uint256 => Subscription) public subscriptions;

    // ──────────────────────────── Events ───────────────────────────

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
        uint256 timestamp
    );

    event SubscriptionCancelled(uint256 indexed subId, address cancelledBy);

    event SubscriptionModified(
        uint256 indexed subId,
        uint256 newAmount,
        uint256 newPeriod
    );

    // ──────────────────────────── Errors ───────────────────────────

    error InvalidAddress();
    error InvalidAmount();
    error InvalidPeriod();
    error SubscriptionNotActive(uint256 subId);
    error PaymentNotDue(uint256 subId, uint256 nextPayment, uint256 currentTime);
    error NotAuthorized(uint256 subId);

    // ─────────────────────── Constructor ───────────────────────────

    /**
     * @param _paymentToken Address of the ERC-20 token used for payments.
     */
    constructor(address _paymentToken) {
        if (_paymentToken == address(0)) revert InvalidAddress();
        paymentToken = IERC20(_paymentToken);
    }

    // ──────────────────── External Functions ───────────────────────

    /**
     * @notice Create a new recurring subscription.
     * @dev The subscriber must have previously approved this contract for
     *      at least `_amount` of `paymentToken`. The first payment is taken
     *      immediately upon creation.
     * @param _merchant Recipient of recurring payments.
     * @param _amount   Amount of `paymentToken` per period (smallest unit).
     * @param _period   Interval in seconds between payments (e.g. 2592000 for ~30 days).
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

        // Take the first payment immediately.
        paymentToken.safeTransferFrom(msg.sender, _merchant, _amount);

        emit SubscriptionCreated(subId, msg.sender, _merchant, _amount, _period);
        emit PaymentExecuted(subId, msg.sender, _merchant, _amount, block.timestamp);
    }

    /**
     * @notice Execute a due payment for a subscription.
     * @dev Callable by anyone (keeper / relayer). Reverts if the payment
     *      is not yet due or the subscription is inactive. The subscriber
     *      must maintain sufficient balance and allowance.
     * @param _subId The subscription ID to process.
     */
    function executePayment(uint256 _subId) external nonReentrant {
        Subscription storage sub = subscriptions[_subId];

        if (!sub.isActive) revert SubscriptionNotActive(_subId);
        if (block.timestamp < sub.nextPayment) {
            revert PaymentNotDue(_subId, sub.nextPayment, block.timestamp);
        }

        // Advance the due date *before* the transfer (checks-effects-interactions).
        sub.nextPayment += sub.period;

        paymentToken.safeTransferFrom(sub.subscriber, sub.merchant, sub.amount);

        emit PaymentExecuted(
            _subId,
            sub.subscriber,
            sub.merchant,
            sub.amount,
            block.timestamp
        );
    }

    /**
     * @notice Cancel an active subscription.
     * @dev Only the subscriber or the merchant may cancel.
     * @param _subId The subscription ID to cancel.
     */
    function cancelSubscription(uint256 _subId) external {
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
     * @dev Only the subscriber may modify. Changes take effect from the
     *      next payment cycle (nextPayment is not altered here).
     * @param _subId     The subscription ID to modify.
     * @param _newAmount New payment amount (must be > 0).
     * @param _newPeriod New interval in seconds (must be > 0).
     */
    function modifySubscription(
        uint256 _subId,
        uint256 _newAmount,
        uint256 _newPeriod
    ) external {
        Subscription storage sub = subscriptions[_subId];

        if (!sub.isActive) revert SubscriptionNotActive(_subId);
        if (msg.sender != sub.subscriber) revert NotAuthorized(_subId);
        if (_newAmount == 0) revert InvalidAmount();
        if (_newPeriod == 0) revert InvalidPeriod();

        sub.amount = _newAmount;
        sub.period = _newPeriod;

        emit SubscriptionModified(_subId, _newAmount, _newPeriod);
    }

    // ──────────────────── View Helpers ─────────────────────────────

    /**
     * @notice Check whether a subscription's payment is currently due.
     * @param _subId The subscription ID to check.
     * @return True if the subscription is active and the current time ≥ nextPayment.
     */
    function isPaymentDue(uint256 _subId) external view returns (bool) {
        Subscription storage sub = subscriptions[_subId];
        return sub.isActive && block.timestamp >= sub.nextPayment;
    }
}
