import { NextRequest, NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { pgMaybeOne } from "@/lib/serverPg";
import { formatMicros } from "@/lib/cctp/feeEngine";
import { processPendingCctpTransfers } from "@/lib/cctp/attestationWorker";

/**
 * Progress of one bridge transfer, for the caller's own wallet only.
 *
 * A transfer row carries both sides of a payment relationship, so it is scoped to the session wallet
 * rather than looked up by id alone: an unauthenticated read would hand anyone holding a burn hash
 * the sender, the recipient, and the amount.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const wallet = await getSessionWallet(req.headers);
    if (!wallet) {
      return NextResponse.json({ error: "Please connect your wallet and try again." }, { status: 401 });
    }

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Missing transfer ID" }, { status: 400 });
    }

    /* id::text, not id. The column is uuid, so comparing it to a burn hash makes Postgres try to
       cast the hash and raise instead of falling through to the burn_tx_hash branch. */
    const record = await pgMaybeOne<any>(
      `SELECT id, direction, user_wallet as "userWallet", recipient_address as "recipientAddress",
              origin_chain_id as "originChainId", origin_domain as "originDomain",
              destination_chain_id as "destinationChainId", destination_domain as "destinationDomain",
              gross_amount_micros as "grossAmountMicros", fee_amount_micros as "feeAmountMicros",
              net_amount_micros as "netAmountMicros", fee_bps as "feeBps",
              fee_tx_hash as "feeTxHash", burn_tx_hash as "burnTxHash",
              mint_tx_hash as "mintTxHash", status, attempt_count as "attemptCount",
              error_message as "errorMessage",
              created_at as "createdAt", updated_at as "updatedAt"
         FROM cctp_bridge_transfers
        WHERE (id::text = $1 OR burn_tx_hash = $1)
          AND (user_wallet = $2 OR recipient_address = $2)
        LIMIT 1`,
      [id, wallet.toLowerCase()],
    );

    if (!record) {
      return NextResponse.json({ error: "Transfer not found" }, { status: 404 });
    }

    /* If still pending, trigger the keeper in background to advance the transfer */
    if (record.status === "pending_attestation" || record.status === "minting") {
      void processPendingCctpTransfers().catch(() => undefined);
    }

    return NextResponse.json({
      success: true,
      transfer: {
        ...record,
        grossUsdc: formatMicros(BigInt(record.grossAmountMicros), 6),
        feeUsdc: formatMicros(BigInt(record.feeAmountMicros), 6),
        netUsdc: formatMicros(BigInt(record.netAmountMicros), 6),
      },
    });
  } catch (error: any) {
    console.error("[api/user/cctp/status] error:", error?.message);
    return NextResponse.json({ error: "Failed to fetch status" }, { status: 500 });
  }
}
