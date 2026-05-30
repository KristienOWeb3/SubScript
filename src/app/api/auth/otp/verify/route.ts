import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ethers } from "ethers";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";
import { encryptPrivateKey } from "@/lib/crypto";

export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => null);
        if (!body || !body.email || !body.code) {
            return NextResponse.json({ error: "Email and verification code are required" }, { status: 400 });
        }

        const email = body.email.toLowerCase();
        const code = String(body.code).trim();
        const rememberMe = Boolean(body.rememberMe);

        const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
        if (!supabaseUrl || !supabaseServiceKey) {
            return NextResponse.json({ error: "Server Configuration Error: Supabase client not initialized." }, { status: 500 });
        }
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        const { data: record, error: fetchError } = await supabase
            .from("otp_codes")
            .select("code, expires_at")
            .eq("email", email)
            .maybeSingle();

        if (fetchError || !record) {
            return NextResponse.json({ error: "Verification code expired or not found. Please request a new one." }, { status: 400 });
        }

        if (record.code !== code) {
            return NextResponse.json({ error: "Invalid verification code. Please check and try again." }, { status: 400 });
        }

        if (new Date() > new Date(record.expires_at)) {
            await supabase.from("otp_codes").delete().eq("email", email);
            return NextResponse.json({ error: "Verification code has expired. Please request a new one." }, { status: 400 });
        }

        await supabase.from("otp_codes").delete().eq("email", email);

        let walletAddress = "";

        const { data: walletRecord, error: walletError } = await supabase
            .from("user_embedded_wallets")
            .select("wallet_address")
            .eq("email", email)
            .maybeSingle();

        if (walletRecord) {
            walletAddress = walletRecord.wallet_address;
        } else {
            const newWallet = ethers.Wallet.createRandom();
            walletAddress = newWallet.address;
            
            const encryptedKey = encryptPrivateKey(newWallet.privateKey);

            const { error: insertError } = await supabase
                .from("user_embedded_wallets")
                .insert({
                    email,
                    wallet_address: walletAddress.toLowerCase(),
                    encrypted_private_key: encryptedKey
                });

            if (insertError) {
                console.error("Failed to store generated embedded wallet:", insertError);
                return NextResponse.json({ error: "Failed to generate embedded wallet." }, { status: 500 });
            }

            await supabase
                .from("merchants")
                .upsert({
                    wallet_address: walletAddress.toLowerCase(),
                    tier: 0
                }, { onConflict: "wallet_address" });
        }

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

        const response = NextResponse.json({ 
            success: true, 
            wallet: walletAddress,
            email
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
        console.error("Verification error:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}
