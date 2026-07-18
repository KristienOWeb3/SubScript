import { withPgClient } from "@/lib/serverPg";
import { PREMIUM_PAYMENT_RECIPIENT_ADDRESS } from "@/lib/contracts/constants";

type WebhookData = Record<string, unknown>;

type ExistingSubscription = {
    merchant_address: string;
    subscriber: string | null;
    current_nonce: number | string | null;
    last_settlement_timestamp: Date | string | null;
    next_billing_date: Date | string | null;
    billing_interval_seconds: number | string | null;
    amount_cap_usdc: number | string | null;
    payment_tx_hash: string | null;
    status: string | null;
    kind: string | null;
    tier: number | string | null;
};

type MerchantInfo = {
    tier: string;
    payout_destination: string | null;
};

export type InboundWebhookResult =
    | { outcome: "duplicate" }
    | { outcome: "obsolete" }
    | {
        outcome: "processed";
        exitSurveySubId: number | null;
        merchantInfo: MerchantInfo | null;
    };

export class InboundWebhookPayloadError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "InboundWebhookPayloadError";
    }
}

function strictNonNegativeInt(value: unknown): number | null {
    if (value === undefined || value === null) return null;
    const text = String(value).trim();
    if (!/^\d+$/.test(text)) return null;
    const parsed = Number(text);
    return Number.isSafeInteger(parsed) ? parsed : null;
}

function nullableString(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

function subscriptionAmountMicros(data: WebhookData, existing: ExistingSubscription | null) {
    const microsRaw = data.amount_usdc_micros ?? data.amountUsdcMicros;
    if (microsRaw !== undefined && microsRaw !== null) {
        const microsText = String(microsRaw).trim();
        if (!/^\d+$/.test(microsText)) {
            throw new InboundWebhookPayloadError("Bad Request: malformed subscription amount");
        }
        return BigInt(microsText).toString();
    }

    if (data.amount !== undefined && data.amount !== null && data.amount !== "") {
        const decimalText = String(data.amount).trim();
        if (!/^\d+(\.\d{1,6})?$/.test(decimalText)) {
            throw new InboundWebhookPayloadError("Bad Request: malformed subscription amount");
        }
        const [whole, fraction = ""] = decimalText.split(".");
        return BigInt(`${whole}${fraction.padEnd(6, "0")}`).toString();
    }

    return String(existing?.amount_cap_usdc ?? 0);
}

/**
 * Commits the signed webhook receipt and the subscription state it authorizes in one
 * PostgreSQL transaction. The transaction-scoped advisory lock serializes deliveries for the
 * same transaction hash, including the "no webhook_events row exists yet" case that a row lock
 * alone cannot protect.
 */
export async function processInboundSubscriptionWebhook(input: {
    event: string;
    data: WebhookData;
    payload: Record<string, unknown>;
    txHash: string;
    merchantAddress: string;
}): Promise<InboundWebhookResult> {
    return withPgClient(async (client) => {
        await client.query("begin");
        try {
            await client.query(
                "select pg_advisory_xact_lock(hashtextextended($1, 7301))",
                [input.txHash],
            );

            const priorEvent = await client.query(
                `select id
                   from public.webhook_events
                  where tx_hash = $1
                  for update`,
                [input.txHash],
            );
            if (priorEvent.rowCount > 0) {
                await client.query("commit");
                return { outcome: "duplicate" } as const;
            }

            const subIdRaw = input.data.subscriptionId ?? input.data.subId;
            const cleanSubId = subIdRaw !== undefined && subIdRaw !== null
                ? strictNonNegativeInt(String(subIdRaw).replace(/^sub_/, ""))
                : null;
            if (
                subIdRaw !== undefined
                && subIdRaw !== null
                && String(subIdRaw).trim() !== ""
                && cleanSubId === null
            ) {
                throw new InboundWebhookPayloadError("Bad Request: malformed subscription id");
            }

            let exitSurveySubId: number | null = null;
            if (cleanSubId !== null) {
                const existingResult = await client.query(
                    `select merchant_address, subscriber, current_nonce, last_settlement_timestamp,
                            next_billing_date, billing_interval_seconds, amount_cap_usdc,
                            payment_tx_hash, status, kind, tier
                       from public.subscriptions
                      where subscription_id = $1
                      for update`,
                    [cleanSubId],
                );
                const existing = (existingResult.rows[0] as ExistingSubscription | undefined) ?? null;
                const incomingSubscriber = nullableString(input.data.subscriber)?.toLowerCase() ?? null;
                const incomingKind = input.merchantAddress === PREMIUM_PAYMENT_RECIPIENT_ADDRESS.toLowerCase()
                    ? "PREMIUM"
                    : "CUSTOMER";

                if (existing?.kind === "PREMIUM" && incomingKind !== "PREMIUM") {
                    await client.query("commit");
                    return { outcome: "obsolete" } as const;
                }

                const canonicalOwner = incomingKind === "PREMIUM"
                    ? (incomingSubscriber || existing?.subscriber || existing?.merchant_address)
                    : input.merchantAddress;
                if (!canonicalOwner) {
                    throw new InboundWebhookPayloadError("Bad Request: Missing premium subscriber identity");
                }

                await client.query(
                    `insert into public.merchants (wallet_address)
                     values ($1)
                     on conflict (wallet_address) do nothing`,
                    [canonicalOwner],
                );

                const amountMicros = subscriptionAmountMicros(input.data, existing);
                const periodParsed = strictNonNegativeInt(input.data.period);
                const period = periodParsed ?? Number(existing?.billing_interval_seconds || 0);
                const settlesPayment = [
                    "subscription.created",
                    "subscription.renewed",
                    "payment.executed",
                    "subscription.payment.executed",
                ].includes(input.event);
                const now = new Date();
                const lastSettlementTimestamp = settlesPayment
                    ? now.toISOString()
                    : existing?.last_settlement_timestamp ?? null;
                const nextBillingDate = settlesPayment && period > 0
                    ? new Date(now.getTime() + period * 1000).toISOString()
                    : existing?.next_billing_date ?? null;
                const status = input.event === "subscription.cancelled" || input.event === "subscription.expired"
                    ? "CANCELED"
                    : input.event === "subscription.payment.failed"
                        ? "FAILED"
                        : "ACTIVE";
                const subscriber = incomingSubscriber
                    || existing?.subscriber
                    || (incomingKind === "PREMIUM" ? canonicalOwner : null);
                const currentNonce = strictNonNegativeInt(input.data.currentNonce)
                    ?? Number(existing?.current_nonce || 0);
                const paymentTxHash = nullableString(input.data.nextCommitment)
                    || nullableString(input.data.nullifierHash)
                    || existing?.payment_tx_hash
                    || null;

                await client.query(
                    `insert into public.subscriptions (
                        subscription_id,
                        merchant_address,
                        subscriber,
                        current_nonce,
                        last_settlement_timestamp,
                        next_billing_date,
                        billing_interval_seconds,
                        amount_cap_usdc,
                        payment_tx_hash,
                        status,
                        kind,
                        tier,
                        updated_at
                    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
                    on conflict (subscription_id) do update set
                        merchant_address = excluded.merchant_address,
                        subscriber = excluded.subscriber,
                        current_nonce = excluded.current_nonce,
                        last_settlement_timestamp = excluded.last_settlement_timestamp,
                        next_billing_date = excluded.next_billing_date,
                        billing_interval_seconds = excluded.billing_interval_seconds,
                        amount_cap_usdc = excluded.amount_cap_usdc,
                        payment_tx_hash = excluded.payment_tx_hash,
                        status = excluded.status,
                        kind = excluded.kind,
                        tier = excluded.tier,
                        updated_at = now()`,
                    [
                        cleanSubId,
                        canonicalOwner,
                        subscriber,
                        currentNonce,
                        lastSettlementTimestamp,
                        nextBillingDate,
                        period,
                        amountMicros,
                        paymentTxHash,
                        status,
                        incomingKind,
                        incomingKind === "PREMIUM" ? 1 : Number(existing?.tier || 0),
                    ],
                );

                if (status === "CANCELED" || status === "FAILED") {
                    exitSurveySubId = cleanSubId;
                }
            }

            const merchantResult = await client.query(
                `select tier, payout_destination
                   from public.merchants
                  where wallet_address = $1
                  limit 1`,
                [input.merchantAddress],
            );
            const merchantInfo = (merchantResult.rows[0] as MerchantInfo | undefined) ?? null;

            /* The receipt is deliberately the final write, but unlike the old implementation all
               preceding state changes now share this transaction and roll back with it. */
            try {
                await client.query(
                    `insert into public.webhook_events (tx_hash, event_type, payload)
                     values ($1, $2, $3::jsonb)`,
                    [input.txHash, input.event, JSON.stringify(input.payload)],
                );
            } catch (error) {
                const dbError = error as { code?: string; constraint?: string };
                if (dbError.code === "23505" && dbError.constraint === "webhook_events_tx_hash_key") {
                    await client.query("rollback");
                    return { outcome: "duplicate" } as const;
                }
                throw error;
            }

            await client.query("commit");
            return { outcome: "processed", exitSurveySubId, merchantInfo } as const;
        } catch (error) {
            await client.query("rollback");
            throw error;
        }
    });
}
