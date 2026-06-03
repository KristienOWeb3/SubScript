import { processPremiumUpgrade } from "./processPremiumUpgrade";

export async function reconcile(supabase: any, limit: number = 300): Promise<{ success: boolean; processedCount: number; results: any[] }> {
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

    const results: any[] = [];

    if (sessions && sessions.length > 0) {
        console.log(`[db_updated] Claimed ${sessions.length} sessions for verification.`);

        /* Bounded concurrency setup */
        const concurrency = 25;
        let activeIndex = 0;

        const processSessionTask = async (session: any, index: number) => {
            try {
                const res = await processPremiumUpgrade({
                    supabase,
                    txHash: session.tx_hash,
                    sessionId: session.session_id,
                    walletAddress: session.merchant_address
                });

                results[index] = {
                    sessionId: session.session_id,
                    merchantAddress: session.merchant_address,
                    txHash: session.tx_hash,
                    success: res.success,
                    status: res.status,
                    error: res.error || null
                };
            } catch (err: any) {
                console.error(`[db_updated] Error reconciling session ${session.session_id}:`, err);
                
                /* Reset session status to FAILED so it can be retried later */
                await supabase
                    .from("payment_sessions")
                    .update({ status: "FAILED", updated_at: new Date().toISOString() })
                    .eq("session_id", session.session_id);

                results[index] = {
                    sessionId: session.session_id,
                    merchantAddress: session.merchant_address,
                    txHash: session.tx_hash,
                    success: false,
                    status: 500,
                    error: err.message || "Unknown error"
                };
            }
        };

        const workers: Promise<void>[] = [];

        const runNext = async (): Promise<void> => {
            while (activeIndex < sessions.length) {
                const index = activeIndex++;
                await processSessionTask(sessions[index], index);
            }
        };

        /* Spawn concurrent workers to drain the queue */
        for (let i = 0; i < Math.min(concurrency, sessions.length); i++) {
            workers.push(runNext());
        }

        await Promise.all(workers);
    } else {
        console.log(`[db_updated] No pending sessions found requiring verification.`);
    }

    return {
        success: true,
        processedCount: results.length,
        results
    };
}

