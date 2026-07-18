import { NextResponse } from "next/server";

const SUBSCRIPT_BASE_URL = process.env.SUBSCRIPT_BASE_URL || "https://www.subscriptonarc.com";

export async function POST() {
  const secretKey = process.env.SUBSCRIPT_SECRET_KEY;
  if (!secretKey) {
    return NextResponse.json({ error: "SUBSCRIPT_SECRET_KEY is not configured" }, { status: 500 });
  }

  const response = await fetch(`${SUBSCRIPT_BASE_URL}/api/v1/plans`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "Kris Script Pro",
      description: "Recurring weekly access",
      amountUsdcMicros: "2000000",
      periodDays: 7,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  return NextResponse.json(payload, { status: response.status });
}
