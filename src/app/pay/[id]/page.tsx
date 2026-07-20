import type { Metadata } from "next";
import { createClient } from "@supabase/supabase-js";
import { merchantDisplayName } from "@/lib/identityDisplay";
import { headers } from "next/headers";
import { getCurrencyForCountry } from "@/lib/currencyMap";
import { fetchExchangeRate } from "@/lib/fx";
import { paymentLinkSettlementVersion } from "@/lib/paymentLinks/settlementVersion";
import { isValidPaymentLinkId } from "@/lib/paymentLinks/validation";
import PublicPayClient from "./PublicPayClient";

/* Define parameters type according to Next.js App Router specs */
type PageProps = {
    params: Promise<{ id: string }>;
};

function validateStoredReturnUrl(value: unknown): string | undefined {
    if (typeof value !== "string" || value.length > 2048) return undefined;
    try {
        const url = new URL(value);
        const isLoopback = url.hostname === "localhost" || url.hostname === "127.0.0.1";
        return url.protocol === "https:" || (isLoopback && url.protocol === "http:")
            ? url.toString()
            : undefined;
    } catch {
        return undefined;
    }
}

function normalizePublicUrl(value: string | undefined) {
    if (!value) return "";
    try {
        const url = new URL(value);
        if (url.hostname === "subscriptonarc.com") {
            url.hostname = "www.subscriptonarc.com";
        }
        return url.origin;
    } catch {
        return value;
    }
}

/* Helper function to query payment link directly from database on the server */
async function getPaymentLink(id: string) {
    if (!isValidPaymentLinkId(id)) {
        return null;
    }
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    if (!supabaseUrl || !supabaseServiceKey) {
        return null;
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    /* state_snapshot is fetched ONLY to validate merchant return URLs server-side; it holds
       checkout-intent internals and must never be forwarded to the browser (see the strip in
       PublicPayPage). Everything else here is the checkout-facing whitelist, mirroring the
       anonymous GET /api/payment-links/[id] payload. */
    /* Settlement-mode fields are part of the whitelist so the checkout can select the snapshotted
       Arc network and distinguish a funded testnet link from the shared demo simulation.
       deleted_at is filtered rather than selected: a soft-deleted checkout should read as gone. */
    const { data: link, error } = await supabase
        .from("payment_links")
        .select("id, merchant_address, title, description, amount_usdc, active, sandbox_mode, simulation_only, settlement_chain_id, expires_at, max_uses, use_count, status, receipt_token, merchant_name_snapshot, external_reference, invoice_number, due_date, beneficiary_address, state_snapshot, paid_at, verified_tx_hash")
        .eq("id", id)
        .is("deleted_at", null)
        .maybeSingle();

    if (error) {
        console.error("Error retrieving payment link on server:", error.message);
        return null;
    }
    if (!link) return null;

    const beneficiaryAddress = link.beneficiary_address ? String(link.beneficiary_address).toLowerCase() : null;
    const [
        { data: alias },
        { data: paymentSettings, error: paymentSettingsError },
        { data: beneficiaryAlias },
    ] = await Promise.all([
        supabase
            .from("address_aliases")
            .select("alias")
            .eq("address", String(link.merchant_address).toLowerCase())
            .maybeSingle(),
        supabase
            .from("system_settings")
            .select("hosted_payments_enabled")
            .maybeSingle(),
        beneficiaryAddress
            ? supabase
                .from("address_aliases")
                .select("alias, is_anonymous")
                .eq("address", beneficiaryAddress)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
    ]);

    return {
        ...link,
        merchant_display_name: merchantDisplayName(alias?.alias),
        beneficiary_display_name: beneficiaryAlias?.alias && !beneficiaryAlias?.is_anonymous
            ? `@${beneficiaryAlias.alias}`
            : null,
        hosted_payments_enabled: !paymentSettingsError && paymentSettings?.hosted_payments_enabled !== false,
    };
}

/* Dynamically generate Open Graph and Twitter Card metadata for dynamic checkouts */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
    const { id } = await params;
    const link = await getPaymentLink(id);

    if (!link) {
        return {
            title: "Payment Link Not Found",
            description: "The requested checkout link could not be found or has expired.",
        };
    }

    const amountFormatted = (Number(link.amount_usdc) / 1000000).toFixed(2);
    const title = `Pay ${link.merchant_display_name} - ${amountFormatted} USDC`;
    const description = link.description || "Secure checkout via SubScript Protocol";

    const configuredAppUrl = normalizePublicUrl(process.env.NEXT_PUBLIC_APP_URL);
    const appUrl = configuredAppUrl
        ? configuredAppUrl
        : process.env.VERCEL_URL 
            ? `https://${process.env.VERCEL_URL}` 
            : "https://www.subscriptonarc.com";
    return {
        metadataBase: new URL(appUrl),
        title,
        description,
        openGraph: {
            title,
            description,
            images: [
                {
                    url: "/og.png",
                    width: 1200,
                    height: 630,
                    alt: title,
                },
            ],
            type: "website",
        },
        twitter: {
            card: "summary_large_image",
            title,
            description,
            images: ["/og.png"],
        },
    };
}

/* Server Component entry point rendering the client component with initial data and localization payload */
export default async function PublicPayPage({ params }: PageProps) {
    const { id } = await params;
    const fullLink = await getPaymentLink(id);
    const returnUrls = (fullLink?.state_snapshot as { returnUrls?: Record<string, unknown> } | null)?.returnUrls;
    const successUrl = validateStoredReturnUrl(returnUrls?.successUrl);
    const cancelUrl = validateStoredReturnUrl(returnUrls?.cancelUrl);
    const initialSettlementVersion = paymentLinkSettlementVersion(
        fullLink?.paid_at,
        fullLink?.verified_tx_hash,
    );
    /* The initial link data is serialized into public page HTML — the raw checkout-intent
       snapshot stays on the server, and merchant external references are exposed only for the
       system-generated peer-request markers the client keys off (matching the anonymous API). */
    let link: Record<string, unknown> | null = null;
    if (fullLink) {
        const {
            state_snapshot: _snapshot,
            external_reference,
            paid_at: _paidAt,
            verified_tx_hash: _verifiedTxHash,
            ...publicLink
        } = fullLink;
        const isPeerRequestReference = typeof external_reference === "string" && (
            external_reference.startsWith("peer-request:")
            || external_reference.startsWith("dm-peer-request:")
        );
        link = { ...publicLink, ...(isPeerRequestReference ? { external_reference } : {}) };
    }

    const headersList = await headers();
    const country = headersList.get("x-user-country") || "US";
    const displayCurrency = getCurrencyForCountry(country);
    const exchangeRate = await fetchExchangeRate(displayCurrency);
    
    /* amount_usdc is stored in micro-USDC (6 decimals) */
    const amountUsdcNum = link ? (Number(link.amount_usdc) / 1000000) : 0;
    const displayAmount = amountUsdcNum * exchangeRate;

    return (
        <PublicPayClient 
            id={id} 
            initialLinkData={link} 
            displayCurrency={displayCurrency}
            displayAmount={displayAmount}
            exchangeRate={exchangeRate}
            successUrl={successUrl}
            cancelUrl={cancelUrl}
            initialSettlementVersion={initialSettlementVersion}
        />
    );
}
