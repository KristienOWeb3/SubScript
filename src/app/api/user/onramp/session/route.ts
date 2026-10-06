import { NextResponse } from "next/server";
import { createOnrampServerKit, KitError } from "@circle-fin/onramp-kit/server";
import { getSessionWallet } from "@/lib/auth";
import { getAccountKycTier } from "@/lib/kyc/tier";
import { getOnrampConfig } from "@/lib/onramp/config";

export const runtime = "nodejs";
export const maxDuration = 15;

function json(body: unknown, status = 200) {
    return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
    try {
        const origin = request.headers.get("origin");
        if (!origin || origin !== new URL(request.url).origin) {
            return json({ error: "Please start funding from this platform." }, 403);
        }
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) return json({ error: "Please sign in to buy USDC." }, 401);
        const config = getOnrampConfig();
        if (!config) return json({ error: "Buying USDC is not available yet. You can still deposit USDC on-chain." }, 503);
        const { tier } = await getAccountKycTier(wallet);
        if (tier < 1) return json({ error: "Please verify your email before buying USDC." }, 403);
        const body = await request.json().catch(() => null);
        if (!body || typeof body.destinationAddress !== "string" ||
            !/^0x[a-fA-F0-9]{40}$/.test(wallet) ||
            body.destinationAddress.toLowerCase() !== wallet.toLowerCase()) {
            return json({ error: "The funding wallet must match your signed-in wallet. Please reopen Deposit." }, 400);
        }
        // Destination, identity, and assets are always chosen by the server.
        const session = await createOnrampServerKit(config).createSession({
            appUserId: wallet.toLowerCase(),
            destinationAddress: wallet.toLowerCase(),
            destinationChain: "Arc",
            assets: { tokens: ["USDC"], chains: ["arc"] },
        });
        return json({ session, widgetBaseUrl: config.widgetBaseUrl, canEmbed: Boolean(config.referrerDomain) });
    } catch (error) {
        // Do not log SDK errors: upstream context may contain session credentials.
        const status = error instanceof KitError && error.type === "RATE_LIMIT" ? 429 : 502;
        return json({ error: status === 429
            ? "Too many funding requests. Please wait and try again."
            : "Arc Onramp is temporarily unavailable. Please try again later." }, status);
    }
}
