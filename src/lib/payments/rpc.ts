import { ethers } from "ethers";

const IS_ARC_MAINNET = process.env.NEXT_PUBLIC_ENVIRONMENT === "mainnet";
const DEFAULT_ARC_RPC = IS_ARC_MAINNET
    ? undefined
    : "https://rpc.testnet.arc.network";
const ARC_TESTNET_PUBLIC_FALLBACKS = IS_ARC_MAINNET
    ? []
    : ["https://rpc.blockdaemon.testnet.arc.network"];

const RPC_ENDPOINTS = Array.from(new Set([
    process.env.ARC_RPC_PRIMARY || process.env.RPC_URL || DEFAULT_ARC_RPC,
    process.env.ARC_RPC_SECONDARY,
    process.env.RPC_FALLBACK_URL_1,
    process.env.RPC_FALLBACK_URL_2,
    ...ARC_TESTNET_PUBLIC_FALLBACKS,
].filter((url): url is string => Boolean(url))));

/* Maximum number of retry attempts for rate-limited (429) responses */
const MAX_RATE_LIMIT_RETRIES = 5;

/* Base delay in milliseconds for exponential backoff on rate-limited responses */
const BASE_RATE_LIMIT_DELAY_MS = 1000;

/* Helper that pauses execution for the specified number of milliseconds */
async function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/* Arc returns HTTP 429 with JSON-RPC code -32011 and "request limit reached".
   ethers wraps that payload inside UNKNOWN_ERROR, so inspect both the wrapper
   message and nested provider error instead of checking only top-level 429s. */
function isRateLimitError(err: any): boolean {
    const nested = [
        err,
        err?.error,
        err?.info,
        err?.info?.error,
        err?.cause,
        err?.cause?.error,
    ].filter(Boolean);
    const messages = nested
        .map((candidate) => String(candidate?.message || ""))
        .join(" ")
        .toLowerCase();
    const codes = nested.flatMap((candidate) => [
        candidate?.code,
        candidate?.status,
        candidate?.statusCode,
    ]);

    return (
        messages.includes("429") ||
        messages.includes("too many requests") ||
        messages.includes("rate limit") ||
        messages.includes("rate-limit") ||
        messages.includes("request limit") ||
        codes.some((code) => Number(code) === 429 || Number(code) === -32011)
    );
}

/* Exposes a wrapper function that retries operations across providers sequentially if a network or endpoint-specific error occurs */
export async function executeWithRpcFallback<T>(
    operation: (provider: ethers.JsonRpcProvider) => Promise<T>
): Promise<{ result: T; rpcEndpoint: string }> {
    let lastError: any = null;
    let failoverCount = 0;

    for (let i = 0; i < RPC_ENDPOINTS.length; i++) {
        const url = RPC_ENDPOINTS[i];

        /* Attempt operation on this endpoint with rate-limit retries */
        for (let retryAttempt = 0; retryAttempt <= MAX_RATE_LIMIT_RETRIES; retryAttempt++) {
            try {
                const start = Date.now();
                const provider = new ethers.JsonRpcProvider(url);
                
                /* Test connection to prevent executing operation on a dead node */
                await provider.getNetwork();
                
                const result = await operation(provider);
                const latency = Date.now() - start;

                /* Structured observability logs for provider diagnostics */
                console.log(`[metric] rpc_provider_used: ${url}, rpc_latency: ${latency}ms`);
                
                if (failoverCount > 0) {
                    console.log(`[metric] rpc_failovers: ${failoverCount}`);
                }

                if (retryAttempt > 0) {
                    console.log(`[metric] rpc_rate_limit_retries: ${retryAttempt}`);
                }

                return { result, rpcEndpoint: url };
            } catch (err: any) {
                const errorMessage = (err.message || "").toLowerCase();

                /* A different provider is faster and less likely to share the same quota.
                   Exhaust distinct endpoints before sleeping on the final provider. */
                if (isRateLimitError(err) && i < RPC_ENDPOINTS.length - 1) {
                    console.warn(`[rpc] Rate limited on ${url}. Failing over to the next Arc provider.`);
                    failoverCount++;
                    lastError = err;
                    break;
                }

                /* If every distinct endpoint has been tried, back off on the final one. */
                if (isRateLimitError(err) && retryAttempt < MAX_RATE_LIMIT_RETRIES) {
                    const backoffMs = BASE_RATE_LIMIT_DELAY_MS * Math.pow(2, retryAttempt);
                    const jitter = Math.floor(Math.random() * 500);
                    const totalDelay = backoffMs + jitter;
                    console.warn(
                        `[rpc] Rate limited on ${url}. Retry ${retryAttempt + 1}/${MAX_RATE_LIMIT_RETRIES} after ${totalDelay}ms backoff.`
                    );
                    await sleep(totalDelay);
                    continue;
                }

                /* Operation-aware check: do not retry deterministic VM revert errors */
                const isDeterministic = 
                    errorMessage.includes("execution reverted") ||
                    errorMessage.includes("invalid argument") ||
                    errorMessage.includes("calldata") ||
                    errorMessage.includes("chain id") ||
                    errorMessage.includes("insufficient balance") ||
                    errorMessage.includes("reverted");

                if (isDeterministic) {
                    console.error(`Deterministic transaction verification error. Aborting RPC failover chain.`);
                    throw err;
                }

                console.warn(`RPC lookup attempt failed on endpoint ${url}: ${errorMessage}`);
                failoverCount++;
                lastError = err;
                break; /* Break inner retry loop, move to next RPC endpoint */
            }
        }
    }

    /* Observability alert trigger: all endpoints exhausted */
    console.error(`[ALERT] rpc_failovers count ${failoverCount} exceeded critical threshold. Primary and backup RPC endpoints are fully down.`);
    throw lastError || new Error("All configured RPC endpoints failed.");
}

/*
 * Selects a healthy provider for a write transaction without wrapping the
 * signed write itself in retry/failover logic. Retrying after a provider error
 * can duplicate side effects if the first endpoint accepted the transaction
 * but failed before returning cleanly.
 */
export async function getRpcProviderForWrite(): Promise<{ provider: ethers.JsonRpcProvider; rpcEndpoint: string }> {
    let lastError: any = null;

    for (const url of RPC_ENDPOINTS) {
        for (let retryAttempt = 0; retryAttempt <= MAX_RATE_LIMIT_RETRIES; retryAttempt++) {
            try {
                const provider = new ethers.JsonRpcProvider(url);
                await provider.getNetwork();
                return { provider, rpcEndpoint: url };
            } catch (err: any) {
                lastError = err;

                if (isRateLimitError(err) && RPC_ENDPOINTS.indexOf(url) < RPC_ENDPOINTS.length - 1) {
                    console.warn(`[rpc-write] Rate limited on ${url}. Selecting the next Arc provider.`);
                    break;
                }

                if (isRateLimitError(err) && retryAttempt < MAX_RATE_LIMIT_RETRIES) {
                    const backoffMs = BASE_RATE_LIMIT_DELAY_MS * Math.pow(2, retryAttempt);
                    const jitter = Math.floor(Math.random() * 500);
                    await sleep(backoffMs + jitter);
                    continue;
                }

                break;
            }
        }
    }

    throw lastError || new Error("No healthy RPC endpoint available for transaction submission.");
}
