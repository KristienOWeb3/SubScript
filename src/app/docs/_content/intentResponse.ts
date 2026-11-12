/* Response field reference for POST /api/intent and GET /api/intent/:id. The developer page and its
   Markdown twin both render from these rows, so the two can't drift. Keep in step with
   src/app/api/intent/route.ts and src/lib/intentStatus.ts. */

export type FieldRow = readonly [field: string, type: string, meaning: string];

export const createResponseTopLevel: readonly FieldRow[] = [
  ["success", "boolean", "Always true on 200 and 201."],
  ["sandbox", "boolean", "true when an sk_test_ key created the intent. Set by the key, not by you."],
  ["simulationOnly", "boolean", "true only for the shared public demo key. Nothing settles."],
  ["intent", "object", "The checkout intent. Fields below."],
];

export const createResponseIntent: readonly FieldRow[] = [
  ["id", "string", "Checkout intent id. Store it next to your order. Webhooks carry it as data.intent_id."],
  ["checkoutSessionId", "string", "Same value as id. Kept for clients that name it a checkout session."],
  ["object", '"payment_intent"', "Always payment_intent on this endpoint."],
  ["paymentType", '"one_time"', "Always one_time. Recurring billing uses /api/v1/subscriptions."],
  ["appearsInDmPlanPicker", "boolean", "Always false. One-time intents never show up as DM plans."],
  ["title", "string", "The title you sent."],
  ["description", "string | null", "The description you sent, or null."],
  ["amountUsdcMicros", "integer string", 'Amount in six-decimal USDC micros. "15000000" = 15 USDC.'],
  ["amountUsdc", "integer string", "Legacy alias of amountUsdcMicros. Same value, also in micros."],
  ["merchantAddress", "address", "Your merchant wallet (lowercase)."],
  ["receiverAddress", "address | null", "Where the payment settles. Usually your merchant wallet."],
  ["status", '"PENDING"', "A new intent is always PENDING. Poll the status endpoint for later states."],
  ["receiptToken", "string", "Public receipt reference shown to the payer."],
  ["checkoutUrl", "URL", "Hosted checkout page. Redirect the payer here."],
  ["chainId", "integer", "Settlement chain. 5042 on Arc Mainnet, 5042002 on Arc Testnet (sk_test_)."],
  ["usdcAddress", "address", "USDC contract on that chain."],
  ["returnUrls", "object", "Only present when you sent successUrl or cancelUrl. Echoes them back."],
];

export const statusResponseIntent: readonly FieldRow[] = [
  ["id", "string", "Checkout intent id."],
  ["status", "string", "PENDING, PAID, EXPIRED, EXHAUSTED or INACTIVE. See the table below."],
  ["title", "string", "Checkout title."],
  ["description", "string | null", "Checkout description."],
  ["amountUsdcMicros", "integer string", "Amount in USDC micros."],
  ["amountUsdc", "integer string", "Legacy alias of amountUsdcMicros (also micros)."],
  ["merchantAddress", "address", "Owning merchant wallet."],
  ["maxUses", "integer | null", "Use limit you set, or null for no limit."],
  ["useCount", "integer", "Successful payments so far."],
  ["active", "boolean", "false once the merchant deactivates the checkout."],
  ["expiresAt", "ISO date | null", "When checkout stops accepting payment, or null."],
  ["checkoutUrl", "URL", "Hosted checkout page."],
  ["chainId", "integer", "Chain the latest payment settled on (or the intent's settlement chain)."],
  ["usdcAddress", "address", "USDC contract on that chain."],
  ["latestPayment", "object | null", "Owner only. Most recent payment, or null. Anonymous callers always get null."],
  ["latestPayment.id", "string", "Payment record id."],
  ["latestPayment.txHash", "string", "Settlement transaction hash."],
  ["latestPayment.payerAddress", "address", "Wallet that paid."],
  ["latestPayment.credited", "boolean", "true once the payment is verified and credited."],
  ["latestPayment.creditedAt", "ISO date | null", "When it was credited."],
  ["latestPayment.explorerUrl", "URL | null", "Block explorer link for txHash."],
  ["webhookDelivery", "object | null", "Owner only, and omitted entirely for everyone else. Last webhook attempt for this intent, or null."],
  ["webhookDelivery.status", "integer | null", "HTTP status your endpoint returned."],
  ["webhookDelivery.lastAttemptAt", "ISO date", "When SubScript last tried to deliver."],
  ["webhookDelivery.endpoint", "URL | null", "Endpoint it was sent to."],
  ["webhookDelivery.responseBody", "string | null", "What your endpoint answered (truncated)."],
  ["webhookDelivery.event", "string", "Event type, for example payment.succeeded."],
];

export const statusValues: readonly (readonly [status: string, meaning: string])[] = [
  ["PENDING", "Created and still accepting payment. Nothing has been credited yet."],
  ["PAID", "A payment was verified and credited. Wins over every other state."],
  ["EXPIRED", "expiresAt passed before anyone paid."],
  ["EXHAUSTED", "maxUses reached. No more payments accepted."],
  ["INACTIVE", "The merchant deactivated the checkout."],
];

const escapeCell = (value: string) => value.replace(/\|/g, "\\|");

/** Render rows as a Markdown table for the docs' .md twins. */
export function fieldTable(rows: readonly FieldRow[]) {
  return [
    "| Field | Type | Meaning |",
    "| --- | --- | --- |",
    ...rows.map(([field, type, meaning]) => `| \`${field}\` | ${escapeCell(type)} | ${escapeCell(meaning)} |`),
  ].join("\n");
}

export function statusTable() {
  return [
    "| Status | Meaning |",
    "| --- | --- |",
    ...statusValues.map(([status, meaning]) => `| \`${status}\` | ${meaning} |`),
  ].join("\n");
}
