import { randomUUID } from "node:crypto";
import { ethers } from "ethers";
import { encryptPrivateKey } from "@/lib/crypto";
import { isCircleCustodyConfigured, createEmbeddedCircleWallet } from "@/lib/circle/devWallets";

/*
 * New-embedded-wallet provisioning (Phase 1 Stage 2b cutover).
 *
 * Decides which custody backend a *newly created* wallet uses. Existing wallets are unaffected —
 * they keep resolving by whether they hold an encrypted key or a circle_wallet_id (see custody seam).
 *
 * Flag-gated: Circle only when WALLET_PROVIDER=circle AND Circle is fully configured (api key,
 * entity secret, wallet set). Otherwise legacy (raw key encrypted with WALLET_ENCRYPTION_KEY). So
 * prod is unchanged until the flag is set on a deployment with the Circle env in place.
 */

export interface ProvisionedWallet {
    /** Lowercased on-chain address. */
    address: string;
    /** Legacy backend only (null for Circle). */
    encryptedPrivateKey: string | null;
    /** Circle backend only (null for legacy). */
    circleWalletId: string | null;
}

export function shouldProvisionCircleWallet(): boolean {
    return process.env.WALLET_PROVIDER === "circle"
        && isCircleCustodyConfigured()
        && !!process.env.CIRCLE_ARC_WALLET_SET_ID?.trim();
}

/**
 * Provision a new embedded wallet.
 * @param refId  stable, non-PII application id for the user (e.g. a hash of their email), attached
 *               to the Circle wallet for reconciliation.
 * @param allowCircle  pass false to force the legacy path (e.g. offline mode, where Circle's network
 *               API is unavailable and only an encrypted key can be persisted).
 *
 * NOTE: the Circle idempotencyKey is generated fresh here. Durable idempotency (persisting the key
 * and reusing it on a retried, partially-failed signup to avoid an orphaned second Circle wallet)
 * is a follow-up — the SDK supports it; wiring the persistence needs a store keyed by refId.
 */
export async function provisionEmbeddedWallet(opts: { refId: string; allowCircle?: boolean }): Promise<ProvisionedWallet> {
    if ((opts.allowCircle ?? true) && shouldProvisionCircleWallet()) {
        const wallet = await createEmbeddedCircleWallet({
            refId: opts.refId,
            idempotencyKey: randomUUID(),
            name: "SubScript embedded wallet",
        });
        return { address: wallet.address, encryptedPrivateKey: null, circleWalletId: wallet.walletId };
    }
    const legacy = ethers.Wallet.createRandom();
    return {
        address: legacy.address.toLowerCase(),
        encryptedPrivateKey: encryptPrivateKey(legacy.privateKey),
        circleWalletId: null,
    };
}
