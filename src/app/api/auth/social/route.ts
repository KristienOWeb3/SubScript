import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ethers } from "ethers";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";
import { encryptPrivateKey, decryptPrivateKey } from "@/lib/crypto";

export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => null);
        if (!body || !body.email || !body.provider) {
            return NextResponse.json({ error: "Email and social provider are required" }, { status: 400 });
        }

        const email = body.email.toLowerCase();
        const provider = body.provider.toLowerCase();
        const rememberMe = Boolean(body.rememberMe);

        if (provider !== "google" && provider !== "apple") {
            return NextResponse.json({ error: "Invalid social provider" }, { status: 400 });
        }

        // 1. Initialize Supabase client
        const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
        if (!supabaseUrl || !supabaseServiceKey) {
            return NextResponse.json({ error: "Server Configuration Error: Supabase client not initialized." }, { status: 500 });
        }
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        // 2. Resolve or Generate Embedded Wallet
        let walletAddress = "";
        let decryptedPrivateKey = "";

        const { data: walletRecord, error: walletError } = await supabase
            .from("user_embedded_wallets")
            .select("wallet_address, encrypted_private_key")
            .eq("email", email)
            .maybeSingle();

        if (walletRecord) {
            walletAddress = walletRecord.wallet_address;
            decryptedPrivateKey = decryptPrivateKey(walletRecord.encrypted_private_key);
        } else {
            // Generate a fresh random wallet
            const newWallet = ethers.Wallet.createRandom();
            walletAddress = newWallet.address;
            decryptedPrivateKey = newWallet.privateKey;
            
            const encryptedKey = encryptPrivateKey(newWallet.privateKey);

            const { error: insertError } = await supabase
                .from("user_embedded_wallets")
                .insert({
                    email,
                    wallet_address: walletAddress.toLowerCase(),
                    encrypted_private_key: encryptedKey
                });

            if (insertError) {
                console.error("Failed to store generated social embedded wallet:", insertError);
                return NextResponse.json({ error: "Failed to generate embedded wallet." }, { status: 500 });
            }

            // Sync with merchants table to avoid foreign key errors on subsequent logs
            await supabase
                .from("merchants")
                .upsert({
                    wallet_address: walletAddress.toLowerCase(),
                    tier: 0
                }, { onConflict: "wallet_address" });
        }

        // 3. Create active database session
        const sessionToken = crypto.randomBytes(32).toString("hex");
        const sessionDuration = rememberMe ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
        const expiresAt = new Date(Date.now() + sessionDuration);

        await prisma.session.create({
            data: {
                wallet: walletAddress.toLowerCase(),
                token: sessionToken,
                expiresAt,
            },
        });

        // 4. Create Response and set secure HTTP-only cookie
        const response = NextResponse.json({ 
            success: true, 
            wallet: walletAddress,
            privateKey: decryptedPrivateKey,
            email,
            provider
        });
        
        response.cookies.set("subscript_session_token", sessionToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "strict",
            path: "/",
            expires: expiresAt,
        });

        return response;
    } catch (err: any) {
        console.error("Social login verification error:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}
