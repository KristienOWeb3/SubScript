/**
 * Maps raw blockchain, RPC, provider, or server errors into clear, actionable,
 * human-readable error messages for users and merchants.
 *
 * Ensures internal technical strings (such as "Execution intent not allowlisted for embedded wallets")
 * never reach customer-facing modals or banners.
 */
export function formatWalletError(error: unknown): string {
    if (!error) return "An unexpected error occurred. Please try again.";

    const message = error instanceof Error ? error.message : typeof error === "string" ? error : String(error);
    const lower = message.toLowerCase();

    // 1. Embedded wallet allowlist & execution errors
    if (lower.includes("not allowlisted for embedded wallets") || lower.includes("action is not allowlisted")) {
        return "This action is not available for embedded wallets.";
    }

    // 2. User rejected transaction
    if (
        lower.includes("user rejected") ||
        lower.includes("action_rejected") ||
        lower.includes("rejected the request") ||
        lower.includes("user denied")
    ) {
        return "Transaction was cancelled in your wallet.";
    }

    // 3. Insufficient balance or gas
    if (lower.includes("insufficient funds") || lower.includes("exceeds balance") || lower.includes("gas required exceeds allowance")) {
        return "Insufficient USDC balance or gas to complete this transaction.";
    }

    // 4. Nonce or sequencing conflict
    if (lower.includes("nonce too low") || lower.includes("replacement transaction underpriced")) {
        return "A pending transaction conflict occurred. Please wait a moment and try again.";
    }

    // 5. Network connectivity
    if (lower.includes("network error") || lower.includes("failed to fetch") || lower.includes("fetch failed")) {
        return "Network connectivity issue. Please check your connection and retry.";
    }

    // 6. Contract revert
    if (lower.includes("execution reverted") || lower.includes("transaction reverted")) {
        return "The transaction was reverted on-chain. Please verify parameters and retry.";
    }

    // 7. Rate limit
    if (lower.includes("rate limit") || lower.includes("too many requests") || lower.includes("429")) {
        return "Too many requests. Please wait a few seconds before trying again.";
    }

    // 8. Timeout
    if (lower.includes("timeout") || lower.includes("timed out")) {
        return "Transaction timed out. Please check your transaction history before retrying.";
    }

    // Default clean output
    return message;
}
