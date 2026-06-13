/* Maps standard ISO 2-letter country codes to local fiat tickers */
export const currencyMap: Record<string, string> = {
    US: "USD",
    GB: "GBP",
    NG: "NGN",
    EU: "EUR",
    CA: "CAD",
    AU: "AUD",
    JP: "JPY",
    IN: "INR",
    CN: "CNY",
    BR: "BRL",
    ZA: "ZAR",
    AT: "EUR",
    BE: "EUR",
    CY: "EUR",
    EE: "EUR",
    FI: "EUR",
    FR: "EUR",
    DE: "EUR",
    GR: "EUR",
    IE: "EUR",
    IT: "EUR",
    LV: "EUR",
    LT: "EUR",
    LU: "EUR",
    MT: "EUR",
    NL: "EUR",
    PT: "EUR",
    SK: "EUR",
    SI: "EUR",
    ES: "EUR",
    HR: "EUR",
    DEFAULT: "USD"
};

export function getCurrencyForCountry(countryCode: string | null | undefined): string {
    if (!countryCode) {
        return "USD";
    }
    const upperCode = countryCode.toUpperCase();
    return currencyMap[upperCode] || currencyMap.DEFAULT;
}
