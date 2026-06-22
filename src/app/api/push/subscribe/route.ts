import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/* Register a browser Web Push subscription for the authenticated wallet. */
export async function POST(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        if (!supabaseAdmin) {
            return NextResponse.json({ error: "Database not available" }, { status: 500 });
        }

        const body = await request.json().catch(() => null);
        const sub = body?.subscription;
        if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
            return NextResponse.json({ error: "Invalid push subscription payload" }, { status: 400 });
        }

        const walletLower = wallet.toLowerCase();

        /* One row per endpoint. Replace any prior binding so a shared device re-points to the
           wallet that is currently signed in. (Avoids partial-unique-index upsert edge cases.) */
        await supabaseAdmin.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);

        const { error } = await supabaseAdmin.from("push_subscriptions").insert({
            wallet_address: walletLower,
            platform: "web",
            endpoint: sub.endpoint,
            p256dh: sub.keys.p256dh,
            auth: sub.keys.auth,
            user_agent: request.headers.get("user-agent") || null,
        });

        if (error) {
            console.error("[push/subscribe] insert failed:", error.message);
            return NextResponse.json({ error: "Failed to save subscription" }, { status: 500 });
        }

        return NextResponse.json({ success: true }, { status: 201 });
    } catch (err: any) {
        console.error("[push/subscribe] error:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}

/* Remove a browser Web Push subscription (on disable / sign-out). */
export async function DELETE(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        if (!supabaseAdmin) {
            return NextResponse.json({ error: "Database not available" }, { status: 500 });
        }

        const body = await request.json().catch(() => null);
        const endpoint = body?.endpoint;
        if (!endpoint || typeof endpoint !== "string") {
            return NextResponse.json({ error: "Missing endpoint" }, { status: 400 });
        }

        await supabaseAdmin
            .from("push_subscriptions")
            .delete()
            .eq("endpoint", endpoint)
            .eq("wallet_address", wallet.toLowerCase());

        return NextResponse.json({ success: true }, { status: 200 });
    } catch (err: any) {
        console.error("[push/subscribe] delete error:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}
