/* Shared authentication for /api/v1/* merchant endpoints: a dashboard session cookie or
   a Bearer sk_test_/sk_live_ secret key. Returns the merchant wallet (lowercased) plus
   the request mode so routes can gate test-key behavior. */
import { prisma } from "@/lib/prisma";
import { getSessionWallet } from "@/lib/auth";
import { hashSecretKey } from "@/lib/apiKeys";
import { getSecretKeyMode } from "@/lib/apiErrors";

export type MerchantAuth =
    | { ok: true; merchantAddress: string; mode: "test" | "live" | "session" }
    | { ok: false; status: number; error: string };

export async function authenticateMerchant(request: Request): Promise<MerchantAuth> {
    const sessionWallet = await getSessionWallet(request.headers);
    if (sessionWallet) {
        return { ok: true, merchantAddress: sessionWallet.toLowerCase(), mode: "session" };
    }
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return { ok: false, status: 401, error: "Unauthorized: Missing or invalid Authorization header" };
    }
    const secretKey = authHeader.substring(7).trim();
    const mode = getSecretKeyMode(secretKey);
    if (mode !== "test" && mode !== "live") {
        return { ok: false, status: 401, error: "Unauthorized: Invalid secret API key format" };
    }
    if (mode === "live") {
        /* This deployment is testnet-only: live credentials are refused before any lookup
           (and cannot exist — the database rejects LIVE-mode key insertion). PR #70 isolation. */
        return { ok: false, status: 401, error: "Unauthorized: sk_live_ keys are not enabled on this deployment" };
    }
    const keyRecord = await prisma.apiKey.findFirst({
        where: { revoked: false, secretKeyHash: hashSecretKey(secretKey) },
    });
    if (!keyRecord) {
        return { ok: false, status: 401, error: "Unauthorized: Active secret key not found" };
    }
    if (keyRecord.mode !== "TEST") {
        return { ok: false, status: 403, error: "Forbidden: this API key's mode cannot settle on this deployment" };
    }
    return { ok: true, merchantAddress: keyRecord.walletAddress.toLowerCase(), mode };
}
