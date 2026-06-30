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
    address public treasury = address(0x3333333333333333333333333333333333333333);

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

    /* An active cycle cannot be settled before its 30-day maturity. */
    function testDrawBeforeMaturityReverts() public {
        _commit(COMMIT);

        vm.prank(merchant);
        vm.expectRevert(bytes("cycle not mature"));
        vault.drawUsage(user, 40e6);
    }

    /* Settlement pays usage, refunds every unused unit, and requires a new commitment. */
    function testMatureDrawRefundsRemainderAndDeactivates() public {
        _commit(COMMIT);
        vm.warp(block.timestamp + 30 days);

        uint256 userBefore = usdc.balanceOf(user);
        vm.prank(merchant);
        vault.drawUsage(user, 40e6);

        (uint256 balance, uint256 owed, uint64 cycleStart, bool active,, uint64 lockedUntil) =
            vault.getVault(user, merchant);
        assertEq(balance, 0);
        assertEq(owed, 0);
        assertEq(cycleStart, 0);
        assertFalse(active);
        assertEq(lockedUntil, 0);
        assertEq(usdc.balanceOf(user), userBefore + 60e6);
        assertEq(vault.merchantClaimable(merchant), 40e6);
    }

    /* A draw exceeding the escrow caps at the balance — no debt is ever created. */
    function testDrawCapsAtBalanceNoDebt() public {
        _commit(COMMIT);
        vm.warp(block.timestamp + 30 days);

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
        vm.warp(block.timestamp + 30 days);

        vm.prank(merchant);
        vault.drawUsage(user, 150e6); // balance -> 0, no owed

        _commit(COMMIT); // restore commit
        (uint256 balance, uint256 owed,, bool active,,) = vault.getVault(user, merchant);
        assertEq(owed, 0);
        assertEq(balance, COMMIT);
        assertTrue(active);
        assertEq(vault.merchantClaimable(merchant), 100e6); // just the single draw
    }

    /* Active escrow cannot escape reconciliation, even after the cycle matures. */
    function testActiveVaultCannotWithdrawAtMaturity() public {
        _commit(COMMIT);

        vm.prank(user);
        vm.expectRevert(bytes("locked"));
        vault.withdrawSurplus(merchant, 40e6);

        vm.warp(block.timestamp + 30 days);
        vm.prank(user);
        vm.expectRevert(bytes("active cycle"));
        vault.withdrawSurplus(merchant, 40e6);
    }

    /* A below-minimum commitment renders no service and remains user-withdrawable. */
    function testInactiveBelowMinimumCommitCanBeWithdrawn() public {
        _commit(40e6);

        (uint256 balance,,, bool active,,) = vault.getVault(user, merchant);
        assertFalse(active);
        assertEq(balance, 40e6);

        uint256 before = usdc.balanceOf(user);
        vm.prank(user);
        vault.withdrawSurplus(merchant, 40e6);

        (balance,,, active,,) = vault.getVault(user, merchant);
        assertEq(balance, 0);
        assertFalse(active);
        assertEq(usdc.balanceOf(user), before + 40e6);
    }

    /* A zero-usage cycle is still settled and fully refunded. */
    function testZeroUsageSettlementRefundsFullCommit() public {
        _commit(COMMIT);
        vm.warp(block.timestamp + 30 days);

        uint256 userBefore = usdc.balanceOf(user);
        vm.prank(merchant);
        vault.drawUsage(user, 0);

        (uint256 balance,,, bool active,,) = vault.getVault(user, merchant);
        assertEq(balance, 0);
        assertFalse(active);
        assertEq(usdc.balanceOf(user), userBefore + COMMIT);
        assertEq(vault.merchantClaimable(merchant), 0);
    }

    /* Merchant claims settled funds less the flat 1% treasury fee. */
    function testMerchantClaimChargesOnePercentTreasuryFee() public {
        vm.prank(owner);
        vault.setTreasury(treasury);

        _commit(COMMIT);
        vm.warp(block.timestamp + 30 days);

        vm.prank(merchant);
        vault.drawUsage(user, 40e6);

        uint256 merchantBefore = usdc.balanceOf(merchant);
        uint256 treasuryBefore = usdc.balanceOf(treasury);
        vm.prank(merchant);
        vault.merchantClaim();

        assertEq(usdc.balanceOf(merchant), merchantBefore + 39_600_000);
        assertEq(usdc.balanceOf(treasury), treasuryBefore + 400_000);
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

        vm.warp(block.timestamp + 30 days);
        vm.prank(keeper);
        vault.drawUsageFor(merchant, user, 30e6);
        assertEq(vault.merchantClaimable(merchant), 30e6);
    }
}
