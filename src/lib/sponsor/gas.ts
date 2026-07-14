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

export type SponsorFailureReason =
    | "sponsor_disabled"
    | "invalid_beneficiary"
    | "rpc_unavailable"
    | "sponsor_underfunded"
    | "topup_failed";

export type SponsorResult = { sponsored: boolean; txHash?: string; reason?: string };

const FAILURE_MESSAGES: Record<SponsorFailureReason, string> = {
    sponsor_disabled: "Gas sponsorship is not configured on this deployment.",
    invalid_beneficiary: "The wallet receiving sponsored gas is invalid.",
    rpc_unavailable: "The Arc network could not be reached to sponsor gas.",
    sponsor_underfunded: "SubScript's gas sponsor wallet is out of funds.",
    topup_failed: "The sponsored gas top-up transaction failed.",
};

/**
 * Credit `beneficiary` with a dedicated native-USDC gas amount before a sponsored action.
 * We always top up instead of inspecting the user's balance: an existing balance is the
 * user's payment principal and must not be reclassified as gas.
 */
export async function ensureGasSponsored(beneficiary: string): Promise<SponsorResult> {
    const key = process.env.SPONSOR_PRIVATE_KEY;
    if (!key) return { sponsored: false, reason: "sponsor_disabled" };
    if (!ethers.isAddress(beneficiary)) return { sponsored: false, reason: "invalid_beneficiary" };

    let provider: ethers.JsonRpcProvider;
    try {
        ({ provider } = await getRpcProviderForWrite());
    } catch (error: any) {
        console.error("[gas-sponsor] no healthy RPC endpoint:", error?.message || error);
        return { sponsored: false, reason: "rpc_unavailable" };
    }

    /* A single sponsored product action can submit approval + payment transactions.
       Repeated requests inside 30 seconds reuse the first dedicated gas credit. */
    const rl = checkProviderRateLimit({ provider: "gas-sponsor", key: beneficiary.toLowerCase(), limit: 1, windowMs: 30_000 });
    if (!rl.ok) return { sponsored: true, reason: "recently_sponsored" };

    const sponsor = new ethers.Wallet(key, provider);
    /* Arc's native gas currency is USDC with 6 decimals (see ARC_TESTNET/ARC_MAINNET
       nativeCurrency). The tx `value` is denominated in those 6-decimal base units, so the
       top-up must be scaled by 1e6 — parseEther (1e18) would over-send by ~1e12x. */
    const topupValue = ethers.parseUnits(TOPUP_USDC, 6);

    try {
        /* Distinguish an empty sponsor wallet from a transient send failure so operators
           see "fund the sponsor" instead of a generic error. Balance must cover the
           top-up plus the sponsor's own gas for the transfer, so compare with headroom. */
        const balance = await sponsor.provider!.getBalance(sponsor.address);
        if (balance < topupValue * BigInt(2)) {
            console.error(
                `[gas-sponsor] sponsor wallet ${sponsor.address} underfunded: ` +
                `balance=${balance.toString()} needed>=${(topupValue * BigInt(2)).toString()} (6dp USDC base units)`,
            );
            return { sponsored: false, reason: "sponsor_underfunded" };
        }
    } catch (error: any) {
        console.error("[gas-sponsor] sponsor balance check failed:", error?.message || error);
        return { sponsored: false, reason: "rpc_unavailable" };
    }

    try {
        const tx = await sponsor.sendTransaction({ to: beneficiary, value: topupValue });
        await tx.wait();
        return { sponsored: true, txHash: tx.hash };
    } catch (error: any) {
        const message: string = error?.message || String(error);
        console.error(`[gas-sponsor] top-up from ${sponsor.address} failed:`, message);
        if (error?.code === "INSUFFICIENT_FUNDS" || message.toLowerCase().includes("insufficient funds")) {
            return { sponsored: false, reason: "sponsor_underfunded" };
        }
        return { sponsored: false, reason: "topup_failed" };
    }
}

export async function requireGasSponsored(beneficiary: string): Promise<SponsorResult> {
    const result = await ensureGasSponsored(beneficiary);
    if (!result.sponsored) {
        const detail = FAILURE_MESSAGES[result.reason as SponsorFailureReason]
            || "Gas sponsorship is temporarily unavailable.";
        throw new Error(`${detail} No payment was submitted — your funds were not touched. Please try again shortly.`);
    }
    return result;
}
