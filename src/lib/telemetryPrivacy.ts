const PRIVATE_KEY = /^(?:pin|currentPin|newPin|otp|password|salt|pin_hash|token|stepUpToken|authorization|cookie|set-cookie|body|requestBody|x-step-up-token|x-transaction-pin-token)$/i;

export function redactFinancialCredentials<T>(event: T): T {
    const visit = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(visit);
        if (!value || typeof value !== "object") return value;
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, PRIVATE_KEY.test(key) ? "[Filtered]" : visit(item)]));
    };
    const cleaned = visit(event) as any;
    if (cleaned?.request && /\/api\/(?:user|merchant|execute-tx|auth)(?:\/|$)/.test(cleaned.request.url ?? "")) {
        delete cleaned.request.data;
        delete cleaned.request.cookies;
    }
    return cleaned as T;
}
