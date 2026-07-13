import { createHash } from "node:crypto";
import { pgMaybeOne } from "@/lib/serverPg";

type ReconciliationContext = Record<string, unknown>;

type RecordReconciliationOptions = {
    dedupeKey: string;
    kind: string;
    message: string;
    context: ReconciliationContext;
    error?: unknown;
};

function errorMessage(error: unknown) {
    if (error instanceof Error) return error.message.slice(0, 4_000);
    if (typeof error === "string") return error.slice(0, 4_000);
    if (error === undefined || error === null) return null;
    try {
        return JSON.stringify(error).slice(0, 4_000);
    } catch {
        return "Unknown reconciliation error";
    }
}

/**
 * Persists a retryable operations event. Persistence is best-effort because it
 * runs only after the payment has already settled; callers must still return a
 * response even when the operations database is unavailable.
 */
export async function recordPaymentReconciliationRequired({
    dedupeKey,
    kind,
    message,
    context,
    error,
}: RecordReconciliationOptions) {
    const lastError = errorMessage(error);
    try {
        if (!dedupeKey) throw new Error("Invalid reconciliation dedupe key");
        if (!kind || kind.length > 120) throw new Error("Invalid reconciliation kind");
        const normalizedDedupeKey = `${kind}:${createHash("sha256").update(dedupeKey, "utf8").digest("hex")}`;

        await pgMaybeOne<{ id: string }>(
            `insert into public.payment_reconciliation_events (
                dedupe_key,
                kind,
                status,
                context,
                last_error,
                next_attempt_at,
                resolved_at,
                updated_at
            ) values ($1, $2, 'PENDING', $3::jsonb, $4, now(), null, now())
            on conflict (dedupe_key)
            do update set
                kind = excluded.kind,
                status = case
                    when public.payment_reconciliation_events.status = 'PROCESSING' then 'PROCESSING'
                    else 'PENDING'
                end,
                context = public.payment_reconciliation_events.context || excluded.context,
                last_error = excluded.last_error,
                next_attempt_at = now(),
                resolved_at = null,
                updated_at = now()
            returning id`,
            [normalizedDedupeKey, kind, JSON.stringify(context), lastError],
        );
        console.error(`[payment-reconciliation] RECONCILIATION_REQUIRED: ${message}`, context, error ?? "");
    } catch (recordError) {
        console.error(
            `[payment-reconciliation] RECONCILIATION_REQUIRED (durable record failed): ${message}`,
            context,
            { originalError: error, recordError },
        );
    }
}
