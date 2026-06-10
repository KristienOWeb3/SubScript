/* SPDX-License-Identifier: MIT */
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IStableFX.sol";

/*
 * @title SubScriptPSA
 * @author SubScript Protocol
 * @notice Decentralized subscription management protocol for the Arc Network.
 *         Enables non-custodial, recurring ERC-20 payments via keeper-triggered
 *         executions with native multi-currency StableFX swap routing.
 */
contract SubScriptPSA is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /* ──────────────────────────── Types ──────────────────────────── */

    struct Authorization {
        address subscriber;     /* The payer */
        address merchant;       /* The payment recipient */
        uint256 amount;         /* Token amount per period (smallest unit) */
        uint256 period;         /* Interval in seconds between payments */
        uint256 nextPayment;    /* Unix timestamp of the next due payment */
        bool    isActive;       /* Whether the authorization is live */
        address settlementToken; /* The merchant's settlement token (e.g. EURC) */
        address paymentToken;    /* The subscriber's payment token (e.g. USDC) */
    }

    /* ──────────────────────────── State ──────────────────────────── */

    /* The default ERC-20 token used for compatibility */
    IERC20 public immutable paymentToken;

    /* The Arc Network native StableFX router for multi-currency swaps */
    IStableFX public immutable stableFXRouter;

    /* Auto-incrementing subscription ID counter; starts at 1 */
    uint256 public nextSubscriptionId = 1;

    /* Mapping from subscription ID → Authorization data */
    mapping(uint256 => Authorization) public subscriptions;

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

    /*
     * @param _paymentToken Address of the default ERC-20 token.
     * @param _stableFXRouter Address of the StableFX router contract.
     */
    constructor(address _paymentToken, address _stableFXRouter) {
        if (_paymentToken == address(0) || _stableFXRouter == address(0)) revert InvalidAddress();
        paymentToken = IERC20(_paymentToken);
        stableFXRouter = IStableFX(_stableFXRouter);
    }

    /* ──────────────────── External Functions ─────────────────────── */

    /*
     * @notice Legacy compatible function to create a new recurring subscription.
     */
    function createSubscription(
        address _merchant,
        uint256 _amount,
        uint256 _period
    ) external nonReentrant returns (uint256 subId) {
        return _createSubscription(
            _merchant,
            _amount,
            _period,
            address(paymentToken),
            address(paymentToken)
        );
    }

    /*
     * @notice Overloaded function to create a new recurring subscription with token specifications.
     */
    function createSubscription(
        address _merchant,
        uint256 _amount,
        uint256 _period,
        address _settlementToken,
        address _paymentToken
    ) public nonReentrant returns (uint256 subId) {
        return _createSubscription(_merchant, _amount, _period, _settlementToken, _paymentToken);
    }

    /*
     * @notice Internal helper to create a new recurring subscription.
     */
    function _createSubscription(
        address _merchant,
        uint256 _amount,
        uint256 _period,
        address _settlementToken,
        address _paymentToken
    ) internal returns (uint256 subId) {
        if (_merchant == address(0) || _settlementToken == address(0) || _paymentToken == address(0)) revert InvalidAddress();
        if (_amount == 0) revert InvalidAmount();
        if (_period == 0) revert InvalidPeriod();

        subId = nextSubscriptionId++;

        subscriptions[subId] = Authorization({
            subscriber:  msg.sender,
            merchant:    _merchant,
            amount:      _amount,
            period:      _period,
            nextPayment: block.timestamp + _period,
            isActive:    true,
            settlementToken: _settlementToken,
            paymentToken: _paymentToken
        });

        /* Mark sequence 0 as executed for the immediate payment */
        uint256 wordIndex = 0;
        uint256 bitPosition = 0;
        executionBitmaps[subId][wordIndex] = 1 << bitPosition;

        /* Take the first payment immediately */
        if (_paymentToken != _settlementToken) {
            uint256 amountIn = stableFXRouter.getAmountIn(_paymentToken, _settlementToken, _amount);
            
            /* Pull paymentToken from subscriber to SubScriptPSA contract */
            IERC20(_paymentToken).safeTransferFrom(msg.sender, address(this), amountIn);
            
            /* Approve StableFX router to spend paymentToken */
            IERC20(_paymentToken).safeIncreaseAllowance(address(stableFXRouter), amountIn);
            
            /* Swap to settlementToken and send directly to merchant */
            stableFXRouter.swap(
                _paymentToken,
                _settlementToken,
                amountIn,
                _amount,
                _merchant
            );
        } else {
            IERC20(_paymentToken).safeTransferFrom(msg.sender, _merchant, _amount);
        }

        emit SubscriptionCreated(subId, msg.sender, _merchant, _amount, _period);
        emit PaymentExecuted(subId, msg.sender, _merchant, _amount, 0, block.timestamp);
    }

    /*
     * @notice Execute a due payment for a subscription using bitmap idempotency.
     */
    function executePayment(uint256 _subId, uint256 _sequenceId) external nonReentrant {
        Authorization storage sub = subscriptions[_subId];

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

        if (sub.paymentToken != sub.settlementToken) {
            uint256 amountIn = stableFXRouter.getAmountIn(sub.paymentToken, sub.settlementToken, sub.amount);
            
            /* Pull paymentToken from subscriber to SubScriptPSA contract */
            IERC20(sub.paymentToken).safeTransferFrom(sub.subscriber, address(this), amountIn);
            
            /* Approve StableFX router to spend paymentToken */
            IERC20(sub.paymentToken).safeIncreaseAllowance(address(stableFXRouter), amountIn);
            
            /* Swap to settlementToken and send directly to merchant */
            stableFXRouter.swap(
                sub.paymentToken,
                sub.settlementToken,
                amountIn,
                sub.amount,
                sub.merchant
            );
        } else {
            IERC20(sub.paymentToken).safeTransferFrom(sub.subscriber, sub.merchant, sub.amount);
        }

        emit PaymentExecuted(
            _subId,
            sub.subscriber,
            sub.merchant,
            sub.amount,
            _sequenceId,
            block.timestamp
        );
    }

    /*
     * @notice Cancel an active subscription.
     */
    function cancelSubscription(uint256 _subId) external nonReentrant {
        Authorization storage sub = subscriptions[_subId];

        if (!sub.isActive) revert SubscriptionNotActive(_subId);
        if (msg.sender != sub.subscriber && msg.sender != sub.merchant) {
            revert NotAuthorized(_subId);
        }

        sub.isActive = false;

        emit SubscriptionCancelled(_subId, msg.sender);
    }

    /*
     * @notice Modify the amount and/or period of an active subscription.
     */
    function modifySubscription(
        uint256 _subId,
        uint256 _newAmount,
        uint256 _newPeriod
    ) external nonReentrant {
        Authorization storage sub = subscriptions[_subId];

        if (!sub.isActive) revert SubscriptionNotActive(_subId);
        if (msg.sender != sub.subscriber) revert NotAuthorized(_subId);
        if (_newAmount == 0) revert InvalidAmount();
        if (_newPeriod == 0) revert InvalidPeriod();

        sub.amount = _newAmount;
        sub.period = _newPeriod;

        emit SubscriptionModified(_subId, _newAmount, _newPeriod);
    }

    /* ──────────────────── View Helpers ───────────────────────────── */

    /*
     * @notice Check whether a subscription sequence has been executed.
     */
    function isSequenceExecuted(uint256 _subId, uint256 _sequenceId) public view returns (bool) {
        uint256 wordIndex = _sequenceId / 256;
        uint256 bitPosition = _sequenceId % 256;
        uint256 word = executionBitmaps[_subId][wordIndex];
        return (word & (1 << bitPosition)) != 0;
    }

    /*
     * @notice Check whether a subscription's payment is currently due.
     */
    function isPaymentDue(uint256 _subId, uint256 _sequenceId) external view returns (bool) {
        Authorization storage sub = subscriptions[_subId];
        if (!sub.isActive) return false;
        if (isSequenceExecuted(_subId, _sequenceId)) return false;

        uint256 expectedPaymentTime = sub.nextPayment + ((_sequenceId - 1) * sub.period);
        return block.timestamp >= expectedPaymentTime;
    }

    /* ────────────────── Keeper Compatibility ─────────────────────── */

    /*
     * @notice Chainlink Automation compatible checkUpkeep helper.
     */
    function checkUpkeep(bytes calldata checkData) external view returns (bool upkeepNeeded, bytes memory performData) {
        (uint256 subId, uint256 sequenceId) = abi.decode(checkData, (uint256, uint256));
        Authorization storage sub = subscriptions[subId];
        
        if (!sub.isActive || isSequenceExecuted(subId, sequenceId)) {
            return (false, checkData);
        }

        uint256 expectedPaymentTime = sub.nextPayment + ((sequenceId - 1) * sub.period);
        upkeepNeeded = block.timestamp >= expectedPaymentTime;
        performData = checkData;
    }

    /*
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
