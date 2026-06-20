/* API route for loading and updating merchant email automations settings */

import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(request: Request) {
    try {
        const walletAddress = await getSessionWallet(request.headers);
        if (!walletAddress) {
            return NextResponse.json({ error: "Unauthorized: Connect your wallet first." }, { status: 401 });
        }

        const normalizedUser = walletAddress.toLowerCase();

        if (!supabaseAdmin) {
            return NextResponse.json({ error: "Configuration Error: Database not available." }, { status: 500 });
        }

        const { data: template, error } = await supabaseAdmin
            .from("merchant_email_templates")
            .select("*")
            .eq("merchant_address", normalizedUser)
            .maybeSingle();

        if (error) {
            console.error("Database query failed:", error);
            return NextResponse.json({ error: "Database error" }, { status: 500 });
        }

        // Fetch exit survey responses (CHURN_SURVEY system-DMs that have been answered)
        const { data: responses, error: responsesError } = await supabaseAdmin
            .from("subscript_dms")
            .select("id, receiver_address, status, updated_at")
            .eq("sender_address", normalizedUser)
            .eq("message_type", "CHURN_SURVEY")
            .neq("status", "PENDING")
            .order("updated_at", { ascending: false });

        if (responsesError) {
            console.error("Failed to query survey responses:", responsesError);
        }

        const templatePayload = template || {
            merchant_address: normalizedUser,
            is_active: false,
            subject_line: "Subscription Cancellation Survey",
            body_content: "Hello,\n\nWe noticed you cancelled your subscription (Tier: {{subscription_tier}}).\n\nPlease let us know if there is anything we could have done better.\n\nWallet: {{customer_wallet}}\n\nBest regards,\nMerchant Team"
        };

        return NextResponse.json({
            ...templatePayload,
            responses: responses || []
        }, { status: 200 });

    } catch (err: any) {
        console.error("Failed to load automation template:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const walletAddress = await getSessionWallet(request.headers);
        if (!walletAddress) {
            return NextResponse.json({ error: "Unauthorized: Connect your wallet first." }, { status: 401 });
        }

        const normalizedUser = walletAddress.toLowerCase();

        if (!supabaseAdmin) {
            return NextResponse.json({ error: "Configuration Error: Database not available." }, { status: 500 });
        }

        /* Verify merchant tier is PREMIUM */
        const { data: merchant, error: merchantError } = await supabaseAdmin
            .from("merchants")
            .select("tier")
            .eq("wallet_address", normalizedUser)
            .maybeSingle();

        if (merchantError || !merchant || merchant.tier !== "PREMIUM") {
            return NextResponse.json({ error: "Forbidden: Privacy Premium tier required for Automated Churn Recovery" }, { status: 403 });
        }

        const body = await request.json();
        const { isActive, subjectLine, bodyContent } = body;

        if (subjectLine === undefined || bodyContent === undefined || isActive === undefined) {
            return NextResponse.json({ error: "Missing required fields: isActive, subjectLine, or bodyContent" }, { status: 400 });
        }

        const { data: template, error } = await supabaseAdmin
            .from("merchant_email_templates")
            .upsert({
                merchant_address: normalizedUser,
                is_active: isActive,
                subject_line: subjectLine,
                body_content: bodyContent
            }, { onConflict: "merchant_address" })
            .select("*")
            .single();

        if (error) {
            console.error("Database upsert failed:", error);
            return NextResponse.json({ error: "Database save failure" }, { status: 500 });
        }

        return NextResponse.json(template, { status: 200 });

    } catch (err: any) {
        console.error("Failed to update automation template:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}
