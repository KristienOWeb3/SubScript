export type FiatOnrampConfig = {
    mode: "disabled";
    enabled: false;
    unavailableReason: string;
};

type OnrampEnvironment = Record<string, string | undefined>;

export const FIAT_ONRAMP_UNAVAILABLE_REASON =
    "Bank-transfer funding is unavailable until Arc mainnet and a licensed live funding provider are integrated";

export function getFiatOnrampConfig(_env: OnrampEnvironment = process.env): FiatOnrampConfig {
    return {
        mode: "disabled",
        enabled: false,
        unavailableReason: FIAT_ONRAMP_UNAVAILABLE_REASON,
    };
}
