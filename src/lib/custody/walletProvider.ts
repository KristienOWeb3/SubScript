/* Single source of truth for reading the configured wallet-custody provider.
 *
 * WALLET_PROVIDER selects the backend for newly provisioned embedded wallets ("circle" for Circle
 * MPC, anything else = legacy raw-key). Both the provisioning gate (provision.ts) and the boot-time
 * config check (ops/configCheck.ts) must interpret it identically — a value like "Circle" or
 * " circle " must not pass one check and fail the other — so the normalization lives here, once.
 * Intentionally dependency-free so it can be imported at boot without pulling in ethers/pg/Circle SDK.
 */
export function getWalletProvider(): string {
    return (process.env.WALLET_PROVIDER || "legacy").trim().toLowerCase();
}

export function isCircleProviderSelected(): boolean {
    return getWalletProvider() === "circle";
}
