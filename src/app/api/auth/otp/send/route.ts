import { NextResponse } from "next/server";
import crypto from "crypto";
import { sanitizeInput } from "@/utils/security";
import { isConnectionError, saveOfflineOtpCode } from "@/lib/offlineDb";
import { sendAuthenticationCodeEmail } from "@/lib/email/transactional";
import { prisma } from "@/lib/prisma";
import { findAccountEmailBinding, isWalletOnlyEmailBinding } from "@/lib/auth/accountEmail";
import { withPgClient } from "@/lib/serverPg";

import { verifyCaptchaToken } from "@/lib/captcha";

const OTP_TTL_MS = 10 * 60 * 1000;

function otpSecret() {
    const secret = process.env.OTP_SECRET || process.env.JWT_SECRET;
    if (!secret) throw new Error("OTP_SECRET or JWT_SECRET must be configured");
    return secret;
}

function hashOtp(email: string, code: string) {
    return crypto.createHmac("sha256", otpSecret()).update(`${email}:${code}`).digest("hex");
}

function allowOfflineAuth() {
    return process.env.NODE_ENV !== "production" && process.env.ALLOW_INSECURE_OFFLINE_AUTH === "true";
}

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
            const isValid = await verifyCaptchaToken(captchaToken);
            if (!isValid) {
                return NextResponse.json({ error: "Incorrect or expired CAPTCHA code. Please try again." }, { status: 400 });
            }
        }

        const emailLower = email.toLowerCase();

        try {
            const emailBinding = await withPgClient((client) => findAccountEmailBinding(client, emailLower));
            if (isWalletOnlyEmailBinding(emailBinding)) {
                return NextResponse.json({
                    error: "This email is linked to a wallet-only SubScript account. Connect that wallet to sign in."
                }, { status: 409 });
            }
        } catch (err: any) {
            if (!isConnectionError(err) || !allowOfflineAuth()) {
                return NextResponse.json({ error: "Authentication service is temporarily unavailable." }, { status: 503 });
            }
        }

        const code = crypto.randomInt(100000, 1000000).toString();
        const codeHash = hashOtp(emailLower, code);
        const expiresAt = new Date(Date.now() + OTP_TTL_MS);

        try {
            await prisma.$executeRaw`
                INSERT INTO otp_codes (email, code, expires_at)
                VALUES (${emailLower}, ${codeHash}, ${expiresAt})
                ON CONFLICT (email)
                DO UPDATE SET code = EXCLUDED.code, expires_at = EXCLUDED.expires_at, created_at = NOW()
            `;
        } catch (err: any) {
            if (isConnectionError(err)) {
                if (!allowOfflineAuth()) {
                    return NextResponse.json({ error: "Authentication service is temporarily unavailable." }, { status: 503 });
                }
                saveOfflineOtpCode(emailLower, codeHash, expiresAt);
            } else {
                console.error("Failed to store OTP code in database via Prisma:", err);
                return NextResponse.json({ error: "Failed to send OTP code. Please try again." }, { status: 500 });
            }
        }


        try {
            await sendAuthenticationCodeEmail(emailLower, code);
        } catch (mailErr) {
            console.error("Verification email send error:", mailErr instanceof Error ? mailErr.message : "Unknown error");
            return NextResponse.json({ error: "We could not send a verification email. Please try again." }, { status: 502 });
        }

        return NextResponse.json({ 
            success: true, 
            message: "OTP code successfully generated.",
            email: emailLower
        });
    } catch (err: any) {
        console.error("OTP send error:", err);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
