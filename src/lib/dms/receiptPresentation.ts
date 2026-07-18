const RECEIPT_ID_PATTERN = /\brcpt-[0-9a-f]{32}\b/i;
const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/i;

function shortAddress(address: string) {
    const normalized = address.trim();
    return ADDRESS_PATTERN.test(normalized)
        ? `${normalized.slice(0, 6)}…${normalized.slice(-4)}`
        : "SubScript merchant";
}

/**
 * Receipt copy must use a database-owned merchant identity, never the merchant_name field
 * supplied with an individual checkout. Collapse control whitespace so a stored alias cannot
 * create extra chat lines or smuggle a second receipt affordance into the message.
 */
export function safeReceiptPayeeLabel(alias: string | null | undefined, merchantAddress: string) {
    const normalized = alias?.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
    if (!normalized || ADDRESS_PATTERN.test(normalized)) return shortAddress(merchantAddress);
    return normalized.slice(0, 80);
}

function formatUsdcMicros(amount: bigint | string | number): string {
    try {
        const micros = typeof amount === "bigint" ? amount : BigInt(amount);
        const base = BigInt(1_000_000);
        const whole = micros / base;
        const fraction = (micros % base).toString().padStart(6, "0").replace(/0+$/, "");
        return fraction ? `${whole}.${fraction}` : whole.toString();
    } catch {
        return "0";
    }
}

export function buildReceiptDmDescription(args: {
    amountUsdcMicros: bigint | string | number;
    payeeLabel: string;
    receiptId: string;
}): string {
    return [
        `Your ${formatUsdcMicros(args.amountUsdcMicros)} USDC payment to ${args.payeeLabel} has been confirmed.`,
        `Receipt ID: ${args.receiptId}`,
    ].join("\n");
}

/**
 * Stored DMs may contain either the new `Receipt ID:` line or a legacy absolute receipt URL.
 * Extract only the opaque SubScript receipt id and always rebuild a same-origin relative URL.
 * The stored host/query string is deliberately discarded, preventing a merchant-controlled
 * description from turning an off-site URL into a trusted-looking "View receipt" action.
 */
export function receiptHrefFromDescriptionLine(line: string) {
    const receiptId = line.match(RECEIPT_ID_PATTERN)?.[0]?.toLowerCase();
    return receiptId ? `/receipt/${encodeURIComponent(receiptId)}` : null;
}
