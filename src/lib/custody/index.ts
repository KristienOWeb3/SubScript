import { randomUUID, createHash } from "node:crypto";
import { ethers } from "ethers";
import { pgMaybeOne } from "@/lib/serverPg";
import { decryptPrivateKey } from "@/lib/crypto";
import { getRpcProviderForWrite } from "@/lib/payments/rpc";
import { getDevWalletsClient } from "@/lib/circle/devWallets";

/*
 * Wallet custody provider abstraction (Phase 1, Stage 2c).
 *
 * Every server-side signing operation for a *user embedded wallet* funnels through this seam so
 * the underlying custody model can change without touching call sites. Two backends:
 *
 *   - "legacy": the original model — a raw secp256k1 key encrypted at rest with the single
 *     WALLET_ENCRYPTION_KEY and decrypted here into an ethers.Wallet. This is the crown-jewel
 *     risk we are migrating away from (one leaked env secret decrypts every user's key).
 *   - "circle": Circle developer-controlled (MPC) wallet — no extractable key. Contract writes go
 *     through Circle's contract-execution transaction API and EIP-712 signing through its
 *     signTypedData API, authorized by the entity secret.
 *
 * A wallet is Circle-backed iff it has a circle_wallet_id; otherwise it's legacy. Call sites should
 * use the high-level ops (executeContract / signTypedData), which both backends implement with the
 * same semantics: resolve only once the transaction is mined successfully, throw on revert/failure.
 * getEthersSigner/getRawPrivateKey remain for legacy-only flows (key export) and die with the AES path.
 *
 * NOTE: ephemeral payment-link receiver wallets are a different lifecycle and are intentionally
 * out of scope here — see src/app/api/payment-links/verify/route.ts.
 */

export type CustodyKind = "legacy" | "circle";

/** A state-changing contract call, backend-agnostic. Args follow ethers conventions (bigint ok). */
export interface ContractCall {
    contractAddress: string;
    abi: ethers.InterfaceAbi;
    functionName: string;
    args?: ReadonlyArray<unknown>;
    /**
     * Optional durable idempotency key. When set, a retried logical operation submits the SAME
     * key so the Circle backend dedupes it (its API keys on this) instead of double-submitting a
     * financial transaction after a timed-out response. Must be a stable seed for the operation —
     * only pass one for operations that are idempotent by identity (e.g. cancel a specific sub);
     * never for raw transfers, where two identical payments are legitimately distinct. Prefer
     * `deterministicIdempotencyKey(seed)` to build a well-formed UUID from an application seed.
     * The legacy backend has no server-side dedup and ignores this.
     */
    idempotencyKey?: string;
}

/**
 * Derive a stable RFC-4122 UUID from an application seed. Circle's idempotencyKey must be UUID-
 * shaped, so hashing the seed and formatting it as a v5-style UUID lets a retried operation reuse
 * the exact same key deterministically.
 */
export function deterministicIdempotencyKey(seed: string): string {
    const h = createHash("sha256").update(seed).digest("hex");
    const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export interface ContractExecution {
    txHash: string;
}

/* How long to wait for a Circle transaction to confirm before giving up. Circle SCA transactions
   go through the 4337 pipeline, so confirmation can take a bit longer than a raw EOA send. */
const CIRCLE_TX_CONFIRM_TIMEOUT_MS = Number(process.env.CIRCLE_TX_CONFIRM_TIMEOUT_MS) || 110_000;
const CIRCLE_TX_POLL_INTERVAL_MS = 2_000;

export interface WalletCustody {
    readonly address: string;
    readonly kind: CustodyKind;
    /** Whether the raw private key can be exported (true only for legacy; MPC keys are not extractable). */
    readonly canExportRawKey: boolean;
    /**
     * Submit a state-changing contract call from this wallet and wait until it is mined
     * successfully. Throws if the transaction reverts or the custody backend reports failure.
     */
    executeContract(call: ContractCall): Promise<ContractExecution>;
    /** EIP-712 typed-data signature. For Circle SCA wallets verification is ERC-1271 (the account
     *  contract validates the MPC signature), which Permit2 and compliant verifiers support. */
    signTypedData(
        domain: ethers.TypedDataDomain,
        types: Record<string, Array<ethers.TypedDataField>>,
        value: Record<string, unknown>,
    ): Promise<string>;
    /** An ethers signer bound to the given provider. Legacy only; Circle throws — use the ops above. */
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

    async executeContract(call: ContractCall): Promise<ContractExecution> {
        const { provider } = await getRpcProviderForWrite();
        const signer = await this.getEthersSigner(provider);
        const contract = new ethers.Contract(call.contractAddress, call.abi, signer);
        const method = contract[call.functionName] as ((...a: unknown[]) => Promise<ethers.TransactionResponse>) | undefined;
        if (typeof method !== "function") {
            throw new Error(`Contract function not found: ${call.functionName}`);
        }
        const tx = await method(...(call.args ?? []));
        const receipt = await tx.wait();
        if (receipt && receipt.status !== 1) {
            throw new Error(`Transaction ${receipt.hash} reverted on-chain.`);
        }
        return { txHash: receipt?.hash || tx.hash };
    }

    async signTypedData(
        domain: ethers.TypedDataDomain,
        types: Record<string, Array<ethers.TypedDataField>>,
        value: Record<string, unknown>,
    ): Promise<string> {
        const signer = new ethers.Wallet(decryptPrivateKey(this.encryptedPrivateKey));
        return signer.signTypedData(domain, types, value);
    }
}

class CircleCustody implements WalletCustody {
    readonly kind = "circle" as const;
    readonly canExportRawKey = false;
    constructor(readonly address: string, readonly circleWalletId: string) {}

    async getEthersSigner(): Promise<ethers.Wallet> {
        throw new Error("Circle-backed wallets do not expose a raw signer; use executeContract/signTypedData.");
    }

    async getRawPrivateKey(): Promise<never> {
        throw new Error("Circle-backed wallets are MPC-secured; the private key cannot be exported.");
    }

    async executeContract(call: ContractCall): Promise<ContractExecution> {
        const client = getDevWalletsClient();
        /* Encode locally with ethers and submit callData — one canonical encoding for both
           backends instead of re-serializing args into Circle's abiParameters strings. */
        const iface = new ethers.Interface(call.abi);
        const callData = iface.encodeFunctionData(call.functionName, [...(call.args ?? [])]) as `0x${string}`;

        const created = await client.createContractExecutionTransaction({
            walletId: this.circleWalletId,
            contractAddress: call.contractAddress,
            callData,
            fee: { type: "level", config: { feeLevel: "MEDIUM" } },
            /* Durable when the caller supplies a stable key (retries dedupe at Circle); random
               otherwise, preserving prior behavior for operations without a natural key. */
            idempotencyKey: call.idempotencyKey || randomUUID(),
        });
        const txId = created.data?.id;
        if (!txId) {
            throw new Error("Circle contract execution returned no transaction id.");
        }

        /* CONFIRMED = mined successfully; the SDK rejects if the tx enters FAILED/CANCELLED/
           DENIED/STUCK, which covers on-chain reverts — same contract as legacy tx.wait(). */
        const confirmed = await client.getTransaction({
            id: txId,
            waitForState: "CONFIRMED",
            pollingInterval: CIRCLE_TX_POLL_INTERVAL_MS,
            signal: AbortSignal.timeout(CIRCLE_TX_CONFIRM_TIMEOUT_MS),
        });
        const txHash = confirmed.data?.transaction?.txHash;
        if (txHash) {
            return { txHash };
        }
        /* Defensive: txHash should be populated at CONFIRMED for both EOA and SCA. */
        const withHash = await client.getTransaction({
            id: txId,
            waitForTxHash: true,
            pollingInterval: CIRCLE_TX_POLL_INTERVAL_MS,
            signal: AbortSignal.timeout(CIRCLE_TX_CONFIRM_TIMEOUT_MS),
        });
        return { txHash: withHash.data.transaction.txHash };
    }

    async signTypedData(
        domain: ethers.TypedDataDomain,
        types: Record<string, Array<ethers.TypedDataField>>,
        value: Record<string, unknown>,
    ): Promise<string> {
        const client = getDevWalletsClient();
        /* Circle expects the full eth_signTypedData_v4 payload (EIP712Domain included);
           TypedDataEncoder.getPayload builds exactly that from the ethers-style inputs. */
        const payload = ethers.TypedDataEncoder.getPayload(domain, types, value);
        const res = await client.signTypedData({
            walletId: this.circleWalletId,
            data: JSON.stringify(payload),
        });
        const signature = res.data?.signature;
        if (!signature) {
            throw new Error("Circle signTypedData returned no signature.");
        }
        return signature;
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
