/* SPDX-License-Identifier: MIT */
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../contracts/SubScriptRouter.sol";
import "../contracts/SubScriptPSA.sol";
import "./mocks/MockUSDC.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract SubScriptHandler is Test {
    SubScriptRouter public router;
    MockUSDC public usdc;

    /* Track active actors */
    address[] public users;
    address[] public merchants;

    /* Ghost variables for tracking state */
    uint256 public totalMerchantBalances;

    constructor(SubScriptRouter _router, MockUSDC _usdc) {
        router = _router;
        usdc = _usdc;

        /* Set up fuzzed users and merchants */
        users.push(address(0x1111111111111111111111111111111111111111));
        users.push(address(0x2222222222222222222222222222222222222222));
        users.push(address(0x3333333333333333333333333333333333333333));

        merchants.push(address(0x4444444444444444444444444444444444444444));
        merchants.push(address(0x5555555555555555555555555555555555555555));
    }

    function withdraw(uint256 merchantIndex) public {
        address merchant = merchants[merchantIndex % merchants.length];
        uint256 balance = router.merchantBalances(merchant);
        if (balance == 0) return;

        vm.prank(merchant);
        try router.withdraw() {
            totalMerchantBalances -= balance;
        } catch {}
    }

    function getMerchants() external view returns (address[] memory) {
        return merchants;
    }
}

contract SubScriptInvariants is Test {
    SubScriptRouter public router;
    MockUSDC public usdc;
    SubScriptHandler public handler;

    address public owner = address(0x725D56151CeaC9eAd625241D13b8307B22EDDb10);
    address public treasury = address(0x725D56151CeaC9eAd625241D13b8307B22EDDb10);

    function setUp() public {
        usdc = new MockUSDC();
        SubScriptRouter implementation = new SubScriptRouter();
        
        bytes memory initData = abi.encodeWithSelector(
            SubScriptRouter.initialize.selector,
            address(usdc),
            treasury,
            owner
        );
        
        ERC1967Proxy proxy = new ERC1967Proxy(address(implementation), initData);
        router = SubScriptRouter(address(proxy));

        handler = new SubScriptHandler(router, usdc);

        /* Tell Foundry to target the handler contract for fuzzing */
        targetContract(address(handler));
    }

    /**
     * @notice Strict Protocol Invariant Condition:
     *         The sum of all tracking balances within our internal ledger mapping (merchantBalances)
     *         MUST ALWAYS be exactly less than or equal to the total native USDC balance held physically by the contract vault.
     */
    function invariant_ledgerBalancesNotExceedVault() public {
        address[] memory merchants = handler.getMerchants();
        uint256 sumMerchantBalances = 0;
        
        for (uint256 i = 0; i < merchants.length; i++) {
            sumMerchantBalances += router.merchantBalances(merchants[i]);
        }

        uint256 vaultUSDC = usdc.balanceOf(address(router));

        /* Assert sum of merchant balances <= vault USDC balance */
        assertGe(
            vaultUSDC,
            sumMerchantBalances,
            "Vault USDC balance is less than total internal merchant balances"
        );
    }
}

/* ───────────── SubScriptPSA: atomic plan change (replaceSubscription) ───────────── */

contract PSAReplaceHandler is Test {
    SubScriptPSA public psa;
    MockUSDC public usdc;

    address[] public subscribers;
    address[] public merchants;

    uint256[4] internal amounts = [uint256(5e6), 10e6, 20e6, 50e6];
    uint256[3] internal periods = [uint256(1 days), 30 days, 365 days];

    /* Ghosts: every sub a successful replace retired, and how many replaces landed. */
    uint256[] public retiredIds;
    uint256 public replaceCount;
    bool public strangerReplaced;

    constructor(SubScriptPSA _psa, MockUSDC _usdc) {
        psa = _psa;
        usdc = _usdc;
        subscribers.push(address(0xA11CE));
        subscribers.push(address(0xB0B));
        subscribers.push(address(0xCA401));
        merchants.push(address(0x4444444444444444444444444444444444444444));
        merchants.push(address(0x5555555555555555555555555555555555555555));
        for (uint256 i = 0; i < subscribers.length; i++) {
            usdc.mint(subscribers[i], 1e15);
            vm.prank(subscribers[i]);
            usdc.approve(address(psa), type(uint256).max);
        }
    }

    /* Open a sub only when the pair has none, so any second active sub can only come from replace. */
    function subscribe(uint256 s, uint256 m, uint256 a, uint256 p) external {
        address subscriber = subscribers[s % subscribers.length];
        address merchant = merchants[m % merchants.length];
        if (activeCount(subscriber, merchant) != 0) return;
        vm.prank(subscriber);
        try psa.createSubscription(merchant, amounts[a % amounts.length], periods[p % periods.length]) {} catch {}
    }

    function replaceUpgrade(uint256 idSeed, uint256 a, uint256 p, uint256 chargeSeed, uint256 cycles) external {
        uint256 oldId = _pickId(idSeed);
        if (oldId == 0) return;
        uint256 newAmount = amounts[a % amounts.length];
        uint256 chargeNow = bound(chargeSeed, 1, newAmount);
        uint256 introCycles = chargeNow == newAmount ? 0 : bound(cycles, 1, 36);
        (address subscriber,,,,,,,,) = psa.subscriptions(oldId);
        vm.prank(subscriber);
        try psa.replaceSubscription(oldId, newAmount, periods[p % periods.length], chargeNow, 0, introCycles) {
            retiredIds.push(oldId);
            replaceCount++;
        } catch {}
    }

    function replaceDeferred(uint256 idSeed, uint256 a, uint256 p, uint256 whenSeed) external {
        uint256 oldId = _pickId(idSeed);
        if (oldId == 0) return;
        uint256 paidThrough = psa.paidThrough(oldId);
        if (paidThrough <= block.timestamp) return;
        uint256 firstPaymentAt = bound(whenSeed, block.timestamp + 1, paidThrough);
        (address subscriber,,,,,,,,) = psa.subscriptions(oldId);
        vm.prank(subscriber);
        try psa.replaceSubscription(oldId, amounts[a % amounts.length], periods[p % periods.length], 0, firstPaymentAt, 0) {
            retiredIds.push(oldId);
            replaceCount++;
        } catch {}
    }

    /* A stranger (or the merchant) trying to replace someone else's sub must never succeed. */
    function replaceAsStranger(uint256 idSeed, uint256 who) external {
        uint256 oldId = _pickId(idSeed);
        if (oldId == 0) return;
        (address subscriber, address merchant,,,,,,,) = psa.subscriptions(oldId);
        address caller = who % 2 == 0 ? merchant : address(0xBAD);
        if (caller == subscriber) return;
        vm.prank(caller);
        try psa.replaceSubscription(oldId, 20e6, 30 days, 20e6, 0, 0) {
            strangerReplaced = true;
        } catch {}
    }

    function cancel(uint256 idSeed) external {
        uint256 id = _pickId(idSeed);
        if (id == 0) return;
        (address subscriber,,,,,,,,) = psa.subscriptions(id);
        vm.prank(subscriber);
        try psa.cancelSubscription(id) {} catch {}
    }

    function charge(uint256 idSeed, uint256 seq) external {
        uint256 id = _pickId(idSeed);
        if (id == 0) return;
        try psa.executePayment(id, bound(seq, 1, 50)) {} catch {}
    }

    function warp(uint256 secondsSeed) external {
        vm.warp(block.timestamp + bound(secondsSeed, 1, 40 days));
    }

    function activeCount(address subscriber, address merchant) public view returns (uint256 count) {
        uint256 next = psa.nextSubscriptionId();
        for (uint256 id = 1; id < next; id++) {
            (address s, address m,,,, bool isActive,,,) = psa.subscriptions(id);
            if (isActive && s == subscriber && m == merchant) count++;
        }
    }

    function retiredLength() external view returns (uint256) {
        return retiredIds.length;
    }

    function subscriberCount() external view returns (uint256) {
        return subscribers.length;
    }

    function merchantCount() external view returns (uint256) {
        return merchants.length;
    }

    function _pickId(uint256 seed) internal view returns (uint256) {
        uint256 next = psa.nextSubscriptionId();
        if (next == 1) return 0;
        return bound(seed, 1, next - 1);
    }
}

contract SubScriptPSAReplaceInvariants is Test {
    SubScriptPSA public psa;
    MockUSDC public usdc;
    PSAReplaceHandler public handler;

    function setUp() public {
        usdc = new MockUSDC();
        psa = new SubScriptPSA(address(usdc), address(0x725D56151CeaC9eAd625241D13b8307B22EDDb10));
        handler = new PSAReplaceHandler(psa, usdc);
        targetContract(address(handler));
    }

    /**
     * @notice replaceSubscription never leaves a subscriber with two active subs for the same
     *         merchant. Opens only happen when the pair has none, so a second live sub could only
     *         come from a replace that failed to retire the old one.
     */
    /// forge-config: default.invariant.runs = 1000
    function invariant_replaceNeverLeavesTwoActiveSubsPerMerchant() public view {
        for (uint256 s = 0; s < handler.subscriberCount(); s++) {
            for (uint256 m = 0; m < handler.merchantCount(); m++) {
                assertLe(
                    handler.activeCount(handler.subscribers(s), handler.merchants(m)),
                    1,
                    "subscriber holds two active subs for one merchant"
                );
            }
        }
    }

    /**
     * @notice Every sub a replace retired stays retired, and its chain can't be charged again.
     */
    /// forge-config: default.invariant.runs = 1000
    function invariant_replacedSubsStayInactive() public view {
        uint256 n = handler.retiredLength();
        for (uint256 i = 0; i < n; i++) {
            uint256 id = handler.retiredIds(i);
            (,,,,, bool isActive,,,) = psa.subscriptions(id);
            assertFalse(isActive, "a replaced subscription is active again");
        }
        assertFalse(handler.strangerReplaced(), "a non-subscriber replaced a subscription");
    }
}
