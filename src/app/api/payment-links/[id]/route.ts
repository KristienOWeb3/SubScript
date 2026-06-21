import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { createClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";

async function authenticateRequest(request: Request): Promise<{ wallet: string | null; error: string | null; status: number }> {
    const sessionWallet = await getSessionWallet(request.headers);
    if (sessionWallet) {
        return { wallet: sessionWallet.toLowerCase(), error: null, status: 200 };
    }
    const authHeader = request.headers.get("Authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
        const secretKey = authHeader.substring(7).trim();
        const keyRecord = await prisma.apiKey.findFirst({
            where: { secretKeyPlain: secretKey, revoked: false }
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

        /* Fetch merchant verified status */
        const { data: merchant } = await supabase
            .from("merchants")
            .select("verified")
            .eq("wallet_address", link.merchant_address.toLowerCase())
            .maybeSingle();

        const merchantVerified = merchant ? !!merchant.verified : false;

        /* Check authorization: if not owner, check active, expiration, and usage constraints */
        const auth = await authenticateRequest(request);
        const walletAddress = auth.wallet;
        const isOwner = walletAddress && walletAddress.toLowerCase() === link.merchant_address.toLowerCase();

        if (!isOwner) {
            const isExpired = link.expires_at && new Date(link.expires_at) < new Date();
            if (!link.active || isExpired) {
                return NextResponse.json({ error: "Payment Link is Expired or Inactive" }, { status: 410 });
            }

            const maxUses = link.max_uses;
            const useCount = link.use_count || 0;
            if (maxUses !== null && maxUses !== undefined && useCount >= maxUses) {
                return NextResponse.json({ error: "Payment Link has reached its maximum usage limit" }, { status: 410 });
            }
        }

        return NextResponse.json({ 
            link: {
                ...link,
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
        const auth = await authenticateRequest(request);
        if (auth.error) {
            return NextResponse.json({ error: auth.error }, { status: auth.status });
        }
        const merchantAddress = auth.wallet!;

        const body = await parseBody(request);
        if (!body) {
            return NextResponse.json({ error: "Bad Request: Invalid JSON" }, { status: 400 });
        }

        const { title, description, active, expires_at, external_reference } = body;

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

        return NextResponse.json({ link: updatedLink }, { status: 200 });

    } catch (error: any) {
        console.error("Payment link PATCH error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}

export async function DELETE(request: Request, { params }: RouteContext) {
    try {
        const { id } = await params;
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
