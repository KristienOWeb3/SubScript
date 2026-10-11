export type TransactionPinChallenge = {
    challengeId: string;
    configured: boolean;
    operationId: string;
};

export type TransactionPinReview = { operation: string; details: unknown };
export type TransactionPinPrompt = (challenge: TransactionPinChallenge, review: TransactionPinReview, signal?: AbortSignal | null) => Promise<string>;

export type TransactionPinStatus = { required: boolean; configured: boolean; lockedUntil?: string | null; coolingOffUntil?: string | null };

const pendingAuthorizations = new Set<AbortController>();

/** Navigation invalidates the entire approval flow, including requests before the prompt opens. */
export function cancelPendingTransactionPinRequests(): void {
    for (const controller of pendingAuthorizations) controller.abort();
}

async function withTransactionPinCancellation<T>(signal: AbortSignal | null | undefined, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const requestSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    pendingAuthorizations.add(controller);
    try {
        requestSignal.throwIfAborted();
        return await operation(requestSignal);
    } finally {
        pendingAuthorizations.delete(controller);
    }
}

export async function readPinResponse(response: Response): Promise<Record<string, any>> {
    const result = await response.json().catch(() => null);
    if (!result || typeof result !== "object" || Array.isArray(result)) {
        throw new Error("PIN verification service is unavailable. Please refresh the page and retry.");
    }
    return result;
}

export async function readTransactionPinStatus(response: Response): Promise<TransactionPinStatus> {
    const result = await readPinResponse(response);
    if (!response.ok) throw new Error(result.error || "Unable to load transaction PIN status. Please retry.");
    if (!result || typeof result.configured !== "boolean"
        || (result.required !== undefined && typeof result.required !== "boolean")
        || [result.lockedUntil, result.coolingOffUntil].some(value => value != null && (typeof value !== "string" || !Number.isFinite(Date.parse(value))))) {
        throw new Error("Unable to load transaction PIN status. Please retry.");
    }
    // Old servers required PINs universally. A missing flag never grants an exemption.
    return { ...result, configured: result.configured, required: result.required ?? true };
}

/** Enrollment is checked before submission; transaction-specific authorization stays server-side. */
export async function ensureTransactionPinSetup(signal?: AbortSignal | null, prompt?: TransactionPinPrompt): Promise<void> {
    return withTransactionPinCancellation(signal, current => checkTransactionPinSetup(current, prompt));
}

async function checkTransactionPinSetup(signal: AbortSignal, prompt?: TransactionPinPrompt): Promise<void> {
    signal.throwIfAborted();
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
    const status = await readTransactionPinStatus(await fetch("/api/user/transaction-pin", { cache: "no-store", signal: requestSignal }));
    signal.throwIfAborted();
    if (!status.required || status.configured) return;
    const ask = prompt ?? (await import("@/components/TransactionPinPrompt")).promptTransactionPin;
    signal.throwIfAborted();
    await ask({ configured: false, challengeId: "", operationId: "" }, { operation: "Set up your transaction PIN", details: null }, signal);
    // Enrollment never authorizes or automatically replays the original transaction.
    throw new DOMException("Set up your transaction PIN, then retry this transaction.", "AbortError");
}

function requiresSetup(input: string, init: RequestInit): boolean {
    const pathname = new URL(input, "https://subscriptonarc.com").pathname;
    let body: Record<string, unknown> | null = null;
    try {
        const value = typeof init.body === "string" ? JSON.parse(init.body) : null;
        if (value && typeof value === "object" && !Array.isArray(value)) body = value;
    } catch { /* The server validates malformed payloads. */ }
    // Keep emergency brakes accessible, matching the server's existing PIN exemptions.
    if (pathname === "/api/user/subscription/cancel" || pathname === "/api/user/vault/cancel-service") return false;
    if (["/api/user/commit/halt", "/api/user/commit/sub-users/pause"].includes(pathname) && init.method?.toUpperCase() === "POST") return false;
    if (pathname === "/api/user/vault/shares/status" && ["pause", "revoke", "withdraw"].includes(String(body?.action))) return false;
    if (pathname === "/api/merchant/payroll" && init.method?.toUpperCase() === "PUT" && body?.action === "PAUSE") return false;
    if (pathname === "/api/execute-tx" && body?.action === "cancelSubscription") return false;
    // Limit changes are evaluated against stored authority by the server; caller claims cannot decide.
    if (["/api/user/vault/shares", "/api/user/commit/sub-users"].includes(pathname) && init.method?.toUpperCase() === "PATCH") return false;
    if (pathname === "/api/user/account") return false;
    if (pathname === "/api/user/settings") {
        return Boolean(body && Object.hasOwn(body, "payoutDestination"));
    }
    return true;
}

function maskCredentials(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(maskCredentials);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /^(?:pin|currentPin|password|secret|accessToken|stepUpToken|token|signature|privateKey|salt)$/i.test(key) ? "[hidden]" : maskCredentials(item)]));
    return value;
}

/** A challenge retry is the same operation, including its exact serialized body. */
export async function fetchWithTransactionPin(
    input: string,
    init: RequestInit = {},
    review?: TransactionPinReview,
    prompt?: TransactionPinPrompt,
): Promise<Response> {
    if (!init.method || ["GET", "HEAD", "OPTIONS"].includes(init.method.toUpperCase())) return fetch(input, init);
    return withTransactionPinCancellation(init.signal, async signal => {
        if (requiresSetup(input, init)) await checkTransactionPinSetup(signal, prompt);
        signal.throwIfAborted();
        const headers = new Headers(init.headers);
        const operationId = headers.get("x-transaction-operation-id") || headers.get("x-request-id") || crypto.randomUUID();
        headers.set("x-transaction-operation-id", operationId);
        const response = await fetch(input, { ...init, headers, signal });
        signal.throwIfAborted();
        if (response.status !== 428) return response;
        const challenge = await response.clone().json().catch(() => null);
        signal.throwIfAborted();
        if (challenge?.code !== "TRANSACTION_PIN_REQUIRED" || typeof challenge.challengeId !== "string") return response;
        let details: unknown = null;
        if (typeof init.body === "string") {
            try { details = JSON.parse(init.body); } catch { details = init.body; }
        }
        const requestReview = review ? { ...review, details: maskCredentials(review.details) } : {
            operation: input.startsWith("/api/user/wallet/send") ? "Send USDC" : input.split("?")[0].replace(/^\/api\/(?:user\/|merchant\/)?/, "").replaceAll("/", " · "),
            details: maskCredentials({ parameters: Object.fromEntries(new URL(input, "https://subscriptonarc.com").searchParams), request: details }),
        };
        const ask = prompt ?? (await import("@/components/TransactionPinPrompt")).promptTransactionPin;
        signal.throwIfAborted();
        const token = await ask({ ...challenge, operationId }, requestReview, signal);
        signal.throwIfAborted();
        const authorizedHeaders = new Headers(headers);
        authorizedHeaders.set("x-transaction-pin-token", token);
        const authorizedResponse = await fetch(input, { ...init, headers: authorizedHeaders, signal });
        signal.throwIfAborted();
        return authorizedResponse;
    });
}
