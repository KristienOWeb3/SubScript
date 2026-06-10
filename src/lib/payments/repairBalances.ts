import { ethers } from "ethers";

/* Balance Repair and Reconciliation Tool */
export async function repairMerchantBalance(
    supabase: any,
    merchantAddress: string
): Promise<{ success: boolean; availableBalance: bigint; reservedBalance: bigint; message?: string }> {
    const normalizedMerchant = merchantAddress.toLowerCase();

    try {
        /* 1. Acquire row lock on merchant to prevent concurrent writes during repair */
        const { error: lockError } = await supabase.rpc("lock_merchant_row", {
            p_wallet_address: normalizedMerchant
        });

        if (lockError) {
            console.error(`[repair] Row lock acquisition failed for ${normalizedMerchant}: ${lockError.message}`);
        }

        /* 2. Retrieve all ledger entries for this merchant using bytea conversion */
        const byteaAddress = normalizedMerchant.replace("0x", "\\x");
        const { data: ledgerEntries, error: ledgerError } = await supabase
            .from("ledger_entries")
            .select("*")
            .eq("merchant_address", byteaAddress);

        if (ledgerError) {
            console.error(`[repair] Failed to fetch ledger entries: ${ledgerError.message}`);
            return { success: false, availableBalance: BigInt(0), reservedBalance: BigInt(0), message: ledgerError.message };
        }

        let calculatedSettledCredits = BigInt(0);
        let calculatedSettledDebits = BigInt(0);
        let calculatedPendingDebits = BigInt(0);

        /* 3. Recompute balances using ledger entries with status checks */
        if (ledgerEntries) {
            for (const entry of ledgerEntries) {
                if (entry.status === "FAILED") {
                    continue;
                }

                const amount = BigInt(entry.amount_usdc);
                const type = entry.entry_type;
                const status = entry.status;

                if (type === "CREDIT_PAYMENT" || type === "CREDIT_PAYMENT_LINK") {
                    if (status === "FINALIZED") {
                        calculatedSettledCredits += amount;
                    }
                } else if (type === "DEBIT_WITHDRAWAL" || type === "DEBIT_BATCH_PAYOUT") {
                    if (status === "FINALIZED") {
                        calculatedSettledDebits += amount;
                    } else if (status === "PENDING") {
                        calculatedPendingDebits += amount;
                    }
                } else if (type === "RESERVE") {
                    if (status === "PENDING") {
                        calculatedPendingDebits += amount;
                    }
                }
            }
        }

        let calculatedAvailable = calculatedSettledCredits - calculatedSettledDebits - calculatedPendingDebits;
        let calculatedReserved = calculatedPendingDebits;

        /* Prevent negative balances due to corrupted ledger states */
        if (calculatedAvailable < BigInt(0)) calculatedAvailable = BigInt(0);
        if (calculatedReserved < BigInt(0)) calculatedReserved = BigInt(0);

        /* 4. Update the merchant's balance cache fields in database */
        const { error: updateError } = await supabase
            .from("merchants")
            .update({
                available_balance_usdc: calculatedAvailable.toString(),
                reserved_balance_usdc: calculatedReserved.toString(),
                updated_at: new Date().toISOString()
            })
            .eq("wallet_address", normalizedMerchant);

        if (updateError) {
            console.error(`[repair] Failed to update merchant balance cache: ${updateError.message}`);
            return { success: false, availableBalance: BigInt(0), reservedBalance: BigInt(0), message: updateError.message };
        }

        console.log(`[repair] Successfully repaired balance cache for ${normalizedMerchant}. Available: ${calculatedAvailable.toString()}, Reserved: ${calculatedReserved.toString()}`);
        return {
            success: true,
            availableBalance: calculatedAvailable,
            reservedBalance: calculatedReserved
        };

    } catch (err: any) {
        console.error(`[repair] Exception caught during balance repair:`, err);
        return { success: false, availableBalance: BigInt(0), reservedBalance: BigInt(0), message: err.message || String(err) };
    }
}
