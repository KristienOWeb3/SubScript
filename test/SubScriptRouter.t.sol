/* SPDX-License-Identifier: MIT */
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../contracts/SubScriptRouter.sol";
import "./mocks/MockUSDC.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract SubScriptRouterTest is Test {
    SubScriptRouter public router;
    MockUSDC public usdc;

    address public owner = address(0x725D56151CeaC9eAd625241D13b8307B22EDDb10);
    address public treasury = address(0xaFCb6d3e9ebeD1A4BF78384689A1fFf280132295);
    address public merchant = address(0x4444444444444444444444444444444444444444);
    address public redirectDestination = address(0x5555555555555555555555555555555555555555);
    address public subscriber = address(0x1111111111111111111111111111111111111111);

    event MerchantPayoutRerouted(
        address indexed merchant,
        address indexed oldDestination,
        address indexed newDestination
    );

    event SubscriptionActivated(
        bytes32 indexed nullifierHash,
        address indexed merchant,
        uint256 amount,
        uint256 period
    );

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
    }

    error OwnableUnauthorizedAccount(address account);

    /* Test: Provisioning merchant tiers */
    function testSetMerchantTier() public {
        /* Initially, merchant tier is 0 */
        assertEq(router.merchantTiers(merchant), 0);

        /* Only owner can set merchant tier */
        vm.prank(owner);
        router.setMerchantTier(merchant, 1);
        assertEq(router.merchantTiers(merchant), 1);

        /* Non-owner trying to set merchant tier should revert */
        vm.prank(merchant);
        vm.expectRevert(abi.encodeWithSelector(OwnableUnauthorizedAccount.selector, merchant));
        router.setMerchantTier(merchant, 0);
    }

    /* Test: Configuring payout destination */
    function testConfigurePayoutDestination() public {
        /* Non-premium merchant cannot configure payout destination */
        vm.prank(merchant);
        vm.expectRevert("Only Premium tier can reroute");
        router.configurePayoutDestination(redirectDestination);

        /* Elevate merchant to Premium tier */
        vm.prank(owner);
        router.setMerchantTier(merchant, 1);

        /* Revert on zero address */
        vm.prank(merchant);
        vm.expectRevert("Invalid destination address");
        router.configurePayoutDestination(address(0));

        /* Configure valid destination and verify event emission */
        vm.prank(merchant);
        vm.expectEmit(true, true, true, true);
        emit MerchantPayoutRerouted(merchant, address(0), redirectDestination);
        router.configurePayoutDestination(redirectDestination);

        assertEq(router.merchantPayoutDestination(merchant), redirectDestination);
    }

    /* Test: verifyAndActivate under standard (tier 0) flow */
    function testVerifyAndActivateStandard() public {
        uint256 amount = 100 * 10**6; /* 100 USDC */
        uint256 period = 30 days;
        bytes32 secret = keccak256(abi.encodePacked("commitment_secret"));
        bytes32 commitment = keccak256(abi.encodePacked(secret));
        bytes32 nullifierHash = keccak256(abi.encodePacked("nullifier_secret"));

        /* Fund subscriber and deposit commitment */
        usdc.mint(subscriber, amount);
        vm.startPrank(subscriber);
        usdc.approve(address(router), amount);
        router.depositAndCommit(commitment, amount);
        vm.stopPrank();

        /* Verify and activate */
        bytes32[] memory proof = new bytes32[](2);
        proof[0] = secret;
        proof[1] = keccak256(abi.encodePacked(merchant, amount, period));

        uint256 initialTreasuryBalance = usdc.balanceOf(treasury);

        router.verifyAndActivate(proof, nullifierHash, merchant, amount, period);

        uint256 expectedFee = (amount * 100) / 10000;
        uint256 expectedNet = amount - expectedFee;

        /* Treasury fee check */
        assertEq(usdc.balanceOf(treasury) - initialTreasuryBalance, expectedFee);

        /* Balance credited to standard merchant address */
        assertEq(router.merchantBalances(merchant), expectedNet);
        assertEq(router.merchantBalances(redirectDestination), 0);
    }

    /* Test: verifyAndActivate under premium tier flow WITH redirection */
    function testVerifyAndActivatePremiumReroute() public {
        /* Upgrade merchant to Premium tier */
        vm.prank(owner);
        router.setMerchantTier(merchant, 1);

        /* Configure custom payout destination */
        vm.prank(merchant);
        router.configurePayoutDestination(redirectDestination);

        uint256 amount = 100 * 10**6; /* 100 USDC */
        uint256 period = 30 days;
        bytes32 secret = keccak256(abi.encodePacked("premium_commitment_secret"));
        bytes32 commitment = keccak256(abi.encodePacked(secret));
        bytes32 nullifierHash = keccak256(abi.encodePacked("premium_nullifier_secret"));

        /* Fund subscriber and deposit commitment */
        usdc.mint(subscriber, amount);
        vm.startPrank(subscriber);
        usdc.approve(address(router), amount);
        router.depositAndCommit(commitment, amount);
        vm.stopPrank();

        /* Verify and activate */
        bytes32[] memory proof = new bytes32[](2);
        proof[0] = secret;
        proof[1] = keccak256(abi.encodePacked(merchant, amount, period));

        uint256 initialTreasuryBalance = usdc.balanceOf(treasury);

        router.verifyAndActivate(proof, nullifierHash, merchant, amount, period);

        uint256 expectedFee = (amount * 100) / 10000;
        uint256 expectedNet = amount - expectedFee;

        /* Treasury fee check */
        assertEq(usdc.balanceOf(treasury) - initialTreasuryBalance, expectedFee);

        /* Balance should be credited to redirectDestination instead of merchant */
        assertEq(router.merchantBalances(merchant), 0);
        assertEq(router.merchantBalances(redirectDestination), expectedNet);

        /* Withdrawal by the redirected address */
        uint256 initialRedirectBalance = usdc.balanceOf(redirectDestination);
        vm.prank(redirectDestination);
        router.withdraw();

        assertEq(router.merchantBalances(redirectDestination), 0);
        assertEq(usdc.balanceOf(redirectDestination) - initialRedirectBalance, expectedNet);
    }
}
