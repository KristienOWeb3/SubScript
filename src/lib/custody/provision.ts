import { randomUUID } from "node:crypto";
import { pgMaybeOne, pgQuery } from "@/lib/serverPg";
import { isCircleCustodyConfigured, createEmbeddedCircleWallet } from "@/lib/circle/devWallets";
import { isCircleProviderSelected } from "@/lib/custody/walletProvider";

/*
 * New-embedded-wallet provisioning (Phase 1 Stage 2b cutover).
 *
 * Decides which custody backend a *newly created* wallet uses. Existing wallets are unaffected —
 * they keep resolving by whether they hold an encrypted key or a circle_wallet_id (see custody seam).
 *
 * Flag-gated: Circle only when WALLET_PROVIDER=circle AND Circle is fully configured (api key,
 * entity secret, wallet set). Otherwise, legacy EOA is no longer supported and throwing an error.
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
    return isCircleProviderSelected()
        && isCircleCustodyConfigured()
        && !!process.env.CIRCLE_ARC_WALLET_SET_ID?.trim();
}

/*
 * Durable idempotency: mint one UUID per ref_id and reuse it on every retry. Circle dedupes
 * wallet creation on the idempotency key, so a signup that died between Circle's create and our
 * user_embedded_wallets insert re-requests the SAME wallet instead of minting an orphan.
 * The ON CONFLICT no-op update makes the RETURNING clause yield the previously stored key.
 */
async function durableIdempotencyKey(refId: string): Promise<string> {
    const row = await pgMaybeOne<{ idempotency_key: string }>(
        `insert into circle_wallet_provisioning (ref_id, idempotency_key)
         values ($1, $2)
         on conflict (ref_id) do update set updated_at = now()
         returning idempotency_key`,
        [refId, randomUUID()]
    );
    if (!row?.idempotency_key) {
        throw new Error("Failed to persist the Circle provisioning idempotency key.");
    }
    return row.idempotency_key;
}

/**
 * Provision a new embedded wallet.
 * @param refId  stable, non-PII application id for the user (e.g. a hash of their email), attached
 *               to the Circle wallet for reconciliation.
 */
export async function provisionEmbeddedWallet(opts: { refId: string }): Promise<ProvisionedWallet> {
    if (shouldProvisionCircleWallet()) {
        const wallet = await createEmbeddedCircleWallet({
            refId: opts.refId,
            idempotencyKey: await durableIdempotencyKey(opts.refId),
            name: "SubScript embedded wallet",
        });
        /* Best-effort bookkeeping for reconciliation; provisioning already succeeded. */
        await pgQuery(
            `update circle_wallet_provisioning
                set circle_wallet_id = $2, wallet_address = $3, updated_at = now()
              where ref_id = $1`,
            [opts.refId, wallet.walletId, wallet.address]
        ).catch((err) => {
            console.error("[custody] failed to record provisioned Circle wallet:", err?.message || err);
        });
        return { address: wallet.address, encryptedPrivateKey: null, circleWalletId: wallet.walletId };
    }

    throw new Error(
        "Circle custody is not configured, and legacy raw-key generation is permanently disabled."
    );
}
