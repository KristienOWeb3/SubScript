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

    /* Platform-fixed standard commitment / exposure cap: 2 USDC (6dp). */
    uint256 constant COMMIT = 2e6;

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

        vm.prank(owner);
        vault.setAuthorizedDrawer(keeper, true);
    }

    function _commit(uint256 amount) internal {
        vm.prank(user);
        vault.commit(merchant, amount);
    }

    function _keeperDraw(uint256 amount) internal {
        vm.prank(keeper);
        vault.drawUsageFor(merchant, user, amount);
    }

    /* The standard 2 USDC commitment activates the vault; the required amount is the
       platform constant, not a merchant setting. */
    function testCommitActivatesAtStandardCommit() public {
        _commit(COMMIT);
        (uint256 balance, uint256 owed,, bool active, uint256 needed,) = vault.getVault(user, merchant);
        assertEq(balance, COMMIT);
        assertEq(owed, 0);
        assertTrue(active);
        assertEq(needed, vault.STANDARD_COMMIT());
        assertEq(needed, 2_000_000);
    }

    /* Merchants have no lever to raise the user's commitment or exposure. */
    function testMerchantCannotConfigureCommitment() public {
        (bool ok, ) = address(vault).call(abi.encodeWithSignature("setRequiredCommit(uint256)", 50e6));
        assertFalse(ok, "setRequiredCommit must not exist");
        (, , , , uint256 needed, ) = vault.getVault(user, merchant);
        assertEq(needed, 2_000_000);
    }

    /* Merchants cannot draw escrow directly — settlement is keeper-only. */
    function testMerchantCannotDrawDirectly() public {
        _commit(COMMIT);
        vm.warp(block.timestamp + 30 days);

        (bool ok, ) = address(vault).call(abi.encodeWithSignature("drawUsage(address,uint256)", user, 1e6));
        assertFalse(ok, "drawUsage must not exist");

        vm.prank(merchant);
        vm.expectRevert(bytes("not drawer"));
        vault.drawUsageFor(merchant, user, 1e6);
    }

    /* An active cycle cannot be settled before its 30-day maturity. */
    function testDrawBeforeMaturityReverts() public {
        _commit(COMMIT);
        vm.prank(keeper);
        vm.expectRevert(bytes("cycle not mature"));
        vault.drawUsageFor(merchant, user, 1e6);
    }

    /* Settlement pays usage, refunds every unused unit, and requires a new commitment. */
    function testMatureDrawRefundsRemainderAndDeactivates() public {
        _commit(COMMIT);
        vm.warp(block.timestamp + 30 days);

        uint256 userBefore = usdc.balanceOf(user);
        _keeperDraw(0.8e6);

        (uint256 balance, uint256 owed, uint64 cycleStart, bool active,, uint64 lockedUntil) =
            vault.getVault(user, merchant);
        assertEq(balance, 0);
        assertEq(owed, 0);
        assertEq(cycleStart, 0);
        assertFalse(active);
        assertEq(lockedUntil, 0);
        assertEq(usdc.balanceOf(user), userBefore + 1.2e6);
        assertEq(vault.merchantClaimable(merchant), 0.8e6);
    }

    /* The per-cycle exposure is capped at 2 USDC even when the user escrowed more:
       surplus never expands what the merchant can draw. */
    function testExposureCappedAtTwoUsdcDespiteSurplus() public {
        _commit(10e6); // user over-commits 10 USDC
        vm.warp(block.timestamp + 30 days);

        uint256 userBefore = usdc.balanceOf(user);
        _keeperDraw(10e6); // ledger claims the full 10

        (uint256 balance,,, bool active,,) = vault.getVault(user, merchant);
        assertEq(balance, 0);
        assertFalse(active);
        assertEq(vault.merchantClaimable(merchant), 2e6, "draw capped at the 2 USDC exposure");
        assertEq(usdc.balanceOf(user), userBefore + 8e6, "surplus returns to the user");
    }

    /* A draw exceeding the escrow caps at the balance — no debt is ever created. */
    function testDrawCapsAtBalanceNoDebt() public {
        _commit(COMMIT);
        vm.warp(block.timestamp + 30 days);

        _keeperDraw(150e6);

        (uint256 balance, uint256 owed,, bool active,,) = vault.getVault(user, merchant);
        assertEq(balance, 0);
        assertEq(owed, 0);            // no negative / no debt
        assertFalse(active);
        assertEq(vault.merchantClaimable(merchant), 2e6); // only the escrow (≤ cap) was collected
    }

    /* Re-committing simply restores the commit and reactivates (no debt to settle). */
    function testRecommitReactivates() public {
        _commit(COMMIT);
        vm.warp(block.timestamp + 30 days);
        _keeperDraw(COMMIT);

        _commit(COMMIT); // restore commit
        (uint256 balance, uint256 owed,, bool active,,) = vault.getVault(user, merchant);
        assertEq(owed, 0);
        assertEq(balance, COMMIT);
        assertTrue(active);
        assertEq(vault.merchantClaimable(merchant), 2e6); // just the single draw
    }

    /* Active escrow cannot escape reconciliation, even after the cycle matures. */
    function testActiveVaultCannotWithdrawAtMaturity() public {
        _commit(COMMIT);

        vm.prank(user);
        vm.expectRevert(bytes("locked"));
        vault.withdrawSurplus(merchant, 1e6);

        vm.warp(block.timestamp + 30 days);
        vm.prank(user);
        vm.expectRevert(bytes("active cycle"));
        vault.withdrawSurplus(merchant, 1e6);
    }

    /* A below-minimum commitment renders no service and remains user-withdrawable. */
    function testInactiveBelowMinimumCommitCanBeWithdrawn() public {
        _commit(1e6);

        (uint256 balance,,, bool active,,) = vault.getVault(user, merchant);
        assertFalse(active);
        assertEq(balance, 1e6);

        uint256 before = usdc.balanceOf(user);
        vm.prank(user);
        vault.withdrawSurplus(merchant, 1e6);

        (balance,,, active,,) = vault.getVault(user, merchant);
        assertEq(balance, 0);
        assertFalse(active);
        assertEq(usdc.balanceOf(user), before + 1e6);
    }

    /* A zero-usage cycle is still settled and fully refunded. */
    function testZeroUsageSettlementRefundsFullCommit() public {
        _commit(COMMIT);
        vm.warp(block.timestamp + 30 days);

        uint256 userBefore = usdc.balanceOf(user);
        _keeperDraw(0);

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
        _keeperDraw(2e6);

        uint256 merchantBefore = usdc.balanceOf(merchant);
        uint256 treasuryBefore = usdc.balanceOf(treasury);
        vm.prank(merchant);
        vault.merchantClaim();

        assertEq(usdc.balanceOf(merchant), merchantBefore + 1_980_000);
        assertEq(usdc.balanceOf(treasury), treasuryBefore + 20_000);
        assertEq(vault.merchantClaimable(merchant), 0);
    }

    /* Only the authorized keeper can settle; arbitrary callers cannot. */
    function testKeeperOnlySettlement() public {
        _commit(COMMIT);
        vm.warp(block.timestamp + 30 days);

        vm.prank(user); // arbitrary non-drawer
        vm.expectRevert(bytes("not drawer"));
        vault.drawUsageFor(merchant, user, 1e6);

        _keeperDraw(1e6);
        assertEq(vault.merchantClaimable(merchant), 1e6);
    }

    /* Once the user-only reclaim window opens, the keeper cannot front-run the reclaim. */
    function testKeeperCannotDrawAfterReclaimWindowOpens() public {
        _commit(COMMIT);
        vm.warp(block.timestamp + 30 days + 7 days);

        vm.prank(keeper);
        vm.expectRevert(bytes("reclaim window opened"));
        vault.drawUsageFor(merchant, user, COMMIT);

        uint256 before = usdc.balanceOf(user);
        vm.prank(user);
        vault.reclaimAbandonedEscrow(merchant);
        assertEq(usdc.balanceOf(user), before + COMMIT);
    }

    /* An open user dispute blocks settlement AND reclaim until the owner resolves it. */
    function testDisputeBlocksSettlementUntilResolved() public {
        _commit(COMMIT);
        vm.prank(user);
        vault.raiseDispute(merchant);

        vm.warp(block.timestamp + 30 days);
        vm.prank(keeper);
        vm.expectRevert(bytes("disputed"));
        vault.drawUsageFor(merchant, user, 1e6);

        /* The disputing user cannot weaponize the hold into a free reclaim either. */
        vm.warp(block.timestamp + 8 days);
        vm.prank(user);
        vm.expectRevert(bytes("disputed"));
        vault.reclaimAbandonedEscrow(merchant);

        /* Owner resolution reopens a settle window; the bounded draw completes. */
        vm.prank(owner);
        vault.resolveDispute(user, merchant, true);
        vm.prank(keeper);
        vault.drawUsageFor(merchant, user, 1e6);
        assertEq(vault.merchantClaimable(merchant), 1e6);
    }

    /* Only the owner resolves disputes. */
    function testOnlyOwnerResolvesDisputes() public {
        _commit(COMMIT);
        vm.prank(user);
        vault.raiseDispute(merchant);

        vm.prank(merchant);
        vm.expectRevert();
        vault.resolveDispute(user, merchant, true);
    }

    /* Emergency pause blocks settlement but leaves user reclaim available. */
    function testPauseBlocksSettlementButNotReclaim() public {
        _commit(COMMIT);
        vm.warp(block.timestamp + 30 days);
        vm.prank(owner);
        vault.pause();

        vm.prank(keeper);
        vm.expectRevert();
        vault.drawUsageFor(merchant, user, 1e6);

        vm.warp(block.timestamp + 7 days);
        uint256 before = usdc.balanceOf(user);
        vm.prank(user);
        vault.reclaimAbandonedEscrow(merchant);
        assertEq(usdc.balanceOf(user), before + COMMIT);
    }
}
