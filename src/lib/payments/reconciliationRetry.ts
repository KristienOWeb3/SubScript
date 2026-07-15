import { prisma } from "@/lib/prisma";
import { pgMaybeOne, pgQuery } from "@/lib/serverPg";
import { mirrorSubscriptionCreated } from "@/lib/subscriptions/mirror";
import {
    findActiveOnChainSubscriptionId,
    getSubscriptionOnChain,
} from "@/lib/subscriptions/onchain";
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

/** Executes the real, idempotent repair behind the admin retry action. */
export async function retryPaymentReconciliationEvent(event: RetryablePaymentReconciliationEvent) {
    if (event.kind === "EMBEDDED_PAYMENT_IDEMPOTENCY_COMPLETION") {
        await retryEmbeddedIdempotencyCompletion(event.context);
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
                         context = context || jsonb_build_object('deadLetteredAt', now()::text, 'deadLetterReason', left($3, 500)),
                         resolved_at = now(),
                         updated_at = now()
                     where id = $1::uuid and status = 'PROCESSING' and attempt_count = $2
                     returning id`,
                    [event.id, event.attempt_count, message],
                );
                console.error("[payment-reconciliation] DEAD-LETTERED after exhausting retries — manual review required", { id: event.id, kind: event.kind, attempts: event.attempt_count, error });
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
