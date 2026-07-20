import { NextResponse } from "next/server";

// Helper to strip sensitive information from telemetry data
function sanitizePayload(data: any): any {
  if (typeof data !== "object" || data === null) {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map(sanitizePayload);
  }

  const sanitized: any = {};
  for (const [key, val] of Object.entries(data)) {
    const keyLower = key.toLowerCase();
    
    // Skip known sensitive key names
    if (
      keyLower.includes("secret") ||
      keyLower.includes("key") ||
      keyLower.includes("phrase") ||
      keyLower.includes("mnemonic") ||
      keyLower.includes("private") ||
      keyLower.includes("password") ||
      keyLower.includes("token") ||
      keyLower.includes("sig")
    ) {
      sanitized[key] = "[REDACTED]";
      continue;
    }

    if (typeof val === "string") {
      // Redact 0x-prefixed 64-hex-char values (private keys / tx hashes)
      if (/^0x[0-9a-fA-F]{64}$/.test(val)) {
        sanitized[key] = "[REDACTED_HASH]";
        continue;
      }
      // Redact 0x-prefixed 130-hex-char values (ECDSA signatures)
      if (/^0x[0-9a-fA-F]{130}$/.test(val)) {
        sanitized[key] = "[REDACTED_SIGNATURE]";
        continue;
      }
      // Redact API secret keys (sk_test_... / sk_live_...)
      if (/^sk_(test|live)_/i.test(val)) {
        sanitized[key] = "[REDACTED_SECRET_KEY]";
        continue;
      }
      // Redact JWTs (three base64url segments separated by dots)
      if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(val) && val.length > 40) {
        sanitized[key] = "[REDACTED_JWT]";
        continue;
      }
    }

    sanitized[key] = sanitizePayload(val);
  }
  return sanitized;
}

export async function POST(request: Request) {
  try {
    const rawBody = await request.json();
    const body = sanitizePayload(rawBody);

    const { eventName, merchantId, cliVersion, templateVersion, mode, requestId } = body;

    if (!eventName) {
      return NextResponse.json({ error: "Missing eventName" }, { status: 400 });
    }

    // Log structured telemetry information
    console.log(
      `[INFO] CLI Telemetry Event: ${eventName} | ` +
      `RequestID: ${requestId || "N/A"} | ` +
      `Merchant: ${merchantId || "N/A"} | ` +
      `CLI: ${cliVersion || "N/A"} | ` +
      `Template: ${templateVersion || "N/A"} | ` +
      `Mode: ${mode || "N/A"}`
    );

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Failed to process telemetry" },
      { status: 500 }
    );
  }
}
