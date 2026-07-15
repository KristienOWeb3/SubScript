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

const SPONSOR_REUSE_WINDOW_MS = 30_000;

export function isGasSponsorshipEnabled() {
    return Boolean(process.env.SPONSOR_PRIVATE_KEY);
}

export type SponsorFailureReason =
    | "sponsor_disabled"
    | "invalid_sponsor_config"
    | "invalid_topup_config"
    | "invalid_beneficiary"
    | "rpc_unavailable"
    | "sponsor_underfunded"
    | "topup_failed";

export type SponsorResult = {
    sponsored: boolean;
    txHash?: string;
    reason?: SponsorFailureReason | "recently_sponsored";
};

const FAILURE_MESSAGES: Record<SponsorFailureReason, string> = {
    sponsor_disabled: "Gas sponsorship is not configured on this deployment.",
    invalid_sponsor_config: "The gas sponsor wallet configuration is invalid.",
    invalid_topup_config: "The sponsored gas top-up amount is invalid.",
    invalid_beneficiary: "The wallet receiving sponsored gas is invalid.",
    rpc_unavailable: "The Arc network could not be reached to sponsor gas.",
    sponsor_underfunded: "SubScript's gas sponsor wallet is out of funds.",
    topup_failed: "The sponsored gas top-up transaction failed.",
};

type ConfirmedSponsorship = {
    confirmedAt: number;
    txHash: string;
};

const sponsorState = globalThis as typeof globalThis & {
    subscriptConfirmedGasSponsorships?: Map<string, ConfirmedSponsorship>;
    subscriptGasSponsorshipsInFlight?: Map<string, Promise<SponsorResult>>;
};

function getConfirmedSponsorships() {
    if (!sponsorState.subscriptConfirmedGasSponsorships) {
        sponsorState.subscriptConfirmedGasSponsorships = new Map();
    }
    return sponsorState.subscriptConfirmedGasSponsorships;
}

function getSponsorshipsInFlight() {
    if (!sponsorState.subscriptGasSponsorshipsInFlight) {
        sponsorState.subscriptGasSponsorshipsInFlight = new Map();
    }
    return sponsorState.subscriptGasSponsorshipsInFlight;
}

/**
 * Deduplicate concurrent requests and reuse only a transaction that has already confirmed.
 * Failed balance checks, RPC calls, and sends are deliberately not cached, so a later request
 * can retry immediately after the underlying condition is repaired.
 */
function runSponsorshipAttempt(
    beneficiary: string,
    attempt: () => Promise<SponsorResult>,
): Promise<SponsorResult> {
    const confirmed = getConfirmedSponsorships();
    const cached = confirmed.get(beneficiary);
    if (cached && Date.now() - cached.confirmedAt < SPONSOR_REUSE_WINDOW_MS) {
        return Promise.resolve({
            sponsored: true,
            txHash: cached.txHash,
            reason: "recently_sponsored",
        });
    }
    if (cached) confirmed.delete(beneficiary);

    const inFlight = getSponsorshipsInFlight();
    const existing = inFlight.get(beneficiary);
    if (existing) return existing;

    const pending = Promise.resolve()
        .then(attempt)
        .then((result) => {
            if (result.sponsored && result.txHash) {
                confirmed.set(beneficiary, {
                    confirmedAt: Date.now(),
                    txHash: result.txHash,
                });
            }
            return result;
        })
        .finally(() => {
            if (inFlight.get(beneficiary) === pending) {
                inFlight.delete(beneficiary);
            }
        });

    inFlight.set(beneficiary, pending);
    return pending;
}

/**
 * Credit `beneficiary` with a dedicated native-USDC gas amount before a sponsored action.
 * We always top up instead of inspecting the user's balance: an existing balance is the
 * user's payment principal and must not be reclassified as gas.
 */
export async function ensureGasSponsored(beneficiary: string): Promise<SponsorResult> {
    const key = process.env.SPONSOR_PRIVATE_KEY;
    if (!key) return { sponsored: false, reason: "sponsor_disabled" };
    if (!ethers.isAddress(beneficiary)) return { sponsored: false, reason: "invalid_beneficiary" };

    let offlineSponsor: ethers.Wallet;
    try {
        offlineSponsor = new ethers.Wallet(key);
    } catch (error: any) {
        console.error("[gas-sponsor] invalid sponsor wallet configuration:", error?.message || error);
        return { sponsored: false, reason: "invalid_sponsor_config" };
    }

    /* Arc's native gas currency is USDC, but at the RPC/EVM level it is denominated in
       standard 18-decimal wei units, NOT the 6 decimals of ERC-20 USDC. Empirically verified
       against rpc.testnet.arc.network: a wallet holding 80 USDC reports eth_getBalance of
       80e18, and eth_gasPrice is ~20 gwei (a 21000-gas transfer costs ~0.0004 USDC at 18dp;
       at a 6dp interpretation it would absurdly cost 426M USDC). Scaling the top-up by 1e6
       here sent 1e-13 USDC of gas — a no-op sponsorship. */
    let topupValue: bigint;
    try {
        topupValue = ethers.parseUnits(process.env.SPONSOR_GAS_TOPUP_USDC || "0.10", 18);
        if (topupValue <= BigInt(0)) throw new Error("top-up must be greater than zero");
    } catch (error: any) {
        console.error("[gas-sponsor] invalid top-up configuration:", error?.message || error);
        return { sponsored: false, reason: "invalid_topup_config" };
    }

    const normalizedBeneficiary = beneficiary.toLowerCase();
    return runSponsorshipAttempt(normalizedBeneficiary, async () => {
        let provider: ethers.JsonRpcProvider;
        try {
            ({ provider } = await getRpcProviderForWrite());
        } catch (error: any) {
            console.error("[gas-sponsor] no healthy RPC endpoint:", error?.message || error);
            return { sponsored: false, reason: "rpc_unavailable" };
        }

        const sponsor = offlineSponsor.connect(provider);
        try {
            /* Distinguish an empty sponsor wallet from a transient send failure so operators
               see "fund the sponsor" instead of a generic error. Balance must cover the
               top-up plus the sponsor's own gas for the transfer, so compare with headroom. */
            const balance = await provider.getBalance(sponsor.address);
            if (balance < topupValue * BigInt(2)) {
                console.error(
                    `[gas-sponsor] sponsor wallet ${sponsor.address} underfunded: ` +
                    `balance=${balance.toString()} needed>=${(topupValue * BigInt(2)).toString()} (18dp wei units)`,
                );
                return { sponsored: false, reason: "sponsor_underfunded" };
            }
        } catch (error: any) {
            console.error("[gas-sponsor] sponsor balance check failed:", error?.message || error);
            return { sponsored: false, reason: "rpc_unavailable" };
        }

        try {
            const tx = await sponsor.sendTransaction({ to: beneficiary, value: topupValue });
            const receipt = await tx.wait();
            if (!receipt || Number(receipt.status) !== 1) {
                console.error(`[gas-sponsor] top-up from ${sponsor.address} was not confirmed successfully`);
                return { sponsored: false, reason: "topup_failed" };
            }
            return { sponsored: true, txHash: receipt.hash || tx.hash };
        } catch (error: any) {
            const message: string = error?.message || String(error);
            console.error(`[gas-sponsor] top-up from ${sponsor.address} failed:`, message);
            if (error?.code === "INSUFFICIENT_FUNDS" || message.toLowerCase().includes("insufficient funds")) {
                return { sponsored: false, reason: "sponsor_underfunded" };
            }
            return { sponsored: false, reason: "topup_failed" };
        }
    });
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
