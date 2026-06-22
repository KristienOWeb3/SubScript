/* Fiat on-ramp configuration.
 *
 * SubScript does not yet run a native fiat -> USDC on-ramp. Until it does, users in any region are
 * guided to a reputable third-party on-ramp: they buy USDC with a card/bank and send it to their
 * SubScript deposit (EVM) address. Because the asset is USDC, Circle's CCTP can bridge it to Arc
 * even if the on-ramp delivers it on a different chain. This is instructional only — SubScript never
 * takes custody of fiat.
 */

export interface FiatOnrampProvider {
    name: string;
    url: string;
    note?: string;
}

/* ISO-3166-1 alpha-2 country codes where SubScript offers a NATIVE fiat on-ramp. Empty until the
   native on-ramp launches; every other region sees the external-on-ramp + CCTP guidance. Add codes
   here as native coverage rolls out. */
export const SUPPORTED_FIAT_REGIONS = new Set<string>([]);

export function isNativeFiatOnrampSupported(country: string | null | undefined): boolean {
    if (!country) return false;
    return SUPPORTED_FIAT_REGIONS.has(country.toUpperCase());
}

/* Reputable third-party fiat -> USDC on-ramps. Each lets a user buy USDC with a card or bank and
   withdraw to any EVM address. Edit freely as partnerships change. */
export const EXTERNAL_ONRAMP_PROVIDERS: FiatOnrampProvider[] = [
    { name: "Coinbase", url: "https://www.coinbase.com/", note: "Buy USDC, then withdraw to your address" },
    { name: "Transak", url: "https://global.transak.com/", note: "Card & bank · 100+ countries" },
    { name: "MoonPay", url: "https://www.moonpay.com/buy/usdc", note: "Card · Apple/Google Pay" },
    { name: "Ramp Network", url: "https://ramp.network/buy", note: "Card & bank transfer" },
];
