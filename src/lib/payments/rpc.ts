import { ethers } from "ethers";

const RPC_ENDPOINTS = [
    process.env.RPC_URL || "https://rpc.testnet.arc.network",
    process.env.RPC_FALLBACK_URL_1 || "https://rpc.testnet.arc.network",
    process.env.RPC_FALLBACK_URL_2 || "https://rpc.testnet.arc.network"
];

/* Exposes a wrapper function that retries operations across providers sequentially if a network or endpoint-specific error occurs */
export async function executeWithRpcFallback<T>(
    operation: (provider: ethers.JsonRpcProvider) => Promise<T>
): Promise<T> {
    let lastError: any = null;
    let failoverCount = 0;

    for (let i = 0; i < RPC_ENDPOINTS.length; i++) {
        const url = RPC_ENDPOINTS[i];
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

            return result;
        } catch (err: any) {
            const errorMessage = (err.message || "").toLowerCase();
            console.warn(`RPC lookup attempt failed on endpoint ${url}: ${errorMessage}`);

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

            failoverCount++;
            lastError = err;
        }
    }

    /* Observability alert trigger: all endpoints exhausted */
    console.error(`[ALERT] rpc_failovers count ${failoverCount} exceeded critical threshold. Primary and backup RPC endpoints are fully down.`);
    throw lastError || new Error("All configured RPC endpoints failed.");
}
