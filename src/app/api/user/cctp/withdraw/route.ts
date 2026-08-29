import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import { getSessionWallet } from "@/lib/auth";
import { getWalletCustody, deterministicIdempotencyKey } from "@/lib/custody";
import { pgQuery } from "@/lib/serverPg";
import { validateBridgeRequest, formatMicros } from "@/lib/cctp/feeEngine";
import { processPendingCctpTransfers } from "@/lib/cctp/attestationWorker";
import {
  addressToBytes32,
  ANY_DESTINATION_CALLER,
  ERC20_ABI,
  FINALITY_THRESHOLD_STANDARD,
  TOKEN_MESSENGER_V2_ABI,
} from "@/lib/cctp/circleBridge";
import { getArcRpcUrl } from "@/lib/cctp/relayer";
import {
  ARC_CCTP_DOMAIN_ID,
  ARC_TOKEN_MESSENGER_ADDRESS,
  BRIDGE_FEE_TREASURY_ADDRESS,
  USDC_NATIVE_GAS_ADDRESS,
} from "@/lib/contracts/constants";

export const maxDuration = 180;

/**
 * Withdraw Arc USDC to another CCTP chain.
 *
 * The protocol fee is split off as its own USDC transfer to the treasury *before* the burn, and only
 * the net is burned. CCTP mints one-for-one, so burning the gross amount would hand the recipient
 * every cent and collect no fee at all, however the numbers were recorded.
 *
 * Order matters. The row is written first (so an irreversible burn is never unrecorded), then the
 * fee moves, then the burn. If the burn fails after the fee has moved the row stays at `pending_fee`
 * with the fee tx recorded, which is a recoverable state a human can refund or resume. The reverse
 * order would bridge the money and lose the fee with nothing to reconcile against.
 */
export async function POST(req: NextRequest) {
  let transferId: string | null = null;

  try {
    const wallet = await getSessionWallet(req.headers);
    if (!wallet) {
      return NextResponse.json({ error: "Please connect your wallet and try again." }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
    }

    const { destinationChainIdOrDomain, recipientAddress, amountMicros } = body;
    if (destinationChainIdOrDomain === undefined || destinationChainIdOrDomain === null) {
      return NextResponse.json({ error: "Pick a destination network." }, { status: 400 });
    }
    if (typeof recipientAddress !== "string" || !recipientAddress.trim()) {
      return NextResponse.json({ error: "Enter the address that should receive the USDC." }, { status: 400 });
    }
    if (amountMicros === undefined || amountMicros === null) {
      return NextResponse.json({ error: "Enter an amount to withdraw." }, { status: 400 });
    }

    const userWallet = wallet.toLowerCase();
    const recipient = recipientAddress.trim();

    /* Fee tier, limits, and address shape. Throws with user-facing copy. */
    const feeInfo = validateBridgeRequest({
      direction: "outbound_withdrawal",
      targetChainIdOrDomain: destinationChainIdOrDomain,
      amountMicros,
      userWallet,
      recipientAddress: recipient,
    });

    /* Server-held custody only. External wallets sign their own burn in the browser and register it
       through /api/user/cctp/withdraw/register instead. Checking before the balance read keeps the
       error specific. */
    let custody;
    try {
      custody = await getWalletCustody(userWallet);
    } catch {
      return NextResponse.json(
        {
          error: "Cross-chain withdrawals need your in-app wallet. Switch to it, or send on Arc instead.",
          code: "custody_unavailable",
        },
        { status: 409 },
      );
    }

    /* Balance check before anything irreversible. The gross has to be there: fee plus burn. */
    const arcProvider = new ethers.JsonRpcProvider(getArcRpcUrl());
    const usdc = new ethers.Contract(USDC_NATIVE_GAS_ADDRESS, ERC20_ABI, arcProvider);
    let onChainBalance: bigint;
    try {
      onChainBalance = BigInt((await usdc.balanceOf(userWallet)).toString());
    } catch (balanceError: any) {
      console.error("[api/user/cctp/withdraw] balance read failed:", balanceError?.message);
      return NextResponse.json({ error: "We couldn't read your Arc balance just now. Try again in a moment." }, { status: 503 });
    }
    if (onChainBalance < feeInfo.grossMicros) {
      return NextResponse.json(
        {
          error: `You have ${formatMicros(onChainBalance)} USDC on Arc, which isn't enough to send ${formatMicros(feeInfo.grossMicros)}.`,
        },
        { status: 400 },
      );
    }

    /* Row first: the id is also the idempotency seed, so two identical withdrawals get two distinct
       Circle transactions. Seeding on wallet+chain+amount made the second one silently return the
       first one's transaction hash. */
    const inserted = await pgQuery<{ id: string }>(
      `INSERT INTO cctp_bridge_transfers
         (direction, user_wallet, recipient_address, origin_chain_id, origin_domain,
          destination_chain_id, destination_domain, gross_amount_micros, fee_amount_micros,
          net_amount_micros, fee_bps, status)
       VALUES ('outbound_withdrawal', $1, $2, 'arc', $3, $4, $5, $6, $7, $8, $9, 'pending_burn')
       RETURNING id`,
      [
        userWallet,
        recipient.toLowerCase(),
        ARC_CCTP_DOMAIN_ID,
        feeInfo.chainId,
        feeInfo.domain,
        feeInfo.grossMicros.toString(),
        feeInfo.feeMicros.toString(),
        feeInfo.netMicros.toString(),
        feeInfo.feeBps,
      ],
    );
    transferId = inserted[0]?.id ?? null;
    if (!transferId) {
      return NextResponse.json({ error: "We couldn't start that withdrawal. Try again." }, { status: 500 });
    }

    /* Step 1: take the fee. Small, cheap, and reverting here costs the user nothing. */
    const { txHash: feeTxHash } = await custody.executeContract({
      contractAddress: USDC_NATIVE_GAS_ADDRESS,
      abi: ERC20_ABI,
      functionName: "transfer",
      args: [BRIDGE_FEE_TREASURY_ADDRESS, feeInfo.feeMicros],
      idempotencyKey: deterministicIdempotencyKey(`cctp-withdraw-fee:${transferId}`),
    });

    await pgQuery(
      `UPDATE cctp_bridge_transfers SET status = 'pending_fee', fee_tx_hash = $2, updated_at = now() WHERE id = $1`,
      [transferId, feeTxHash],
    );

    /* Step 2: approve exactly the net. Approving the gross would leave the TokenMessenger able to
       pull the fee portion later. */
    await custody.executeContract({
      contractAddress: USDC_NATIVE_GAS_ADDRESS,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [ARC_TOKEN_MESSENGER_ADDRESS, feeInfo.netMicros],
      idempotencyKey: deterministicIdempotencyKey(`cctp-withdraw-approve:${transferId}`),
    });

    /* Step 3: burn the net on Arc. CCTP V2 takes seven arguments; the four-argument V1 form is a
       different selector and reverts here. */
    const { txHash: burnTxHash } = await custody.executeContract({
      contractAddress: ARC_TOKEN_MESSENGER_ADDRESS,
      abi: TOKEN_MESSENGER_V2_ABI,
      functionName: "depositForBurn",
      args: [
        feeInfo.netMicros,
        feeInfo.domain,
        addressToBytes32(recipient),
        USDC_NATIVE_GAS_ADDRESS,
        ANY_DESTINATION_CALLER,
        0n,
        FINALITY_THRESHOLD_STANDARD,
      ],
      idempotencyKey: deterministicIdempotencyKey(`cctp-withdraw-burn:${transferId}`),
    });

    await pgQuery(
      `UPDATE cctp_bridge_transfers
          SET status = 'pending_attestation', burn_tx_hash = $2, updated_at = now()
        WHERE id = $1`,
      [transferId, burnTxHash],
    );

    /* Trigger keeper in background to start polling Iris and relay minting onto destination chain */
    void processPendingCctpTransfers().catch((err) =>
      console.warn("[api/user/cctp/withdraw] background keeper error:", err?.message)
    );

    return NextResponse.json({
      success: true,
      transferId,
      burnTxHash,
      feeTxHash,
      fee: {
        grossUsdc: formatMicros(feeInfo.grossMicros, 6),
        feeUsdc: formatMicros(feeInfo.feeMicros, 6),
        netUsdc: formatMicros(feeInfo.netMicros, 6),
        feePercentage: feeInfo.feePercentage,
        chainName: feeInfo.chainName,
      },
    });
  } catch (error: any) {
    const reason = String(error?.shortMessage || error?.message || "Failed to start withdrawal");
    console.error("[api/user/cctp/withdraw] error:", reason);

    /* Leave a trail on the row so a half-finished withdrawal is visible instead of looking pending
       forever. Never delete it: the fee transfer may already have landed. */
    if (transferId) {
      await pgQuery(
        `UPDATE cctp_bridge_transfers SET error_message = $2, updated_at = now() WHERE id = $1 AND burn_tx_hash IS NULL`,
        [transferId, reason.slice(0, 500)],
      ).catch(() => undefined);
    }

    return NextResponse.json({ error: reason }, { status: 400 });
  }
}
