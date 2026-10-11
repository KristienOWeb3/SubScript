import { pgMaybeOne } from "@/lib/serverPg";
import { activeSubscriptionContract } from "@/lib/subscriptions/contractBinding";
import type { VerifiedSessionToken } from "@/lib/auth";
import { ARC_MAINNET_CHAIN_ID, ARC_TESTNET_CHAIN_ID, isProd, SUBSCRIPT_ROUTER_ADDRESS, SUBSCRIPT_VAULT_ADDRESS, SUBSCRIPT_VAULT_CHAIN_ID } from "@/lib/contracts/constants";

type CommitAuthority = {
    id: string; commit_id: string; status: string; spend_limit_usdc: string | null;
    parent_commit_id: string | null; parent_wallet: string | null; parent_status: string | null;
    vault_id: string | null; vault_owner: string | null;
};

async function targetAuthority(commitId: unknown) {
    if (typeof commitId !== "string" || commitId.length > 160) return null;
    return pgMaybeOne<CommitAuthority>(
        `select c.id, c.commit_id, c.status, c.spend_limit_usdc::text,
                c.parent_commit_id, p.wallet_address as parent_wallet, p.status as parent_status,
                c.vault_id, v.user_address as vault_owner
           from user_commits c
           left join user_commits p on p.id = c.parent_commit_id
           left join metered_vaults v on v.id = c.vault_id
          where c.commit_id = $1 limit 1`, [commitId.trim()],
    );
}

/** Bind authority, funding source and configured networks without binding mutable spend counters. */
export async function financialPinContext(body: any, session: VerifiedSessionToken, request: Request) {
    const wallet = session.wallet.toLowerCase();
    const path = new URL(request.url).pathname;
    let resolvedMerchant: string | null = null;
    if (["/api/user/vault/commit", "/api/user/vault/auto-topup"].includes(path) && typeof body?.merchantAddress === "string") {
        const candidate = body.merchantAddress.trim().toLowerCase();
        const record = path.endsWith("/auto-topup")
            ? await pgMaybeOne<{ address: string }>("select lower(address) as address from address_aliases where lower(address)=$1 or lower(alias)=$1 limit 1", [candidate])
            : await pgMaybeOne<{ address: string }>("select lower(wallet_address) as address from merchants where commit_slug=$1 limit 1", [candidate]);
        resolvedMerchant = record?.address ?? (/^0x[0-9a-f]{40}$/.test(candidate) ? candidate : null);
    }
    const actor = await pgMaybeOne<CommitAuthority>(
        `select c.id, c.commit_id, c.status, c.spend_limit_usdc::text,
                c.parent_commit_id, p.wallet_address as parent_wallet, p.status as parent_status,
                c.vault_id, v.user_address as vault_owner
           from user_commits c
           left join user_commits p on p.id = c.parent_commit_id
           left join metered_vaults v on v.id = c.vault_id
          where lower(c.wallet_address) = $1 limit 1`, [wallet],
    );
    const target = await targetAuthority(body?.commitId);
    const linkId = new URL(request.url).pathname.match(/\/payment-links\/([^/]+)\/pay$/)?.[1];
    // Subscription routes accept either plan or checkout IDs and resolve them through both tables.
    const requestedIds = [...new Set([body?.planId, body?.checkoutSessionId, linkId && decodeURIComponent(linkId)]
        .filter((value): value is string => typeof value === "string")
        .map(value => value.trim().toLowerCase()).filter(value => /^[0-9a-f-]{36}$/.test(value)))].sort();
    const terms = requestedIds.length ? await pgMaybeOne(
        `select
          (select coalesce(jsonb_agg(to_jsonb(p) order by p.id), '[]'::jsonb) from
            (select id, merchant_address, amount_usdc::text, period_seconds::text,
                    min_commitment_seconds::text, active, target_subscriber, source_checkout_id, updated_at
               from merchant_plans where id::text = any($1::text[])) p) as plans,
          (select coalesce(jsonb_agg(to_jsonb(l) order by l.id), '[]'::jsonb) from
            (select id, merchant_address, beneficiary_address, amount_usdc::text, active,
                    expires_at, max_uses, link_kind, sandbox_mode, simulation_only,
                    settlement_chain_id::text, deleted_at, state_snapshot
               from payment_links where id::text = any($1::text[]) or id in
                   (select source_checkout_id from merchant_plans where id::text=any($1::text[]))) l) as links,
          (select coalesce(jsonb_agg(to_jsonb(m) order by m.wallet_address), '[]'::jsonb) from
            (select wallet_address, payout_destination, payout_settlement_enabled from merchants where wallet_address in
              (select merchant_address from merchant_plans where id::text=any($1::text[])
               union select merchant_address from payment_links where id::text=any($1::text[]))) m) as merchants,
          (select coalesce(jsonb_agg(to_jsonb(p) order by p.id), '[]'::jsonb) from
            (select id, plan_id, regular_amount_usdc::text, introductory_amount_usdc::text,
                    introductory_cycles, starts_at, expires_at, max_redemptions, new_customers_only, active, updated_at
               from merchant_plan_promotions where plan_id::text=any($1::text[])) p) as promotions`, [requestedIds],
    ) : null;
    const subscriptionId = String(body?.subscriptionId ?? body?.fromSubscriptionId ?? "").replace(/^sub_/, "");
    const standingSubscription = /^\d+$/.test(subscriptionId) ? await pgMaybeOne(
        `select subscription_id::text, contract_address, merchant_address, subscriber,
                trunc(amount_cap_usdc)::text as amount_cap_usdc, billing_interval_seconds::text, beneficiary_address,
                min_commitment_until, plan_id, source_checkout_id, cancel_at_period_end,
                kind, status, updated_at from subscriptions
          where subscription_id=$1::bigint and contract_address=$2 and lower(subscriber)=$3`,
        [subscriptionId, activeSubscriptionContract(), wallet],
    ) : null;
    const merchantDestination = await pgMaybeOne(
        "select wallet_address, payout_destination, payout_settlement_enabled from merchants where lower(wallet_address)=$1",
        [wallet],
    );
    return {
        resolvedMerchant,
        standingSubscription, merchantDestination,
        actor: wallet,
        fundingWallet: actor?.parent_wallet?.toLowerCase() ?? wallet,
        actorAuthority: actor,
        targetAuthority: target,
        requestedIds,
        financialTerms: terms,
        walletChainId: isProd ? ARC_MAINNET_CHAIN_ID : ARC_TESTNET_CHAIN_ID,
        vaultChainId: SUBSCRIPT_VAULT_CHAIN_ID,
        router: SUBSCRIPT_ROUTER_ADDRESS.toLowerCase(),
        vault: SUBSCRIPT_VAULT_ADDRESS.toLowerCase(),
    };
}

/** Only a verified owner's finite reduction can bypass PIN; caller-supplied old limits are ignored. */
export async function capIncreaseRequiresPin(body: any, session: VerifiedSessionToken) {
    if (!body || !Object.hasOwn(body, "spendLimitUsdc")) return true;
    const proposed = body.spendLimitUsdc;
    if ((typeof proposed !== "string" && typeof proposed !== "number")
        || (typeof proposed === "number" && !Number.isSafeInteger(proposed))
        || !/^\d+$/.test(String(proposed))) return true;
    const current = await targetAuthority(body.commitId);
    const wallet = session.wallet.toLowerCase();
    const owner = current?.vault_id ? current.vault_owner : current?.parent_wallet;
    if (!current || owner?.toLowerCase() !== wallet || current.status === "REVOKED") return true;
    return current.spend_limit_usdc !== null && BigInt(String(proposed)) > BigInt(current.spend_limit_usdc);
}

export function executeActionRequiresPin(body: any) { return body?.action !== "cancelSubscription"; }
export function shareStatusRequiresPin(body: any) { return !["pause", "revoke", "withdraw"].includes(body?.action); }
export function payrollChangeRequiresPin(body: any) { return body?.action !== "PAUSE"; }
export function payoutSettingRequiresPin(body: any) { return Boolean(body && Object.hasOwn(body, "payoutDestination")); }
