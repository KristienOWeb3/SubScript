import { randomBytes } from "crypto";
import { findAccountEmailBinding, normalizeAccountEmail } from "@/lib/auth/accountEmail";

/* Invite-only merchant access.
 *
 * A merchant account is granted to an EMAIL, by an admin, one business at a time. This module is
 * the gate: /api/auth/register-role calls it before it will write role = 'ENTERPRISE', and the
 * admin console calls it to check whether an email can be granted at all.
 *
 * The email is the authority. An invite token exists so an admin can hand a business a working
 * link, but the server always re-checks the grant against the wallet's VERIFIED email — so a
 * forwarded link opens nothing. See the migration header for the full reasoning.
 *
 * @/lib/platform/flags is imported dynamically rather than at the top: the grant checks below need
 * nothing but the pg client handed to them, and a static import would drag Prisma into every
 * consumer — including the tests that exercise this logic against a fake client.
 */

type PgClient = {
    query: (sql: string, params?: any[]) => Promise<{ rows: any[] }>;
};

export type MerchantAccessGrantRow = {
    email: string;
    granted_by: string;
    invite_token: string;
    claimed_at: Date | null;
    claimed_wallet: string | null;
    revoked_at: Date | null;
    note: string | null;
};

/* Distinct codes so the client can say something actionable instead of one flat "no". */
export type MerchantSignupRefusal =
    | "MERCHANT_INVITE_REQUIRED"
    | "MERCHANT_INVITE_REVOKED"
    | "MERCHANT_INVITE_CLAIMED"
    | "MERCHANT_INVITE_EMAIL_MISMATCH"
    | "MERCHANT_EMAIL_REQUIRED";

export type MerchantSignupDecision =
    | { allowed: true; grant: MerchantAccessGrantRow | null }
    | { allowed: false; reason: MerchantSignupRefusal; message: string };

const FALSEY = ["false", "0", "no", "off"];

/**
 * Is merchant signup invite-only right now?
 *
 * Two ways to turn it on: the platform_flags row (flipped from the admin console, the mainnet
 * path) or ALLOW_PUBLIC_MERCHANT_SIGNUP="false" in env (break-glass, works without a database).
 *
 * FAILS CLOSED, deliberately inverting the fail-open posture of @/lib/platform/flags. That module
 * treats an unreadable table as "all features on" because a database blip must not black out the
 * product — right for maintenance mode and sign-in buttons. It is wrong here: failing open on a
 * flags read error would let an ungranted business open a merchant account, and merchant accounts
 * move money. Failing closed costs one business a few minutes' delay on a signup an admin already
 * approved. Same exception isGoogleSigninEnabled makes, for the same shape of reason.
 */
export async function isMerchantInviteOnlyEnforced(): Promise<boolean> {
    const envFlag = (process.env.ALLOW_PUBLIC_MERCHANT_SIGNUP || "").trim().toLowerCase();
    if (envFlag && FALSEY.includes(envFlag)) return true;

    try {
        const { getPlatformFlags } = await import("@/lib/platform/flags");
        const flags = await getPlatformFlags();
        return flags.merchantInviteOnlyEnabled === true;
    } catch (error) {
        console.error(
            "[merchant-access] flag read failed, enforcing invite-only:",
            error instanceof Error ? error.message : error,
        );
        return true;
    }
}

/** Where enforcement is coming from, for the admin console. */
export async function describeMerchantInviteEnforcement(): Promise<{
    enabled: boolean;
    source: "env" | "flag" | "off";
}> {
    const envFlag = (process.env.ALLOW_PUBLIC_MERCHANT_SIGNUP || "").trim().toLowerCase();
    if (envFlag && FALSEY.includes(envFlag)) return { enabled: true, source: "env" };

    const { getPlatformFlags } = await import("@/lib/platform/flags");
    const flags = await getPlatformFlags();
    return flags.merchantInviteOnlyEnabled
        ? { enabled: true, source: "flag" }
        : { enabled: false, source: "off" };
}

/** 32 bytes of base64url. Not a secret in the privilege sense — see the module header. */
export function generateInviteToken(): string {
    return randomBytes(32).toString("base64url");
}

/**
 * May this wallet open a merchant account?
 *
 * Takes the CALLER'S pg client so it runs inside register-role's existing transaction: the grant
 * row is locked FOR UPDATE here and marked claimed a few statements later, which is what stops two
 * concurrent signups from both redeeming one grant.
 *
 * `verifiedEmail` must come from user_embedded_wallets where email_verified_at is not null. Never
 * pass a client-supplied email — that would make the whole gate a formality.
 */
export async function assertMerchantSignupAllowed(
    client: PgClient,
    params: { verifiedEmail: string | null; wallet: string; inviteToken?: string | null },
): Promise<MerchantSignupDecision> {
    const email = normalizeAccountEmail(params.verifiedEmail);
    const wallet = params.wallet.toLowerCase();
    const token = typeof params.inviteToken === "string" ? params.inviteToken.trim() : "";

    if (!email) {
        return {
            allowed: false,
            reason: "MERCHANT_EMAIL_REQUIRED",
            message:
                "Merchant accounts need a verified email. Sign up with email or Google, then try again.",
        };
    }

    /* A token pointing at someone else's grant is worth naming explicitly. Without this, a business
       that forwarded its invite to a colleague would see a generic "you need an invite" and have no
       idea the link was the problem. */
    if (token) {
        const tokenOwner = await client.query(
            "select email from merchant_access_grants where invite_token = $1 limit 1",
            [token],
        );
        const ownerEmail = tokenOwner.rows[0]?.email
            ? String(tokenOwner.rows[0].email).toLowerCase()
            : null;
        if (ownerEmail && ownerEmail !== email) {
            return {
                allowed: false,
                reason: "MERCHANT_INVITE_EMAIL_MISMATCH",
                message: `That invite link was issued to a different email. Sign up with the address the invite was sent to, or request your own at /merchant-access.`,
            };
        }
    }

    const grantResult = await client.query(
        `select email, granted_by, invite_token, claimed_at, claimed_wallet, revoked_at, note
           from merchant_access_grants
          where email = $1
          limit 1
            for update`,
        [email],
    );
    const grant = grantResult.rows[0] as MerchantAccessGrantRow | undefined;

    if (!grant) {
        return {
            allowed: false,
            reason: "MERCHANT_INVITE_REQUIRED",
            message:
                "Merchant accounts are invite-only. Request access at /merchant-access and we'll email you an invite once you're approved.",
        };
    }

    if (grant.revoked_at) {
        return {
            allowed: false,
            reason: "MERCHANT_INVITE_REVOKED",
            message: "This merchant invite is no longer active. Contact support if you think that's wrong.",
        };
    }

    /* Same wallet retrying (a network blip, a double submit) is fine — the write below is
       idempotent. A different wallet is one grant being spent twice. */
    if (grant.claimed_at && grant.claimed_wallet && grant.claimed_wallet.toLowerCase() !== wallet) {
        return {
            allowed: false,
            reason: "MERCHANT_INVITE_CLAIMED",
            message:
                "This invite has already been used to open a merchant account. Sign in to that account, or contact support.",
        };
    }

    return { allowed: true, grant };
}

/** Records who redeemed a grant. Called inside the same transaction as the merchants insert. */
export async function markGrantClaimed(
    client: PgClient,
    email: string,
    wallet: string,
): Promise<void> {
    await client.query(
        `update merchant_access_grants
            set claimed_at = coalesce(claimed_at, now()),
                claimed_wallet = $2,
                updated_at = now()
          where email = $1`,
        [email.toLowerCase(), wallet.toLowerCase()],
    );
}

export type EmailAccountConflict = {
    walletAddress: string;
    role: string | null;
};

/**
 * Does this email already have a SubScript account?
 *
 * The admin grant route refuses when it does. A USER account can never be upgraded to a merchant
 * account — register-role rejects the role change outright — so granting such an email would mint
 * a grant that can never be redeemed, and the business would bounce off an error nobody can
 * explain. Catching it at grant time turns that into one clear sentence for the operator.
 */
export async function findConflictingAccountForEmail(
    client: PgClient,
    email: string,
): Promise<EmailAccountConflict | null> {
    const binding = await findAccountEmailBinding(client, email);
    if (!binding) return null;

    const roleResult = await client.query(
        "select role from account_roles where address = $1 limit 1",
        [binding.walletAddress],
    );

    return {
        walletAddress: binding.walletAddress,
        role: roleResult.rows[0]?.role ? String(roleResult.rows[0].role) : null,
    };
}
