import type { Metadata } from "next";
import { createClient } from "@supabase/supabase-js";
import CommitClient from "./CommitClient";
import { resolveMerchantDisplayName } from "@/lib/merchants/identity";

type PageProps = {
    params: Promise<{ merchantAddress: string }>;
    searchParams: Promise<{ amount?: string; successUrl?: string; cancelUrl?: string }>;
};

async function getMerchant(address: string) {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    if (!supabaseUrl || !supabaseServiceKey) return null;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const normalized = address.toLowerCase();

    // The alias lookup here is address RESOLUTION only (the URL segment may be a .hq/.biz handle),
    // never the source of the merchant's name — that comes from merchants.display_name below.
    const { data: aliasData } = await supabase
        .from("address_aliases")
        .select("address, alias")
        .or(`address.eq.${normalized},alias.ilike.${normalized}`)
        .maybeSingle();

    const resolvedAddress = (aliasData?.address || normalized).toLowerCase();

    const { data: merchantData } = await supabase
        .from("merchants")
        .select("wallet_address, tier, verified, display_name")
        .eq("wallet_address", resolvedAddress)
        .maybeSingle();

    return {
        address: resolvedAddress,
        name: resolveMerchantDisplayName(merchantData?.display_name),
        alias: null,
        verified: merchantData?.verified ?? false,
        tier: merchantData?.tier || "FREE",
    };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
    const { merchantAddress } = await params;
    const merchant = await getMerchant(merchantAddress);
    const merchantName = merchant?.name || "Merchant";

    const title = `Vault Commit for ${merchantName}: SubScript`;
    const description = `Set up or top up your Pay-As-You-Go metered service balance for ${merchantName} via SubScript.`;

    return {
        title,
        description,
        openGraph: {
            title,
            description,
            images: [{ url: "/og.png", width: 1200, height: 630, alt: title }],
            type: "website",
        },
    };
}

export default async function PublicCommitPage({ params, searchParams }: PageProps) {
    const { merchantAddress } = await params;
    const { amount, successUrl, cancelUrl } = await searchParams;
    const merchant = await getMerchant(merchantAddress);

    return (
        <CommitClient
            merchantAddress={merchantAddress.toLowerCase()}
            initialMerchant={merchant}
            initialAmount={amount || "2.00"}
            successUrl={successUrl}
            cancelUrl={cancelUrl}
        />
    );
}
