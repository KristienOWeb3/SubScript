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
        if (typeof body?.maintenanceMessage === "string" || body?.maintenanceMessage === null) {
            data.maintenanceMessage = body.maintenanceMessage
                ? String(body.maintenanceMessage).trim().slice(0, 300)
                : null;
        }

        if (Object.keys(data).length === 2) {
            return NextResponse.json({ error: "No flag changes supplied" }, { status: 400 });
        }

        const row = await prisma.platformFlag.upsert({
            where: { id: 1 },
            update: data,
            create: { id: 1, ...data },
        });

        const after: PlatformFlags = {
            googleSigninEnabled: row.googleSigninEnabled,
            maintenanceEnabled: row.maintenanceEnabled,
            maintenanceMessage: row.maintenanceMessage,
            externalWalletEnabled: row.externalWalletEnabled,
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
