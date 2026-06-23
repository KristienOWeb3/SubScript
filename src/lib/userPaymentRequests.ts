import { withPgClient } from "@/lib/serverPg";
import { generateReceiptId } from "@/lib/arc/memo";

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
    return withPgClient(async (client) => {
        await client.query("begin");
        try {
            await client.query(
                `insert into customers (wallet_address)
                 values ($1)
                 on conflict (wallet_address) do nothing`,
                [requester]
            );

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
                    receipt_token
                ) values ($1, $2, $3, $4, true, 1, $5, $6, $7, $8, $9)
                returning id`,
                [
                    requester,
                    title,
                    description,
                    amountMicros.toString(),
                    expiresAt ? expiresAt.toISOString() : null,
                    receiver,
                    "SubScript user request",
                    `${dmOnly ? "dm-peer-request" : "peer-request"}:${requester}:${Date.now()}`,
                    generateReceiptId(title),
                ]
            );

            const paymentLinkId = linkResult.rows[0]?.id;
            if (!paymentLinkId) {
                throw new Error("Failed to create payment link");
            }

            let dmId: string | null = null;
            if (receiver) {
                const amount = Number(amountMicros) / 1_000_000;
                const dmResult = await client.query(
                    `insert into subscript_dms (
                        sender_address,
                        receiver_address,
                        message_type,
                        status,
                        amount_usdc,
                        title,
                        description,
                        payment_link_id
                    ) values ($1, $2, 'PEER_REQUEST', 'PENDING', $3, $4, $5, $6)
                    returning id`,
                    [
                        requester,
                        receiver,
                        amountMicros.toString(),
                        `${amount.toFixed(6).replace(/\.?0+$/, "")} USDC requested`,
                        [
                            description,
                            `Requester: ${requester}`,
                            `Amount: ${amount.toFixed(6).replace(/\.?0+$/, "")} USDC`,
                            expiresAt ? `Valid until: ${expiresAt.toLocaleString("en-US")}` : null,
                            "This is a structured SubScript payment request, not a free-form chat.",
                        ].filter(Boolean).join("\n"),
                        paymentLinkId,
                    ]
                );
                dmId = dmResult.rows[0]?.id || null;
            }

            await client.query("commit");
            return { paymentLinkId, dmId };
        } catch (error) {
            await client.query("rollback");
            throw error;
        }
    });
}
