import { after, NextResponse } from "next/server";
import crypto from "crypto";
import { sanitizeInput } from "@/utils/security";
import { isConnectionError, storeLocalOtpCode } from "@/lib/offlineDb";
import { sendAuthenticationCodeEmail } from "@/lib/email/transactional";
import { findAccountEmailBinding, isWalletOnlyEmailBinding } from "@/lib/auth/accountEmail";
import { withPgClient } from "@/lib/serverPg";
import { getSessionWallet } from "@/lib/auth";
import { requireAccountRole } from "@/lib/accounts/roles";

import { verifyCaptchaToken } from "@/lib/captcha";
import { checkProviderRateLimit } from "@/lib/providerRateLimit";

const OTP_TTL_MS = 10 * 60 * 1000;
const GENERIC_OTP_MESSAGE = "If this email can sign in, a verification code has been sent.";

function otpSecret() {
    const secret = process.env.OTP_SECRET || process.env.JWT_SECRET;
    if (!secret) throw new Error("OTP_SECRET or JWT_SECRET must be configured");
    return secret;
}

function hashOtp(email: string, code: string) {
    return crypto.createHmac("sha256", otpSecret()).update(`${email}:${code}`).digest("hex");
}

function allowOfflineAuth() {
    return process.env.NODE_ENV !== "production" && process.env.ENABLE_LOCAL_OFFLINE_AUTH === "true";
}

function allowDevOtpFallback() {
    return process.env.NODE_ENV !== "production";
}

export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object") {
            return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
        }

        const sanitizedBody = sanitizeInput(body);
        const { email, captchaToken, purpose, authFlow } = sanitizedBody;

        if (!email || typeof email !== "string" || !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email)) {
            return NextResponse.json({ error: "Invalid email address format" }, { status: 400 });
        }

        const emailLower = email.toLowerCase();
        const isEmailBindingRequest = purpose === "bind_wallet_email";
        const isSignInRequest = authFlow === "signin";
        let bindingWallet: string | null = null;
        if (isEmailBindingRequest) {
            const sessionWallet = await getSessionWallet(request.headers);
            if (!sessionWallet) {
                return NextResponse.json({ error: "Sign in with this wallet before verifying an email." }, { status: 401 });
            }
            const roleCheck = await requireAccountRole(sessionWallet, "USER");
            if (!roleCheck.ok) {
                return NextResponse.json({ error: roleCheck.error }, { status: roleCheck.status });
            }
            bindingWallet = sessionWallet.toLowerCase();
        }
        /* IP limit is charged up front (cheap DoS guard). The per-email limit is deliberately NOT
           charged here — it is charged just before the code is actually sent, so a request that
           later fails CAPTCHA or hits the wallet-only 409 doesn't burn the 3-per-window email quota
           without ever delivering a code. */
        const requesterIp = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
        const ipLimit = checkProviderRateLimit({ provider: "otp-send-ip", key: requesterIp, limit: 10, windowMs: 10 * 60 * 1000 });
        if (!ipLimit.ok) {
            return NextResponse.json(
                { error: "Too many verification-code requests. Please wait before trying again." },
                { status: 429, headers: { "Retry-After": String(ipLimit.retryAfterSeconds) } },
            );
        }

        let emailLoginAllowed = false;

        try {
            const emailBinding = await withPgClient((client) => findAccountEmailBinding(client, emailLower));
            emailLoginAllowed = Boolean(emailBinding) && !isWalletOnlyEmailBinding(emailBinding);
        } catch (err: any) {
            console.error("OTP send email binding query error:", err);
            if (!isConnectionError(err) || !allowOfflineAuth()) {
                return NextResponse.json({ error: "Authentication service is temporarily unavailable." }, { status: 503 });
            }
        }

        /* CAPTCHA runs before any account-dependent response for every anonymous LOGIN-code
           request. Otherwise an attacker can omit CAPTCHA and distinguish an existing email
           (code sent) from an unknown email (CAPTCHA error). */
        if (!isEmailBindingRequest) {
            const isValid = await verifyCaptchaToken(captchaToken, requesterIp);
            if (!isValid) {
                return NextResponse.json({ error: "Incorrect or expired CAPTCHA code. Please try again." }, { status: 400 });
            }
        }

        /* Charge the per-email quota only now that all validation/CAPTCHA/wallet-only gates have
           passed and we're about to actually issue a code. */
        const emailLimit = checkProviderRateLimit({ provider: "otp-send-email", key: emailLower, limit: 3, windowMs: 10 * 60 * 1000 });
        if (!emailLimit.ok) {
            return NextResponse.json(
                { error: "Too many verification-code requests. Please wait before trying again." },
                { status: 429, headers: { "Retry-After": String(emailLimit.retryAfterSeconds) } },
            );
        }

        const code = crypto.randomInt(100000, 1000000).toString();
        const codeHash = hashOtp(emailLower, code);
        const expiresAt = new Date(Date.now() + OTP_TTL_MS);
        let challengeId: string | null = null;
        const persistOtp = async () => {
            const res = await withPgClient(async (client) => {
                return await client.query(
                    `insert into otp_codes (email, code, expires_at, purpose, wallet_address)
                     values ($1, $2, $3, $4, $5)
                     on conflict (email)
                     do update set
                        code = excluded.code,
                        expires_at = excluded.expires_at,
                        purpose = excluded.purpose,
                        wallet_address = excluded.wallet_address,
                        challenge_id = gen_random_uuid(),
                        failed_attempts = 0,
                        created_at = now()
                     returning challenge_id`,
                    [
                        emailLower,
                        codeHash,
                        expiresAt,
                        isEmailBindingRequest ? "BIND_WALLET_EMAIL" : "LOGIN",
                        bindingWallet,
                    ]
                );
            });
            challengeId = res.rows[0]?.challenge_id || null;
            return challengeId;
        };

        try {
            await persistOtp();
        } catch (err: any) {
            console.error("OTP send database insert error:", err);
            if (isConnectionError(err)) {
                if (!allowOfflineAuth()) {
                    return NextResponse.json({ error: "Authentication service is temporarily unavailable." }, { status: 503 });
                }
                storeLocalOtpCode(emailLower, codeHash, expiresAt);
            } else {
                console.error("Failed to store OTP code in database:", err);
                return NextResponse.json({
                    error: "Failed to send OTP code. Please try again.",
                    details: process.env.NODE_ENV === "production" ? undefined : err.message,
                }, { status: 500 });
            }
        }

        const formattedChallengeId = challengeId ? `otp/${challengeId}` : null;

        /* Production anonymous OTP work continues after the uniform HTTP response. Known and
           unknown sign-in emails therefore have the same request latency; only the mailbox owner
           can observe whether a code was delivered. */
        if (process.env.NODE_ENV === "production" && !isEmailBindingRequest) {
            after(async () => {
                if (isSignInRequest && !emailLoginAllowed) return;
                try {
                    await sendAuthenticationCodeEmail(emailLower, code);
                } catch (error) {
                    console.error("Deferred OTP issue failed:", error instanceof Error ? error.message : error);
                }
            });
            return NextResponse.json({ success: true, message: GENERIC_OTP_MESSAGE, email: emailLower, challengeId: formattedChallengeId });
        }

        /* Non-production keeps the synchronous path so local sandboxes can expose devOtpCode. */
        if (isSignInRequest && !emailLoginAllowed) {
            return NextResponse.json({ success: true, message: GENERIC_OTP_MESSAGE, email: emailLower, challengeId: formattedChallengeId });
        }

        try {
            await sendAuthenticationCodeEmail(emailLower, code);
        } catch (mailErr) {
            console.error("Verification email send error:", mailErr instanceof Error ? mailErr.message : "Unknown error");
            if (allowDevOtpFallback()) {
                return NextResponse.json({
                    success: true,
                    message: GENERIC_OTP_MESSAGE,
                    email: emailLower,
                    challengeId: formattedChallengeId,
                    devOtpCode: code,
                });
            }
            return NextResponse.json({ error: "We could not send a verification email. Please try again." }, { status: 502 });
        }

        return NextResponse.json({
            success: true, 
            message: GENERIC_OTP_MESSAGE,
            email: emailLower,
            challengeId: formattedChallengeId,
            ...(allowDevOtpFallback() ? { devOtpCode: code } : {})
        });
    } catch (err: any) {
        console.error("OTP send error:", err);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
