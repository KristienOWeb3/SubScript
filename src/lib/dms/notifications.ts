import type { Prisma, SubscriptDm } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendPushToWallet, type PushDeliveryResult } from "@/lib/push";

export type DmPushInput = {
    id?: string | null;
    senderAddress: string;
    receiverAddress: string;
    messageType: string;
    title?: string | null;
    description?: string | null;
};

export type SupabaseDmInsert = {
    sender_address: string;
    receiver_address: string;
    message_type: string;
    status: string;
    amount_usdc?: string | number | null;
    title?: string | null;
    description?: string | null;
    tx_hash?: string | null;
    payment_link_id?: string | null;
};

const FALLBACK_TITLES: Record<string, string> = {
    CHURN_SURVEY: "Subscription feedback requested",
    DEBIT_SUCCESS: "Payment confirmed",
    EXPIRY_WARNING: "Subscription needs attention",
    PAYMENT_REQUEST: "New payment request",
    PEER_REACTION: "New reaction",
    PEER_REQUEST: "New payment request",
    PEER_TRANSFER: "USDC received",
    SUBSCRIPTION_STARTED: "Subscription updated",
};

function notificationText(value: string | null | undefined, maxLength: number): string | null {
    const normalized = value?.replace(/\s+/g, " ").trim();
    if (!normalized) return null;
    return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}…`;
}

/**
 * Deliver the device notification for a DM that has already been committed.
 *
 * This function never makes DM persistence fail: Web Push is a best-effort side effect, while
 * the inbox row remains the durable source of truth. Awaiting it keeps serverless runtimes alive
 * long enough to hand the message to the browser push service.
 */
export async function pushDmNotification(dm: DmPushInput): Promise<PushDeliveryResult | null> {
    const receiver = dm.receiverAddress.toLowerCase();
    const sender = dm.senderAddress.toLowerCase();
    if (!receiver || receiver === sender) return null;

    const title =
        notificationText(dm.title, 100) ||
        FALLBACK_TITLES[dm.messageType] ||
        "New SubScript message";
    const body =
        notificationText(dm.description, 180) ||
        "Open SubScript to view this message.";

    try {
        return await sendPushToWallet(receiver, {
            title,
            body,
            url: `/user?tab=inbox&chat=${encodeURIComponent(sender)}`,
            tag: dm.id ? `dm-${dm.id}` : undefined,
        });
    } catch (error) {
        console.error("[dms] device notification failed:", error instanceof Error ? error.message : error);
        return null;
    }
}

/** Prisma boundary: no caller can commit a DM without also attempting its device notification. */
export async function createDmAndNotify(
    data: Prisma.SubscriptDmUncheckedCreateInput
): Promise<SubscriptDm> {
    const dm = await prisma.subscriptDm.create({ data });
    await pushDmNotification(dm);
    return dm;
}

/**
 * Supabase Data API boundary for cron/legacy paths. The service client is intentionally supplied
 * by the caller so existing request-scoped clients and error handling remain unchanged.
 */
export async function insertSupabaseDmAndNotify(
    supabase: any,
    row: SupabaseDmInsert
): Promise<{ id: string }> {
    const { data, error } = await supabase
        .from("subscript_dms")
        .insert(row)
        .select("id")
        .single();

    if (error || !data?.id) {
        throw new Error(error?.message || "DM insert did not return an id");
    }

    await pushDmNotification({
        id: data.id,
        senderAddress: row.sender_address,
        receiverAddress: row.receiver_address,
        messageType: row.message_type,
        title: row.title,
        description: row.description,
    });

    return { id: data.id };
}

/**
 * Direct-Postgres boundary for transaction-heavy paths. The caller must invoke
 * pushDmNotification() only after its surrounding transaction commits.
 */
export async function insertPgDm(
    client: any,
    row: SupabaseDmInsert
): Promise<DmPushInput & { id: string }> {
    const result = await client.query(
        `insert into subscript_dms (
            sender_address,
            receiver_address,
            message_type,
            status,
            amount_usdc,
            title,
            description,
            tx_hash,
            payment_link_id
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        returning id`,
        [
            row.sender_address,
            row.receiver_address,
            row.message_type,
            row.status,
            row.amount_usdc ?? null,
            row.title ?? null,
            row.description ?? null,
            row.tx_hash ?? null,
            row.payment_link_id ?? null,
        ]
    );

    const id = result.rows[0]?.id;
    if (!id) throw new Error("DM insert did not return an id");

    return {
        id,
        senderAddress: row.sender_address,
        receiverAddress: row.receiver_address,
        messageType: row.message_type,
        title: row.title,
        description: row.description,
    };
}
