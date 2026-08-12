/**
 * The subscription↔contract binding, in one place.
 *
 * Why this module exists: `subscriptions.subscription_id` is not unique. The PSA is immutable
 * (no proxy — the EIP-1967 implementation slot is empty), so every redeploy restarts
 * `nextSubscriptionId` at 1 and re-mints ids that already exist in the table. The id only means
 * anything relative to the contract that minted it, which is why
 * 20260810140000_subscriptions_contract_binding.sql made the primary key
 * `(contract_address, subscription_id)`.
 *
 * That migration shipped without the matching Prisma schema change, so for a period the schema
 * still declared `subscriptionId @id`. Prisma compiles `upsert({ where: { subscriptionId } })`
 * to `INSERT … ON CONFLICT ("subscription_id")`, and the migration dropped the constraint that
 * inference names — on the customer-subscribe mirror path. Centralizing the key here is what
 * keeps that from being reintroduced one call site at a time.
 *
 * Rules:
 * - Block comments only.
 * - Never hardcode either address. `activeSubscriptionContract()` and SENTINEL_CONTRACT_ADDRESS
 *   are the only sanctioned sources.
 * - Any read that will be compared against on-chain state MUST be scoped with
 *   `onActiveContract()`. A row from an abandoned deployment reads back as a zeroed struct,
 *   which the keeper interprets as "cancelled directly on-chain" — the exact false-cancellation
 *   bug the migration was written to stop.
 */

import { STANDARD_CONTRACT_ADDRESS } from "@/lib/contracts/constants";

/**
 * Rows whose minting contract is unknowable.
 *
 * Every row that predates the binding migration carries this: the lineage was never recorded,
 * so it cannot be recovered from the data. Backfilling them to the *current* contract would
 * have been actively wrong — that is precisely the state that produces false cancellations.
 * These rows are closed out and must stay invisible to every chain-reading path.
 */
export const SENTINEL_CONTRACT_ADDRESS = "0x000000000000000000000000000000000000dead" as const;

/**
 * The PSA that new subscriptions are minted by, lowercased.
 *
 * Read from the configured env rather than captured at module load in a const, so a test that
 * overrides NEXT_PUBLIC_STANDARD_CONTRACT_ADDRESS is not silently ignored.
 *
 * >>> REDEPLOY CHECKLIST: the DEFAULT on subscriptions.contract_address must be updated in the
 * >>> same change that updates NEXT_PUBLIC_STANDARD_CONTRACT_ADDRESS, or new rows are labelled
 * >>> with the old contract while this function reports the new one.
 */
export function activeSubscriptionContract(): string {
    return STANDARD_CONTRACT_ADDRESS.toLowerCase();
}

/** True for a row stranded by a redeploy that predates the contract-address column. */
export function isSentinelContract(contractAddress: string | null | undefined): boolean {
    return (contractAddress ?? "").toLowerCase() === SENTINEL_CONTRACT_ADDRESS;
}

/**
 * Composite primary key for findUnique / update / upsert / delete.
 *
 * Prisma names the compound-id input after its fields, so `@@id([contractAddress,
 * subscriptionId])` generates `contractAddress_subscriptionId`. Passing a bare
 * `{ subscriptionId }` no longer compiles, which is the point: the type error is the reminder.
 */
export function subscriptionKey(
    subscriptionId: string | bigint | number,
    contractAddress: string = activeSubscriptionContract(),
): { contractAddress_subscriptionId: { contractAddress: string; subscriptionId: bigint } } {
    return {
        contractAddress_subscriptionId: {
            contractAddress: contractAddress.toLowerCase(),
            subscriptionId: BigInt(subscriptionId),
        },
    };
}

/**
 * Where-fragment scoping a non-unique read to the configured contract. Spread into a
 * `findFirst` / `findMany` / `count` filter:
 *
 *   where: { ...onActiveContract(), subscriber, status: "ACTIVE" }
 *
 * Without it, a query matching on `subscriptionId` or `subscriber` alone can return a stranded
 * row from an abandoned deployment.
 */
export function onActiveContract(): { contractAddress: string } {
    return { contractAddress: activeSubscriptionContract() };
}
