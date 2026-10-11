import { after, NextResponse } from "next/server";
import crypto from "crypto";
import { authorizationDigest } from "@/lib/auth/transactionPinCrypto";
import { sanitizeInput } from "@/utils/security";
import { isConnectionError, storeLocalOtpCode } from "@/lib/offlineDb";
import { sendAuthenticationCodeEmail } from "@/lib/email/transactional";
import { findAccountEmailBinding, isWalletOnlyEmailBinding } from "@/lib/auth/accountEmail";
import { withPgClient } from "@/lib/serverPg";
import { getSessionWallet, getVerifiedSessionToken } from "@/lib/auth";
import { requireAccountRole } from "@/lib/accounts/roles";
import { normalizeFinancialStepUpBinding, financialStepUpBindingDigest } from "@/lib/auth/stepUp";

import { verifyCaptchaToken } from "@/lib/captcha";
import { consumeDistributedRateLimit } from "@/lib/distributedRateLimit";
import { localAuthenticationConfigurationError } from "@/lib/auth/localConfiguration";

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

export async function POST(request: Request) {
    const configurationError = localAuthenticationConfigurationError();
    if (configurationError) return configurationError;
    try {
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object") {
            return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
        }

        const sanitizedBody = sanitizeInput(body);
        const { email, captchaToken, purpose, authFlow, stepUp } = sanitizedBody;

        if (!email || typeof email !== "string" || !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email)) {
            return NextResponse.json({ error: "Invalid email address format" }, { status: 400 });
        }

        const emailLower = email.toLowerCase();
        const isEmailBindingRequest = purpose === "bind_wallet_email";
        const isFinancialStepUpRequest = purpose === "financial_step_up";
        const isSignInRequest = authFlow === "signin";
        let bindingWallet: string | null = null;
        let bindingSessionDigest: string | null = null;
        if (isFinancialStepUpRequest && !normalizeFinancialStepUpBinding(stepUp)) {
            return NextResponse.json({ error: "A valid financial authorization binding is required." }, { status: 400 });
        }
        if (isEmailBindingRequest || isFinancialStepUpRequest) {
            const sessionWallet = await getSessionWallet(request.headers);
            if (!sessionWallet) {
                return NextResponse.json({ error: "Sign in before requesting this verification code." }, { status: 401 });
            }
            if (isEmailBindingRequest) {
                const roleCheck = await requireAccountRole(sessionWallet, "USER");
                if (!roleCheck.ok) {
                    return NextResponse.json({ error: roleCheck.error }, { status: roleCheck.status });
                }
            }
            bindingWallet = sessionWallet.toLowerCase();
            if (isFinancialStepUpRequest) {
                const session = await getVerifiedSessionToken(request.headers);
                if (!session) return NextResponse.json({error:"Unauthorized"},{status:401});
                bindingSessionDigest = authorizationDigest(session.token);
            }
        }
        /* IP limit is charged up front (cheap DoS guard). The per-email limit is deliberately NOT
           charged here — it is charged just before the code is actually sent, so a request that
           later fails CAPTCHA or hits the wallet-only 409 doesn't burn the 3-per-window email quota
           without ever delivering a code. */
        const requesterIp = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
        let ipLimit;
        try {
            ipLimit = await consumeDistributedRateLimit({
                scope: "otp-send-ip",
                key: requesterIp,
                limit: 10,
                windowSeconds: 10 * 60,
            });
        } catch (error) {
            console.error("OTP send IP rate-limit error:", error);
            return NextResponse.json({ error: "Authentication service is temporarily unavailable." }, { status: 503 });
        }
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
            if (
                isFinancialStepUpRequest
                && (!emailBinding || emailBinding.walletAddress.toLowerCase() !== bindingWallet)
            ) {
                return NextResponse.json({ error: "Use the verified email linked to this account." }, { status: 403 });
            }
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
            if (!isFinancialStepUpRequest) {
                const isValid = await verifyCaptchaToken(captchaToken, requesterIp);
                if (!isValid) {
                    return NextResponse.json({ error: "Incorrect or expired CAPTCHA code. Please try again." }, { status: 400 });
                }
            }
        }

        /* Charge the per-email quota only now that all validation/CAPTCHA/wallet-only gates have
           passed and we're about to actually issue a code. */
        const isPinCodeRequest = isFinancialStepUpRequest
            && ["transaction-pin:enroll", "transaction-pin:change", "transaction-pin:reset"].includes(stepUp?.action);
        if (isPinCodeRequest) {
            try {
                const cooldown = await consumeDistributedRateLimit({
                    scope: "transaction-pin-code-cooldown",
                    key: bindingWallet!,
                    limit: 1,
                    windowSeconds: 60,
                    mode: "cooldown",
                });
                if (!cooldown.ok) return NextResponse.json(
                    { error: "Please wait before requesting a fresh code.", retryAfterSeconds: cooldown.retryAfterSeconds },
                    { status: 429, headers: { "Retry-After": String(cooldown.retryAfterSeconds) } },
                );
            } catch {
                return NextResponse.json({ error: "Authentication service is temporarily unavailable." }, { status: 503 });
            }
        }
        let emailLimit;
        try {
            emailLimit = await consumeDistributedRateLimit({
                scope: "otp-send-email",
                key: emailLower,
                limit: 3,
                windowSeconds: 10 * 60,
            });
        } catch (error) {
            console.error("OTP send email rate-limit error:", error);
            return NextResponse.json({ error: "Authentication service is temporarily unavailable." }, { status: 503 });
        }
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
                return client.query(
                    `insert into otp_codes (email, code, expires_at, purpose, wallet_address, binding_digest, session_digest)
                     values($1,$2,$3,$4,$5,$6,$7) on conflict(email) do update set
                     code=excluded.code, expires_at=excluded.expires_at, purpose=excluded.purpose,
                     wallet_address=excluded.wallet_address,binding_digest=excluded.binding_digest,
                     session_digest=excluded.session_digest,challenge_id=gen_random_uuid(),failed_attempts = 0,created_at=now()
                     returning challenge_id`,
                    [emailLower,codeHash,expiresAt,isEmailBindingRequest ? "BIND_WALLET_EMAIL" : "LOGIN",bindingWallet,
                     isFinancialStepUpRequest ? financialStepUpBindingDigest(stepUp) : null,bindingSessionDigest]);
            });
            challengeId = res.rows[0]?.challenge_id || null;
            return challengeId;
        };

        try {
            await persistOtp();
        } catch (err: any) {
            console.error("OTP send database insert error:", err);
            if (isConnectionError(err)) {
                if (isFinancialStepUpRequest || !allowOfflineAuth()) {
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
        if (process.env.NODE_ENV === "production" && !isEmailBindingRequest && !isFinancialStepUpRequest) {
            after(async () => {
                const deadline = Date.now() + 15_000;
                for (let attempt = 0; attempt < 6; attempt++) {
                    try {
                        await sendAuthenticationCodeEmail(emailLower, code);
                        return;
                    } catch (error) {
                        const failure = error as { code?: string; retryAfterSeconds?: number };
                        // These rejections did not accept the message. Reuse the same code
                        // and provider idempotency key; never retry ambiguous provider errors.
                        const throttled = failure?.code === "EMAIL_PROVIDER_THROTTLED" || failure?.code === "PROVIDER_HTTP_429";
                        const delay = Math.max(1, Number(failure?.retryAfterSeconds) || 1) * 1000;
                        if (!throttled || attempt === 5 || !Number.isFinite(delay) || Date.now() + delay >= deadline) {
                            console.error("Deferred OTP issue failed:", "EMAIL_DELIVERY_FAILED");
                            return;
                        }
                        await new Promise(resolve => setTimeout(resolve, delay));
                    }
                }
            });
            return NextResponse.json({ success: true, message: GENERIC_OTP_MESSAGE, email: emailLower, challengeId: formattedChallengeId });
        }

        try {
            await sendAuthenticationCodeEmail(emailLower, code);
        } catch (mailErr) {
            const errorCode = mailErr && typeof mailErr === "object" && "code" in mailErr ? String(mailErr.code) : "EMAIL_SEND_FAILED";
            console.error("Verification email send error:", errorCode);
            const retryAfter = mailErr && typeof mailErr === "object" && "retryAfterSeconds" in mailErr ? Number(mailErr.retryAfterSeconds) : 0;
            const throttled = errorCode === "EMAIL_PROVIDER_THROTTLED" || errorCode === "EMAIL_RECIPIENT_THROTTLED" || errorCode === "PROVIDER_HTTP_429";
            return NextResponse.json({
                error: throttled ? "The email service is busy. Please wait before requesting another code." : "We could not send a verification email. Please try again.",
                code: "EMAIL_DELIVERY_FAILED",
            }, { status: throttled ? 429 : 502, headers: Number.isFinite(retryAfter) && retryAfter > 0 ? { "Retry-After": String(Math.ceil(retryAfter)) } : {} });
        }

        return NextResponse.json({
            success: true, 
            message: GENERIC_OTP_MESSAGE,
            email: emailLower,
            challengeId: formattedChallengeId,
            ...(isPinCodeRequest ? { retryAfterSeconds: 60 } : {}),
        });
    } catch (err: any) {
        console.error("OTP send error:", err);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
