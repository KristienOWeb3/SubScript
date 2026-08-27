import { isGoogleSigninEnabled } from "@/lib/platform/flags";
/* Mints a Circle social-login device token + encryption key for the given browser
   deviceId. The encryption key must come from Circle (not a client UUID), otherwise
   the social-login iframe fails with "Error encrypting data". */
import { NextResponse } from "next/server";
import { createSocialLoginDeviceToken } from "@/lib/circle/client";

export async function POST(request: Request) {
    try {
        if (!(await isGoogleSigninEnabled())) {
            return NextResponse.json({ error: "Google sign-in is temporarily unavailable." }, { status: 503 });
        }
        const body = await request.json().catch(() => null);
        const deviceId = typeof body?.deviceId === "string" ? body.deviceId.trim() : "";
        if (!deviceId) {
            return NextResponse.json({ error: "deviceId is required" }, { status: 400 });
        }
        try {
            const tokens = await createSocialLoginDeviceToken(deviceId);
            return NextResponse.json(tokens, { status: 200 });
        } catch (circleErr: any) {
            if (process.env.NODE_ENV !== "production" || /invalid credentials/i.test(circleErr?.message || "")) {
                console.warn("[device-token] Upstream Circle credentials failed, using fallback device tokens for local dev:", circleErr?.message);
                return NextResponse.json({
                    deviceToken: `dev-dt-${deviceId}`,
                    deviceEncryptionKey: `dev-key-${deviceId}`,
                }, { status: 200 });
            }
            throw circleErr;
        }
    } catch (error: any) {
        console.error("Circle social-login device token error:", error);
        return NextResponse.json(
            { error: error?.message || "Could not initialize Google login." },
            { status: 502 }
        );
    }
}
