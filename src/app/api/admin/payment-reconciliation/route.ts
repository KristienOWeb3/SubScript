import { NextResponse } from "next/server";
import { verifyAdminApiKey } from "@/lib/kyc";
import { pgMaybeOne, pgQuery } from "@/lib/serverPg";
import { retryPaymentReconciliationEvent } from "@/lib/payments/reconciliationRetry";

export const maxDuration = 120;

const RECONCILIATION_STATUSES = new Set(["PENDING", "RETRY_REQUESTED", "PROCESSING", "RESOLVED"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ReconciliationRow = {
    id: string;
    dedupe_key: string;
    kind: string;
    status: string;
    context: Record<string, unknown>;
    last_error: string | null;
    attempt_count: number;
    next_attempt_at: Date | string;
    resolved_at: Date | string | null;
    created_at: Date | string;
    updated_at: Date | string;
};

export async function GET(request: Request) {
    if (!verifyAdminApiKey(request.headers)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = new URL(request.url).searchParams;
    const status = searchParams.get("status")?.toUpperCase() || null;
    if (status && !RECONCILIATION_STATUSES.has(status)) {
        return NextResponse.json({ error: "Invalid reconciliation status" }, { status: 400 });
    }
    const rawLimit = searchParams.get("limit") || "50";
    if (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 100) {
        return NextResponse.json({ error: "limit must be an integer from 1 to 100" }, { status: 400 });
    }

    try {
        const events = await pgQuery<ReconciliationRow>(
            `select
                id,
                dedupe_key,
                kind,
                status,
                context,
                last_error,
                attempt_count,
                next_attempt_at,
                resolved_at,
                created_at,
                updated_at
            from public.payment_reconciliation_events
            where ($1::text is null or status = $1)
            order by created_at desc
            limit $2::integer`,
            [status, Number(rawLimit)],
        );
        return NextResponse.json({ success: true, events });
    } catch (error) {
        console.error("Failed to list payment reconciliation events:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    if (!verifyAdminApiKey(request.headers)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const id = typeof body?.id === "string" ? body.id : "";
    const action = body?.action;
    if (!UUID_PATTERN.test(id) || (action !== "retry" && action !== "resolve")) {
        return NextResponse.json({ error: "A valid id and retry/resolve action are required" }, { status: 400 });
    }

    try {
        if (action === "retry") {
            const event = await pgMaybeOne<ReconciliationRow>(
                `update public.payment_reconciliation_events
                set
                    status = 'PROCESSING',
                    attempt_count = attempt_count + 1,
                    next_attempt_at = now(),
                    resolved_at = null,
                    updated_at = now()
                where id = $1::uuid
                  and (
                    status in ('PENDING', 'RETRY_REQUESTED')
                    or (status = 'PROCESSING' and updated_at < now() - interval '10 minutes')
                  )
                returning *`,
                [id],
            );
            if (!event) {
                return NextResponse.json(
                    { error: "Reconciliation event is resolved or already being retried" },
                    { status: 409 },
                );
            }

            try {
                await retryPaymentReconciliationEvent(event);
                const resolved = await pgMaybeOne<ReconciliationRow>(
                    `update public.payment_reconciliation_events
                    set
                        status = 'RESOLVED',
                        last_error = null,
                        resolved_at = now(),
                        updated_at = now()
                    where id = $1::uuid and status = 'PROCESSING'
                    returning *`,
                    [id],
                );
                if (!resolved) throw new Error("Reconciliation event changed while the retry was running");
                return NextResponse.json({
                    success: true,
                    event: resolved,
                    message: "Reconciliation completed",
                });
            } catch (retryError) {
                const message = retryError instanceof Error ? retryError.message : "Reconciliation retry failed";
                await pgMaybeOne<ReconciliationRow>(
                    `update public.payment_reconciliation_events
                    set
                        status = 'PENDING',
                        last_error = left($2, 4000),
                        next_attempt_at = now() + interval '5 minutes',
                        updated_at = now()
                    where id = $1::uuid and status = 'PROCESSING'
                    returning *`,
                    [id, message],
                );
                console.error("Payment reconciliation retry failed:", { id, error: retryError });
                return NextResponse.json({ error: message }, { status: 500 });
            }
        }

        const event = await pgMaybeOne<ReconciliationRow>(
                `update public.payment_reconciliation_events
                set
                    status = 'RESOLVED',
                    resolved_at = now(),
                    updated_at = now()
                where id = $1::uuid
                returning *`,
                [id],
            );

        if (!event) {
            return NextResponse.json({ error: "Reconciliation event not found" }, { status: 404 });
        }
        return NextResponse.json({
            success: true,
            event,
        });
    } catch (error) {
        console.error("Failed to update payment reconciliation event:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
