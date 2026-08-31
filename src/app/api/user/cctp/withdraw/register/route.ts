import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import { getSessionWallet } from "@/lib/auth";
import { pgQuery, pgMaybeOne } from "@/lib/serverPg";
import { validateBridgeRequest, formatMicros } from "@/lib/cctp/feeEngine";
import { processPendingCctpTransfers } from "@/lib/cctp/attestationWorker";
import { getArcRpcUrl } from "@/lib/cctp/relayer";
import {
  ARC_CCTP_DOMAIN_ID,
  BRIDGE_FEE_TREASURY_ADDRESS,
  USDC_NATIVE_GAS_ADDRESS,
} from "@/lib/contracts/constants";

export const maxDuration = 60;

const TX_HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/;
const TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");

/**
 * Records a withdrawal that a browser wallet has already burned on Arc, and hands it to the keeper.
 *
 * External wallets hold their own keys, so the server cannot burn on their behalf the way
 * /api/user/cctp/withdraw does for in-app wallets. The browser performs the same split (fee transfer
 * to the treasury, then burn the net) and reports both hashes here. The fee transfer is verified
 * against Arc before the row is written, so the ledger can only ever record a fee that was paid.
 */
export async function POST(req: NextRequest) {
  try {
    const wallet = await getSessionWallet(req.headers);
    if (!wallet) {
      return NextResponse.json({ error: "Please connect your wallet and try again." }, { status: 401 });
    }
    const userWallet = wallet.toLowerCase();

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
    }

    const { destinationChainIdOrDomain, recipientAddress, amountMicros, burnTxHash, feeTxHash } = body;

    if (!TX_HASH_PATTERN.test(String(burnTxHash || ""))) {
      return NextResponse.json({ error: "That burn transaction hash doesn't look right." }, { status: 400 });
    }
    if (typeof recipientAddress !== "string" || !recipientAddress.trim()) {
      return NextResponse.json({ error: "Enter the address that should receive the USDC." }, { status: 400 });
    }

    const feeInfo = validateBridgeRequest({
      direction: "outbound_withdrawal",
      targetChainIdOrDomain: destinationChainIdOrDomain,
      amountMicros,
      userWallet,
      recipientAddress: recipientAddress.trim(),
    });

    const existing = await pgMaybeOne<{ id: string; status: string }>(
      `SELECT id, status FROM cctp_bridge_transfers WHERE burn_tx_hash = $1 LIMIT 1`,
      [String(burnTxHash)],
    );
    if (existing) {
      return NextResponse.json({
        success: true,
        transferId: existing.id,
        status: existing.status,
        alreadyRecorded: true,
      });
    }

    if (feeInfo.feeMicros > 0n) {
      if (!TX_HASH_PATTERN.test(String(feeTxHash || ""))) {
        return NextResponse.json({ error: "That fee transaction hash doesn't look right." }, { status: 400 });
      }
      const verified = await verifyArcFeeTransfer({
        feeTxHash: String(feeTxHash),
        from: userWallet,
        minAmountMicros: feeInfo.feeMicros,
      });
      if (!verified.ok) {
        return NextResponse.json({ error: verified.reason }, { status: 400 });
      }
    }

    const inserted = await pgQuery<{ id: string }>(
      `INSERT INTO cctp_bridge_transfers
         (direction, user_wallet, recipient_address, origin_chain_id, origin_domain,
          destination_chain_id, destination_domain, gross_amount_micros, fee_amount_micros,
          net_amount_micros, fee_bps, fee_tx_hash, burn_tx_hash, status)
       VALUES ('outbound_withdrawal', $1, $2, 'arc', $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending_attestation')
       ON CONFLICT (burn_tx_hash) DO UPDATE SET updated_at = now()
       RETURNING id`,
      [
        userWallet,
        recipientAddress.trim().toLowerCase(),
        ARC_CCTP_DOMAIN_ID,
        feeInfo.chainId,
        feeInfo.domain,
        feeInfo.grossMicros.toString(),
        feeInfo.feeMicros.toString(),
        feeInfo.netMicros.toString(),
        feeInfo.feeBps,
        feeInfo.feeMicros > 0n ? String(feeTxHash) : null,
        String(burnTxHash),
      ],
    );

    /* Trigger keeper in background to start polling Iris and relay minting onto destination chain */
    void processPendingCctpTransfers().catch((err) =>
      console.warn("[api/user/cctp/withdraw/register] background keeper error:", err?.message)
    );

    return NextResponse.json({
      success: true,
      transferId: inserted[0]?.id,
      fee: {
        grossUsdc: formatMicros(feeInfo.grossMicros, 6),
        feeUsdc: formatMicros(feeInfo.feeMicros, 6),
        netUsdc: formatMicros(feeInfo.netMicros, 6),
        feePercentage: feeInfo.feePercentage,
        chainName: feeInfo.chainName,
      },
    });
  } catch (error: any) {
    const reason = String(error?.shortMessage || error?.message || "Failed to record withdrawal");
    console.error("[api/user/cctp/withdraw/register] error:", reason);
    return NextResponse.json({ error: reason }, { status: 400 });
  }
}

async function verifyArcFeeTransfer(params: {
  feeTxHash: string;
  from: string;
  minAmountMicros: bigint;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  let receipt: ethers.TransactionReceipt | null;
  try {
    const provider = new ethers.JsonRpcProvider(getArcRpcUrl(), undefined, { staticNetwork: true });
    receipt = await provider.getTransactionReceipt(params.feeTxHash);
  } catch (error: any) {
    console.error("[api/user/cctp/withdraw/register] fee receipt lookup failed:", error?.message);
    return { ok: false, reason: "We couldn't confirm the fee payment just now. Try again in a moment." };
  }

  if (!receipt) {
    return { ok: false, reason: "We couldn't find that fee payment on Arc yet. Wait for it to confirm and try again." };
  }
  if (receipt.status !== 1) {
    return { ok: false, reason: "That fee payment failed on chain." };
  }

  const treasury = BRIDGE_FEE_TREASURY_ADDRESS.toLowerCase();
  const sender = params.from.toLowerCase();
  const usdcAddress = USDC_NATIVE_GAS_ADDRESS.toLowerCase();

  const paid = receipt.logs.some((log) => {
    if (log.address.toLowerCase() !== usdcAddress) return false;
    if (log.topics[0] !== TRANSFER_TOPIC || log.topics.length < 3) return false;
    const logFrom = `0x${log.topics[1].slice(26)}`.toLowerCase();
    const logTo = `0x${log.topics[2].slice(26)}`.toLowerCase();
    if (logFrom !== sender || logTo !== treasury) return false;
    try {
      return BigInt(log.data) >= params.minAmountMicros;
    } catch {
      return false;
    }
  });

  if (!paid) {
    return {
      ok: false,
      reason: `That transaction doesn't contain a ${formatMicros(params.minAmountMicros, 6)} USDC fee payment to the treasury.`,
    };
  }

  return { ok: true };
}
