import { fundingUnavailableResponse } from "@/lib/fiat-onramp/route";

export function GET() {
    return fundingUnavailableResponse();
}
