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
