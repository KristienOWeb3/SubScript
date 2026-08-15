import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin/guard";
import { isAdminWallet } from "@/lib/admin/identity";
import { recordAdminAction } from "@/lib/admin/audit";
import { setIpBanInRedis, clearIpBanInRedis } from "@/lib/admin/ipBans";

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => null);
    if (!body || !body.type || !body.target || !body.action) {
      return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
    }

    const { type, target, action, reason } = body;
    const cleanTarget = String(target).trim();
    const cleanReason = reason ? String(reason).trim() : null;
    if (!cleanTarget) {
      return NextResponse.json({ error: "Target is required" }, { status: 400 });
    }
    const isBan = action === "BAN";

    if (type === "ACCOUNT") {
      let address = cleanTarget.toLowerCase();

      // Support DNS alias lookup (e.g. badactor.sub)
      if (address.includes(".") && !/^0x[a-f0-9]{40}$/.test(address)) {
        const aliasRow = await prisma.addressAlias.findUnique({
          where: { alias: address },
          select: { address: true },
        });
        if (aliasRow?.address) {
          address = aliasRow.address.toLowerCase();
        }
      }

      /* Never let the console ban an admin — root or delegated. Account bans are enforced
         inside the session lookup, so banning an admin wallet revokes the session needed
         to undo it. For your own wallet that is an unrecoverable lockout from one typo. */
      if (isBan && (await isAdminWallet(address))) {
        return NextResponse.json(
          { error: "Refusing to ban an admin wallet — this would lock that admin out of the console." },
          { status: 400 },
        );
      }

      if (isBan) {
        await prisma.bannedAccount.upsert({
          where: { address },
          create: { address, reason: cleanReason, bannedBy: auth.admin.wallet },
          update: { reason: cleanReason, bannedBy: auth.admin.wallet },
        });
      } else {
        await prisma.bannedAccount.deleteMany({ where: { address } });
      }

      await recordAdminAction({
        actor: auth.admin.wallet,
        action: isBan ? "BAN_ACCOUNT" : "UNBAN_ACCOUNT",
        target: address,
        detail: { reason: cleanReason, originalTarget: cleanTarget },
        request,
      });

      return NextResponse.json({ success: true });
    }

    if (type === "IP") {
      const ip = cleanTarget;

      if (isBan) {
        await prisma.bannedIp.upsert({
          where: { ip },
          create: { ip, reason: cleanReason, bannedBy: auth.admin.wallet },
          update: { reason: cleanReason, bannedBy: auth.admin.wallet },
        });
      } else {
        await prisma.bannedIp.deleteMany({ where: { ip } });
      }

      /* The durable row is the source of truth, but middleware enforces IP bans from the
         Redis `ban:<ip>` key it already checks — writing the row alone would record a ban
         that never blocks anything (which is what this endpoint did before). */
      const sync = isBan ? await setIpBanInRedis(ip) : await clearIpBanInRedis(ip);

      await recordAdminAction({
        actor: auth.admin.wallet,
        action: isBan ? "BAN_IP" : "UNBAN_IP",
        target: ip,
        detail: { reason: cleanReason, enforced: sync.ok },
        request,
      });

      return NextResponse.json({
        success: true,
        /* Report a failed Redis sync rather than implying enforcement that is not live. */
        warning: sync.ok
          ? undefined
          : `Saved to the database, but the edge ban list could not be updated (${sync.error}). This IP is not actually ${isBan ? "blocked" : "unblocked"} yet.`,
      });
    }

    return NextResponse.json({ error: "Invalid ban type" }, { status: 400 });
  } catch (err: any) {
    console.error("Failed to update ban:", err);
    return NextResponse.json({ error: "Failed to update ban." }, { status: 500 });
  }
}
