import { assertProviderRateLimit } from "@/lib/providerRateLimit";

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

export function isUsableCircleApiKey(value: string | undefined): value is string {
    if (!value) return false;
    const trimmed = value.trim();
    if (!trimmed) return false;
    return !/^(TEST_API_KEY|your_|changeme|mock_|placeholder|undefined|null)$/i.test(trimmed);
}

function circleApiKey() {
    const key = process.env.CIRCLE_API_KEY;
    if (!isUsableCircleApiKey(key)) {
        throw new Error("CIRCLE_API_KEY is missing or still set to a placeholder");
    }
    return key.trim();
}

const CIRCLE_API_TIMEOUT_MS = Number(process.env.CIRCLE_API_TIMEOUT_MS) || 15000;

async function circleFetch<T>(path: string, init: RequestInit & { userToken?: string } = {}) {
    assertProviderRateLimit({
        provider: "circle",
        key: init.userToken ? `user:${init.userToken.slice(0, 16)}` : "global",
        limit: init.method === "POST" ? 30 : 120,
        windowMs: 60 * 1000,
    });

    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${circleApiKey()}`);
    headers.set("Content-Type", "application/json");
    if (init.userToken) {
        headers.set("X-User-Token", init.userToken);
    }

    /* Bound every Circle call so a stalled upstream can't hang the login route forever. */
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CIRCLE_API_TIMEOUT_MS);
    let response: Response;
    try {
        response = await fetch(`${CIRCLE_API_BASE_URL}${path}`, {
            ...init,
            headers,
            signal: controller.signal,
        });
    } catch (error: any) {
        if (error?.name === "AbortError") {
            throw new Error("Circle API request timed out. Please try again.");
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }

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
