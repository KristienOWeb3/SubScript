/* Outgoing transfers are visible in the dashboard the moment they're submitted, before the
   DM log and the Arc indexer have caught up. Records live in sessionStorage (not localStorage)
   so a closed tab can't resurrect a stale "pending" row, and each one self-expires — an
   optimistic row that outlives its TTL is a row the server never confirmed, and continuing to
   show it would misreport an unsettled transfer as real history. */

export type OptimisticTx = {
    id: string;
    txHash: string | null;
    recipientAddress: string;
    recipientLabel: string;
    /* Micros, matching the on-chain/DM convention everywhere else so consumers can reuse the
       same formatter. Callers pass a human decimal string and this module converts. */
    amountUsdcMicros: string;
    createdAt: number;
    revealed?: boolean;
};

const STORAGE_KEY = "subscript_optimistic_txs";

/* The transactions page merges these rows into the confirmed ledger and identifies them by this
   prefix to apply the pending treatment. Exported (and consumed via isOptimisticTxId) so the
   producer and the consumer share one definition instead of two string literals that can drift. */
export const OPTIMISTIC_ID_PREFIX = "optimistic-";

export function isOptimisticTxId(id: string | null | undefined): boolean {
    return typeof id === "string" && id.startsWith(OPTIMISTIC_ID_PREFIX);
}

/* Long enough to cover indexer lag on a slow network, short enough that a genuinely failed
   submission stops being advertised as pending. */
const TTL_MS = 5 * 60 * 1000;

function isFresh(tx: OptimisticTx, now: number): boolean {
    return now - tx.createdAt < TTL_MS;
}

function read(): OptimisticTx[] {
    if (typeof window === "undefined") return [];
    try {
        const raw = window.sessionStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        /* Every field is checked, not just the ones this function touches: corrupted storage
           reaches reconcileOptimisticTxs(), which calls tx.txHash.toLowerCase() outside this
           try/catch, so a non-string hash that slipped past the guard would throw into the
           caller's load path rather than degrading to "no optimistic rows". */
        return parsed.filter(
            (tx): tx is OptimisticTx =>
                Boolean(tx) &&
                typeof tx.id === "string" &&
                (tx.txHash === null || typeof tx.txHash === "string") &&
                typeof tx.recipientAddress === "string" &&
                typeof tx.recipientLabel === "string" &&
                typeof tx.amountUsdcMicros === "string" &&
                typeof tx.createdAt === "number"
        );
    } catch {
        return [];
    }
}

function write(txs: OptimisticTx[]): void {
    if (typeof window === "undefined") return;
    try {
        if (txs.length === 0) window.sessionStorage.removeItem(STORAGE_KEY);
        else window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(txs));
    } catch {
        /* A full or blocked sessionStorage costs an optimistic row, never the transfer. */
    }
}

/* Returns only unexpired records, pruning anything stale as a side effect. */
export function readOptimisticTxs(): OptimisticTx[] {
    const now = Date.now();
    const all = read();
    const fresh = all.filter((tx) => isFresh(tx, now));
    if (fresh.length !== all.length) write(fresh);
    return fresh;
}

export function recordOptimisticTx({
    txHash,
    recipientAddress,
    recipientLabel,
    amountUsdc,
    id,
    revealed = true,
}: {
    txHash: string | null;
    recipientAddress: string;
    recipientLabel: string;
    /* Human decimal, e.g. "5.25". */
    amountUsdc: string;
    id?: string;
    revealed?: boolean;
}): string | null {
    const now = Date.now();
    const micros = Math.round(Number(amountUsdc) * 1_000_000);
    /* Skip the row rather than storing "0": the transactions page would render it as
       "-$0.00 · Sending", reporting a real transfer as worthless. No optimistic row is the
       better failure — the DM log still supplies the authoritative one a moment later. */
    if (!Number.isFinite(micros) || micros <= 0) return null;
    const entryId = id || `${OPTIMISTIC_ID_PREFIX}${txHash || now}`;
    const entry: OptimisticTx = {
        id: entryId,
        txHash,
        recipientAddress,
        recipientLabel,
        amountUsdcMicros: String(micros),
        createdAt: now,
        revealed,
    };
    /* Re-submitting the same id or hash replaces rather than duplicates. */
    const existing = read().filter(
        (row) => isFresh(row, now) && row.id !== entry.id && !(txHash && row.txHash && row.txHash.toLowerCase() === txHash.toLowerCase())
    );
    write([entry, ...existing]);
    return entryId;
}

/* Mark an optimistic transaction as revealed (visible in transaction history) and optionally update its txHash. */
export function revealOptimisticTx(idOrHash: string, finalTxHash?: string | null): OptimisticTx[] {
    return updateOptimisticTx(idOrHash, finalTxHash, true);
}

/* Settlement releases a hashless reservation independently of the history reveal animation. */
export function updateOptimisticTx(idOrHash: string, finalTxHash?: string | null, revealed?: boolean): OptimisticTx[] {
    const target = idOrHash.toLowerCase();
    const now = Date.now();
    const updated = read().map((tx) => {
        if (!isFresh(tx, now)) return tx;
        if (tx.id.toLowerCase() === target || (tx.txHash && tx.txHash.toLowerCase() === target)) {
            return {
                ...tx,
                txHash: finalTxHash !== undefined ? finalTxHash : tx.txHash,
                revealed: revealed !== undefined ? revealed : tx.revealed,
            };
        }
        return tx;
    });
    write(updated);
    return updated;
}

/* Remove a specific optimistic entry by ID or transaction hash (e.g. when a preflight or submission fails). */
export function removeOptimisticTx(idOrHash: string): OptimisticTx[] {
    const target = idOrHash.toLowerCase();
    const now = Date.now();
    const remaining = read().filter(
        (tx) => isFresh(tx, now) && tx.id.toLowerCase() !== target && tx.txHash?.toLowerCase() !== target
    );
    write(remaining);
    return remaining;
}

/* Drop rows the server has since confirmed. Matching is by hash where we have one; a transfer
   submitted without a hash falls back to its own TTL. */
export function reconcileOptimisticTxs(confirmedTxHashes: Array<string | null | undefined>): OptimisticTx[] {
    const confirmed = new Set(
        confirmedTxHashes.filter((hash): hash is string => typeof hash === "string" && hash.length > 0).map((hash) => hash.toLowerCase())
    );
    const now = Date.now();
    const remaining = read().filter(
        (tx) => isFresh(tx, now) && !(tx.txHash && confirmed.has(tx.txHash.toLowerCase()))
    );
    write(remaining);
    return remaining;
}
