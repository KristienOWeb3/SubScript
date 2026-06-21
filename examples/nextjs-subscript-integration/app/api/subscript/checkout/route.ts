import { NextResponse } from "next/server";

const SUBSCRIPT_BASE_URL = process.env.SUBSCRIPT_BASE_URL || "https://subscriptonarc.com";

export async function POST(request: Request) {
  const secretKey = process.env.SUBSCRIPT_SECRET_KEY;
  if (!secretKey) {
    return NextResponse.json({ error: "SUBSCRIPT_SECRET_KEY is not configured" }, { status: 500 });
  }

  const body = await request.json().catch(() => null);
  const userId = typeof body?.userId === "string" ? body.userId : null;
  if (!userId) {
    return NextResponse.json({ error: "Missing userId" }, { status: 400 });
  }

  const response = await fetch(`${SUBSCRIPT_BASE_URL}/api/intent`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: "Premium Plan",
      amountUsdc: "15000000",
      description: "Monthly premium access",
      externalReference: userId,
      idempotencyKey: `premium:${userId}`,
      sandbox: secretKey.startsWith("sk_test_"),
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return NextResponse.json(
      {
        error: payload.error || "SubScript checkout creation failed",
        message: payload.message,
        resolutionUrl: payload.resolution_url,
      },
      { status: response.status },
    );
  }

  // Store payload.intent.id beside userId/orderId in your database before redirecting.
  return NextResponse.json({
    intentId: payload.intent.id,
    checkoutUrl: payload.intent.checkoutUrl,
    receiptToken: payload.intent.receiptToken,
  });
}
