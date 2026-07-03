import { NextResponse } from "next/server";

/*
 * This legacy receiver accepted unsigned payloads and only wrote them to logs. Keep it retired
 * until a concrete provider contract supplies signature verification and replay protection.
 */
export async function POST() {
    return NextResponse.json({
        error: "This webhook endpoint has been retired.",
        code: "UNVERIFIED_WEBHOOK_RECEIVER_RETIRED",
    }, { status: 410 });
}
