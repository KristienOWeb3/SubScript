import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import CommitClient from "./CommitClient";
import { prisma } from "@/lib/prisma";
import { isCommitSlug, resolveMerchantDisplayName } from "@/lib/merchants/identity";

type PageProps = {
    params: Promise<{ merchantAddress: string }>;
    searchParams: Promise<{ amount?: string; successUrl?: string; cancelUrl?: string }>;
};

const WALLET_RE = /^0x[a-f0-9]{40}$/;

const getMerchant = cache(async (identifier: string) => {
    const normalized = identifier.trim().toLowerCase();
    const merchantData = isCommitSlug(normalized)
        ? await prisma.merchant.findUnique({ where: { commitSlug: normalized } })
        : WALLET_RE.test(normalized)
            ? await prisma.merchant.findUnique({ where: { walletAddress: normalized } })
            : null;

    if (!merchantData) return null;
    return {
        address: merchantData.walletAddress,
        commitSlug: merchantData.commitSlug,
        name: resolveMerchantDisplayName(merchantData.displayName),
        alias: null,
        verified: merchantData.verified,
        tier: merchantData.tier,
    };
});

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
    if (!merchant) notFound();

    return (
        <CommitClient
            merchantAddress={merchant.address}
            commitSlug={merchant.commitSlug}
            initialMerchant={merchant}
            initialAmount={amount || "2.00"}
            successUrl={successUrl}
            cancelUrl={cancelUrl}
        />
    );
}
