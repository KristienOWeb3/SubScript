import test from "node:test";
import assert from "node:assert/strict";
import { formatWalletError } from "../walletErrors.ts";

test("formatWalletError maps embedded wallet allowlist error cleanly", () => {
    const rawError = new Error("Execution intent not allowlisted for embedded wallets: CommitSubscription");
    const formatted = formatWalletError(rawError);
    assert.equal(formatted, "This action is not available for embedded wallets.");
});

test("formatWalletError maps user rejection across providers", () => {
    assert.equal(
        formatWalletError("User rejected the transaction"),
        "Transaction was cancelled in your wallet."
    );
    assert.equal(
        formatWalletError(new Error("ACTION_REJECTED")),
        "Transaction was cancelled in your wallet."
    );
    assert.equal(
        formatWalletError("user denied transaction signature"),
        "Transaction was cancelled in your wallet."
    );
});

test("formatWalletError maps insufficient funds cleanly", () => {
    assert.equal(
        formatWalletError(new Error("insufficient funds for transfer")),
        "Insufficient USDC balance or gas to complete this transaction."
    );
});

test("formatWalletError handles network and timeout errors", () => {
    assert.equal(
        formatWalletError(new Error("Failed to fetch")),
        "Network connectivity issue. Please check your connection and retry."
    );
    assert.equal(
        formatWalletError("Transaction timed out"),
        "Transaction timed out. Please check your transaction history before retrying."
    );
});

test("formatWalletError handles fallback gracefully", () => {
    assert.equal(
        formatWalletError(null),
        "An unexpected error occurred. Please try again."
    );
    assert.equal(
        formatWalletError("Custom specific business error"),
        "Custom specific business error"
    );
});
