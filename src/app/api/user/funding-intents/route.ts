import { NextResponse } from "next/server";
import { getFiatOnrampConfig } from "@/lib/fiat-onramp/config";
import { badRequest } from "@/lib/fiat-onramp/errors";
import { parseNgnToKobo } from "@/lib/fiat-onramp/money";
import { fundingErrorResponse, requireFundingUser } from "@/lib/fiat-onramp/route";
import { enforceFundingRateLimit } from "@/lib/fiat-onramp/rate-limit";
import { serializeFundingIntent } from "@/lib/fiat-onramp/serialize";
import { createFundingIntent, listFundingIntents } from "@/lib/fiat-onramp/service";

export async function GET(request: Request) {
    const auth = await requireFundingUser(request.headers);
    if (auth.response) return auth.response;

    try {
        const config = getFiatOnrampConfig();
        if (!config.enabled) {
            return NextResponse.json({
                mode: "disabled",
                chainId: config.chainId,
                intents: [],
                unavailableReason: config.unavailableReason,
            });
        }
        const intents = await listFundingIntents(auth.wallet);
        return NextResponse.json({
            mode: config.mode,
            chainId: config.chainId,
            intents: intents.map(serializeFundingIntent),
        });
    } catch (error) {
        return fundingErrorResponse(error, "list");
    }
}

export async function POST(request: Request) {
    const auth = await requireFundingUser(request.headers);
    if (auth.response) return auth.response;

    try {
        await enforceFundingRateLimit(auth.wallet, "create");
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object" || Array.isArray(body)) {
            throw badRequest("Invalid request payload");
        }
        if (
            "destinationWallet" in body ||
            "walletAddress" in body ||
            "destinationChainId" in body
        ) {
            throw badRequest("Destination wallet and chain are derived from the authenticated session");
        }

        const config = getFiatOnrampConfig();
        const result = await createFundingIntent({
            walletAddress: auth.wallet,
            amountMinor: parseNgnToKobo((body as Record<string, unknown>).amountNgn),
            idempotencyKey: request.headers.get("idempotency-key"),
            config,
        });

        return NextResponse.json({
            mode: config.mode,
            chainId: config.chainId,
            intent: serializeFundingIntent(result.intent),
        }, { status: result.created ? 201 : 200 });
    } catch (error) {
        return fundingErrorResponse(error, "create");
    }
}
