/** Maps internal message-type enums to user-facing labels. */
export function humanStatus(messageType: string): string {
  const map: Record<string, string> = {
    DEBIT_SUCCESS: "Payment Received",
    PAYMENT: "Payment Sent",
    PEER_PAYMENT: "Peer Payment",
    PAYMENT_SUCCESS: "Payment Confirmed",
    PEER_TRANSFER: "Transfer",
    CREDIT_SUCCESS: "Credit Received",
    REFUND: "Refund",
    WITHDRAWAL: "Withdrawal",
    COMMIT_EXHAUSTED: "Commitment Exhausted",
    SUBSCRIPTION_OFFER: "Subscription Request",
    PEER_REQUEST: "Payment Request",
    SPONSORED_PLAN_REQUEST: "Subscription Request",
    /* Without these the fallback title-cases to "Auto Topup Success", which reads as a typo. */
    AUTO_TOPUP_SUCCESS: "Auto Top-up",
    AUTO_TOPUP_FAILED: "Auto Top-up Needs Attention",
  };

  return map[messageType] ?? messageType.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

/** Maps internal subscription status enums to user-facing labels. */
export function humanSubscriptionStatus(status: string): string {
  const map: Record<string, string> = {
    ACTIVE: "Active",
    CANCELLED: "Cancelled",
    PAST_DUE: "Past Due",
    PENDING: "Pending",
    PAUSED: "Paused",
    EXPIRED: "Expired",
    TRIAL: "Trial",
  };

  return map[status] ?? status.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

export type ReceiptStatus = "CONFIRMED" | "PENDING" | "FAILED";

/* Receipts reach the UI from several writers — the on-chain indexer, the payment-link verifier,
   and older rows that predate a settled vocabulary — so the stored string is not reliably
   "CONFIRMED". Comparing it raw made anything spelled differently (lowercase, or a synonym like
   COMPLETED / SUCCESS) render with the amber "pending" treatment even though the money had
   already moved. Normalising first means only genuinely unsettled rows read as pending. */
const CONFIRMED_STATUSES = new Set([
  "CONFIRMED",
  "COMPLETED",
  "COMPLETE",
  "SUCCESS",
  "SUCCEEDED",
  "SETTLED",
  "PAID",
  "CHAIN_CONFIRMED",
]);

const FAILED_STATUSES = new Set([
  "FAILED",
  "FAILURE",
  "ERROR",
  "REVERTED",
  "CANCELLED",
  "CANCELED",
  "REJECTED",
  "EXPIRED",
]);

/** Collapses any stored receipt status into the three states the UI actually renders. */
export function normalizeReceiptStatus(status: unknown): ReceiptStatus {
  const value = String(status ?? "").trim().toUpperCase();
  if (CONFIRMED_STATUSES.has(value)) return "CONFIRMED";
  if (FAILED_STATUSES.has(value)) return "FAILED";
  return "PENDING";
}
