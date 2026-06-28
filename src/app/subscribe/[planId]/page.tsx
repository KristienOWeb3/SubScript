import type { Metadata } from "next";
import { createClient } from "@supabase/supabase-js";
import SubscribeClient from "./SubscribeClient";

type PageProps = {
    params: Promise<{ planId: string }>;
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

/* Server-side lookup of the plan (active only) for OG metadata + initial render. */
async function getPlan(planId: string) {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    if (!supabaseUrl || !supabaseServiceKey) return null;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data: plan, error } = await supabase
        .from("merchant_plans")
        .select("id, merchant_address, name, description, details_url, amount_usdc, period_seconds, active")
        .eq("id", planId)
        .maybeSingle();

    if (error || !plan || !plan.active) return null;

    const { data: alias } = await supabase
        .from("address_aliases")
        .select("alias")
        .eq("address", String(plan.merchant_address).toLowerCase())
        .maybeSingle();

    return { ...plan, merchant_alias: alias?.alias || null };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
    const { planId } = await params;
    const plan = await getPlan(planId);

    if (!plan) {
        return {
            title: "Subscription Plan Not Found",
            description: "The requested subscription plan could not be found or is no longer active.",
        };
    }

    const amountFormatted = (Number(plan.amount_usdc) / 1_000_000).toFixed(2);
    const merchantName = plan.merchant_alias
        || (plan.merchant_address
            ? `${plan.merchant_address.slice(0, 6)}...${plan.merchant_address.slice(-4)}`
            : "Merchant");

    const title = `Subscribe to ${plan.name} — ${amountFormatted} USDC`;
    const description = (plan.description && String(plan.description).trim())
        || `Recurring subscription from ${merchantName} via SubScript Protocol`;

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
            images: [{ url: "/og.png", width: 1200, height: 630, alt: title }],
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

export default async function PublicSubscribePage({ params }: PageProps) {
    const { planId } = await params;
    const plan = await getPlan(planId);

    const initialPlanData = plan
        ? {
            id: plan.id,
            name: plan.name,
            description: plan.description ?? null,
            detailsUrl: plan.details_url ?? null,
            amountUsdc: String(plan.amount_usdc),
            periodSeconds: String(plan.period_seconds),
            merchantAddress: String(plan.merchant_address).toLowerCase(),
            merchant: {
                address: String(plan.merchant_address).toLowerCase(),
                name: plan.merchant_alias
                    || `${String(plan.merchant_address).slice(0, 6)}...${String(plan.merchant_address).slice(-4)}`,
                alias: plan.merchant_alias,
            },
        }
        : null;

    return <SubscribeClient planId={planId} initialPlanData={initialPlanData} />;
}
