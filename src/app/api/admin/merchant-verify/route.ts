import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionWallet } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const sessionWallet = await getSessionWallet(request.headers);
    if (!sessionWallet) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body.merchantAddress !== "string") {
      return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
    }

    const merchantAddress = body.merchantAddress.trim();
    const verified = Boolean(body.verified);

    const updated = await prisma.merchant.update({
      where: { walletAddress: merchantAddress },
      data: { verified },
    });

    return NextResponse.json({ success: true, merchant: updated });
  } catch (err: any) {
    console.error("Failed to update merchant verification:", err);
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
  }
}
