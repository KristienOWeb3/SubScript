import { randomUUID } from "node:crypto";
import { ethers } from "ethers";
import { encryptPrivateKey } from "@/lib/crypto";
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
 * @param allowCircle  pass false to force the legacy path (e.g. offline mode, where Circle's network
 *               API is unavailable and only an encrypted key can be persisted).
 */
export async function provisionEmbeddedWallet(opts: { refId: string; allowCircle?: boolean }): Promise<ProvisionedWallet> {
    const allowCircle = opts.allowCircle ?? true;

    if (allowCircle && shouldProvisionCircleWallet()) {
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

    /* Fail closed: if the operator selected Circle custody (WALLET_PROVIDER=circle) but Circle is
       not fully configured, do NOT silently fall back to generating a raw private key — that
       reintroduces the single-WALLET_ENCRYPTION_KEY crown-jewel risk the cutover exists to remove.
       Offline mode (allowCircle=false) is the one sanctioned legacy path — Circle needs the network,
       and only an encrypted key can be persisted offline — so it is exempt. */
    if (allowCircle && isCircleProviderSelected()) {
        throw new Error(
            "WALLET_PROVIDER=circle but Circle custody is not fully configured " +
            "(need CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, and CIRCLE_ARC_WALLET_SET_ID). " +
            "Refusing to fall back to legacy raw-key generation."
        );
    }

    const legacy = ethers.Wallet.createRandom();
    return {
        address: legacy.address.toLowerCase(),
        encryptedPrivateKey: encryptPrivateKey(legacy.privateKey),
        circleWalletId: null,
    };
}
