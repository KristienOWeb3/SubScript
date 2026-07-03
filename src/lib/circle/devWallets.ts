import { initiateDeveloperControlledWalletsClient, type Blockchain, type AccountType } from "@circle-fin/developer-controlled-wallets";
import { isUsableCircleApiKey } from "@/lib/circle/client";

/*
 * Circle developer-controlled (MPC) wallet provisioning — Phase 1, Stage 2a.
 *
 * This is the *foundation* only: it can create an Arc wallet set and mint per-user MPC wallets.
 * Signing / contract-execution and the wallet-creation cutover (otp/verify, circle/wallet/complete)
 * plus the legacy-wallet migration are Stage 2b, gated on live Circle sandbox credentials.
 *
 * Custody model: Circle holds the key material via MPC; the developer authorizes operations with an
 * entity secret. Nothing here has extractable keys — which is the whole point of moving off the
 * single WALLET_ENCRYPTION_KEY. The new sensitive secret is CIRCLE_ENTITY_SECRET; it must live in a
 * secret manager, never committed.
 *
 * Inert without credentials: every entry point throws a clear error if CIRCLE_API_KEY or
 * CIRCLE_ENTITY_SECRET is missing, so importing this module can never silently touch funds.
 */

export type CircleAccountType = "EOA" | "SCA";

/** Account type for new wallets. Defaults to SCA so Circle's Gas Station can sponsor USDC gas on
 *  Arc and we can retire the SPONSOR_PRIVATE_KEY top-up. Flip to EOA via env with no code change if
 *  the Gas-Station-on-Arc sandbox check fails. */
export function configuredAccountType(): CircleAccountType {
    const raw = (process.env.CIRCLE_WALLET_ACCOUNT_TYPE || "SCA").trim().toUpperCase();
    return raw === "EOA" ? "EOA" : "SCA";
}

/* Circle's blockchain identifier for Arc (e.g. "ARC-TESTNET" / "ARC"). Env-driven so the mainnet
   cutover is a config flip. Cast because it originates from env; Circle rejects unknown values. */
export function configuredArcBlockchain(): Blockchain {
    return (process.env.CIRCLE_ARC_BLOCKCHAIN || "ARC-TESTNET") as Blockchain;
}

function entitySecret(): string {
    const secret = process.env.CIRCLE_ENTITY_SECRET;
    if (!secret || !secret.trim()) {
        throw new Error("CIRCLE_ENTITY_SECRET is not configured — developer-controlled wallets are unavailable.");
    }
    return secret.trim();
}

function apiKey(): string {
    const key = process.env.CIRCLE_API_KEY;
    if (!isUsableCircleApiKey(key)) {
        throw new Error("CIRCLE_API_KEY is missing or still a placeholder — developer-controlled wallets are unavailable.");
    }
    return key.trim();
}

type DevWalletsClient = ReturnType<typeof initiateDeveloperControlledWalletsClient>;
let cachedClient: DevWalletsClient | null = null;

/** Memoized developer-controlled wallets client. Throws (not returns null) if creds are absent. */
export function getDevWalletsClient(): DevWalletsClient {
    if (!cachedClient) {
        cachedClient = initiateDeveloperControlledWalletsClient({
            apiKey: apiKey(),
            entitySecret: entitySecret(),
        });
    }
    return cachedClient;
}

/** Whether developer-controlled wallets are configured enough to be used at all. */
export function isCircleCustodyConfigured(): boolean {
    return isUsableCircleApiKey(process.env.CIRCLE_API_KEY) && !!process.env.CIRCLE_ENTITY_SECRET?.trim();
}

/**
 * One-time: create a wallet set to group SubScript's Arc wallets under the entity secret. Returns
 * the wallet-set id, which should be persisted to CIRCLE_ARC_WALLET_SET_ID (all future wallets are
 * created inside it). Not called on the hot path — run once during setup.
 */
export async function createArcWalletSet(name = "SubScript Arc Wallets"): Promise<string> {
    const client = getDevWalletsClient();
    const res = await client.createWalletSet({ name });
    const id = res.data?.walletSet?.id;
    if (!id) {
        throw new Error("Circle wallet set creation returned no id.");
    }
    return id;
}

function walletSetId(): string {
    const id = process.env.CIRCLE_ARC_WALLET_SET_ID;
    if (!id || !id.trim()) {
        throw new Error("CIRCLE_ARC_WALLET_SET_ID is not configured — run createArcWalletSet() once and set it.");
    }
    return id.trim();
}

export interface ProvisionedCircleWallet {
    walletId: string;
    address: string;
    accountType: CircleAccountType;
    blockchain: string;
}

/**
 * Create one developer-controlled MPC wallet for a user, on Arc, inside the configured wallet set.
 * Returns the Circle wallet id + on-chain address; the caller persists both on the user record
 * (circle_wallet_id + wallet_address) with a null encrypted_private_key.
 */
export async function createEmbeddedCircleWallet(): Promise<ProvisionedCircleWallet> {
    const client = getDevWalletsClient();
    const accountType = configuredAccountType();
    const blockchain = configuredArcBlockchain();

    const res = await client.createWallets({
        walletSetId: walletSetId(),
        blockchains: [blockchain],
        count: 1,
        accountType: accountType as AccountType,
    });

    const wallet = res.data?.wallets?.[0];
    if (!wallet?.id || !wallet.address) {
        throw new Error("Circle wallet creation returned no wallet id/address.");
    }
    return {
        walletId: wallet.id,
        address: wallet.address.toLowerCase(),
        accountType,
        blockchain,
    };
}
