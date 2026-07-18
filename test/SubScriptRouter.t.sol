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

    event Withdraw(address indexed merchant, uint256 amount);

    event BatchPayoutExecuted(
        address indexed merchant,
        uint256 totalAmount,
        uint256 recipientCount
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

    /* Test: Standard withdrawal flow */
    function testWithdraw() public {
        /* Merchant with zero balance cannot withdraw */
        vm.prank(merchant);
        vm.expectRevert("No balance to withdraw");
        router.withdraw();
    }

    function _depositForMerchant(uint256 amount) internal {
        usdc.mint(subscriber, amount);
        vm.startPrank(subscriber);
        usdc.approve(address(router), amount);
        router.depositForMerchant(merchant, amount, "rcpt-dust");
        vm.stopPrank();
    }

    /* Payment links accept sub-1-USDC amounts, so the router must let merchants withdraw any
       positive balance — a 1 USDC minimum stranded small balances forever. */
    function testDustBalanceIsWithdrawable() public {
        _depositForMerchant(0.40e6); // 0.40 USDC

        uint256 merchantBefore = usdc.balanceOf(merchant);
        uint256 treasuryBefore = usdc.balanceOf(treasury);
        vm.prank(merchant);
        router.withdraw();

        /* 1% fee on 400_000 micro = 4_000; net 396_000. */
        assertEq(usdc.balanceOf(merchant), merchantBefore + 396_000);
        assertEq(usdc.balanceOf(treasury), treasuryBefore + 4_000);
        assertEq(router.merchantBalances(merchant), 0);
    }

    /* Fee floors to zero below 100 micro-USDC; the merchant still receives everything. */
    function testMicroDustWithdrawsWithZeroFee() public {
        _depositForMerchant(99); // 99 micro-USDC

        uint256 merchantBefore = usdc.balanceOf(merchant);
        uint256 treasuryBefore = usdc.balanceOf(treasury);
        vm.prank(merchant);
        router.withdraw();

        assertEq(usdc.balanceOf(merchant), merchantBefore + 99);
        assertEq(usdc.balanceOf(treasury), treasuryBefore);
        assertEq(router.merchantBalances(merchant), 0);
    }

    /* withdrawTo applies the same dust policy for Premium merchants. */
    function testDustWithdrawTo() public {
        vm.prank(owner);
        router.setMerchantTier(merchant, 1);
        _depositForMerchant(0.25e6);

        vm.prank(merchant);
        router.withdrawTo(redirectDestination);
        assertEq(usdc.balanceOf(redirectDestination), 247_500); // 0.25 USDC less 1%
    }

    /* Test: Setting treasury address */
    function testSetTreasury() public {
        address newTreasury = address(0x9999999999999999999999999999999999999999);

        /* Non-owner cannot set treasury */
        vm.prank(merchant);
        vm.expectRevert(abi.encodeWithSelector(OwnableUnauthorizedAccount.selector, merchant));
        router.setTreasury(newTreasury);

        /* Owner can set treasury */
        vm.prank(owner);
        router.setTreasury(newTreasury);
        assertEq(router.treasury(), newTreasury);

        /* Cannot set to zero address */
        vm.prank(owner);
        vm.expectRevert("Invalid new treasury");
        router.setTreasury(address(0));
    }

    /* Test: Batch payout execution */
    function testExecuteBatchPayout() public {
        uint256 payoutAmount = 100 * 10**6; /* 100 USDC */
        address recipient1 = address(0x6666666666666666666666666666666666666666);
        address recipient2 = address(0x7777777777777777777777777777777777777777);

        /* Fund the owner wallet for batch payout */
        usdc.mint(owner, payoutAmount);

        vm.startPrank(owner);
        usdc.approve(address(router), payoutAmount);

        address[] memory recipients = new address[](2);
        recipients[0] = recipient1;
        recipients[1] = recipient2;

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 60 * 10**6; /* 60 USDC */
        amounts[1] = 40 * 10**6; /* 40 USDC */

        router.executeBatchPayout(recipients, amounts);
        vm.stopPrank();

        /* Verify recipient balances */
        assertEq(usdc.balanceOf(recipient1), 60 * 10**6);
        assertEq(usdc.balanceOf(recipient2), 40 * 10**6);

        /* Router should hold zero USDC after batch payout */
        assertEq(usdc.balanceOf(address(router)), 0);
    }

    /* Test: Batch payout array length mismatch */
    function testExecuteBatchPayoutMismatch() public {
        address[] memory recipients = new address[](2);
        recipients[0] = merchant;
        recipients[1] = redirectDestination;

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 100 * 10**6;

        vm.prank(owner);
        vm.expectRevert("Array length mismatch");
        router.executeBatchPayout(recipients, amounts);
    }

    /* Test: Non-owner cannot execute batch payout */
    function testExecuteBatchPayoutNonOwner() public {
        address[] memory recipients = new address[](1);
        recipients[0] = merchant;

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 100 * 10**6;

        vm.prank(merchant);
        vm.expectRevert(abi.encodeWithSelector(OwnableUnauthorizedAccount.selector, merchant));
        router.executeBatchPayout(recipients, amounts);
    }

    /* Test: Rescue stuck ERC20 tokens */
    function testRescueERC20() public {
        uint256 stuckAmount = 50 * 10**6;
        MockUSDC otherToken = new MockUSDC();
        otherToken.mint(address(router), stuckAmount);

        /* Non-owner cannot rescue */
        vm.prank(merchant);
        vm.expectRevert(abi.encodeWithSelector(OwnableUnauthorizedAccount.selector, merchant));
        router.rescueERC20(address(otherToken), owner, stuckAmount);

        /* Owner can rescue */
        vm.prank(owner);
        router.rescueERC20(address(otherToken), owner, stuckAmount);
        assertEq(otherToken.balanceOf(owner), stuckAmount);
        assertEq(otherToken.balanceOf(address(router)), 0);
    }

    function testPaymentTokenRescueAlwaysReverts() public {
        uint256 stuckAmount = 50 * 10**6;
        usdc.mint(address(router), stuckAmount);

        vm.prank(owner);
        vm.expectRevert("Payment token rescue disabled");
        router.rescueERC20(address(usdc), owner, stuckAmount);
    }

    /* Test: Pause and unpause */
    function testPauseUnpause() public {
        /* Owner can pause */
        vm.prank(owner);
        router.pause();

        /* Withdrawal should revert when paused */
        vm.prank(merchant);
        vm.expectRevert();
        router.withdraw();

        /* Owner can unpause */
        vm.prank(owner);
        router.unpause();
    }
}
