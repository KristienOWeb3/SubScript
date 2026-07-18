import { NextResponse } from "next/server";
import { ApplicationRouteError, requireApplicationUser } from "../_lib/applicationAuth";
import {
  applicationErrorResponse,
  subscriptRejectedResponse,
  subscriptRequest,
} from "../_lib/subscriptClient";

const TRANSCRIPT_UNIT_PRICE_MICROS = "25000";

export async function POST(request: Request) {
  try {
    const user = requireApplicationUser(request, { mutation: true });
    if (!user.walletAddress) {
      throw new ApplicationRouteError(
        400,
        "application_wallet_required",
        "Link a wallet to your application account before using metered features",
      );
    }

    // The wallet comes from the signed application session and the unit price is owned by
    // server code. Never let a browser choose the billed wallet or amount.
    const result = await subscriptRequest("/api/user/vault/report-usage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userAddress: user.walletAddress,
        amountUsdcMicros: TRANSCRIPT_UNIT_PRICE_MICROS,
      }),
    });
    if (!result.ok) {
      return subscriptRejectedResponse(result, "SubScript usage charge failed");
    }

    // Perform and return the merchant's metered work only after this succeeds.
    return NextResponse.json({ charged: true, usage: result.payload });
  } catch (error) {
    return applicationErrorResponse(error);
  }
}
