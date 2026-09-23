/* THE single server-side gas-payer decision for SubScript.
 *
 * SubScript sponsors network gas ONLY for genuine merchant commerce (Checkout, Subscription, PAYG)
 * where a USER pays an ENTERPRISE merchant. Every other financial action — user-to-user sends, peer
 * payment links, DM peer transfers, withdrawals — is paid by the sender.
 *
 * Classification is by the transaction's authoritative economic participants and purpose, NEVER by
 * endpoint, UI surface, route name, the word "checkout", or any client-supplied flag. Callers must
 * resolve the facts in `GasIntent` from server records (DB link_kind, account_roles, vault owner)
 * before calling; this function is pure so it is trivially testable and cannot be spoofed.
 *
 * Unknown / ambiguous inputs FAIL CLOSED (DENIED_UNCLASSIFIED) rather than silently sponsoring.
 */

export type GasPayerClass =
    | "SPONSORED_MERCHANT_COMMERCE"
    | "USER_PAID_PEER_TRANSACTION"
    | "USER_PAID_WITHDRAWAL"
    | "PLATFORM_OPERATIONAL"
    | "DENIED_UNCLASSIFIED";

export interface GasPayerDecision {
    class: GasPayerClass;
    /** "platform" ⇒ sponsored (Gas Station / sponsor top-up). "wallet" ⇒ the sender bears the gas
     *  (fee-recovery on SCA; native gas on EOA). */
    gasPayer: "platform" | "wallet";
    /** Convenience: true iff gasPayer === "platform". */
    sponsored: boolean;
    /** Machine-readable reason for logs/metrics, e.g. "peer_link_settles_to_user". */
    reason: string;
    /** The authoritative resource used to classify, e.g. "payment_link:<id>" or "vault:<merchant>". */
    authority: string;
}

/**
 * Discriminated union of gas-bearing intents. Every field is a fact the CALLER has already resolved
 * from server-side records — pass DB truth, not request bodies.
 */
export type GasIntent =
    /* A hosted or embedded payment-link payment. `settlesToUser` = isPeerRequestLink(dbLink);
       `merchantIsEnterprise` = getAccountRole(dbLink.merchantAddress) === "ENTERPRISE". */
    | { kind: "payment_link_pay"; linkId: string; settlesToUser: boolean; merchantIsEnterprise: boolean }
    /* A direct/batch wallet send. Always a user-to-user (or user-to-arbitrary) transfer. */
    | { kind: "wallet_send" }
    /* The generic execute-tx dispatcher, classified per concrete action. */
    | { kind: "execute_action"; action: string }
    /* Metered PAYG vault operations against an ENTERPRISE merchant vault. */
    | { kind: "vault"; op: "commit" | "auto_topup" | "withdraw" | "reclaim"; merchantIsEnterprise: boolean }
    /* Merchant subscription lifecycle initiated by the subscriber. */
    | { kind: "subscription"; op: "subscribe" | "change" | "cancel" | "resume" | "upgrade"; merchantIsEnterprise: boolean }
    /* Cross-chain (CCTP) withdrawal out of Arc. */
    | { kind: "cctp_withdrawal" }
    /* Merchant-side outflow: payout/withdrawal/payroll/claim. Never user sponsorship. */
    | { kind: "merchant_payout"; op: "withdraw" | "payroll" | "claim" }
    /* Keeper/relayer operations for merchant subscriptions and PAYG billing. */
    | { kind: "keeper"; op: string };

/* execute-tx actions that are merchant-commerce setup/lifecycle when initiated by the payer.
   `approveUsdc` is validated at the route to target only the router/standard contract, so it is
   always a commerce approval; `cancelSubscription` is subscription lifecycle. */
const COMMERCE_EXECUTE_ACTIONS = new Set(["approveUsdc", "cancelSubscription"]);
/* Confidential view-key management is merchant account config, not a USER→merchant payment. */
const MERCHANT_CONFIG_EXECUTE_ACTIONS = new Set([
    "configurePayoutDestination", "registerViewKey", "commitViewKey", "revealViewKey",
]);

function sponsored(cls: GasPayerClass, reason: string, authority: string): GasPayerDecision {
    return { class: cls, gasPayer: "platform", sponsored: true, reason, authority };
}
function userPaid(cls: GasPayerClass, reason: string, authority: string): GasPayerDecision {
    return { class: cls, gasPayer: "wallet", sponsored: false, reason, authority };
}
function denied(reason: string, authority: string): GasPayerDecision {
    return { class: "DENIED_UNCLASSIFIED", gasPayer: "wallet", sponsored: false, reason, authority };
}

export function classifyGasPayer(intent: GasIntent): GasPayerDecision {
    switch (intent.kind) {
        case "payment_link_pay": {
            const authority = `payment_link:${intent.linkId}`;
            /* A user-generated peer link settles directly to another USER — a peer transaction, even
               though it reuses the checkout UI. Never sponsored. */
            if (intent.settlesToUser) {
                return userPaid("USER_PAID_PEER_TRANSACTION", "peer_link_settles_to_user", authority);
            }
            /* A merchant link (incl. third-party sponsored-plan links) settles to an ENTERPRISE
               merchant. Only sponsor once that role is confirmed server-side; otherwise fail closed. */
            if (intent.merchantIsEnterprise) {
                return sponsored("SPONSORED_MERCHANT_COMMERCE", "merchant_checkout", authority);
            }
            return denied("merchant_role_unconfirmed", authority);
        }

        case "wallet_send":
            return userPaid("USER_PAID_PEER_TRANSACTION", "wallet_send", "wallet_send");

        case "execute_action": {
            const authority = `execute_action:${intent.action}`;
            if (intent.action === "transferUsdc") {
                /* An ordinary USDC transfer is a peer transaction — must NOT inherit sponsorship from
                   the generic dispatcher. */
                return userPaid("USER_PAID_PEER_TRANSACTION", "transfer_usdc", authority);
            }
            if (intent.action === "withdraw") {
                /* Router withdraw = merchant payout. */
                return userPaid("USER_PAID_WITHDRAWAL", "merchant_withdraw", authority);
            }
            if (COMMERCE_EXECUTE_ACTIONS.has(intent.action)) {
                return sponsored("SPONSORED_MERCHANT_COMMERCE", "commerce_action", authority);
            }
            if (MERCHANT_CONFIG_EXECUTE_ACTIONS.has(intent.action)) {
                /* Merchant account config, not a user payment: the account owner bears its own gas. */
                return userPaid("USER_PAID_WITHDRAWAL", "merchant_config", authority);
            }
            return denied("unknown_execute_action", authority);
        }

        case "vault": {
            const authority = `vault:${intent.op}`;
            if (intent.op === "commit" || intent.op === "auto_topup") {
                return intent.merchantIsEnterprise
                    ? sponsored("SPONSORED_MERCHANT_COMMERCE", `vault_${intent.op}`, authority)
                    : denied("vault_merchant_role_unconfirmed", authority);
            }
            /* withdraw / reclaim pull the user's own escrow back to their wallet. */
            return userPaid("USER_PAID_WITHDRAWAL", `vault_${intent.op}`, authority);
        }

        case "subscription": {
            const authority = `subscription:${intent.op}`;
            /* Subscribe/change/cancel/resume/upgrade are the commercial relationship lifecycle. */
            return intent.merchantIsEnterprise
                ? sponsored("SPONSORED_MERCHANT_COMMERCE", `subscription_${intent.op}`, authority)
                : denied("subscription_merchant_role_unconfirmed", authority);
        }

        case "cctp_withdrawal":
            return userPaid("USER_PAID_WITHDRAWAL", "cctp_withdrawal", "cctp_withdrawal");

        case "merchant_payout":
            return userPaid("USER_PAID_WITHDRAWAL", `merchant_${intent.op}`, `merchant_payout:${intent.op}`);

        case "keeper":
            /* Required keeper/relayer operations for merchant subscriptions and PAYG billing.
               Kept distinct from user-facing sponsorship so metrics stay separable. */
            return { class: "PLATFORM_OPERATIONAL", gasPayer: "platform", sponsored: true, reason: `keeper_${intent.op}`, authority: `keeper:${intent.op}` };

        default: {
            /* Exhaustiveness guard: any unmodelled intent fails closed. */
            const _exhaustive: never = intent;
            return denied("unclassified_intent", "unknown");
        }
    }
}
