import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => null);
        if (!body || !body.email) {
            return NextResponse.json({ error: "Email is required" }, { status: 400 });
        }

        const email = body.email.toLowerCase();

        // 1. Generate 6-digit code
        const code = String(Math.floor(100000 + Math.random() * 900000));
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes expiry

        // 2. Initialize Supabase client
        const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
        if (!supabaseUrl || !supabaseServiceKey) {
            return NextResponse.json({ error: "Server Configuration Error: Supabase client not initialized." }, { status: 500 });
        }
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        // 3. Save to otp_codes table
        const { error } = await supabase
            .from("otp_codes")
            .upsert({
                email,
                code,
                expires_at: expiresAt.toISOString()
            }, { onConflict: "email" });

        if (error) {
            console.error("Failed to store OTP code:", error);
            return NextResponse.json({ error: "Failed to send OTP code. Please try again." }, { status: 500 });
        }

        console.log(`\n🔑 [OTP Verification Code] Email: ${email} | Code: ${code} (Expires in 10m)\n`);

        return NextResponse.json({ 
            success: true, 
            message: "OTP code successfully generated.",
            sandboxCode: code
        });
    } catch (err: any) {
        console.error("OTP send error:", err);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
