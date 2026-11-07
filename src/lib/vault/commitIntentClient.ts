type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type CommitIntentReply = {
    exists: boolean; status?: "PENDING" | "SUBMITTED" | "MIRRORED" | "FAILED";
    txHash?: string | null; merchantAddress?: string; lastError?: string | null; resumeRequired?: boolean;
};

export function commitRequestStorageKey(wallet: string, merchant: string, chainId: number) {
    return `subscript:vault-commit:${chainId}:${wallet.toLowerCase()}:${merchant.toLowerCase()}`;
}

/** A network error or invalid payload is unknown, never authoritative absence. */
export async function readCommitIntent(requestId: string, fetcher: typeof fetch = fetch): Promise<CommitIntentReply | null> {
    try {
        const response = await fetcher(`/api/user/vault/commit?requestId=${encodeURIComponent(requestId)}`, { cache: "no-store" });
        if (!response.ok) return null;
        const reply = await response.json();
        if (!reply || typeof reply.exists !== "boolean") return null;
        if (!reply.exists) return { exists: false };
        if (!["PENDING", "SUBMITTED", "MIRRORED", "FAILED"].includes(reply.status)) return null;
        if (["SUBMITTED", "MIRRORED"].includes(reply.status) && !/^0x[0-9a-f]{64}$/i.test(reply.txHash ?? "")) return null;
        return reply;
    } catch { return null; }
}

/** The legacy key is migrated only after the server proves this wallet owns it. */
export async function recoverCommitRequest(storage: StorageLike, key: string, legacyKey: string, fetcher: typeof fetch = fetch) {
    const scoped = storage.getItem(key);
    const requestId = scoped || storage.getItem(legacyKey);
    if (!requestId) return { requestId: null, outcome: { exists: false } as CommitIntentReply };
    const outcome = await readCommitIntent(requestId, fetcher);
    if (!outcome) return { requestId, outcome: null };
    if (outcome.exists) {
        storage.setItem(key, requestId);
        if (storage.getItem(legacyKey) === requestId) storage.removeItem(legacyKey);
    } else if (scoped) {
        storage.removeItem(key);
    }
    return { requestId: outcome.exists ? requestId : null, outcome };
}
