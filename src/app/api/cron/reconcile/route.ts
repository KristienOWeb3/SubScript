import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { processPremiumUpgrade } from "@/lib/premium";

export async function POST(request: Request) {
    try {
        const authHeader = request.headers.get("Authorization");
        const expectedSecret = process.env.KEEPER_SECRET;
        if (!expectedSecret) {
            return NextResponse.json({ error: "Internal Server Error: Keeper secret key configuration missing" }, { status: 500 });
        }

        if (!authHeader || authHeader !== `Bearer ${expectedSecret}`) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
        if (!supabaseUrl || !supabaseServiceKey) {
            return NextResponse.json({ error: "Configuration Error: Supabase keys missing on server" }, { status: 500 });
        }
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        /* Query subscriptions where status IN ('PENDING', 'FAILED') AND payment_tx_hash IS NOT NULL AND expires_at > NOW() */
        const nowStr = new Date().toISOString();
        const { data: pendingSubs, error: fetchError } = await supabase
            .from("subscriptions")
            .select("*")
            .in("status", ["PENDING", "FAILED"])
            .not("payment_tx_hash", "is", null)
            .gt("expires_at", nowStr);

        if (fetchError) {
            console.error("[Premium Reconcile] Failed to fetch pending subscriptions:", fetchError);
            return NextResponse.json({ error: "Database Error: Failed to fetch subscriptions for reconciliation" }, { status: 500 });
        }

        const results = [];

        if (pendingSubs && pendingSubs.length > 0) {
            for (const sub of pendingSubs) {
                const res = await processPremiumUpgrade(supabase, sub.merchant_address, sub.payment_tx_hash);
                results.push({
                    subscriptionId: sub.subscription_id,
                    merchantAddress: sub.merchant_address,
                    txHash: sub.payment_tx_hash,
                    success: res.success,
                    status: res.status,
                    error: res.error || null,
                    upgradeTxHash: res.upgradeTxHash || null
                });
            }
        }

        return NextResponse.json({
            success: true,
            processedCount: results.length,
            results
        }, { status: 200 });

    } catch (error: any) {
        console.error("Premium reconciliation error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
