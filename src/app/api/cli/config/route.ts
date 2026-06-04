import { NextResponse } from "next/server";
import { ethers } from "ethers";

const privateKey = process.env.PRIVATE_KEY;

export async function GET() {
  const config = {
    chainId: 5042002,
    routerAddress: "0x6946B7746c2968B195BD15319D25F67E587CAe3C",
    standardAddress: "0x3c7f095575C66eF21D501D63E265A51240849924",
    usdcAddress: "0x3600000000000000000000000000000000000000",
    feeBps: 100,
    minimumProtocolVersion: "1.1.0",
    adminAddress: "0x59D67d7c31Ec4835648A3fCb9e9E767A18bBfC69"
  };

  if (!privateKey) {
    return NextResponse.json(
      { error: "Server admin private key is not configured" },
      { status: 500 }
    );
  }

  try {
    const wallet = new ethers.Wallet(privateKey);
    const message = JSON.stringify(config);
    const signature = await wallet.signMessage(message);

    return NextResponse.json({
      config,
      signature
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Failed to sign configuration" },
      { status: 500 }
    );
  }
}
