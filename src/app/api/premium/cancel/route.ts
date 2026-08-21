import { after, NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { createClient } from "@supabase/supabase-js";
import { ethers } from "ethers";
import { triggerExitSurvey } from "@/lib/payments/email";
import { sendPremiumCancellationEmail } from "@/lib/email/templates/subscriptionLifecycle";

export async function POST(request: Request) {
    try {
        /* 1. Authenticate the merchant session */
        const walletAddress = await getSessionWallet(request.headers);
        if (!walletAddress) {
            return NextResponse.json({ error: "Unauthorized: Connect your wallet first." }, { status: 401 });
        }

        const normalizedUser = walletAddress.toLowerCase();

        /* 2. Connect to Supabase */
        const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
        if (!supabaseUrl || !supabaseServiceKey) {
            return NextResponse.json({ error: "Configuration Error: Supabase keys missing on server" }, { status: 500 });
        }
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        const nowIso = new Date().toISOString();

        /* 3. Update merchant tier to FREE and set cancellation flag */
        const { error: merchantUpdateError } = await supabase
            .from("merchants")
            .update({
                tier: "FREE",
                cancel_at_period_end: true,
                updated_at: nowIso
            })
            .eq("wallet_address", normalizedUser);

        if (merchantUpdateError) {
            console.warn("Merchant table tier update warning:", merchantUpdateError);
        }

        /* 4. Update associated premium subscription rows if present */
        const { data: subData } = await supabase
            .from("subscriptions")
            .select("subscription_id, next_billing_date, amount_cap_usdc, billing_interval_seconds")
            .eq("kind", "PREMIUM")
            .eq("merchant_address", normalizedUser)
            .in("status", ["ACTIVE", "PAST_DUE"])
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        if (subData?.subscription_id) {
            await supabase
                .from("subscriptions")
                .update({
                    cancel_at_period_end: true,
                    cancel_requested_at: nowIso,
                    updated_at: nowIso
                })
                .eq("subscription_id", Number(subData.subscription_id));
        }

        const adminPrivateKey = process.env.PRIVATE_KEY || "";
        const adminAddress = adminPrivateKey 
            ? new ethers.Wallet(adminPrivateKey).address.toLowerCase()
            : "";

        if (adminAddress) {
            triggerExitSurvey(adminAddress, normalizedUser, 1).catch(err => {
                console.error("Failed to trigger exit survey:", err);
            });
        }

        /* The merchant's own receipt for cancelling Premium Pro.
         *
         * Section 3.5 of docs/email-audit.md: a cancellation is the one confirmation people keep
         * as proof, and until now this route confirmed nothing outside the dashboard toast. Sent
         * after the response, and never allowed to fail the request, because the tier change and
         * the cancel flags above are already committed. The email states only what this route
         * actually did: billing stopped and the row flagged for the downgrade pass. It doesn't
         * claim the on-chain authorization is revoked yet, because the billing cron does that
         * when the period ends. */
        const paidThrough = subData?.next_billing_date ? new Date(subData.next_billing_date) : null;
        const paidThroughValid = paidThrough && !Number.isNaN(paidThrough.getTime()) ? paidThrough : null;
        after(async () => {
            await sendPremiumCancellationEmail({
                subscriberAddress: normalizedUser,
                facts: {
                    subscriptionId: subData?.subscription_id ? String(subData.subscription_id) : null,
                    planName: "Premium Pro",
                    amountUsdcMicros: subData?.amount_cap_usdc ?? null,
                    periodSeconds: subData?.billing_interval_seconds ?? null,
                    accessUntil: paidThroughValid,
                    requestedAt: new Date(nowIso),
                },
                /* /api/premium/resume accepts a change of mind only while the paid period is
                   still running, so the email mentions that option only when it really exists. */
                resumableUntilPaidThrough: Boolean(paidThroughValid && paidThroughValid.getTime() > Date.now()),
            });
        });

        return NextResponse.json({
            success: true,
            message: "Premium Pro has been cancelled successfully.",
            cancelAtPeriodEnd: true,
            nextBillingDate: subData?.next_billing_date || null
        }, { status: 200 });

    } catch (error: any) {
        console.error("Cancel premium subscription error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
