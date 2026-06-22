import type { Metadata } from "next";
import { createClient } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { getCurrencyForCountry } from "@/lib/currencyMap";
import { fetchExchangeRate } from "@/lib/fx";
import PublicPayClient from "./PublicPayClient";

/* Define parameters type according to Next.js App Router specs */
type PageProps = {
    params: Promise<{ id: string }>;
};

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
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    if (!supabaseUrl || !supabaseServiceKey) {
        return null;
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data: link, error } = await supabase
        .from("payment_links")
        .select("id, merchant_address, title, description, amount_usdc, active, expires_at, max_uses, use_count, status, receipt_token")
        .eq("id", id)
        .maybeSingle();

    if (error) {
        console.error("Error retrieving payment link on server:", error.message);
        return null;
    }
    return link;
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
    const merchantShort = link.merchant_address
        ? `${link.merchant_address.slice(0, 6)}...${link.merchant_address.slice(-4)}`
        : "Merchant";

    const title = `Pay ${merchantShort} - ${amountFormatted} USDC`;
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
    const link = await getPaymentLink(id);

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
        />
    );
}
