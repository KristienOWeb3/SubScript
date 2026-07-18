import { NextResponse } from "next/server";

const SUBSCRIPT_BASE_URL = process.env.SUBSCRIPT_BASE_URL || "https://www.subscriptonarc.com";
const WALLET_PATTERN = /^0x[a-fA-F0-9]{40}$/;

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
  const userId = typeof body?.userId === "string" ? body.userId.trim() : "";
  const subscriber = typeof body?.subscriber === "string" ? body.subscriber.trim() : "";
  if (!userId || !WALLET_PATTERN.test(subscriber)) {
    return NextResponse.json({ error: "Valid userId and subscriber wallet are required" }, { status: 400 });
  }

  const response = await fetch(`${SUBSCRIPT_BASE_URL}/api/v1/subscriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: "Kris Script Pro",
      amountUsdcMicros: "2000000",
      interval: "weekly",
      subscriber,
      merchantCustomerId: userId,
      publishToDm: true,
      idempotencyKey: `kris-script-pro:${userId}`,
      successUrl: `${appUrl}/billing/subscription-success`,
      cancelUrl: `${appUrl}/billing/canceled`,
      sandbox: secretKey.startsWith("sk_test_"),
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return NextResponse.json(
      { error: payload.error || "SubScript subscription creation failed" },
      { status: response.status },
    );
  }

  // Persist subscription.id + merchantCustomerId before redirecting. DM upgrades keep this
  // account binding and update the user's existing active subscription; downgrades are rejected.
  return NextResponse.json({
    subscriptionId: payload.subscription.id,
    checkoutUrl: payload.subscription.checkoutUrl,
    status: payload.subscription.status,
  });
}
