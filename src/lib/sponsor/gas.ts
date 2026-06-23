/* "Pay For Me" gas sponsorship.
 *
 * On Arc, gas is paid in USDC by the signing EOA. For a SubScript-onboarded user's
 * merchant-directed actions (pay / subscribe / commit), SubScript covers the gas: a
 * funded sponsor wallet just-in-time tops up the user's embedded wallet so the gas
 * never comes out of their principal. The platform recoups it via the 1% merchant fee.
 *
 * Opt-in: set SPONSOR_PRIVATE_KEY (a SubScript-funded EOA). If unset, sponsorship is a
 * no-op and users pay their own gas (current behavior). Strictly for embedded wallets
 * on user→merchant flows — never peer transfers or external wallets.
 */
import { ethers } from "ethers";
import { getRpcProviderForWrite } from "@/lib/payments/rpc";
import { checkProviderRateLimit } from "@/lib/providerRateLimit";

const TOPUP_USDC = process.env.SPONSOR_GAS_TOPUP_USDC || "0.10";
const MIN_USDC = process.env.SPONSOR_GAS_MIN_USDC || "0.02";

export function isGasSponsorshipEnabled() {
    return Boolean(process.env.SPONSOR_PRIVATE_KEY);
}

export type SponsorResult = { sponsored: boolean; txHash?: string; reason?: string };

/**
 * Ensure `beneficiary` has enough native (USDC) gas to submit a tx, topping up from the
 * sponsor wallet when low. Best-effort: never throws — if it fails, the caller's tx
 * simply falls back to the user paying their own gas.
 */
export async function ensureGasSponsored(beneficiary: string): Promise<SponsorResult> {
    try {
        const key = process.env.SPONSOR_PRIVATE_KEY;
        if (!key) return { sponsored: false, reason: "sponsor_disabled" };
        if (!ethers.isAddress(beneficiary)) return { sponsored: false, reason: "invalid_beneficiary" };

        const { provider } = await getRpcProviderForWrite();
        const balance = await provider.getBalance(beneficiary);
        if (balance >= ethers.parseEther(MIN_USDC)) {
            return { sponsored: false, reason: "sufficient_gas" };
        }

        /* Abuse guard: at most one top-up per wallet per 30s. Top-ups are tiny and are
           consumed by gas, so this is belt-and-suspenders against accidental loops. */
        const rl = checkProviderRateLimit({ provider: "gas-sponsor", key: beneficiary.toLowerCase(), limit: 1, windowMs: 30_000 });
        if (!rl.ok) return { sponsored: false, reason: "rate_limited" };

        const sponsor = new ethers.Wallet(key, provider);
        const tx = await sponsor.sendTransaction({ to: beneficiary, value: ethers.parseEther(TOPUP_USDC) });
        await tx.wait();
        return { sponsored: true, txHash: tx.hash };
    } catch (error: any) {
        console.error("[gas-sponsor] top-up failed:", error?.message || error);
        return { sponsored: false, reason: "error" };
    }
}
