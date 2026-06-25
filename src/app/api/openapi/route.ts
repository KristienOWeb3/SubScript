import { NextResponse } from "next/server";

/* Machine-readable contract for the public SubScript payments API. Served at /openapi.json
   (via a rewrite) and /api/openapi with permissive CORS so SDK generators, Postman, Swagger,
   and AI agents can consume it directly. Keep this in sync with the route handlers. */
const spec = {
    openapi: "3.1.0",
    info: {
        title: "SubScript API",
        version: "1.0.0",
        description:
            "Programmable USDC payments on Arc — one-time intents, subscriptions, metered usage, and signed webhooks. " +
            "Amounts are canonical integer micro-USDC (1 USDC = 1000000). Authenticate with a Bearer secret key " +
            "(sk_test_… for sandbox, sk_live_… for production).",
    },
    servers: [{ url: "https://www.subscriptonarc.com" }],
    security: [{ bearerAuth: [] }],
    components: {
        securitySchemes: {
            bearerAuth: {
                type: "http",
                scheme: "bearer",
                description: "Secret API key: `Authorization: Bearer sk_test_…` (sandbox) or `sk_live_…` (production).",
            },
        },
        schemas: {
            Error: {
                type: "object",
                properties: { error: { type: "string" } },
                required: ["error"],
            },
            Intent: {
                type: "object",
                properties: {
                    id: { type: "string", description: "Intent / checkout session id." },
                    checkoutSessionId: { type: "string" },
                    title: { type: "string" },
                    description: { type: ["string", "null"] },
                    amountUsdcMicros: { type: "string", description: "Canonical integer micro-USDC." },
                    amountUsdc: { type: "string", description: "Alias of amountUsdcMicros (integer micro-USDC)." },
                    status: { type: "string", enum: ["PENDING", "PAID", "EXPIRED", "EXHAUSTED", "INACTIVE"] },
                    merchantAddress: { type: "string" },
                    receiptToken: { type: ["string", "null"] },
                    checkoutUrl: { type: "string", format: "uri" },
                    chainId: { type: "integer", description: "Arc chain id (5042002 testnet)." },
                    usdcAddress: { type: "string", description: "USDC contract used for settlement." },
                    returnUrls: {
                        type: "object",
                        properties: { successUrl: { type: "string" }, cancelUrl: { type: "string" } },
                    },
                },
            },
            Subscription: {
                type: "object",
                properties: {
                    id: { type: "string", description: "sub_<id>." },
                    object: { type: "string", const: "subscription" },
                    status: { type: "string", enum: ["incomplete", "active", "inactive", "canceled"] },
                    merchantAddress: { type: "string" },
                    subscriber: { type: ["string", "null"] },
                    amountUsdcMicros: { type: "string" },
                    amountUsdc: { type: "string" },
                    intervalSeconds: { type: "integer" },
                    intervalCount: { type: "integer" },
                    interval: { type: ["string", "null"], enum: ["daily", "weekly", "monthly", "yearly", null] },
                    checkoutUrl: { type: "string", format: "uri" },
                    cancelAtPeriodEnd: { type: "boolean" },
                },
            },
            PaymentSucceededWebhook: {
                type: "object",
                description:
                    "POSTed to your webhook URL. Signature header `x-subscript-signature: t=<unix>,v1=<hex>` is " +
                    "HMAC-SHA256 over `${t}.${rawBody}`. Canonical event name is `type`; `event` is a back-compat alias.",
                properties: {
                    id: { type: "string" },
                    type: { type: "string", const: "payment.succeeded", description: "Canonical event name." },
                    event: { type: "string", const: "payment.success", description: "Back-compat alias of `type`." },
                    created: { type: "integer" },
                    data: {
                        type: "object",
                        properties: {
                            intent_id: { type: "string" },
                            checkout_session_id: { type: "string" },
                            amount: { type: "string", description: "Decimal USDC." },
                            amount_usdc_micros: { type: "string", description: "Canonical integer micro-USDC." },
                            currency: { type: "string", const: "USDC" },
                            receipt_id: { type: ["string", "null"] },
                            transaction_hash: { type: "string" },
                            chain_id: { type: "integer" },
                            usdc_address: { type: "string" },
                            explorer_url: { type: ["string", "null"], description: "Direct Arc explorer link to the tx." },
                        },
                    },
                },
            },
        },
    },
    paths: {
        "/api/intent": {
            post: {
                summary: "Create a one-time payment intent",
                description: "Creates a hosted checkout. `amountUsdcMicros` is canonical integer micro-USDC (`amountUsdc` is an accepted alias).",
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["title", "amountUsdcMicros"],
                                properties: {
                                    title: { type: "string" },
                                    amountUsdcMicros: { type: "string", description: "Integer micro-USDC, e.g. \"15000000\"." },
                                    amountUsdc: { type: "string", description: "Alias of amountUsdcMicros." },
                                    description: { type: "string" },
                                    externalReference: { type: "string", maxLength: 256 },
                                    maxUses: { type: "integer", minimum: 1, maximum: 10000 },
                                    expiresAt: { type: ["integer", "string"], description: "Unix seconds/ms or ISO date." },
                                    successUrl: { type: "string", format: "uri", description: "https URL to return to after payment." },
                                    cancelUrl: { type: "string", format: "uri", description: "https URL to return to on cancel." },
                                    idempotencyKey: { type: "string" },
                                    sandbox: { type: "boolean" },
                                },
                            },
                        },
                    },
                },
                responses: {
                    "201": { description: "Created", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, intent: { $ref: "#/components/schemas/Intent" }, sandbox: { type: "boolean" } } } } } },
                    "400": { description: "Bad request", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
                    "401": { description: "Unauthorized", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
                },
            },
        },
        "/api/intent/status": {
            get: {
                summary: "Get a payment intent's status",
                security: [],
                parameters: [{ name: "id", in: "query", required: true, schema: { type: "string" } }],
                responses: {
                    "200": { description: "OK", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, intent: { $ref: "#/components/schemas/Intent" } } } } } },
                    "404": { description: "Not found", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
                },
            },
        },
        "/api/v1/subscriptions": {
            post: {
                summary: "Create a subscription",
                description: "Returns an `incomplete` subscription with a `checkoutUrl`; it becomes `active` once the subscriber authorizes it on-chain. Supply `planId`, or an amount (`amountUsdcMicros`) plus an interval (`interval` named, or `intervalSeconds`).",
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    planId: { type: "string", description: "A merchant plan id supplying amount + period." },
                                    amountUsdcMicros: { type: "string" },
                                    amountUsdc: { type: "string", description: "Decimal alias, e.g. \"15.00\"." },
                                    interval: { type: "string", enum: ["daily", "weekly", "monthly", "yearly"] },
                                    intervalSeconds: { type: "integer", minimum: 1 },
                                    intervalCount: { type: "integer", minimum: 1, maximum: 365, default: 1 },
                                    subscriber: { type: "string", description: "Optional 0x subscriber address." },
                                    title: { type: "string" },
                                    externalReference: { type: "string", maxLength: 256 },
                                    idempotencyKey: { type: "string" },
                                    sandbox: { type: "boolean" },
                                },
                            },
                        },
                    },
                },
                responses: {
                    "201": { description: "Created", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, subscription: { $ref: "#/components/schemas/Subscription" }, sandbox: { type: "boolean" } } } } } },
                    "400": { description: "Bad request", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
                },
            },
            get: {
                summary: "Read or list subscriptions",
                description: "`?id=sub_<n>` reads one on-chain subscription; `?subscriber=0x…` lists a subscriber's on-chain subscriptions; no params lists this merchant's subscription checkout sessions.",
                parameters: [
                    { name: "id", in: "query", required: false, schema: { type: "string" } },
                    { name: "subscriber", in: "query", required: false, schema: { type: "string" } },
                ],
                responses: {
                    "200": { description: "OK", content: { "application/json": { schema: { oneOf: [{ $ref: "#/components/schemas/Subscription" }, { type: "object", properties: { object: { type: "string", const: "list" }, data: { type: "array", items: { $ref: "#/components/schemas/Subscription" } } } }] } } } },
                },
            },
            delete: {
                summary: "Cancel a subscription",
                description: "`sub_<uuid>` cancels a not-yet-activated checkout session; `sub_<number>` flags an on-chain subscription to cancel at period end.",
                parameters: [{ name: "id", in: "query", required: true, schema: { type: "string" } }],
                responses: {
                    "200": { description: "Canceled", content: { "application/json": { schema: { $ref: "#/components/schemas/Subscription" } } } },
                    "404": { description: "Not found", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
                },
            },
        },
        "/api/user/vault/report-usage": {
            post: {
                summary: "Report metered usage",
                description: "Accrues usage against a subscriber's vault. `amountUsdcMicros` is canonical integer micro-USDC (`amountUsdc` decimal is still accepted).",
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["userAddress"],
                                properties: {
                                    userAddress: { type: "string" },
                                    amountUsdcMicros: { type: "string", description: "Integer micro-USDC (canonical)." },
                                    amountUsdc: { type: "string", description: "Decimal USDC (legacy)." },
                                },
                            },
                        },
                    },
                },
                responses: {
                    "200": { description: "OK", content: { "application/json": { schema: { type: "object" } } } },
                    "402": { description: "Vault inactive or commit exhausted", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
                    "404": { description: "No vault", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
                },
            },
        },
    },
    webhooks: {
        "payment.succeeded": {
            post: {
                summary: "Payment succeeded",
                requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/PaymentSucceededWebhook" } } } },
                responses: { "200": { description: "Return 2xx to acknowledge." } },
            },
        },
    },
} as const;

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Cache-Control": "public, max-age=300",
};

export async function GET() {
    return NextResponse.json(spec, { headers: CORS });
}

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: CORS });
}
