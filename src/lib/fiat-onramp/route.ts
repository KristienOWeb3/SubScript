import { NextResponse } from "next/server";
import { FIAT_ONRAMP_UNAVAILABLE_REASON } from "./config";

export function fundingUnavailableResponse() {
    return NextResponse.json(
        {
            error: FIAT_ONRAMP_UNAVAILABLE_REASON,
            code: "FIAT_ONRAMP_UNAVAILABLE",
        },
        { status: 503 },
    );
}
