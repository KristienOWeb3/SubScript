/* The ACTIVE Arc chain per NEXT_PUBLIC_ENVIRONMENT — kept dependency-free because this
   message format is shared verbatim by client and server signature verification. */
const ACTIVE_ARC_CHAIN_ID = process.env.NEXT_PUBLIC_ENVIRONMENT === "mainnet" ? 5_042_001 : 5_042_002;

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
        `Chain ID: ${ACTIVE_ARC_CHAIN_ID}`,
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
