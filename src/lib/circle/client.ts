const CIRCLE_API_BASE_URL = process.env.CIRCLE_API_BASE_URL || "https://api.circle.com";

export type CircleSocialAuth = {
    userToken: string;
    refreshToken?: string;
    oAuthInfo?: {
        socialUserUUID?: string;
        socialUserInfo?: {
            email?: string;
            name?: string;
            phone?: string;
        };
    };
    encryptionKey?: string;
};

type CircleWallet = {
    id?: string;
    walletId?: string;
    address?: string;
    blockchain?: string;
    accountType?: string;
};

function circleApiKey() {
    const key = process.env.CIRCLE_API_KEY;
    if (!key) {
        throw new Error("CIRCLE_API_KEY is not configured");
    }
    return key;
}

async function circleFetch<T>(path: string, init: RequestInit & { userToken?: string } = {}) {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${circleApiKey()}`);
    headers.set("Content-Type", "application/json");
    if (init.userToken) {
        headers.set("X-User-Token", init.userToken);
    }

    const response = await fetch(`${CIRCLE_API_BASE_URL}${path}`, {
        ...init,
        headers,
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(payload?.message || payload?.error || `Circle API request failed: ${response.status}`);
    }
    return payload as T;
}

export async function createCircleArcWalletChallenge(userToken: string) {
    const blockchain = process.env.CIRCLE_ARC_BLOCKCHAIN || "ARC-TESTNET";
    const accountType = process.env.CIRCLE_WALLET_ACCOUNT_TYPE || "EOA";

    return circleFetch<{
        data?: {
            challengeId?: string;
            walletIds?: string[];
            wallets?: CircleWallet[];
        };
    }>("/v1/w3s/user/wallets", {
        method: "POST",
        userToken,
        body: JSON.stringify({
            idempotencyKey: crypto.randomUUID(),
            accountType,
            blockchains: [blockchain],
        }),
    });
}

export async function listCircleUserWallets(userToken: string) {
    const response = await circleFetch<{
        data?: {
            wallets?: CircleWallet[];
        };
    }>("/v1/w3s/user/wallets", {
        method: "GET",
        userToken,
    });

    return response.data?.wallets || [];
}

export function getCircleEmail(auth: CircleSocialAuth) {
    return auth.oAuthInfo?.socialUserInfo?.email?.toLowerCase() || null;
}

export function selectArcEoaWallet(wallets: CircleWallet[]) {
    const preferredBlockchain = (process.env.CIRCLE_ARC_BLOCKCHAIN || "ARC-TESTNET").toLowerCase();
    return wallets.find((wallet) => {
        const blockchain = wallet.blockchain?.toLowerCase();
        const accountType = wallet.accountType?.toLowerCase();
        return wallet.address && (!blockchain || blockchain === preferredBlockchain) && (!accountType || accountType === "eoa");
    }) || wallets.find((wallet) => wallet.address);
}
