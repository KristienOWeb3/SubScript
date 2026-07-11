const ARC_TESTNET_CHAIN_ID = 5_042_002;

export function buildWalletAuthMessage(args: {
    address: string;
    nonce: string;
    domain: string;
    uri: string;
}) {
    return [
        `${args.domain} wants you to sign in to SubScript with your Ethereum account:`,
        args.address.toLowerCase(),
        "",
        "Sign in to SubScript. This request will not trigger a blockchain transaction or cost gas.",
        "",
        `URI: ${args.uri}`,
        `Chain ID: ${ARC_TESTNET_CHAIN_ID}`,
        `Nonce: ${args.nonce}`,
    ].join("\n");
}

export function walletAuthRequestContext(request: Request) {
    const requestUrl = new URL(request.url);
    const forwardedHost = (request.headers.get("x-forwarded-host") || "").split(",")[0].trim();
    const forwardedProto = (request.headers.get("x-forwarded-proto") || "").split(",")[0].trim();
    const domain = forwardedHost || request.headers.get("host") || requestUrl.host;
    const protocol = forwardedProto === "http" || forwardedProto === "https"
        ? forwardedProto
        : requestUrl.protocol.replace(":", "");
    return { domain, uri: `${protocol}://${domain}` };
}
