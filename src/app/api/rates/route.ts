import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { fetchExchangeRate, CURRENCY_SYMBOLS } from "@/lib/fx";
import { getCurrencyForCountry } from "@/lib/currencyMap";

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        let currency = searchParams.get("currency") || "";

        // If currency is not specified, detect from geo-IP country header
        if (!currency) {
            const headersList = await headers();
            const country =
                headersList.get("x-vercel-ip-country") ||
                headersList.get("cf-ipcountry") ||
                headersList.get("x-country-code") ||
                headersList.get("x-user-country") ||
                "US";
            currency = getCurrencyForCountry(country);
        }

        const upperCurrency = currency.toUpperCase();
        const rate = await fetchExchangeRate(upperCurrency);
        const symbol = CURRENCY_SYMBOLS[upperCurrency] || upperCurrency;

        return NextResponse.json({
            success: true,
            currency: upperCurrency,
            symbol,
            rate
        });
    } catch (err: any) {
        console.error("Rates API error:", err);
        return NextResponse.json({
            success: false,
            error: err.message || "Failed to resolve rates"
        }, { status: 500 });
    }
}
