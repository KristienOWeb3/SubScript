import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { sanitizeInput } from "@/utils/security";

import { isConnectionError, saveOfflineOtpCode } from "@/lib/offlineDb";

import { verifyCaptchaToken } from "@/lib/captcha";

const resend = new Resend(process.env.RESEND_API_KEY || "re_build_placeholder");

export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object") {
            return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
        }

        const sanitizedBody = sanitizeInput(body);
        const { email, captchaCode, captchaToken, isSignup } = sanitizedBody;

        if (!email || typeof email !== "string" || !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email)) {
            return NextResponse.json({ error: "Invalid email address format" }, { status: 400 });
        }

        if (isSignup) {
            if (!verifyCaptchaToken(captchaToken, captchaCode)) {
                return NextResponse.json({ error: "Incorrect or expired CAPTCHA code. Please try again." }, { status: 400 });
            }
        }

        const emailLower = email.toLowerCase();

        const code = String(Math.floor(100000 + Math.random() * 900000));
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

        const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
        if (!supabaseUrl || !supabaseServiceKey) {
            // Fallback immediately if config is missing
            console.warn("⚠️ Supabase config missing. Storing OTP code in offlineDb.");
            saveOfflineOtpCode(emailLower, code, expiresAt);
        } else {
            try {
                const supabase = createClient(supabaseUrl, supabaseServiceKey);
                const { error } = await supabase
                    .from("otp_codes")
                    .upsert({
                        email: emailLower,
                        code,
                        expires_at: expiresAt.toISOString()
                    }, { onConflict: "email" });

                if (error) {
                    if (isConnectionError(error)) {
                        console.warn("⚠️ Supabase is offline (API error). Storing OTP code in offlineDb.");
                        saveOfflineOtpCode(emailLower, code, expiresAt);
                    } else {
                        console.error("Failed to store OTP code in Supabase:", error);
                        return NextResponse.json({ error: "Failed to send OTP code. Please try again." }, { status: 500 });
                    }
                }
            } catch (err: any) {
                if (isConnectionError(err)) {
                    console.warn("⚠️ Supabase is offline (Exception). Storing OTP code in offlineDb.");
                    saveOfflineOtpCode(emailLower, code, expiresAt);
                } else {
                    console.error("Failed to store OTP code (catch):", err);
                    return NextResponse.json({ error: "Failed to send OTP code. Please try again." }, { status: 500 });
                }
            }
        }


        try {
            await resend.emails.send({
                from: "SubScript Auth <onboarding@resend.dev>",
                to: emailLower,
                subject: "Your SubScript Verification Code",
                html: `<html><body><p>Your SubScript verification code is <strong>${code}</strong>. It will expire in 10 minutes.</p></body></html>`
            });
        } catch (mailErr) {
            console.error("Resend email send error:", mailErr);
        }

        return NextResponse.json({ 
            success: true, 
            message: "OTP code successfully generated.",
            sandboxCode: code,
            email: emailLower
        });
    } catch (err: any) {
        console.error("OTP send error:", err);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
