import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ethers } from "ethers";
import { SignJWT } from "jose";
import { encryptPrivateKey } from "@/lib/crypto";
import { sanitizeInput } from "@/utils/security";
import { getAccountRole } from "@/lib/accounts/roles";
import { findAccountEmailBinding, isWalletOnlyEmailBinding } from "@/lib/auth/accountEmail";
import { withPgClient } from "@/lib/serverPg";
import { setSessionCookie } from "@/lib/authCookies";
import { 
    isConnectionError, 
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
        const { email, provider, rememberMe } = sanitizedBody;

        if (
            typeof email !== "string" ||
            !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email) ||
            typeof provider !== "string" ||
            (provider !== "google" && provider !== "apple")
        ) {
            return NextResponse.json({ error: "Malformed payload parameters" }, { status: 400 });
        }

        const emailVal = email.toLowerCase();
        const providerVal = provider.toLowerCase();
        const rememberMeVal = Boolean(rememberMe);

        const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
        
        let walletAddress = "";
        let walletRecord = null;
        let isOfflineMode = false;

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
                return NextResponse.json({ error: err.message || "Failed to query wallet." }, { status: 500 });
            }
        }

        if (!supabaseUrl || !supabaseServiceKey) {
            isOfflineMode = true;
        } else if (!walletRecord) {
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
                        return NextResponse.json({ error: error.message || "Failed to query wallet." }, { status: 500 });
                    }
                } else {
                    walletRecord = data;
                }
            } catch (err: any) {
                if (isConnectionError(err)) {
                    isOfflineMode = true;
                } else {
                    return NextResponse.json({ error: err.message || "Failed to query wallet." }, { status: 500 });
                }
            }
        }

        if (isOfflineMode) {
            console.warn("⚠️ Supabase is offline. Querying wallet via offlineDb.");
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
                            console.error("Failed to store generated social embedded wallet:", insertError);
                            return NextResponse.json({ error: "Failed to generate embedded wallet." }, { status: 500 });
                        }
                    }
                } catch (err: any) {
                    if (isConnectionError(err)) {
                        console.warn("⚠️ Supabase is offline. Storing new social embedded wallet in offlineDb.");
                        saveOfflineUserEmbeddedWallet(emailVal, walletAddress.toLowerCase(), encryptedKey);
                    } else {
                        console.error("Failed to store generated social embedded wallet (catch):", err);
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

        const role = await getAccountRole(walletAddress);

        const response = NextResponse.json({ 
            success: true, 
            wallet: walletAddress,
            email: emailVal,
            provider: providerVal,
            role
        });

        
        setSessionCookie(response, request, jwt, expiresAt);

        return response;
    } catch (err: any) {
        console.error("Social login verification error:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}
