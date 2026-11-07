import crypto from "node:crypto";
import { recoverVaultCommitIntents } from "@/lib/vault/commitRecovery";
import { assertFinancialNetworkReady } from "@/lib/network/registry";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
    const presented = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
    const digest = (value: string) => crypto.createHash("sha256").update(value).digest();
    if (!presented || ![process.env.CRON_SECRET, process.env.KEEPER_SECRET].some(value =>
        value && crypto.timingSafeEqual(digest(value), digest(presented)))) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    try {
        assertFinancialNetworkReady();
        return Response.json(await recoverVaultCommitIntents());
    } catch {
        return Response.json({ error: "Vault commit recovery unavailable" }, { status: 503 });
    }
}
