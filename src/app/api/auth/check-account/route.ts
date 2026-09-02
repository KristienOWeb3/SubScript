import { NextResponse } from "next/server";
import { sanitizeInput } from "@/utils/security";
import { resolveAccountRoleWithBackfill } from "@/lib/accounts/roles";
import { normalizeAccountEmail } from "@/lib/auth/accountEmail";

export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object") {
            return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
        }

        const { email, address } = sanitizeInput(body);

        if (email) {
            const emailLower = normalizeAccountEmail(email);
            if (!emailLower) {
                return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
            }

            /* Email existence is not public account metadata. OTP delivery owns this decision and
               returns a uniform response, leaving mailbox possession as the only signal. */
            return NextResponse.json({ accepted: true });
        }

        if (address) {
            const addressLower = address.toLowerCase().trim();
            if (!/^0x[a-fA-F0-9]{40}$/.test(addressLower)) {
                return NextResponse.json({ error: "Invalid address format" }, { status: 400 });
            }
            const role = await resolveAccountRoleWithBackfill(addressLower);
            if (role) {
                return NextResponse.json({
                    exists: true,
                    onboardingComplete: true,
                    wallet: addressLower,
                    role,
                });
            }
            return NextResponse.json({ exists: false, onboardingComplete: false });
        }

        return NextResponse.json({ error: "Missing email or address parameter" }, { status: 400 });
    } catch (err: any) {
        console.error("Check account error:", err);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
