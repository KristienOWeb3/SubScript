/* Mints a Circle social-login device token + encryption key for the given browser
   deviceId. The encryption key must come from Circle (not a client UUID), otherwise
   the social-login iframe fails with "Error encrypting data". */
import { NextResponse } from "next/server";
import { createSocialLoginDeviceToken } from "@/lib/circle/client";

export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => null);
        const deviceId = typeof body?.deviceId === "string" ? body.deviceId.trim() : "";
        if (!deviceId) {
            return NextResponse.json({ error: "deviceId is required" }, { status: 400 });
        }
        const tokens = await createSocialLoginDeviceToken(deviceId);
        return NextResponse.json(tokens, { status: 200 });
    } catch (error: any) {
        console.error("Circle social-login device token error:", error);
        return NextResponse.json(
            { error: error?.message || "Could not initialize Google login." },
            { status: 502 }
        );
    }
}
