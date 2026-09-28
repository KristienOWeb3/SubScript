export function formatTransactionDateTime(timestamp: number | string | Date): string {
    const d = new Date(timestamp);
    if (isNaN(d.getTime())) return "";
    const pad = (n: number) => n.toString().padStart(2, "0");
    const day = pad(d.getDate());
    const month = pad(d.getMonth() + 1);
    const year = d.getFullYear();
    const hours = pad(d.getHours());
    const minutes = pad(d.getMinutes());
    const seconds = pad(d.getSeconds());
    return `${day}/${month}/${year}, ${hours}:${minutes}:${seconds}`;
}

export interface TransactionSubtitleParams {
    isCctp?: boolean;
    incoming: boolean;
    originName?: string | null;
    destName?: string | null;
    timestamp: number | string | Date;
    routedAt?: number | string | Date | null;
}

/**
 * Returns user dashboard transaction subtitle:
 * - Default send on Arc: "USDC Transfer 21/09/2026, 13:36:03"
 * - CCTP send: "USDC Transfer (Destination chain) 21/09/2026, 13:36:03"
 * - Default deposit on Arc: "USDC Deposit 21/09/2026, 13:36:03"
 * - CCTP deposit: "USDC Deposit • receival Network • 21/09/2026, 12:55:48"
 */
export function formatTransactionSubtitle(params: TransactionSubtitleParams): string {
    const { isCctp, incoming, originName, destName, timestamp, routedAt } = params;
    if (isCctp) {
        if (!incoming) {
            const chain = destName?.trim() || "External Chain";
            const dateStr = formatTransactionDateTime(timestamp);
            return `USDC Transfer (${chain}) • ${dateStr}`;
        } else {
            const network = originName?.trim() || "External Chain";
            const routedDateStr = formatTransactionDateTime(routedAt || timestamp);
            return `USDC Deposit • ${network} • ${routedDateStr}`;
        }
    }

    const dateStr = formatTransactionDateTime(timestamp);
    if (incoming) {
        return `USDC Deposit • ${dateStr}`;
    } else {
        return `USDC Transfer • ${dateStr}`;
    }
}
