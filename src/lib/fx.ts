/* Utility to fetch exchange rates from public API with Next.js Time-Based Revalidation */
import { assertProviderRateLimit } from "@/lib/providerRateLimit";

export interface FxRatesResponse {
    result: string;
    base_code: string;
    rates: Record<string, number>;
}

export async function fetchExchangeRate(targetCurrency: string): Promise<number> {
    const target = targetCurrency.toUpperCase();
    if (target === "USD") {
        return 1.0;
    }

    try {
        assertProviderRateLimit({
            provider: "fx",
            key: "global",
            limit: 60,
            windowMs: 60 * 1000,
        });

        /* Fetch rates with 900 seconds (15 minutes) revalidation */
        const res = await fetch("https://open.er-api.com/v6/latest/USD", {
            next: { revalidate: 900 },
        });

        if (!res.ok) {
            throw new Error(`FX API responded with status: ${res.status}`);
        }

        const data = (await res.json()) as FxRatesResponse;
        
        if (data.result !== "success" || !data.rates) {
            throw new Error("Invalid response structure from FX API");
        }

        const rate = data.rates[target];
        if (rate === undefined || typeof rate !== "number") {
            throw new Error(`Exchange rate not found for currency: ${target}`);
        }

        return rate;
    } catch (error) {
        console.error(`[FX Oracle Error] Failed to fetch rate for ${targetCurrency}:`, error);
        /* Return 1.0 (USD) as fallback to prevent page crash */
        return 1.0;
    }
}
