import { NextResponse } from "next/server";

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

const dashboardBaseUrl = normalizePublicUrl(process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL) || "https://www.subscriptonarc.com";

export function merchantPayoutWalletMissingResponse() {
    return NextResponse.json({
        error: "merchant_payout_wallet_missing",
        message: "Your API key is authenticated, but you must link a payout destination wallet before creating live checkout sessions.",
        resolution_url: `${dashboardBaseUrl}/dashboard?tab=settings`,
        docs_url: `${dashboardBaseUrl}/docs#merchant_payout_wallet_missing`,
    }, { status: 403 });
}

export function isConfiguredPayoutDestination(value: string | null | undefined) {
    return !!value && value.trim() !== "" && value !== "0x0000000000000000000000000000000000000000";
}

export function getSecretKeyMode(secretKey: string) {
    if (secretKey.startsWith("sk_test_")) return "test";
    if (secretKey.startsWith("sk_live_")) return "live";
    return "unknown";
}
