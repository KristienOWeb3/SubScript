import { NextResponse } from "next/server";
import { getFiatOnrampConfig } from "@/lib/fiat-onramp/config";
import { fundingErrorResponse, requireFundingUser } from "@/lib/fiat-onramp/route";
import { enforceFundingRateLimit } from "@/lib/fiat-onramp/rate-limit";
import { serializeFundingIntent } from "@/lib/fiat-onramp/serialize";
import { simulateFundingIntent } from "@/lib/fiat-onramp/service";

type RouteContext = {
    params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
    const auth = await requireFundingUser(request.headers);
    if (auth.response) return auth.response;

    try {
        await enforceFundingRateLimit(auth.wallet, "simulate");
        const { id } = await context.params;
        const config = getFiatOnrampConfig();
        const intent = await simulateFundingIntent({
            walletAddress: auth.wallet,
            id,
            config,
        });
        return NextResponse.json({
            mode: config.mode,
            chainId: config.chainId,
            intent: serializeFundingIntent(intent),
        });
    } catch (error) {
        return fundingErrorResponse(error, "simulate");
    }
}
