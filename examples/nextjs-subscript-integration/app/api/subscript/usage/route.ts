import { NextResponse } from "next/server";

const SUBSCRIPT_BASE_URL = process.env.SUBSCRIPT_BASE_URL || "https://www.subscriptonarc.com";
const WALLET_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const MICRO_USDC_PATTERN = /^[1-9]\d*$/;

export async function POST(request: Request) {
  const secretKey = process.env.SUBSCRIPT_SECRET_KEY;
  if (!secretKey) {
    return NextResponse.json({ error: "SUBSCRIPT_SECRET_KEY is not configured" }, { status: 500 });
  }

  const body = await request.json().catch(() => null);
  const userAddress = typeof body?.userAddress === "string" ? body.userAddress.trim() : "";
  const amountUsdcMicros =
    typeof body?.amountUsdcMicros === "string" ? body.amountUsdcMicros.trim() : "";
  if (!WALLET_PATTERN.test(userAddress) || !MICRO_USDC_PATTERN.test(amountUsdcMicros)) {
    return NextResponse.json(
      { error: "Valid userAddress and positive integer amountUsdcMicros are required" },
      { status: 400 },
    );
  }

  // Charge before serving the metered unit. On 402, do not perform the paid work.
  const response = await fetch(`${SUBSCRIPT_BASE_URL}/api/user/vault/report-usage`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ userAddress, amountUsdcMicros }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return NextResponse.json(payload, { status: response.status });
  }

  return NextResponse.json({
    charged: true,
    usage: payload,
    // Perform and return the merchant's metered work only after this response is successful.
  });
}
