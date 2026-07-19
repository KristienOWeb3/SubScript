import { NextResponse } from "next/server";
import {
  ApplicationRouteError,
  assertIntentStatusOwnership,
  requireApplicationUser,
} from "../../_lib/applicationAuth";
import {
  applicationErrorResponse,
  subscriptRejectedResponse,
  subscriptRequest,
} from "../../_lib/subscriptClient";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ intentId: string }> },
) {
  try {
    const user = requireApplicationUser(request);
    const { intentId } = await params;
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(intentId)) {
      throw new ApplicationRouteError(400, "invalid_intent_id", "Invalid checkout id");
    }
    const statusToken = new URL(request.url).searchParams.get("token");
    assertIntentStatusOwnership(statusToken, intentId, user.id);

    // Authentication plus the signed, short-lived token prevents one application user from
    // using the merchant secret proxy to inspect another user's checkout.
    const result = await subscriptRequest(`/api/intent/${encodeURIComponent(intentId)}`, {
      cache: "no-store",
    });
    if (!result.ok) {
      return subscriptRejectedResponse(result, "SubScript status lookup failed");
    }
    return NextResponse.json(result.payload, { status: result.status });
  } catch (error) {
    return applicationErrorResponse(error);
  }
}
