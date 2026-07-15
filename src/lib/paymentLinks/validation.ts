const PAYMENT_LINK_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidPaymentLinkId(id: string): boolean {
    return PAYMENT_LINK_ID_PATTERN.test(id);
}

export const MAX_PAYMENT_LINK_AMOUNT_MICROS = BigInt(1_000_000) * BigInt(1_000_000);

export function normalizeMicrouscAmount(value: unknown):
    | { ok: true; value: bigint }
    | { ok: false; error: string } {
    const text = typeof value === "string" && /^\d+$/.test(value.trim())
        ? value.trim()
        : typeof value === "number" && Number.isSafeInteger(value) && value >= 0
            ? String(value)
            : null;
    if (text === null) return { ok: false, error: "amount must be a whole number of micro-USDC" };
    const amount = BigInt(text);
    if (amount <= BigInt(0)) return { ok: false, error: "amount must be greater than 0" };
    if (amount > MAX_PAYMENT_LINK_AMOUNT_MICROS) {
        return { ok: false, error: "amount exceeds the 1,000,000 USDC maximum" };
    }
    return { ok: true, value: amount };
}

export function parsePaymentLinkExpiry(value: unknown, now = new Date()):
    | { ok: true; value: Date | null }
    | { ok: false; error: string } {
    if (value === undefined || value === null || value === "") return { ok: true, value: null };
    if (typeof value !== "string" && typeof value !== "number") {
        return { ok: false, error: "expires_at must be an ISO date or unix timestamp" };
    }
    const numeric = typeof value === "number" ? value : Number(value);
    const parsed = Number.isFinite(numeric) && String(value).trim() !== ""
        ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric)
        : new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return { ok: false, error: "expires_at must be an ISO date or unix timestamp" };
    }
    if (parsed.getTime() <= now.getTime()) {
        return { ok: false, error: "expires_at must be in the future" };
    }
    return { ok: true, value: parsed };
}
