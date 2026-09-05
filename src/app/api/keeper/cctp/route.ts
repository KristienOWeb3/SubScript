/* Keeper job: poll Circle for signed CCTP attestations and relay the resulting mints, in both
   directions (deposits onto Arc, withdrawals off it).
   Auth: Bearer CRON_SECRET or KEEPER_SECRET. Signs with RELAYER_PRIVATE_KEY (or SPONSOR_PRIVATE_KEY).

   Scheduled from .github/workflows/keepers.yml rather than vercel.json: Vercel Hobby crons only run
   daily, and a burned transfer that waits a day to mint is not a bridge anyone would use. */
import { NextResponse } from "next/server";
import crypto from "crypto";
import { processPendingCctpTransfers } from "@/lib/cctp/attestationWorker";
import { sweepAndBridge } from "@/lib/cctp/autoBridge";

export const maxDuration = 300;

function isAuthorized(request: Request): boolean {
  const authHeader = request.headers.get("Authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const presented = match?.[1] || "";
  const configured = [process.env.CRON_SECRET, process.env.KEEPER_SECRET]
    .filter((value): value is string => Boolean(value));

  if (presented.length === 0 || configured.length === 0) return false;

  const digest = (value: string) => crypto.createHash("sha256").update(value, "utf8").digest();
  const providedDigest = digest(presented);

  return configured.some((value) => {
    try {
      return crypto.timingSafeEqual(providedDigest, digest(value));
    } catch {
      return false;
    }
  });
}

async function handle(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    /* Phase 1: relay any pending attestations (existing mints waiting on Circle). */
    const attestation = await processPendingCctpTransfers();

    /* Phase 2: sweep derived deposit addresses and initiate new bridges. */
    const sweep = await sweepAndBridge().catch((err: any) => {
      console.error("[api/keeper/cctp] sweep error:", err?.message);
      return { scanned: 0, bridged: 0, skipped: 0, errors: 1 };
    });

    return NextResponse.json({ success: true, attestation, sweep });
  } catch (error: any) {
    console.error("[api/keeper/cctp] error:", error?.message);
    return NextResponse.json({ error: "Failed to process CCTP transfers" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
