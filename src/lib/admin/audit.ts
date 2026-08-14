import { prisma } from "@/lib/prisma";

/* Append-only record of every admin action.
 *
 * Called AFTER the action commits, and never throws into the caller: an audit write
 * failing must not roll back a ban that already took effect, or leave the caller
 * reporting failure for work that succeeded. Same posture as sendPushToWallet — the
 * side effect is best-effort, the primary write is the source of truth.
 */

export type AdminAction =
    | "MERCHANT_VERIFY"
    | "BAN_ACCOUNT"
    | "UNBAN_ACCOUNT"
    | "BAN_IP"
    | "UNBAN_IP"
    | "MAINTENANCE_SET"
    | "PLATFORM_FLAGS_SET"
    | "GOOGLE_SIGNIN_SET"
    | "ADMIN_WALLET_GRANT"
    | "ADMIN_WALLET_REVOKE"
    | "ADMIN_WALLET_UPDATE_LABEL"
    | "BROADCAST_CREATED"
    | "RECEIPT_INVITE"
    | "WITHDRAWAL_HOLD_SET"
    | "WITHDRAWAL_HOLD_CLEARED"
    /* KYC_FORCE_APPROVE is the only action here that overrides a compliance guard rather than
       flipping a product switch, so it is kept distinct from the ordinary KYC_DECISION: an
       auditor filtering this log wants those rows on their own, not buried among routine reviews. */
    | "KYC_DECISION"
    | "KYC_FORCE_APPROVE"
    | "KYC_MANUAL_CREATE";

export function requestIp(request: Request): string | null {
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded) return forwarded.split(",")[0].trim();
    return request.headers.get("x-real-ip");
}

export async function recordAdminAction(params: {
    actor: string;
    action: AdminAction;
    target?: string | null;
    /* Record the BEFORE value for toggles — during an incident "who turned this off"
       is only useful alongside what it was before. */
    detail?: Record<string, unknown> | null;
    request?: Request;
}): Promise<void> {
    try {
        await prisma.adminAuditLog.create({
            data: {
                actor: params.actor.toLowerCase(),
                action: params.action,
                target: params.target?.toLowerCase() ?? null,
                detail: (params.detail ?? undefined) as any,
                ip: params.request ? requestIp(params.request) : null,
            },
        });
    } catch (error) {
        console.error("[admin] audit write failed:", error);
    }
}
