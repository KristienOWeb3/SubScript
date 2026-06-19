import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ethers } from "ethers";
import { SignJWT } from "jose";
import { encryptPrivateKey } from "@/lib/crypto";
import { sanitizeInput } from "@/utils/security";
import { prisma } from "@/lib/prisma";
import { 
    isConnectionError, 
    getOfflineOtpCode, 
    deleteOfflineOtpCode, 
    getOfflineUserEmbeddedWallet, 
    saveOfflineUserEmbeddedWallet
} from "@/lib/offlineDb";

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

        const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
        
        let record = null;
        let isOfflineMode = false;

        if (!supabaseUrl || !supabaseServiceKey) {
            isOfflineMode = true;
        } else {
            try {
                const supabase = createClient(supabaseUrl, supabaseServiceKey);
                const { data, error } = await supabase
                    .from("otp_codes")
                    .select("code, expires_at")
                    .eq("email", emailVal)
                    .maybeSingle();

                if (error) {
                    if (isConnectionError(error)) {
                        isOfflineMode = true;
                    } else {
                        return NextResponse.json({ error: error.message || "Failed to query verification code." }, { status: 500 });
                    }
                } else {
                    record = data;
                }
            } catch (err: any) {
                if (isConnectionError(err)) {
                    isOfflineMode = true;
                } else {
                    return NextResponse.json({ error: err.message || "Failed to query verification code." }, { status: 500 });
                }
            }
        }

        if (isOfflineMode) {
            console.warn("⚠️ Supabase is offline. Verifying OTP via offlineDb.");
            record = getOfflineOtpCode(emailVal);
        }

        if (!record) {
            return NextResponse.json({ error: "Verification code expired or not found. Please request a new one." }, { status: 400 });
        }

        if (record.code !== codeTrimmed) {
            return NextResponse.json({ error: "Invalid verification code. Please check and try again." }, { status: 400 });
        }

        if (new Date() > new Date(record.expires_at)) {
            if (isOfflineMode) {
                deleteOfflineOtpCode(emailVal);
            } else {
                try {
                    const supabase = createClient(supabaseUrl, supabaseServiceKey);
                    await supabase.from("otp_codes").delete().eq("email", emailVal);
                } catch (e) {}
            }
            return NextResponse.json({ error: "Verification code has expired. Please request a new one." }, { status: 400 });
        }

        if (isOfflineMode) {
            deleteOfflineOtpCode(emailVal);
        } else {
            try {
                const supabase = createClient(supabaseUrl, supabaseServiceKey);
                await supabase.from("otp_codes").delete().eq("email", emailVal);
            } catch (e) {}
        }

        let walletAddress = "";
        let walletRecord = null;

        if (!isOfflineMode) {
            try {
                const supabase = createClient(supabaseUrl, supabaseServiceKey);
                const { data, error } = await supabase
                    .from("user_embedded_wallets")
                    .select("wallet_address")
                    .eq("email", emailVal)
                    .maybeSingle();

                if (error) {
                    if (isConnectionError(error)) {
                        isOfflineMode = true;
                    } else {
                        return NextResponse.json({ error: error.message || "Failed to check wallet." }, { status: 500 });
                    }
                } else {
                    walletRecord = data;
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
                    const supabase = createClient(supabaseUrl, supabaseServiceKey);
                    const { error: insertError } = await supabase
                        .from("user_embedded_wallets")
                        .insert({
                            email: emailVal,
                            wallet_address: walletAddress.toLowerCase(),
                            encrypted_private_key: encryptedKey
                        });

                    if (insertError) {
                        if (isConnectionError(insertError)) {
                            console.warn("⚠️ Supabase is offline. Storing new social embedded wallet in offlineDb.");
                            saveOfflineUserEmbeddedWallet(emailVal, walletAddress.toLowerCase(), encryptedKey);
                        } else {
                            console.error("Failed to store generated embedded wallet:", insertError);
                            return NextResponse.json({ error: "Failed to generate embedded wallet." }, { status: 500 });
                        }
                    }
                } catch (err: any) {
                    if (isConnectionError(err)) {
                        console.warn("⚠️ Supabase is offline. Storing new social embedded wallet in offlineDb.");
                        saveOfflineUserEmbeddedWallet(emailVal, walletAddress.toLowerCase(), encryptedKey);
                    } else {
                        console.error("Failed to store generated embedded wallet (catch):", err);
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

        let role: string | null = null;
        try {
            const roleRecord = await prisma.accountRole.findUnique({
                where: { address: walletAddress.toLowerCase() }
            });
            if (roleRecord) {
                role = roleRecord.role;
            }
        } catch (e) {
            console.warn("Could not query role:", e);
        }

        const response = NextResponse.json({ 
            success: true, 
            wallet: walletAddress,
            email: emailVal,
            role
        });

        
        response.cookies.set("subscript_session_token", jwt, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "strict",
            path: "/",
            expires: expiresAt,
        });

        return response;
    } catch (err: any) {
        console.error("Verification error:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}
