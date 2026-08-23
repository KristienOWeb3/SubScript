import { withPgClient } from "@/lib/serverPg";
import { generateReceiptId } from "@/lib/arc/memo";
import {
    insertPgDm,
    pushDmNotification,
    type DmPushInput,
} from "@/lib/dms/notifications";
import { accountDisplayName } from "@/lib/identityDisplay";
import { assertNotBlocked } from "@/lib/dms/blocks";

type CreateUserPaymentRequestInput = {
    requester: string;
    receiver: string | null;
    amountMicros: bigint;
    title: string;
    description: string;
    expiresAt?: Date | null;
    dmOnly?: boolean;
    isRecurring?: boolean;
    periodSeconds?: number | bigint | null;
};

function formatPeriodDescription(seconds: bigint | number): string {
    const s = Number(seconds);
    const days = Math.round(s / 86400);
    if (days === 1) return "daily";
    if (days === 7) return "weekly";
    if (days >= 28 && days <= 31) return "monthly";
    if (days >= 364 && days <= 366) return "yearly";
    return `every ${days} days`;
}

export async function createUserPaymentRequest({
    requester,
    receiver,
    amountMicros,
    title,
    description,
    expiresAt = null,
    dmOnly = false,
    isRecurring = false,
    periodSeconds = 2592000, // 30 days
}: CreateUserPaymentRequestInput) {
    if (receiver) {
        await assertNotBlocked(requester, receiver, "creating payment request");
    }

    const periodSecs = BigInt(periodSeconds || 2592000);

    const created = await withPgClient(async (client) => {
        await client.query("begin");
        try {
            await client.query(
                `insert into customers (wallet_address)
                 values ($1)
                 on conflict (wallet_address) do nothing`,
                [requester]
            );

            const aliasResult = await client.query(
                `select alias
                 from address_aliases
                 where lower(address) = lower($1)
                 limit 1`,
                [requester],
            );
            const requesterName = accountDisplayName(aliasResult.rows[0]?.alias);

            let planId: string | null = null;
            if (isRecurring) {
                const planResult = await client.query(
                    `insert into merchant_plans (
                        merchant_address,
                        name,
                        description,
                        amount_usdc,
                        period_seconds,
                        target_subscriber,
                        active
                    ) values ($1, $2, $3, $4, $5, $6, true)
                    returning id`,
                    [
                        requester,
                        title,
                        description,
                        amountMicros.toString(),
                        periodSecs.toString(),
                        receiver || null,
                    ]
                );
                planId = planResult.rows[0]?.id || null;
            }

            const stateSnapshot = isRecurring && planId ? JSON.stringify({
                isSubscriptionCheckout: true,
                planId,
                periodSeconds: periodSecs.toString(),
                billingType: "RECURRING",
            }) : null;

            const linkResult = await client.query(
                `insert into payment_links (
                    merchant_address,
                    title,
                    description,
                    amount_usdc,
                    active,
                    max_uses,
                    expires_at,
                    receiver_address,
                    merchant_name_snapshot,
                    external_reference,
                    receipt_token,
                    link_kind,
                    sandbox_mode,
                    state_snapshot
                ) values ($1, $2, $3, $4, true, $5, $6, $7, $8, $9, $10, $11, false, $12)
                returning id`,
                [
                    requester,
                    title,
                    description,
                    amountMicros.toString(),
                    isRecurring ? null : 1,
                    expiresAt ? expiresAt.toISOString() : null,
                    receiver,
                    requesterName,
                    `${isRecurring ? "recurring" : "peer-request"}:${requester}:${Date.now()}`,
                    generateReceiptId(title),
                    isRecurring ? "PEER_PLAN" : "PEER_REQUEST",
                    stateSnapshot,
                ]
            );

            const paymentLinkId = linkResult.rows[0]?.id;
            if (!paymentLinkId) {
                throw new Error("Failed to create payment link");
            }

            let dmId: string | null = null;
            let dmNotification: DmPushInput | null = null;
            if (receiver) {
                const amount = Number(amountMicros) / 1_000_000;
                const messageType = isRecurring ? "SUBSCRIPTION_OFFER" : "PEER_REQUEST";
                const dmTitle = isRecurring
                    ? `${amount.toFixed(2)} USDC / ${formatPeriodDescription(periodSecs)} subscription requested`
                    : `${amount.toFixed(6).replace(/\.?0+$/, "")} USDC requested`;

                const insertedDm = await insertPgDm(client, {
                    sender_address: requester,
                    receiver_address: receiver,
                    message_type: messageType,
                    status: "PENDING",
                    amount_usdc: amountMicros.toString(),
                    title: dmTitle,
                    description: [
                        description,
                        `Requested by: ${requesterName}`,
                        `Amount: ${amount.toFixed(2)} USDC ${isRecurring ? `(${formatPeriodDescription(periodSecs)})` : ""}`,
                        isRecurring ? `Plan: ${title}` : null,
                        expiresAt ? `Valid until: ${expiresAt.toLocaleString("en-US")}` : null,
                        isRecurring ? "Recurring subscription request via SubScript." : "This is a structured SubScript payment request, not a free-form chat.",
                    ].filter(Boolean).join("\n"),
                    payment_link_id: isRecurring && planId ? planId : paymentLinkId,
                });
                dmNotification = insertedDm;
                dmId = insertedDm.id;
            }

            await client.query("commit");
            return { paymentLinkId, planId, dmId, dmNotification, isRecurring };
        } catch (error) {
            await client.query("rollback");
            throw error;
        }
    });

    /* The transaction is committed and its connection released before external push I/O. */
    if (created.dmNotification) {
        await pushDmNotification(created.dmNotification);
    }
    return {
        paymentLinkId: created.paymentLinkId,
        planId: created.planId,
        dmId: created.dmId,
        isRecurring: created.isRecurring
    };
}
