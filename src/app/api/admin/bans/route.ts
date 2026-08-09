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
    if (!body || !body.type || !body.target || !body.action) {
      return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
    }

    const { type, target, action, reason } = body;
    const cleanTarget = target.trim();
    const cleanReason = reason ? reason.trim() : null;

    if (type === "ACCOUNT") {
      if (action === "BAN") {
        await prisma.bannedAccount.upsert({
          where: { address: cleanTarget.toLowerCase() },
          create: { address: cleanTarget.toLowerCase(), reason: cleanReason },
          update: { reason: cleanReason },
        });
      } else {
        await prisma.bannedAccount.deleteMany({
          where: { address: cleanTarget.toLowerCase() },
        });
      }
    } else if (type === "IP") {
      if (action === "BAN") {
        await prisma.bannedIp.upsert({
          where: { ip: cleanTarget },
          create: { ip: cleanTarget, reason: cleanReason },
          update: { reason: cleanReason },
        });
      } else {
        await prisma.bannedIp.deleteMany({
          where: { ip: cleanTarget },
        });
      }
    } else {
      return NextResponse.json({ error: "Invalid ban type" }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("Failed to update ban:", err);
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
  }
}
