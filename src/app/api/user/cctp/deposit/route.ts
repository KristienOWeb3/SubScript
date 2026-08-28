import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import { getSessionWallet } from "@/lib/auth";
import { pgQuery, pgMaybeOne } from "@/lib/serverPg";
import { calculateBridgeFee, formatMicros, resolveBridgeChain } from "@/lib/cctp/feeEngine";
import { notifyDepositStarted } from "@/lib/cctp/notifications";
import { resolveRpcUrl } from "@/lib/cctp/relayer";
import { ARC_CCTP_DOMAIN_ID, BRIDGE_FEE_TREASURY_ADDRESS } from "@/lib/contracts/constants";

export const maxDuration = 60;

const TX_HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/;
const TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");

/**
 * Records a deposit that the browser has already burned on an origin chain, and hands it to the
 * keeper to relay onto Arc.
 *
 * The fee is a plain USDC transfer to the treasury on the origin chain, sent by the browser before
 * the burn, and only the net is burned. That transfer is verified against the origin chain here, so
 * a caller cannot claim a fee it never paid. The burn needs no such check: the keeper only ever
 * relays what Circle attested, and the attested message carries its own amount and recipient.
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

    const { originChainId, grossAmountMicros, burnTxHash, feeTxHash } = body;

    if (!TX_HASH_PATTERN.test(String(burnTxHash || ""))) {
      return NextResponse.json({ error: "That burn transaction hash doesn't look right." }, { status: 400 });
    }

    /* Recompute the split from the gross rather than trusting a client-supplied net. */
    const feeInfo = calculateBridgeFee(grossAmountMicros, originChainId, "inbound_deposit");
    const chainConfig = resolveBridgeChain(originChainId);
    const chainId = Number(originChainId);

    /* Idempotent by burn hash: a retry from a reloaded page returns the existing row instead of
       creating a second ledger entry for one burn. */
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

    /* Verify the fee actually moved to the treasury on the origin chain. */
    if (feeInfo.feeMicros > 0n) {
      if (!TX_HASH_PATTERN.test(String(feeTxHash || ""))) {
        return NextResponse.json({ error: "That fee transaction hash doesn't look right." }, { status: 400 });
      }
      const verification = await verifyFeeTransfer({
        chainId,
        usdc: chainConfig.usdc,
        feeTxHash: String(feeTxHash),
        from: userWallet,
        minAmountMicros: feeInfo.feeMicros,
      });
      if (!verification.ok) {
        return NextResponse.json({ error: verification.reason }, { status: 400 });
      }
    }

    const inserted = await pgQuery<{ id: string }>(
      `INSERT INTO cctp_bridge_transfers
         (direction, user_wallet, recipient_address, origin_chain_id, origin_domain,
          destination_chain_id, destination_domain, gross_amount_micros, fee_amount_micros,
          net_amount_micros, fee_bps, fee_tx_hash, burn_tx_hash, status)
       VALUES ('inbound_deposit', $1, $1, $2, $3, 'arc', $4, $5, $6, $7, $8, $9, $10, 'pending_attestation')
       ON CONFLICT (burn_tx_hash) DO UPDATE SET updated_at = now()
       RETURNING id`,
      [
        userWallet,
        String(chainId),
        chainConfig.domain,
        ARC_CCTP_DOMAIN_ID,
        feeInfo.grossMicros.toString(),
        feeInfo.feeMicros.toString(),
        feeInfo.netMicros.toString(),
        feeInfo.feeBps,
        feeInfo.feeMicros > 0n ? String(feeTxHash) : null,
        String(burnTxHash),
      ],
    );

    await notifyDepositStarted({
      recipientAddress: userWallet,
      originChainName: chainConfig.name,
    });

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
    const reason = String(error?.shortMessage || error?.message || "Failed to record deposit");
    console.error("[api/user/cctp/deposit] error:", reason);
    return NextResponse.json({ error: reason }, { status: 400 });
  }
}

/**
 * Confirms an ERC-20 Transfer of at least `minAmountMicros` from `from` to the fee treasury, in the
 * given transaction, on the given chain.
 */
async function verifyFeeTransfer(params: {
  chainId: number;
  usdc: string;
  feeTxHash: string;
  from: string;
  minAmountMicros: bigint;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const rpc = resolveRpcUrl(params.chainId);
  if (!rpc) {
    return { ok: false, reason: `We can't reach chain ${params.chainId} to confirm the fee right now.` };
  }

  let receipt: ethers.TransactionReceipt | null;
  try {
    const provider = new ethers.JsonRpcProvider(rpc);
    receipt = await provider.getTransactionReceipt(params.feeTxHash);
  } catch (error: any) {
    console.error("[api/user/cctp/deposit] fee receipt lookup failed:", error?.message);
    return { ok: false, reason: "We couldn't confirm the fee payment just now. Try again in a moment." };
  }

  if (!receipt) {
    return { ok: false, reason: "We couldn't find that fee payment on chain yet. Wait for it to confirm and try again." };
  }
  if (receipt.status !== 1) {
    return { ok: false, reason: "That fee payment failed on chain." };
  }

  const treasury = BRIDGE_FEE_TREASURY_ADDRESS.toLowerCase();
  const sender = params.from.toLowerCase();
  const usdcAddress = params.usdc.toLowerCase();

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
