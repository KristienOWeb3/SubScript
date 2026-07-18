import crypto from "node:crypto";
import { NextResponse } from "next/server";
import {
  ApplicationRouteError,
  createIntentStatusToken,
  requireApplicationUser,
} from "../_lib/applicationAuth";
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

    // This example sells one fixed ticket per signed-in user. Both identifiers are
    // server-derived; the browser cannot choose another user's account or price.
    const orderId = crypto
      .createHash("sha256")
      .update(`workshop-ticket:${user.id}`)
      .digest("hex")
      .slice(0, 24);
    const result = await subscriptRequest("/api/intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Workshop ticket",
        amountUsdcMicros: "15000000",
        description: "Single admission to the Arc workshop",
        externalReference: `order:${orderId}:user:${user.id}`,
        idempotencyKey: `workshop-ticket:${orderId}`,
        successUrl: new URL("/billing/success", appUrl).toString(),
        cancelUrl: new URL("/billing/canceled", appUrl).toString(),
      }),
    });
    if (!result.ok) {
      return subscriptRejectedResponse(result, "SubScript checkout creation failed");
    }

    const intent =
      result.payload.intent &&
      typeof result.payload.intent === "object" &&
      !Array.isArray(result.payload.intent)
        ? (result.payload.intent as Record<string, unknown>)
        : null;
    if (
      !intent ||
      typeof intent.id !== "string" ||
      typeof intent.checkoutUrl !== "string"
    ) {
      throw new ApplicationRouteError(
        502,
        "invalid_subscript_response",
        "SubScript checkout response is missing required fields",
      );
    }

    // Persist intent.id, receiptToken, user.id, and orderId in your database before
    // redirecting. The short-lived status token is an additional ownership check for polling.
    return NextResponse.json({
      intentId: intent.id,
      checkoutUrl: intent.checkoutUrl,
      receiptToken: typeof intent.receiptToken === "string" ? intent.receiptToken : null,
      statusToken: createIntentStatusToken(intent.id, user.id),
    });
  } catch (error) {
    return applicationErrorResponse(error);
  }
}
