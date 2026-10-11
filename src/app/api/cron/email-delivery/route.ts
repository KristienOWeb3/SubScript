import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { processEmailOutbox } from "@/lib/email/outbox";
import { scanDepositEmails, enqueuePinSecurityEvents, enqueueBridgeRecoveryEmails } from "@/lib/email/recovery";
import { processSettlementReceiptJobs } from "@/lib/payments/settlementReceiptRecovery";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request) {
    const presented = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] || "";
    const digest = (value: string) => crypto.createHash("sha256").update(value).digest();
    if (!presented || ![process.env.CRON_SECRET, process.env.KEEPER_SECRET].some(value =>
        value && crypto.timingSafeEqual(digest(value), digest(presented)))) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    try {
        // Bound recovery work so provider retries are not starved by explorer scans.
        const pins = await enqueuePinSecurityEvents(10);
        const bridges = await enqueueBridgeRecoveryEmails(10);
        const settlements = await processSettlementReceiptJobs(5);
        const delivery = await processEmailOutbox(20);
        const deposits = await scanDepositEmails(2);
        return NextResponse.json({ delivery, deposits, pins, bridges, settlements });
    } catch {
        console.error("Email worker failed", "EMAIL_WORKER_UNAVAILABLE");
        return NextResponse.json({ error: "Email worker unavailable" }, { status: 503 });
    }
}
