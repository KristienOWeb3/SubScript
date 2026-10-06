type HistoryRow = {
    id: string;
    txHash?: string | null;
    incoming: boolean;
    counterpartyAddress?: string | null;
    amountUsdc: number;
};

/** Keep the authoritative row when optimistic and indexed records describe one transfer.
 * Address and amount preserve separate recipients in a batched transaction. */
export function deduplicateHistory<T extends HistoryRow>(rows: T[]): T[] {
    const byTransfer = new Map<string, T>();
    const seenIds = new Set<string>();
    for (const row of rows) {
        if (seenIds.has(row.id)) continue;
        seenIds.add(row.id);
        const key = row.txHash
            ? JSON.stringify([
                row.txHash.toLowerCase(), row.incoming,
                /^0x[0-9a-f]{40}$/i.test(row.counterpartyAddress || "")
                    ? row.counterpartyAddress!.toLowerCase() : row.counterpartyAddress || "",
                row.amountUsdc,
            ])
            : row.id;
        const existing = byTransfer.get(key);
        if (!existing || (existing.id.startsWith("optimistic-") && !row.id.startsWith("optimistic-"))) {
            byTransfer.set(key, row);
        }
    }
    return [...byTransfer.values()];
}
