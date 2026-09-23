import { NextResponse } from "next/server";
import { getAllRoutesAvailability } from "@/lib/cctp/routeAvailability";
import type { BridgeDirection } from "@/lib/cctp/types";

/**
 * Live, gas-aware availability for every CCTP route the Send and Deposit pickers can show.
 *
 * Public and read-only: it reports only whether a route is up and a badge to render, never balances,
 * addresses, or keys. The picker polls it (~30s) so a relayer top-up flips a route back to Live
 * without a reload. The withdrawal endpoint enforces the same check server-side before burning, so
 * this is a hint for the UI, not the security boundary.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  const param = new URL(request.url).searchParams.get("direction");
  const direction: BridgeDirection = param === "inbound_deposit" ? "inbound_deposit" : "outbound_withdrawal";

  try {
    const routes = await getAllRoutesAvailability(direction);
    return NextResponse.json(
      { direction, routes, updatedAt: new Date().toISOString() },
      { headers: { "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=60" } },
    );
  } catch (error: any) {
    console.error("[api/cctp/routes-status] error:", error?.message);
    return NextResponse.json(
      { direction, routes: [], updatedAt: new Date().toISOString(), error: "Couldn't load route status just now." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
