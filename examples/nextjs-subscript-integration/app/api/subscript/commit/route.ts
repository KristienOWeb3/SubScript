import { NextResponse } from "next/server";
import { ApplicationRouteError, requireApplicationUser } from "../_lib/applicationAuth";
import {
  applicationErrorResponse,
  subscriptRejectedResponse,
  subscriptRequest,
} from "../_lib/subscriptClient";

export async function POST(request: Request) {
  try {
    const user = requireApplicationUser(request, { mutation: true });
    const configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (!configuredAppUrl) {
      throw new ApplicationRouteError(
        500,
        "application_origin_not_configured",
        "NEXT_PUBLIC_APP_URL is not configured",
      );
    }
    let appUrl: URL;
    try {
      appUrl = new URL(configuredAppUrl);
    } catch {
      throw new ApplicationRouteError(
        500,
        "invalid_application_origin",
        "NEXT_PUBLIC_APP_URL must be an absolute URL",
      );
    }

    // Creates a hosted Pay-As-You-Go Vault Commit checkout intent.
    // The user approves the commitment on SubScript's hosted checkout page;
    // no manual wallet address pasting is required.
    const result = await subscriptRequest("/api/v1/commits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amountUsdc: "2.00",
        externalReference: `payg:user:${user.id}`,
        successUrl: new URL("/billing/payg-success", appUrl).toString(),
        cancelUrl: new URL("/billing/canceled", appUrl).toString(),
      }),
    });
    if (!result.ok) {
      return subscriptRejectedResponse(result, "SubScript PAYG commit checkout creation failed");
    }

    const payload = result.payload as Record<string, unknown>;
    if (typeof payload.checkoutUrl !== "string") {
      throw new ApplicationRouteError(
        502,
        "invalid_subscript_response",
        "SubScript commit response is missing checkoutUrl",
      );
    }

    return NextResponse.json({
      checkoutUrl: payload.checkoutUrl,
      commitIntentId: payload.commitIntentId,
    });
  } catch (error) {
    return applicationErrorResponse(error);
  }
}
