import { NextResponse } from "next/server";
import { ethers } from "ethers";
import {
  ARC_TESTNET_CHAIN_ID,
  SUBSCRIPT_PROTOCOL_FEE_BPS,
  SUBSCRIPT_ROUTER_ADDRESS,
  STANDARD_CONTRACT_ADDRESS,
  USDC_NATIVE_GAS_ADDRESS,
} from "@/lib/contracts/constants";

export async function GET() {
  const config = {
    chainId: ARC_TESTNET_CHAIN_ID,
    routerAddress: SUBSCRIPT_ROUTER_ADDRESS,
    standardAddress: STANDARD_CONTRACT_ADDRESS,
    usdcAddress: USDC_NATIVE_GAS_ADDRESS,
    feeBps: SUBSCRIPT_PROTOCOL_FEE_BPS,
    minimumProtocolVersion: "1.1.0",
    adminAddress: "0x49315D8b3282812B92f454d45Cf041920a403492"
  };

  let signingKey = process.env.CLI_CONFIG_SIGNING_KEY;
  if (!signingKey) {
    console.warn("[CLI] WARNING: Using legacy PRIVATE_KEY fallback. Configure CLI_CONFIG_SIGNING_KEY.");
    signingKey = process.env.PRIVATE_KEY;
  }

  if (!signingKey) {
    return NextResponse.json(
      { error: "Server admin private key is not configured" },
      { status: 500 }
    );
  }

  try {
    const wallet = new ethers.Wallet(signingKey);
    const message = JSON.stringify(config);
    const signature = await wallet.signMessage(message);

    console.log(`[CLI Config Signed] recoveredAddress: ${wallet.address}`);

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
