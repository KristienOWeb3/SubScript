/* SPDX-License-Identifier: MIT */
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
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

    /* Treasury receiving the protocol's flat 1% merchant fee */
    address public immutable treasury;

    uint256 public constant PROTOCOL_FEE_BPS = 100;
    uint256 public constant BPS_DENOMINATOR = 10_000;

    /* Auto-incrementing subscription ID counter; starts at 1 */
    uint256 public nextSubscriptionId = 1;

    /* Mapping from subscription ID → Authorization data */
    mapping(uint256 => Authorization) public subscriptions;

    /* Exact plan authorization key → active subscription ID. Prevents a subscriber from
       accidentally creating the same merchant/amount/period/token subscription twice. */
    mapping(bytes32 => uint256) public activeSubscriptionByPlanKey;

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

    event ProtocolFeePaid(
        uint256 indexed subId,
        address indexed merchant,
        address indexed token,
        uint256 amount
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
    error PaymentWindowExpired(uint256 subId, uint256 sequenceId, uint256 windowEnd);
    error PaymentAlreadyExecuted(uint256 subId, uint256 sequenceId);
    error NotAuthorized(uint256 subId);
    error PlanReductionNotAllowed(uint256 subId);
    error DuplicateActiveSubscription(uint256 existingSubscriptionId);
    error InsufficientSwapOutput(uint256 expected, uint256 received);

    /* ─────────────────────── Constructor ─────────────────────────── */

    /*
     * @param _paymentToken Address of the default ERC-20 token.
     * @param _stableFXRouter Address of the StableFX router contract.
     * @param _treasury Address receiving the flat 1% merchant fee.
     */
    constructor(address _paymentToken, address _stableFXRouter, address _treasury) {
        if (
            _paymentToken == address(0)
                || _stableFXRouter == address(0)
                || _treasury == address(0)
        ) revert InvalidAddress();
        paymentToken = IERC20(_paymentToken);
        stableFXRouter = IStableFX(_stableFXRouter);
        treasury = _treasury;
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

        _assertNoActiveDuplicate(msg.sender, _merchant, _amount, _period, _settlementToken, _paymentToken, 0);

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
        _indexActiveSubscription(
            subId,
            msg.sender,
            _merchant,
            _amount,
            _period,
            _settlementToken,
            _paymentToken
        );

        /* Mark sequence 0 as executed for the immediate payment */
        uint256 wordIndex = 0;
        uint256 bitPosition = 0;
        executionBitmaps[subId][wordIndex] = 1 << bitPosition;

        _collectAndDistributePayment(
            subId,
            msg.sender,
            _merchant,
            _settlementToken,
            _paymentToken,
            _amount
        );

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

        /* A sequence is chargeable only during its own billing window: once the next sequence
           becomes due, the older one expires. This means a lapsed-but-uncancelled subscriber can
           never be batch back-charged for missed periods, and a modifySubscription re-timing can
           never make a burst of historical sequences simultaneously chargeable. At most one
           sequence is executable at any moment. */
        uint256 windowEnd = expectedPaymentTime + sub.period;
        if (block.timestamp >= windowEnd) {
            revert PaymentWindowExpired(_subId, _sequenceId, windowEnd);
        }

        /* Mark sequence as executed before transfer (Checks-Effects-Interactions) */
        _setSequenceExecuted(_subId, _sequenceId);

        _collectAndDistributePayment(
            _subId,
            sub.subscriber,
            sub.merchant,
            sub.settlementToken,
            sub.paymentToken,
            sub.amount
        );

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
     * @dev Only the subscriber can revoke their recurring authorization. A merchant may stop
     *      offering a plan, but cannot terminate a customer's already-purchased access.
     */
    function cancelSubscription(uint256 _subId) external nonReentrant {
        Authorization storage sub = subscriptions[_subId];

        if (!sub.isActive) revert SubscriptionNotActive(_subId);
        if (msg.sender != sub.subscriber) {
            revert NotAuthorized(_subId);
        }

        _clearActiveSubscriptionIndex(_subId, sub);
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
        /* Compare recurring rates with integer cross-multiplication. A longer billing interval
           must not let a subscriber disguise a lower tier as a nominal amount increase. */
        if (_newAmount * sub.period < sub.amount * _newPeriod) {
            revert PlanReductionNotAllowed(_subId);
        }

        _reindexModifiedSubscription(_subId, sub, _newAmount, _newPeriod);

        sub.amount = _newAmount;
        sub.period = _newPeriod;

        emit SubscriptionModified(_subId, _newAmount, _newPeriod);
    }

    function _assertNoActiveDuplicate(
        address _subscriber,
        address _merchant,
        uint256 _amount,
        uint256 _period,
        address _settlementToken,
        address _paymentToken,
        uint256 _allowedSubscriptionId
    ) internal view {
        uint256 existingSubscriptionId = activeSubscriptionByPlanKey[
            _planKey(_subscriber, _merchant, _amount, _period, _settlementToken, _paymentToken)
        ];
        if (
            existingSubscriptionId != 0
            && existingSubscriptionId != _allowedSubscriptionId
            && subscriptions[existingSubscriptionId].isActive
        ) {
            revert DuplicateActiveSubscription(existingSubscriptionId);
        }
    }

    function _indexActiveSubscription(
        uint256 _subId,
        address _subscriber,
        address _merchant,
        uint256 _amount,
        uint256 _period,
        address _settlementToken,
        address _paymentToken
    ) internal {
        activeSubscriptionByPlanKey[
            _planKey(_subscriber, _merchant, _amount, _period, _settlementToken, _paymentToken)
        ] = _subId;
    }

    function _clearActiveSubscriptionIndex(uint256 _subId, Authorization storage sub) internal {
        bytes32 planKey = _planKey(
            sub.subscriber,
            sub.merchant,
            sub.amount,
            sub.period,
            sub.settlementToken,
            sub.paymentToken
        );
        if (activeSubscriptionByPlanKey[planKey] == _subId) {
            delete activeSubscriptionByPlanKey[planKey];
        }
    }

    function _reindexModifiedSubscription(
        uint256 _subId,
        Authorization storage sub,
        uint256 _newAmount,
        uint256 _newPeriod
    ) internal {
        _assertNoActiveDuplicate(
            sub.subscriber,
            sub.merchant,
            _newAmount,
            _newPeriod,
            sub.settlementToken,
            sub.paymentToken,
            _subId
        );
        _clearActiveSubscriptionIndex(_subId, sub);
        _indexActiveSubscription(
            _subId,
            sub.subscriber,
            sub.merchant,
            _newAmount,
            _newPeriod,
            sub.settlementToken,
            sub.paymentToken
        );
    }

    function _planKey(
        address _subscriber,
        address _merchant,
        uint256 _amount,
        uint256 _period,
        address _settlementToken,
        address _paymentToken
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(
            _subscriber,
            _merchant,
            _amount,
            _period,
            _settlementToken,
            _paymentToken
        ));
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
     * @notice Check whether a subscription's payment is currently due (and not yet expired —
     *         a sequence is only chargeable within its own billing window).
     */
    function isPaymentDue(uint256 _subId, uint256 _sequenceId) external view returns (bool) {
        Authorization storage sub = subscriptions[_subId];
        if (!sub.isActive) return false;
        if (isSequenceExecuted(_subId, _sequenceId)) return false;

        uint256 expectedPaymentTime = sub.nextPayment + ((_sequenceId - 1) * sub.period);
        return block.timestamp >= expectedPaymentTime
            && block.timestamp < expectedPaymentTime + sub.period;
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
        upkeepNeeded = block.timestamp >= expectedPaymentTime
            && block.timestamp < expectedPaymentTime + sub.period;
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

    function _collectAndDistributePayment(
        uint256 _subId,
        address _subscriber,
        address _merchant,
        address _settlementToken,
        address _paymentToken,
        uint256 _amount
    ) internal {
        if (_paymentToken != _settlementToken) {
            uint256 amountIn = stableFXRouter.getAmountIn(
                _paymentToken,
                _settlementToken,
                _amount
            );
            IERC20(_paymentToken).safeTransferFrom(_subscriber, address(this), amountIn);
            IERC20(_paymentToken).safeIncreaseAllowance(address(stableFXRouter), amountIn);

            IERC20 settlementToken = IERC20(_settlementToken);
            uint256 balanceBefore = settlementToken.balanceOf(address(this));
            stableFXRouter.swap(
                _paymentToken,
                _settlementToken,
                amountIn,
                _amount,
                address(this)
            );
            uint256 amountReceived = settlementToken.balanceOf(address(this)) - balanceBefore;
            if (amountReceived < _amount) {
                revert InsufficientSwapOutput(_amount, amountReceived);
            }

            _distributeSettlement(_subId, _merchant, settlementToken, _amount);

            // Exact-output routes should not leave dust in this contract.
            if (amountReceived > _amount) {
                settlementToken.safeTransfer(_subscriber, amountReceived - _amount);
            }
        } else {
            IERC20 token = IERC20(_paymentToken);
            uint256 fee = Math.mulDiv(_amount, PROTOCOL_FEE_BPS, BPS_DENOMINATOR);
            token.safeTransferFrom(_subscriber, _merchant, _amount - fee);
            if (fee > 0) {
                token.safeTransferFrom(_subscriber, treasury, fee);
            }
            emit ProtocolFeePaid(_subId, _merchant, _settlementToken, fee);
        }
    }

    function _distributeSettlement(
        uint256 _subId,
        address _merchant,
        IERC20 _settlementToken,
        uint256 _amount
    ) internal {
        uint256 fee = Math.mulDiv(_amount, PROTOCOL_FEE_BPS, BPS_DENOMINATOR);
        _settlementToken.safeTransfer(_merchant, _amount - fee);
        if (fee > 0) {
            _settlementToken.safeTransfer(treasury, fee);
        }
        emit ProtocolFeePaid(_subId, _merchant, address(_settlementToken), fee);
    }

    function _setSequenceExecuted(uint256 _subId, uint256 _sequenceId) internal {
        uint256 wordIndex = _sequenceId / 256;
        uint256 bitPosition = _sequenceId % 256;
        uint256 word = executionBitmaps[_subId][wordIndex];
        executionBitmaps[_subId][wordIndex] = word | (1 << bitPosition);
    }
}
