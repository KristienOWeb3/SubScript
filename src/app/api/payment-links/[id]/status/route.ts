import { NextResponse } from "next/server";
import { rateLimitKeyDigest } from "@/lib/distributedRateLimit";
import { paymentLinkSettlementVersion } from "@/lib/paymentLinks/settlementVersion";
import { isValidPaymentLinkId } from "@/lib/paymentLinks/validation";
import { pgMaybeOne } from "@/lib/serverPg";

type RouteContext = {
    params: Promise<{ id: string }>;
};

type PaymentLinkStatusRow = {
    allowed: boolean;
    retry_after_seconds: number;
    remaining: number;
    link_id: string | null;
    use_count: number | string | null;
    attempt_settled: boolean;
    attempt_receipt_id: string | null;
    attempt_created_at: Date | string | null;
};

const STATUS_RATE_LIMIT = 60;
const STATUS_RATE_WINDOW_SECONDS = 60;

export async function GET(request: Request, { params }: RouteContext) {
    const { id } = await params;
    if (!isValidPaymentLinkId(id)) {
        return NextResponse.json({ error: "Payment Link Not Found" }, { status: 404 });
    }

    const attempt = new URL(request.url).searchParams.get("attempt");
    if (typeof attempt !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(attempt)) {
        return NextResponse.json({ error: "Invalid checkout attempt" }, { status: 400 });
    }

    const requesterIp = (request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "")
        .split(",")[0]
        .trim() || "unknown";

    let result: PaymentLinkStatusRow | null;
    try {
        /* The limiter consumption and attempt-scoped status lookup intentionally share one
           statement/round trip. A denied request cannot reach the payment tables, and a normal
           3-second client poll remains well under the 60 requests/minute per-IP allowance. */
        result = await pgMaybeOne<PaymentLinkStatusRow>(
            `with params as (
                select to_timestamp(
                    floor(extract(epoch from statement_timestamp()) / $4::integer) * $4::integer
                ) as window_start
            ), cleanup as (
                delete from public.api_rate_limit_windows
                where expires_at < statement_timestamp() - interval '5 minutes'
            ), consumed as (
                insert into public.api_rate_limit_windows (
                    scope,
                    key_hash,
                    window_started_at,
                    request_count,
                    expires_at
                )
                select $1, $2, window_start, 1, window_start + make_interval(secs => $4::integer)
                from params
                on conflict (scope, key_hash, window_started_at)
                do update set
                    request_count = public.api_rate_limit_windows.request_count + 1,
                    expires_at = excluded.expires_at
                returning request_count, expires_at
            ), link_status as (
                select
                    pl.id as link_id,
                    pl.use_count,
                    attempt_payment.id is not null as attempt_settled,
                    attempt_receipt.receipt_id as attempt_receipt_id,
                    attempt_payment.created_at as attempt_created_at
                from consumed c
                join public.payment_links pl on pl.id = $5::uuid
                left join lateral (
                    select payment.id, payment.created_at
                    from public.payment_link_payments payment
                    where payment.payment_link_id = pl.id
                      and payment.checkout_attempt_id = $6::uuid
                    order by payment.created_at desc
                    limit 1
                ) attempt_payment on true
                left join public.receipts attempt_receipt
                  on attempt_receipt.payment_link_payment_id = attempt_payment.id
                 and attempt_receipt.status = 'CONFIRMED'
                where c.request_count <= $3::integer
            )
            select
                c.request_count <= $3::integer as allowed,
                case
                    when c.request_count <= $3::integer then 0
                    else greatest(1, ceil(extract(epoch from (c.expires_at - clock_timestamp())))::integer)
                end as retry_after_seconds,
                greatest(0, $3::integer - c.request_count) as remaining,
                ls.link_id,
                ls.use_count,
                coalesce(ls.attempt_settled, false) as attempt_settled,
                ls.attempt_receipt_id,
                ls.attempt_created_at
            from consumed c
            left join link_status ls on true`,
            [
                "payment-link-checkout-status",
                rateLimitKeyDigest(requesterIp),
                STATUS_RATE_LIMIT,
                STATUS_RATE_WINDOW_SECONDS,
                id,
                attempt,
            ],
        );
    } catch (error) {
        console.error("Payment-link status lookup failed:", error);
        return NextResponse.json(
            { error: "Payment status is temporarily unavailable" },
            { status: 503, headers: { "Retry-After": "5" } },
        );
    }

    if (!result) {
        return NextResponse.json({ error: "Unable to read payment status" }, { status: 500 });
    }
    if (!result.allowed) {
        return NextResponse.json(
            { error: "Too many payment-status requests" },
            { status: 429, headers: { "Retry-After": String(result.retry_after_seconds) } },
        );
    }
    if (!result.link_id) {
        return NextResponse.json({ error: "Payment Link Not Found" }, { status: 404 });
    }

    return NextResponse.json({
        useCount: Number(result.use_count || 0),
        attemptSettled: result.attempt_settled === true,
        receiptId: result.attempt_receipt_id || null,
        settlementVersion: paymentLinkSettlementVersion(
            result.attempt_created_at,
            result.attempt_settled ? result.attempt_receipt_id : null,
        ),
    }, {
        headers: {
            "Cache-Control": "no-store, max-age=0",
            "X-RateLimit-Remaining": String(result.remaining),
        },
    });
}
