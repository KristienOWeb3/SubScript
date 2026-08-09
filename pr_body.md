## Summary of Changes

1. **Accrued Usage Cap Enforcement**:
   - Updated `listVaultShares` and `assertCapWithinEscrow` in `src/lib/vaultCommitSharing.ts` to subtract total accrued usage (`vault.accruedUsageUsdc`) and active unspent caps when calculating `unallocatedUsdc`.
   - Rejects assigning spend caps larger than net unspent escrow (e.g. assigning a 2 USDC cap when 1.5 USDC has been used of a 2 USDC commitment is refused with a clear message indicating at most 0.5 USDC is available).

2. **Text Copy Update**:
   - Updated button label in `src/components/VaultShareManager.tsx` from `"Share with people"` to `"Share with friends"`.
   - Updated helper prompts, empty state, and share modal text to reference friends.

3. **Desktop Dashboard Palette Brightness**:
   - Softened dark backdrop overlay (`from-black/35 via-black/15 to-black/45`) and updated main panel and active sidebar tab background (`bg-[#131522]/90 backdrop-blur-xl border border-white/10`) to eliminate dark muddy tones and let ambient orb gradients illuminate the front surface.

4. **Mobile Scroll Fix**:
   - Restricted `overflow-y-auto` on the main container to `md:` viewports (`md:overflow-y-auto`) when not in mobile DM view, enabling natural document touch scrolling on mobile devices without gesture trapping.

5. **Automated Unit Tests**:
   - Added `src/lib/__tests__/vault-sharing-caps.test.mjs` verifying accrued usage unallocated budget calculations and cap rejection under usage.
