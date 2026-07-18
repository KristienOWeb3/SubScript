import { NextResponse } from "next/server";

const SUBSCRIPT_BASE_URL = process.env.SUBSCRIPT_BASE_URL || "https://www.subscriptonarc.com";

export async function POST(request: Request) {
  const secretKey = process.env.SUBSCRIPT_SECRET_KEY;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!secretKey || !appUrl) {
    return NextResponse.json(
      { error: "SUBSCRIPT_SECRET_KEY and NEXT_PUBLIC_APP_URL must be configured" },
      { status: 500 },
    );
  }

  const body = await request.json().catch(() => null);
  const userId = typeof body?.userId === "string" ? body.userId : null;
  const orderId = typeof body?.orderId === "string" ? body.orderId : null;
  if (!userId || !orderId) {
    return NextResponse.json({ error: "Missing userId or orderId" }, { status: 400 });
  }

  const response = await fetch(`${SUBSCRIPT_BASE_URL}/api/intent`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: "Workshop ticket",
      amountUsdcMicros: "15000000",
      description: "Single admission to the Arc workshop",
      externalReference: `order:${orderId}:user:${userId}`,
      idempotencyKey: `workshop-ticket:${orderId}`,
      successUrl: `${appUrl}/billing/success`,
      cancelUrl: `${appUrl}/billing/canceled`,
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

  // Store payload.intent.id, payload.intent.receiptToken, userId, and orderId in your
  // database BEFORE returning checkoutUrl to the browser.
  return NextResponse.json({
    intentId: payload.intent.id,
    checkoutUrl: payload.intent.checkoutUrl,
    receiptToken: payload.intent.receiptToken,
  });
}
