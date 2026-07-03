import { ethers } from "ethers";
import { pgMaybeOne } from "@/lib/serverPg";
import { decryptPrivateKey } from "@/lib/crypto";

/*
 * Wallet custody provider abstraction (Phase 1, Stage 1).
 *
 * Every server-side signing operation for a *user embedded wallet* funnels through this seam so
 * the underlying custody model can change without touching call sites. Two backends:
 *
 *   - "legacy": the original model — a raw secp256k1 key encrypted at rest with the single
 *     WALLET_ENCRYPTION_KEY and decrypted here into an ethers.Wallet. This is the crown-jewel
 *     risk we are migrating away from (one leaked env secret decrypts every user's key).
 *   - "circle": Circle developer-controlled (MPC) wallet — no extractable key, signing happens
 *     via Circle's API. Implemented in Stage 2; stubbed here so the seam and routing exist first.
 *
 * A wallet is Circle-backed iff it has a circle_wallet_id; otherwise it's legacy. New wallets stay
 * legacy until Stage 2 flips creation, so in Stage 1 every wallet resolves to LegacyCustody and
 * behavior is byte-for-byte unchanged. The Circle branch is never reached until Circle wallets are
 * actually created — and each signing flow is migrated to Circle's high-level ops before that.
 *
 * NOTE: ephemeral payment-link receiver wallets are a different lifecycle and are intentionally
 * out of scope here — see src/app/api/payment-links/verify/route.ts.
 */

export type CustodyKind = "legacy" | "circle";

export interface WalletCustody {
    readonly address: string;
    readonly kind: CustodyKind;
    /** Whether the raw private key can be exported (true only for legacy; MPC keys are not extractable). */
    readonly canExportRawKey: boolean;
    /** An ethers signer bound to the given provider. Legacy only; Circle uses high-level ops (Stage 2). */
    getEthersSigner(provider: ethers.Provider): Promise<ethers.Wallet>;
    /** The raw private key, for export / raw-tx flows. Legacy only. */
    getRawPrivateKey(): Promise<string>;
}

class LegacyCustody implements WalletCustody {
    readonly kind = "legacy" as const;
    readonly canExportRawKey = true;
    constructor(readonly address: string, private readonly encryptedPrivateKey: string) {}

    async getEthersSigner(provider: ethers.Provider): Promise<ethers.Wallet> {
        const signer = new ethers.Wallet(decryptPrivateKey(this.encryptedPrivateKey), provider);
        if (signer.address.toLowerCase() !== this.address.toLowerCase()) {
            throw new Error("Stored key does not match the requested wallet address.");
        }
        return signer;
    }

    async getRawPrivateKey(): Promise<string> {
        return decryptPrivateKey(this.encryptedPrivateKey);
    }
}

class CircleCustody implements WalletCustody {
    readonly kind = "circle" as const;
    readonly canExportRawKey = false;
    constructor(readonly address: string, readonly circleWalletId: string) {}

    async getEthersSigner(): Promise<ethers.Wallet> {
        /* Circle MPC wallets never expose an ethers-compatible signer. Each flow must be migrated
           to Circle's contract-execution / signing API (Stage 2) before Circle wallets are created,
           so this path is not reachable in production yet. */
        throw new Error("Circle-backed wallets do not expose a raw signer; use the custody execute/sign operations (Stage 2).");
    }

    async getRawPrivateKey(): Promise<never> {
        throw new Error("Circle-backed wallets are MPC-secured; the private key cannot be exported.");
    }
}

interface EmbeddedWalletRow {
    encrypted_private_key: string | null;
    circle_wallet_id: string | null;
}

/**
 * Resolve the custody backend for a user embedded wallet. Circle-backed iff circle_wallet_id is set.
 * Throws if the wallet has no server-held custody (e.g. an external/browser wallet).
 */
export async function getWalletCustody(walletAddress: string): Promise<WalletCustody> {
    const address = walletAddress.toLowerCase();
    const record = await pgMaybeOne<EmbeddedWalletRow>(
        "select encrypted_private_key, circle_wallet_id from user_embedded_wallets where wallet_address = $1 limit 1",
        [address]
    );

    if (record?.circle_wallet_id) {
        return new CircleCustody(address, record.circle_wallet_id);
    }
    if (record?.encrypted_private_key) {
        return new LegacyCustody(address, record.encrypted_private_key);
    }
    throw new Error("This wallet has no server-held key. Connect a browser wallet to sign transactions.");
}
