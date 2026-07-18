import { NextResponse } from "next/server";

const SUBSCRIPT_BASE_URL = process.env.SUBSCRIPT_BASE_URL || "https://www.subscriptonarc.com";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ intentId: string }> },
) {
  const secretKey = process.env.SUBSCRIPT_SECRET_KEY;
  if (!secretKey) {
    return NextResponse.json({ error: "SUBSCRIPT_SECRET_KEY is not configured" }, { status: 500 });
  }

  const { intentId } = await params;
  const response = await fetch(
    `${SUBSCRIPT_BASE_URL}/api/intent/${encodeURIComponent(intentId)}`,
    {
      headers: { Authorization: `Bearer ${secretKey}` },
      cache: "no-store",
    },
  );
  const payload = await response.json().catch(() => ({}));
  return NextResponse.json(payload, { status: response.status });
}
