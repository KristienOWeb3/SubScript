import { NextResponse } from "next/server";
import { verifyEmailWebhook } from "@/lib/email/webhook";
import { recordDeliveryEvent } from "@/lib/email/outbox";

export const runtime = "nodejs";
export async function POST(request: Request) {
    const secret = process.env.RESEND_WEBHOOK_SECRET;
    if (!secret) return NextResponse.json({ error: "Webhook unavailable" }, { status: 503 });
    if (Number(request.headers.get("content-length")) > 256_000) return new Response(null, { status: 413 });
    const payload = await request.text();
    if (payload.length > 256_000) return new Response(null, { status: 413 });
    let event;
    try { event = verifyEmailWebhook(payload, request.headers, secret); }
    catch { return NextResponse.json({ error: "Invalid webhook" }, { status: 400 }); }
    try {
        await recordDeliveryEvent(request.headers.get("svix-id")!, event);
        return NextResponse.json({ ok: true });
    } catch {
        return NextResponse.json({ error: "Delivery event persistence failed" }, { status: 503 });
    }
}
