import crypto from "node:crypto";
import { NextResponse } from "next/server";

function verifySignature(rawBody: string, signatureHeader: string, secret: string) {
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((part) => {
      const [key, value] = part.split("=");
      return [key, value];
    }),
  );

  if (!parts.t || !parts.v1) return false;
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

  const event = JSON.parse(rawBody);
  if (event.event === "payment.success") {
    const intentId = event.data.intent_id;
    const userId = event.data.merchant_reference;

    // Idempotently mark the intent/user as paid in your database.
    // Use event.id or event.data.transaction_hash as a unique processed-event key.
    console.log("Unlock premium access", { intentId, userId });
  }

  return NextResponse.json({ received: true });
}
