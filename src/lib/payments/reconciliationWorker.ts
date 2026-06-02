import { processPremiumUpgrade } from "./processPremiumUpgrade";

export async function reconcile(supabase: any, limit: number = 50): Promise<{ success: boolean; processedCount: number; results: any[] }> {
    console.log(`[db_updated] Reconciliation worker initiated (Batch limit: ${limit})`);

    /* 1. Claim pending/failed sessions with transaction evidence atomically using PLpgSQL */
    const { data: sessions, error: rpcError } = await supabase.rpc(
        "claim_pending_payment_sessions",
        { batch_size: limit }
    );

    if (rpcError) {
        console.error(`[db_updated] Failed to claim sessions via RPC: ${rpcError.message}`);
        return { success: false, processedCount: 0, results: [] };
    }

    const results = [];

    if (sessions && sessions.length > 0) {
        console.log(`[db_updated] Claimed ${sessions.length} sessions for verification.`);
        for (const session of sessions) {
            try {
                const res = await processPremiumUpgrade({
                    supabase,
                    txHash: session.tx_hash,
                    sessionId: session.session_id,
                    walletAddress: session.merchant_address
                });

                results.push({
                    sessionId: session.session_id,
                    merchantAddress: session.merchant_address,
                    txHash: session.tx_hash,
                    success: res.success,
                    status: res.status,
                    error: res.error || null
                });
            } catch (err: any) {
                console.error(`[db_updated] Error reconciling session ${session.session_id}:`, err);
                
                /* Reset session status to FAILED so it can be retried later */
                await supabase
                    .from("payment_sessions")
                    .update({ status: "FAILED", updated_at: new Date().toISOString() })
                    .eq("session_id", session.session_id);

                results.push({
                    sessionId: session.session_id,
                    merchantAddress: session.merchant_address,
                    txHash: session.tx_hash,
                    success: false,
                    status: 500,
                    error: err.message || "Unknown error"
                });
            }
        }
    } else {
        console.log(`[db_updated] No pending sessions found requiring verification.`);
    }

    return {
        success: true,
        processedCount: results.length,
        results
    };
}
