import { randomUUID, createHash } from "node:crypto";
import { ethers } from "ethers";
import { pgMaybeOne } from "@/lib/serverPg";
import { getDevWalletsClient } from "@/lib/circle/devWallets";

/*
 * Wallet custody provider abstraction (Phase 1, Stage 2c).
 *
 * Every server-side signing operation for a *user embedded wallet* funnels through this seam so
 * the underlying custody model can change without touching call sites.
 *
 * All user wallets are Circle developer-controlled (MPC) wallets — no extractable keys.
 * Contract writes go through Circle's contract-execution transaction API and EIP-712 signing
 * through its signTypedData API, authorized by the entity secret.
 */

export type CustodyKind = "circle";

/** A state-changing contract call, backend-agnostic. Args follow ethers conventions (bigint ok). */
export interface ContractCall {
    contractAddress: string;
    abi: ethers.InterfaceAbi;
    functionName: string;
    args?: ReadonlyArray<unknown>;
    /**
     * Optional durable idempotency key. When set, a retried logical operation submits the SAME
     * key so the Circle backend dedupes it (its API keys on this) instead of double-submitting a
     * financial transaction after a timed-out response. Must be a stable seed for the operation —
     * only pass one for operations that are idempotent by identity (e.g. cancel a specific sub);
     * never for raw transfers, where two identical payments are legitimately distinct. Prefer
     * `deterministicIdempotencyKey(seed)` to build a well-formed UUID from an application seed.
     */
    idempotencyKey?: string;
    /**
     * Explicit gas-payer policy for this call. "platform" (default) is a sponsored merchant-commerce
     * or keeper operation; "wallet" marks a USER-PAID call (peer send / withdrawal) whose gas the
     * sender bears via fee-recovery. A "wallet" call must never be routed through the sponsorship
     * orchestrator or a sponsor top-up — the classifier in @/lib/sponsor/policy decides which it is.
     */
    gasPayer?: "platform" | "wallet";
    /**
     * When true (default), wait until transaction is CONFIRMED on chain.
     * When false, return immediately upon successful transaction creation/acceptance at Circle
     * (returns circleTxId and submissionDurationMs).
     */
    waitForConfirmation?: boolean;
}

/**
 * Derive a stable RFC-4122 UUID from an application seed. Circle's idempotencyKey must be UUID-
 * shaped, so hashing the seed and formatting it as a v5-style UUID lets a retried operation reuse
 * the exact same key deterministically.
 */
export function deterministicIdempotencyKey(seed: string): string {
    const h = createHash("sha256").update(seed).digest("hex");
    const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Coerce a caller-supplied idempotency key into the UUID shape Circle requires.
 *
 * Circle rejects a non-UUID key with `400 API parameter invalid` — a generic message that names no
 * field, so it reads as "the transaction was malformed" rather than "your key is the wrong shape".
 * `/api/user/subscription/resume` shipped passing its raw seed (`resume:0x<contract>:<subId>`)
 * straight through, so every resume 400'd at the custody boundary and the subscriber was told their
 * subscription could not be restored. `/api/user/subscription/upgrade` carried the identical
 * mistake, and there it landed after the old authorization had already been revoked.
 *
 * Normalizing here rather than only at those two call sites because the failure is silent at the
 * type level: `idempotencyKey?: string` accepts any string, the doc comment saying to prefer
 * `deterministicIdempotencyKey` is advisory, and the error surfaces from Circle rather than from us.
 * A well-formed UUID passes through untouched, so this only ever rescues a key that was already
 * guaranteed to fail.
 *
 * Call sites should still seed through `deterministicIdempotencyKey` themselves when they persist
 * the key (e.g. `subscription_attempts.provider_idempotency_key`), so the stored value matches what
 * Circle actually saw.
 */
export function circleIdempotencyKey(key: string): string {
    return UUID_PATTERN.test(key) ? key.toLowerCase() : deterministicIdempotencyKey(key);
}

/**
 * Idempotency key for cancelling a specific subscription. A subId is terminal and single-use, so it
 * is safe to dedupe across every caller path (the execute-tx route and cancelFromEmbedded). Defined
 * once here so both paths produce the exact same key — if the formula drifted between them, a retry
 * on the other path would stop deduping and, since cancelling twice reverts on-chain, surface as a
 * false execution failure even though the subscription is already cancelled.
 */
export function cancelSubscriptionIdempotencyKey(contractAddress: string, subId: string | bigint): string {
    return deterministicIdempotencyKey(`cancel:${contractAddress.toLowerCase()}:${BigInt(subId).toString()}`);
}

export interface ContractExecution {
    txHash: string;
    circleTxId?: string;
    submissionDurationMs?: number;
    confirmationDurationMs?: number;
    state?: string;
}

/* How long to wait for a Circle transaction to confirm before giving up. Circle SCA transactions
   go through the 4337 pipeline, so confirmation can take a bit longer than a raw EOA send. */
const CIRCLE_TX_CONFIRM_TIMEOUT_MS = Number(process.env.CIRCLE_TX_CONFIRM_TIMEOUT_MS) || 110_000;
const CIRCLE_TX_POLL_INTERVAL_MS = Number(process.env.CIRCLE_TX_POLL_INTERVAL_MS) || 500;
const CIRCLE_FIRST_TX_QUEUE_RETRY_DELAYS_MS = [500, 1_000, 1_500, 2_000] as const;

const CIRCLE_FIRST_TX_QUEUE_CODE = 155505;
const CIRCLE_PAYMASTER_POLICY_CODE = 155509;

function circleErrorCode(error: unknown): number | null {
    if (!error || typeof error !== "object") return null;
    const code = "code" in error ? Number((error as { code?: unknown }).code) : Number.NaN;
    return Number.isFinite(code) ? code : null;
}

function circleErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error || "Circle transaction failed");
}

function isCircleFirstTxQueueError(error: unknown): boolean {
    return circleErrorCode(error) === CIRCLE_FIRST_TX_QUEUE_CODE
        || /wait for first-time transaction to be queued/i.test(circleErrorMessage(error));
}

function isCirclePaymasterPolicyError(error: unknown): boolean {
    return circleErrorCode(error) === CIRCLE_PAYMASTER_POLICY_CODE
        || /setup paymaster policy/i.test(circleErrorMessage(error));
}

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export class CirclePaymasterPolicyError extends Error {
    readonly name = "CirclePaymasterPolicyError";
    readonly code = "CIRCLE_PAYMASTER_POLICY_REQUIRED";

    constructor() {
        super(
            "Arc transactions are temporarily unavailable because mainnet gas sponsorship (Circle Gas Station policy) is not configured in Circle Console. No funds were moved. Please try again after service is restored.",
        );
    }
}

export interface WalletCustody {
    readonly address: string;
    readonly kind: CustodyKind;
    /** Whether the raw private key can be exported (false for MPC keys as they are not extractable). */
    readonly canExportRawKey: boolean;
    /**
     * Submit a state-changing contract call from this wallet and wait until it is mined
     * successfully. Throws if the transaction reverts or the custody backend reports failure.
     */
    executeContract(call: ContractCall): Promise<ContractExecution>;
    /** EIP-712 typed-data signature. For Circle SCA wallets verification is ERC-1271 (the account
     *  contract validates the MPC signature), which Permit2 and compliant verifiers support. */
    signTypedData(
        domain: ethers.TypedDataDomain,
        types: Record<string, Array<ethers.TypedDataField>>,
        value: Record<string, unknown>,
    ): Promise<string>;
}

class CircleCustody implements WalletCustody {
    readonly kind = "circle" as const;
    readonly canExportRawKey = false;
    constructor(readonly address: string, readonly circleWalletId: string) {}

    async executeContract(call: ContractCall): Promise<ContractExecution> {
        const client = getDevWalletsClient();
        /* Encode locally with ethers and submit callData — one canonical encoding for both
           backends instead of re-serializing args into Circle's abiParameters strings. */
        const iface = new ethers.Interface(call.abi);
        const callData = iface.encodeFunctionData(call.functionName, [...(call.args ?? [])]) as `0x${string}`;

        /* Keep one idempotency key across queue retries. Circle returns 155505 while a brand-new
           SCA's first operation is still entering its queue; retrying with a new key could create
           two logical operations once the queue opens. A missing mainnet paymaster policy is an
           operational configuration failure (155509), so it is never retried. */
        const idempotencyKey = call.idempotencyKey
            ? circleIdempotencyKey(call.idempotencyKey)
            : randomUUID();
        const createRequest = {
            walletId: this.circleWalletId,
            contractAddress: call.contractAddress,
            callData,
            fee: { type: "level", config: { feeLevel: "MEDIUM" } },
            idempotencyKey,
        } as const;

        const submissionStart = performance.now();
        let created;
        for (let attempt = 0; ; attempt++) {
            try {
                created = await client.createContractExecutionTransaction(createRequest);
                break;
            } catch (error: unknown) {
                if (isCirclePaymasterPolicyError(error)) {
                    console.error(
                        "[CircleCustody] Error 155509: Mainnet Gas Station paymaster policy is required for Circle SCA transactions. " +
                        "Configure and activate a Gas Station policy for Arc in Circle Developer Console (https://console.circle.com). " +
                        "Details:", circleErrorMessage(error)
                    );
                    throw new CirclePaymasterPolicyError();
                }
                const retryDelay = CIRCLE_FIRST_TX_QUEUE_RETRY_DELAYS_MS[attempt];
                if (!isCircleFirstTxQueueError(error) || retryDelay === undefined) throw error;
                await wait(retryDelay);
            }
        }
        const submissionDurationMs = Math.round(performance.now() - submissionStart);
        const txId = created.data?.id;
        if (!txId) {
            throw new Error("Circle contract execution returned no transaction id.");
        }

        if (call.waitForConfirmation === false) {
            return {
                txHash: "",
                circleTxId: txId,
                submissionDurationMs,
                confirmationDurationMs: 0,
                state: created.data?.state || "INITIATED",
            };
        }

        const confirmStart = performance.now();
        /* CONFIRMED = mined successfully; the SDK rejects if the tx enters FAILED/CANCELLED/
           DENIED/STUCK, which covers on-chain reverts. */
        const confirmed = await client.getTransaction({
            id: txId,
            waitForState: "CONFIRMED",
            pollingInterval: CIRCLE_TX_POLL_INTERVAL_MS,
            signal: AbortSignal.timeout(CIRCLE_TX_CONFIRM_TIMEOUT_MS),
        });
        const confirmationDurationMs = Math.round(performance.now() - confirmStart);
        const txHash = confirmed.data?.transaction?.txHash;
        if (txHash) {
            return {
                txHash,
                circleTxId: txId,
                submissionDurationMs,
                confirmationDurationMs,
            };
        }
        /* Defensive: txHash should be populated at CONFIRMED for both EOA and SCA. */
        const withHash = await client.getTransaction({
            id: txId,
            waitForTxHash: true,
            pollingInterval: CIRCLE_TX_POLL_INTERVAL_MS,
            signal: AbortSignal.timeout(CIRCLE_TX_CONFIRM_TIMEOUT_MS),
        });
        return {
            txHash: withHash.data.transaction.txHash,
            circleTxId: txId,
            submissionDurationMs,
            confirmationDurationMs: Math.round(performance.now() - confirmStart),
        };
    }

    async signTypedData(
        domain: ethers.TypedDataDomain,
        types: Record<string, Array<ethers.TypedDataField>>,
        value: Record<string, unknown>,
    ): Promise<string> {
        const client = getDevWalletsClient();
        /* Circle expects the full eth_signTypedData_v4 payload (EIP712Domain included);
           TypedDataEncoder.getPayload builds exactly that from the ethers-style inputs. */
        const payload = ethers.TypedDataEncoder.getPayload(domain, types, value);
        const res = await client.signTypedData({
            walletId: this.circleWalletId,
            data: JSON.stringify(payload),
        });
        const signature = res.data?.signature;
        if (!signature) {
            throw new Error("Circle signTypedData returned no signature.");
        }
        return signature;
    }
}

interface EmbeddedWalletRow {
    circle_wallet_id: string | null;
}

/**
 * Resolve the custody backend for a user embedded wallet. Circle-backed iff circle_wallet_id is set.
 * Throws if the wallet has no server-held custody (e.g. an external/browser wallet).
 */
export async function getWalletCustody(walletAddress: string): Promise<WalletCustody> {
    const address = walletAddress.toLowerCase();
    const record = await pgMaybeOne<EmbeddedWalletRow>(
        "select circle_wallet_id from user_embedded_wallets where wallet_address = $1 limit 1",
        [address]
    );

    if (record?.circle_wallet_id) {
        return new CircleCustody(address, record.circle_wallet_id);
    }
    throw new Error("This wallet has no server-held key. Connect a browser wallet to sign transactions.");
}

/** Verify the actual USDC leg, not merely the successful outer ERC-4337 transaction. */
export async function getArcTransferStatus(txHash: string, sender: string): Promise<{
    status: "pending" | "confirmed" | "failed"; txHash: string; error?: string;
}> {
    try {
        const { readProvider } = await import("@/lib/vault/onchain");
        const { USDC_NATIVE_GAS_ADDRESS } = await import("@/lib/contracts/constants");
        const receipt = await readProvider().getTransactionReceipt(txHash);
        if (!receipt) return { status: "pending", txHash };
        if (receipt.status === 0) return { status: "failed", txHash, error: "The transfer reverted on Arc." };
        if (receipt.status !== 1) return { status: "pending", txHash };
        const events = new ethers.Interface([
            "event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)",
            "event Transfer(address indexed from, address indexed to, uint256 value)",
        ]);
        let credited = false;
        for (const log of receipt.logs ?? []) {
            let parsed;
            try { parsed = events.parseLog({ topics: [...log.topics], data: log.data }); } catch { continue; }
            if (parsed?.name === "UserOperationEvent" && String(parsed.args.sender).toLowerCase() === sender.toLowerCase() && parsed.args.success === false) {
                return { status: "failed", txHash, error: "The embedded USDC transfer reverted on Arc." };
            }
            if (parsed?.name === "Transfer" && log.address.toLowerCase() === USDC_NATIVE_GAS_ADDRESS.toLowerCase()
                && String(parsed.args.from).toLowerCase() === sender.toLowerCase() && BigInt(parsed.args.value) > 0n) credited = true;
        }
        return { status: credited ? "confirmed" : "pending", txHash };
    } catch (err: any) {
        return { status: "pending", txHash, error: err?.message };
    }
}

/** Resolve only transactions belonging to the caller's actual funding wallet. Circle's
 * CONFIRMED state and an outer receipt alone cannot establish that USDC reached a recipient. */
export async function getCircleTransactionStatus(circleTxId: string, walletAddress: string): Promise<{
    status: "pending" | "confirmed" | "failed"; txHash?: string; state?: string; error?: string;
}> {
    try {
        const record = await pgMaybeOne<EmbeddedWalletRow>(
            "select circle_wallet_id from user_embedded_wallets where wallet_address = $1 limit 1",
            [walletAddress.toLowerCase()],
        );
        const res = await getDevWalletsClient().getTransaction({ id: circleTxId });
        const tx = res.data?.transaction;
        if (!tx) return { status: "pending", state: "PENDING" };
        if (!record?.circle_wallet_id || tx.walletId !== record.circle_wallet_id) {
            return { status: "pending", error: "Transaction does not belong to this funding wallet." };
        }
        const { state, txHash } = tx;
        let result: { status: "pending" | "confirmed" | "failed"; txHash?: string; state?: string; error?: string };
        if (txHash) {
            // Once broadcast, verified chain execution is authoritative. A stale provider
            // failure must not free headroom for a USDC transfer that actually settled.
            result = { ...await getArcTransferStatus(txHash, walletAddress), state };
        } else if (state === "FAILED" || state === "CANCELLED" || state === "DENIED") {
            result = { status: "failed", state, error: "Circle transaction failed." };
        } else {
            result = { status: "pending", state };
        }
        if (result.status !== "pending") {
            const { reconcileSubmittedSpendingLimitOperation } = await import("@/lib/spendingLimits");
            await reconcileSubmittedSpendingLimitOperation(walletAddress, circleTxId, result.status)
                .catch((err) => console.error("Failed to reconcile submitted spending operation:", err));
        }
        return result;
    } catch (err: any) {
        return { status: "pending", error: err?.message };
    }
}
