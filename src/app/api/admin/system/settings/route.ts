import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireScope } from "@/lib/admin/guard";
import { recordAdminAction, type AdminAction } from "@/lib/admin/audit";
import {
    readSystemSettings,
    updateSystemSettings,
    SYSTEM_SETTING_LABELS,
    type SystemSettingsPatch,
} from "@/lib/platform/systemSettings";

/* The operational breakers, over system_settings.
 *
 * Separate from api/admin/flags on purpose. That route owns product flags (maintenance mode,
 * Google sign-in, external wallets, invite-only signup) in platform_flags. This one owns the
 * switches that stop money moving, and they live in a different table because that is where
 * their enforcement already was — see the header of @/lib/platform/systemSettings for the full
 * map of which code path reads which column.
 *
 * The console previously offered payments and withdrawals kill switches over platform_flags,
 * where they had no columns and no readers. An operator got a success toast and kept taking
 * payments. Every switch this route exposes is one with a live consumer; the six columns on
 * system_settings that nothing reads are deliberately not exposed.
 */

/* Each switch gets its own audit action where the taxonomy already has one, so an auditor can
   filter "who stopped withdrawals" without reading through every settings change. All three
   of these have existed in ADMIN_ACTIONS since the kill switches were first attempted and
   were never once written, because the flags route logged everything as PLATFORM_FLAGS_SET. */
const AUDIT_ACTION_BY_FIELD: Record<keyof SystemSettingsPatch, AdminAction> = {
    withdrawalsEnabled: "WITHDRAWALS_KILL_SWITCH_SET",
    hostedPaymentsEnabled: "PAYMENTS_KILL_SWITCH_SET",
    checkoutEnabled: "PAYMENTS_KILL_SWITCH_SET",
    reconciliationEnabled: "PLATFORM_FLAGS_SET",
    sponsorEmergencyStop: "EMERGENCY_STOP_SET",
};

const EDITABLE_FIELDS = Object.keys(AUDIT_ACTION_BY_FIELD) as Array<keyof SystemSettingsPatch>;

export async function GET(request: Request) {
    const auth = await requireScope(request, "engineering");
    if (!auth.ok) return auth.response;

    try {
        /* Uncached: an operator opening this page during an incident needs the row as it is,
           not as it was ten seconds ago. */
        const settings = await readSystemSettings();
        return NextResponse.json({
            settings,
            /* What each switch actually stops, sent alongside the values so the UI cannot drift
               from the enforcement. Every claim here is a real call site. */
            enforcement: {
                withdrawalsEnabled:
                    "Blocks every withdrawal path — vault withdraw and reclaim, merchant claims, wallet sends, and execute-tx. Fails closed.",
                hostedPaymentsEnabled: "Blocks hosted checkout payment links and the /pay flow.",
                checkoutEnabled: "Blocks premium checkout.",
                reconciliationEnabled: "Pauses the payment reconciliation worker.",
                sponsorEmergencyStop:
                    "Stops sponsored gas platform-wide. SPONSOR_EMERGENCY_STOP in the environment also forces this on.",
            },
        });
    } catch (error) {
        console.error("[admin/system/settings] read failed:", error);
        /* Surfaced, never defaulted. A console that renders "everything on" when it cannot read
           the row is how a broken kill switch goes unnoticed. */
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to read system settings" },
            { status: 500 },
        );
    }
}

export async function POST(request: Request) {
    const auth = await requireScope(request, "engineering");
    if (!auth.ok) return auth.response;

    try {
        const body = await request.json().catch(() => ({}));

        const patch: SystemSettingsPatch = {};
        for (const field of EDITABLE_FIELDS) {
            if (typeof body?.[field] === "boolean") patch[field] = body[field];
        }
        if (Object.keys(patch).length === 0) {
            return NextResponse.json({ error: "No settings changes supplied" }, { status: 400 });
        }

        const { before, after, changed } = await updateSystemSettings(patch, auth.admin.wallet);

        /* One audit row per changed switch rather than one for the request. Turning off
           withdrawals and turning off sponsored gas are different incidents even when they
           arrive in the same click, and an auditor filtering by action needs to see both. */
        for (const change of changed) {
            await recordAdminAction({
                actor: auth.admin.wallet,
                action: AUDIT_ACTION_BY_FIELD[change.field],
                target: "system_settings",
                detail: {
                    field: change.field,
                    label: SYSTEM_SETTING_LABELS[change.field],
                    before: change.from,
                    after: change.to,
                },
                request,
            });
        }

        if (changed.length > 0) {
            /* Alert the other admins. The flags route has done this since it was written, but
               its change list only covered the four product flags — so flipping a kill switch,
               the single most alarming thing an admin can do here, emailed nobody. */
            void notifyAdmins(changed, auth.admin.wallet).catch((error) => {
                console.error("[admin/system/settings] alert dispatch failed:", error);
            });
        }

        return NextResponse.json({ success: true, settings: after, before, changed });
    } catch (error) {
        console.error("[admin/system/settings] update failed:", error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to update system settings" },
            { status: 500 },
        );
    }
}

/**
 * Email every admin about each changed breaker.
 *
 * Best-effort and detached from the response, same contract as the equivalent block in
 * api/admin/flags: the row is already committed and a failed send must not report the toggle
 * as failed. Audience comes from listAdminNotificationEmails() so root admins are included —
 * an inline lookup here is what once silently excluded them.
 */
async function notifyAdmins(
    changed: Array<{ field: keyof SystemSettingsPatch; from: boolean; to: boolean }>,
    actorWallet: string,
): Promise<void> {
    const { sendPlatformFlagChangeEmail } = await import("@/lib/email/transactional");
    const { listAdminNotificationEmails } = await import("@/lib/email/adminRecipients");

    const adminEmails = await listAdminNotificationEmails();
    if (adminEmails.length === 0) return;

    const actorAlias =
        (
            await prisma.addressAlias.findUnique({
                where: { address: actorWallet.toLowerCase() },
                select: { alias: true },
            })
        )?.alias || null;

    for (const change of changed) {
        for (const email of adminEmails) {
            await sendPlatformFlagChangeEmail({
                adminEmail: email,
                actorWallet,
                actorAlias,
                flagName: SYSTEM_SETTING_LABELS[change.field],
                previousValue: change.from ? "Enabled" : "Disabled",
                newValue: change.to ? "Enabled" : "Disabled",
            }).catch((error) => console.error("[admin/system/settings] alert email failed:", error));
        }
    }
}
