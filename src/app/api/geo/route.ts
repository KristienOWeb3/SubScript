import { NextResponse } from "next/server";
import { isNativeFiatOnrampSupported } from "@/lib/fiatOnramp";

/* Surfaces the geolocation that middleware derives (x-user-country) to client components,
   plus whether a native fiat on-ramp is available for that region. */
export async function GET(request: Request) {
    const country = (request.headers.get("x-user-country") || "US").toUpperCase();
    return NextResponse.json({
        country,
        nativeFiatOnramp: isNativeFiatOnrampSupported(country),
    });
}
