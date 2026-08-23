import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin/guard";
import { recordAdminAction } from "@/lib/admin/audit";
import {
    getPlatformFlags,
    invalidatePlatformFlagsCache,
    mirrorPlatformFlags,
    type PlatformFlags,
} from "@/lib/platform/flags";

export async function GET(request: Request) {
    const auth = await requireAdmin(request);
    if (!auth.ok) return auth.response;

    try {
        const flags = await getPlatformFlags();
        return NextResponse.json({
            ...flags,
            /* The runtime flag cannot enable Google on its own: the OAuth client id is
               inlined at build time, so the console must show when env is the blocker
               rather than letting an admin flip a switch that does nothing. */
            googleEnvConfigured: process.env.NEXT_PUBLIC_CIRCLE_GOOGLE_ENABLED === "true",
        });
    } catch (error) {
        console.error("[admin/flags] read failed:", error);
        return NextResponse.json({ error: "Failed to load platform flags" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const auth = await requireAdmin(request);
    if (!auth.ok) return auth.response;

    try {
        const body = await request.json().catch(() => ({}));
        const before = await getPlatformFlags();

        const data: Record<string, unknown> = { updatedBy: auth.admin.wallet, updatedAt: new Date() };
        if (typeof body?.googleSigninEnabled === "boolean") data.googleSigninEnabled = body.googleSigninEnabled;
        if (typeof body?.externalWalletEnabled === "boolean") data.externalWalletEnabled = body.externalWalletEnabled;
        if (typeof body?.maintenanceEnabled === "boolean") data.maintenanceEnabled = body.maintenanceEnabled;
        if (typeof body?.sponsorEmergencyStop === "boolean") data.sponsorEmergencyStop = body.sponsorEmergencyStop;
        if (typeof body?.paymentsEnabled === "boolean") data.paymentsEnabled = body.paymentsEnabled;
        if (typeof body?.withdrawalsEnabled === "boolean") data.withdrawalsEnabled = body.withdrawalsEnabled;
        if (typeof body?.maintenanceMessage === "string" || body?.maintenanceMessage === null) {
            data.maintenanceMessage = body.maintenanceMessage
                ? String(body.maintenanceMessage).trim().slice(0, 300)
                : null;
        }
        /* Root-only, unlike the switches above. Granting one business merchant access is routine
           review work any admin does; deciding whether merchant accounts are open to the public at
           all is a platform-shape change, and it lands on the same side of the line as managing the
           admin list itself (see requireRootAdmin). */
        if (typeof body?.merchantInviteOnlyEnabled === "boolean") {
            if (!auth.admin.isRoot) {
                return NextResponse.json(
                    { error: "Only root admins (ADMIN_WALLET_ADDRESSES) can change invite-only merchant signup." },
                    { status: 403 },
                );
            }
            data.merchantInviteOnlyEnabled = body.merchantInviteOnlyEnabled;
        }

        if (Object.keys(data).length === 2) {
            return NextResponse.json({ error: "No flag changes supplied" }, { status: 400 });
        }

        const row = await prisma.platformFlag.upsert({
            where: { id: 1 },
            update: data,
            create: { id: 1, ...data },
        }) as any;

        const after: PlatformFlags = {
            googleSigninEnabled: row.googleSigninEnabled ?? true,
            maintenanceEnabled: row.maintenanceEnabled ?? false,
            maintenanceMessage: row.maintenanceMessage ?? null,
            externalWalletEnabled: row.externalWalletEnabled ?? true,
            merchantInviteOnlyEnabled: row.merchantInviteOnlyEnabled ?? false,
            sponsorEmergencyStop: row.sponsorEmergencyStop ?? false,
            paymentsEnabled: row.paymentsEnabled ?? true,
            withdrawalsEnabled: row.withdrawalsEnabled ?? true,
        };

        /* Drop the local cache immediately so this instance reflects the change without
           waiting out the TTL — an operator toggling a switch and reloading the console
           should not see the old value staring back. */
        invalidatePlatformFlagsCache();
        const mirror = await mirrorPlatformFlags(after);

        await recordAdminAction({
            actor: auth.admin.wallet,
            action: "PLATFORM_FLAGS_SET",
            target: "platform_flags",
            /* Before AND after: during an incident, "who turned this off" is only useful
               next to what it was before. */
            detail: { before, after, mirrored: mirror.mirrored },
            request,
        });

        /* Notify all platform admins via email about the toggled switch */
        try {
            const { sendPlatformFlagChangeEmail } = await import("@/lib/email/transactional");
            const { listAdminNotificationEmails } = await import("@/lib/email/adminRecipients");

            /*
             * The audience used to be assembled inline here, and it read
             * `process.env.ADMIN_ROOT_WALLET` for the root tier. That variable exists nowhere in
             * this repository: not in .env.example, not in any deployment, referenced only by this
             * block and one other copy of it. The canonical variable is ADMIN_WALLET_ADDRESSES,
             * parsed by lib/admin/allowlist. So root admins were silently excluded from every
             * flag-change alert: the delegated wallets in admin_wallets got mail, and the
             * un-revokable tier that can turn invite-only signup on and off did not.
             *
             * listAdminNotificationEmails() resolves ROOT (env) union DELEGATED (admin_wallets),
             * and degrades to root-only when Postgres is unreachable. Do not reintroduce an inline
             * lookup here; adding a wallet source in one route and not the others is how this bug
             * happened in the first place. The old block also added auth.admin.wallet by hand,
             * which is redundant: requireAdmin only lets root or delegated wallets through, so the
             * actor is already inside that union.
             */
            const adminEmails = await listAdminNotificationEmails();

            /* The alias is a separate concern from the audience: it labels the ACTOR in the email
               body so an admin recognises who flipped the switch. Only the actor's own alias is
               needed, so this no longer piggybacks on a bulk aliases query over the audience.
               `address` is the primary key and is stored lowercase (see auth/defaultAlias). */
            const actorWallet = auth.admin.wallet.toLowerCase();
            const actorAlias = (await prisma.addressAlias.findUnique({
                where: { address: actorWallet },
                select: { alias: true },
            }))?.alias || null;

            // Detect which flags actually changed
            const changes: Array<{ flagName: string; prev: unknown; next: unknown }> = [];
            if (before.googleSigninEnabled !== after.googleSigninEnabled) {
                changes.push({ flagName: "Continue with Google", prev: before.googleSigninEnabled ? "Enabled" : "Disabled", next: after.googleSigninEnabled ? "Enabled" : "Disabled" });
            }
            if (before.externalWalletEnabled !== after.externalWalletEnabled) {
                changes.push({ flagName: "External Wallet Connection", prev: before.externalWalletEnabled ? "Enabled" : "Disabled", next: after.externalWalletEnabled ? "Enabled" : "Disabled" });
            }
            if (before.maintenanceEnabled !== after.maintenanceEnabled) {
                changes.push({ flagName: "Maintenance Mode", prev: before.maintenanceEnabled ? "Enabled" : "Disabled", next: after.maintenanceEnabled ? "Enabled" : "Disabled" });
            }
            if (before.merchantInviteOnlyEnabled !== after.merchantInviteOnlyEnabled) {
                changes.push({ flagName: "Invite-only merchant signup", prev: before.merchantInviteOnlyEnabled ? "Enabled" : "Disabled", next: after.merchantInviteOnlyEnabled ? "Enabled" : "Disabled" });
            }

            // Send notification emails in background
            if (changes.length > 0 && adminEmails.length > 0) {
                for (const change of changes) {
                    for (const email of adminEmails) {
                        sendPlatformFlagChangeEmail({
                            adminEmail: email,
                            actorWallet: auth.admin.wallet,
                            actorAlias,
                            flagName: change.flagName,
                            previousValue: change.prev,
                            newValue: change.next,
                        }).catch(err => console.error("[admin/flags] alert email failed:", err));
                    }
                }
            }
        } catch (emailErr) {
            console.error("[admin/flags] failed to dispatch admin notification emails:", emailErr);
        }

        return NextResponse.json({
            success: true,
            flags: after,
            /* Maintenance is enforced at the edge from the Redis mirror. If that write
               failed, the database says "down" while every request still gets served —
               report it rather than letting the console imply the site is offline. */
            warning: mirror.mirrored
                ? undefined
                : `Saved, but the edge cache could not be updated (${mirror.error}). Maintenance mode is NOT in effect yet.`,
        });
    } catch (error) {
        console.error("[admin/flags] update failed:", error);
        return NextResponse.json({ error: "Failed to update platform flags" }, { status: 500 });
    }
}
