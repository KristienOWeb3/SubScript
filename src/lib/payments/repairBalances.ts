/* Balance Repair and Reconciliation Tool */
export async function repairMerchantBalance(
    supabase: any,
    merchantAddress: string,
): Promise<{ success: boolean; availableBalance: bigint; reservedBalance: bigint; message?: string }> {
    const normalizedMerchant = merchantAddress.toLowerCase();

    try {
        /* The lock, ledger snapshot, aggregate, and cache update must share one
           database transaction. A standalone lock RPC releases before the next
           REST request and provides no serialization at all. */
        const { data, error } = await supabase.rpc("repair_merchant_balance_atomic", {
            p_wallet_address: normalizedMerchant,
        });
        if (error) throw new Error(error.message);
        const row = Array.isArray(data) ? data[0] : data;
        if (!row) throw new Error("Merchant balance repair returned no row");

        const availableBalance = BigInt(row.available_balance_usdc);
        const reservedBalance = BigInt(row.reserved_balance_usdc);
        console.log(
            `[repair] Successfully repaired balance cache for ${normalizedMerchant}. `
            + `Available: ${availableBalance}, Reserved: ${reservedBalance}`,
        );
        return { success: true, availableBalance, reservedBalance };
    } catch (error: any) {
        console.error(`[repair] Failed to repair balance cache for ${normalizedMerchant}:`, error);
        return {
            success: false,
            availableBalance: BigInt(0),
            reservedBalance: BigInt(0),
            message: error?.message || String(error),
        };
    }
}
