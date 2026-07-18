import crypto from "node:crypto";

const DEFAULT_BASE_URL = "https://www.subscriptonarc.com";

/** Error thrown for any non-2xx API response. `body` holds the parsed error payload. */
export class SubScriptError extends Error {
    readonly status: number;
    readonly body: unknown;
    constructor(message: string, status: number, body: unknown) {
        super(message);
        this.name = "SubScriptError";
        this.status = status;
        this.body = body;
    }
}

export interface SubScriptOptions {
    /** Secret API key: `sk_test_…` (sandbox) or `sk_live_…` (production). */
    secretKey: string;
    /** Override the API base URL (defaults to https://www.subscriptonarc.com). */
    baseUrl?: string;
    /** Custom fetch implementation (defaults to global fetch; Node >=18). */
    fetchImpl?: typeof fetch;
}

/* ------------------------------- Amount helpers ------------------------------ */

/** Convert a decimal USDC amount (e.g. 15 or "15.50") to canonical integer micro-USDC. */
export function usdc(amount: number | string): string {
    // Parse the decimal string exactly — floating-point math (Number * 1e6) silently loses
    // precision and rounds, which would change the amount before it reaches the API.
    const raw = typeof amount === "number" ? amount.toString() : amount.trim();
    const match = raw.match(/^(\d+)(?:\.(\d+))?$/);
    if (!match) throw new Error(`Invalid USDC amount: ${amount}`);
    const [, whole, frac = ""] = match;
    if (frac.length > 6) throw new Error(`USDC supports at most 6 decimal places: ${amount}`);
    return BigInt(`${whole}${frac.padEnd(6, "0")}`).toString();
}

/** Convert integer micro-USDC to a decimal USDC string. */
export function fromMicros(micros: string | bigint | number): string {
    const b = typeof micros === "bigint" ? micros : BigInt(micros);
    const whole = b / 1_000_000n;
    const frac = (b % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
    return frac ? `${whole}.${frac}` : whole.toString();
}

/* ------------------------------ Webhook helpers ------------------------------ */

/** Verify an `x-subscript-signature` header (`t=…,v1=…`) against the raw body and secret. */
export function verifyWebhookSignature(
    rawBody: string,
    signatureHeader: string,
    secret: string,
    toleranceSeconds = 300
): boolean {
    if (!signatureHeader || !secret) return false;
    let t = "";
    let v1 = "";
    for (const part of signatureHeader.split(",")) {
        const [k, val] = part.split("=");
        if (k === "t") t = val;
        if (k === "v1") v1 = val;
    }
    if (!t || !v1) return false;
    const ts = Number.parseInt(t, 10);
    if (Number.isNaN(ts) || Math.abs(Math.floor(Date.now() / 1000) - ts) > toleranceSeconds) return false;
    const expected = crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
    const a = Buffer.from(v1, "hex");
    const b = Buffer.from(expected, "hex");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ---------------------------------- Types ------------------------------------ */

export interface Intent {
    id: string;
    object: "payment_intent";
    paymentType: "one_time";
    appearsInDmPlanPicker: false;
    checkoutSessionId?: string;
    title: string;
    description?: string | null;
    amountUsdcMicros: string;
    amountUsdc: string;
    status: string;
    merchantAddress: string;
    receiptToken?: string | null;
    checkoutUrl: string;
    chainId: number;
    usdcAddress: string;
    returnUrls?: { successUrl?: string; cancelUrl?: string };
    latestPayment?: {
        txHash: string | null;
        payerAddress: string;
        credited: boolean;
        explorerUrl?: string | null;
    } | null;
    [key: string]: unknown;
}

export interface CreateIntentParams {
    /**
     * One-time payments only. For recurring products use `plans.create` or
     * `subscriptions.create`; payment intents never appear in the DM plan picker.
     */
    title: string;
    amountUsdcMicros: string | bigint | number;
    description?: string;
    externalReference?: string;
    maxUses?: number;
    expiresAt?: number | string;
    successUrl?: string;
    cancelUrl?: string;
    idempotencyKey?: string;
    /** Required only when recurring-looking wording is intentionally describing a one-time pass. */
    confirmOneTime?: boolean;
    sandbox?: boolean;
}

export interface Plan {
    id: string;
    object: "plan";
    name: string;
    description?: string | null;
    detailsUrl?: string | null;
    merchantAddress: string;
    amountUsdc: string;
    amountUsdcMicros: string;
    periodSeconds: number;
    minCommitmentSeconds: number;
    active: boolean;
    subscribeUrl: string;
    createdAt: string;
    [key: string]: unknown;
}

export interface CreatePlanParams {
    name: string;
    amountUsdcMicros: string | bigint | number;
    periodDays?: number;
    intervalSeconds?: number;
    description?: string;
    detailsUrl?: string;
    minCommitmentDays?: number;
}

export interface UpdatePlanParams {
    planId: string;
    active?: boolean;
    description?: string | null;
    detailsUrl?: string | null;
}

export interface Subscription {
    id: string;
    object: "subscription";
    status: "incomplete" | "active" | "inactive" | "past_due" | "canceled";
    merchantAddress?: string;
    subscriber?: string | null;
    amountUsdcMicros: string;
    amountUsdc: string;
    intervalSeconds?: number;
    intervalCount?: number;
    interval?: string | null;
    planId?: string | null;
    merchantCustomerId?: string | null;
    externalReference?: string | null;
    checkoutUrl?: string;
    cancelAtPeriodEnd?: boolean;
    [key: string]: unknown;
}

export interface CreateSubscriptionParams {
    amountUsdcMicros?: string | bigint | number;
    planId?: string;
    interval?: "daily" | "weekly" | "monthly" | "yearly";
    intervalSeconds?: number;
    intervalCount?: number;
    subscriber?: string;
    /** API-created plans publish to the merchant catalog/DM picker by default; set false to opt out. */
    publishToDm?: boolean;
    title?: string;
    /** Merchant-owned customer/account identifier persisted through subscription lifecycle webhooks. */
    merchantCustomerId?: string;
    /** Backwards-compatible alias for merchantCustomerId. Values must match if both are supplied. */
    externalReference?: string;
    idempotencyKey?: string;
    sandbox?: boolean;
}

export interface ReportUsageParams {
    userAddress: string;
    amountUsdcMicros: string | bigint | number;
}

export interface VaultStatus {
    success: boolean;
    exists: boolean;
    active: boolean;
    code: "NO_VAULT" | "VAULT_ACTIVE" | "VAULT_INACTIVE" | string;
    userAddress?: string;
    merchantAddress?: string;
    vault?: {
        id: string;
        userAddress: string;
        merchantAddress: string;
        active: boolean;
        balanceUsdc: string;
        commitUsdc: string;
        owedUsdc: string;
        accruedUsageUsdc: string;
        remainingUsdc: string;
        [key: string]: unknown;
    };
    onboarding?: { dashboardUrl: string; action: string } | null;
}

export interface WebhookEvent {
    id: string;
    type: string;
    event?: string;
    created: number;
    data: Record<string, unknown>;
}

function stringifyMicros<T extends { amountUsdcMicros?: string | bigint | number }>(params: T): T {
    if (!params || params.amountUsdcMicros == null) return params;
    const micros = typeof params.amountUsdcMicros === "bigint"
        ? params.amountUsdcMicros.toString()
        : String(params.amountUsdcMicros).trim();
    // Enforce the public contract: digits-only integer micro-USDC (reject "1.5", "1e21", etc.).
    if (!/^\d+$/.test(micros)) {
        throw new Error(`Invalid amountUsdcMicros: ${params.amountUsdcMicros}`);
    }
    return { ...params, amountUsdcMicros: micros };
}

/* --------------------------------- Client ------------------------------------ */

export class SubScript {
    private readonly secretKey: string;
    private readonly baseUrl: string;
    private readonly fetchImpl: typeof fetch;

    constructor(options: SubScriptOptions) {
        if (!options?.secretKey) throw new Error("SubScript: `secretKey` is required");
        this.secretKey = options.secretKey;
        this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
        const f = options.fetchImpl ?? globalThis.fetch;
        if (!f) throw new Error("SubScript: no global fetch available — pass `fetchImpl` or use Node >=18");
        this.fetchImpl = f;
    }

    private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
        const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
            method,
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.secretKey}`,
            },
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        const text = await res.text();
        let json: unknown;
        try {
            json = text ? JSON.parse(text) : {};
        } catch {
            json = { raw: text };
        }
        if (!res.ok) {
            const message = (json as { error?: string })?.error ?? `SubScript request failed (${res.status})`;
            throw new SubScriptError(message, res.status, json);
        }
        return json as T;
    }

    /** One-time payment intents only. These never become recurring plans or DM plan options. */
    readonly intents = {
        create: (params: CreateIntentParams): Promise<Intent> =>
            this.request<{ intent: Intent }>("POST", "/api/intent", stringifyMicros(params)).then((r) => r.intent),
        retrieve: (id: string): Promise<Intent> =>
            this.request<{ intent: Intent }>("GET", `/api/intent/${encodeURIComponent(id)}`).then((r) => r.intent),
    };

    /** Reusable recurring catalog plans shown in the merchant dashboard and user DM picker. */
    readonly plans = {
        create: (params: CreatePlanParams): Promise<Plan> =>
            this.request<{ plan: Plan }>("POST", "/api/v1/plans", stringifyMicros(params)).then((r) => r.plan),
        list: (params?: { active?: boolean }): Promise<Plan[]> =>
            this.request<{ data: Plan[] }>(
                "GET",
                `/api/v1/plans${params?.active === undefined ? "" : `?active=${params.active}`}`,
            ).then((r) => r.data),
        update: (params: UpdatePlanParams): Promise<Plan> =>
            this.request<{ plan: Plan }>("PATCH", "/api/v1/plans", params).then((r) => r.plan),
    };

    /** Recurring subscriptions. */
    readonly subscriptions = {
        create: (params: CreateSubscriptionParams): Promise<Subscription> =>
            this.request<{ subscription: Subscription }>("POST", "/api/v1/subscriptions", stringifyMicros(params)).then((r) => r.subscription),
        retrieve: (id: string): Promise<Subscription> =>
            this.request<Subscription>("GET", `/api/v1/subscriptions?id=${encodeURIComponent(id)}`),
        list: (params?: { subscriber?: string }): Promise<Subscription[]> =>
            this.request<{ data: Subscription[] }>(
                "GET",
                `/api/v1/subscriptions${params?.subscriber ? `?subscriber=${encodeURIComponent(params.subscriber)}` : ""}`
            ).then((r) => r.data),
        cancel: (id: string): Promise<Subscription> =>
            this.request<Subscription>("DELETE", `/api/v1/subscriptions?id=${encodeURIComponent(id)}`),
    };

    /** Metered usage reporting. */
    readonly usage = {
        report: (params: ReportUsageParams): Promise<Record<string, unknown>> =>
            this.request<Record<string, unknown>>("POST", "/api/user/vault/report-usage", stringifyMicros(params)),
        status: (userAddress: string): Promise<VaultStatus> =>
            this.request<VaultStatus>("GET", `/api/user/vault/status?userAddress=${encodeURIComponent(userAddress)}`),
    };

    /** Webhook signature verification (no network calls). */
    readonly webhooks = {
        verify: verifyWebhookSignature,
        /** Verify the signature and return the parsed event; throws SubScriptError if invalid. */
        constructEvent: (rawBody: string, signatureHeader: string, secret: string): WebhookEvent => {
            if (!verifyWebhookSignature(rawBody, signatureHeader, secret)) {
                throw new SubScriptError("Invalid webhook signature", 400, null);
            }
            return JSON.parse(rawBody) as WebhookEvent;
        },
    };
}

export default SubScript;
