import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { createClient } from "@supabase/supabase-js";
import { PREMIUM_PRICE } from "@/lib/payments/constants";
import { ProtocolConfig } from "@/lib/payments/config";
import { assertFinancialNetworkReady } from "@/lib/network/registry";
import crypto from "crypto";

const parseBody = async (request: Request) => {
    try {
        return await request.json();
    } catch {
        return null;
    }
};

export async function POST(request: Request) {
    const requestId = crypto.randomUUID();
    let body: any = null;
    try {
        /* Fail-closed: mainnet mode with incomplete network config must not serve financial
           routes (never silently fall back to a testnet address). No-op on testnet. */
        assertFinancialNetworkReady();
        const walletAddress = await getSessionWallet(request.headers);
        if (!walletAddress) {
            return NextResponse.json({ error: "Unauthorized: Please connect your wallet first." }, { status: 401 });
        }

        body = await parseBody(request);
        if (!body || !body.merchantAddress) {
            return NextResponse.json({ error: "Bad Request: Missing merchantAddress in body" }, { status: 400 });
        }

        const userWallet = walletAddress.toLowerCase();
        const requestWallet = String(body.merchantAddress).toLowerCase();

        if (userWallet !== requestWallet) {
            return NextResponse.json({ error: "Forbidden: Wallet address mismatch" }, { status: 403 });
        }

        const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
        if (!supabaseUrl || !supabaseServiceKey) {
            return NextResponse.json({ error: "Configuration Error: Supabase keys missing on server" }, { status: 500 });
        }
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        /* Circuit Breaker check: verify checkouts are active */
        const { data: settings } = await supabase
            .from("system_settings")
            .select("checkout_enabled")
            .eq("id", 1)
            .maybeSingle();

        if (settings && !settings.checkout_enabled) {
            return NextResponse.json({ error: "Service Unavailable: Premium checkout operations are temporarily paused by administrator." }, { status: 503 });
        }

        /* Check if merchant is already premium in database */
        const { data: merchantData } = await supabase
            .from("merchants")
            .select("tier")
            .eq("wallet_address", userWallet)
            .maybeSingle();

        if (merchantData && merchantData.tier === "PREMIUM") {
            return NextResponse.json({
                success: true,
                message: "Merchant already active premium tier",
                tier: "PREMIUM"
            }, { status: 200 });
        }

        let session: { session_id: string; expires_at: string; status: string } | null = null;

        const { data: sessionResult, error: sessionError } = await supabase
            .rpc("get_or_create_premium_payment_session", {
                p_merchant_address: userWallet,
                p_amount_expected: PREMIUM_PRICE,
                p_chain_id: ProtocolConfig.CHAIN_ID,
                p_ttl_seconds: 30 * 60,
            })
            .maybeSingle();

        if (!sessionError && sessionResult) {
            session = sessionResult as unknown as { session_id: string; expires_at: string; status: string };
        } else {
            console.warn("[Premium Checkout] RPC get_or_create_premium_payment_session failed, executing fallback:", sessionError?.message);

            /* 1. Ensure merchant row exists in both Prisma and Supabase */
            const nowIso = new Date().toISOString();
            try {
                const { prisma } = await import("@/lib/prisma");
                await prisma.merchant.upsert({
                    where: { walletAddress: userWallet },
                    create: { walletAddress: userWallet, tier: "FREE" },
                    update: {},
                });
            } catch (err: any) {
                console.warn("[Premium Checkout] Prisma merchant upsert fallback warning:", err?.message);
            }

            try {
                await supabase
                    .from("merchants")
                    .upsert({ wallet_address: userWallet, tier: "FREE", updated_at: nowIso }, { onConflict: "wallet_address" });
            } catch {
                /* Ignore non-critical Supabase upsert error */
            }

            /* 2. Expire old pending/processing sessions */
            await supabase
                .from("payment_sessions")
                .update({ status: "FAILED", last_error: "Premium checkout session expired.", failure_code: "SESSION_EXPIRED" })
                .eq("merchant_address", userWallet)
                .in("status", ["PENDING", "PROCESSING"])
                .lte("expires_at", nowIso);

            /* 3. Query existing active session */
            const { data: existingSession } = await supabase
                .from("payment_sessions")
                .select("session_id, expires_at, status")
                .eq("merchant_address", userWallet)
                .in("status", ["PENDING", "PROCESSING"])
                .gt("expires_at", nowIso)
                .maybeSingle();

            if (existingSession) {
                session = existingSession as { session_id: string; expires_at: string; status: string };
            } else {
                /* 4. Insert fresh session with explicit UUID session_id */
                const freshSessionId = crypto.randomUUID();
                const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
                const { data: newSession, error: insertError } = await supabase
                    .from("payment_sessions")
                    .insert({
                        session_id: freshSessionId,
                        merchant_address: userWallet,
                        amount_expected: PREMIUM_PRICE,
                        chain_id: ProtocolConfig.CHAIN_ID,
                        expires_at: expiresAt,
                        status: "PENDING",
                    })
                    .select("session_id, expires_at, status")
                    .single();

                if (insertError || !newSession) {
                    console.warn("[Premium Checkout] Supabase payment session insert failed, trying Prisma fallback:", insertError);
                    try {
                        const { prisma } = await import("@/lib/prisma");
                        const createdPrismaSession = await prisma.paymentSession.create({
                            data: {
                                sessionId: freshSessionId,
                                merchantAddress: userWallet,
                                amountExpected: BigInt(PREMIUM_PRICE),
                                chainId: ProtocolConfig.CHAIN_ID,
                                expiresAt: new Date(expiresAt),
                                status: "PENDING",
                            },
                        });
                        session = {
                            session_id: createdPrismaSession.sessionId,
                            expires_at: createdPrismaSession.expiresAt ? createdPrismaSession.expiresAt.toISOString() : expiresAt,
                            status: createdPrismaSession.status,
                        };
                    } catch (prismaErr: any) {
                        console.error("[Premium Checkout] Prisma fallback also failed:", prismaErr);
                        return NextResponse.json({
                            error: "Database Sync Error: Failed to register payment session",
                            details: process.env.NODE_ENV === "production" ? undefined : (insertError?.message || prismaErr?.message),
                        }, { status: 500 });
                    }
                } else {
                    session = newSession as { session_id: string; expires_at: string; status: string };
                }
            }
        }

        console.log(`[Premium Checkout Created] New session. requestId: ${requestId}, merchantAddress: ${userWallet}, sessionId: ${session.session_id}`);

        return NextResponse.json({
            success: true,
            sessionId: session.session_id,
                status: session.status,
            expiresAt: session.expires_at
        }, { status: 200 });

    } catch (error: any) {
        console.error(`[Premium Checkout Failed] requestId: ${requestId}, merchantAddress: ${body?.merchantAddress || "unknown"}, error: ${error.message || "Internal Server Error"}`);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
