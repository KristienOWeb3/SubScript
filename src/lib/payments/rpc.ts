import { ethers } from "ethers";

const RPC_ENDPOINTS = Array.from(new Set([
    process.env.ARC_RPC_PRIMARY || process.env.RPC_URL || "https://rpc.testnet.arc.network",
    process.env.ARC_RPC_SECONDARY || process.env.RPC_FALLBACK_URL_1 || "https://rpc.testnet.arc.network",
    process.env.RPC_FALLBACK_URL_2 || "https://rpc.testnet.arc.network"
].filter(Boolean)));

/* Maximum number of retry attempts for rate-limited (429) responses */
const MAX_RATE_LIMIT_RETRIES = 5;

/* Base delay in milliseconds for exponential backoff on rate-limited responses */
const BASE_RATE_LIMIT_DELAY_MS = 1000;

/* Helper that pauses execution for the specified number of milliseconds */
async function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/* Determines if an error is a rate-limit (HTTP 429) error based on error message content */
function isRateLimitError(err: any): boolean {
    const message = (err?.message || "").toLowerCase();
    const code = err?.code || err?.status || 0;
    return (
        message.includes("429") ||
        message.includes("too many requests") ||
        message.includes("rate limit") ||
        message.includes("rate-limit") ||
        code === 429
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

                /* If this is a rate-limit error and we have retries left, back off and retry */
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
