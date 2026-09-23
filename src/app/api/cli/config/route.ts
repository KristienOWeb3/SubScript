export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { ethers } from "ethers";
import {
  SUBSCRIPT_PROTOCOL_FEE_BPS,
  SUBSCRIPT_ROUTER_ADDRESS,
  STANDARD_CONTRACT_ADDRESS,
  USDC_NATIVE_GAS_ADDRESS,
} from "@/lib/contracts/constants";
import {
  ACTIVE_ARC_CHAIN,
  ACTIVE_ARC_CHAIN_ID,
  ACTIVE_NETWORK,
  ACTIVE_EXPLORER_URL,
} from "@/lib/network/registry";

export async function GET() {
  /* Sign with the dedicated CLI-config key if provided, otherwise the protocol owner key
     (PRIVATE_KEY) — which is also the key the CLI pins as its trust anchor, so owner-gated
     actions and CLI verification use one identity. */
  const signingKey = process.env.CLI_CONFIG_SIGNING_KEY || process.env.PRIVATE_KEY;
  if (!signingKey) {
    return NextResponse.json(
      { error: "Server admin private key is not configured" },
      { status: 500 }
    );
  }

  try {
    const wallet = new ethers.Wallet(signingKey);
    /* adminAddress is derived from the actual signing key so the signed payload is always
       self-consistent — the CLI verifies the recovered signer against its own pinned owner
       address, so a stale hardcoded value here can never mask a wrong server key. */
    const rpcUrl =
      process.env.NEXT_PUBLIC_ARC_RPC_PRIMARY ||
      process.env.NEXT_PUBLIC_ARC_RPC_URL ||
      ACTIVE_ARC_CHAIN.rpcUrls.default.http[0];

    const config = {
      chainId: ACTIVE_ARC_CHAIN_ID,
      network: ACTIVE_ARC_CHAIN.name,
      networkName: ACTIVE_ARC_CHAIN.name,
      environment: ACTIVE_NETWORK,
      rpcUrl,
      explorerUrl: ACTIVE_EXPLORER_URL,
      nativeCurrency: {
        name: ACTIVE_ARC_CHAIN.nativeCurrency.name,
        symbol: ACTIVE_ARC_CHAIN.nativeCurrency.symbol,
        decimals: ACTIVE_ARC_CHAIN.nativeCurrency.decimals,
      },
      routerAddress: SUBSCRIPT_ROUTER_ADDRESS,
      standardAddress: STANDARD_CONTRACT_ADDRESS,
      usdcAddress: USDC_NATIVE_GAS_ADDRESS,
      feeBps: SUBSCRIPT_PROTOCOL_FEE_BPS,
      minimumProtocolVersion: "1.1.0",
      adminAddress: wallet.address
    };
    const message = JSON.stringify(config);
    const signature = await wallet.signMessage(message);

    console.log(`[CLI Config Signed] signerAddress: ${wallet.address}`);

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

