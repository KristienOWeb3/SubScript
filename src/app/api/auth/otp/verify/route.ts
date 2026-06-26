import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { SignJWT } from "jose";
import { encryptPrivateKey } from "@/lib/crypto";
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

        let record = null;
        let isOfflineMode = false;

        try {
            record = await withPgClient(async (client) => {
                const result = await client.query(
                    "select code, expires_at from otp_codes where email = $1 limit 1",
                    [emailVal]
                );
                return result.rows[0] || null;
            });
        } catch (err: any) {
            console.error("OTP verify query error:", err);
            if (isConnectionError(err)) {
                if (!allowOfflineAuth()) {
                    return NextResponse.json({ error: "Authentication service is temporarily unavailable." }, { status: 503 });
                }
                isOfflineMode = true;
            } else {
                return NextResponse.json({ error: err.message || "Failed to query verification code." }, { status: 500 });
            }
        }

        if (isOfflineMode) {
            console.warn("⚠️ Supabase is offline. Verifying OTP via offlineDb.");
            record = getOfflineOtpCode(emailVal);
        }

        if (!record) {
            return NextResponse.json({ error: "Verification code expired or not found. Please request a new one." }, { status: 400 });
        }

        if (!safeHashMatch(record.code, hashOtp(emailVal, codeTrimmed))) {
            return NextResponse.json({ error: "Invalid verification code. Please check and try again." }, { status: 400 });
        }

        if (new Date() > new Date(record.expires_at)) {
            if (isOfflineMode) {
                deleteOfflineOtpCode(emailVal);
            } else {
                try {
                    await withPgClient(async (client) => {
                        await client.query("delete from otp_codes where email = $1", [emailVal]);
                    });
                } catch (e) {}
            }
            return NextResponse.json({ error: "Verification code has expired. Please request a new one." }, { status: 400 });
        }

        if (isOfflineMode) {
            deleteOfflineOtpCode(emailVal);
        } else {
            try {
                await withPgClient(async (client) => {
                    await client.query("delete from otp_codes where email = $1", [emailVal]);
                });
            } catch (e) {}
        }

        let walletAddress = "";
        let walletRecord = null;

        if (!isOfflineMode) {
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
                if (isConnectionError(err)) {
                    isOfflineMode = true;
                } else {
                    return NextResponse.json({ error: err.message || "Failed to check wallet." }, { status: 500 });
                }
            }
        }

        if (isOfflineMode) {
            walletRecord = getOfflineUserEmbeddedWallet(emailVal);
        }

        if (walletRecord) {
            walletAddress = walletRecord.wallet_address;
        } else {
            const newWallet = ethers.Wallet.createRandom();
            walletAddress = newWallet.address;
            
            const encryptedKey = encryptPrivateKey(newWallet.privateKey);

            if (isOfflineMode) {
                saveOfflineUserEmbeddedWallet(emailVal, walletAddress.toLowerCase(), encryptedKey);
            } else {
                try {
                    await withPgClient(async (client) => {
                        await client.query(
                            `insert into user_embedded_wallets (email, wallet_address, encrypted_private_key, provider, updated_at)
                             values ($1, $2, $3, 'email_otp', now())
                             on conflict (email) do update set
                                wallet_address = excluded.wallet_address,
                                encrypted_private_key = excluded.encrypted_private_key,
                                provider = excluded.provider,
                                updated_at = now()`,
                            [emailVal, walletAddress.toLowerCase(), encryptedKey]
                        );
                    });
                } catch (err: any) {
                    if (isConnectionError(err)) {
                        console.warn("⚠️ Database is offline. Storing new social embedded wallet in offlineDb.");
                        saveOfflineUserEmbeddedWallet(emailVal, walletAddress.toLowerCase(), encryptedKey);
                    } else {
                        console.error("Failed to store generated OTP embedded wallet:", err);
                        return NextResponse.json({ error: "Failed to generate embedded wallet." }, { status: 500 });
                    }
                }
            }
        }

        const secretStr = process.env.JWT_SECRET;
        if (!secretStr) {
            return NextResponse.json({ error: "Internal Server Error: Secret key configuration missing" }, { status: 500 });
        }

        const secret = new TextEncoder().encode(secretStr);
        const sessionDuration = rememberMeVal ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
        const expiresAt = new Date(Date.now() + sessionDuration);
        const sessionDurationStr = rememberMeVal ? "30d" : "1d";

        const jwt = await new SignJWT({ address: walletAddress.toLowerCase(), authenticatedAt: Date.now() })
            .setProtectedHeader({ alg: "HS256" })
            .setExpirationTime(sessionDurationStr)
            .sign(secret);

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
