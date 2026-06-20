type PgClient = {
    query: (sql: string, params?: any[]) => Promise<{ rows: any[] }>;
};

export type AccountEmailBinding = {
    walletAddress: string;
    provider: string | null;
    source: "embedded_wallet" | "customer_profile";
};

export class AccountEmailConflictError extends Error {
    status = 409;

    constructor(message = "This email is already associated with another SubScript account.") {
        super(message);
        this.name = "AccountEmailConflictError";
    }
}

export function normalizeAccountEmail(email: unknown): string | null {
    if (typeof email !== "string") return null;
    const trimmed = email.toLowerCase().trim();
    return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(trimmed) ? trimmed : null;
}

export function isWalletOnlyEmailBinding(binding: AccountEmailBinding | null | undefined) {
    return binding?.provider === "external_wallet" || binding?.source === "customer_profile";
}

export async function findAccountEmailBinding(client: PgClient, email: string): Promise<AccountEmailBinding | null> {
    const result = await client.query(
        `select wallet_address, provider, 'embedded_wallet' as source
           from user_embedded_wallets
          where lower(email) = lower($1)
         union all
         select wallet_address, null as provider, 'customer_profile' as source
           from customers
          where email is not null and lower(email) = lower($1)
         limit 1`,
        [email]
    );

    const row = result.rows[0];
    if (!row?.wallet_address) return null;

    return {
        walletAddress: String(row.wallet_address).toLowerCase(),
        provider: row.provider ? String(row.provider) : null,
        source: row.source === "customer_profile" ? "customer_profile" : "embedded_wallet",
    };
}

export async function assertAccountEmailAvailable(
    client: PgClient,
    email: string,
    allowedWalletAddress?: string | null
) {
    const allowedWallet = allowedWalletAddress?.toLowerCase() || null;

    if (!allowedWallet) {
        const binding = await findAccountEmailBinding(client, email);
        if (binding) throw new AccountEmailConflictError();
        return null;
    }

    const conflict = await client.query(
        `select wallet_address
           from user_embedded_wallets
          where lower(email) = lower($1)
            and lower(wallet_address) <> lower($2)
         union all
         select wallet_address
           from customers
          where email is not null
            and lower(email) = lower($1)
            and lower(wallet_address) <> lower($2)
         limit 1`,
        [email, allowedWallet]
    );

    if (conflict.rows[0]) {
        throw new AccountEmailConflictError();
    }

    return findAccountEmailBinding(client, email);
}
