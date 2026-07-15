import { randomUUID } from "crypto";

import { ethers } from "ethers";

import { ROUTER_DEPOSIT_INTERFACE, USDC_TRANSFER_INTERFACE, receiptUrl } from "@/lib/arc/memo";
import { SUBSCRIPT_ROUTER_ADDRESS, USDC_NATIVE_GAS_ADDRESS } from "@/lib/contracts/constants";
import { insertSupabaseDmAndNotify } from "@/lib/dms/notifications";
import { buildReceiptDmDescription, safeReceiptPayeeLabel } from "@/lib/dms/receiptPresentation";
import { sendPaymentReceiptEmails } from "@/lib/email/transactional";
import { createPaymentSucceededWebhook } from "@/lib/webhooks";
import { deliverWebhookOutboxEvent } from "@/lib/webhookOutbox";
import { ProtocolConfig } from "./config";
import { executeWithRpcFallback } from "./rpc";

const POLL_ATTEMPTS_PER_LEASE = 15;
const POLL_INTERVAL_MS = 5_000;
/* RPC fallback can spend tens of seconds backing off across providers. Keep the
   lease above the route's 120s execution budget so a slow live worker is never
   reclaimed concurrently; a crashed job is still bounded and cron-recoverable. */
const JOB_LEASE_SECONDS = 300;

export type PaymentLinkVerificationJob = {
    id: string;
    execution_key: string;
    tx_hash: string;
    chain_id: number | string;
    payment_link_id: string;
    payer_address: string;
    receipt_id: string;
    merchant_address: string;
    beneficiary_address: string;
    amount_usdc: number | string;
    settles_directly_to_user: boolean;
    payment_title: string;
    external_reference: string | null;
    merchant_name_snapshot: string | null;
    checkout_attempt_id: string | null;
    request_origin: string | null;
    attempts: number;
    max_attempts: number;
    lease_token: string;
    created_at?: string | null;
};

/* A transaction that no RPC endpoint has EVER observed is treated as transient (mempools
   and lagging nodes are real), but not forever: after this window on a seconds-blocktime
   chain the claimed hash provably does not exist, and keeping the job in eternal RETRY
   would let a fabricated hash hold the link's consumed capacity indefinitely (a single-use
   link would stay exhausted). Going terminal routes through release_payment_link_settlement,
   which restores capacity — or completes the job if settlement actually landed meanwhile. */
const TX_NEVER_OBSERVED_TERMINAL_MS = 24 * 60 * 60 * 1000;

type WorkerResult = {
    jobId: string;
    txHash: string;
    outcome: "COMPLETED" | "RETRY" | "FAILED" | "LEASE_MISMATCH";
    error?: string;
};

export type PaymentLinkVerificationBatchResult = {
    success: boolean;
    claimedCount: number;
    completedCount: number;
    retryCount: number;
    failedCount: number;
    results: WorkerResult[];
};

class PermanentVerificationError extends Error {}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function messageOf(error: unknown) {
    return error instanceof Error ? error.message : "Payment verification failed";
}

async function completeJob(supabase: any, job: PaymentLinkVerificationJob) {
    const { data, error } = await supabase.rpc("complete_payment_link_verification_job", {
        p_job_id: job.id,
        p_claim_token: job.lease_token,
    });
    if (error) throw new Error(`Failed to complete durable verification job: ${error.message}`);
    if (data?.outcome !== "COMPLETED") {
        throw new Error(`Durable verification job completion returned ${data?.outcome || "no outcome"}`);
    }
}

async function rescheduleJob(
    supabase: any,
    job: PaymentLinkVerificationJob,
    error: unknown,
    terminal: boolean,
): Promise<WorkerResult> {
    const errorMessage = messageOf(error);
    const { data, error: updateError } = await supabase.rpc("reschedule_payment_link_verification_job", {
        p_job_id: job.id,
        p_claim_token: job.lease_token,
        p_error_message: errorMessage,
        p_terminal: terminal,
    });

    if (updateError) {
        throw new Error(`Failed to reschedule durable verification job: ${updateError.message}`);
    }

    const outcome = data?.outcome;
    if (outcome === "COMPLETED") {
        return { jobId: job.id, txHash: job.tx_hash, outcome: "COMPLETED" };
    }
    if (outcome === "LEASE_MISMATCH") {
        return { jobId: job.id, txHash: job.tx_hash, outcome: "LEASE_MISMATCH", error: errorMessage };
    }
    if (outcome === "FAILED") {
        return { jobId: job.id, txHash: job.tx_hash, outcome: "FAILED", error: errorMessage };
    }
    return { jobId: job.id, txHash: job.tx_hash, outcome: "RETRY", error: errorMessage };
}

async function bindCheckoutAttempt(supabase: any, job: PaymentLinkVerificationJob, paymentId: string) {
    if (!job.checkout_attempt_id) return;

    const { error } = await supabase
        .from("payment_link_payments")
        .update({ checkout_attempt_id: job.checkout_attempt_id })
        .eq("id", paymentId)
        .is("checkout_attempt_id", null);
    if (error) throw new Error(`Failed to bind checkout attempt: ${error.message}`);
}

async function recoverCompletedSettlement(supabase: any, job: PaymentLinkVerificationJob) {
    const { data: payment, error } = await supabase
        .from("payment_link_payments")
        .select("id")
        .eq("tx_hash", job.tx_hash)
        .eq("payment_link_id", job.payment_link_id)
        .maybeSingle();
    if (error) throw new Error(`Failed to inspect existing payment settlement: ${error.message}`);
    if (!payment?.id) return false;

    await bindCheckoutAttempt(supabase, job, payment.id);
    const shareUrl = receiptUrl(job.receipt_id, job.request_origin);
    await runDurablePostSettlementEffects(supabase, job, payment.id, shareUrl);
    await completeJob(supabase, job);
    await deliverWebhookOutboxEvent(supabase, `evt_payment_${payment.id}`)
        .catch((deliveryError) => console.error("[verify-worker] Webhook outbox recovery failed:", deliveryError));
    return true;
}

async function updateVerificationState(
    supabase: any,
    job: PaymentLinkVerificationJob,
    status: "PENDING_CONFIRMATIONS" | "VERIFYING",
    confirmations?: number,
) {
    const values: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
    if (confirmations !== undefined) values.confirmations = confirmations;

    const { error } = await supabase
        .from("transaction_verifications")
        .update(values)
        .eq("tx_hash", job.tx_hash)
        .eq("reference_type", "PAYMENT_LINK")
        .eq("reference_id", job.payment_link_id)
        .neq("status", "CONFIRMED");
    if (error) throw new Error(`Failed to persist transaction verification state: ${error.message}`);
}

function assertVerifiedTransaction(job: PaymentLinkVerificationJob, receipt: any, nativeTx: any) {
    /* A lagging RPC can expose the receipt before getTransaction catches up. */
    if (!nativeTx) throw new Error("Transaction details not found on-chain yet");
    if (Number(nativeTx.chainId) !== ProtocolConfig.CHAIN_ID) {
        throw new PermanentVerificationError(`Chain ID mismatch. Expected ${ProtocolConfig.CHAIN_ID}`);
    }
    if (receipt.status !== 1) throw new PermanentVerificationError("On-chain transaction reverted");

    if (job.settles_directly_to_user) {
        const isDirectUsdcCall = Boolean(
            nativeTx.to && nativeTx.to.toLowerCase() === USDC_NATIVE_GAS_ADDRESS.toLowerCase(),
        );
        if (isDirectUsdcCall) {
            let parsedTransferCall: ethers.TransactionDescription | null = null;
            try {
                parsedTransferCall = USDC_TRANSFER_INTERFACE.parseTransaction({
                    data: nativeTx.data,
                    value: nativeTx.value,
                });
            } catch {
                /* Converted to the stable mismatch error below. */
            }
            if (
                !parsedTransferCall ||
                parsedTransferCall.name !== "transfer" ||
                parsedTransferCall.args[0].toLowerCase() !== job.merchant_address ||
                BigInt(parsedTransferCall.args[1]) !== BigInt(job.amount_usdc)
            ) {
                throw new PermanentVerificationError("Direct USDC transfer does not match payment link parameters");
            }
        }

        const transferFound = receipt.logs.some((log: any) => {
            if (log.address.toLowerCase() !== USDC_NATIVE_GAS_ADDRESS.toLowerCase()) return false;
            try {
                const parsed = USDC_TRANSFER_INTERFACE.parseLog({ topics: log.topics, data: log.data });
                return parsed?.name === "Transfer" &&
                    parsed.args.from.toLowerCase() === job.payer_address &&
                    parsed.args.to.toLowerCase() === job.merchant_address &&
                    BigInt(parsed.args.value) === BigInt(job.amount_usdc);
            } catch {
                return false;
            }
        });
        if (!transferFound) throw new PermanentVerificationError("Matching Arc USDC Transfer event not found");
        return;
    }

    const isDirectRouterCall = Boolean(
        nativeTx.to && nativeTx.to.toLowerCase() === SUBSCRIPT_ROUTER_ADDRESS.toLowerCase(),
    );
    if (isDirectRouterCall) {
        let parsedRouterCall: ethers.TransactionDescription | null = null;
        try {
            parsedRouterCall = ROUTER_DEPOSIT_INTERFACE.parseTransaction({
                data: nativeTx.data,
                value: nativeTx.value,
            });
        } catch {
            /* Converted to the stable mismatch error below. */
        }
        if (
            !parsedRouterCall ||
            parsedRouterCall.name !== "depositForMerchant" ||
            parsedRouterCall.args[0].toLowerCase() !== job.merchant_address ||
            BigInt(parsedRouterCall.args[1]) !== BigInt(job.amount_usdc) ||
            parsedRouterCall.args[2] !== job.receipt_id
        ) {
            throw new PermanentVerificationError("SubScript Router deposit call does not match receipt parameters");
        }
    }

    const depositFound = receipt.logs.some((log: any) => {
        if (log.address.toLowerCase() !== SUBSCRIPT_ROUTER_ADDRESS.toLowerCase()) return false;
        try {
            const parsed = ROUTER_DEPOSIT_INTERFACE.parseLog({ topics: log.topics, data: log.data });
            return parsed?.name === "DepositWithMemo" &&
                parsed.args.payer.toLowerCase() === job.payer_address &&
                parsed.args.merchant.toLowerCase() === job.merchant_address &&
                BigInt(parsed.args.amount) === BigInt(job.amount_usdc) &&
                parsed.args.memo === job.receipt_id;
        } catch {
            return false;
        }
    });
    if (!depositFound) throw new PermanentVerificationError("SubScript Router DepositWithMemo event not found");
}

async function runPostSettlementEffects(
    supabase: any,
    job: PaymentLinkVerificationJob,
    paymentId: string,
    shareUrl: string,
) {
    try {
        const { data: existingRole, error: roleQueryError } = await supabase
            .from("account_roles")
            .select("role")
            .eq("address", job.payer_address)
            .maybeSingle();
        if (!roleQueryError && !existingRole) {
            await supabase.from("account_roles").insert({ address: job.payer_address, role: "USER" });
            await supabase.from("customers").insert({ wallet_address: job.payer_address });
        }
    } catch (error) {
        console.error("[verify-worker] Failed to auto-create payer account:", error);
    }

    const { error: dmResolveError } = await supabase
        .from("subscript_dms")
        .update({ status: "APPROVED", updated_at: new Date().toISOString() })
        .eq("payment_link_id", job.payment_link_id)
        .eq("receiver_address", job.payer_address)
        .in("message_type", ["PAYMENT_REQUEST", "PEER_REQUEST"])
        .eq("status", "PENDING");
    if (dmResolveError) console.error("[verify-worker] Failed to resolve payment request DM:", dmResolveError.message);

    const { error: auditError } = await supabase.from("audit_events").insert({
        actor: job.payer_address,
        action: "PAYMENT_LINK_VERIFIED",
        resource_type: "PAYMENT_LINK",
        resource_id: job.payment_link_id,
        metadata: {
            tx_hash: job.tx_hash,
            amount_usdc: job.amount_usdc.toString(),
            payer_address: job.payer_address,
            beneficiary_address: job.beneficiary_address,
        },
    });
    if (auditError) console.error("[verify-worker] Failed to record payment audit event:", auditError.message);

    const { data: payerSettings } = await supabase
        .from("customers")
        .select("push_enabled, debit_success_enabled")
        .eq("wallet_address", job.payer_address)
        .maybeSingle();

    if (payerSettings?.push_enabled !== false && payerSettings?.debit_success_enabled !== false) {
        const { data: existingReceipt } = await supabase
            .from("subscript_dms")
            .select("id")
            .eq("message_type", "DEBIT_SUCCESS")
            .eq("tx_hash", job.tx_hash)
            .limit(1)
            .maybeSingle();
        if (!existingReceipt) {
            /* Receipt identity is database-owned. Checkout-supplied merchant_name_snapshot is
               branding metadata and must not be allowed to impersonate another payee. */
            const { data: merchantAlias, error: merchantAliasError } = await supabase
                .from("address_aliases")
                .select("alias")
                .eq("address", job.merchant_address)
                .maybeSingle();
            if (merchantAliasError) {
                console.error("[verify-worker] Failed to resolve receipt merchant alias:", merchantAliasError.message);
            }
            const merchantLabel = safeReceiptPayeeLabel(merchantAlias?.alias, job.merchant_address);
            await insertSupabaseDmAndNotify(supabase, {
                sender_address: job.merchant_address,
                receiver_address: job.payer_address,
                message_type: "DEBIT_SUCCESS",
                status: "PENDING",
                amount_usdc: job.amount_usdc.toString(),
                title: `Receipt: ${job.payment_title}`,
                description: buildReceiptDmDescription({
                    amountUsdcMicros: job.amount_usdc,
                    payeeLabel: merchantLabel,
                    receiptId: job.receipt_id,
                }),
                tx_hash: job.tx_hash,
                payment_link_id: job.payment_link_id,
            }).catch((error) => console.error("[verify-worker] Receipt DM notification failed:", error));
        }
    }

    await sendPaymentReceiptEmails({
        amountUsdc: job.amount_usdc,
        receiptUrl: shareUrl,
        receiptId: job.receipt_id,
        merchantAddress: job.merchant_address,
        payerAddress: job.payer_address,
        paymentTitle: job.payment_title,
        txHash: job.tx_hash,
    });

    if (!job.settles_directly_to_user) {
        await deliverWebhookOutboxEvent(supabase, `evt_payment_${paymentId}`)
            .catch((error) => console.error("[verify-worker] Webhook outbox delivery failed:", error));
    }
}

async function runDurablePostSettlementEffects(
    supabase: any,
    job: PaymentLinkVerificationJob,
    paymentId: string,
    shareUrl: string,
) {
    const { data: effect, error: effectError } = await supabase
        .from("payment_link_settlement_effects")
        .select("status")
        .eq("payment_link_payment_id", paymentId)
        .maybeSingle();
    if (effectError) throw new Error(`Failed to inspect settlement effects: ${effectError.message}`);
    if (effect?.status === "COMPLETED") return;

    await runPostSettlementEffects(supabase, job, paymentId, shareUrl);
    const { error: completeError } = await supabase
        .from("payment_link_settlement_effects")
        .update({ status: "COMPLETED", attempts: 1, last_error: null, updated_at: new Date().toISOString() })
        .eq("payment_link_payment_id", paymentId)
        .neq("status", "COMPLETED");
    if (completeError) throw new Error(`Failed to complete settlement effects: ${completeError.message}`);
}

async function verifyAndFinalize(supabase: any, job: PaymentLinkVerificationJob) {
    if (Number(job.chain_id) !== ProtocolConfig.CHAIN_ID) {
        throw new PermanentVerificationError(
            "CCTP checkout verification is disabled; payment-link jobs must settle directly on Arc.",
        );
    }

    if (await recoverCompletedSettlement(supabase, job)) return;

    const jobCreatedAtMs = job.created_at ? new Date(job.created_at).getTime() : Number.NaN;
    const txNeverObservedIsTerminal = Number.isFinite(jobCreatedAtMs)
        && Date.now() - jobCreatedAtMs > TX_NEVER_OBSERVED_TERMINAL_MS;

    for (let attempt = 1; attempt <= POLL_ATTEMPTS_PER_LEASE; attempt++) {
        try {
            const lookup = await executeWithRpcFallback(async (provider) => {
                const [receipt, currentBlock] = await Promise.all([
                    provider.getTransactionReceipt(job.tx_hash),
                    provider.getBlockNumber(),
                ]);
                if (!receipt) {
                    if (txNeverObservedIsTerminal) {
                        throw new PermanentVerificationError(
                            "Transaction was never observed on-chain within 24 hours; the claimed payment does not exist.",
                        );
                    }
                    throw new Error("Transaction receipt not found on-chain yet");
                }
                return { receipt, confirmations: Math.max(0, currentBlock - receipt.blockNumber + 1) };
            });

            const { receipt, confirmations } = lookup.result;
            await updateVerificationState(supabase, job, "PENDING_CONFIRMATIONS", confirmations);
            if (confirmations < ProtocolConfig.MIN_CONFIRMATIONS) {
                throw new Error(`Waiting for confirmations (${confirmations}/${ProtocolConfig.MIN_CONFIRMATIONS})`);
            }

            await updateVerificationState(supabase, job, "VERIFYING");
            const txLookup = await executeWithRpcFallback((provider) => provider.getTransaction(job.tx_hash));
            assertVerifiedTransaction(job, receipt, txLookup.result);

            const shareUrl = receiptUrl(job.receipt_id, job.request_origin);
            const webhookPayload = job.settles_directly_to_user ? null : createPaymentSucceededWebhook({
                paymentId: "pending",
                checkoutSessionId: job.payment_link_id,
                merchantReference: job.external_reference,
                amountUsdc: job.amount_usdc,
                receiptId: job.receipt_id,
                txHash: job.tx_hash,
                payerAddress: job.payer_address,
                beneficiaryAddress: job.beneficiary_address,
                chainId: Number(job.chain_id),
            });
            const { data: finalizeResult, error: finalizeError } = await supabase.rpc(
                "finalize_payment_link_settlement",
                {
                    p_execution_key: job.execution_key,
                    p_tx_hash: job.tx_hash,
                    p_chain_id: Number(job.chain_id),
                    p_payment_link_id: job.payment_link_id,
                    p_payer_address: job.payer_address,
                    p_receipt_id: job.receipt_id,
                    p_beneficiary_address: job.beneficiary_address,
                    p_verification_block: receipt.blockNumber,
                    p_settlement_reference: job.settles_directly_to_user ? "direct-usdc-transfer" : null,
                    p_response_payload: {
                        success: true,
                        message: "Payment verified and settled",
                        payerAddress: job.payer_address,
                        beneficiaryAddress: job.beneficiary_address,
                        receiptId: job.receipt_id,
                        shareUrl,
                        memoContract: job.settles_directly_to_user
                            ? USDC_NATIVE_GAS_ADDRESS.toLowerCase()
                            : SUBSCRIPT_ROUTER_ADDRESS.toLowerCase(),
                    },
                    p_webhook_payload: webhookPayload,
                },
            );
            if (finalizeError) {
                throw new Error(`Failed to atomically finalize payment settlement: ${finalizeError.message}`);
            }

            const paymentId = finalizeResult?.responsePayload?.paymentId;
            if (!paymentId) throw new Error("Atomic payment finalization returned no payment id");

            await bindCheckoutAttempt(supabase, job, paymentId);
            await runDurablePostSettlementEffects(supabase, job, paymentId, shareUrl);
            await completeJob(supabase, job);
            return;
        } catch (error) {
            if (error instanceof PermanentVerificationError) throw error;
            if (attempt === POLL_ATTEMPTS_PER_LEASE) throw error;
            console.warn(
                `[verify-worker] Poll ${attempt}/${POLL_ATTEMPTS_PER_LEASE} failed for ${job.tx_hash}: ${messageOf(error)}`,
            );
            await sleep(POLL_INTERVAL_MS);
        }
    }
}

async function processClaimedJob(supabase: any, job: PaymentLinkVerificationJob): Promise<WorkerResult> {
    try {
        await verifyAndFinalize(supabase, job);
        return { jobId: job.id, txHash: job.tx_hash, outcome: "COMPLETED" };
    } catch (error) {
        console.error(`[verify-worker] Durable job ${job.id} failed:`, messageOf(error));
        return rescheduleJob(supabase, job, error, error instanceof PermanentVerificationError);
    }
}

export async function processPaymentLinkVerificationJobs(
    supabase: any,
    limit = 1,
): Promise<PaymentLinkVerificationBatchResult> {
    const claimToken = randomUUID();
    const { data: claimedJobs, error } = await supabase.rpc("claim_payment_link_verification_jobs", {
        p_batch_size: Math.max(1, Math.min(limit, 25)),
        p_claim_token: claimToken,
        p_lease_seconds: JOB_LEASE_SECONDS,
    });
    if (error) throw new Error(`Failed to claim durable payment-link verification jobs: ${error.message}`);

    const jobs = (claimedJobs || []) as PaymentLinkVerificationJob[];
    const results = await Promise.all(jobs.map((job) => processClaimedJob(supabase, job)));
    const completedCount = results.filter((result) => result.outcome === "COMPLETED").length;
    const retryCount = results.filter((result) => result.outcome === "RETRY").length;
    const failedCount = results.filter((result) => result.outcome === "FAILED").length;

    return {
        success: failedCount === 0,
        claimedCount: jobs.length,
        completedCount,
        retryCount,
        failedCount,
        results,
    };
}
