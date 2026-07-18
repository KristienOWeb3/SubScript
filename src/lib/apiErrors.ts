import { NextResponse } from "next/server";
import { resolveSecretKeyMode } from "@/lib/apiKeys";

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

/**
 * Machine-readable error envelope for every non-2xx API response:
 *   { error, code, message, request_id, doc_url }
 * `error` stays the human-readable string older integrations already parse; `code` is the stable
 * identifier agents branch on. `request_id` lets a merchant quote one opaque ID in a support
 * request instead of us ever echoing ORM/DB internals.
 */
export function apiError(args: {
    status: number;
    code: string;
    message: string;
    requestId?: string;
    docUrl?: string;
}) {
    return NextResponse.json({
        error: args.message,
        code: args.code,
        message: args.message,
        request_id: args.requestId ?? crypto.randomUUID(),
        doc_url: args.docUrl ?? `${dashboardBaseUrl}/docs#errors`,
    }, { status: args.status });
}

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
    const mode = resolveSecretKeyMode(secretKey);
    return mode === "TEST" ? "test" : mode === "LIVE" ? "live" : "unknown";
}
