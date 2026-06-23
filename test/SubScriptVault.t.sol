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
        (uint256 balance, uint256 owed,, bool active, uint256 needed,) = vault.getVault(user, merchant);
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

        (uint256 balance, uint256 owed,, bool active,,) = vault.getVault(user, merchant);
        assertEq(balance, 60e6);
        assertEq(owed, 0);
        assertFalse(active); // 60 < 100 commit -> must re-commit before next usage
        assertEq(vault.merchantClaimable(merchant), 40e6);
    }

    /* A draw exceeding the escrow caps at the balance — no debt is ever created. */
    function testDrawCapsAtBalanceNoDebt() public {
        _commit(COMMIT);
        vm.prank(merchant);
        vault.drawUsage(user, 150e6);

        (uint256 balance, uint256 owed,, bool active,,) = vault.getVault(user, merchant);
        assertEq(balance, 0);
        assertEq(owed, 0);            // no negative / no debt
        assertFalse(active);
        assertEq(vault.merchantClaimable(merchant), 100e6); // only the escrow was collected
    }

    /* Re-committing simply restores the commit and reactivates (no debt to settle). */
    function testRecommitReactivates() public {
        _commit(COMMIT);
        vm.prank(merchant);
        vault.drawUsage(user, 150e6); // balance -> 0, no owed

        _commit(COMMIT); // restore commit
        (uint256 balance, uint256 owed,, bool active,,) = vault.getVault(user, merchant);
        assertEq(owed, 0);
        assertEq(balance, COMMIT);
        assertTrue(active);
        assertEq(vault.merchantClaimable(merchant), 100e6); // just the single draw
    }

    /* Withdraw is blocked during the lock window, allowed after it elapses. */
    function testWithdrawAfterLock() public {
        _commit(COMMIT);

        vm.prank(user);
        vm.expectRevert(bytes("locked"));
        vault.withdrawSurplus(merchant, 40e6);

        vm.warp(block.timestamp + 31 days);
        uint256 before = usdc.balanceOf(user);
        vm.prank(user);
        vault.withdrawSurplus(merchant, 40e6);

        (uint256 balance,,, bool active,,) = vault.getVault(user, merchant);
        assertEq(balance, 60e6);
        assertFalse(active);
        assertEq(usdc.balanceOf(user), before + 40e6);
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
