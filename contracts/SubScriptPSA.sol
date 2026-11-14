/* SPDX-License-Identifier: MIT */
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

/*
 * @title SubScriptPSA
 * @author SubScript Protocol
 * @notice Decentralized subscription management protocol for the Arc Network.
 *         Enables non-custodial, recurring ERC-20 payments via keeper-triggered
 *         executions. v3 is single-token: every subscription settles in `paymentToken`
 *         (USDC on Arc). Cross-token (FX) routing was removed because Arc publishes no
 *         StableFX router; the settlement/payment token fields stay on the struct
 *         (always equal to `paymentToken`) so existing readers keep decoding it.
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
        address settlementToken; /* Always `paymentToken` (v3 is USDC-only) */
        address paymentToken;    /* Always `paymentToken` (v3 is USDC-only) */
        uint256 maxPaymentAmount; /* Always equal to `amount`. Kept so the `subscriptions(id)` getter
                                     layout is unchanged for off-chain readers. */
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

    /* Entitlement is distinct from the immutable sequence epoch in nextPayment. Retained after
       revocation and updated by every caller that settles a sequence, including third parties. */
    mapping(uint256 => uint256) public paidThrough;

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

    event SubscriptionFirstPaymentDeferred(
        uint256 indexed subId,
        uint256 firstPayment
    );

    /* Emitted once per atomic plan change. `chargeNow` is what was debited in this transaction
       (0 for a deferred change); `firstPaymentAt` is when the new sub's sequence 1 falls due. */
    event SubscriptionReplaced(
        uint256 indexed oldSubId,
        uint256 indexed newSubId,
        uint256 chargeNow,
        uint256 firstPaymentAt
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
    error InvalidIntroductoryTerms();
    error UnsupportedToken(address settlementToken, address paymentToken);
    error InvalidReplacementTerms();

    /* ─────────────────────── Constructor ─────────────────────────── */

    /*
     * @param _paymentToken Address of the only accepted ERC-20 token (USDC).
     * @param _treasury Address receiving the flat 1% merchant fee.
     */
    constructor(address _paymentToken, address _treasury) {
        if (_paymentToken == address(0) || _treasury == address(0)) revert InvalidAddress();
        paymentToken = IERC20(_paymentToken);
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
            address(paymentToken),
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
            _introductoryAmount,
            _introductoryCycles
        );
    }

    function supportsDeferredSubscriptions() external pure returns (bool) {
        return true;
    }

    function supportsReplaceSubscriptions() external pure returns (bool) {
        return true;
    }

    /* Re-authorize already-paid access without another signup debit. The subscriber chooses the
       first charge date independently of the recurring interval; no keeper can accelerate it. */
    function createSubscriptionWithDeferredFirstPayment(
        address _merchant,
        uint256 _amount,
        uint256 _period,
        uint256 _firstPayment
    ) external nonReentrant returns (uint256 subId) {
        if (_firstPayment <= block.timestamp || _firstPayment > block.timestamp + _period) revert InvalidPeriod();
        /* A free one-cycle introduction makes sequence 0 a zero charge. */
        subId = _createSubscription(
            _merchant, _amount, _period, address(paymentToken), address(paymentToken), 0, 1
        );
        _deferFirstPayment(subId, _firstPayment);
    }

    /*
     * @notice Atomically swap an active subscription for a new one with the same merchant.
     *         The old authorization is revoked and the new one created in one transaction, so
     *         a plan change can never leave the subscriber with zero (or two) live subs.
     * @param _oldSubId       The caller's active subscription to retire.
     * @param _newAmount      Regular per-cycle charge of the new plan.
     * @param _newPeriod      Billing interval of the new plan, in seconds.
     * @param _chargeNow      Upgrade path (> 0): debited now as the new sub's sequence 0, usually
     *                        the new price minus credit for unused paid time. Must not exceed
     *                        `_newAmount`.
     * @param _firstPaymentAt Deferred path (`_chargeNow == 0`): when the new plan first bills.
     *                        Must be in the future and no later than the old sub's paidThrough,
     *                        so a change can't grant time nobody paid for. Must be 0 when
     *                        `_chargeNow > 0`.
     * @param _introCycles    Upgrade path only: how many leading sequences (from 0) bill at
     *                        `_chargeNow`. 0 when `_chargeNow == _newAmount` (no discount),
     *                        otherwise 1..MAX_INTRODUCTORY_CYCLES. Must be 0 when deferred.
     */
    function replaceSubscription(
        uint256 _oldSubId,
        uint256 _newAmount,
        uint256 _newPeriod,
        uint256 _chargeNow,
        uint256 _firstPaymentAt,
        uint256 _introCycles
    ) external nonReentrant returns (uint256 newSubId) {
        Authorization storage old = subscriptions[_oldSubId];
        if (!old.isActive) revert SubscriptionNotActive(_oldSubId);
        if (msg.sender != old.subscriber) revert NotAuthorized(_oldSubId);

        address merchant = old.merchant;
        address settlementToken = old.settlementToken;
        address oldPaymentToken = old.paymentToken;

        if (_chargeNow > 0) {
            if (_firstPaymentAt != 0 || _chargeNow > _newAmount) revert InvalidReplacementTerms();
            if (_chargeNow == _newAmount) {
                if (_introCycles != 0) revert InvalidReplacementTerms();
            } else if (_introCycles == 0 || _introCycles > MAX_INTRODUCTORY_CYCLES) {
                revert InvalidIntroductoryTerms();
            }
        } else {
            if (_introCycles != 0) revert InvalidReplacementTerms();
            if (_firstPaymentAt <= block.timestamp || _firstPaymentAt > paidThrough[_oldSubId]) {
                revert InvalidReplacementTerms();
            }
        }

        /* Same effects as cancelSubscription. Done before the create so the duplicate guard
           sees the old plan key as free (re-creating identical terms is allowed). */
        _clearActiveSubscriptionIndex(_oldSubId, old);
        old.isActive = false;
        emit SubscriptionCancelled(_oldSubId, msg.sender);

        if (_chargeNow > 0) {
            newSubId = _createSubscription(
                merchant,
                _newAmount,
                _newPeriod,
                settlementToken,
                oldPaymentToken,
                _introCycles == 0 ? 0 : _chargeNow,
                _introCycles
            );
            emit SubscriptionReplaced(_oldSubId, newSubId, _chargeNow, subscriptions[newSubId].nextPayment);
        } else {
            newSubId = _createSubscription(
                merchant, _newAmount, _newPeriod, settlementToken, oldPaymentToken, 0, 1
            );
            _deferFirstPayment(newSubId, _firstPaymentAt);
            emit SubscriptionReplaced(_oldSubId, newSubId, 0, _firstPaymentAt);
        }
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
        uint256 _introductoryAmount,
        uint256 _introductoryCycles
    ) internal returns (uint256 subId) {
        if (_merchant == address(0)) revert InvalidAddress();
        /* USDC-only: there is no FX router, so any other token pairing is refused outright. */
        if (_settlementToken != address(paymentToken) || _paymentToken != address(paymentToken)) {
            revert UnsupportedToken(_settlementToken, _paymentToken);
        }
        if (_amount == 0) revert InvalidAmount();
        if (_period < 3600) revert InvalidPeriod();

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
            maxPaymentAmount: _amount
        });
        paidThrough[subId] = block.timestamp + _period;
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
            _collectAndDistributePayment(subId, msg.sender, _merchant, initialCharge);
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
        paidThrough[_subId] = Math.max(paidThrough[_subId], windowEnd);
        if (chargeAmount != 0) {
            _collectAndDistributePayment(_subId, sub.subscriber, sub.merchant, chargeAmount);
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
        require(_newPeriod == sub.period, "Period modification disabled");
        /* Compare recurring rates with integer cross-multiplication. A longer billing interval
           must not let a subscriber disguise a lower tier as a nominal amount increase. */
        if (_newAmount * sub.period < sub.amount * _newPeriod) {
            revert PlanReductionNotAllowed(_subId);
        }

        _reindexModifiedSubscription(_subId, sub, _newAmount, _newPeriod);

        /* Single-token: the pull ceiling is always exactly the amount. */
        sub.maxPaymentAmount = _newAmount;

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
        uint256 _amount
    ) internal {
        uint256 fee = Math.mulDiv(_amount, PROTOCOL_FEE_BPS, BPS_DENOMINATOR);
        paymentToken.safeTransferFrom(_subscriber, _merchant, _amount - fee);
        if (fee > 0) {
            paymentToken.safeTransferFrom(_subscriber, treasury, fee);
        }
        emit ProtocolFeePaid(_subId, _merchant, address(paymentToken), fee);
    }

    /* Move a freshly created sub's sequence 1 (and its entitlement) to `_firstPayment`. The caller
       must have created it with a free one-cycle introduction so sequence 0 charged nothing. */
    function _deferFirstPayment(uint256 _subId, uint256 _firstPayment) internal {
        subscriptions[_subId].nextPayment = _firstPayment;
        paidThrough[_subId] = _firstPayment;
        emit SubscriptionFirstPaymentDeferred(_subId, _firstPayment);
    }

    function _setSequenceExecuted(uint256 _subId, uint256 _sequenceId) internal {
        uint256 wordIndex = _sequenceId / 256;
        uint256 bitPosition = _sequenceId % 256;
        uint256 word = executionBitmaps[_subId][wordIndex];
        executionBitmaps[_subId][wordIndex] = word | (1 << bitPosition);
    }
}
