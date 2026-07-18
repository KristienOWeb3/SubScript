import { prisma } from "@/lib/prisma";
import { pgMaybeOne, pgQuery } from "@/lib/serverPg";
import { deterministicIdempotencyKey } from "@/lib/custody";
import { mirrorSubscriptionCreated, mirrorSubscriptionModified } from "@/lib/subscriptions/mirror";
import {
    findActiveOnChainSubscriptionId,
    getSubscriptionOnChain,
    modifyFromEmbedded,
} from "@/lib/subscriptions/onchain";
import { dispatchDurableSubscriptionWebhook } from "@/lib/subscriptions/webhookDelivery";
import { subscriptionWebhookData } from "@/lib/webhooks";
import { syncVaultMirror } from "@/lib/vault/onchain";

export type RetryablePaymentReconciliationEvent = {
    id: string;
    kind: string;
    context: Record<string, unknown>;
    attempt_count?: number;
};

const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/i;
const TX_HASH_PATTERN = /^0x[0-9a-f]{64}$/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/* After this many attempts a reconciliation event is treated as a poison row: an unsupported
   kind or permanently-invalid context will never succeed, and — because the cron marks any
   failing batch unhealthy — a single such row would otherwise 500 the reconcile endpoint on
   every run forever. Exhausted events are parked (dead-lettered) for manual review instead. */
const MAX_RECONCILIATION_ATTEMPTS = 12;

function requiredString(context: Record<string, unknown>, key: string) {
    const value = context[key];
    if (typeof value !== "string" || !value) {
        throw new Error(`Reconciliation context is missing ${key}`);
    }
    return value;
}

function requiredAddress(context: Record<string, unknown>, key: string) {
    const value = requiredString(context, key).toLowerCase();
    if (!ADDRESS_PATTERN.test(value)) throw new Error(`Reconciliation context has an invalid ${key}`);
    return value;
}

function requiredPositiveBigInt(context: Record<string, unknown>, key: string) {
    const value = requiredString(context, key);
    if (!/^\d+$/.test(value) || BigInt(value) <= BigInt(0)) {
        throw new Error(`Reconciliation context has an invalid ${key}`);
    }
    return BigInt(value);
}

function optionalNonNegativeBigInt(context: Record<string, unknown>, key: string) {
    const value = context[key];
    if (value === null || value === undefined || value === "") return BigInt(0);
    if (typeof value !== "string" || !/^\d+$/.test(value)) {
        throw new Error(`Reconciliation context has an invalid ${key}`);
    }
    return BigInt(value);
}

async function retryEmbeddedIdempotencyCompletion(context: Record<string, unknown>) {
    const claimKey = requiredString(context, "claimKey");
    const txHash = requiredString(context, "txHash").toLowerCase();
    if (!TX_HASH_PATTERN.test(txHash)) throw new Error("Reconciliation context has an invalid txHash");

    const claim = await prisma.idempotencyKey.findUnique({ where: { executionKey: claimKey } });
    if (!claim) throw new Error("Embedded payment idempotency claim no longer exists");
    if (claim.status === "COMPLETED") return;

    await prisma.idempotencyKey.update({
        where: { executionKey: claimKey },
        data: { status: "COMPLETED", responsePayload: { txHash } },
    });
}

async function retrySubscriptionReconciliation(context: Record<string, unknown>) {
    const subscriber = requiredAddress(context, "subscriber");
    const merchant = requiredAddress(context, "merchant");
    const expectedAmount = requiredPositiveBigInt(context, "amountUsdc");
    const expectedPeriod = requiredPositiveBigInt(context, "periodSeconds");
    const minCommitmentSeconds = optionalNonNegativeBigInt(context, "minCommitmentSeconds");
    const beneficiaryValue = context.beneficiaryAddress;
    const beneficiaryAddress = beneficiaryValue === null || beneficiaryValue === undefined || beneficiaryValue === ""
        ? null
        : requiredAddress(context, "beneficiaryAddress");

    const contextSubscriptionId = typeof context.subscriptionId === "string" && /^\d+$/.test(context.subscriptionId)
        ? context.subscriptionId
        : null;
    const subscriptionId = contextSubscriptionId
        || await findActiveOnChainSubscriptionId(subscriber, merchant);
    if (!subscriptionId) throw new Error("No active on-chain subscription is discoverable yet");

    const onChain = await getSubscriptionOnChain(subscriptionId);
    if (
        !onChain?.isActive
        || onChain.subscriber !== subscriber
        || onChain.merchant !== merchant
        || onChain.amount !== expectedAmount
        || onChain.period !== expectedPeriod
    ) {
        throw new Error("On-chain subscription does not match the recorded checkout terms");
    }

    await mirrorSubscriptionCreated({
        subscriptionId,
        merchantAddress: merchant,
        subscriber,
        amountUsdc: onChain.amount,
        periodSeconds: onChain.period,
        beneficiaryAddress,
        minCommitmentSeconds,
    });

    const checkoutSessionId = context.checkoutSessionId;
    if (typeof checkoutSessionId === "string" && checkoutSessionId) {
        if (!UUID_PATTERN.test(checkoutSessionId)) {
            throw new Error("Reconciliation context has an invalid checkoutSessionId");
        }
        const txHash = typeof context.txHash === "string" && TX_HASH_PATTERN.test(context.txHash)
            ? context.txHash.toLowerCase()
            : undefined;
        const updated = await prisma.paymentLink.updateMany({
            where: { id: checkoutSessionId },
            data: {
                active: false,
                status: "PAID",
                paidAt: new Date(),
                ...(txHash ? { verifiedTxHash: txHash } : {}),
            },
        });
        if (updated.count !== 1) throw new Error("Subscription checkout no longer exists");
    }
}

async function retryCircleTransactionNotification(context: Record<string, unknown>) {
    if (context.txHash === null || context.txHash === undefined || context.txHash === "") return;
    const txHash = requiredString(context, "txHash").toLowerCase();
    if (!TX_HASH_PATTERN.test(txHash)) throw new Error("Circle notification has an invalid txHash");

    /* A final Circle notification is authoritative evidence that an ambiguous
       custody submission should be reconsidered. Re-open only terminal retry
       states; completed sessions and active claims remain untouched. */
    await pgMaybeOne<{ session_id: string }>(
        `update public.payment_sessions
         set status = 'FAILED',
             processing_claim_id = null,
             processing_started_at = null,
             processing_attempts = least(coalesce(processing_attempts, 0), 4),
             last_error = 'Circle webhook requested transaction reconciliation',
             failure_code = 'CIRCLE_TRANSACTION_NOTIFICATION',
             updated_at = now()
         where lower(tx_hash) = $1
           and status in ('FAILED', 'FAILED_PERMANENTLY', 'NEEDS_RECONCILIATION')
         returning session_id`,
        [txHash],
    );
}

async function retryVaultDrawMirrorSync(context: Record<string, unknown>) {
    const userAddress = requiredAddress(context, "userAddress");
    const merchantAddress = requiredAddress(context, "merchantAddress");
    await syncVaultMirror(userAddress, merchantAddress);
}

/* Dedicated plan-change recovery. The event context is intentionally tiny —
   { changeClaimKey, proratedTxHash, modifyTxHash } — but the claim key embeds the complete
   v2 financial fingerprint:
   subscription-change:v2:{subId}:{subscriber}:{oldAmount}:{oldPeriod}:{planId}:{newAmount}:{newPeriod}:{mode}
   The handler converges every crash point WITHOUT ever transferring the proration again:
     - proration transferred, modify not submitted  → modify with the deterministic custody key
     - proration transferred, modify submitted      → verify on-chain terms, then mirror
     - modify confirmed, mirror failed              → mirror
     - mirror done, idempotency completion failed   → complete the claim
     - webhook/DM failed after a successful change  → re-dispatch the durable webhook (idempotent id)
   Only modifyFromEmbedded may be (re)issued — its key is deterministic on the fingerprint so
   Circle dedupes; transferUsdcFromEmbedded is deliberately never called from recovery. */
function parsePlanChangeClaimKey(changeClaimKey: string) {
    const prefix = "subscription-change:";
    if (!changeClaimKey.startsWith(prefix)) {
        throw new Error("Plan-change claim key has an unknown prefix");
    }
    const fingerprint = changeClaimKey.slice(prefix.length);
    const parts = fingerprint.split(":");
    if (parts.length !== 9 || parts[0] !== "v2") {
        throw new Error("Plan-change claim key is not a v2 fingerprint");
    }
    const [, subscriptionId, subscriber, oldAmount, oldPeriod, planId, newAmount, newPeriod, mode] = parts;
    if (!/^\d+$/.test(subscriptionId)) throw new Error("Plan-change fingerprint has an invalid subscription id");
    if (!ADDRESS_PATTERN.test(subscriber)) throw new Error("Plan-change fingerprint has an invalid subscriber");
    if (!/^\d+$/.test(oldAmount) || !/^\d+$/.test(oldPeriod) || !/^\d+$/.test(newAmount) || !/^\d+$/.test(newPeriod)) {
        throw new Error("Plan-change fingerprint has invalid amounts");
    }
    return {
        fingerprint,
        subscriptionId,
        subscriber: subscriber.toLowerCase(),
        oldAmount: BigInt(oldAmount),
        oldPeriod: BigInt(oldPeriod),
        planId,
        newAmount: BigInt(newAmount),
        newPeriod: BigInt(newPeriod),
        mode,
    };
}

async function waitForConfirmedPlanTerms({
    subscriptionId,
    subscriber,
    amount,
    period,
}: {
    subscriptionId: string;
    subscriber: string;
    amount: bigint;
    period: bigint;
}) {
    for (let attempt = 0; attempt < 6; attempt++) {
        const current = await getSubscriptionOnChain(subscriptionId);
        if (
            current?.isActive
            && current.subscriber === subscriber
            && current.amount === amount
            && current.period === period
        ) {
            return current;
        }
        if (attempt < 5) {
            await new Promise((resolve) => setTimeout(resolve, 2_000));
        }
    }
    throw new Error("Modified subscription terms are not confirmed on-chain");
}

async function retrySubscriptionPlanChangeReconciliation(context: Record<string, unknown>) {
    const changeClaimKey = requiredString(context, "changeClaimKey");
    const parsed = parsePlanChangeClaimKey(changeClaimKey);
    const proratedTxHash = typeof context.proratedTxHash === "string" && TX_HASH_PATTERN.test(context.proratedTxHash)
        ? context.proratedTxHash.toLowerCase()
        : null;
    let modifyTxHash = typeof context.modifyTxHash === "string" && TX_HASH_PATTERN.test(context.modifyTxHash)
        ? context.modifyTxHash.toLowerCase()
        : null;

    const onChain = await getSubscriptionOnChain(parsed.subscriptionId);
    if (!onChain || onChain.subscriber !== parsed.subscriber) {
        throw new Error("Plan-change subscription is not discoverable on-chain");
    }

    const hasNewTerms = onChain.isActive
        && onChain.amount === parsed.newAmount
        && onChain.period === parsed.newPeriod;
    const hasOldTerms = onChain.amount === parsed.oldAmount && onChain.period === parsed.oldPeriod;

    if (!hasNewTerms) {
        if (!hasOldTerms || !onChain.isActive) {
            /* Neither fingerprint side matches (a later change or cancellation intervened).
               Converging automatically could clobber newer state — leave for the operator. */
            throw new Error("On-chain subscription matches neither the old nor the new plan terms");
        }
        /* Modify never submitted (or never mined): (re)submit with the SAME deterministic key —
           Circle dedupes an already-accepted modify instead of applying it twice. */
        modifyTxHash = await modifyFromEmbedded(
            parsed.subscriber,
            parsed.subscriptionId,
            parsed.newAmount,
            parsed.newPeriod,
            deterministicIdempotencyKey(`sub-change-modify:${parsed.fingerprint}`),
        );
        await waitForConfirmedPlanTerms({
            subscriptionId: parsed.subscriptionId,
            subscriber: parsed.subscriber,
            amount: parsed.newAmount,
            period: parsed.newPeriod,
        });
    }

    await mirrorSubscriptionModified({
        subscriptionId: parsed.subscriptionId,
        amountUsdc: parsed.newAmount,
        periodSeconds: parsed.newPeriod,
    });

    /* The merchant webhook is the piece plan-change previously had no recovery for. The
       lifecycle event id is deterministic, so a duplicate dispatch dedupes downstream. */
    const merchant = await pgMaybeOne<{ merchant_address: string }>(
        "select merchant_address from subscriptions where subscription_id = $1 limit 1",
        [parsed.subscriptionId],
    );
    if (!merchant?.merchant_address) {
        throw new Error("Mirrored subscription merchant is unavailable");
    }
    await dispatchDurableSubscriptionWebhook(merchant.merchant_address, "subscription.updated", {
        ...subscriptionWebhookData({
            subscriptionId: parsed.subscriptionId,
            status: "updated",
            amountUsdcMicros: parsed.newAmount,
            subscriber: parsed.subscriber,
            merchantAddress: merchant.merchant_address,
            txHash: modifyTxHash ?? undefined,
        }),
        plan_id: parsed.planId,
        planId: parsed.planId,
        previous_amount_usdc_micros: parsed.oldAmount.toString(),
        previousAmountUsdcMicros: parsed.oldAmount.toString(),
        new_period_seconds: Number(parsed.newPeriod),
        newPeriodSeconds: Number(parsed.newPeriod),
        prorated_tx_hash: proratedTxHash,
        proratedTxHash,
        reconciled: true,
    }, `updated:${parsed.subscriptionId}:${(modifyTxHash || "reconciled").toLowerCase()}`);

    /* Complete the claim so a user retry replays this result instead of re-charging. */
    const completed = await prisma.idempotencyKey.updateMany({
        where: { executionKey: changeClaimKey, status: { not: "COMPLETED" } },
        data: {
            status: "COMPLETED",
            responsePayload: {
                success: true,
                txHash: modifyTxHash,
                subscriptionId: parsed.subscriptionId,
                proratedTxHash,
                reconciled: true,
            },
        },
    });
    if (completed.count !== 1) {
        const claim = await prisma.idempotencyKey.findUnique({ where: { executionKey: changeClaimKey } });
        if (claim?.status !== "COMPLETED") {
            throw new Error("Plan-change idempotency claim could not be completed");
        }
    }
}

/* An embedded checkout payment confirmed on-chain but the durable verification job was not
   created before the response. Rebuild the claim from the attempt row (the authoritative
   snapshot) — the claim RPC is idempotent by execution key and refuses mismatched hashes. */
async function retryEmbeddedPaymentDurableBind(context: Record<string, unknown>) {
    const txHash = requiredString(context, "txHash").toLowerCase();
    if (!TX_HASH_PATTERN.test(txHash)) throw new Error("Durable-bind context has an invalid txHash");
    const paymentLinkId = requiredString(context, "paymentLinkId");
    if (!UUID_PATTERN.test(paymentLinkId)) throw new Error("Durable-bind context has an invalid paymentLinkId");
    const checkoutAttemptId = requiredString(context, "checkoutAttemptId");
    if (!UUID_PATTERN.test(checkoutAttemptId)) throw new Error("Durable-bind context has an invalid checkoutAttemptId");
    const payer = requiredAddress(context, "payer");

    const attempt = await pgMaybeOne<{
        receipt_id: string;
        settlement_chain_id: string;
        link_kind: string;
    }>(
        `select receipt_id, settlement_chain_id, link_kind
           from payment_link_checkout_attempts
          where attempt_id = $1 and payment_link_id = $2 and lower(payer_address) = $3`,
        [checkoutAttemptId, paymentLinkId, payer],
    );
    if (!attempt) throw new Error("Checkout attempt for the durable bind no longer exists");

    const result = await pgMaybeOne<{ result: { outcome?: string } }>(
        `select public.claim_payment_link_settlement_durable(
            $1, $2, $3, $4::uuid, $5, $6, $7::timestamptz, $8, $9::uuid, $10
        ) as result`,
        [
            `verify-payment-link:${txHash}`,
            txHash,
            attempt.settlement_chain_id,
            paymentLinkId,
            payer,
            attempt.receipt_id,
            new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            attempt.link_kind !== "PEER_REQUEST",
            checkoutAttemptId,
            "reconciliation-worker",
        ],
    );
    const outcome = result?.result?.outcome;
    if (!outcome || !["CLAIMED", "IN_PROGRESS", "COMPLETED"].includes(outcome)) {
        throw new Error(`Durable bind claim returned ${outcome || "no outcome"}`);
    }
}

/** Executes the real, idempotent repair behind the admin retry action. */
export async function retryPaymentReconciliationEvent(event: RetryablePaymentReconciliationEvent) {
    if (event.kind === "EMBEDDED_PAYMENT_IDEMPOTENCY_COMPLETION") {
        await retryEmbeddedIdempotencyCompletion(event.context);
        return;
    }
    if (event.kind === "EMBEDDED_PAYMENT_DURABLE_BIND") {
        await retryEmbeddedPaymentDurableBind(event.context);
        return;
    }
    if (event.kind === "SUBSCRIPTION_PLAN_CHANGE_RECONCILIATION") {
        /* Plan-change events carry only { changeClaimKey, txHashes } — the generic
           subscription handler's required context does not exist for them. */
        await retrySubscriptionPlanChangeReconciliation(event.context);
        return;
    }
    if (event.kind.startsWith("SUBSCRIPTION_")) {
        await retrySubscriptionReconciliation(event.context);
        return;
    }
    if (event.kind === "CIRCLE_TRANSACTION_NOTIFICATION") {
        await retryCircleTransactionNotification(event.context);
        return;
    }
    if (event.kind === "VAULT_DRAW_MIRROR_SYNC") {
        await retryVaultDrawMirrorSync(event.context);
        return;
    }
    throw new Error(`No automatic reconciliation handler exists for ${event.kind}`);
}

type ClaimedReconciliationEvent = RetryablePaymentReconciliationEvent & {
    attempt_count: number;
};

/** Autonomously drains due operations events. Claims use SKIP LOCKED and every
 * final transition is fenced by attempt_count so a stale worker cannot finish a
 * lease that a newer worker reclaimed. */
export async function processPaymentReconciliationEvents(limit: number = 25) {
    const boundedLimit = Math.max(1, Math.min(Math.trunc(limit), 100));
    const events = await pgQuery<ClaimedReconciliationEvent>(
        `with candidates as (
            select id
            from public.payment_reconciliation_events
            where (
                (status in ('PENDING', 'RETRY_REQUESTED') and next_attempt_at <= now())
                or (status = 'PROCESSING' and updated_at < now() - interval '10 minutes')
            )
            order by next_attempt_at, created_at
            limit $1
            for update skip locked
        )
        update public.payment_reconciliation_events event
        set status = 'PROCESSING',
            attempt_count = event.attempt_count + 1,
            updated_at = now()
        from candidates
        where event.id = candidates.id
        returning event.id, event.kind, event.context, event.attempt_count`,
        [boundedLimit],
    );

    const results: Array<{ id: string; success: boolean; error?: string; deadLettered?: boolean }> = [];
    for (const event of events) {
        try {
            await retryPaymentReconciliationEvent(event);
            const resolved = await pgMaybeOne<{ id: string }>(
                `update public.payment_reconciliation_events
                 set status = 'RESOLVED', last_error = null, resolved_at = now(), updated_at = now()
                 where id = $1::uuid and status = 'PROCESSING' and attempt_count = $2
                 returning id`,
                [event.id, event.attempt_count],
            );
            if (!resolved) throw new Error("Reconciliation lease changed before completion");
            results.push({ id: event.id, success: true });
        } catch (error) {
            const message = error instanceof Error ? error.message : "Reconciliation retry failed";
            if (event.attempt_count >= MAX_RECONCILIATION_ATTEMPTS) {
                /* Dead-letter: park the poison row in the terminal RESOLVED state with the failure
                   preserved in last_error and a context marker, so it stops being re-selected and
                   stops keeping the reconcile cron perpetually unhealthy. It is NOT a success, but
                   it is no longer an actively-failing event — surface it as dead-lettered for
                   manual review rather than counting it against batch health forever. */
                await pgMaybeOne<{ id: string }>(
                    `update public.payment_reconciliation_events
                     set status = 'RESOLVED',
                         last_error = left($3, 4000),
                         context = coalesce(context, '{}'::jsonb) || jsonb_build_object('deadLetteredAt', now()::text, 'deadLetterReason', left($3, 500)),
                         resolved_at = now(),
                         updated_at = now()
                     where id = $1::uuid and status = 'PROCESSING' and attempt_count = $2
                     returning id`,
                    [event.id, event.attempt_count, message],
                );
                console.error("[ALERT] [payment-reconciliation] DEAD-LETTERED after exhausting retries — manual review required", { id: event.id, kind: event.kind, attempts: event.attempt_count, error });
                results.push({ id: event.id, success: true, deadLettered: true, error: message });
                continue;
            }
            await pgMaybeOne<{ id: string }>(
                `update public.payment_reconciliation_events
                 set status = 'PENDING',
                     last_error = left($3, 4000),
                     next_attempt_at = now() + make_interval(
                         secs => least(3600, (30 * power(2, least(attempt_count, 7)))::integer)
                     ),
                     updated_at = now()
                 where id = $1::uuid and status = 'PROCESSING' and attempt_count = $2
                 returning id`,
                [event.id, event.attempt_count, message],
            );
            console.error("[payment-reconciliation] automatic retry failed", { id: event.id, kind: event.kind, error });
            results.push({ id: event.id, success: false, error: message });
        }
    }

    return {
        success: results.every((result) => result.success),
        processedCount: events.length,
        deadLetteredCount: results.filter((result) => result.deadLettered).length,
        results,
    };
}
