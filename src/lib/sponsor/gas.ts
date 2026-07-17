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
import { executeWithRpcFallback, getRpcProviderForWrite } from "@/lib/payments/rpc";

const SPONSOR_REUSE_WINDOW_MS = 30_000;
const TOPUP_RECEIPT_ATTEMPTS = 15;
const TOPUP_RECEIPT_POLL_MS = 1_000;

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

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function confirmSubmittedTopup(txHash: string) {
    let lastError: unknown = null;

    /* The signed transfer has already been broadcast, so confirmation is read-only and may
       safely move across RPC providers. Poll the receipt directly instead of tx.wait():
       ethers' wait path repeatedly calls eth_blockNumber, Arc's most aggressively throttled
       method, and used to report a successful top-up as failed after it had already mined. */
    for (let attempt = 1; attempt <= TOPUP_RECEIPT_ATTEMPTS; attempt++) {
        try {
            const { result: receipt } = await executeWithRpcFallback(
                (provider) => provider.getTransactionReceipt(txHash),
            );
            if (receipt) return receipt;
        } catch (error) {
            lastError = error;
            console.warn(
                `[gas-sponsor] receipt lookup ${attempt}/${TOPUP_RECEIPT_ATTEMPTS} failed for ${txHash}:`,
                error instanceof Error ? error.message : error,
            );
        }
        if (attempt < TOPUP_RECEIPT_ATTEMPTS) {
            await sleep(TOPUP_RECEIPT_POLL_MS);
        }
    }

    throw lastError || new Error(`Sponsored gas top-up ${txHash} was not confirmed before timeout`);
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

        let tx: ethers.TransactionResponse;
        try {
            tx = await sponsor.sendTransaction({ to: beneficiary, value: topupValue });
            console.log(
                `[gas-sponsor] top-up submitted from ${sponsor.address} to ${normalizedBeneficiary}: ${tx.hash}`,
            );
        } catch (error: any) {
            const message: string = error?.message || String(error);
            console.error(`[gas-sponsor] top-up submission from ${sponsor.address} failed:`, message);
            if (error?.code === "INSUFFICIENT_FUNDS" || message.toLowerCase().includes("insufficient funds")) {
                return { sponsored: false, reason: "sponsor_underfunded" };
            }
            return { sponsored: false, reason: "topup_failed" };
        }

        try {
            const receipt = await confirmSubmittedTopup(tx.hash);
            if (!receipt || Number(receipt.status) !== 1) {
                console.error(
                    `[gas-sponsor] submitted top-up ${tx.hash} from ${sponsor.address} reverted or was not confirmed successfully`,
                );
                return { sponsored: false, reason: "topup_failed" };
            }
            return { sponsored: true, txHash: receipt.hash || tx.hash };
        } catch (error: any) {
            const message: string = error?.message || String(error);
            console.error(`[gas-sponsor] confirmation failed for submitted top-up ${tx.hash}:`, message);
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

/* ------------------------------------------------------------------------------------------------
 * Low-level primitives for the durable, custody-aware sponsorship orchestrator
 * (@/lib/sponsor/sponsorship). These carry no caching or dedupe of their own — the orchestrator
 * owns idempotency through sponsored_gas_operations rows shared across serverless instances.
 * ---------------------------------------------------------------------------------------------- */

export type PreparedSponsorTransferOutcome =
    | { outcome: "prepared"; txHash: string; preparedTransaction: string }
    | { outcome: "failed_pre_broadcast"; reason: SponsorFailureReason };

export type SponsorTransferOutcome =
    | { outcome: "confirmed"; txHash: string }
    | { outcome: "reverted"; txHash: string }
    /* Broadcast happened but the receipt did not arrive in time. The transfer may still mine —
       it must be reconciled by hash, never resubmitted. */
    | { outcome: "submitted_unconfirmed"; txHash: string };

/**
 * Prepare and sign one exact sponsor transfer without broadcasting it. The caller must persist
 * both the hash and signed transaction before calling submitPreparedSponsorTransfer; this closes
 * the crash window where funds could move before any durable identity existed.
 */
export async function prepareSponsorTransfer(
    beneficiary: string,
    valueWei: bigint,
): Promise<PreparedSponsorTransferOutcome> {
    const key = process.env.SPONSOR_PRIVATE_KEY;
    if (!key) return { outcome: "failed_pre_broadcast", reason: "sponsor_disabled" };
    if (!ethers.isAddress(beneficiary)) return { outcome: "failed_pre_broadcast", reason: "invalid_beneficiary" };
    if (valueWei <= BigInt(0)) return { outcome: "failed_pre_broadcast", reason: "invalid_topup_config" };

    let offlineSponsor: ethers.Wallet;
    try {
        offlineSponsor = new ethers.Wallet(key);
    } catch (error: any) {
        console.error("[gas-sponsor] invalid sponsor wallet configuration:", error?.message || error);
        return { outcome: "failed_pre_broadcast", reason: "invalid_sponsor_config" };
    }

    let provider: ethers.JsonRpcProvider;
    try {
        ({ provider } = await getRpcProviderForWrite());
    } catch (error: any) {
        console.error("[gas-sponsor] no healthy RPC endpoint:", error?.message || error);
        return { outcome: "failed_pre_broadcast", reason: "rpc_unavailable" };
    }

    const sponsor = offlineSponsor.connect(provider);
    try {
        const balance = await provider.getBalance(sponsor.address);
        if (balance < valueWei * BigInt(2)) {
            console.error(
                `[gas-sponsor] sponsor wallet ${sponsor.address} underfunded: ` +
                `balance=${balance.toString()} needed>=${(valueWei * BigInt(2)).toString()} (18dp wei units)`,
            );
            return { outcome: "failed_pre_broadcast", reason: "sponsor_underfunded" };
        }
    } catch (error: any) {
        console.error("[gas-sponsor] sponsor balance check failed:", error?.message || error);
        return { outcome: "failed_pre_broadcast", reason: "rpc_unavailable" };
    }

    try {
        const populated = await sponsor.populateTransaction({ to: beneficiary, value: valueWei });
        const preparedTransaction = await offlineSponsor.signTransaction(populated);
        return {
            outcome: "prepared",
            txHash: ethers.keccak256(preparedTransaction).toLowerCase(),
            preparedTransaction: preparedTransaction.toLowerCase(),
        };
    } catch (error: any) {
        const message: string = error?.message || String(error);
        console.error(`[gas-sponsor] top-up preparation from ${sponsor.address} failed:`, message);
        if (error?.code === "INSUFFICIENT_FUNDS" || message.toLowerCase().includes("insufficient funds")) {
            return { outcome: "failed_pre_broadcast", reason: "sponsor_underfunded" };
        }
        return { outcome: "failed_pre_broadcast", reason: "topup_failed" };
    }
}

/**
 * Broadcast a previously persisted signed transfer and confirm it through read-only RPC
 * failover. Replaying this function is safe: the raw bytes always hash to the same transaction.
 */
export async function submitPreparedSponsorTransfer(
    preparedTransaction: string,
    expectedTxHash: string,
): Promise<SponsorTransferOutcome> {
    let computedHash: string;
    try {
        computedHash = ethers.keccak256(preparedTransaction).toLowerCase();
    } catch {
        throw new Error("Invalid prepared sponsor transaction");
    }
    if (computedHash !== expectedTxHash.toLowerCase()) {
        throw new Error("Prepared sponsor transaction hash mismatch");
    }

    const existing = await reconcileSponsorTransferByHash(computedHash);
    if (existing !== "pending") {
        return { outcome: existing, txHash: computedHash };
    }

    try {
        const { provider } = await getRpcProviderForWrite();
        await provider.broadcastTransaction(preparedTransaction);
        console.log(`[gas-sponsor] persisted bounded top-up submitted: ${computedHash}`);
    } catch (error: any) {
        /* The RPC may have accepted the bytes before its response was lost. The prepared
           transaction remains durable and retries rebroadcast these exact bytes only. */
        console.warn(`[gas-sponsor] prepared top-up broadcast was ambiguous for ${computedHash}:`, error?.message || error);
    }

    try {
        const receipt = await confirmSubmittedTopup(computedHash);
        if (receipt && Number(receipt.status) === 1) {
            return { outcome: "confirmed", txHash: receipt.hash || computedHash };
        }
        return { outcome: "reverted", txHash: receipt?.hash || computedHash };
    } catch (error: any) {
        console.error(`[gas-sponsor] confirmation timed out for submitted top-up ${computedHash}:`, error?.message || error);
        return { outcome: "submitted_unconfirmed", txHash: computedHash };
    }
}

export type SponsorTransferReconciliation = "confirmed" | "reverted" | "pending";

/**
 * Read-only reconciliation of a prepared/submitted sponsor transfer. A reverted receipt is a
 * definitive terminal outcome; unavailable receipts remain pending and must never trigger a new
 * transaction identity.
 */
export async function reconcileSponsorTransferByHash(txHash: string): Promise<SponsorTransferReconciliation> {
    try {
        const { result: receipt } = await executeWithRpcFallback(
            (provider) => provider.getTransactionReceipt(txHash),
        );
        if (!receipt) return "pending";
        return Number((receipt as { status?: number }).status) === 1 ? "confirmed" : "reverted";
    } catch (error) {
        console.warn(`[gas-sponsor] reconciliation lookup failed for ${txHash}:`, error instanceof Error ? error.message : error);
        return "pending";
    }
}
