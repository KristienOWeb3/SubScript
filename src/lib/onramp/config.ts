type OnrampEnvironment = Record<string, string | undefined>;

export function getOnrampConfig(env: OnrampEnvironment = process.env) {
    if (env.ONRAMP_ENABLED !== "true" || !env.ONRAMP_API_KEY?.trim()) return null;
    const environment = env.ONRAMP_ENVIRONMENT?.trim() || "sandbox";
    if (environment !== "sandbox" && environment !== "production") {
        throw new Error("Invalid ONRAMP_ENVIRONMENT");
    }
    const mainnet = env.NEXT_PUBLIC_ENVIRONMENT?.trim().toLowerCase() === "mainnet";
    if ((environment === "production") !== mainnet) {
        throw new Error("Onramp environment must match the platform network");
    }
    const referrerDomain = env.ONRAMP_REFERRER_DOMAIN?.trim() || undefined;
    if (referrerDomain && !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(referrerDomain)) {
        throw new Error("ONRAMP_REFERRER_DOMAIN must be a bare hostname");
    }
    return {
        apiKey: env.ONRAMP_API_KEY.trim(),
        baseUrl: mainnet ? "https://api.circle.com" : "https://api-test.circle.com",
        widgetBaseUrl: mainnet ? "https://onramp.arc.io" : "https://onramp-sandbox.arc.io",
        referrerDomain,
        requestTimeoutMs: 10_000,
    };
}
