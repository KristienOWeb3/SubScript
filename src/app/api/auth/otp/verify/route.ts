import { NextResponse } from "next/server";
import { provisionEmbeddedWallet } from "@/lib/custody/provision";
import { sanitizeInput } from "@/utils/security";
import { getAccountRole } from "@/lib/accounts/roles";
import { findAccountEmailBinding, isWalletOnlyEmailBinding } from "@/lib/auth/accountEmail";
import { withPgClient } from "@/lib/serverPg";
import crypto from "crypto";
import { 
    isConnectionError, 
    getOfflineOtpCode, 
    deleteOfflineOtpCode, 
    getOfflineUserEmbeddedWallet, 
    saveOfflineUserEmbeddedWallet
} from "@/lib/offlineDb";
import { setSessionCookie } from "@/lib/authCookies";
import { ensureDefaultAliasFromEmail } from "@/lib/auth/defaultAlias";
import { createSessionToken } from "@/lib/auth";

function hashOtp(email: string, code: string) {
    const secret = process.env.OTP_SECRET || process.env.JWT_SECRET;
    if (!secret) throw new Error("OTP_SECRET or JWT_SECRET must be configured");
    return crypto.createHmac("sha256", secret).update(`${email}:${code}`).digest("hex");
}

function safeHashMatch(expected: string, actual: string) {
    const expectedBuffer = Buffer.from(expected, "utf8");
    const actualBuffer = Buffer.from(actual, "utf8");
    return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

function allowOfflineAuth() {
    return process.env.NODE_ENV !== "production" && process.env.ALLOW_INSECURE_OFFLINE_AUTH === "true";
}

/* A 6-digit code with a 10-minute TTL is brute-forceable without a per-code guess budget
   (per-IP limits don't hold against IP rotation). Five wrong guesses invalidate the code;
   the legitimate user just requests a fresh one. */
const MAX_OTP_FAILED_ATTEMPTS = 5;

export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object") {
            return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
        }

        const sanitizedBody = sanitizeInput(body);
        const { email, code, rememberMe } = sanitizedBody;

        if (
            typeof email !== "string" ||
            !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email) ||
            typeof code !== "string" ||
            !/^\d{6}$/.test(code)
        ) {
            return NextResponse.json({ error: "Malformed payload parameters" }, { status: 400 });
        }

        const emailVal = email.toLowerCase();
        const codeTrimmed = code.trim();
        const rememberMeBool = Boolean(rememberMe);

        const emailLower = emailVal;
        const rememberMeVal = rememberMeBool;

        let isOfflineMode = false;
        let verified = false;

        try {
            verified = await withPgClient(async (client) => {
                await client.query("BEGIN");
                try {
                    /* Serialize verification for this code. The hash comparison, failed-attempt
                       charge, budget invalidation, and successful consume all happen while the row
                       lock is held, so parallel guesses cannot outrun the five-attempt budget. */
                    const result = await client.query(
                        "select code, expires_at, failed_attempts from otp_codes where email = $1 and purpose = 'LOGIN' limit 1 for update",
                        [emailVal]
                    );
                    const locked = result.rows[0] || null;
                    if (!locked) {
                        await client.query("COMMIT");
                        return false;
                    }

                    const expired = new Date() > new Date(locked.expires_at);
                    const spent = Number(locked.failed_attempts || 0) >= MAX_OTP_FAILED_ATTEMPTS;
                    if (expired || spent) {
                        await client.query(
                            "delete from otp_codes where email = $1 and purpose = 'LOGIN'",
                            [emailVal]
                        );
                        await client.query("COMMIT");
                        return false;
                    }

                    if (!safeHashMatch(locked.code, hashOtp(emailVal, codeTrimmed))) {
                        const nextAttempts = Number(locked.failed_attempts || 0) + 1;
                        if (nextAttempts >= MAX_OTP_FAILED_ATTEMPTS) {
                            await client.query(
                                "delete from otp_codes where email = $1 and purpose = 'LOGIN'",
                                [emailVal]
                            );
                        } else {
                            await client.query(
                                "update otp_codes set failed_attempts = $2 where email = $1 and purpose = 'LOGIN'",
                                [emailVal, nextAttempts]
                            );
                        }
                        await client.query("COMMIT");
                        return false;
                    }

                    await client.query(
                        "delete from otp_codes where email = $1 and purpose = 'LOGIN'",
                        [emailVal]
                    );
                    await client.query("COMMIT");
                    return true;
                } catch (error) {
                    await client.query("ROLLBACK").catch(() => undefined);
                    throw error;
                }
            });
        } catch (err: any) {
            console.error("OTP verify query error:", err);
            if (isConnectionError(err)) {
                if (!allowOfflineAuth()) {
                    return NextResponse.json({ error: "Authentication service is temporarily unavailable." }, { status: 503 });
                }
                isOfflineMode = true;
            } else {
                return NextResponse.json({ error: "Failed to verify code. Please try again." }, { status: 500 });
            }
        }

        if (isOfflineMode) {
            console.warn("⚠️ Supabase is offline. Verifying OTP via offlineDb.");
            const record = getOfflineOtpCode(emailVal);
            if (record) {
                verified = new Date() <= new Date(record.expires_at)
                    && safeHashMatch(record.code, hashOtp(emailVal, codeTrimmed));
                deleteOfflineOtpCode(emailVal);
            }
        }

        if (!verified) {
            return NextResponse.json({ error: "Invalid or expired verification code." }, { status: 400 });
        }

        let walletAddress = "";
        let walletRecord = null;

        if (isOfflineMode) {
            return NextResponse.json({ error: "Authentication service is temporarily unavailable." }, { status: 503 });
        }

        try {
            const emailBinding = await withPgClient((client) => findAccountEmailBinding(client, emailVal));
            if (isWalletOnlyEmailBinding(emailBinding)) {
                return NextResponse.json({
                    error: "This email is linked to a wallet-only SubScript account. Connect that wallet to sign in."
                }, { status: 409 });
            }
            if (emailBinding) {
                walletRecord = { wallet_address: emailBinding.walletAddress };
            }
        } catch (err: any) {
            return NextResponse.json({ error: err.message || "Failed to check wallet." }, { status: 500 });
        }

        if (walletRecord) {
            walletAddress = walletRecord.wallet_address;
        } else {
            const refId = crypto.createHash("sha256").update(emailVal).digest("hex");
            const provisioned = await provisionEmbeddedWallet({ refId });
            walletAddress = provisioned.address;

            try {
                await withPgClient(async (client) => {
                    await client.query(
                        `insert into user_embedded_wallets (email, wallet_address, circle_wallet_id, provider, updated_at)
                         values ($1, $2, $3, 'email_otp', now())
                         on conflict (email) do update set
                            wallet_address = excluded.wallet_address,
                            circle_wallet_id = excluded.circle_wallet_id,
                            provider = excluded.provider,
                            updated_at = now()`,
                        [emailVal, walletAddress.toLowerCase(), provisioned.circleWalletId]
                    );
                });
            } catch (err: any) {
                console.error("Failed to store generated OTP embedded wallet:", err);
                return NextResponse.json({ error: "Failed to generate embedded wallet." }, { status: 500 });
            }
        }

        const sessionDuration = rememberMeVal ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
        const { token: jwt, expiresAt } = await createSessionToken(walletAddress, sessionDuration);

        /* Default the user's .sub username to their email name on first sign-up (changeable later). */
        if (!isOfflineMode) {
            await ensureDefaultAliasFromEmail(walletAddress, emailVal);
        }

        const role = await getAccountRole(walletAddress);

        const response = NextResponse.json({
            success: true,
            wallet: walletAddress,
            email: emailVal,
            role
        });

        setSessionCookie(response, request, jwt, expiresAt);

        return response;
    } catch (err: any) {
        console.error("Verification error:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}
