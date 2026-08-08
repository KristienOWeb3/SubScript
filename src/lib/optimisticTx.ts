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
};

const STORAGE_KEY = "subscript_optimistic_txs";

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
        return parsed.filter(
            (tx): tx is OptimisticTx =>
                Boolean(tx) &&
                typeof tx.id === "string" &&
                typeof tx.recipientAddress === "string" &&
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
}: {
    txHash: string | null;
    recipientAddress: string;
    recipientLabel: string;
    /* Human decimal, e.g. "5.25". */
    amountUsdc: string;
}): void {
    const now = Date.now();
    const micros = Math.round(Number(amountUsdc) * 1_000_000);
    const entry: OptimisticTx = {
        id: `optimistic-${txHash || now}`,
        txHash,
        recipientAddress,
        recipientLabel,
        amountUsdcMicros: Number.isFinite(micros) && micros > 0 ? String(micros) : "0",
        createdAt: now,
    };
    /* Re-submitting the same hash replaces rather than duplicates. */
    const existing = read().filter((row) => isFresh(row, now) && row.id !== entry.id);
    write([entry, ...existing]);
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
