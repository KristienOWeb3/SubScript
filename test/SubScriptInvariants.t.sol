/* SPDX-License-Identifier: MIT */
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../contracts/SubScriptRouter.sol";
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
    address public treasury = address(0xaFCb6d3e9ebeD1A4BF78384689A1fFf280132295);

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
