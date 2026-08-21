import type { Prisma, SubscriptDm } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendPushToWallet, type PushDeliveryResult } from "@/lib/push";
import { DM_TYPES, dmFallbackTitle, isKnownDmType } from "@/lib/dms/catalog";
import { withoutReceiptReference } from "@/lib/dms/receiptPresentation";

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
    dedupe_key?: string | null;
};

/**
 * Surface a recurring type written without a dedupe key.
 *
 * Warn, not throw. The catalog's `recurring` flag is accurate about which types can repeat, but
 * several long-standing call sites (DEBIT_SUCCESS in the keepers, PEER_TRANSFER, WITHDRAWAL)
 * write without a key today. Turning that into an exception here would convert a duplicate
 * inbox row — cosmetic — into a failed payment notification, which is strictly worse. New
 * lifecycle helpers call assertDedupeDiscipline directly and do throw; this is the net that
 * makes the existing offenders visible in logs so they can be fixed deliberately.
 */
function warnOnMissingDedupe(messageType: string, dedupeKey: unknown) {
    if (!isKnownDmType(messageType)) {
        console.warn(
            `[dms] messageType '${messageType}' is not in the catalog, so it has no push title `
            + "or dedupe policy. Register it in src/lib/dms/catalog.ts.",
        );
        return;
    }
    if (DM_TYPES[messageType].recurring && !dedupeKey) {
        console.warn(
            `[dms] recurring type '${messageType}' written without a dedupeKey — it will re-send `
            + "on every pass over the same record.",
        );
    }
}

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
        dmFallbackTitle(dm.messageType);
    /* A device notification is one line a person glances at, so the receipt reference is
       stripped before it becomes the body. The reference stays in the stored DM, where the
       inbox turns it into a "View receipt" link. */
    const body =
        notificationText(withoutReceiptReference(dm.description || ""), 180) ||
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
    warnOnMissingDedupe(String(data.messageType), data.dedupeKey);
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
    warnOnMissingDedupe(row.message_type, row.dedupe_key);
    const query = supabase.from("subscript_dms");
    const { data, error } = row.dedupe_key
        ? await query.upsert(row, { onConflict: "dedupe_key", ignoreDuplicates: true }).select("id").maybeSingle()
        : await query.insert(row).select("id").single();

    if (row.dedupe_key && !data?.id && !error) {
        const { data: existing, error: existingError } = await supabase
            .from("subscript_dms")
            .select("id")
            .eq("dedupe_key", row.dedupe_key)
            .single();
        if (existingError || !existing?.id) throw new Error(existingError?.message || "DM dedupe lookup failed");
        return { id: existing.id };
    }

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
    warnOnMissingDedupe(row.message_type, row.dedupe_key);
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
            , dedupe_key
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
            row.dedupe_key ?? null,
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
