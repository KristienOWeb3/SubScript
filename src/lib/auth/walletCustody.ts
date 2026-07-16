import { pgMaybeOne } from "@/lib/serverPg";

export type WalletCustody = {
    provider: string | null;
    hasCircleWallet: boolean;
    hasEncryptedKey: boolean;
};

/**
 * Whether SubScript can sign for `wallet` server-side.
 *
 * This is the test /api/execute-tx already applies before it will sign, so every surface that offers
 * a custodial action — the hosted checkout's "pay from your SubScript wallet" button, subscriptions —
 * agrees with the signer instead of inferring custody from the provider label.
 *
 * The label alone is not reliable. /api/user/email stamps 'external_wallet_email_otp' onto whatever
 * row a wallet already has, and the custody cutover (lib/ops/migrateWallets) moves wallets to Circle
 * while leaving older labels untouched, so rows exist that are Circle-custodied yet still labelled
 * external. Only 'external_wallet' proper is honoured as an explicit opt-out, matching every other
 * consumer of this column.
 */
export function isCustodialWallet(custody: WalletCustody | null | undefined): boolean {
    if (!custody) return false;
    if (custody.provider === "external_wallet") return false;
    return custody.hasCircleWallet || custody.hasEncryptedKey;
}

/** Reads custody markers as booleans — the key ciphertext itself never needs to leave Postgres. */
export async function getWalletCustody(wallet: string): Promise<WalletCustody | null> {
    return pgMaybeOne<WalletCustody>(
        `select provider,
                circle_wallet_id is not null      as "hasCircleWallet",
                encrypted_private_key is not null as "hasEncryptedKey"
           from user_embedded_wallets
          where wallet_address = $1
          limit 1`,
        [wallet.toLowerCase()],
    );
}
