import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin/guard";
import { getSponsorWalletStatus } from "@/lib/sponsor/gas";
import { jsonOk } from "@/lib/http/json";

export async function GET(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if (!auth.ok) return auth.response;

    /* Sponsor status comes from the shared helper so the console reads the SAME native
       18dp balance that sponsorship decisions gate on. This route used to read an ERC-20
       balanceOf at 6 decimals — a different asset entirely, which could show a healthy
       balance while every sponsored payment failed with sponsor_underfunded. */
    const sponsor = await getSponsorWalletStatus();

    /* Narrow select, not the whole row. `merchants` carries available_balance_usdc and
       reserved_balance_usdc as BigInt, and this screen renders neither — pulling them only
       widens the query and leaves a BigInt in scope for a future edit to leak into the
       response, which is exactly how merchant verification came to 500 (see
       api/admin/merchant-verify). Ask for the five columns the console draws. */
    const merchantsRaw = await prisma.merchant.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        walletAddress: true,
        tier: true,
        verified: true,
        profilePic: true,
        createdAt: true,
      },
    });

    const merchantAddresses = merchantsRaw.map((m) => m.walletAddress.toLowerCase());
    const aliases = await prisma.addressAlias.findMany({
      where: { address: { in: merchantAddresses } },
    });
    const aliasMap = new Map(aliases.map((a) => [a.address.toLowerCase(), a.alias]));

    const merchants = merchantsRaw.map((m) => ({
      walletAddress: m.walletAddress,
      merchantName: aliasMap.get(m.walletAddress.toLowerCase()) || m.walletAddress.slice(0, 10),
      tier: m.tier,
      verified: m.verified,
      profilePic: m.profilePic,
      createdAt: m.createdAt,
    }));

    /* The defensive .catch(() => []) that used to wrap these reads hid the real problem:
       the tables did not exist, so the ban form 500'd on every submit while the lists
       silently rendered empty. The 20260810120000 migration creates them; let a genuine
       failure surface now instead of masquerading as "no bans". */
    const [bannedAccounts, bannedIps, totalUsers] = await Promise.all([
      prisma.bannedAccount.findMany({ orderBy: { createdAt: "desc" } }),
      prisma.bannedIp.findMany({ orderBy: { createdAt: "desc" } }),
      prisma.accountRole.count(),
    ]);

    return jsonOk({
      success: true,
      sponsor,
      /* Retained for any client still reading the old flat fields. */
      sponsorWalletAddress: sponsor.address,
      sponsorBalanceUsdc: sponsor.balanceUsdc ?? "0",
      merchants,
      bannedAccounts,
      bannedIps,
      totalUsers,
      viewerIsRoot: auth.admin.isRoot,
    });
  } catch (err: any) {
    console.error("Admin overview failed:", err);
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
  }
}
