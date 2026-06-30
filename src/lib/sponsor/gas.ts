/* "Pay For Me" gas sponsorship.
 *
 * On Arc, gas is paid in USDC by the signing EOA. For a SubScript-onboarded user's
 * merchant-directed actions (pay / subscribe / commit), SubScript covers the gas: a
 * funded sponsor wallet just-in-time tops up the user's embedded wallet so the gas
 * never comes out of their principal. The platform recoups it via the 1% merchant fee.
 *
 * Required for sponsored flows: set SPONSOR_PRIVATE_KEY to a funded SubScript EOA.
 * Sponsored callers fail closed when a top-up cannot be delivered, so the advertised
 * payment amount is never silently reduced by gas.
 */
import { ethers } from "ethers";
import { getRpcProviderForWrite } from "@/lib/payments/rpc";
import { checkProviderRateLimit } from "@/lib/providerRateLimit";

const TOPUP_USDC = process.env.SPONSOR_GAS_TOPUP_USDC || "0.10";

export function isGasSponsorshipEnabled() {
    return Boolean(process.env.SPONSOR_PRIVATE_KEY);
}

export type SponsorResult = { sponsored: boolean; txHash?: string; reason?: string };

/**
 * Credit `beneficiary` with a dedicated native-USDC gas amount before a sponsored action.
 * We always top up instead of inspecting the user's balance: an existing balance is the
 * user's payment principal and must not be reclassified as gas.
 */
export async function ensureGasSponsored(beneficiary: string): Promise<SponsorResult> {
    try {
        const key = process.env.SPONSOR_PRIVATE_KEY;
        if (!key) return { sponsored: false, reason: "sponsor_disabled" };
        if (!ethers.isAddress(beneficiary)) return { sponsored: false, reason: "invalid_beneficiary" };

        const { provider } = await getRpcProviderForWrite();
        /* A single sponsored product action can submit approval + payment transactions.
           Repeated requests inside 30 seconds reuse the first dedicated gas credit. */
        const rl = checkProviderRateLimit({ provider: "gas-sponsor", key: beneficiary.toLowerCase(), limit: 1, windowMs: 30_000 });
        if (!rl.ok) return { sponsored: true, reason: "recently_sponsored" };

        const sponsor = new ethers.Wallet(key, provider);
        const tx = await sponsor.sendTransaction({ to: beneficiary, value: ethers.parseEther(TOPUP_USDC) });
        await tx.wait();
        return { sponsored: true, txHash: tx.hash };
    } catch (error: any) {
        console.error("[gas-sponsor] top-up failed:", error?.message || error);
        return { sponsored: false, reason: "error" };
    }
}

export async function requireGasSponsored(beneficiary: string): Promise<SponsorResult> {
    const result = await ensureGasSponsored(beneficiary);
    if (!result.sponsored) {
        throw new Error(`Gas sponsorship unavailable (${result.reason || "unknown"}). No payment was submitted.`);
    }
    return result;
}
