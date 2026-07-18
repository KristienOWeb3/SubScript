import { NextResponse } from "next/server";
import { requireApplicationUser } from "../_lib/applicationAuth";
import {
  applicationErrorResponse,
  subscriptRejectedResponse,
  subscriptRequest,
} from "../_lib/subscriptClient";

export async function POST(request: Request) {
  try {
    requireApplicationUser(request, { admin: true, mutation: true });

    // Catalog financial terms are application-owned constants. Do not accept arbitrary
    // amount, period, or visibility fields from an untrusted browser request.
    const result = await subscriptRequest("/api/v1/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Kris Script Pro",
        description: "Recurring weekly access",
        amountUsdcMicros: "2000000",
        periodDays: 7,
      }),
    });
    if (!result.ok) {
      return subscriptRejectedResponse(result, "SubScript plan creation failed");
    }
    return NextResponse.json(result.payload, { status: result.status });
  } catch (error) {
    return applicationErrorResponse(error);
  }
}
