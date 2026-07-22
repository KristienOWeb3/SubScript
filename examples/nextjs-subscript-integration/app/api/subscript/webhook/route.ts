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

  await claimEventAndFulfillInMerchantDatabase(verifiedEvent);
  return NextResponse.json({ received: true });
}

async function claimEventAndFulfillInMerchantDatabase(event: {
  id: string;
  type: string;
  data: Record<string, unknown>;
}) {
  const { type, data } = event;

  // Extract merchant user identity from webhook payload
  const userId = data.merchant_customer_id || data.merchantCustomerId || data.external_reference || data.subscriber;
  const planName = String(data.plan_name || data.planName || "PRO").toUpperCase();

  console.log(`[SubScript Webhook Received] Event: ${type}, ID: ${event.id}, User: ${userId}`);

  switch (type) {
    case "subscription.created":
    case "subscription.updated":
    case "subscription.renewed": {
      // Automatically upgrade user account from FREE to subscribed tier (e.g., PRO/PREMIUM)
      console.log(`[Tier Sync] Upgrading user ${userId} to plan: ${planName}`);
      // UPDATE users SET tier = planName, subscription_status = 'ACTIVE' WHERE id = userId;
      break;
    }

    case "subscription.canceled":
    case "subscription.payment_failed": {
      // Downgrade user account back to FREE
      console.log(`[Tier Sync] Downgrading user ${userId} back to FREE tier (reason: ${type})`);
      // UPDATE users SET tier = 'FREE', subscription_status = 'INACTIVE' WHERE id = userId;
      break;
    }

    case "vault.committed": {
      // Enable Pay-As-You-Go metered service access
      console.log(`[PAYG Sync] Activating PAYG vault service for user ${userId}`);
      // UPDATE users SET payg_active = true WHERE id = userId;
      break;
    }

    case "payment.succeeded": {
      // Fulfill one-time purchase
      console.log(`[Fulfillment] One-time payment settled for order ${data.intent_id || event.id}`);
      break;
    }

    default:
      console.log(`[SubScript Webhook] Ignored unhandled event type: ${type}`);
  }
}
