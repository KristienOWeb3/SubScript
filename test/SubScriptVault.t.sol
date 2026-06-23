/* SPDX-License-Identifier: MIT */
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../contracts/SubScriptVault.sol";
import "./mocks/MockUSDC.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract SubScriptVaultTest is Test {
    SubScriptVault public vault;
    MockUSDC public usdc;

    address public owner = address(0x725D56151CeaC9eAd625241D13b8307B22EDDb10);
    address public merchant = address(0x4444444444444444444444444444444444444444);
    address public user = address(0x1111111111111111111111111111111111111111);
    address public keeper = address(0x2222222222222222222222222222222222222222);

    uint256 constant COMMIT = 100e6; // 100 USDC (6dp)

    function setUp() public {
        usdc = new MockUSDC();
        SubScriptVault impl = new SubScriptVault();
        bytes memory initData = abi.encodeWithSelector(
            SubScriptVault.initialize.selector,
            address(usdc),
            owner
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        vault = SubScriptVault(address(proxy));

        usdc.mint(user, 1_000e6);
        vm.prank(user);
        usdc.approve(address(vault), type(uint256).max);

        vm.prank(merchant);
        vault.setRequiredCommit(COMMIT);
    }

    function _commit(uint256 amount) internal {
        vm.prank(user);
        vault.commit(merchant, amount);
    }

    /* Commit of the required amount activates the vault. */
    function testCommitActivates() public {
        _commit(COMMIT);
        (uint256 balance, uint256 owed,, bool active, uint256 needed) = vault.getVault(user, merchant);
        assertEq(balance, COMMIT);
        assertEq(owed, 0);
        assertTrue(active);
        assertEq(needed, COMMIT);
    }

    /* A draw within the escrow leaves a surplus but drops below the commit -> inactive. */
    function testDrawWithinBalance() public {
        _commit(COMMIT);
        vm.prank(merchant);
        vault.drawUsage(user, 40e6);

        (uint256 balance, uint256 owed,, bool active,) = vault.getVault(user, merchant);
        assertEq(balance, 60e6);
        assertEq(owed, 0);
        assertFalse(active); // 60 < 100 commit -> must re-commit before next usage
        assertEq(vault.merchantClaimable(merchant), 40e6);
    }

    /* A draw exceeding the escrow zeroes the balance and records the overage as owed. */
    function testDrawExceedingBalanceCreatesOwed() public {
        _commit(COMMIT);
        vm.prank(merchant);
        vault.drawUsage(user, 150e6);

        (uint256 balance, uint256 owed,, bool active,) = vault.getVault(user, merchant);
        assertEq(balance, 0);
        assertEq(owed, 50e6);
        assertFalse(active);
        assertEq(vault.merchantClaimable(merchant), 100e6); // only the escrow was collected
    }

    /* Re-committing clears owed first, then restores the commit to reactivate. */
    function testRecommitClearsOwedAndReactivates() public {
        _commit(COMMIT);
        vm.prank(merchant);
        vault.drawUsage(user, 150e6); // owed = 50, balance = 0

        _commit(150e6); // 50 clears owed, 100 restores commit
        (uint256 balance, uint256 owed,, bool active,) = vault.getVault(user, merchant);
        assertEq(owed, 0);
        assertEq(balance, 100e6);
        assertTrue(active);
        assertEq(vault.merchantClaimable(merchant), 150e6); // 100 draw + 50 owed settlement
    }

    /* User can withdraw surplus when debt-free; dropping below commit deactivates. */
    function testWithdrawSurplus() public {
        _commit(COMMIT);
        uint256 before = usdc.balanceOf(user);

        vm.prank(user);
        vault.withdrawSurplus(merchant, 40e6);

        (uint256 balance,,, bool active,) = vault.getVault(user, merchant);
        assertEq(balance, 60e6);
        assertFalse(active);
        assertEq(usdc.balanceOf(user), before + 40e6);
    }

    /* Withdraw is blocked while there is outstanding owed debt. */
    function testWithdrawBlockedWithOwed() public {
        _commit(COMMIT);
        vm.prank(merchant);
        vault.drawUsage(user, 150e6); // owed = 50

        vm.prank(user);
        vm.expectRevert(bytes("settle owed first"));
        vault.withdrawSurplus(merchant, 1);
    }

    /* Merchant claims settled funds via the pull-payment ledger. */
    function testMerchantClaim() public {
        _commit(COMMIT);
        vm.prank(merchant);
        vault.drawUsage(user, 40e6);

        uint256 before = usdc.balanceOf(merchant);
        vm.prank(merchant);
        vault.merchantClaim();
        assertEq(usdc.balanceOf(merchant), before + 40e6);
        assertEq(vault.merchantClaimable(merchant), 0);
    }

    /* An authorized keeper can draw on the merchant's behalf; others cannot. */
    function testKeeperDraw() public {
        _commit(COMMIT);

        vm.prank(user); // arbitrary non-drawer
        vm.expectRevert(bytes("not drawer"));
        vault.drawUsageFor(merchant, user, 10e6);

        vm.prank(owner);
        vault.setAuthorizedDrawer(keeper, true);

        vm.prank(keeper);
        vault.drawUsageFor(merchant, user, 30e6);
        assertEq(vault.merchantClaimable(merchant), 30e6);
    }
}
