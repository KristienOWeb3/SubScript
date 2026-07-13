import { pgMaybeOne } from "@/lib/serverPg";

export type VerifiedAccountEmail = {
    email: string;
    provider: string;
    verifiedAt: Date;
};

/**
 * Returns only email addresses whose ownership was proven by OTP or a trusted
 * identity provider. A populated legacy/customer email is deliberately not
 * enough to authorize a financial checkout.
 */
export async function getVerifiedAccountEmail(wallet: string): Promise<VerifiedAccountEmail | null> {
    return pgMaybeOne<VerifiedAccountEmail>(
        `select email,
                provider,
                email_verified_at as "verifiedAt"
           from user_embedded_wallets
          where wallet_address = $1
            and email is not null
            and email_verified_at is not null
          limit 1`,
        [wallet.toLowerCase()],
    );
}
