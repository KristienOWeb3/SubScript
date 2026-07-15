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
        return NextResponse.json({ error: "Payment link is inactive, expired, sandbox-only, or at its usage limit." }, { status: 409 });
    }
    if (data?.outcome === "IN_PROGRESS") {
        return NextResponse.json({ error: "A payment for this link is already in progress." }, { status: 409 });
    }
    if (data?.outcome === "FINGERPRINT_MISMATCH") {
        return NextResponse.json({ error: "Checkout attempt belongs to a different payment." }, { status: 409 });
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
        settled: data.outcome === "SETTLED",
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
