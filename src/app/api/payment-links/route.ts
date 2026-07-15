import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { createClient } from "@supabase/supabase-js";
import { ProtocolConfig } from "@/lib/payments/config";
import { requireAccountRole } from "@/lib/accounts/roles";
import { prisma } from "@/lib/prisma";
import { getSecretKeyMode, isConfiguredPayoutDestination, merchantPayoutWalletMissingResponse } from "@/lib/apiErrors";
import { generateReceiptId } from "@/lib/arc/memo";
import { buildCheckoutUrl } from "@/lib/checkoutUrl";
import { hashSecretKey } from "@/lib/apiKeys";
import { validateBeneficiaryAddress } from "@/lib/paymentLinks/beneficiary";

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
            where: {
                revoked: false,
                secretKeyHash: hashSecretKey(secretKey),
            }
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

function formatPaymentLinkResponse(link: any) {
    const beneficiaryAddress = link.beneficiary_address || link.beneficiaryAddress || null;
    return {
        ...link,
        checkoutUrl: buildCheckoutUrl(link.id),
        receiptToken: link.receipt_token || link.receiptToken || null,
        beneficiaryAddress,
        invoiceNumber: link.invoice_number || null,
        dueDate: link.due_date || null,
        payerEmail: link.payer_email || null,
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

        return NextResponse.json({ links: (links || []).map(formatPaymentLinkResponse) }, { status: 200 });

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

        const {
            title,
            description,
            amount_usdc,
            expires_at,
            external_reference,
            idempotency_key,
            merchant_name,
            max_uses,
            sandbox,
            beneficiary_address,
            beneficiaryAddress,
            invoice_number,
            invoiceNumber,
            due_date,
            dueDate,
            payer_email,
            payerEmail,
        } = body;
        const isSandboxRequest = sandbox === true || auth.apiKeyMode === "test";

        if (!title || typeof title !== "string" || title.trim() === "") {
            return NextResponse.json({ error: "Bad Request: Title is required" }, { status: 400 });
        }

        /* Reserved peer-request sentinels: these classify a link as a user-to-user request
           (isPeerRequestLink), which settles as a direct USDC transfer and bypasses the router
           and its fee/ledger accounting. Only the internal peer-request flow may set them — a
           merchant checkout must never self-classify, or a merchant could dodge the router fee. */
        if (typeof merchant_name === "string" && merchant_name.trim() === "SubScript user request") {
            return NextResponse.json({ error: "Bad Request: merchant_name uses a reserved value" }, { status: 400 });
        }
        if (typeof external_reference === "string" &&
            (external_reference.startsWith("peer-request:") || external_reference.startsWith("dm-peer-request:"))) {
            return NextResponse.json({ error: "Bad Request: external_reference uses a reserved prefix" }, { status: 400 });
        }

        /* Bound free-text/identifier inputs so oversized payloads can't amplify storage or 500. */
        if (title.length > 200) {
            return NextResponse.json({ error: "Bad Request: title must be 200 characters or fewer" }, { status: 400 });
        }
        if (description !== undefined && description !== null &&
            (typeof description !== "string" || description.length > 2000)) {
            return NextResponse.json({ error: "Bad Request: description must be a string of 2000 characters or fewer" }, { status: 400 });
        }
        if (external_reference !== undefined && external_reference !== null &&
            (typeof external_reference !== "string" || external_reference.length > 256)) {
            return NextResponse.json({ error: "Bad Request: external_reference must be a string of 256 characters or fewer" }, { status: 400 });
        }
        if (merchant_name !== undefined && merchant_name !== null &&
            (typeof merchant_name !== "string" || merchant_name.length > 128)) {
            return NextResponse.json({ error: "Bad Request: merchant_name must be a string of 128 characters or fewer" }, { status: 400 });
        }
        if (idempotency_key !== undefined && idempotency_key !== null &&
            (typeof idempotency_key !== "string" || idempotency_key.length > 200)) {
            return NextResponse.json({ error: "Bad Request: idempotency_key must be a string of 200 characters or fewer" }, { status: 400 });
        }

        if (
            beneficiary_address !== undefined &&
            beneficiaryAddress !== undefined &&
            String(beneficiary_address).toLowerCase() !== String(beneficiaryAddress).toLowerCase()
        ) {
            return NextResponse.json(
                { error: "Bad Request: beneficiary_address and beneficiaryAddress must match" },
                { status: 400 },
            );
        }

        const beneficiaryValidation = validateBeneficiaryAddress(
            beneficiary_address ?? beneficiaryAddress,
            merchantAddress,
        );
        if (!beneficiaryValidation.ok) {
            return NextResponse.json({ error: beneficiaryValidation.error }, { status: 400 });
        }
        const normalizedBeneficiary = beneficiaryValidation.address;

        /* Parse and validate amount_usdc (micro-USDC) strictly. BigInt() would coerce booleans
           (true->1), hex strings ("0x10"->16), and whitespace, so validate the shape first: a
           plain non-negative integer, given as a digit string or a safe-integer number. */
        const MAX_LINK_AMOUNT = BigInt(1_000_000) * BigInt(1_000_000); /* 1,000,000 USDC in micros */
        let amountBigInt: bigint;
        {
            let amountSource: string | null = null;
            if (typeof amount_usdc === "string" && /^\d+$/.test(amount_usdc.trim())) {
                amountSource = amount_usdc.trim();
            } else if (typeof amount_usdc === "number" && Number.isSafeInteger(amount_usdc) && amount_usdc >= 0) {
                amountSource = String(amount_usdc);
            }
            if (amountSource === null) {
                return NextResponse.json({ error: "Bad Request: amount_usdc must be a whole number of micro-USDC" }, { status: 400 });
            }
            amountBigInt = BigInt(amountSource);
            if (amountBigInt <= BigInt(0)) {
                return NextResponse.json({ error: "Bad Request: Amount must be greater than 0" }, { status: 400 });
            }
            if (amountBigInt > MAX_LINK_AMOUNT) {
                return NextResponse.json({ error: "Bad Request: amount_usdc exceeds the maximum allowed" }, { status: 400 });
            }
        }

        /* Invoice fields (v1): optional number, due date, and payer identity ride the
           existing link/receipt/webhook lifecycle so a payment link can serve as an invoice. */
        const rawInvoiceNumber = invoice_number ?? invoiceNumber;
        const normalizedInvoiceNumber = typeof rawInvoiceNumber === "string" && rawInvoiceNumber.trim()
            ? rawInvoiceNumber.trim().slice(0, 64)
            : null;
        const rawDueDate = due_date ?? dueDate;
        let normalizedDueDate: string | null = null;
        if (rawDueDate !== undefined && rawDueDate !== null && rawDueDate !== "") {
            const parsed = new Date(typeof rawDueDate === "number" && rawDueDate < 10_000_000_000 ? rawDueDate * 1000 : rawDueDate);
            if (Number.isNaN(parsed.getTime())) {
                return NextResponse.json({ error: "Bad Request: due_date must be an ISO date or unix timestamp" }, { status: 400 });
            }
            normalizedDueDate = parsed.toISOString();
        }
        const rawPayerEmail = payer_email ?? payerEmail;
        let normalizedPayerEmail: string | null = null;
        if (rawPayerEmail !== undefined && rawPayerEmail !== null && rawPayerEmail !== "") {
            if (typeof rawPayerEmail !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawPayerEmail.trim()) || rawPayerEmail.length > 254) {
                return NextResponse.json({ error: "Bad Request: payer_email must be a valid email address" }, { status: 400 });
            }
            normalizedPayerEmail = rawPayerEmail.trim().toLowerCase();
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

        if (normalizedBeneficiary) {
            const { data: beneficiaryRole, error: beneficiaryRoleError } = await supabase
                .from("account_roles")
                .select("role")
                .eq("address", normalizedBeneficiary)
                .maybeSingle();

            if (beneficiaryRoleError) {
                console.error("Error validating payment-link beneficiary:", beneficiaryRoleError.message);
                return NextResponse.json({ error: "Failed to validate beneficiary account" }, { status: 500 });
            }
            if (beneficiaryRole?.role !== "USER") {
                return NextResponse.json(
                    { error: "Bad Request: beneficiary_address must belong to a registered SubScript USER" },
                    { status: 400 },
                );
            }
        }

        /* Idempotency Check */
        if (idempotency_key && typeof idempotency_key === "string" && idempotency_key.trim() !== "") {
            const { data: existingLink } = await supabase
                .from("payment_links")
                .select("*")
                .eq("idempotency_key", idempotency_key)
                .maybeSingle();

            if (existingLink) {
                if (existingLink.merchant_address?.toLowerCase() !== merchantAddress.toLowerCase()) {
                    return NextResponse.json(
                        { error: "Conflict: Idempotency key is already in use" },
                        { status: 409 },
                    );
                }
                const existingBeneficiary = existingLink.beneficiary_address?.toLowerCase() || null;
                if (existingBeneficiary !== normalizedBeneficiary) {
                    return NextResponse.json(
                        { error: "Conflict: Idempotency key was used with a different beneficiary" },
                        { status: 409 },
                    );
                }
                /* Fingerprint the financial terms too — silently returning the old link when the
                   caller changed the amount would let a stale key mask a different-price checkout. */
                if (String(existingLink.amount_usdc) !== amountBigInt.toString()) {
                    return NextResponse.json(
                        { error: "Conflict: Idempotency key was used with a different amount" },
                        { status: 409 },
                    );
                }
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
                .select("tier, payout_destination, verified")
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

        /* Verification is a manual trust badge, not a functional gate — merchants can create links
           without it. Access is gated only by the tier system (active-link quota below) and, for
           live keys, a configured payout destination. */
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
                max_uses: maxUses,
                beneficiary_address: normalizedBeneficiary,
                invoice_number: normalizedInvoiceNumber,
                due_date: normalizedDueDate,
                payer_email: normalizedPayerEmail,
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
