/* Custody-aware, durable, budgeted gas sponsorship.
 *
 * This is the ONLY entry point routes and workers may use to sponsor gas. It decides,
 * server-side, how a wallet's gas is paid:
 *
 *   - Circle SCA wallets: Circle Gas Station pays gas inside the 4337 pipeline. No
 *     SPONSOR_PRIVATE_KEY transfer is ever sent to them.
 *   - Circle EOA / legacy encrypted-key EOA wallets: a bounded top-up from the sponsor
 *     wallet, recorded durably in sponsored_gas_operations and shared across instances.
 *   - External (browser) wallets: never sponsored.
 *
 * Idempotency: every sponsorship requires a stable requestKey. Retries — same instance,
 * another instance, after a crash — reuse the durable record. A submitted transfer is
 * reconciled by transaction hash, never resubmitted because receipt polling timed out.
 */
import { ethers } from "ethers";
import { pgMaybeOne } from "@/lib/serverPg";
import { executeWithRpcFallback } from "@/lib/payments/rpc";
import { configuredAccountType } from "@/lib/circle/devWallets";
import {
    isGasSponsorshipEnabled,
    prepareSponsorTransfer,
    reconcileSponsorTransferByHash,
    submitPreparedSponsorTransfer,
} from "@/lib/sponsor/gas";

export type SponsorCustody = "CIRCLE_SCA" | "CIRCLE_EOA" | "LEGACY_EOA";

export type SponsoredGasAction =
    | "execute_tx"
    | "vault_commit"
    | "vault_withdraw"
    | "subscribe"
    | "subscription_change"
    | "subscription_cancel"
    | "billing_renewal"
    | "drift_heal";

export interface SponsoredGasRequest {
    /** Beneficiary wallet (must be a SubScript custodial wallet). */
    wallet: string;
    action: SponsoredGasAction;
    /**
     * Stable operation id: retries of the SAME logical operation MUST reuse it (vault intent id,
     * subscription id + period, client x-request-id). A fresh key per retry defeats every
     * durability guarantee here.
     */
    requestKey: string;
    /**
     * The financial amount (native 18-decimal units) the wallet is about to spend, when known.
     * That principal is excluded from "available gas" so it is never reclassified as
     * platform-sponsored gas. When unknown, the full gas target is sponsored.
     */
    principalRequiredWei?: bigint;
}

export interface SponsoredGasResult {
    sponsored: boolean;
    method?: "gas_station" | "sponsor_topup" | "sufficient_balance" | "reused_topup";
    custody?: SponsorCustody;
    txHash?: string;
    /** True when a transfer was broadcast but not yet confirmed — reconcile, never resubmit. */
    ambiguous?: boolean;
    reason?: string;
}

export type SponsoredGasFailureKind = "definitive" | "ambiguous";

/** Structured fail-closed outcome for routes that must distinguish a retryable durable
 * transaction from a definitive failure known to have happened before financial submission. */
export class SponsoredGasError extends Error {
    readonly name = "SponsoredGasError";

    constructor(
        message: string,
        readonly kind: SponsoredGasFailureKind,
        readonly reason?: string,
        readonly txHash?: string,
    ) {
        super(message);
    }
}

export function isSponsoredGasError(error: unknown): error is SponsoredGasError {
    return error instanceof SponsoredGasError;
}

const DEFAULTS = {
    walletDailyLimit: 10,
    actionDailyLimit: 5,
    globalDailyBudgetUsdc: "50",
    gasTargetUsdc: "0.10",
};

function positiveIntEnv(name: string, fallback: number): number {
    const raw = Number(process.env[name]);
    return Number.isInteger(raw) && raw > 0 ? raw : fallback;
}

function gasTargetWei(): bigint {
    return ethers.parseUnits(process.env.SPONSOR_GAS_TOPUP_USDC || DEFAULTS.gasTargetUsdc, 18);
}

function globalDailyBudgetWei(): bigint {
    return ethers.parseUnits(process.env.SPONSOR_GLOBAL_DAILY_BUDGET_USDC || DEFAULTS.globalDailyBudgetUsdc, 18);
}

/* Same-instance single flight per request key; the DB lease serializes across instances. */
const inFlightState = globalThis as typeof globalThis & {
    subscriptSponsorshipsInFlight?: Map<string, Promise<SponsoredGasResult>>;
};
function inFlight() {
    if (!inFlightState.subscriptSponsorshipsInFlight) {
        inFlightState.subscriptSponsorshipsInFlight = new Map();
    }
    return inFlightState.subscriptSponsorshipsInFlight;
}

/** Server-side custody detection. Never trusts a client assertion. */
export async function detectSponsorCustody(wallet: string): Promise<SponsorCustody | null> {
    const record = await pgMaybeOne<{ circle_wallet_id: string | null; encrypted_private_key: string | null }>(
        "select circle_wallet_id, encrypted_private_key from user_embedded_wallets where wallet_address = $1 limit 1",
        [wallet.toLowerCase()],
    );
    if (!record) return null;
    if (record.circle_wallet_id) {
        return configuredAccountType() === "SCA" ? "CIRCLE_SCA" : "CIRCLE_EOA";
    }
    return record.encrypted_private_key ? "LEGACY_EOA" : null;
}

async function claimOperation(params: {
    requestKey: string;
    wallet: string;
    action: SponsoredGasAction;
    custody: SponsorCustody;
    requestedWei: bigint;
}): Promise<{
    outcome: string;
    leaseToken?: string;
    sponsorTxHash?: string;
    preparedTransaction?: string;
    status?: string;
    failureReason?: string;
}> {
    const row = await pgMaybeOne<{ result: {
        outcome: string;
        leaseToken?: string;
        sponsorTxHash?: string;
        preparedTransaction?: string;
        status?: string;
        failureReason?: string;
    } }>(
        `select public.claim_sponsored_gas_operation($1, $2, $3, $4, $5, $6, $7, $8) as result`,
        [
            params.requestKey,
            params.wallet.toLowerCase(),
            params.action,
            params.custody,
            params.requestedWei.toString(),
            positiveIntEnv("SPONSOR_WALLET_DAILY_LIMIT", DEFAULTS.walletDailyLimit),
            positiveIntEnv("SPONSOR_ACTION_DAILY_LIMIT", DEFAULTS.actionDailyLimit),
            globalDailyBudgetWei().toString(),
        ],
    );
    if (!row?.result?.outcome) throw new Error("gas sponsorship claim returned no outcome");
    return row.result;
}

async function updateOperation(params: {
    requestKey: string;
    leaseToken: string;
    status: "PREPARED" | "SUBMITTED" | "CONFIRMED" | "SKIPPED_SUFFICIENT_BALANCE" | "FAILED";
    sponsorTxHash?: string;
    preparedTransaction?: string;
    failureReason?: string;
}): Promise<void> {
    const row = await pgMaybeOne<{ result?: { outcome?: string } }>(
        `select public.update_sponsored_gas_operation($1, $2, $3, $4, $5, $6, $7) as result`,
        [
            params.requestKey,
            params.leaseToken,
            params.status,
            params.sponsorTxHash ?? null,
            params.failureReason ?? null,
            null,
            params.preparedTransaction ?? null,
        ],
    );
    const outcome = row?.result?.outcome;
    if (outcome !== "UPDATED" && outcome !== "ALREADY_TERMINAL") {
        throw new Error(`gas sponsorship state update failed: ${outcome || "no outcome"}`);
    }
}

async function runSponsorship(request: SponsoredGasRequest): Promise<SponsoredGasResult> {
    const wallet = request.wallet.toLowerCase();

    if (process.env.SPONSOR_EMERGENCY_STOP === "true") {
        console.error("[gas-sponsor] EMERGENCY STOP active — refusing sponsorship", { wallet, action: request.action });
        return { sponsored: false, reason: "emergency_stop" };
    }

    const custody = await detectSponsorCustody(wallet);
    if (!custody) {
        return { sponsored: false, reason: "not_custodial" };
    }

    if (custody === "CIRCLE_SCA") {
        /* Gas Station pays SCA gas inside Circle's pipeline — a direct EOA top-up would be
           free money the account contract never uses for fees. The terminal Gas Station row is
           required before success so metrics and request-key custody binding cannot disappear. */
        const gasStationClaim = await claimOperation({
            ...requestIdentity(request, wallet),
            custody,
            requestedWei: BigInt(0),
        });
        if (gasStationClaim.outcome !== "GAS_STATION"
            && !(gasStationClaim.outcome === "REUSED" && gasStationClaim.status === "SKIPPED_GAS_STATION")) {
            return { sponsored: false, custody, reason: gasStationClaim.outcome.toLowerCase() };
        }
        return { sponsored: true, method: "gas_station", custody };
    }

    if (!isGasSponsorshipEnabled()) {
        return { sponsored: false, custody, reason: "sponsor_disabled" };
    }

    /* Bounded deficit: sponsor only the gas the wallet is missing. The payer's principal
       (when declared) is reserved and never counted as available gas. When the principal is
       unknown we assume none of the balance is spare, preserving the never-touch-principal
       guarantee at the cost of a full top-up. */
    const target = gasTargetWei();
    let requestedWei = target;
    try {
        const { result: balance } = await executeWithRpcFallback(
            (provider) => provider.getBalance(wallet),
        );
        if (request.principalRequiredWei !== undefined) {
            const reserved = request.principalRequiredWei < BigInt(0) ? BigInt(0) : request.principalRequiredWei;
            const availableForGas = (balance as bigint) > reserved ? (balance as bigint) - reserved : BigInt(0);
            requestedWei = availableForGas >= target ? BigInt(0) : target - availableForGas;
        }
    } catch (error) {
        console.warn("[gas-sponsor] beneficiary balance check failed; sponsoring the full target:", error instanceof Error ? error.message : error);
    }

    const claim = await claimOperation({ ...requestIdentity(request, wallet), custody, requestedWei });

    switch (claim.outcome) {
        case "REUSED":
            if (claim.status === "FAILED") {
                return {
                    sponsored: false,
                    custody,
                    txHash: claim.sponsorTxHash,
                    reason: claim.failureReason || "topup_reverted",
                };
            }
            return {
                sponsored: true,
                method: claim.status === "SKIPPED_SUFFICIENT_BALANCE" ? "sufficient_balance" : "reused_topup",
                custody,
                txHash: claim.sponsorTxHash,
            };
        case "RECONCILE": {
            /* A transaction identity is already durable. Confirm it first; if it was only
               prepared, rebroadcast those exact signed bytes, never prepare a replacement. */
            const leaseToken = claim.leaseToken;
            const txHash = claim.sponsorTxHash;
            if (!leaseToken || !txHash) {
                return { sponsored: false, custody, ambiguous: true, reason: "reconciliation_state_incomplete" };
            }
            let reconciliation = await reconcileSponsorTransferByHash(txHash);
            if (reconciliation === "pending" && claim.preparedTransaction) {
                const submitted = await submitPreparedSponsorTransfer(claim.preparedTransaction, txHash);
                reconciliation = submitted.outcome === "submitted_unconfirmed" ? "pending" : submitted.outcome;
            }
            if (reconciliation === "confirmed") {
                await updateOperation({
                    requestKey: request.requestKey,
                    leaseToken,
                    status: "CONFIRMED",
                    sponsorTxHash: txHash,
                });
                return { sponsored: true, method: "reused_topup", custody, txHash };
            }
            if (reconciliation === "reverted") {
                await updateOperation({
                    requestKey: request.requestKey,
                    leaseToken,
                    status: "FAILED",
                    sponsorTxHash: txHash,
                    failureReason: "topup_reverted",
                });
                return { sponsored: false, custody, txHash, reason: "topup_reverted" };
            }
            console.warn("[gas-sponsor] submitted top-up still unconfirmed; refusing to resubmit", {
                wallet, action: request.action, txHash,
            });
            return { sponsored: false, custody, txHash, ambiguous: true, reason: "topup_unconfirmed" };
        }
        case "IN_PROGRESS":
            return {
                sponsored: false,
                custody,
                txHash: claim.sponsorTxHash,
                ambiguous: Boolean(claim.sponsorTxHash),
                reason: "in_progress",
            };
        case "WALLET_LIMIT":
        case "ACTION_LIMIT":
        case "BUDGET_EXHAUSTED":
            console.error(`[gas-sponsor] sponsorship refused: ${claim.outcome}`, { wallet, action: request.action });
            return { sponsored: false, custody, reason: claim.outcome.toLowerCase() };
        case "KEY_CONFLICT":
            return { sponsored: false, custody, reason: "request_key_conflict" };
        case "CLAIMED":
            break;
        default:
            return { sponsored: false, custody, reason: "claim_failed" };
    }

    const leaseToken = claim.leaseToken as string;

    if (requestedWei === BigInt(0)) {
        await updateOperation({ requestKey: request.requestKey, leaseToken, status: "SKIPPED_SUFFICIENT_BALANCE" });
        return { sponsored: true, method: "sufficient_balance", custody };
    }

    const prepared = await prepareSponsorTransfer(wallet, requestedWei);
    if (prepared.outcome === "failed_pre_broadcast") {
        await updateOperation({
            requestKey: request.requestKey, leaseToken, status: "FAILED", failureReason: prepared.reason,
        });
        return { sponsored: false, custody, reason: prepared.reason };
    }
    /* This write is the broadcast gate: failure leaves funds untouched and must propagate. */
    await updateOperation({
        requestKey: request.requestKey,
        leaseToken,
        status: "PREPARED",
        sponsorTxHash: prepared.txHash,
        preparedTransaction: prepared.preparedTransaction,
    });

    const transfer = await submitPreparedSponsorTransfer(prepared.preparedTransaction, prepared.txHash);
    if (transfer.outcome === "reverted") {
        await updateOperation({
            requestKey: request.requestKey,
            leaseToken,
            status: "FAILED",
            sponsorTxHash: transfer.txHash,
            failureReason: "topup_reverted",
        });
        return { sponsored: false, custody, txHash: transfer.txHash, reason: "topup_reverted" };
    }
    if (transfer.outcome === "submitted_unconfirmed") {
        try {
            await updateOperation({
                requestKey: request.requestKey, leaseToken, status: "SUBMITTED", sponsorTxHash: transfer.txHash,
            });
        } catch (error) {
            /* PREPARED with the same signed bytes is already durable, so retry remains safe. */
            console.error("[gas-sponsor] submitted top-up state advance failed; prepared outbox retained:", error);
        }
        return { sponsored: false, custody, txHash: transfer.txHash, ambiguous: true, reason: "topup_unconfirmed" };
    }
    try {
        await updateOperation({
            requestKey: request.requestKey, leaseToken, status: "CONFIRMED", sponsorTxHash: transfer.txHash,
        });
    } catch (error) {
        console.error("[gas-sponsor] confirmed top-up state advance failed; prepared outbox retained:", error);
        return {
            sponsored: false,
            custody,
            txHash: transfer.txHash,
            ambiguous: true,
            reason: "confirmation_persistence_failed",
        };
    }
    return { sponsored: true, method: "sponsor_topup", custody, txHash: transfer.txHash };
}

function requestIdentity(request: SponsoredGasRequest, wallet: string) {
    return { requestKey: request.requestKey, wallet, action: request.action };
}

/**
 * Best-effort sponsorship. Callers that proceed regardless (background renewals) use this;
 * user-initiated financial routes must use requireSponsoredGas instead.
 */
export async function ensureSponsoredGas(request: SponsoredGasRequest): Promise<SponsoredGasResult> {
    if (!ethers.isAddress(request.wallet)) return { sponsored: false, reason: "invalid_beneficiary" };
    if (typeof request.requestKey !== "string" || request.requestKey.length < 8 || request.requestKey.length > 256) {
        return { sponsored: false, reason: "invalid_request_key" };
    }
    const flightKey = `${request.requestKey}`;
    const flights = inFlight();
    const existing = flights.get(flightKey);
    if (existing) return existing;
    const pending = runSponsorship(request).finally(() => {
        if (flights.get(flightKey) === pending) flights.delete(flightKey);
    });
    flights.set(flightKey, pending);
    return pending;
}

/**
 * Fail-closed sponsorship for user-initiated financial routes: the financial transaction must
 * not be submitted unless this resolves. Runs BEFORE the financial operation by contract.
 */
export async function requireSponsoredGas(request: SponsoredGasRequest): Promise<SponsoredGasResult> {
    const result = await ensureSponsoredGas(request);
    if (result.sponsored) return result;
    if (result.ambiguous) {
        /* A sponsor transfer may still confirm. Do NOT claim anything about fund movement —
           just stop before the financial operation and let the retry reconcile by hash. */
        throw new SponsoredGasError(
            "Gas sponsorship is still confirming a previous top-up. Please retry in a moment; do not submit a duplicate payment.",
            "ambiguous",
            result.reason,
            result.txHash,
        );
    }
    throw new SponsoredGasError(
        sponsorFailureMessage(result.reason),
        "definitive",
        result.reason,
        result.txHash,
    );
}

function sponsorFailureMessage(reason?: string): string {
    const detail = reason === "sponsor_disabled" ? "Gas sponsorship is not configured on this deployment."
        : reason === "not_custodial" ? "Gas sponsorship is only available for SubScript-managed wallets."
        : reason === "emergency_stop" ? "Gas sponsorship is temporarily paused."
        : reason === "wallet_limit" || reason === "action_limit" ? "This wallet has reached its daily sponsored-gas limit."
        : reason === "budget_exhausted" ? "The platform's daily gas sponsorship budget is exhausted."
        : reason === "in_progress" ? "Another request is already sponsoring gas for this operation."
        : "Gas sponsorship is temporarily unavailable.";
    /* This message is only reachable before the financial transaction is submitted. */
    return `${detail} No payment was submitted — your funds were not touched. Please try again shortly.`;
}
