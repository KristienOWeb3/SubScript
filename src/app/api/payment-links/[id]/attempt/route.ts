import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { getSessionWallet } from "@/lib/auth";
import { getVerifiedAccountEmail } from "@/lib/auth/verifiedEmail";
import { isValidPaymentLinkId } from "@/lib/paymentLinks/validation";

type RouteContext = { params: Promise<{ id: string }> };

function serviceClient() {
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    return url && key ? createClient(url, key) : null;
}

function isAttemptId(value: unknown): value is string {
    return typeof value === "string"
        && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function authenticatedPayer(request: Request) {
    const wallet = await getSessionWallet(request.headers);
    if (!wallet) return null;
    const verified = await getVerifiedAccountEmail(wallet);
    return verified?.email ? wallet.toLowerCase() : null;
}

export async function POST(request: Request, { params }: RouteContext) {
    const payer = await authenticatedPayer(request);
    if (!payer) {
        return NextResponse.json({ error: "Sign in and verify your email before paying." }, { status: 401 });
    }
    const { id } = await params;
    if (!isValidPaymentLinkId(id)) {
        return NextResponse.json({ error: "Payment Link Not Found" }, { status: 404 });
    }
    const body = await request.json().catch(() => null);
    if (!isAttemptId(body?.attemptId)) {
        return NextResponse.json({ error: "Invalid checkout attempt" }, { status: 400 });
    }
    const supabase = serviceClient();
    if (!supabase) return NextResponse.json({ error: "Configuration Error" }, { status: 500 });

    const { data, error } = await supabase.rpc("reserve_payment_link_checkout_attempt", {
        p_attempt_id: body.attemptId,
        p_payment_link_id: id,
        p_payer_address: payer,
        p_ttl_seconds: 600,
    });
    if (error) {
        console.error("Checkout-attempt reservation failed:", error.message);
        return NextResponse.json({ error: "Unable to reserve this checkout attempt" }, { status: 503 });
    }
    if (data?.outcome === "DISABLED") {
        return NextResponse.json({ error: "Hosted payments are temporarily unavailable." }, { status: 503 });
    }
    if (data?.outcome === "LINK_UNAVAILABLE") {
        return NextResponse.json({ error: "Payment link is inactive, expired, simulation-only, or at its usage limit." }, { status: 409 });
    }
    if (data?.outcome === "IN_PROGRESS") {
        return NextResponse.json({ error: "A payment for this link is already in progress." }, { status: 409 });
    }
    if (data?.outcome === "FINGERPRINT_MISMATCH") {
        return NextResponse.json({ error: "Checkout attempt belongs to a different payment." }, { status: 409 });
    }
    if (data?.outcome === "RELEASED") {
        /* Terminal attempt: the client must rotate to a fresh attempt UUID before paying. */
        return NextResponse.json(
            { error: "This checkout attempt was released. Start a new payment attempt.", code: "ATTEMPT_RELEASED" },
            { status: 409 },
        );
    }
    if (data?.outcome === "SUBMITTED") {
        /* A transaction is already bound. The bound hash is returned only here, to the
           authenticated payer, so the browser can resume verification — never pay again. */
        return NextResponse.json(
            {
                error: "A payment for this checkout attempt was already submitted.",
                code: "ALREADY_SUBMITTED",
                txHash: data.txHash ?? null,
                receiptId: data.receiptId,
                settlementChainId: Number(data.settlementChainId),
            },
            { status: 409 },
        );
    }
    if (data?.outcome !== "RESERVED" && data?.outcome !== "SETTLED") {
        return NextResponse.json({ error: "Unable to reserve this checkout attempt" }, { status: 409 });
    }
    return NextResponse.json({
        success: true,
        receiptId: data.receiptId,
        amountUsdc: data.amountUsdc,
        merchantAddress: data.merchantAddress,
        linkKind: data.linkKind,
        sandbox: data.sandbox === true,
        settlementChainId: Number(data.settlementChainId),
        settled: data.outcome === "SETTLED",
        txHash: data.outcome === "SETTLED" ? (data.txHash ?? null) : null,
    });
}

/* Read-only attempt state for the authenticated payer. Lets a reloaded browser (or one whose
   sessionStorage was cleared) resume a SUBMITTED transaction, or learn that a stale attempt
   UUID is terminal, without reserving anything. */
export async function GET(request: Request, { params }: RouteContext) {
    const payer = await authenticatedPayer(request);
    if (!payer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    if (!isValidPaymentLinkId(id)) return NextResponse.json({ error: "Payment Link Not Found" }, { status: 404 });
    const attemptId = new URL(request.url).searchParams.get("attempt");
    if (!isAttemptId(attemptId)) return NextResponse.json({ error: "Invalid checkout attempt" }, { status: 400 });
    const supabase = serviceClient();
    if (!supabase) return NextResponse.json({ error: "Configuration Error" }, { status: 500 });

    const { data, error } = await supabase
        .from("payment_link_checkout_attempts")
        .select("status, tx_hash, receipt_id, settlement_chain_id, payer_address, payment_link_id")
        .eq("attempt_id", attemptId)
        .maybeSingle();
    if (error) return NextResponse.json({ error: "Unable to read checkout attempt" }, { status: 503 });
    if (!data || data.payment_link_id !== id || String(data.payer_address).toLowerCase() !== payer) {
        return NextResponse.json({ exists: false });
    }
    const terminal = data.status === "RELEASED" || data.status === "FAILED_TERMINAL";
    return NextResponse.json({
        exists: true,
        status: terminal ? "RELEASED" : data.status,
        txHash: data.status === "SUBMITTED" || data.status === "SETTLED" ? data.tx_hash : null,
        receiptId: terminal ? null : data.receipt_id,
        settlementChainId: Number(data.settlement_chain_id),
    });
}

export async function DELETE(request: Request, { params }: RouteContext) {
    const payer = await authenticatedPayer(request);
    if (!payer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    if (!isValidPaymentLinkId(id)) return NextResponse.json({ error: "Payment Link Not Found" }, { status: 404 });
    const attemptId = new URL(request.url).searchParams.get("attempt");
    if (!isAttemptId(attemptId)) return NextResponse.json({ error: "Invalid checkout attempt" }, { status: 400 });
    const supabase = serviceClient();
    if (!supabase) return NextResponse.json({ error: "Configuration Error" }, { status: 500 });
    const { data, error } = await supabase.rpc("release_payment_link_checkout_attempt", {
        p_attempt_id: attemptId,
        p_payer_address: payer,
    });
    if (error) return NextResponse.json({ error: "Unable to release checkout attempt" }, { status: 503 });
    return NextResponse.json({ success: true, released: data?.outcome === "RELEASED" });
}
