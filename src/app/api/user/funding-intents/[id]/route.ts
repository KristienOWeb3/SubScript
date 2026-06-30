import { NextResponse } from "next/server";
import { getFiatOnrampConfig } from "@/lib/fiat-onramp/config";
import { fundingErrorResponse, requireFundingUser } from "@/lib/fiat-onramp/route";
import { serializeFundingIntent } from "@/lib/fiat-onramp/serialize";
import { getFundingIntent } from "@/lib/fiat-onramp/service";

type RouteContext = {
    params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
    const auth = await requireFundingUser(request.headers);
    if (auth.response) return auth.response;

    try {
        const { id } = await context.params;
        const config = getFiatOnrampConfig();
        const intent = await getFundingIntent(auth.wallet, id);
        return NextResponse.json({
            mode: config.enabled ? config.mode : "disabled",
            chainId: config.chainId,
            intent: serializeFundingIntent(intent),
        });
    } catch (error) {
        return fundingErrorResponse(error, "read");
    }
}
