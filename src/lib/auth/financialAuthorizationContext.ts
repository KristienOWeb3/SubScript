import { AsyncLocalStorage } from "node:async_hooks";
import { authorizationDigest } from "./transactionPinCrypto";

type Context = { expected: unknown; resolve: () => Promise<unknown> };
const financialAuthorization = new AsyncLocalStorage<Context>();
export function runFinancialAuthorization<T>(expected: unknown, resolve: () => Promise<unknown>, callback: () => Promise<T>) {
    return financialAuthorization.run({ expected, resolve }, callback);
}
export function authorizedFinancialSnapshot<T>(): T | undefined {
    return financialAuthorization.getStore()?.expected as T | undefined;
}
/** Revalidate mutable standing terms at the custody boundary, before provider acceptance. */
export async function assertFinancialAuthorizationCurrent() {
    const context = financialAuthorization.getStore();
    if (context && authorizationDigest(await context.resolve()) !== authorizationDigest(context.expected)) {
        throw new Error("TRANSACTION_AUTHORITY_CHANGED: Financial terms changed. Start a new operation.");
    }
}

/** Compare the exact server-resolved fields that a handler will pass to signing. */
export function assertAuthorizedFinancialRecord(section: "plans" | "links" | "standingSubscription", row: Record<string, unknown>) {
    const snapshot = authorizedFinancialSnapshot<any>();
    if (!snapshot) return;
    const expected = section === "standingSubscription" ? snapshot.standingSubscription
        : snapshot.financialTerms?.[section]?.find((entry: any) => entry.id === row.id);
    const timestampFields = new Set(["updated_at", "expires_at", "deleted_at", "min_commitment_until"]);
    const normalize = (key: string, value: unknown) => timestampFields.has(key) && value !== null && value !== undefined
        ? new Date(value as string | Date).toISOString() : value;
    if (!expected || Object.keys(row).some(key => authorizationDigest(normalize(key, expected[key])) !== authorizationDigest(normalize(key, row[key])))) {
        throw new Error("TRANSACTION_AUTHORITY_CHANGED: Resolved financial terms differ from the PIN authorization.");
    }
}

export function assertAuthorizedMerchantDestination(merchant: string) {
    const snapshot = authorizedFinancialSnapshot<{ resolvedMerchant: string | null }>();
    if (snapshot && snapshot.resolvedMerchant !== merchant.toLowerCase()) {
        throw new Error("TRANSACTION_AUTHORITY_CHANGED: The merchant destination changed after authorization.");
    }
}

export function assertAuthorizedSubscriptionUpgrade(upgrade: unknown) {
    const snapshot = authorizedFinancialSnapshot<{ upgrade: unknown }>();
    if (snapshot && authorizationDigest(snapshot.upgrade) !== authorizationDigest(upgrade)) {
        throw new Error("TRANSACTION_AUTHORITY_CHANGED: The subscription or upgrade charge changed after authorization.");
    }
}
