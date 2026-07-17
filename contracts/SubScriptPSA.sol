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
        uint256 maxPaymentAmount; /* Subscriber-approved ceiling on payment-token pulled per period.
                                     Bounds FX slippage: the swap can never pull more input than this. */
    }

    /* Merchant-offered introductory pricing, authorized by the subscriber at creation.
       Kept OUTSIDE the Authorization struct so the `subscriptions(id)` getter ABI is
       unchanged for existing integrations. `amount` is the per-cycle charge while the
       promotion lasts (0 = free trial); `cycles` counts discounted billing sequences
       starting from sequence 0 (the signup payment). The charge for any sequence is a
       pure function of the sequence number, so there is no mutable phase counter that
       could drift or be manipulated. */
    struct IntroductoryTerms {
        uint256 amount; /* Discounted per-cycle charge in settlement token units (0 = free) */
        uint256 cycles; /* Number of discounted cycles, counted from sequence 0 */
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

    /* Ceiling on discounted cycles so a promotion can never postpone full-price
       billing indefinitely (3 years of monthly cycles). */
    uint256 public constant MAX_INTRODUCTORY_CYCLES = 36;

    /* Auto-incrementing subscription ID counter; starts at 1 */
    uint256 public nextSubscriptionId = 1;

    /* Mapping from subscription ID → Authorization data */
    mapping(uint256 => Authorization) public subscriptions;

    /* Exact plan authorization key → active subscription ID. Prevents a subscriber from
       accidentally creating the same merchant/amount/period/token subscription twice. */
    mapping(bytes32 => uint256) public activeSubscriptionByPlanKey;

    /* Densely packed execution bitmaps: subId => (wordIndex => word) */
    mapping(uint256 => mapping(uint256 => uint256)) public executionBitmaps;

    /* subId => introductory pricing authorized at creation (cycles == 0 => none) */
    mapping(uint256 => IntroductoryTerms) public introductoryTerms;

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

    event IntroductoryTermsSet(
        uint256 indexed subId,
        uint256 introductoryAmount,
        uint256 introductoryCycles,
        uint256 regularAmount
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
    error MaxPaymentAmountRequired();
    error InvalidIntroductoryTerms();
    error ExcessiveSwapInput(uint256 amountIn, uint256 maxAllowed);
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
        /* Same settlement + payment token => no FX, so the cap equals the exact amount. */
        return _createSubscription(
            _merchant,
            _amount,
            _period,
            address(paymentToken),
            address(paymentToken),
            _amount,
            0,
            0
        );
    }

    /*
     * @notice Create a subscription under merchant-offered introductory terms. The subscriber
     *         authorizes BOTH prices in this single transaction: `_introductoryAmount` per cycle
     *         for the first `_introductoryCycles` billing sequences (0 = free trial, in which
     *         case nothing is transferred at signup), then `_amount` per cycle forever after.
     *         The regular amount is stored on the authorization, so the promotion can only ever
     *         lower a charge — never raise one — and the phase switch is enforced on-chain per
     *         sequence, independent of any off-chain database state.
     * @dev Default-token only: introductory pricing composes with FX routing poorly (the input
     *      cap would need per-phase scaling), so promotional subscriptions settle in the
     *      protocol's default payment token.
     */
    function createSubscriptionWithIntroductoryTerms(
        address _merchant,
        uint256 _amount,
        uint256 _period,
        uint256 _introductoryAmount,
        uint256 _introductoryCycles
    ) external nonReentrant returns (uint256 subId) {
        if (
            _introductoryCycles == 0
                || _introductoryCycles > MAX_INTRODUCTORY_CYCLES
                || _introductoryAmount >= _amount
        ) revert InvalidIntroductoryTerms();
        return _createSubscription(
            _merchant,
            _amount,
            _period,
            address(paymentToken),
            address(paymentToken),
            _amount,
            _introductoryAmount,
            _introductoryCycles
        );
    }

    /*
     * @notice Overloaded function to create a new recurring subscription with token specifications.
     * @dev Cross-token (FX) subscriptions MUST use the overload that takes `_maxPaymentAmount`; this
     *      overload only serves the same-token case and reverts for cross-token to avoid an unbounded
     *      input pull.
     */
    function createSubscription(
        address _merchant,
        uint256 _amount,
        uint256 _period,
        address _settlementToken,
        address _paymentToken
    ) public nonReentrant returns (uint256 subId) {
        /* max == 0 sentinel; _createSubscription requires an explicit cap when the tokens differ. */
        return _createSubscription(_merchant, _amount, _period, _settlementToken, _paymentToken, 0, 0, 0);
    }

    /*
     * @notice Create a multi-currency subscription with a subscriber-approved ceiling on the amount
     *         of payment token that may be pulled each period. This bounds FX slippage — the swap can
     *         never pull more input than `_maxPaymentAmount`, even if the FX router is manipulated.
     */
    function createSubscription(
        address _merchant,
        uint256 _amount,
        uint256 _period,
        address _settlementToken,
        address _paymentToken,
        uint256 _maxPaymentAmount
    ) public nonReentrant returns (uint256 subId) {
        return _createSubscription(_merchant, _amount, _period, _settlementToken, _paymentToken, _maxPaymentAmount, 0, 0);
    }

    /*
     * @notice Internal helper to create a new recurring subscription.
     */
    function _createSubscription(
        address _merchant,
        uint256 _amount,
        uint256 _period,
        address _settlementToken,
        address _paymentToken,
        uint256 _maxPaymentAmount,
        uint256 _introductoryAmount,
        uint256 _introductoryCycles
    ) internal returns (uint256 subId) {
        if (_merchant == address(0) || _settlementToken == address(0) || _paymentToken == address(0)) revert InvalidAddress();
        if (_amount == 0) revert InvalidAmount();
        if (_period < 3600) revert InvalidPeriod();
        /* Introductory pricing is default-token only (no FX input-cap phase scaling). */
        if (_introductoryCycles != 0 && _settlementToken != _paymentToken) revert InvalidIntroductoryTerms();

        /* Bound the payment-token pull. Same-token: no swap, so the cap is exactly the amount.
           Cross-token: the subscriber MUST approve an explicit ceiling (>= the settlement amount);
           without it the FX router could pull an unbounded amount of their payment token. */
        if (_settlementToken == _paymentToken) {
            _maxPaymentAmount = _amount;
        } else {
            if (_maxPaymentAmount == 0) revert MaxPaymentAmountRequired();
            if (_maxPaymentAmount < _amount) revert InvalidAmount();
        }

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
            paymentToken: _paymentToken,
            maxPaymentAmount: _maxPaymentAmount
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

        /* Sequence 0 charges the introductory amount when a promotion applies. A zero
           introductory amount is a free trial: the authorization is recorded (with the
           full regular amount the subscriber approved), but no funds move and no
           protocol fee is taken until a non-zero cycle bills. */
        uint256 initialCharge = _amount;
        if (_introductoryCycles != 0) {
            introductoryTerms[subId] = IntroductoryTerms({
                amount: _introductoryAmount,
                cycles: _introductoryCycles
            });
            initialCharge = _introductoryAmount;
            emit IntroductoryTermsSet(subId, _introductoryAmount, _introductoryCycles, _amount);
        }

        if (initialCharge != 0) {
            _collectAndDistributePayment(
                subId,
                msg.sender,
                _merchant,
                _settlementToken,
                _paymentToken,
                initialCharge,
                _maxPaymentAmount
            );
        }

        emit SubscriptionCreated(subId, msg.sender, _merchant, _amount, _period);
        emit PaymentExecuted(subId, msg.sender, _merchant, initialCharge, 0, block.timestamp);
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

        /* The applicable amount is derived on-chain from the sequence number: introductory
           price while the promotion lasts, the subscriber-authorized regular price after.
           Zero-amount cycles (free trial) advance the sequence without moving funds. */
        uint256 chargeAmount = chargeAmountFor(_subId, _sequenceId);
        if (chargeAmount != 0) {
            _collectAndDistributePayment(
                _subId,
                sub.subscriber,
                sub.merchant,
                sub.settlementToken,
                sub.paymentToken,
                chargeAmount,
                sub.maxPaymentAmount
            );
        }

        emit PaymentExecuted(
            _subId,
            sub.subscriber,
            sub.merchant,
            chargeAmount,
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
        if (_newPeriod < 3600) revert InvalidPeriod(); // Minimum period of 1 hour
        /* Compare recurring rates with integer cross-multiplication. A longer billing interval
           must not let a subscriber disguise a lower tier as a nominal amount increase. */
        if (_newAmount * sub.period < sub.amount * _newPeriod) {
            revert PlanReductionNotAllowed(_subId);
        }

        _reindexModifiedSubscription(_subId, sub, _newAmount, _newPeriod);

        /* Keep the FX input ceiling consistent with the new amount. Same-token: exact. Cross-token:
           scale the subscriber-approved cap by the amount ratio so the same slippage headroom carries
           over (amount only ever increases here, so the cap only grows). */
        if (sub.settlementToken == sub.paymentToken) {
            sub.maxPaymentAmount = _newAmount;
        } else if (sub.amount > 0) {
            sub.maxPaymentAmount = (sub.maxPaymentAmount * _newAmount) / sub.amount;
        }

        sub.amount = _newAmount;
        sub.period = _newPeriod;

        /* A modification is the subscriber explicitly re-authorizing a new price, so any
           remaining introductory cycles end here: every future charge is _newAmount. */
        if (introductoryTerms[_subId].cycles != 0) {
            delete introductoryTerms[_subId];
        }

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
     * @notice The amount a given billing sequence charges: the introductory amount while the
     *         promotion's cycles last (sequence 0 is the signup payment), the regular amount
     *         after. Keepers and integrators read this instead of assuming `amount`.
     */
    function chargeAmountFor(uint256 _subId, uint256 _sequenceId) public view returns (uint256) {
        IntroductoryTerms storage terms = introductoryTerms[_subId];
        if (terms.cycles != 0 && _sequenceId < terms.cycles) {
            return terms.amount;
        }
        return subscriptions[_subId].amount;
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
        uint256 _amount,
        uint256 _maxPaymentAmount
    ) internal {
        if (_paymentToken != _settlementToken) {
            uint256 amountIn = stableFXRouter.getAmountIn(
                _paymentToken,
                _settlementToken,
                _amount
            );
            /* Slippage/manipulation guard: never pull more payment token than the subscriber approved,
               even if the FX router quotes an inflated input. */
            if (amountIn > _maxPaymentAmount) revert ExcessiveSwapInput(amountIn, _maxPaymentAmount);
            IERC20(_paymentToken).safeTransferFrom(_subscriber, address(this), amountIn);
            IERC20(_paymentToken).safeIncreaseAllowance(address(stableFXRouter), amountIn);

            uint256 paymentTokenBalanceBefore = IERC20(_paymentToken).balanceOf(address(this));

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

            // Refund any unspent payment token instead of excess settlement token
            uint256 paymentTokenBalanceAfter = IERC20(_paymentToken).balanceOf(address(this));
            uint256 unspentPayment = paymentTokenBalanceAfter > (paymentTokenBalanceBefore - amountIn) 
                ? paymentTokenBalanceAfter - (paymentTokenBalanceBefore - amountIn) 
                : 0;

            if (unspentPayment > 0) {
                // Return unspent payment token to the subscriber
                IERC20(_paymentToken).safeTransfer(_subscriber, unspentPayment);
            }

            // Any excess settlement token generated by positive slippage goes to the treasury
            if (amountReceived > _amount) {
                settlementToken.safeTransfer(treasury, amountReceived - _amount);
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
