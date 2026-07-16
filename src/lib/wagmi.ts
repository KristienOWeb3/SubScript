import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { defineChain } from "viem";
import { mainnet, base, sepolia, baseSepolia } from "viem/chains";

/* Arc network is selected by NEXT_PUBLIC_ENVIRONMENT ("mainnet" => Arc mainnet, anything else =>
   testnet), so the client targets the same chain the cutover env vars point the contracts at.
   Defaults to testnet, so current behaviour is unchanged until NEXT_PUBLIC_ENVIRONMENT=mainnet. */
const isArcMainnet = process.env.NEXT_PUBLIC_ENVIRONMENT === "mainnet";
const arcChainId = isArcMainnet ? 5042001 : 5042002;
const arcRpcUrl =
    process.env.NEXT_PUBLIC_ARC_RPC_PRIMARY ||
    process.env.NEXT_PUBLIC_ARC_RPC_URL ||
    (isArcMainnet ? "https://rpc.mainnet.arc.network" : "https://rpc.testnet.arc.network");

/* Exported as `arcTestnet` for backward-compatible imports; it is the ACTIVE Arc chain (mainnet or
   testnet) per NEXT_PUBLIC_ENVIRONMENT above. */
export const arcTestnet = defineChain({
    id: arcChainId,
    name: isArcMainnet ? "Arc" : "Arc Testnet",
    nativeCurrency: {
        name: "USDC",
        symbol: "USDC",
        /* Native USDC is 18 decimals at the RPC/EVM level (eth_getBalance for an 80-USDC
           wallet returns 80e18; gas prices are gwei-scale). Only the ERC-20 USDC interface
           uses 6 decimals. Declaring 6 here made wallets and native-balance formatting
           misread amounts by 1e12. */
        decimals: 18,
    },
    rpcUrls: {
        default: {
            http: [arcRpcUrl],
        },
    },
    blockExplorers: {
        default: {
            name: "Arc Explorer",
            url: isArcMainnet ? "https://arcscan.app" : "https://testnet.arcscan.app",
        },
    },
});

/* Arc's public RPC rate-limits per RPC *call* — roughly one per second per IP — answering the rest
   with HTTP 429 and a JSON-RPC body of `{ code: -32011, message: "request limit reached" }`. It
   counts the calls inside a JSON-RPC batch individually too, so batching buys nothing. Any page that
   reads more than one thing on mount therefore collides with itself.
   viem's own retry can't cover this: shouldRetry() keys off the JSON-RPC code whenever the body
   carries one, and -32011 is not in its retryable set, so the HTTP 429 never reaches its status
   check and `retryCount` is ignored. Retrying underneath viem, at the fetch layer, sidesteps that.
   A 429 means the call was rejected rather than executed, so this is safe for writes as well. */
const rateLimitRetryFetch: typeof fetch = async (input, init) => {
    let delay = 250;
    for (let attempt = 0; ; attempt++) {
        const response = await fetch(input, init);
        if (response.status !== 429 || attempt >= 5) return response;
        const retryAfterMs = Number(response.headers.get("retry-after")) * 1000;
        await new Promise((resolve) =>
            setTimeout(resolve, retryAfterMs > 0 ? Math.min(retryAfterMs, 8_000) : delay),
        );
        delay *= 2;
    }
};

const arcTransport = http(arcRpcUrl, { fetchFn: rateLimitRetryFetch, timeout: 20_000 });

export const config = createConfig({
    chains: [arcTestnet, mainnet, base, sepolia, baseSepolia],
    connectors: [injected({ shimDisconnect: true })],
    transports: {
        /* Both Arc chain ids map to the active RPC; only the selected one (arcChainId) is used. */
        5042002: arcTransport,
        5042001: arcTransport,
        1: http(),
        8453: http(),
        11155111: http(),
        84532: http(),
    },
    ssr: true,
});
