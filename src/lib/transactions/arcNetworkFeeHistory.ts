export type ArcNetworkFeeHistoryMetadata = {
    type: "ARC_NETWORK_FEE";
    amountMicros: string;
    txHash: string | null;
    charged: boolean;
    unrecovered: boolean;
    parentTransactionHashes: string[];
    legacyInferred?: boolean;
};

export type ArcHistoryTransfer = {
    txHash: string;
    fromAddress: string;
    toAddress: string;
    amountUsdc: string;
    timestamp: number;
    blockNumber?: number;
    incoming?: boolean;
    direction?: string;
    transactionType?: string;
    networkFee?: ArcNetworkFeeHistoryMetadata;
    historyLabel?: string;
};

const MIN_FEE_MICROS = 2_000n;
const MAX_FEE_MICROS = 50_000n;
const LEGACY_MATCH_WINDOW_MS = 5 * 60 * 1000;
const LEGACY_MATCH_BLOCK_WINDOW = 20;

function normalized(value: string | null | undefined) {
    return (value || "").toLowerCase();
}

function isOutgoing(item: ArcHistoryTransfer) {
    return item.incoming === false || item.direction === "outbound_send";
}

function usdcToMicros(value: string): bigint | null {
    const normalizedValue = value.trim();
    if (!/^\d+(?:\.\d{1,6})?$/.test(normalizedValue)) return null;
    const [whole, fraction = ""] = normalizedValue.split(".");
    return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
}

/**
 * Remove typed fee-recovery transfers from the top-level history and attach their exact metadata to
 * a linked primary transfer. Address matching is only a conservative fallback for old chain rows
 * that predate the ledger: it also requires sender, fee bounds, ordering, time and block proximity,
 * and exactly one plausible primary transfer.
 */
export function groupArcNetworkFeeTransfers<T extends ArcHistoryTransfer>(
    items: T[],
    gasFeeTreasuryAddress: string,
): Array<T & { networkFee?: ArcNetworkFeeHistoryMetadata; historyLabel?: string }> {
    const treasury = normalized(gasFeeTreasuryAddress);
    const byHash = new Map(items.map((item) => [normalized(item.txHash), item]));
    const hiddenFeeHashes = new Set<string>();
    const feeByPrimaryHash = new Map<string, ArcNetworkFeeHistoryMetadata>();

    for (const item of items) {
        if (item.transactionType !== "ARC_NETWORK_FEE" || !item.networkFee) continue;
        const parentHash = item.networkFee.parentTransactionHashes
            .map(normalized)
            .find((hash) => byHash.has(hash));
        if (!parentHash) {
            /* A typed fee with a parent outside the scanner window remains honest and recognizable;
               it is not silently attached to an unrelated transfer. */
            item.historyLabel = "Arc network fee";
            continue;
        }
        hiddenFeeHashes.add(normalized(item.txHash));
        feeByPrimaryHash.set(parentHash, item.networkFee);
    }

    /* Historical fallback only. New records must carry transactionType + parent linkage above. */
    for (const candidate of items) {
        if (candidate.transactionType || !isOutgoing(candidate)) continue;
        if (normalized(candidate.toAddress) !== treasury) continue;

        const amountMicros = usdcToMicros(candidate.amountUsdc);
        if (amountMicros === null) {
            candidate.historyLabel = "Transfer to SubScript treasury";
            continue;
        }
        if (amountMicros < MIN_FEE_MICROS || amountMicros > MAX_FEE_MICROS) {
            candidate.historyLabel = "Transfer to SubScript treasury";
            continue;
        }

        const plausibleParents = items.filter((primary) => {
            if (primary === candidate || primary.transactionType === "ARC_NETWORK_FEE" || !isOutgoing(primary)) return false;
            if (normalized(primary.fromAddress) !== normalized(candidate.fromAddress)) return false;
            if (normalized(primary.toAddress) === treasury) return false;
            const timeDelta = candidate.timestamp - primary.timestamp;
            if (timeDelta < 0 || timeDelta > LEGACY_MATCH_WINDOW_MS) return false;
            if (candidate.blockNumber && primary.blockNumber) {
                const blockDelta = candidate.blockNumber - primary.blockNumber;
                if (blockDelta < 0 || blockDelta > LEGACY_MATCH_BLOCK_WINDOW) return false;
            }
            return true;
        });

        if (plausibleParents.length !== 1) {
            candidate.historyLabel = "Transfer to SubScript treasury";
            continue;
        }

        const parentHash = normalized(plausibleParents[0].txHash);
        if (feeByPrimaryHash.has(parentHash)) continue;
        hiddenFeeHashes.add(normalized(candidate.txHash));
        feeByPrimaryHash.set(parentHash, {
            type: "ARC_NETWORK_FEE",
            amountMicros: candidate.amountUsdc,
            txHash: candidate.txHash,
            charged: true,
            unrecovered: false,
            parentTransactionHashes: [plausibleParents[0].txHash],
            legacyInferred: true,
        });
    }

    return items
        .filter((item) => !hiddenFeeHashes.has(normalized(item.txHash)))
        .map((item) => {
            const linkedFee = feeByPrimaryHash.get(normalized(item.txHash));
            return linkedFee ? { ...item, networkFee: linkedFee } : item;
        });
}
