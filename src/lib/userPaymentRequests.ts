import { withPgClient } from "@/lib/serverPg";
import { generateReceiptId } from "@/lib/arc/memo";
import {
    insertPgDm,
    pushDmNotification,
    type DmPushInput,
} from "@/lib/dms/notifications";
import { accountDisplayName } from "@/lib/identityDisplay";

type CreateUserPaymentRequestInput = {
    requester: string;
    receiver: string | null;
    amountMicros: bigint;
    title: string;
    description: string;
    expiresAt?: Date | null;
    dmOnly?: boolean;
};

export async function createUserPaymentRequest({
    requester,
    receiver,
    amountMicros,
    title,
    description,
    expiresAt = null,
    dmOnly = false,
}: CreateUserPaymentRequestInput) {
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
                    sandbox_mode
                ) values ($1, $2, $3, $4, true, 1, $5, $6, $7, $8, $9, 'PEER_REQUEST', false)
                returning id`,
                [
                    requester,
                    title,
                    description,
                    amountMicros.toString(),
                    expiresAt ? expiresAt.toISOString() : null,
                    receiver,
                    requesterName,
                    `${dmOnly ? "dm-peer-request" : "peer-request"}:${requester}:${Date.now()}`,
                    generateReceiptId(title),
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
                const insertedDm = await insertPgDm(client, {
                    sender_address: requester,
                    receiver_address: receiver,
                    message_type: "PEER_REQUEST",
                    status: "PENDING",
                    amount_usdc: amountMicros.toString(),
                    title: `${amount.toFixed(6).replace(/\.?0+$/, "")} USDC requested`,
                    description: [
                        description,
                        `Requested by: ${requesterName}`,
                        `Amount: ${amount.toFixed(6).replace(/\.?0+$/, "")} USDC`,
                        expiresAt ? `Valid until: ${expiresAt.toLocaleString("en-US")}` : null,
                        "This is a structured SubScript payment request, not a free-form chat.",
                    ].filter(Boolean).join("\n"),
                    payment_link_id: paymentLinkId,
                });
                dmNotification = insertedDm;
                dmId = insertedDm.id;
            }

            await client.query("commit");
            return { paymentLinkId, dmId, dmNotification };
        } catch (error) {
            await client.query("rollback");
            throw error;
        }
    });

    /* The transaction is committed and its connection released before external push I/O. */
    if (created.dmNotification) {
        await pushDmNotification(created.dmNotification);
    }
    return { paymentLinkId: created.paymentLinkId, dmId: created.dmId };
}
