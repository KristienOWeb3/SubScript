import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { createClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";
import { hashSecretKey } from "@/lib/apiKeys";
import { isValidPaymentLinkId } from "@/lib/paymentLinks/validation";
import { merchantDisplayName } from "@/lib/identityDisplay";

async function authenticateRequest(request: Request): Promise<{ wallet: string | null; error: string | null; status: number }> {
    const sessionWallet = await getSessionWallet(request.headers);
    if (sessionWallet) {
        return { wallet: sessionWallet.toLowerCase(), error: null, status: 200 };
    }
    const authHeader = request.headers.get("Authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
        const secretKey = authHeader.substring(7).trim();
        const keyRecord = await prisma.apiKey.findFirst({
            where: {
                revoked: false,
                secretKeyHash: hashSecretKey(secretKey),
            }
        });
        if (keyRecord) {
            return { wallet: keyRecord.walletAddress.toLowerCase(), error: null, status: 200 };
        }
        return { 
            wallet: null, 
            error: "Unauthorized: Invalid or revoked API key", 
            status: 401 
        };
    }
    return { 
        wallet: null, 
        error: "Unauthorized: Missing authentication credentials. Please provide a valid API Key in the Authorization header or log in.", 
        status: 401 
    };
}

/* Helper to parse parameters in Next.js App Router */
type RouteContext = {
    params: Promise<{ id: string }>;
};

async function parseBody(request: Request) {
    try {
        return await request.json();
    } catch {
        return null;
    }
}

export async function GET(request: Request, { params }: RouteContext) {
    try {
        const { id } = await params;
        if (!id) {
            return NextResponse.json({ error: "Bad Request: Missing ID parameter" }, { status: 400 });
        }
        if (!isValidPaymentLinkId(id)) {
            return NextResponse.json({ error: "Payment Link Not Found" }, { status: 404 });
        }

        const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
        if (!supabaseUrl || !supabaseServiceKey) {
            return NextResponse.json({ error: "Configuration Error" }, { status: 500 });
        }

        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        const { data: link, error: fetchError } = await supabase
            .from("payment_links")
            .select("*")
            .eq("id", id)
            .maybeSingle();

        if (fetchError) {
            console.error("Error retrieving payment link:", fetchError.message);
            return NextResponse.json({ error: fetchError.message }, { status: 500 });
        }

        if (!link) {
            return NextResponse.json({ error: "Payment Link Not Found" }, { status: 404 });
        }

        const [
            { data: merchant },
            { data: merchantAlias },
            { data: paymentSettings, error: paymentSettingsError },
        ] = await Promise.all([
            supabase
                .from("merchants")
                .select("verified")
                .eq("wallet_address", link.merchant_address.toLowerCase())
                .maybeSingle(),
            supabase
                .from("address_aliases")
                .select("alias")
                .eq("address", link.merchant_address.toLowerCase())
                .maybeSingle(),
            supabase
                .from("system_settings")
                .select("hosted_payments_enabled")
                .maybeSingle(),
        ]);

        const merchantVerified = merchant ? !!merchant.verified : false;
        const merchantName = merchantDisplayName(merchantAlias?.alias);
        const hostedPaymentsEnabled = !paymentSettingsError && paymentSettings?.hosted_payments_enabled !== false;

        /* Check authorization: if not owner, check active, expiration, and usage constraints */
        const auth = await authenticateRequest(request);
        const walletAddress = auth.wallet;
        const isOwner = walletAddress && walletAddress.toLowerCase() === link.merchant_address.toLowerCase();

        if (isOwner) {
            /* The owning merchant (session or API key) gets the full record, minus the legacy
               receiver key column — raw key material never leaves the database via this API. */
            const { receiver_private_key: _receiverKey, ...ownerLink } = link;
            return NextResponse.json({
                link: {
                    ...ownerLink,
                    merchant_display_name: merchantName,
                    hosted_payments_enabled: hostedPaymentsEnabled,
                    merchant_verified: merchantVerified
                }
            }, { status: 200 });
        }

        const isExpired = link.expires_at && new Date(link.expires_at) < new Date();
        if ((!link.active && link.status !== "PAID") || isExpired) {
            return NextResponse.json({ error: "Payment Link is Expired or Inactive" }, { status: 410 });
        }

        const maxUses = link.max_uses;
        const useCount = link.use_count || 0;
        if (maxUses !== null && maxUses !== undefined && useCount >= maxUses) {
            return NextResponse.json({ error: "Payment Link has reached its maximum usage limit" }, { status: 410 });
        }

        /* This endpoint is reachable by anyone holding the link id (that is the point of a
           payment link), so the anonymous payload is a strict whitelist of what the hosted
           checkout renders. Never spread the row: payer_email, state_snapshot (checkout intent
           internals), settlement/idempotency bookkeeping and the legacy receiver key columns
           stay server-side. external_reference is exposed only for the system-generated
           peer-request markers the checkout uses to detect user-to-user requests — merchant
           references can carry order/customer details. */
        const isPeerRequestReference = typeof link.external_reference === "string" && (
            link.external_reference.startsWith("peer-request:")
            || link.external_reference.startsWith("dm-peer-request:")
        );
        return NextResponse.json({
            link: {
                id: link.id,
                merchant_address: link.merchant_address,
                title: link.title,
                description: link.description,
                amount_usdc: link.amount_usdc,
                active: link.active,
                status: link.status,
                expires_at: link.expires_at,
                max_uses: link.max_uses,
                use_count: link.use_count,
                merchant_name_snapshot: link.merchant_name_snapshot,
                merchant_display_name: merchantName,
                hosted_payments_enabled: hostedPaymentsEnabled,
                invoice_number: link.invoice_number,
                due_date: link.due_date,
                receipt_token: link.receipt_token,
                ...(isPeerRequestReference ? { external_reference: link.external_reference } : {}),
                merchant_verified: merchantVerified
            }
        }, { status: 200 });

    } catch (error: any) {
        console.error("Payment link GET error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}


export async function PATCH(request: Request, { params }: RouteContext) {
    try {
        const { id } = await params;
        if (!isValidPaymentLinkId(id)) {
            return NextResponse.json({ error: "Payment Link Not Found" }, { status: 404 });
        }
        const auth = await authenticateRequest(request);
        if (auth.error) {
            return NextResponse.json({ error: auth.error }, { status: auth.status });
        }
        const merchantAddress = auth.wallet!;

        const body = await parseBody(request);
        if (!body) {
            return NextResponse.json({ error: "Bad Request: Invalid JSON" }, { status: 400 });
        }

        const { title, description, active, expires_at, external_reference, max_uses } = body;

        const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
        if (!supabaseUrl || !supabaseServiceKey) {
            return NextResponse.json({ error: "Configuration Error" }, { status: 500 });
        }

        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        /* Verify ownership before editing */
        const { data: link, error: verifyError } = await supabase
            .from("payment_links")
            .select("merchant_address")
            .eq("id", id)
            .maybeSingle();

        if (verifyError || !link) {
            return NextResponse.json({ error: "Payment Link Not Found" }, { status: 404 });
        }

        if (link.merchant_address.toLowerCase() !== merchantAddress.toLowerCase()) {
            return NextResponse.json({ error: "Forbidden: You do not own this link" }, { status: 403 });
        }

        /* Build patch object */
        const updates: any = {
            updated_at: new Date().toISOString()
        };
        if (title !== undefined) updates.title = title;
        if (description !== undefined) updates.description = description;
        if (active !== undefined) updates.active = active;
        if (expires_at !== undefined) {
            updates.expires_at = expires_at
                ? (() => {
                    const num = Number(expires_at);
                    if (!isNaN(num)) {
                        return new Date(num < 10000000000 ? num * 1000 : num).toISOString();
                    }
                    return new Date(expires_at).toISOString();
                })()
                : null;
        }
        if (external_reference !== undefined) updates.external_reference = external_reference;
        if (max_uses !== undefined) {
            if (max_uses === null || max_uses === "") {
                updates.max_uses = null;
            } else {
                const parsedMaxUses = Number(max_uses);
                if (!Number.isInteger(parsedMaxUses) || parsedMaxUses <= 0 || parsedMaxUses > 10_000) {
                    return NextResponse.json({ error: "Bad Request: max_uses must be a positive integer" }, { status: 400 });
                }
                updates.max_uses = parsedMaxUses;
            }
        }

        const { data: updatedLink, error: updateError } = await supabase
            .from("payment_links")
            .update(updates)
            .eq("id", id)
            .select()
            .single();

        if (updateError) {
            console.error("Error updating payment link:", updateError.message);
            return NextResponse.json({ error: updateError.message }, { status: 500 });
        }

        const { receiver_private_key: _receiverKey, ...safeUpdatedLink } = updatedLink;
        return NextResponse.json({ link: safeUpdatedLink }, { status: 200 });

    } catch (error: any) {
        console.error("Payment link PATCH error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}

export async function DELETE(request: Request, { params }: RouteContext) {
    try {
        const { id } = await params;
        if (!isValidPaymentLinkId(id)) {
            return NextResponse.json({ error: "Payment Link Not Found" }, { status: 404 });
        }
        const auth = await authenticateRequest(request);
        if (auth.error) {
            return NextResponse.json({ error: auth.error }, { status: auth.status });
        }
        const merchantAddress = auth.wallet!;

        const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
        if (!supabaseUrl || !supabaseServiceKey) {
            return NextResponse.json({ error: "Configuration Error" }, { status: 500 });
        }

        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        /* Verify ownership before deleting */
        const { data: link, error: verifyError } = await supabase
            .from("payment_links")
            .select("merchant_address")
            .eq("id", id)
            .maybeSingle();

        if (verifyError || !link) {
            return NextResponse.json({ error: "Payment Link Not Found" }, { status: 404 });
        }

        if (link.merchant_address.toLowerCase() !== merchantAddress.toLowerCase()) {
            return NextResponse.json({ error: "Forbidden: You do not own this link" }, { status: 403 });
        }

        const { error: deleteError } = await supabase
            .from("payment_links")
            .delete()
            .eq("id", id);

        if (deleteError) {
            console.error("Error deleting payment link:", deleteError.message);
            return NextResponse.json({ error: deleteError.message }, { status: 500 });
        }

        return NextResponse.json({ success: true, message: "Payment link deleted successfully" }, { status: 200 });

    } catch (error: any) {
        console.error("Payment link DELETE error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
