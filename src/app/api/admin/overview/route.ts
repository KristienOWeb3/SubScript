import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { prisma } from "@/lib/prisma";
import { getSessionWallet } from "@/lib/auth";
import { USDC_NATIVE_GAS_ADDRESS } from "@/lib/contracts/constants";

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
];

export async function GET(request: Request) {
  try {
    const sessionWallet = await getSessionWallet(request.headers);
    if (!sessionWallet) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sponsorPrivateKey = process.env.SPONSOR_PRIVATE_KEY;
    let sponsorWalletAddress: string | null = null;
    let sponsorBalanceUsdc = "0";

    if (sponsorPrivateKey) {
      try {
        const wallet = new ethers.Wallet(sponsorPrivateKey);
        sponsorWalletAddress = wallet.address;

        const rpcUrl = process.env.ARC_RPC_PRIMARY || process.env.RPC_URL || "https://rpc.testnet.arc.network";
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const usdcContract = new ethers.Contract(USDC_NATIVE_GAS_ADDRESS, ERC20_ABI, provider);
        const rawBal = await usdcContract.balanceOf(sponsorWalletAddress);
        sponsorBalanceUsdc = ethers.formatUnits(rawBal, 6);
      } catch (err) {
        console.error("Failed to read sponsor wallet balance:", err);
      }
    }

    /* Fetch all merchants */
    const merchantsRaw = await prisma.merchant.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
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

    /* Fetch active bans */
    const [bannedAccounts, bannedIps] = await Promise.all([
      prisma.bannedAccount.findMany({ orderBy: { createdAt: "desc" } }).catch(() => []),
      prisma.bannedIp.findMany({ orderBy: { createdAt: "desc" } }).catch(() => []),
    ]);

    return NextResponse.json({
      success: true,
      sponsorWalletAddress,
      sponsorBalanceUsdc,
      merchants,
      bannedAccounts,
      bannedIps,
    });
  } catch (err: any) {
    console.error("Admin overview failed:", err);
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
  }
}
