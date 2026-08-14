import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { requireAccountRole } from "@/lib/accounts/roles";
import { sanitizeInput } from "@/utils/security";
import {
    getOrCreateInviteSettings,
    rotateInviteToken,
    setInviteEnabled,
} from "@/lib/dms/connections";

export async function GET(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const roleCheck = await requireAccountRole(wallet, "USER");
        if (!roleCheck.ok) {
            return NextResponse.json({ error: roleCheck.error }, { status: roleCheck.status });
        }

        const settings = await getOrCreateInviteSettings(wallet);

        const host = request.headers.get("host") || "";
        const protocol = request.headers.get("x-forwarded-proto") || "https";
        const inviteUrl = `${protocol}://${host}/dm/invite/${settings.token}`;

        return NextResponse.json({
            success: true,
            invite: {
                walletAddress: settings.walletAddress,
                tokenVersion: settings.tokenVersion,
                enabled: settings.enabled,
                token: settings.token,
                inviteUrl,
            },
        });
    } catch (err: any) {
        console.error("Failed to get DM invite settings:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const roleCheck = await requireAccountRole(wallet, "USER");
        if (!roleCheck.ok) {
            return NextResponse.json({ error: roleCheck.error }, { status: roleCheck.status });
        }

        const body = sanitizeInput(await request.json().catch(() => null));
        if (!body || typeof body !== "object") {
            return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
        }

        const { action, enabled } = body;
        const host = request.headers.get("host") || "";
        const protocol = request.headers.get("x-forwarded-proto") || "https";

        if (action === "rotate") {
            const rotated = await rotateInviteToken(wallet);
            const inviteUrl = `${protocol}://${host}/dm/invite/${rotated.token}`;
            return NextResponse.json({
                success: true,
                invite: {
                    tokenVersion: rotated.tokenVersion,
                    enabled: rotated.enabled,
                    token: rotated.token,
                    inviteUrl,
                },
            });
        }

        if (action === "toggle") {
            if (typeof enabled !== "boolean") {
                return NextResponse.json({ error: "Missing or invalid 'enabled' boolean parameter" }, { status: 400 });
            }
            const updated = await setInviteEnabled(wallet, enabled);
            const inviteUrl = `${protocol}://${host}/dm/invite/${updated.token}`;
            return NextResponse.json({
                success: true,
                invite: {
                    tokenVersion: updated.tokenVersion,
                    enabled: updated.enabled,
                    token: updated.token,
                    inviteUrl,
                },
            });
        }

        return NextResponse.json({ error: "Invalid action. Expected 'rotate' or 'toggle'." }, { status: 400 });
    } catch (err: any) {
        console.error("Failed to update DM invite settings:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}
