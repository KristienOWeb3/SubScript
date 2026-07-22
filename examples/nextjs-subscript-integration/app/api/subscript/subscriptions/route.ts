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

    // User id comes from the server-verified application session.
    // If a wallet address is linked to the session, pass subscriber; if not, SubScript's hosted
    // checkout page automatically binds the user's server-signed embedded wallet during checkout.
    const bodyPayload: Record<string, unknown> = {
      title: "Kris Script Pro",
      amountUsdcMicros: "2000000",
      interval: "weekly",
      merchantCustomerId: user.id,
      publishToDm: true,
      idempotencyKey: `kris-script-pro:${user.id}`,
      successUrl: new URL("/billing/subscription-success", appUrl).toString(),
      cancelUrl: new URL("/billing/canceled", appUrl).toString(),
    };

    if (user.walletAddress) {
      bodyPayload.subscriber = user.walletAddress;
    }

    const result = await subscriptRequest("/api/v1/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyPayload),
    });
    if (!result.ok) {
      return subscriptRejectedResponse(result, "SubScript subscription creation failed");
    }

    const subscription =
      result.payload.subscription &&
      typeof result.payload.subscription === "object" &&
      !Array.isArray(result.payload.subscription)
        ? (result.payload.subscription as Record<string, unknown>)
        : null;
    if (
      !subscription ||
      typeof subscription.id !== "string" ||
      typeof subscription.checkoutUrl !== "string"
    ) {
      throw new ApplicationRouteError(
        502,
        "invalid_subscript_response",
        "SubScript subscription response is missing required fields",
      );
    }

    // Persist subscription.id + user.id before redirecting. DM upgrades keep this account
    // binding and update the user's existing active subscription; downgrades are rejected.
    return NextResponse.json({
      subscriptionId: subscription.id,
      checkoutUrl: subscription.checkoutUrl,
      status: typeof subscription.status === "string" ? subscription.status : "incomplete",
    });
  } catch (error) {
    return applicationErrorResponse(error);
  }
}
