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
            "(sk_test_… for funded Arc testnet settlement, sk_live_… for production).",
    },
    servers: [{ url: "https://www.subscriptonarc.com" }],
    security: [{ bearerAuth: [] }],
    components: {
        securitySchemes: {
            bearerAuth: {
                type: "http",
                scheme: "bearer",
                description: "Secret API key: `Authorization: Bearer sk_test_…` (valueless Arc testnet settlement) or `sk_live_…` (production).",
            },
            dashboardSession: {
                type: "apiKey",
                in: "cookie",
                name: "subscript_session_token",
                description: "Signed merchant dashboard session. Webhook management endpoints also require an active Premium tier.",
            },
        },
        schemas: {
            Error: {
                type: "object",
                properties: {
                    error: { type: "string" },
                    code: { type: "string" },
                    request_id: { type: "string" },
                    doc_url: { type: "string", format: "uri" },
                },
                required: ["error"],
            },
            WebhookApiKeyLinkage: {
                type: "object",
                description: "Non-secret identity of the active wallet-scoped API key associated with webhook delivery.",
                properties: {
                    id: { type: "string", format: "uuid" },
                    publishableKey: { type: "string" },
                    fingerprint: {
                        type: "string",
                        description: "Redacted secret-key hint only. This is never a usable API secret.",
                    },
                    mode: { type: "string", enum: ["TEST", "LIVE"] },
                    createdAt: { type: "string", format: "date-time" },
                },
                required: ["id", "publishableKey", "fingerprint", "mode", "createdAt"],
            },
            WebhookDeliverySummary: {
                type: "object",
                properties: {
                    event: { type: ["string", "null"], description: "Webhook event type for this attempt." },
                    status: { type: ["integer", "null"], description: "Exact HTTP response status from the merchant server, or null before an attempt is recorded." },
                    responseBody: { type: ["string", "null"], description: "Exact response body returned by the merchant server." },
                    lastAttemptAt: { type: "string", format: "date-time" },
                    endpoint: { type: ["string", "null"], format: "uri" },
                    eventId: { type: "string" },
                },
            },
            WebhookEndpoint: {
                type: "object",
                properties: {
                    id: { type: "string", format: "uuid" },
                    walletAddress: { type: "string", description: "Merchant wallet that owns this endpoint and its API keys." },
                    url: { type: "string", format: "uri" },
                    secret: { type: "string", description: "Full signing secret on creation; redacted on later reads." },
                    secretAvailable: { type: "boolean", description: "True only when the full secret is present in this response." },
                    active: { type: "boolean" },
                    createdAt: { type: "string", format: "date-time" },
                    apiKey: {
                        oneOf: [
                            { $ref: "#/components/schemas/WebhookApiKeyLinkage" },
                            { type: "null" },
                        ],
                        description: "Current active API-key linkage for this merchant wallet; never contains a secret.",
                    },
                    latestDelivery: {
                        oneOf: [
                            { $ref: "#/components/schemas/WebhookDeliverySummary" },
                            { type: "null" },
                        ],
                    },
                },
            },
            WebhookEvent: {
                type: "object",
                properties: {
                    id: { type: "string" },
                    event: { type: "string" },
                    status: { type: "integer", description: "Exact HTTP response status." },
                    time: { type: "string", description: "Delivery attempt time." },
                    endpointUrl: { type: "string", format: "uri" },
                    payload: { type: "object", additionalProperties: true },
                    responseBody: { type: ["string", "null"] },
                },
            },
            ApiKey: {
                type: "object",
                properties: {
                    id: { type: "string", format: "uuid" },
                    walletAddress: { type: "string" },
                    publishableKey: { type: "string" },
                    mode: { type: "string", enum: ["test", "live"] },
                    secretKeyPlain: {
                        type: "string",
                        description: "Full `sk_…` secret only on creation; later reads return a non-sensitive hint.",
                    },
                    secretKeyAvailable: { type: "boolean" },
                    createdAt: { type: "string", format: "date-time" },
                    revoked: { type: "boolean" },
                },
            },
            Intent: {
                type: "object",
                properties: {
                    id: { type: "string", description: "Intent / checkout session id." },
                    object: { type: "string", const: "payment_intent" },
                    paymentType: { type: "string", const: "one_time" },
                    appearsInDmPlanPicker: { type: "boolean", const: false },
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
                    webhookDelivery: {
                        oneOf: [
                            { $ref: "#/components/schemas/WebhookDeliverySummary" },
                            { type: "null" },
                        ],
                        description: "Latest delivery health. Returned only to the authenticated merchant that owns the intent.",
                    },
                },
            },
            Plan: {
                type: "object",
                description: "Reusable recurring catalog plan shown in the merchant dashboard and user DM plan picker.",
                properties: {
                    id: { type: "string", format: "uuid" },
                    object: { type: "string", const: "plan" },
                    name: { type: "string" },
                    description: { type: ["string", "null"] },
                    detailsUrl: { type: ["string", "null"], format: "uri" },
                    merchantAddress: { type: "string" },
                    amountUsdc: { type: "string", description: "Decimal USDC." },
                    amountUsdcMicros: { type: "string", description: "Integer micro-USDC." },
                    periodSeconds: { type: "integer" },
                    minCommitmentSeconds: { type: "integer" },
                    active: { type: "boolean" },
                    subscribeUrl: { type: "string", format: "uri" },
                    createdAt: { type: "string", format: "date-time" },
                },
            },
            PaymentLink: {
                type: "object",
                properties: {
                    id: { type: "string", description: "Hosted payment-link id." },
                    merchant_address: { type: "string" },
                    beneficiary_address: {
                        type: ["string", "null"],
                        description: "Registered SubScript USER whose account the merchant must fulfill after payment.",
                    },
                    beneficiaryAddress: {
                        type: ["string", "null"],
                        description: "Camel-case alias of beneficiary_address.",
                    },
                    title: { type: "string" },
                    description: { type: ["string", "null"] },
                    amount_usdc: { type: "string", description: "Integer micro-USDC." },
                    sandbox_mode: { type: "boolean", description: "True for resources created by an sk_test_ credential." },
                    simulation_only: { type: "boolean", description: "True only for non-settling shared demo resources." },
                    settlement_chain_id: { type: "integer", description: "The only chain on which this checkout may settle." },
                    receiptToken: { type: ["string", "null"] },
                    checkoutUrl: { type: "string", format: "uri" },
                    invoiceNumber: { type: ["string", "null"], description: "Invoice v1: shown on the hosted checkout page." },
                    dueDate: { type: ["string", "null"], format: "date-time" },
                    payerEmail: { type: ["string", "null"] },
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
                    merchantCustomerId: { type: ["string", "null"], description: "Merchant-owned customer/account binding." },
                    externalReference: { type: ["string", "null"], description: "Backwards-compatible alias for merchantCustomerId." },
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
                            payer_address: {
                                type: "string",
                                description: "Wallet that signed and settled the verified on-chain payment.",
                            },
                            beneficiary_address: {
                                type: "string",
                                description: "Registered USER account the merchant must fulfill; may differ from payer_address.",
                            },
                            chain_id: { type: "integer" },
                            usdc_address: { type: "string" },
                            explorer_url: { type: ["string", "null"], description: "Direct Arc explorer link to the tx." },
                        },
                    },
                },
            },
            SubscriptionWebhook: {
                type: "object",
                description:
                    "POSTed for subscription lifecycle events. Same signature scheme as payment webhooks " +
                    "(`x-subscript-signature: t=…,v1=…`, HMAC-SHA256 of `${t}.${rawBody}`). Canonical event name is `type`.",
                properties: {
                    id: { type: "string" },
                    type: {
                        type: "string",
                        enum: ["subscription.created", "subscription.updated", "subscription.renewed", "subscription.canceled", "subscription.payment_failed"],
                        description: "Canonical event name.",
                    },
                    event: { type: "string", description: "Back-compat alias of `type`." },
                    created: { type: "integer" },
                    data: {
                        type: "object",
                        properties: {
                            subscription_id: { type: "string" },
                            status: { type: "string", enum: ["incomplete", "active", "updated", "past_due", "canceled"] },
                            amount_usdc_micros: { type: ["string", "null"] },
                            currency: { type: "string", const: "USDC" },
                            subscriber: { type: ["string", "null"] },
                            merchant_address: { type: ["string", "null"] },
                            merchant_customer_id: { type: ["string", "null"], description: "Merchant-owned account binding supplied at API plan creation." },
                            external_reference: { type: ["string", "null"], description: "Alias of merchant_customer_id." },
                            source_checkout_id: { type: ["string", "null"], description: "Originating API checkout/offer id." },
                            beneficiary_address: { type: ["string", "null"], description: "Sponsored subscriptions: the wallet receiving the service when it differs from the paying subscriber. Key entitlements off this when present." },
                            reason: { type: "string", description: "Present on canceled/payment_failed events." },
                            transaction_hash: { type: ["string", "null"] },
                            chain_id: { type: "integer" },
                            explorer_url: { type: ["string", "null"] },
                            simulated: { type: "boolean", description: "true when fired by a sandbox test clock — never real settlement." },
                            test_clock_id: { type: "string", description: "Present when simulated." },
                        },
                    },
                },
            },
            TestClock: {
                type: "object",
                description: "Sandbox test clock (test keys only). Advancing it fires signed subscription.renewed webhooks for each period that becomes due.",
                properties: {
                    id: { type: "string", format: "uuid" },
                    name: { type: "string" },
                    frozenTime: { type: "string", format: "date-time" },
                    createdAt: { type: "string", format: "date-time" },
                    subscriptions: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                id: { type: "string", format: "uuid" },
                                name: { type: "string" },
                                amountUsdcMicros: { type: "string" },
                                intervalSeconds: { type: "string" },
                                subscriberLabel: { type: "string" },
                                lastRenewedAt: { type: ["string", "null"], format: "date-time" },
                                renewalsFired: { type: "integer" },
                            },
                        },
                    },
                },
            },
            VaultStatus: {
                type: "object",
                description: "Read-only status for one customer's metered vault with the authenticated merchant.",
                properties: {
                    success: { type: "boolean" },
                    exists: { type: "boolean" },
                    active: { type: "boolean" },
                    code: { type: "string", enum: ["NO_VAULT", "VAULT_ACTIVE", "VAULT_INACTIVE"] },
                    userAddress: { type: "string" },
                    merchantAddress: { type: "string" },
                    vault: {
                        type: ["object", "null"],
                        properties: {
                            id: { type: "string" },
                            userAddress: { type: "string" },
                            merchantAddress: { type: "string" },
                            active: { type: "boolean" },
                            balanceUsdc: { type: "string", description: "Integer micro-USDC." },
                            commitUsdc: { type: "string", description: "Integer micro-USDC required/committed." },
                            owedUsdc: { type: "string", description: "Integer micro-USDC owed before reactivation." },
                            accruedUsageUsdc: { type: "string", description: "Integer micro-USDC accrued this cycle." },
                            remainingUsdc: { type: "string", description: "Integer micro-USDC left before exhaustion." },
                        },
                    },
                    onboarding: {
                        type: ["object", "null"],
                        properties: {
                            dashboardUrl: { type: "string", format: "uri" },
                            action: { type: "string" },
                        },
                    },
                },
            },
        },
    },
    paths: {
        "/api/keys": {
            get: {
                summary: "List active merchant API keys",
                description:
                    "Dashboard-session endpoint for Premium merchants. Secret keys are never retrievable after their one-time creation response.",
                security: [{ dashboardSession: [] }],
                responses: {
                    "200": {
                        description: "OK",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        keys: {
                                            type: "array",
                                            items: { $ref: "#/components/schemas/ApiKey" },
                                        },
                                    },
                                },
                            },
                        },
                    },
                    "401": { description: "Signed-in merchant session required", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
                    "403": { description: "Active Premium tier required", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
                },
            },
            post: {
                summary: "Create an API key and optionally register its webhook",
                description:
                    "Rotates the merchant's API key and optionally registers `webhookUrl` in the same setup flow. The full API and webhook secrets are revealed once. Key creation is preserved if webhook registration fails; in that case the response includes `webhookWarning`.",
                security: [{ dashboardSession: [] }],
                requestBody: {
                    required: false,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    webhookUrl: {
                                        type: "string",
                                        format: "uri",
                                        description: "Optional public HTTPS receiver to register for this merchant wallet.",
                                    },
                                },
                            },
                        },
                    },
                },
                responses: {
                    "201": {
                        description: "Key created; copy every returned full secret now",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    required: ["key"],
                                    properties: {
                                        key: { $ref: "#/components/schemas/ApiKey" },
                                        webhookEndpoint: { $ref: "#/components/schemas/WebhookEndpoint" },
                                        webhookWarning: {
                                            type: "string",
                                            description: "Present when the key succeeded but endpoint registration did not.",
                                        },
                                    },
                                },
                            },
                        },
                    },
                    "400": { description: "Invalid or unsafe webhook URL", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
                    "401": { description: "Signed-in merchant session required", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
                    "403": { description: "Active Premium tier required", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
                },
            },
            delete: {
                summary: "Revoke an owned API key",
                security: [{ dashboardSession: [] }],
                parameters: [
                    { name: "id", in: "query", required: true, schema: { type: "string", format: "uuid" } },
                ],
                responses: {
                    "200": { description: "Revoked" },
                    "401": { description: "Signed-in merchant session required", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
                    "403": { description: "Key is not owned by this merchant, or Premium is inactive", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
                    "404": { description: "Key not found", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
                },
            },
        },
        "/api/payment-links": {
            post: {
                summary: "Create a hosted payment link",
                description:
                    "Set beneficiary_address for Pay For Me. The beneficiary must already be a registered USER, cannot be the merchant, and is returned in the signed payment.succeeded webhook for fulfillment.",
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["title", "amount_usdc"],
                                properties: {
                                    title: { type: "string" },
                                    description: { type: "string" },
                                    amount_usdc: { type: "string", description: "Integer micro-USDC." },
                                    beneficiary_address: {
                                        type: "string",
                                        description: "Registered USER wallet receiving the service or entitlement.",
                                    },
                                    external_reference: { type: "string" },
                                    idempotency_key: { type: "string" },
                                    max_uses: { type: "integer", minimum: 1, maximum: 10000 },
                                    expires_at: { type: ["integer", "string"] },
                                    invoice_number: { type: "string", maxLength: 64, description: "Invoice v1: shown on the hosted checkout page and rides the receipt/webhook lifecycle." },
                                    due_date: { type: ["integer", "string"], description: "Invoice due date (ISO date or unix timestamp)." },
                                    payer_email: { type: "string", format: "email" },
                                },
                            },
                        },
                    },
                },
                responses: {
                    "201": {
                        description: "Created",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        link: { $ref: "#/components/schemas/PaymentLink" },
                                    },
                                },
                            },
                        },
                    },
                    "400": { description: "Invalid or unregistered beneficiary", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
                    "401": { description: "Unauthorized", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
                },
            },
            get: {
                summary: "List this merchant's payment links",
                responses: {
                    "200": {
                        description: "OK",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        links: {
                                            type: "array",
                                            items: { $ref: "#/components/schemas/PaymentLink" },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
        "/api/intent": {
            post: {
                summary: "Create a one-time payment intent",
                description: "Creates a one-time hosted checkout. It never creates a recurring plan and never appears in the merchant dashboard or DM plan picker. Use `/api/v1/plans` for reusable recurring tiers and `/api/v1/subscriptions` to start recurring authorization. Recurring-only fields are rejected; recurring-looking titles require `confirmOneTime: true` when the purchase is intentionally a one-time pass.",
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["title"],
                                oneOf: [
                                    { required: ["amountUsdcMicros"] },
                                    { required: ["amountUsdc"] },
                                ],
                                properties: {
                                    title: { type: "string" },
                                    amountUsdcMicros: { type: "string", description: "Integer micro-USDC, e.g. \"15000000\"." },
                                    amountUsdc: { type: "string", description: "Alias of amountUsdcMicros." },
                                    description: { type: "string" },
                                    externalReference: { type: "string", maxLength: 256 },
                                    maxUses: { type: "integer", minimum: 1, maximum: 10000 },
                                    expiresAt: { type: ["integer", "string"], description: "Unix seconds/ms or ISO date." },
                                    successUrl: {
                                        type: "string",
                                        format: "uri",
                                        description:
                                            "https URL to return to after confirmed settlement. SubScript adds `subscript_status=success` and `subscript_verification_status=settled`; these do not prove webhook delivery or merchant fulfillment.",
                                    },
                                    cancelUrl: { type: "string", format: "uri", description: "https URL to return to on cancel." },
                                    idempotencyKey: { type: "string" },
                                    confirmOneTime: { type: "boolean", description: "Set true only to confirm that recurring-looking wording describes an intentional one-time purchase." },
                                    sandbox: { type: "boolean", description: "True for sk_test_ resources. Test mode settles valueless USDC on Arc Testnet; the shared public demo key is simulation-only." },
                                },
                            },
                        },
                    },
                },
                responses: {
                    "201": { description: "Created", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, intent: { $ref: "#/components/schemas/Intent" }, sandbox: { type: "boolean" }, simulationOnly: { type: "boolean" } } } } } },
                    "400": { description: "Bad request", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
                    "422": { description: "The product looks recurring; choose a plan/subscription endpoint or explicitly confirm a one-time pass.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
                    "401": { description: "Unauthorized", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
                },
            },
        },
        "/api/intent/status": {
            get: {
                summary: "Get a payment intent's status (legacy query form)",
                description: "Public aggregate status polling. Authenticate as the owning merchant to receive transaction proof and the latest webhook delivery health.",
                security: [{}, { bearerAuth: [] }, { dashboardSession: [] }],
                parameters: [{ name: "id", in: "query", required: true, schema: { type: "string" } }],
                responses: {
                    "200": { description: "OK", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, intent: { $ref: "#/components/schemas/Intent" } } } } } },
                    "404": { description: "Not found", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
                },
            },
        },
        "/api/intent/{id}": {
            get: {
                summary: "Get a payment intent's status",
                description: "Pollable read endpoint for agents and backends that need to reconcile without waiting for a webhook. Public calls receive aggregate status; the authenticated owning merchant also receives transaction proof and `webhookDelivery`. Return URLs are intentionally not exposed.",
                security: [{}, { bearerAuth: [] }, { dashboardSession: [] }],
                parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
                responses: {
                    "200": { description: "OK", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, intent: { $ref: "#/components/schemas/Intent" } } } } } },
                    "404": { description: "Not found", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
                },
            },
        },
        "/api/v1/plans": {
            get: {
                summary: "List recurring catalog plans",
                description: "Lists the same merchant plan catalog shown in the dashboard and user DM plan picker.",
                parameters: [
                    { name: "active", in: "query", required: false, schema: { type: "boolean" } },
                ],
                responses: {
                    "200": { description: "OK", content: { "application/json": { schema: { type: "object", properties: { object: { type: "string", const: "list" }, data: { type: "array", items: { $ref: "#/components/schemas/Plan" } } } } } } },
                    "401": { description: "Unauthorized", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
                },
            },
            post: {
                summary: "Create a reusable recurring catalog plan",
                description: "Creates a plan that immediately appears in the merchant dashboard and in the plan controls of existing user DM threads with this merchant.",
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["name"],
                                oneOf: [
                                    { required: ["amountUsdcMicros"] },
                                    { required: ["amountUsdc"] },
                                ],
                                anyOf: [
                                    { required: ["periodDays"] },
                                    { required: ["intervalSeconds"] },
                                ],
                                properties: {
                                    name: { type: "string", maxLength: 60 },
                                    amountUsdcMicros: { type: "string", description: "Recurring charge per period in integer micro-USDC." },
                                    amountUsdc: { type: "string", description: "Decimal USDC alias." },
                                    periodDays: { type: "integer", minimum: 1, maximum: 366 },
                                    intervalSeconds: { type: "integer", minimum: 86400, maximum: 31622400 },
                                    description: { type: "string", maxLength: 300 },
                                    detailsUrl: { type: "string", format: "uri" },
                                    minCommitmentDays: { type: "integer", minimum: 0, maximum: 30 },
                                },
                            },
                        },
                    },
                },
                responses: {
                    "201": { description: "Created and DM-visible", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, plan: { $ref: "#/components/schemas/Plan" } } } } } },
                    "400": { description: "Bad request", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
                    "401": { description: "Unauthorized", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
                },
            },
            patch: {
                summary: "Update plan visibility or descriptive fields",
                description: "Price and period are immutable. Set `active: false` to remove a plan from DM choices; create a new plan for new financial terms.",
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["planId"],
                                properties: {
                                    planId: { type: "string", format: "uuid" },
                                    active: { type: "boolean" },
                                    description: { type: ["string", "null"], maxLength: 300 },
                                    detailsUrl: { type: ["string", "null"], format: "uri" },
                                },
                            },
                        },
                    },
                },
                responses: {
                    "200": { description: "Updated", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, plan: { $ref: "#/components/schemas/Plan" } } } } } },
                    "400": { description: "Bad request", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
                    "404": { description: "Plan not found", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
                },
            },
        },
        "/api/v1/subscriptions": {
            post: {
                summary: "Create a subscription",
                description: "Returns an `incomplete` subscription with a `checkoutUrl`; it becomes `active` once the subscriber authorizes it on-chain. Supply `planId`, or an amount (`amountUsdcMicros`) plus an interval (`interval` named, or `intervalSeconds`). API-created products publish to the merchant catalog by default; subscriber-assigned products are visible only to that subscriber.",
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
                                    subscriber: { type: "string", description: "Optional 0x subscriber address. Required when merchantCustomerId or externalReference is supplied." },
                                    title: { type: "string" },
                                    merchantCustomerId: { type: "string", maxLength: 256, description: "Recommended merchant-owned customer/account identifier. Persisted on the active subscription and lifecycle webhooks." },
                                    externalReference: { type: "string", maxLength: 256, description: "Backwards-compatible alias for merchantCustomerId; both must match if supplied together." },
                                    publishToDm: {
                                        type: "boolean",
                                        default: true,
                                        description:
                                            "Important: keep true when this recurring product must appear in the merchant dashboard and DM plan flow. Subscriber-assigned plans are targeted to that wallet; set false only for an intentionally private checkout.",
                                    },
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
                summary: "Withdraw an unaccepted subscription checkout",
                description: "`sub_<uuid>` cancels a not-yet-activated checkout session. Active `sub_<number>` authorizations are customer-controlled and return 403.",
                parameters: [{ name: "id", in: "query", required: true, schema: { type: "string" } }],
                responses: {
                    "200": { description: "Canceled", content: { "application/json": { schema: { $ref: "#/components/schemas/Subscription" } } } },
                    "403": { description: "Only the subscriber can cancel an active subscription", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
                    "404": { description: "Not found", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
                },
            },
        },
        "/api/webhooks/endpoints": {
            get: {
                summary: "List webhook endpoints and delivery health",
                description:
                    "Dashboard-session endpoint for Premium merchants. Shows which merchant wallet owns each endpoint, whether it is active, and its latest delivery result.",
                security: [{ dashboardSession: [] }],
                responses: {
                    "200": {
                        description: "OK",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        merchant: {
                                            type: "object",
                                            properties: {
                                                walletAddress: { type: "string" },
                                                apiKey: {
                                                    oneOf: [
                                                        { $ref: "#/components/schemas/WebhookApiKeyLinkage" },
                                                        { type: "null" },
                                                    ],
                                                },
                                            },
                                            required: ["walletAddress", "apiKey"],
                                        },
                                        endpoints: {
                                            type: "array",
                                            items: { $ref: "#/components/schemas/WebhookEndpoint" },
                                        },
                                    },
                                    required: ["merchant", "endpoints"],
                                },
                            },
                        },
                    },
                    "401": { description: "Signed-in merchant session required", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
                    "403": { description: "Active Premium tier required", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
                },
            },
            post: {
                summary: "Register a webhook endpoint",
                description:
                    "Registers an endpoint for the signed-in merchant wallet. The full `whsec_…` signing secret is returned once; later list responses redact it.",
                security: [{ dashboardSession: [] }],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["url"],
                                properties: {
                                    url: { type: "string", format: "uri", description: "Public HTTPS webhook receiver URL." },
                                },
                            },
                        },
                    },
                },
                responses: {
                    "201": {
                        description: "Registered; persist the returned signing secret now",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        endpoint: { $ref: "#/components/schemas/WebhookEndpoint" },
                                    },
                                },
                            },
                        },
                    },
                    "400": { description: "Invalid or unsafe endpoint URL", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
                    "401": { description: "Signed-in merchant session required", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
                    "403": { description: "Active Premium tier required", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
                },
            },
            delete: {
                summary: "Delete an owned webhook endpoint",
                security: [{ dashboardSession: [] }],
                parameters: [
                    { name: "id", in: "query", required: true, schema: { type: "string", format: "uuid" } },
                ],
                responses: {
                    "200": { description: "Deleted" },
                    "401": { description: "Signed-in merchant session required", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
                    "403": { description: "Endpoint is not owned by this merchant, or Premium is inactive", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
                    "404": { description: "Endpoint not found", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
                },
            },
        },
        "/api/webhooks/events": {
            get: {
                summary: "List recent webhook delivery attempts",
                description:
                    "Returns the latest 50 delivery attempts for the signed-in merchant, including the exact endpoint, HTTP status, response body, payload, and attempt time.",
                security: [{ dashboardSession: [] }],
                responses: {
                    "200": {
                        description: "OK",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        events: {
                                            type: "array",
                                            items: { $ref: "#/components/schemas/WebhookEvent" },
                                        },
                                    },
                                },
                            },
                        },
                    },
                    "401": { description: "Signed-in merchant session required", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
                    "403": { description: "Active Premium tier required", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
                },
            },
        },
        "/api/webhooks/events/replay": {
            post: {
                summary: "Resend a stored webhook event",
                description:
                    "Re-delivers the exact stored payload to its owned endpoint and records the new attempt. Supply exactly one of `eventId` or `latest: true`; pair `latest` with `endpointId` to select the latest delivery for one owned endpoint.",
                security: [{ dashboardSession: [] }],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                oneOf: [
                                    { required: ["eventId"] },
                                    {
                                        required: ["latest"],
                                        properties: { latest: { const: true } },
                                    },
                                ],
                                properties: {
                                    eventId: { type: "string", description: "Stored UUID or `evt_…` event id." },
                                    latest: { type: "boolean", description: "Set true to resend the latest stored delivery." },
                                    endpointId: {
                                        type: "string",
                                        format: "uuid",
                                        description: "Optional with `latest: true`; selects the latest delivery for this owned endpoint.",
                                    },
                                },
                            },
                        },
                    },
                },
                responses: {
                    "200": {
                        description: "Replay attempted; inspect `success` and `status` for the merchant response",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        success: { type: "boolean" },
                                        message: { type: "string" },
                                        status: { type: "integer" },
                                        eventId: { type: "string", format: "uuid", description: "New delivery-attempt row id." },
                                        originalEventId: { type: "string", description: "Stored event row that was replayed." },
                                    },
                                    required: ["success", "message", "status", "eventId", "originalEventId"],
                                },
                            },
                        },
                    },
                    "400": { description: "Invalid body, event id, endpoint id, or conflicting replay selectors", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
                    "401": { description: "Signed-in merchant session required", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
                    "403": { description: "Active Premium tier required", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
                    "404": { description: "Event or owned endpoint not found", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
                    "409": { description: "The selected webhook endpoint is inactive", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
                },
            },
        },
        "/api/webhooks/test": {
            post: {
                summary: "Send a signed test webhook",
                description:
                    "Sends an observable signed sample to one owned endpoint, or every active endpoint when `endpointId` is omitted. Test deliveries are stored in webhook event history.",
                security: [{ dashboardSession: [] }],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["eventType"],
                                properties: {
                                    eventType: {
                                        type: "string",
                                        enum: ["test", "payment.succeeded", "subscription.created"],
                                    },
                                    endpointId: {
                                        type: "string",
                                        format: "uuid",
                                        description: "Optional owned endpoint. Omit to test all active endpoints.",
                                    },
                                },
                            },
                        },
                    },
                },
                responses: {
                    "200": {
                        description: "Test delivery attempted",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        success: { type: "boolean" },
                                        eventId: { type: "string" },
                                        eventType: {
                                            type: "string",
                                            enum: ["test", "payment.succeeded", "subscription.created"],
                                        },
                                        dispatchedCount: { type: "integer" },
                                        deliveries: {
                                            type: "array",
                                            items: {
                                                type: "object",
                                                properties: {
                                                    endpointId: { type: "string", format: "uuid" },
                                                    endpointUrl: { type: "string", format: "uri" },
                                                    status: { type: "integer" },
                                                    responseBody: { type: ["string", "null"] },
                                                    success: { type: "boolean" },
                                                },
                                                required: ["endpointId", "endpointUrl", "status", "responseBody", "success"],
                                            },
                                        },
                                    },
                                    required: ["success", "eventId", "eventType", "dispatchedCount", "deliveries"],
                                },
                            },
                        },
                    },
                    "400": { description: "Invalid event type or endpoint id", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
                    "401": { description: "Signed-in merchant session required", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
                    "403": { description: "Active Premium tier required", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
                    "404": { description: "Active owned endpoint not found", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
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
        "/api/user/vault/status": {
            get: {
                summary: "Get a customer's metered vault status",
                description: "Read-only merchant endpoint. Use it before rendering a metered session to decide whether to grant access, show a re-commit prompt, or send the customer to their SubScript Commit screen.",
                parameters: [{ name: "userAddress", in: "query", required: true, schema: { type: "string" } }],
                responses: {
                    "200": { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/VaultStatus" } } } },
                    "400": { description: "Invalid user address", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
                    "401": { description: "Unauthorized", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
                },
            },
        },
        "/api/test/clocks": {
            post: {
                summary: "Create a sandbox test clock (test keys only)",
                description:
                    "Test clocks simulate the recurring-billing pipeline without waiting real time or touching the chain. Requires an sk_test_ key; live keys are rejected. Max 10 clocks per merchant.",
                requestBody: {
                    required: false,
                    content: { "application/json": { schema: { type: "object", properties: { name: { type: "string", maxLength: 60 } } } } },
                },
                responses: {
                    "201": { description: "Created", content: { "application/json": { schema: { $ref: "#/components/schemas/TestClock" } } } },
                    "403": { description: "Live key used — test clocks are sandbox-only", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
                },
            },
            get: {
                summary: "List this merchant's test clocks",
                responses: { "200": { description: "OK", content: { "application/json": { schema: { type: "object", properties: { clocks: { type: "array", items: { $ref: "#/components/schemas/TestClock" } } } } } } } },
            },
        },
        "/api/test/clocks/{id}": {
            get: {
                summary: "Read one test clock (with simulated subscriptions)",
                parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
                responses: { "200": { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/TestClock" } } } } },
            },
            delete: {
                summary: "Delete a test clock and its simulated subscriptions",
                parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
                responses: { "200": { description: "Deleted" } },
            },
        },
        "/api/test/clocks/{id}/subscriptions": {
            post: {
                summary: "Attach a simulated subscription to a test clock",
                parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
                requestBody: {
                    required: false,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    name: { type: "string", maxLength: 60 },
                                    amountUsdcMicros: { type: "string", description: "Integer micro-USDC (default 10000000 = 10 USDC)." },
                                    amountUsdc: { type: "number", description: "Decimal USDC alternative." },
                                    interval: { type: "string", enum: ["daily", "weekly", "monthly", "yearly"] },
                                    intervalSeconds: { type: "integer", minimum: 60 },
                                    subscriberLabel: { type: "string", maxLength: 64 },
                                },
                            },
                        },
                    },
                },
                responses: { "201": { description: "Created" } },
            },
        },
        "/api/test/clocks/{id}/advance": {
            post: {
                summary: "Advance a test clock — fires one subscription.renewed webhook per due period",
                description:
                    "Simulated events are delivered to your real (test) webhook endpoints with a valid signature, plus `simulated: true` and `test_clock_id` in the payload. Max 365 days and 50 events per call. Pair with `npx @subscriptonarc/cli listen` to watch them arrive locally.",
                parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
                requestBody: {
                    required: true,
                    content: { "application/json": { schema: { type: "object", properties: { days: { type: "number" }, seconds: { type: "number" } } } } },
                },
                responses: { "200": { description: "OK — includes eventsFired and per-subscription renewal counts" } },
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
        "subscription.created": {
            post: {
                summary: "Subscription created (awaiting on-chain activation)",
                requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/SubscriptionWebhook" } } } },
                responses: { "200": { description: "Return 2xx to acknowledge." } },
            },
        },
        "subscription.renewed": {
            post: {
                summary: "Subscription renewed (a billing cycle settled on-chain)",
                requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/SubscriptionWebhook" } } } },
                responses: { "200": { description: "Return 2xx to acknowledge." } },
            },
        },
        "subscription.payment_failed": {
            post: {
                summary: "Subscription renewal payment failed (dunning)",
                requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/SubscriptionWebhook" } } } },
                responses: { "200": { description: "Return 2xx to acknowledge." } },
            },
        },
        "subscription.canceled": {
            post: {
                summary: "Subscription canceled",
                requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/SubscriptionWebhook" } } } },
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
