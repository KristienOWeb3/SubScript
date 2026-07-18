import crypto from "node:crypto";
import { NextResponse } from "next/server";

function verifySignature(rawBody: string, signatureHeader: string, secret: string) {
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((part) => {
      const [key, value] = part.split("=");
      return [key, value];
    }),
  );

  if (!parts.t || !parts.v1 || !/^[a-fA-F0-9]{64}$/.test(parts.v1)) return false;
  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp) || Math.abs(Math.floor(Date.now() / 1000) - timestamp) > 300) {
    return false;
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${parts.t}.${rawBody}`)
    .digest("hex");

  const received = Buffer.from(parts.v1, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return received.length === expectedBuffer.length && crypto.timingSafeEqual(received, expectedBuffer);
}

export async function POST(request: Request) {
  const secret = process.env.SUBSCRIPT_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "SUBSCRIPT_WEBHOOK_SECRET is not configured" }, { status: 500 });
  }

  const signature = request.headers.get("x-subscript-signature") || "";
  const rawBody = await request.text();
  if (!verifySignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Webhook body must be valid JSON" }, { status: 400 });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return NextResponse.json({ error: "Malformed webhook event" }, { status: 400 });
  }
  const event = parsed as {
    id?: unknown;
    type?: unknown;
    data?: unknown;
  };
  if (
    typeof event.id !== "string" ||
    typeof event.type !== "string" ||
    !event.data ||
    typeof event.data !== "object" ||
    Array.isArray(event.data)
  ) {
    return NextResponse.json({ error: "Malformed webhook event" }, { status: 400 });
  }
  const verifiedEvent = {
    id: event.id,
    type: event.type,
    data: event.data as Record<string, unknown>,
  };

  /*
   * Idempotent fulfillment must be one database transaction:
   *
   *   1. INSERT event.id into processed_webhook_events where event_id has a UNIQUE constraint.
   *   2. If the insert conflicts, return 200 immediately: this delivery was already handled.
   *   3. Update the order/subscription entitlement using data.intent_id,
   *      data.merchant_customer_id, or data.external_reference.
   *   4. Commit, then return 200. Do not return 2xx if the transaction failed.
   *
   * Handle `payment.succeeded` for one-time orders and the subscription lifecycle events
   * (`subscription.created`, `.updated`, `.renewed`, `.payment_failed`, `.canceled`) for
   * recurring entitlements. Never fulfill from a browser success redirect.
   */
  await claimEventAndFulfillInMerchantDatabase(verifiedEvent);
  return NextResponse.json({ received: true });
}

async function claimEventAndFulfillInMerchantDatabase(event: {
  id: string;
  type: string;
  data: Record<string, unknown>;
}) {
  // Replace this example seam with the transaction above using your ORM/database.
  // Throw on any failure so SubScript retries instead of receiving a false acknowledgement.
  void event;
}
