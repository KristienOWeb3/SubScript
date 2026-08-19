import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withPgClient } from "@/lib/serverPg";
import { requireAdmin } from "@/lib/admin/guard";
import { recordAdminAction } from "@/lib/admin/audit";
import { normalizeAccountEmail } from "@/lib/auth/accountEmail";
import { isProd } from "@/lib/contracts/constants";
import { sendMerchantAccessGrantedEmail } from "@/lib/email/transactional";
import {
    describeMerchantInviteEnforcement,
    findConflictingAccountForEmail,
    generateInviteToken,
} from "@/lib/merchants/accessGrants";

/* Merchant access review: the console side of invite-only merchant signup.
 *
 * Any admin can grant, decline, revoke, and re-issue links — this is routine review work. The
 * master enforcement switch is NOT here; it lives in /api/admin/flags and is root-only, because
 * deciding whether merchant signup is open to the public at all is a different kind of decision
 * from admitting one business.
 *
 * Nothing in this file is load-bearing for security on its own. A grant is only ever redeemed by
 * /api/auth/register-role, which re-checks it against the wallet's verified email.
 */

const APP_BASE_URL = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "https://www.subscriptonarc.com")
    .replace(/\/+$/, "");

function inviteUrl(token: string) {
    return `${APP_BASE_URL}/signup?role=merchant&invite=${encodeURIComponent(token)}`;
}

export async function GET(request: Request) {
    const auth = await requireAdmin(request);
    if (!auth.ok) return auth.response;

    try {
        const { searchParams } = new URL(request.url);
        const status = (searchParams.get("status") || "PENDING").toUpperCase();

        const [requests, grants, enforcement] = await Promise.all([
            prisma.merchantAccessRequest.findMany({
                where: status === "ALL" ? {} : { status },
                orderBy: { createdAt: "desc" },
                take: 200,
            }),
            prisma.merchantAccessGrant.findMany({
                orderBy: { createdAt: "desc" },
                take: 200,
            }),
            describeMerchantInviteEnforcement(),
        ]);

        return NextResponse.json({
            enforcement: {
                ...enforcement,
                /* So the console can label the switch honestly as a mainnet control instead of
                   implying it should be on today. */
                isMainnet: isProd,
            },
            requests: requests.map((r) => ({
                id: r.id,
                email: r.email,
                companyName: r.companyName,
                website: r.website,
                contactName: r.contactName,
                useCase: r.useCase,
                monthlyVolume: r.monthlyVolume,
                status: r.status,
                decidedBy: r.decidedBy,
                decidedAt: r.decidedAt?.toISOString() ?? null,
                decisionNote: r.decisionNote,
                createdAt: r.createdAt.toISOString(),
            })),
            grants: grants.map((g) => ({
                email: g.email,
                grantedBy: g.grantedBy,
                inviteUrl: inviteUrl(g.inviteToken),
                inviteSentAt: g.inviteSentAt?.toISOString() ?? null,
                claimedAt: g.claimedAt?.toISOString() ?? null,
                claimedWallet: g.claimedWallet,
                revokedAt: g.revokedAt?.toISOString() ?? null,
                revokedBy: g.revokedBy,
                revokeReason: g.revokeReason,
                note: g.note,
                createdAt: g.createdAt.toISOString(),
            })),
            viewerIsRoot: auth.admin.isRoot,
        });
    } catch (error) {
        console.error("[admin/merchant-access] list failed:", error);
        return NextResponse.json({ error: "Failed to load merchant access" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const auth = await requireAdmin(request);
    if (!auth.ok) return auth.response;

    try {
        const body = await request.json().catch(() => ({}));
        const action = typeof body?.action === "string" ? body.action : "";

        if (action === "grant") return grant(request, auth.admin.wallet, body);
        if (action === "decline") return decline(request, auth.admin.wallet, body);
        if (action === "revoke") return revoke(request, auth.admin.wallet, body);
        if (action === "regenerate-link") return regenerateLink(request, auth.admin.wallet, body);

        return NextResponse.json(
            { error: "Unknown action. Use grant, decline, revoke, or regenerate-link." },
            { status: 400 },
        );
    } catch (error) {
        console.error("[admin/merchant-access] action failed:", error);
        return NextResponse.json({ error: "Merchant access action failed" }, { status: 500 });
    }
}

async function grant(request: Request, actor: string, body: any) {
    const email = normalizeAccountEmail(body?.email);
    const note = typeof body?.note === "string" ? body.note.trim().slice(0, 500) || null : null;
    const requestId = typeof body?.requestId === "string" && body.requestId.trim() ? body.requestId.trim() : null;
    const sendEmail = body?.sendEmail !== false;

    if (!email) {
        return NextResponse.json({ error: "Enter a valid business email address." }, { status: 400 });
    }

    /* The load-bearing check on this side. A USER account can never become a merchant account —
       register-role refuses the role change outright — so granting an email that already has one
       would mint a grant nobody can ever redeem, and the business would bounce off an error no
       support agent could explain. Catch it here, while it is still one sentence. */
    const conflict = await withPgClient((client) => findConflictingAccountForEmail(client, email));
    if (conflict) {
        const isMerchant = conflict.role === "ENTERPRISE";
        return NextResponse.json(
            {
                error: isMerchant
                    ? `${email} already has a merchant account (${conflict.walletAddress}). Nothing to grant.`
                    : `${email} already has a personal SubScript account. A user account can't be upgraded to a merchant account — ask them to sign up with a different business email, then grant that one.`,
                code: isMerchant ? "ALREADY_MERCHANT" : "EMAIL_HAS_USER_ACCOUNT",
                walletAddress: conflict.walletAddress,
                role: conflict.role,
            },
            { status: 409 },
        );
    }

    const existing = await prisma.merchantAccessGrant.findUnique({ where: { email } });
    const token = existing && !existing.revokedAt ? existing.inviteToken : generateInviteToken();

    const grantRow = await prisma.merchantAccessGrant.upsert({
        where: { email },
        /* Re-granting a revoked email revives it with a FRESH token: the old link was handed out
           before we withdrew access, so it should stay dead. */
        update: {
            grantedBy: actor,
            note: note ?? existing?.note ?? null,
            requestId: requestId ?? existing?.requestId ?? null,
            inviteToken: token,
            revokedAt: null,
            revokedBy: null,
            revokeReason: null,
        },
        create: { email, grantedBy: actor, note, requestId, inviteToken: token },
    });

    if (requestId) {
        await prisma.merchantAccessRequest.updateMany({
            where: { id: requestId },
            data: { status: "APPROVED", decidedBy: actor, decidedAt: new Date(), decisionNote: note },
        });
    } else {
        /* Granted straight from the console (a business that reached us on X, say). If they had
           filed a request too, close it out so the queue does not show work already done. */
        await prisma.merchantAccessRequest.updateMany({
            where: { email, status: "PENDING" },
            data: { status: "APPROVED", decidedBy: actor, decidedAt: new Date(), decisionNote: note },
        });
    }

    const url = inviteUrl(grantRow.inviteToken);
    let emailed = false;
    if (sendEmail) {
        const requestRecord = requestId
            ? await prisma.merchantAccessRequest.findUnique({ where: { id: requestId } })
            : await prisma.merchantAccessRequest.findUnique({ where: { email } });
        await sendMerchantAccessGrantedEmail({
            email,
            inviteUrl: url,
            companyName: requestRecord?.companyName ?? null,
            note,
        });
        emailed = true;
        await prisma.merchantAccessGrant.update({
            where: { email },
            data: { inviteSentAt: new Date() },
        });
    }

    await recordAdminAction({
        actor,
        action: "MERCHANT_ACCESS_GRANT",
        target: email,
        /* Never the token: an audit log is read by more people than the grant itself, and the link
           is re-readable from the console by anyone who needs it. */
        detail: { requestId, note, emailed, revived: Boolean(existing?.revokedAt) },
        request,
    });

    return NextResponse.json({
        success: true,
        grant: {
            email,
            grantedBy: actor,
            inviteUrl: url,
            note,
            claimedAt: null,
            createdAt: grantRow.createdAt.toISOString(),
        },
        message: emailed
            ? `${email} can now open a merchant account. Invite emailed.`
            : `${email} can now open a merchant account. Copy the invite link and send it over.`,
    });
}

async function decline(request: Request, actor: string, body: any) {
    const requestId = typeof body?.requestId === "string" ? body.requestId.trim() : "";
    const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 500) : "";

    if (!requestId) {
        return NextResponse.json({ error: "Missing requestId" }, { status: 400 });
    }
    if (reason.length < 3) {
        return NextResponse.json(
            { error: "Give a reason — the next admin to read this queue needs to know why." },
            { status: 400 },
        );
    }

    const updated = await prisma.merchantAccessRequest.updateMany({
        where: { id: requestId, status: "PENDING" },
        data: { status: "DECLINED", decidedBy: actor, decidedAt: new Date(), decisionNote: reason },
    });
    if (updated.count === 0) {
        return NextResponse.json({ error: "That request is not pending any more." }, { status: 409 });
    }

    await recordAdminAction({
        actor,
        action: "MERCHANT_ACCESS_DECLINE",
        target: requestId,
        detail: { reason },
        request,
    });

    /* Deliberately no email. A decline is a judgement call about a business, and an automated
       rejection notice is the wrong way to deliver one — reach out directly if it warrants a reply. */
    return NextResponse.json({ success: true, message: "Request declined." });
}

async function revoke(request: Request, actor: string, body: any) {
    const email = normalizeAccountEmail(body?.email);
    const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 500) : "";

    if (!email) {
        return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    }
    if (reason.length < 3) {
        return NextResponse.json({ error: "A reason is required to revoke merchant access." }, { status: 400 });
    }

    const existing = await prisma.merchantAccessGrant.findUnique({ where: { email } });
    if (!existing) {
        return NextResponse.json({ error: "No merchant grant for that email." }, { status: 404 });
    }
    if (existing.revokedAt) {
        return NextResponse.json({ error: "That grant is already revoked." }, { status: 409 });
    }

    await prisma.merchantAccessGrant.update({
        where: { email },
        data: { revokedAt: new Date(), revokedBy: actor, revokeReason: reason },
    });

    await recordAdminAction({
        actor,
        action: "MERCHANT_ACCESS_REVOKE",
        target: email,
        detail: { reason, wasClaimed: Boolean(existing.claimedAt), claimedWallet: existing.claimedWallet },
        request,
    });

    return NextResponse.json({
        success: true,
        /* Say what revoking does NOT do. An operator who thinks this closed a live merchant account
           will stop looking, and the account will still be there taking payments. */
        message: existing.claimedAt
            ? `Invite revoked, but ${email} already opened a merchant account — that account is untouched. Use Moderation to ban or hold it.`
            : `${email} can no longer open a merchant account. The old invite link is dead.`,
    });
}

async function regenerateLink(request: Request, actor: string, body: any) {
    const email = normalizeAccountEmail(body?.email);
    if (!email) {
        return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    }

    const existing = await prisma.merchantAccessGrant.findUnique({ where: { email } });
    if (!existing) {
        return NextResponse.json({ error: "No merchant grant for that email." }, { status: 404 });
    }
    if (existing.revokedAt) {
        return NextResponse.json({ error: "That grant is revoked. Grant it again to issue a new link." }, { status: 409 });
    }

    const token = generateInviteToken();
    await prisma.merchantAccessGrant.update({
        where: { email },
        data: { inviteToken: token, inviteSentAt: null },
    });

    await recordAdminAction({
        actor,
        action: "MERCHANT_INVITE_REGENERATE",
        target: email,
        detail: { reason: typeof body?.reason === "string" ? body.reason.trim().slice(0, 500) : null },
        request,
    });

    return NextResponse.json({
        success: true,
        inviteUrl: inviteUrl(token),
        message: "New invite link issued. The previous one no longer works.",
    });
}
