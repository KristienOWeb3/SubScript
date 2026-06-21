import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { createClient } from "@supabase/supabase-js";
import { ProtocolConfig } from "@/lib/payments/config";
import { requireAccountRole } from "@/lib/accounts/roles";
import { prisma } from "@/lib/prisma";
import { getSecretKeyMode, isConfiguredPayoutDestination, merchantPayoutWalletMissingResponse } from "@/lib/apiErrors";
import { generateReceiptId } from "@/lib/arc/memo";

async function authenticateRequest(request: Request): Promise<{
    wallet: string | null;
    error: string | null;
    status: number;
    apiKeyMode: ReturnType<typeof getSecretKeyMode> | null;
}> {
    const sessionWallet = await getSessionWallet(request.headers);
    if (sessionWallet) {
        return { wallet: sessionWallet.toLowerCase(), error: null, status: 200, apiKeyMode: null };
    }
    const authHeader = request.headers.get("Authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
        const secretKey = authHeader.substring(7).trim();
        const apiKeyMode = getSecretKeyMode(secretKey);
        const keyRecord = await prisma.apiKey.findFirst({
            where: { secretKeyPlain: secretKey, revoked: false }
        });
        if (keyRecord) {
            return { wallet: keyRecord.walletAddress.toLowerCase(), error: null, status: 200, apiKeyMode };
        }
        return { 
            wallet: null, 
            error: "Unauthorized: Invalid or revoked API key", 
            status: 401,
            apiKeyMode
        };
    }
    return { 
        wallet: null, 
        error: "Unauthorized: Missing authentication credentials. Please provide a valid API Key in the Authorization header or log in.", 
        status: 401,
        apiKeyMode: null
    };
}

/* Define parsing helper for request body */
async function parseBody(request: Request) {
    try {
        return await request.json();
    } catch {
        return null;
    }
}

function getAppOrigin() {
    return process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "https://subscriptonarc.com";
}

function formatPaymentLinkResponse(link: any) {
    const origin = getAppOrigin().replace(/\/$/, "");
    return {
        ...link,
        checkoutUrl: `${origin}/pay/${link.id}`,
        receiptToken: link.receipt_token || link.receiptToken || null,
    };
}

export async function GET(request: Request) {
    try {
        const auth = await authenticateRequest(request);
        if (auth.error) {
            return NextResponse.json({ error: auth.error }, { status: auth.status });
        }
        const merchantAddress = auth.wallet!;
        const roleCheck = await requireAccountRole(merchantAddress, "ENTERPRISE");
        if (!roleCheck.ok) {
            return NextResponse.json({ error: roleCheck.error }, { status: roleCheck.status });
        }

        const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
        if (!supabaseUrl || !supabaseServiceKey) {
            return NextResponse.json({ error: "Configuration Error" }, { status: 500 });
        }

        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        const { data: links, error: fetchError } = await supabase
            .from("payment_links")
            .select("*, payments:payment_link_payments(*)")
            .eq("merchant_address", merchantAddress.toLowerCase())
            .order("created_at", { ascending: false });

        if (fetchError) {
            console.error("Error fetching payment links:", fetchError.message);
            return NextResponse.json({ error: fetchError.message }, { status: 500 });
        }

        /* Resolve payer aliases */
        const payerAddresses = new Set<string>();
        if (links) {
            for (const link of links) {
                if (link.payments) {
                    for (const p of link.payments) {
                        if (p.payer_address) {
                            payerAddresses.add(p.payer_address.toLowerCase());
                        }
                    }
                }
            }
        }

        const aliasMap: Record<string, { alias: string; is_anonymous: boolean }> = {};
        if (payerAddresses.size > 0) {
            const { data: aliases } = await supabase
                .from("address_aliases")
                .select("address, alias, is_anonymous")
                .in("address", Array.from(payerAddresses));

            if (aliases) {
                for (const row of aliases) {
                    aliasMap[row.address.toLowerCase()] = {
                        alias: row.alias,
                        is_anonymous: row.is_anonymous
                    };
                }
            }
        }

        if (links) {
            for (const link of links) {
                if (link.payments) {
                    for (const p of link.payments) {
                        if (p.payer_address) {
                            const match = aliasMap[p.payer_address.toLowerCase()];
                            if (match) {
                                p.payer_alias = match.is_anonymous ? "Anonymous" : match.alias;
                                p.is_payer_anonymous = match.is_anonymous;
                            } else {
                                p.payer_alias = null;
                                p.is_payer_anonymous = false;
                            }
                        }
                    }
                }
            }
        }

        return NextResponse.json({ links }, { status: 200 });

    } catch (error: any) {
        console.error("Payment links GET error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const auth = await authenticateRequest(request);
        if (auth.error) {
            return NextResponse.json({ error: auth.error }, { status: auth.status });
        }
        const merchantAddress = auth.wallet!;
        const roleCheck = await requireAccountRole(merchantAddress, "ENTERPRISE");
        if (!roleCheck.ok) {
            return NextResponse.json({ error: roleCheck.error }, { status: roleCheck.status });
        }

        const body = await parseBody(request);
        if (!body) {
            return NextResponse.json({ error: "Bad Request: Invalid JSON" }, { status: 400 });
        }

        const { title, description, amount_usdc, expires_at, external_reference, idempotency_key, merchant_name, max_uses, sandbox } = body;
        const isSandboxRequest = sandbox === true || auth.apiKeyMode === "test";

        if (!title || typeof title !== "string" || title.trim() === "") {
            return NextResponse.json({ error: "Bad Request: Title is required" }, { status: 400 });
        }

        /* Parse and validate amount_usdc as positive bigint */
        let amountBigInt: bigint;
        try {
            amountBigInt = BigInt(amount_usdc);
            if (amountBigInt <= BigInt(0)) {
                return NextResponse.json({ error: "Bad Request: Amount must be greater than 0" }, { status: 400 });
            }
        } catch {
            return NextResponse.json({ error: "Bad Request: Invalid amount_usdc" }, { status: 400 });
        }

        let maxUses: number | null = null;
        if (max_uses !== undefined && max_uses !== null && max_uses !== "") {
            const parsedMaxUses = Number(max_uses);
            if (!Number.isInteger(parsedMaxUses) || parsedMaxUses <= 0 || parsedMaxUses > 10_000) {
                return NextResponse.json({ error: "Bad Request: max_uses must be a positive integer" }, { status: 400 });
            }
            maxUses = parsedMaxUses;
        }

        const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
        if (!supabaseUrl || !supabaseServiceKey) {
            return NextResponse.json({ error: "Configuration Error" }, { status: 500 });
        }

        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        /* Idempotency Check */
        if (idempotency_key && typeof idempotency_key === "string" && idempotency_key.trim() !== "") {
            const { data: existingLink } = await supabase
                .from("payment_links")
                .select("*")
                .eq("idempotency_key", idempotency_key)
                .maybeSingle();

            if (existingLink) {
                let link = existingLink;
                if (!link.receipt_token) {
                    const receiptToken = generateReceiptId(link.title);
                    const { data: updatedLink, error: receiptUpdateError } = await supabase
                        .from("payment_links")
                        .update({ receipt_token: receiptToken })
                        .eq("id", link.id)
                        .select("*")
                        .single();

                    if (receiptUpdateError) {
                        console.error("Error backfilling payment link receipt token:", receiptUpdateError.message);
                        return NextResponse.json({ error: "Failed to prepare checkout receipt token" }, { status: 500 });
                    }
                    link = updatedLink;
                }
                return NextResponse.json({ link: formatPaymentLinkResponse(link) }, { status: 200 });
            }
        }

        /* Get merchant's tier and count active links to enforce quotas */
        const [merchantRes, countRes] = await Promise.all([
            supabase
                .from("merchants")
                .select("tier, payout_destination")
                .eq("wallet_address", merchantAddress.toLowerCase())
                .maybeSingle(),
            supabase
                .from("payment_links")
                .select("id", { count: "exact", head: true })
                .eq("merchant_address", merchantAddress.toLowerCase())
                .eq("active", true)
                .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
        ]);

        if (merchantRes.error) {
            console.error("Error fetching merchant tier:", merchantRes.error.message);
            return NextResponse.json({ error: merchantRes.error.message }, { status: 500 });
        }

        if (auth.apiKeyMode === "live" && !isSandboxRequest && !isConfiguredPayoutDestination(merchantRes.data?.payout_destination)) {
            return merchantPayoutWalletMissingResponse();
        }

        const tier = merchantRes.data ? merchantRes.data.tier : "FREE";
        const activeCount = countRes.count || 0;
        const limit = tier === "PREMIUM" ? ProtocolConfig.MAX_PAYMENT_LINKS_TIER1 : ProtocolConfig.MAX_PAYMENT_LINKS_TIER0;

        if (activeCount >= limit) {
            return NextResponse.json({
                error: `Quota Exceeded: Active link limit of ${limit} reached for your merchant tier.`
            }, { status: 403 });
        }

        /* Insert new payment link */
        const { data: newLink, error: insertError } = await supabase
            .from("payment_links")
            .insert({
                merchant_address: merchantAddress.toLowerCase(),
                title,
                description: description || null,
                amount_usdc: amountBigInt.toString(),
                active: true,
                expires_at: expires_at
                    ? (() => {
                        const num = Number(expires_at);
                        if (!isNaN(num)) {
                            return new Date(num < 10000000000 ? num * 1000 : num).toISOString();
                        }
                        return new Date(expires_at).toISOString();
                    })()
                    : null,
                external_reference: external_reference || null,
                idempotency_key: idempotency_key || null,
                merchant_name_snapshot: merchant_name || null,
                receipt_token: generateReceiptId(title),
                max_uses: maxUses
            })
            .select()
            .single();

        if (insertError) {
            console.error("Error inserting payment link:", insertError.message);
            return NextResponse.json({ error: insertError.message }, { status: 500 });
        }

        return NextResponse.json({ link: formatPaymentLinkResponse(newLink), sandbox: isSandboxRequest }, { status: 201 });

    } catch (error: any) {
        console.error("Payment links POST error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
