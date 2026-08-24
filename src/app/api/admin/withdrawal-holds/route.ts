import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireScope } from "@/lib/admin/guard";
import { recordAdminAction } from "@/lib/admin/audit";
import { jsonOk } from "@/lib/http/json";

/* Place and lift per-account withdrawal holds.
 *
 * A hold is the middle setting between "nothing" and a ban. Banning an account to stop a
 * payout also locks the person out of every session (getVerifiedSessionToken filters banned
 * wallets on every authenticated request), which is counterproductive during a dispute — the
 * account still needs to sign in and answer questions. See the migration header in
 * supabase/migrations/20260812120000_withdrawal_holds.sql.
 *
 * Enforcement lives in @/lib/admin/withdrawalHolds, called from the withdrawal paths
 * themselves. This route only writes rows; it deliberately does not try to cancel anything
 * already in flight, because an on-chain withdrawal that has been broadcast cannot be recalled.
 */

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const SCOPES = new Set(["USER", "MERCHANT", "BOTH"]);
const MAX_REASON = 300;

export async function GET(request: Request) {
    const auth = await requireScope(request, "finance");
    if (!auth.ok) return auth.response;

    try {
        const holds = await prisma.withdrawalHold.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
        const now = new Date();
        return jsonOk({
            success: true,
            holds: holds.map((h) => ({
                address: h.address,
                scope: h.scope,
                reason: h.reason,
                placedBy: h.placedBy,
                expiresAt: h.expiresAt?.toISOString() ?? null,
                createdAt: h.createdAt.toISOString(),
                /* Expired rows are kept as an audit record but no longer block. Saying so
                   explicitly stops the console from listing a lapsed hold as if it were live. */
                active: !h.expiresAt || h.expiresAt > now,
            })),
        });
    } catch (error) {
        console.error("[admin/withdrawal-holds] list failed:", error);
        return NextResponse.json({ error: "Failed to load withdrawal holds" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const auth = await requireScope(request, "finance");
    if (!auth.ok) return auth.response;

    try {
        const body = await request.json().catch(() => ({}));
        let rawAddress = typeof body?.address === "string" ? body.address.trim() : "";

        // Support DNS alias lookup (e.g. merchant.sub)
        if (rawAddress.includes(".") && !ADDRESS_PATTERN.test(rawAddress)) {
            const aliasRow = await prisma.addressAlias.findUnique({
                where: { alias: rawAddress.toLowerCase() },
                select: { address: true },
            });
            if (aliasRow?.address) {
                rawAddress = aliasRow.address;
            }
        }

        if (!ADDRESS_PATTERN.test(rawAddress)) {
            return NextResponse.json(
                { error: "Enter a valid wallet address or SubScript DNS name." },
                { status: 400 },
            );
        }
        const address = rawAddress.toLowerCase();
        const hold = body?.hold !== false;

        if (!hold) {
            const deleted = await prisma.withdrawalHold.deleteMany({ where: { address } });
            if (deleted.count === 0) {
                return NextResponse.json(
                    { error: "That address does not have a withdrawal hold." },
                    { status: 404 },
                );
            }
            await recordAdminAction({
                actor: auth.admin.wallet,
                action: "WITHDRAWAL_HOLD_CLEARED",
                target: address,
                detail: { reason: typeof body?.reason === "string" ? body.reason.trim().slice(0, MAX_REASON) : null },
                request,
            });
            return jsonOk({ success: true, address, held: false });
        }

        const scope = typeof body?.scope === "string" ? body.scope.toUpperCase() : "BOTH";
        if (!SCOPES.has(scope)) {
            return NextResponse.json(
                { error: "scope must be USER, MERCHANT, or BOTH." },
                { status: 400 },
            );
        }

        /* A reason is mandatory, matching api/admin/receipts/invite. This freezes someone
           else's money; six months later the audit row is the only account of why, and
           "placed by 0x59e6…" without a reason cannot be reviewed by anyone. */
        const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, MAX_REASON) : "";
        if (reason.length < 3) {
            return NextResponse.json(
                { error: "Enter a reason for the hold — it is recorded in the audit log." },
                { status: 400 },
            );
        }

        let expiresAt: Date | null = null;
        if (body?.expiresAt !== undefined && body?.expiresAt !== null && body?.expiresAt !== "") {
            const parsed = new Date(String(body.expiresAt));
            if (Number.isNaN(parsed.getTime())) {
                return NextResponse.json({ error: "expiresAt must be an ISO timestamp." }, { status: 400 });
            }
            /* A past expiry would write a hold that never blocks anything — the reader treats
               it as lapsed on the very next request. Reject it rather than silently storing a
               freeze the operator believes is in force. */
            if (parsed <= new Date()) {
                return NextResponse.json({ error: "expiresAt must be in the future." }, { status: 400 });
            }
            expiresAt = parsed;
        }

        const before = await prisma.withdrawalHold.findUnique({ where: { address } });

        await prisma.withdrawalHold.upsert({
            where: { address },
            update: { scope, reason, placedBy: auth.admin.wallet, expiresAt },
            create: { address, scope, reason, placedBy: auth.admin.wallet, expiresAt },
        });

        await recordAdminAction({
            actor: auth.admin.wallet,
            action: "WITHDRAWAL_HOLD_SET",
            target: address,
            detail: {
                scope,
                reason,
                expiresAt: expiresAt?.toISOString() ?? null,
                /* Before AND after: re-scoping an existing hold is a different act from opening
                   one, and only the previous value distinguishes them in review. */
                previous: before
                    ? { scope: before.scope, reason: before.reason, expiresAt: before.expiresAt?.toISOString() ?? null }
                    : null,
            },
            request,
        });

        return jsonOk({ success: true, address, held: true, scope, expiresAt: expiresAt?.toISOString() ?? null });
    } catch (error) {
        console.error("[admin/withdrawal-holds] update failed:", error);
        return NextResponse.json({ error: "Failed to update withdrawal hold" }, { status: 500 });
    }
}
