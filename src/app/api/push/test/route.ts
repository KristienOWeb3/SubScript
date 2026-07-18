import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { sendPushToWallet } from "@/lib/push";

export const runtime = "nodejs";

export async function POST(request: Request) {
    const wallet = await getSessionWallet(request.headers);
    if (!wallet) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await sendPushToWallet(wallet, {
        title: "SubScript notifications are on",
        body: "This device is ready for payment, subscription, and balance alerts.",
        url: "/user?tab=account",
        tag: "push-self-test",
    });

    if (!result.configured) {
        return NextResponse.json({ error: "Browser push is not configured on the server." }, { status: 503 });
    }
    if (!result.storageReady) {
        return NextResponse.json({ error: "Push subscription storage is unavailable." }, { status: 503 });
    }
    if (result.subscriptions === 0) {
        return NextResponse.json(
            { error: "Enable Browser Push on this device before sending a test." },
            { status: 409 }
        );
    }
    if (result.sent === 0) {
        return NextResponse.json(
            { error: "No notification could be delivered. Disable and re-enable Browser Push, then retry." },
            { status: 502 }
        );
    }

    return NextResponse.json(
        { success: true, message: `Test notification delivered to ${result.sent} device${result.sent === 1 ? "" : "s"}.` },
        { status: 200 }
    );
}
