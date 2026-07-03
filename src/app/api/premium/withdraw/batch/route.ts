import { NextResponse } from "next/server";

/*
 * Batch payouts must reserve a merchant's spendable balance in the same database transaction
 * that claims the idempotency key. The previous implementation released its row lock before
 * checking and reserving funds, so concurrent batches could spend the same ledger balance.
 */
export async function POST() {
    return NextResponse.json({
        error: "Batch payouts are temporarily unavailable while atomic reservations are enabled.",
        code: "BATCH_PAYOUT_ATOMIC_RESERVATION_REQUIRED",
    }, { status: 503 });
}
