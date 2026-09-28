export type TransactionDirection = "incoming" | "outgoing";

const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export function normalizeEvmAddress(address: string | null | undefined): string | null {
  if (typeof address !== "string") return null;
  const trimmed = address.trim();
  return EVM_ADDRESS_PATTERN.test(trimmed) ? trimmed.toLowerCase() : null;
}

export function classifyTransactionDirection(input: {
  authenticatedAddress?: string | null;
  fromAddress?: string | null;
  toAddress?: string | null;
  fallback?: TransactionDirection;
}): TransactionDirection | null {
  const authenticated = normalizeEvmAddress(input.authenticatedAddress);
  if (authenticated) {
    const recipient = normalizeEvmAddress(input.toAddress);
    if (recipient === authenticated) return "incoming";

    const sender = normalizeEvmAddress(input.fromAddress);
    if (sender === authenticated) return "outgoing";
  }

  return input.fallback ?? null;
}

const GENERIC_COUNTERPARTY_NAMES = new Set([
  "merchant",
  "payment",
  "recipient",
  "subscript transaction",
]);

export function getRecognizedAccountName(
  dnsName: string | null | undefined,
  displayName: string | null | undefined,
): string | null {
  const candidate = (dnsName || displayName || "").replace(/^@/, "").trim();
  if (
    !candidate ||
    GENERIC_COUNTERPARTY_NAMES.has(candidate.toLowerCase()) ||
    normalizeEvmAddress(candidate)
  ) {
    return null;
  }

  return candidate;
}

